import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { findInternalPackageUrls } from "./check-package-urls.mjs";

const cli = fileURLToPath(new URL("./check-package-urls.mjs", import.meta.url));

test("public npm, scoped packages and local resolutions are accepted", () => {
  assert.deepEqual(findInternalPackageUrls({ packages: {
    "node_modules/playwright": { resolved: "https://registry.npmjs.org/playwright/-/playwright-1.64.0.tgz" },
    "node_modules/@scope/package": { resolved: "https://registry.npmjs.org/@scope/package/-/package-1.0.0.tgz" },
    "node_modules/local": { resolved: "file:../local" },
  } }), []);
});

test("HTTP/HTTPS internal hosts are rejected in modern and legacy lockfiles", () => {
  const matches = findInternalPackageUrls({
    packages: { "node_modules/playwright": {
      resolved: "http://package-firewall.replit.internal/npm/playwright/-/playwright-1.64.0.tgz",
    } },
    dependencies: { nested: { dependencies: { core: {
      resolved: "https://PACKAGE-FIREWALL.REPLIT.INTERNAL/npm/core.tgz",
    } } } },
  });
  assert.equal(matches.length, 2);
  assert.ok(matches.every(match => match.hostname === "package-firewall.replit.internal"));
});

test("lookalike public hostnames are not mistaken for internal hosts", () => {
  assert.deepEqual(findInternalPackageUrls({ resolved: "https://replit.internal.example.org/package.tgz" }), []);
});

test("CLI fails on internal URLs without exposing credentials or modifying files", () => {
  const directory = mkdtempSync(join(tmpdir(), "package-url-check-"));
  try {
    const path = join(directory, "package-lock.json");
    const contents = JSON.stringify({ resolved: "https://fixture:fixture-secret@package-firewall.replit.internal/npm/pkg.tgz" });
    writeFileSync(path, contents);
    const result = spawnSync(process.execPath, [cli, path], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /package-firewall\.replit\.internal/);
    assert.ok(!result.stderr.includes("fixture-secret"));
    assert.equal(readFileSync(path, "utf8"), contents);
    writeFileSync(path, JSON.stringify({ resolved: "https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz" }));
    assert.equal(spawnSync(process.execPath, [cli, path]).status, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("CLI fails explicitly on missing or malformed lockfiles", () => {
  const directory = mkdtempSync(join(tmpdir(), "package-url-errors-"));
  try {
    const path = join(directory, "package-lock.json");
    assert.equal(spawnSync(process.execPath, [cli, path]).status, 1);
    writeFileSync(path, "{broken JSON");
    assert.equal(spawnSync(process.execPath, [cli, path]).status, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
