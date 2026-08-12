#!/usr/bin/env node
// SEC-03 dependency-gate policy engine (plan 06-03, Task 3).
//
// Fails a target-repo PR if any NEWLY-added dependency — in package.json OR the
// lockfile — violates the factory-vendored dependency policy: a non-allowlisted
// license, below the age / weekly-download provenance floor, or a typosquat of a
// popular package name. A lockfile-only injection (a package added to the
// lockfile with a clean package.json diff) is caught too (T-06-11), because
// checkDependencyDiff unions the manifest AND lockfile new-package names before
// evaluating any of them.
//
// The policy is read from the FACTORY-VENDORED dependency-policy.json at a fixed
// relative location beside this vendored script — never the PR's own tree
// (T-06-12 anti-bypass).
//
// Shape mirrors scripts/assert-gate-suite.mjs: pure, unit-testable functions
// (`checkPackage`, `checkDependencyDiff`) exported separately from the
// `main(argv)` CLI wrapper, guarded by the direct-invocation check at the bottom
// so Vitest can import the pure functions without triggering the CLI.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";

/**
 * Hand-rolled Levenshtein edit distance. Deliberately not a dependency: it is a
 * small, well-known algorithm (not domain logic), and the whole point of this
 * gate is to be wary of pulling in packages — pulling one in to compute the
 * typosquat metric would be self-defeating.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/**
 * Pure policy predicate over PRE-FETCHED package metadata. Does NOT perform any
 * network fetch itself (so it is directly unit-testable). Returns an array of
 * human-readable failure reasons — an EMPTY array means the package passes.
 *
 * Missing / malformed metadata fields soft-fail to a red verdict (never a crash):
 * an absent license, age, or download count is treated as a policy failure, per
 * the fail-closed discipline (a package we cannot vet is not a package we admit).
 *
 * @param {string} name
 * @param {{license?: string, ageDays?: number, weeklyDownloads?: number}} meta
 * @param {{allowedLicenses: string[], minAgeDays: number, minWeeklyDownloads: number, maxNameDistance: number, popularPackages: string[]}} policy
 * @returns {string[]}
 */
export function checkPackage(name, meta, policy) {
  const reasons = [];
  const m = meta ?? {};

  // License allowlist. A missing or non-string license is a red verdict.
  if (typeof m.license !== "string" || !policy.allowedLicenses.includes(m.license)) {
    reasons.push(
      `license ${JSON.stringify(m.license)} is not in the allowlist [${policy.allowedLicenses.join(", ")}]`,
    );
  }

  // Age floor. A missing / non-numeric age is a red verdict.
  if (typeof m.ageDays !== "number" || m.ageDays < policy.minAgeDays) {
    reasons.push(
      `package age ${JSON.stringify(m.ageDays)} days is below the ${policy.minAgeDays}-day minimum`,
    );
  }

  // Weekly-download floor. A missing / non-numeric count is a red verdict.
  if (typeof m.weeklyDownloads !== "number" || m.weeklyDownloads < policy.minWeeklyDownloads) {
    reasons.push(
      `weekly downloads ${JSON.stringify(m.weeklyDownloads)} is below the ${policy.minWeeklyDownloads} floor`,
    );
  }

  // Typosquat distance. An EXACT match to a popular package is the package
  // itself — never its own typosquat — so skip the check entirely for known
  // names. Otherwise flag any name within maxNameDistance edits of a popular one.
  if (!policy.popularPackages.includes(name)) {
    for (const popular of policy.popularPackages) {
      const distance = levenshtein(name, popular);
      if (distance > 0 && distance <= policy.maxNameDistance) {
        reasons.push(
          `name is a likely typosquat: edit-distance ${distance} from popular package "${popular}"`,
        );
        break;
      }
    }
  }

  return reasons;
}

/**
 * Real npm-registry metadata fetcher (the default injected into
 * checkDependencyDiff). Hits registry.npmjs.org for created-time + license and
 * api.npmjs.org for last-week downloads. Any fetch/parse failure or missing
 * field soft-fails to metadata that checkPackage will read as a red verdict —
 * never a thrown error (V5 input-validation: unreachable/renamed package => red,
 * not crash).
 * @param {string} name
 * @returns {Promise<{license: string|undefined, ageDays: number, weeklyDownloads: number}>}
 */
