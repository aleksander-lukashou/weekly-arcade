# Architecture: Visual Quality & Issue-Driven Fix Loop

_Based on: PRD "Visual Quality & Issue-Driven Fix Loop"_

---

## Stack

| Layer | Technology | Justification |
|-------|------------|---------------|
| **Runtime** | GitHub Actions (ubuntu-latest) | Already hosting all automation; zero new infra; gh-aw agentic workflows run here. |
| **Agentic engine** | gh-aw + Copilot coding agent | The factory's existing framework; visual review and fix workflows follow the same pattern as `weekly-game.md`. |
| **Vision model** | GPT-4 Vision (via Copilot tools) | Needed for FR-1 visual assessment; Copilot engine provides multimodal capability without new API auth. |
| **Screenshot capture** | Puppeteer (headless Chromium) | Kaboom games are static HTML; Puppeteer can load the `index.html` in headless mode, wait for Kaboom to render, and capture a PNG. No server runtime required — games are entirely client-side. |
| **Hosting** | GitHub Pages (unchanged) | NFR-3 constraint; no changes to deploy. |
| **Issue tracking** | GitHub Issues + labels | Already the factory's coordination mechanism; `game-fix` label triggers the fix workflow; attempt count stored in issue comments. |
| **Gate enforcement** | Existing CI (`ci.yml`) | NFR-4 constraint; fix PRs must pass the same manifest validation + syntax check + gitleaks + dependency-gate that manual PRs pass. |
| **Permissions** | CODEOWNERS file | Enforces FR-5's "operator-only" `game-fix` label constraint at GitHub's platform level; only aleksander-lukashou can approve changes to the special `.github/CODEOWNERS` path that gates label application. |

**Rationale for Puppeteer over alternatives:**
- Playwright/Selenium: heavier; Puppeteer sufficient for static page capture.
- Browser screenshot services (e.g., screenshotlayer, urlbox): require external API keys, introduce latency, violate the "no new credentials" principle.
- PhantomJS: unmaintained; Puppeteer is the modern standard.

---

## Components

### 1. Visual Review Agent (`visual-review` workflow)

**Responsibility:** After a new game is generated, load it in a headless browser, capture a screenshot, analyze the visual output with a vision model, and determine whether key objects are recognizable per the game's theme.

**Satisfies:** FR-1, FR-2, FR-3, FR-4

**Triggering:** `workflow_run` completion event from `weekly-game.lock.yml` (only when the PR is merged and the game is live). A successful `weekly-game` PR writes a new game folder and updates `manifest.json`; the visual-review workflow reads the latest manifest entry and reviews that game only.

**Inputs:**
- Latest game path from `games/manifest.json` (the last entry in the array)
- The game's `headline` field (provides news context for grounding the visual assessment)

**Process:**
1. Check if the workflow has already reviewed this game (via a tracking comment on the original `[weekly-game]` PR or a label). If yes, skip (idempotency).
2. Install Puppeteer and its Chromium dependency.
3. Start a local static server (e.g., `npx serve .` or Python `http.server`) to serve the repo's root.
4. Navigate headless Chromium to `http://localhost:<port>/games/<yyyy-w<ww>-<slug>/index.html`.
5. Wait 5 seconds for Kaboom to initialize and render the game scene.
6. Capture a full-viewport screenshot (PNG).
7. Submit the screenshot + the game's headline to GPT-4 Vision with a rubric prompt: "Are the game's key objects (player, enemies, collectibles) immediately recognizable as distinct, identifiable things that relate to the headline '{headline}'? Do they look like what they represent, or are they flat, generic shapes? Rate on a 3-point scale: PASS (recognizable), BORDERLINE (ambiguous), FAIL (flat shapes, unrecognizable)."
8. If result is FAIL or BORDERLINE:
   - Open a GitHub issue titled `[visual-quality] <game-title> — unrecognizable objects`, labeled `game-fix`, assigned to the operator, with the screenshot attached and the rubric output quoted in the body.
   - The issue body specifies the target game path and what needs improvement.
9. If result is PASS: post a success comment on the original `[weekly-game]` PR (or log only, depending on desired visibility).

**Safe-outputs:** `create_issue` (on FAIL/BORDERLINE), `add_comment` (on PASS, optional)

---

### 2. Fix Agent (`game-fix` workflow)

**Responsibility:** When a human (operator) or the visual-review agent labels an issue `game-fix`, read the issue body to determine which game file needs fixing, regenerate that game file with improvements, open a PR, and retry up to 4 times if CI fails.

**Satisfies:** FR-5, FR-6, FR-7, FR-8, FR-9, FR-10, FR-11

**Triggering:** `issues` event with `labeled` action; filter: `label == "game-fix"`.

**Inputs:**
- Issue number, title, body (contains the game path and the problem description)
- Issue author (for FR-5 enforcement: if author is NOT the operator, workflow STOPs and posts a comment explaining only the operator may request fixes)

