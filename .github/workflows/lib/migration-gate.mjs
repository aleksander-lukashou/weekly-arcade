#!/usr/bin/env node
// ENV-02 destructive-migration gate (plan 07-06, D-09 layer (a) / D-10 / D-12).
//
// The PR-time required check that scans a ticket PR's migration-file diff and
// blocks on any statement not PROVABLY additive-safe. It is a separate named
// required check from the test/coverage/lint/dependency gates (D-09): its CI
// job id `migration-gate` MUST equal the `requiredStatusCheck` of the same name
// in contracts/scaffold-gates.json — never a second hardcoded copy.
//
// Default-deny discipline (D-10): CREATE TABLE, CREATE INDEX, and a NULLABLE
// ADD COLUMN pass unflagged; DROP / TRUNCATE / RENAME / column-type change /
// ADD COLUMN ... NOT NULL (without a DEFAULT backfill) / ANYTHING the classifier
// cannot positively recognize all require approval. Unparseable is NOT safe.
//
// Anti-bypass (D-12): the policy — which files are migrations (`migrationsGlob`)
// and which bot identity may approve (`appBotLogin`) — is read from the
// FACTORY-VENDORED .github/factory-config.json beside this vendored script, never
// the PR's own tree (T-06-12 / T-07-09 precedent).
//
// Shape mirrors dependency-gate.mjs: pure, unit-testable functions
// (`classifyStatement`, `classifyMigrationFile`) exported separately from the
// `main(argv)` CLI wrapper (Task 2), guarded by the direct-invocation check at
// the bottom so Vitest can import the pure functions without triggering the CLI.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

/**
 * Classify a SINGLE SQL statement as additive-safe or requiring approval.
 *
 * DEFAULT-DENY (D-10): the function only ever returns `{safe: true}` from an
 * EXPLICIT additive allowlist branch. Every destructive keyword, every column
 * type/constraint mutation, and — critically — every statement the classifier
 * does not recognize returns `{safe: false, reason}`. There is NO else-branch
 * that yields `safe: true`; unparseable garble fails toward halt.
 *
 * A regex/prefix classifier is used deliberately over a full SQL parser
 * (RESEARCH recommendation): a parser that chokes on an exotic-but-destructive
 * statement would throw, and a naive catch would risk a silent pass. Matching a
 * fixed destructive keyword set and defaulting everything else to unsafe is the
 * fail-toward-halt property this gate needs.
 *
 * @param {string} sql
 * @returns {{safe: boolean, reason?: string}}
 */
