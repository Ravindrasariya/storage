#!/usr/bin/env node
/**
 * Guardrail: every React Query `useMutation` in the client that touches a
 * sale-, exit-, payment-, or ledger-related endpoint must call
 * `invalidateSaleSideEffects(queryClient)` (the central helper in
 * client/src/lib/queryClient.ts) so dependent pages like NIKASI / Exit
 * Register / Cash Flow / Buyer & Farmer Ledger refresh automatically.
 *
 * Why this exists: React Query treats sibling cache keys as independent. A
 * single missed invalidate call shows up as a "stale screen" bug for users.
 * Task #151 centralised the keys; this script makes calling that helper
 * non-optional for new sale-touching mutations.
 *
 * Failure mode: prints each offending file:line plus the matched endpoint
 * and exits with code 1. Pass code 0 means no violations.
 *
 * Escape hatch (use sparingly, with a real reason on the same line):
 *   // guardrail-allow: skip-sale-invalidation -- <reason>
 * placed inside the offending useMutation block.
 *
 * Run manually:   node scripts/check-sale-invalidation.mjs
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = [
  join("client", "src", "components"),
  join("client", "src", "pages"),
  join("client", "src", "hooks"),
];

// Endpoint substrings that, if mutated (POST/PATCH/PUT/DELETE) inside a
// `useMutation`, require the central invalidate helper. Keep this list
// narrow + explicit so the rule stays predictable. Each entry is matched as
// a URL path prefix on the mutation's request URL (after stripping query
// string and template-literal interpolations).
//
// We scope to endpoints whose mutation can change the numbers shown on
// NIKASI / Exit Register / Cash Flow / Buyer & Farmer Ledger views: sale,
// exit, payment, cash, discount, and the ledger roots themselves. Some
// roster-only ledger writes (e.g. flagging or archiving a buyer) genuinely
// don't move sale aggregates; those should opt out via the allow-comment at
// the call site so the exception is documented and reviewed, rather than
// being silently allowed by a narrow pattern list.
const SALE_ENDPOINT_PATTERNS = [
  "/api/sales-history",
  "/api/sales/",
  "/api/exits",
  "/api/exit-register",
  "/api/payments",
  "/api/cash-receipts",
  "/api/cash-transfers",
  "/api/cash-flow",
  "/api/discounts",
  "/api/up-for-sale",
  "/api/buyer-ledger",
  "/api/farmer-ledger",
];

const ALLOW_COMMENT = "guardrail-allow: skip-sale-invalidation";
const HELPER_NAME = "invalidateSaleSideEffects";

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (/\.(tsx?|jsx?)$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Find every `useMutation(` call site and return the index range of its
 * argument list (the matching balanced parens). We need balanced matching
 * because mutation bodies are large and contain nested braces, parens,
 * template literals, strings, regexes, and comments.
 */
function findMutationBlocks(src) {
  const blocks = [];
  const re = /\buseMutation\s*\(/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const start = m.index + m[0].length - 1; // position of opening '('
    const end = matchBalanced(src, start);
    if (end !== -1) blocks.push({ start, end });
  }
  return blocks;
}

/**
 * Walk forward from an opening `(` or `{` and return the index of the
 * matching closer, ignoring brackets that appear inside strings, template
 * literals, regex literals, or comments. Returns -1 if unbalanced.
 */
function matchBalanced(src, openIdx) {
  const open = src[openIdx];
  const close = open === "(" ? ")" : open === "{" ? "}" : open === "[" ? "]" : null;
  if (!close) return -1;
  let depth = 0;
  let i = openIdx;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    // line comment
    if (c === "/" && next === "/") {
      const nl = src.indexOf("\n", i + 2);
      i = nl === -1 ? n : nl + 1;
      continue;
    }
    // block comment
    if (c === "/" && next === "*") {
      const close2 = src.indexOf("*/", i + 2);
      i = close2 === -1 ? n : close2 + 2;
      continue;
    }
    // string literals
    if (c === '"' || c === "'") {
      i++;
      while (i < n && src[i] !== c) {
        if (src[i] === "\\") i += 2;
        else i++;
      }
      i++;
      continue;
    }
    // template literal (handle ${ ... } recursively)
    if (c === "`") {
      i++;
      while (i < n && src[i] !== "`") {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === "$" && src[i + 1] === "{") {
          const end = matchBalanced(src, i + 1);
          if (end === -1) return -1;
          i = end + 1;
          continue;
        }
        i++;
      }
      i++;
      continue;
    }
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

function lineOf(src, idx) {
  let line = 1;
  for (let i = 0; i < idx && i < src.length; i++) {
    if (src[i] === "\n") line++;
  }
  return line;
}