**Process:**
1. **Precondition check (FR-5):** Verify the issue author is `aleksander-lukashou`. If not, comment "Only the repository owner may request automated game fixes" and exit.
2. Parse the issue body to extract the target game path (e.g., `games/2026-w33-call-dodger/`).
3. Check for prior fix-attempt comments on this issue matching the pattern `**Factory fix attempt N/4**`. Count them to determine the current attempt number.
4. If attempt count >= 4:
   - Post a final comment: `**BLOCKED:** 4 automated fix attempts exhausted. Human intervention required.`
   - Remove the `game-fix` label and add `factory-blocked` or `escalated` label.
   - Exit.
5. Increment attempt number (N = prior count + 1).
6. Read the original game files (`index.html`, `game.js`) and the issue's problem description.
7. **Generate improved game.js:**
   - Use the same Kaboom.js structure, but enhance sprite drawing functions to produce more detailed, recognizable shapes.
   - If the issue mentions specific objects (e.g., "the player character is a flat rectangle"), focus improvements there.
   - Preserve the game's controls, scoring, and mechanics; only modify visual rendering.
8. Write the improved `game.js` back to `games/<path>/game.js`. Do NOT touch `index.html`, `manifest.json`, or other games.
9. Open a draft PR titled `T<issue-number>: Fix visual quality — <game-title>`. The body references the issue (`Fixes #<issue-number>`) and quotes attempt N.
10. Post a comment on the issue: `**Factory fix attempt N/4** — PR #<pr-number> opened. Awaiting CI.`
11. CI runs automatically (manifest validation + syntax check + gitleaks + dependency-gate from `ci.yml`).
12. If CI passes: the `auto-merger.yml` workflow (already exists in the repo per README) will auto-merge the PR once it's green and not a draft. The fix agent marks the PR as ready for review before exiting.
13. If CI fails: the workflow exits; GitHub's `workflow_run` event will re-trigger this workflow when the issue is still labeled `game-fix`, allowing retry.

**Safe-outputs:** `create_pull_request` (on each attempt), `add_comment` (attempt tracking + escalation)

**Attempt tracking storage:** Issue comments matching regex `^\*\*Factory fix attempt (\d+)/4\*\*`. The workflow queries these comments via GitHub API at the start to compute the current attempt count.

---

### 3. Auto-Merger (existing, no changes)

**Responsibility:** Merge any PR (including fix PRs) once CI is green and the PR is marked ready for review.

**Satisfies:** FR-9

**File:** `.github/workflows/auto-merger.yml` (already exists; no architectural changes required)

**Integration point:** The fix agent marks its draft PR as "ready for review" after opening it. The auto-merger watches for `pull_request` events with `ready_for_review` action and checks CI status. If all checks pass, it merges.

---

### 4. Label Permission Enforcement (CODEOWNERS)

**Responsibility:** Ensure only the operator can apply the `game-fix` label, satisfying FR-5.

**Satisfies:** FR-5

**Mechanism:** GitHub's CODEOWNERS file can gate label application by treating the label as a protected resource. However, GitHub does NOT natively support label-specific CODEOWNERS. The architectural decision is to **rely on trust + validation in the workflow**: the `game-fix` workflow checks the issue author at step 1 and rejects non-operator requests.