export function classifyStatement(sql) {
  if (typeof sql !== "string") {
    return { safe: false, reason: "unrecognized statement — fail-toward-halt (D-10)" };
  }
  // Normalize: collapse all whitespace to single spaces, trim, uppercase for
  // keyword matching. Case-insensitive SQL keywords compared in one canonical form.
  const s = sql.replace(/\s+/g, " ").trim().toUpperCase();
  if (s === "") {
    // An empty statement carries no destructive action; callers filter blanks
    // before reaching here, but guard defensively.
    return { safe: true };
  }

  // --- Destructive keyword checks (any match => requires approval) ------------
  if (/\bDROP\b/.test(s)) {
    return { safe: false, reason: "DROP is destructive — requires approval (D-10)" };
  }
  if (/\bTRUNCATE\b/.test(s)) {
    return { safe: false, reason: "TRUNCATE removes all rows — requires approval (D-10)" };
  }
  if (/\bRENAME\b/.test(s)) {
    return {
      safe: false,
      reason: "RENAME breaks existing references — requires approval (D-10)",
    };
  }
  // Column type / constraint mutation: `ALTER COLUMN`, `SET DATA TYPE`, or an
  // ALTER statement carrying a bare TYPE keyword (e.g. `ALTER COLUMN x TYPE y`).
  // A nullable ADD COLUMN never contains the TYPE keyword (its datatype token —
  // TEXT, INTEGER — is not the word TYPE), so this does not catch safe adds.
  if (
    /\bALTER\s+COLUMN\b/.test(s) ||
    /\bSET\s+DATA\s+TYPE\b/.test(s) ||
    (/\bALTER\b/.test(s) && /\bTYPE\b/.test(s))
  ) {
    return {
      safe: false,
      reason: "column TYPE/constraint change — requires approval (D-10)",
    };
  }
  // ADD COLUMN ... NOT NULL WITHOUT a DEFAULT is an unsafe backfill (rewrites the
  // table / fails on existing rows). WITH a DEFAULT it is a safe backfill and is
  // allowed to fall through to the additive allowlist below.
  if (/\bADD\s+COLUMN\b/.test(s) && /\bNOT\s+NULL\b/.test(s) && !/\bDEFAULT\b/.test(s)) {
    return {
      safe: false,
      reason: "ADD COLUMN ... NOT NULL without a DEFAULT backfill — requires approval (D-10)",
    };
  }

  // --- Additive-safe allowlist (the ONLY paths to safe: true) ----------------
  if (/^CREATE\s+TABLE\b/.test(s)) return { safe: true };
  if (/^CREATE\s+(UNIQUE\s+)?INDEX\b/.test(s)) return { safe: true };
  // A nullable ADD COLUMN (NOT NULL variants were already handled above).
  if (/\bADD\s+COLUMN\b/.test(s)) return { safe: true };

  // --- Default-deny: anything unrecognized is unsafe (NEVER safe: true) ------
  return { safe: false, reason: "unrecognized statement — fail-toward-halt (D-10)" };
}

/**
 * Classify a whole migration file. Splits `content` into statements on `;`,
 * discards blank lines and full-line `--` comments, and classifies each
 * remaining statement. The file is `flagged` iff ANY statement is unsafe.
 *
 * @param {string} path  migration file path (used only for human-readable reasons)
 * @param {string} content raw SQL text
 * @returns {{flagged: boolean, reasons: string[]}}
 */
export function classifyMigrationFile(path, content) {
  const raw = String(content ?? "");
  const reasons = [];
  for (const chunk of raw.split(";")) {
    // Strip blank lines and full-line `--` comments; keep the rest of a statement
    // that may legitimately span multiple lines.
    const cleaned = chunk
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("--"))
      .join(" ")
      .trim();
    if (cleaned === "") continue;
    const verdict = classifyStatement(cleaned);
    if (!verdict.safe) {
      reasons.push(`${path}: ${verdict.reason} — "${cleaned.slice(0, 80)}"`);
    }
  }
  return { flagged: reasons.length > 0, reasons };
}

/**
 * Resolve the vendored policy path from this script's own location.
 *
 * CRITICAL — TWO levels up, NOT one. migration-gate.mjs is vendored to
 * `.github/workflows/lib/migration-gate.mjs`, but factory-config.json lives at
 * `.github/factory-config.json` — one directory ABOVE `.github/workflows/`. From
 * `lib/` that is `lib/` → `workflows/` → `.github/`, i.e. two `".."` segments.
 * Using only one `".."` (dependency-gate.mjs's own sibling-policy pattern)
 * resolves to the NON-EXISTENT `.github/workflows/factory-config.json` and
 * throws on EVERY PR — the #1 way to make ENV-02's gate permanently red.
 *
 * Factored out (not inlined into loadVendoredPolicy) so the two-levels-up
 * traversal is directly unit-testable against a stubbed vendored URL.
 *
 * @param {string} metaUrl a file:// URL (import.meta.url) of the running script
 * @returns {string} absolute path to the vendored factory-config.json
 */
export function resolvePolicyPath(metaUrl) {
  return join(dirname(fileURLToPath(metaUrl)), "..", "..", "factory-config.json");
}

