# PRD: Visual Quality & Issue-Driven Fix Loop

_Discovery slug: `visual-quality-fix-loop`_

---

## Problem & Users

**Who has the problem:** The sole operator (aleksander-lukashou) runs a Weekly Arcade site that generates a new browser game each week using a Kaboom.js pipeline deployed to GitHub Pages. Games are auto-shipped with no visual review gate. The operator and occasional visitors occasionally notice quality problems after games go live.

**How they cope today:** Visual issues are caught by ad-hoc play (either by the operator or by someone who happens to share or play a game). There is no review step before publish, and historically only one game has been generated, so patterns are still forming.

**Core pain:**
1. Generated games can produce flat, unrecognizable shapes — objects do not look like what they are supposed to represent, breaking the "tell a story from the news" goal.
2. When a post-ship bug or visual issue is found, there is no structured fix workflow; bugs must be fixed manually or not at all.

---

## Goals / Non-Goals

### Goals (v1 scope)
- Add an AI-driven visual-quality review step so every new game is evaluated before (or immediately after) it goes live, and low-quality output triggers a fix workflow automatically.
- Provide an issue-driven fix loop: a human (operator only) labels a GitHub issue `game-fix` to request an automated fix for any game file in the repo.
- The fix agent opens a PR, CI must pass, and the PR is auto-merged. Up to 4 automated fix attempts are allowed per issue before escalating to a human.

### Non-Goals (v1)
- Retroactive visual upgrades to already-shipped games — only new games generated after this work ships are in scope.
- Switching away from Kaboom.js or GitHub Pages hosting.
- Opening `game-fix` issues programmatically; that remains a human-triggered, operator-only action.
- Rate-limiting or cost controls on parallel issue handling.

---

## Functional Requirements

**Visual quality review**

| # | Requirement |
|---|-------------|
| FR-1 | After each new game is generated, an AI agent reviews the game's visual output and assesses whether key objects are recognizable (i.e., not just flat shapes). |
| FR-2 | The review agent is grounded in the game's news-research context so it can judge whether the visual objects communicate the story. |
| FR-3 | If the review agent determines visual quality is insufficient, it automatically initiates the fix workflow (same as a `game-fix` issue trigger). |
| FR-4 | The review applies only to games generated after this feature ships; existing games are not touched. |

**Issue-driven fix loop**

| # | Requirement |
|---|-------------|
| FR-5 | A GitHub issue labeled `game-fix` by the operator triggers the fix agent. Only the operator (repo owner) may apply the `game-fix` label. |
| FR-6 | The fix agent may target any game file in the repository (not only the most recent one). |
| FR-7 | The fix agent opens a pull request with the corrected game file. |
| FR-8 | The PR must pass existing CI checks (lint, deploy) before it can merge. |
| FR-9 | Once CI passes, the PR is auto-merged without requiring human approval. |
| FR-10 | If a fix attempt results in a still-failing or still-unresolved state, the agent retries. A maximum of **4 automated fix attempts** are allowed per issue. |
| FR-11 | After 4 failed attempts, the fix loop stops and escalates to a human (e.g., comments on the issue and removes or replaces the label to prevent re-triggering). |

---

## Non-Functional Requirements

| # | Requirement |
|---|-------------|
| NFR-1 | **Platform:** All game files are Kaboom.js + static HTML with inline (data-URI) assets; the fix agent must produce output conforming to this format. |
| NFR-2 | **Asset format:** No file-size limit is imposed; all assets remain inline (no external URLs). |
| NFR-3 | **Hosting:** GitHub Pages — no change to deploy target. |
| NFR-4 | **CI gate:** Only the existing CI checks (lint, deploy) must pass; no new checks are added by this work. |
| NFR-5 | **Turnaround:** A `game-fix` issue labeled by the operator should result in an open, CI-passing PR within a few hours. |
| NFR-6 | **Game type constraint:** Weekly Arcade only produces arcade games; text-quiz or word-game exceptions are out of scope. Pixel-art sprites and particle effects are appropriate for all in-scope game types. |

---

## Success Criteria

| # | Criterion |
|---|-----------|
| SC-1 | In the very next game generated after this work ships, the key objects (characters, items, enemies) are immediately recognizable as the things they represent, consistent with the game's news-research theme. |
| SC-2 | When a `game-fix` issue is labeled, a PR is opened and CI is passing within a few hours of the label being applied. |
| SC-3 | A failed fix attempt is defined as: the fix agent exhausts all 4 attempts without producing a PR that passes CI and stays green — at that point the issue is flagged for human intervention. |

---

## Open Questions

1. **Visual review trigger timing:** Should the AI visual review run as a post-generate step within the same workflow run, or as a separate workflow triggered on the generated file? This affects how quickly a low-quality game can be caught before the Pages deploy completes.
2. **Review scoring rubric:** "Recognizable objects that tell a story" is the stated bar. The agent will need a concrete rubric (e.g., screenshotting the game, running it against a vision model). The mechanism for capturing a screenshot in CI is not specified in the answers.
3. **`game-fix` label permission enforcement:** GitHub labels can be applied by anyone with triage access. The answer says only the operator may apply the label; the enforcement mechanism (CODEOWNERS, a validation step in the workflow, or trust-based) needs to be decided at implementation time.
4. **Fix attempt counting:** Where is the attempt count stored across multiple workflow runs? (Issue comment count, a label, or a separate tracking comment.) This should be resolved before implementation.