// Extract every URL that the mutation body sends a write request to. Two
// shapes are recognised because they cover ~all call sites in this repo:
//
//   apiRequest("POST", "/api/foo/bar", body)
//   apiRequest("PATCH", `/api/foo/${id}`, body)
//   authFetch("/api/foo/bar", { method: "DELETE" })
//   fetch("/api/foo/bar", { method: "POST", ... })
//
// Returns an array of normalised URL paths (template `${...}` interpolations
// are replaced with `:param` so the prefix match below is stable).
const APIREQUEST_RE =
  /\bapiRequest\s*\(\s*["'`](POST|PATCH|PUT|DELETE)["'`]\s*,\s*(["'`])((?:\\.|(?!\2).)*)\2/g;
const FETCH_WITH_METHOD_RE =
  /\b(?:authFetch|fetch)\s*\(\s*(["'`])((?:\\.|(?!\1).)*)\1\s*,\s*\{[^}]*method\s*:\s*["'`](POST|PATCH|PUT|DELETE)["'`]/g;

function normaliseUrl(raw) {
  // Strip template interpolations so prefix matching is reliable.
  return raw.replace(/\$\{[^}]*\}/g, ":param").split("?")[0];
}

function extractMutationUrls(block) {
  const urls = [];
  let m;
  APIREQUEST_RE.lastIndex = 0;
  while ((m = APIREQUEST_RE.exec(block)) !== null) {
    urls.push(normaliseUrl(m[3]));
  }
  FETCH_WITH_METHOD_RE.lastIndex = 0;
  while ((m = FETCH_WITH_METHOD_RE.exec(block)) !== null) {
    urls.push(normaliseUrl(m[2]));
  }
  return urls;
}

function findOffendingEndpoint(block) {
  const urls = extractMutationUrls(block);
  if (urls.length === 0) return null;
  for (const url of urls) {
    for (const pat of SALE_ENDPOINT_PATTERNS) {
      if (url.startsWith(pat) || url.includes(pat)) return { pat, url };
    }
  }
  return null;
}

function checkFile(file) {
  const src = readFileSync(file, "utf8");
  if (!src.includes("useMutation")) return [];
  const blocks = findMutationBlocks(src);
  const violations = [];
  for (const { start, end } of blocks) {
    const block = src.slice(start, end + 1);
    const hit = findOffendingEndpoint(block);
    if (!hit) continue;
    if (block.includes(HELPER_NAME + "(")) continue;
    // Accept the allow-comment either inside the block or on the (up to) 3
    // source lines immediately preceding the useMutation call. We walk
    // backwards line-by-line — not by character window — so an unrelated
    // older allow comment somewhere upstream cannot accidentally exempt
    // this mutation.
    let preambleAllow = false;
    let cursor = start;
    for (let i = 0; i < 3; i++) {
      const lineEnd = src.lastIndexOf("\n", cursor - 1);
      if (lineEnd < 0) break;
      const lineStart = src.lastIndexOf("\n", lineEnd - 1) + 1;
      const line = src.slice(lineStart, lineEnd);
      // Stop scanning once we hit a non-comment, non-blank line — the
      // allow-comment must sit immediately above the useMutation block.
      const trimmed = line.trim();
      if (trimmed === "") { cursor = lineStart; continue; }
      if (!trimmed.startsWith("//")) break;
      if (line.includes(ALLOW_COMMENT)) { preambleAllow = true; break; }
      cursor = lineStart;
    }
    if (block.includes(ALLOW_COMMENT) || preambleAllow) continue;
    violations.push({
      file: relative(ROOT, file).split(sep).join("/"),
      line: lineOf(src, start),
      endpoint: `${hit.url} (matches ${hit.pat})`,
    });
  }
  return violations;
}

function main() {
  const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));
  const allViolations = files.flatMap(checkFile);
  if (allViolations.length === 0) {
    console.log(
      `[sale-invalidation] OK — scanned ${files.length} files, no sale-touching mutation is missing ${HELPER_NAME}().`,
    );
    process.exit(0);
  }
  console.error("[sale-invalidation] FAIL — sale-touching mutations missing invalidateSaleSideEffects(queryClient):\n");
  for (const v of allViolations) {
    console.error(`  ${v.file}:${v.line}   touches ${v.endpoint}`);
  }
  console.error(
    `\nFix: import \`invalidateSaleSideEffects\` from \`@/lib/queryClient\` and call ` +
      `\`invalidateSaleSideEffects(queryClient)\` from the mutation's \`onSuccess\` ` +
      `(or wherever it succeeds). If the mutation truly does not affect any sale ` +
      `view, add an inline comment inside the useMutation block:\n` +
      `    // ${ALLOW_COMMENT} -- <reason>\n`,
  );
  process.exit(1);
}

main();