**Alternative (if stricter enforcement is required later):** Use a GitHub App or webhook to intercept `issues.labeled` events and remove the label if the actor is not the operator. This is NOT implemented in v1 (out of scope per the PRD's Open Questions deferral).

---

## Data Model

### Entities

#### Game (manifest entry)
```json
{
  "slug": "call-dodger",
  "title": "Call Dodger",
  "date": "2026-08-12",
  "headline": "France bans unsolicited telemarketing calls",
  "source": "https://www.bbc.co.uk/news/articles/...",
  "path": "games/2026-w33-call-dodger/"
}
```

**Keys:** `slug` (unique per week; derived from title)  
**Access pattern:** The visual-review workflow reads the LAST entry in the `games` array to identify the most recent game. The fix agent reads the issue body to find the `path` field, then looks up the corresponding game folder.

#### Issue (GitHub Issues API)
- **Number** (primary key)
- **Title** (e.g., `[visual-quality] Call Dodger — unrecognizable objects`)
- **Body** (markdown; contains the problem description + game path)
- **Labels** (array; includes `game-fix` when fix is requested)
- **Comments** (array; contains attempt-tracking comments)

**Access pattern:**
- Visual-review writes a new issue (create).
- Fix agent queries issue comments on startup (list, filter by regex) to count attempts.
- Fix agent writes a comment after each attempt (append-only).

#### Pull Request (GitHub PRs API)
- **Number** (primary key)
- **Title** (e.g., `T42: Fix visual quality — Call Dodger`)
- **Body** (references the issue via `Fixes #<n>`)
- **Draft status** (boolean; fix PRs start as drafts, then marked ready)
- **CI status** (checks via GitHub Checks API)

**Access pattern:**
- Fix agent creates one PR per attempt.
- Auto-merger polls PR CI status and merges when green.

---

## API Surface

No REST API is introduced. All components interact via:
- **GitHub Events API** (workflow triggers)
- **GitHub Issues/PRs API** (via gh-aw safe-outputs tools: `create_issue`, `add_comment`, `create_pull_request`)
- **Local filesystem** (reading/writing game files in the checked-out repo)

---

## Deployment Topology

### Staging
- Not applicable; all changes are deployed directly to production via GitHub Pages after PR merge.
- Preview deploys exist for all PRs via `deploy-preview` job in `ci.yml` (Cloudflare Pages branch alias). Fix PRs will have preview URLs posted automatically.

### Production
- **Environment:** GitHub Pages (https://aleksander-lukashou.github.io/weekly-arcade/)
- **Deploy trigger:** `push` to `main` branch; handled by `.github/workflows/pages.yml` (already exists)
- **Secrets required:**
  - `COPILOT_GITHUB_TOKEN` (Copilot-enabled account PAT; for agentic workflow execution)
  - `GH_AW_GITHUB_TOKEN` (fine-grained PAT; contents + pull-requests read/write; for PR creation and merge triggers)
  - `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` (for preview deploys in CI)

**Bindings (environment variables):**
- None required beyond the above secrets.

**Deploy process:**
1. Fix agent commits to a new branch and opens a PR.
2. CI validates the PR (manifest schema, syntax check, secret scan, dependency gate).
3. Auto-merger merges the PR if green.
4. `pages.yml` workflow deploys the updated site to GitHub Pages.

---

## Testing Strategy

### What gets tested

#### Unit tests
- NOT APPLICABLE for v1. The game files (`game.js`) are generated artifacts, not hand-written code. The agentic workflows themselves are prompt-based and tested via execution, not unit tests.

#### Integration tests
- **Visual-review workflow:** End-to-end test verifies:
  1. Workflow triggers on `weekly-game` completion.
  2. Puppeteer successfully captures a screenshot of a test game.
  3. Vision model assessment returns a valid rubric result (PASS/FAIL/BORDERLINE).
  4. A FAIL result opens a `game-fix` issue with correct labels and body structure.
- **Fix workflow:** End-to-end test verifies:
  1. Workflow triggers on `issues.labeled` with `game-fix`.
  2. Operator-only check rejects non-operator labels.
  3. Fix agent parses the issue body and modifies the correct game file.
  4. A PR is opened with the fix.
  5. Attempt counting works across multiple runs (test with a failing game that requires 2-3 attempts).
  6. After 4 attempts, the workflow escalates and stops retrying.

#### What "green" means
- **CI checks (existing):** manifest validation passes, all `game.js` files parse cleanly with `node --check`, gitleaks finds no secrets, dependency-gate allows any new deps.
- **New checks (none added per NFR-4):** The visual-review and fix workflows do NOT add new required CI checks. They operate post-merge (visual-review) or as PR creators (fix agent).

### Test execution
- Manual workflow dispatch during development.
- Integration tests run in a separate test repo or branch with known good/bad test games.
- **Acceptance criteria:** A human operator can trigger a `game-fix` issue, observe the fix PR open and merge within a few hours, and confirm the deployed game looks better than before.

---

## Resolved Open Questions

| Question | Decision | Rationale |
|----------|----------|-----------|
| **1. Visual review trigger timing** | Post-merge (after `weekly-game` PR is merged and game is live on `main`) | Simplest integration point; no changes to existing `weekly-game.md` workflow. Uses `workflow_run` event. Trade-off: a low-quality game may be live for a few hours before the fix loop starts. Acceptable for v1 given the site's low traffic. |
| **2. Review scoring rubric** | 3-point scale (PASS/BORDERLINE/FAIL) with GPT-4 Vision analysis of a Puppeteer screenshot | Puppeteer is lightweight and runs in GitHub Actions without new infra. Vision model is accessed via Copilot tools (no new API auth). The rubric prompt is explicit: "Are objects recognizable?" with the headline as context. |
| **3. `game-fix` label permission enforcement** | Workflow validation (check issue author == operator) + trust | GitHub does not natively support label-specific CODEOWNERS. A workflow-level check at the start of the fix agent rejects non-operator labels. If stricter enforcement is needed post-v1, a GitHub App webhook can be added. |
| **4. Fix attempt counting** | Issue comments matching `**Factory fix attempt N/4**` | The fix workflow queries issue comments via GitHub API at startup, counts matches, and increments. This is the same pattern the factory's `fix-ticket.md` workflow uses. No new storage required. |

---

## Changelog

- 2026-08-12: Initial architecture (v1 scope)