/**
 * Load the factory-vendored policy beside this script (never the PR tree).
 *
 * Fails LOUD (mirrors dependency-gate.mjs's loadVendoredPolicy): a missing or
 * malformed vendored config throws a diagnosable Error naming the resolved path —
 * never an ambiguous unhandled ENOENT / JSON-parse rejection. `main()` (Task 2)
 * catches this and turns it into a single `::error::` line + exit 1.
 *
 * Returns the parsed config with `migrationsGlob` defaulted to the scaffold
 * default `"migrations/**\/*.sql"` (D-12) when the field is absent, and
 * `appBotLogin` passed through for the Task 2 author-verified approval check.
 *
 * @returns {{migrationsGlob: string, appBotLogin?: string, [k: string]: unknown}}
 */
export function loadVendoredPolicy() {
  const path = resolvePolicyPath(import.meta.url);
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    throw new Error(
      `factory-config.json could not be read at ${path} (${err.code || err.message}). ` +
        "This target was likely onboarded before ENV-02's migration gate landed — " +
        "re-run onboard-target.yml against this tenant to vendor the config file.",
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `factory-config.json at ${path} is not valid JSON (${err.message}). ` +
        "Re-run onboard-target.yml against this tenant to re-vendor a clean config file.",
    );
  }
  if (typeof parsed.migrationsGlob !== "string") {
    parsed.migrationsGlob = "migrations/**/*.sql";
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Machine-block IO. Byte-for-byte the same anchor convention the orchestrator's
// machine-block.ts establishes (<!-- factory:state:v1 --> / <!-- /factory:state
// -->), reproduced here WITHOUT a js-yaml dependency: the fields this gate reads
// and writes are flat key:value pairs (no nesting), so a hand-rolled
// parser/renderer keeps the vendored plumbing dependency-free.
// ---------------------------------------------------------------------------

/** Opening anchor comment (matches orchestrator/src/github/machine-block.ts). */
export const OPEN_ANCHOR = "<!-- factory:state:v1 -->";
/** Closing anchor comment. */
export const CLOSE_ANCHOR = "<!-- /factory:state -->";

/**
 * Render a flat machine block. Keys are emitted in insertion order.
 * @param {Record<string, string|number>} fields
 * @returns {string}
 */
export function renderMachineBlock(fields) {
  const lines = Object.entries(fields).map(([k, v]) => `${k}: ${v}`);
  return `${OPEN_ANCHOR}\n\`\`\`yaml\n${lines.join("\n")}\n\`\`\`\n${CLOSE_ANCHOR}`;
}

/**
 * Extract EVERY anchored flat machine block from `text`. Anchors are located by
 * literal indexOf (never a regex over attacker-influenceable comment text). A
 * malformed / unclosed block is skipped, never partially trusted.
 * @param {string} text
 * @returns {Array<Record<string, string>>}
 */
export function extractMachineBlocks(text) {
  const blocks = [];
  if (typeof text !== "string") return blocks;
  let idx = 0;
  for (;;) {
    const start = text.indexOf(OPEN_ANCHOR, idx);
    if (start === -1) break;
    const end = text.indexOf(CLOSE_ANCHOR, start + OPEN_ANCHOR.length);
    if (end === -1) break;
    let body = text.slice(start + OPEN_ANCHOR.length, end);
    idx = end + CLOSE_ANCHOR.length;
    // Strip the ```yaml fence if present; tolerate a bare block too.
    const fenceOpen = body.indexOf("```yaml");
    if (fenceOpen !== -1) {
      const afterOpen = fenceOpen + "```yaml".length;
      const fenceClose = body.indexOf("```", afterOpen);
      if (fenceClose === -1) continue;
      body = body.slice(afterOpen, fenceClose);
    }
    const obj = {};
    for (const line of body.split("\n")) {
      const t = line.trim();
      if (t === "") continue;
      const m = t.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (m) obj[m[1]] = m[2];
    }
    if (Object.keys(obj).length > 0) blocks.push(obj);
  }
  return blocks;
}

/**
 * True iff `comments` contains an author-verified `migration-approved` block for
 * this exact file+hash. The author check is SECURITY-CRITICAL (T-07-07): only a
 * comment whose GitHub-authenticated `user.login` equals the factory bot's
 * `appBotLogin` counts. A comment from ANY other identity — including the PR's
 * own author — is structurally ignored, never trusted on body text alone.
 * @param {Array<{body?: string, user?: {login?: string}}>} comments
 * @param {string} appBotLogin
 * @param {string} file
 * @param {string} hash
 * @returns {boolean}
 */
export function hasAuthorVerifiedApproval(comments, appBotLogin, file, hash) {
  if (!appBotLogin) return false; // no trusted identity => nothing can approve
  for (const c of comments ?? []) {
    if (!c || !c.user || c.user.login !== appBotLogin) continue;
    for (const b of extractMachineBlocks(c.body || "")) {
      if (b.kind === "migration-approved" && b.file === file && b.hash === hash) {
        return true;
      }
    }
  }
  return false;
}

/**
 * True iff a `migration-flag` block for this exact file+hash was already posted
 * on the PR (idempotency — avoid duplicate-comment spam on repeated pushes).
 * @param {Array<{body?: string}>} comments
 * @param {string} file
 * @param {string} hash
 * @returns {boolean}
 */
export function alreadyFlagged(comments, file, hash) {
  for (const c of comments ?? []) {
    for (const b of extractMachineBlocks((c && c.body) || "")) {
      if (b.kind === "migration-flag" && b.file === file && b.hash === hash) return true;
    }
  }
  return false;
}

/**
 * Translate a shell glob (`migrations/**\/*.sql`) into an anchored RegExp.
 * `**` matches across directory separators; a single `*` matches within one
 * path segment. Deliberately dependency-free, consistent with the rest of the
 * vendored plumbing.
 * @param {string} glob
 * @returns {RegExp}
 */
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*"; // ** => any chars incl. /
        i++;
        if (glob[i + 1] === "/") i++; // consume the trailing slash of **/
      } else {
        re += "[^/]*"; // * => within one segment
      }
    } else if (".+^${}()|[]\\".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$");
}

