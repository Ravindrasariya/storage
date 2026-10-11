#!/usr/bin/env node
// Read-only portability guard. No package downloads, lifecycle scripts or DB access.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function findInternalPackageUrls(lockfile) {
  const matches = [];
  function visit(value, path) {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      const location = `${path}[${JSON.stringify(key)}]`;
      if (key === "resolved" && typeof child === "string") {
        try {
          const { hostname } = new URL(child);
          if (hostname === "replit.internal" || hostname.endsWith(".replit.internal")) {
            // Never print a complete URL: it might contain credentials.
            matches.push({ location, hostname });
          }
        } catch {
          // Non-URL resolutions (e.g. local file paths) are not internal hosts.
        }
      } else {
        visit(child, location);
      }
    }
  }
  visit(lockfile, "$");
  return matches;
}

export function checkPackageUrls(path = "package-lock.json") {
  const lockfile = JSON.parse(readFileSync(path, "utf8"));
  const matches = findInternalPackageUrls(lockfile);
  if (matches.length) {
    console.error("Package portability failed: Replit-internal downloads cannot be used on the VPS.");
    for (const { location, hostname } of matches) {
      console.error(`  ${location}: ${hostname}`);
    }
    console.error("Use verified public tarball URLs without changing versions or integrity hashes. See docs/vps-package-install.md.");
    return 1;
  }
  console.log("Package portability passed: no Replit-internal resolved URLs.");
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = checkPackageUrls(process.argv[2]);
  } catch {
    console.error("Package portability failed: lockfile could not be read or parsed.");
    process.exitCode = 1;
  }
}