export async function defaultFetchMeta(name) {
  const red = { license: undefined, ageDays: 0, weeklyDownloads: 0 };
  try {
    const regRes = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`);
    if (!regRes.ok) return red;
    const reg = await regRes.json();
    const created = reg?.time?.created;
    const ageDays = created
      ? (Date.now() - new Date(created).getTime()) / 86_400_000
      : 0;
    let license = reg?.license;
    const latest = reg?.["dist-tags"]?.latest;
    if (!license && latest) license = reg?.versions?.[latest]?.license;
    if (license && typeof license === "object") license = license.type;

    let weeklyDownloads = 0;
    try {
      const dlRes = await fetch(
        `https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(name)}`,
      );
      if (dlRes.ok) {
        const dl = await dlRes.json();
        if (typeof dl?.downloads === "number") weeklyDownloads = dl.downloads;
      }
    } catch {
      weeklyDownloads = 0;
    }

    return { license, ageDays, weeklyDownloads };
  } catch {
    return red;
  }
}

/**
 * Evaluate every NEW package introduced by a PR. `manifestDiff` and
 * `lockfileDiff` are arrays of `{name}` entries (the caller/CLI parses the raw
 * `git diff`). The two are UNIONED by name BEFORE evaluation — so a package
 * present only in the lockfile diff (a clean package.json) is still fetched and
 * checked. This union is the canonical lockfile-only-injection bypass guard
 * (T-06-11). `fetchMeta` is injected for testability (default: the real npm
 * fetcher); a fetch failure for one name soft-fails that package to a red verdict.
 *
 * @param {Array<{name: string}>} manifestDiff
 * @param {Array<{name: string}>} lockfileDiff
 * @param {object} policy
 * @param {(name: string) => Promise<object>} [fetchMeta]
 * @returns {Promise<Array<{name: string, reasons: string[]}>>}
 */
export async function checkDependencyDiff(
  manifestDiff,
  lockfileDiff,
  policy,
  fetchMeta = defaultFetchMeta,
) {
  const names = new Set();
  for (const e of manifestDiff ?? []) if (e && e.name) names.add(e.name);
  for (const e of lockfileDiff ?? []) if (e && e.name) names.add(e.name);

  const results = [];
  for (const name of names) {
    let meta;
    try {
      meta = await fetchMeta(name);
    } catch {
      meta = {};
    }
    results.push({ name, reasons: checkPackage(name, meta ?? {}, policy) });
  }
  return results;
}

// ---------------------------------------------------------------------------
// CLI wrapper (not exercised by unit tests except --help). Reads the vendored
// policy, diffs package.json + the lockfile between origin/<base> and HEAD, and
// exits 1 with ::error:: lines for every flagged package.
// ---------------------------------------------------------------------------

/**
 * Load the factory-vendored policy copy beside this script (never the PR tree).
 *
 * Fails LOUD (SEC-03 / CR-01): a missing or malformed vendored policy must throw a
 * diagnosable Error naming the resolved path — never an ambiguous unhandled ENOENT
 * / JSON-parse rejection that leaves the required check red-and-crashy. main()
 * catches this and turns it into a single `::error::` line + exit 1.
 */
export function loadVendoredPolicy() {
  // Vendored layout (set by Plan 06-07/06-08): this script lands at
  // .github/workflows/lib/dependency-gate.mjs and the policy one level up at
  // .github/workflows/dependency-policy.json — a fixed relative location, never
  // resolved from the PR's checkout root.
  const path = join(dirname(fileURLToPath(import.meta.url)), "..", "dependency-policy.json");
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    throw new Error(
      `dependency-policy.json could not be read at ${path} (${err.code || err.message}). ` +
        "This target was likely onboarded before SEC-03's policy vendoring landed — " +
        "re-run onboard-target.yml against this tenant to vendor the policy file.",
    );
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `dependency-policy.json at ${path} is not valid JSON (${err.message}). ` +
        "Re-run onboard-target.yml against this tenant to re-vendor a clean policy file.",
    );
  }
}

/** Parse `git diff` added lines of a package.json into new `{name}` entries. */
export function parseManifestAdditions(diffText) {
  const STOPLIST = new Set([
    "name", "version", "description", "main", "module", "types", "type",
    "scripts", "dependencies", "devDependencies", "peerDependencies",
    "optionalDependencies", "engines", "repository", "license", "author",
    "keywords", "files", "exports", "bin", "homepage", "bugs", "private",
  ]);
  const names = new Set();
  for (const line of diffText.split("\n")) {
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    // Added dependency entries look like: +    "pkg-name": "^1.2.3"
    const m = line.match(/^\+\s*"([^"]+)"\s*:\s*"[^"]*"\s*,?\s*$/);
    if (m && !STOPLIST.has(m[1])) names.add(m[1]);
  }
  return [...names].map((name) => ({ name }));
}

/** Parse `git diff` added lines of a lockfile into new `{name}` entries. */
export function parseLockfileAdditions(diffText) {
  const names = new Set();
  for (const line of diffText.split("\n")) {
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    // package-lock.json v3: +    "node_modules/pkg": { ... }
    let m = line.match(/^\+\s*"node_modules\/((?:@[^/]+\/)?[^"/]+)"\s*:/);
    if (m) { names.add(m[1]); continue; }
    // yarn.lock: +"pkg@^1.0.0", "pkg@~1.1.0":
    m = line.match(/^\+\s*"?((?:@[^/]+\/)?[^@"\s]+)@/);
    if (m) { names.add(m[1]); continue; }
    // pnpm-lock.yaml: +  /pkg@1.0.0:  or  +  '/pkg@1.0.0':
    m = line.match(/^\+\s*'?\/((?:@[^/]+\/)?[^@/]+)@/);
    if (m) { names.add(m[1]); continue; }
  }
  return [...names].map((name) => ({ name }));
}

function gitDiff(baseRef, pathspec) {
  try {
    return execFileSync(
      "git",
      ["diff", `origin/${baseRef}...HEAD`, "--", pathspec],
      { encoding: "utf8" },
    );
  } catch {
    return "";
  }
}

export async function main(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      [
        "Usage: node dependency-gate.mjs [--base <ref>]",
        "",
        "Diffs package.json + the lockfile between origin/<base> and HEAD and fails",
        "(exit 1) if any newly-added dependency violates the factory-vendored",
        "dependency-policy.json (license allowlist / age / download floor / typosquat).",
        "Base ref defaults to $BASE_REF or 'main'. Exit 0 when all new deps pass.",
      ].join("\n"),
    );
    return 0;
  }
  // No args is the vendored CI snippet's documented invocation (BASE_REF via env,
  // falling back to 'main') — it must run the gate, not print usage and exit 1.

  const baseIdx = args.indexOf("--base");
  const baseRef = baseIdx !== -1 ? args[baseIdx + 1] : process.env.BASE_REF || "main";

  // Fail LOUD, never crash-ambiguously (SEC-03 / CR-01): a missing/malformed
  // vendored policy becomes one diagnosable ::error:: line + exit 1, so the
  // returned promise is never rejected past the top-level .then(exit) below.
  let policy;
  try {
    policy = loadVendoredPolicy();
  } catch (err) {
    console.error(`::error::${err.message}`);
    return 1;
  }
  const manifestDiff = parseManifestAdditions(gitDiff(baseRef, "package.json"));
  const lockfiles = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"];
  let lockfileDiff = [];
  for (const lf of lockfiles) {
    lockfileDiff = lockfileDiff.concat(parseLockfileAdditions(gitDiff(baseRef, lf)));
  }

  const results = await checkDependencyDiff(manifestDiff, lockfileDiff, policy);
  const flagged = results.filter((r) => r.reasons.length > 0);
  if (flagged.length > 0) {
    for (const f of flagged) {
      console.error(`::error::dependency '${f.name}' rejected: ${f.reasons.join("; ")}`);
    }
    return 1;
  }
  console.log(`PASS: ${results.length} new dependency(ies) cleared the policy.`);
  return 0;
}

// CLI entry only when executed directly (not when imported by Vitest).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv).then((code) => process.exit(code));
}