// ---------------------------------------------------------------------------
// CLI wrapper (not exercised by unit tests except --help). Diffs migration files
// between the base ref and HEAD, classifies them, honours author-verified
// approvals, posts migration-flag comments for unapproved destructive files, and
// exits 1 with ::error:: lines.
// ---------------------------------------------------------------------------

const USAGE = [
  "Usage: node migration-gate.mjs [--base <ref>]",
  "",
  "Scans the migration files changed between origin/<base> and HEAD (which files",
  "count is read from the factory-vendored factory-config.json migrationsGlob) and",
  "fails (exit 1) if any statement is not provably additive-safe (DROP / TRUNCATE /",
  "RENAME / column type change / ADD COLUMN ... NOT NULL without DEFAULT / anything",
  "unparseable — D-10 default-deny). A flagged file passes only once an",
  "author-verified `migration-approved` machine block (authored by the factory",
  "bot's appBotLogin) for its exact file+hash exists on the PR. Base ref defaults",
  "to $BASE_REF or 'main'.",
].join("\n");

/** Run `git diff --name-only <base>...HEAD`, trying origin/<base> then <base>. */
function gitDiffNames(baseRef) {
  for (const base of [`origin/${baseRef}`, baseRef]) {
    try {
      const out = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], {
        encoding: "utf8",
      });
      return out.split("\n").map((l) => l.trim()).filter(Boolean);
    } catch {
      /* try the next candidate base */
    }
  }
  return [];
}

/** Read the current PR's comments via gh api (empty array on any failure). */
function readPRComments(repo, prNumber) {
  try {
    const out = execFileSync(
      "gh",
      ["api", `repos/${repo}/issues/${prNumber}/comments`, "--paginate"],
      { encoding: "utf8" },
    );
    const parsed = JSON.parse(out);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return []; // fail-closed: unreadable comments => no approvals found
  }
}

/** Post a migration-flag machine block on the PR (best-effort). */
function postFlag(prNumber, file, hash, reasons) {
  const block = renderMachineBlock({ factory: 1, kind: "migration-flag", file, hash });
  const body =
    "**Destructive migration flagged** — this migration is not provably additive-safe " +
    "and requires factory approval before it can merge (ENV-02, D-10):\n\n" +
    reasons.map((r) => `- ${r}`).join("\n") +
    `\n\n${block}`;
  try {
    execFileSync("gh", ["pr", "comment", String(prNumber), "--body", body], {
      encoding: "utf8",
    });
  } catch {
    /* posting is best-effort; the ::error:: line + exit 1 still fail the gate */
  }
}

/** sha256 of a migration file's current content, prefixed `sha256:`. */
function fileHash(content) {
  return "sha256:" + createHash("sha256").update(content).digest("hex");
}

export async function main(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return 0;
  }
  // No args is the vendored CI snippet's documented invocation (BASE_REF via env,
  // falling back to 'main') — it must RUN the gate, not usage-bail (the
  // dependency-gate UAT regression: habit-tracker PR #32).

  const baseIdx = args.indexOf("--base");
  const baseRef = baseIdx !== -1 ? args[baseIdx + 1] : process.env.BASE_REF || "main";

  // Fail LOUD, never crash-ambiguously: a missing/malformed vendored config
  // becomes one diagnosable ::error:: line + exit 1.
  let policy;
  try {
    policy = loadVendoredPolicy();
  } catch (err) {
    console.error(`::error::${err.message}`);
    return 1;
  }

  const matcher = globToRegExp(policy.migrationsGlob || "migrations/**/*.sql");
  const changed = gitDiffNames(baseRef).filter((f) => matcher.test(f));

  // D-12: a PR touching no matching migration files passes trivially.
  if (changed.length === 0) {
    console.log("PASS: no migration files changed in this PR.");
    return 0;
  }

  const flaggedFiles = [];
  for (const file of changed) {
    let content = "";
    try {
      content = readFileSync(file, "utf8");
    } catch {
      content = ""; // deleted file => no statements => not flagged
    }
    const { flagged, reasons } = classifyMigrationFile(file, content);
    if (flagged) flaggedFiles.push({ file, hash: fileHash(content), reasons });
  }

  if (flaggedFiles.length === 0) {
    console.log(`PASS: ${changed.length} migration file(s) are all additive-safe.`);
    return 0;
  }

  // Some files are destructive — check for author-verified approvals (D-11).
  const repo = process.env.GITHUB_REPOSITORY || "";
  const prNumber = process.env.PR_NUMBER || "";
  const comments = repo && prNumber ? readPRComments(repo, prNumber) : [];

  const stillUnapproved = flaggedFiles.filter(
    (f) => !hasAuthorVerifiedApproval(comments, policy.appBotLogin, f.file, f.hash),
  );

  if (stillUnapproved.length === 0) {
    console.log(
      `PASS: all ${flaggedFiles.length} destructive migration(s) carry an ` +
        "author-verified migration-approved block.",
    );
    return 0;
  }

  for (const f of stillUnapproved) {
    // Idempotent flag posting: only comment if this exact file+hash isn't flagged yet.
    if (prNumber && !alreadyFlagged(comments, f.file, f.hash)) {
      postFlag(prNumber, f.file, f.hash, f.reasons);
    }
    console.error(
      `::error::migration '${f.file}' requires approval: ${f.reasons.join("; ")}`,
    );
  }
  return 1;
}

// CLI entry only when executed directly (not when imported by Vitest).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv).then((code) => process.exit(code));
}
