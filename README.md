# Weekly Arcade

One new tiny browser game every week — researched, designed, built, and shipped by an AI agent. Standalone: everything lives in this repo.

Every Monday, the `weekly-game` agentic workflow ([gh-aw](https://github.com/github/gh-aw), `.github/workflows/weekly-game.md`):

1. Reads the week's world headlines (BBC / NPR / Guardian RSS).
2. Picks one light, quirky, non-tragic story.
3. Designs and builds a short 2D game riffing on it — [Kaboom.js](https://kaboomjs.com) (vendored at `lib/kaboom.js`), original art and names only.
4. Opens a `[weekly-game]` pull request adding the game under `games/` and registering it in `games/manifest.json`.

When CI passes, the PR auto-merges and GitHub Pages redeploys the arcade.

## Content rules

- Topical, playful, kind. Never tragedies, disasters, wars, or divisive politics.
- Mechanics may homage the classics; art, names, and characters are always original.
- No real person's name or likeness as a game subject.

## Structure

- `index.html` — the arcade shell; lists every game from `games/manifest.json`
- `games/<yyyy>-w<ww>-<slug>/` — one folder per game (`index.html` + `game.js`)
- `lib/kaboom.js` — vendored Kaboom 3000.1.17 (single file, no CDN, no npm deps)
- `.github/workflows/weekly-game.md` — the authored agent workflow (compiled `.lock.yml` is what runs; recompile with `gh aw compile` after editing)
- `.github/workflows/ci.yml` — validates the manifest and syntax-checks every game
- `.github/workflows/weekly-automerge.yml` — merges green `[weekly-game]` PRs
- `.github/workflows/pages.yml` — deploys the site to GitHub Pages on every push to `main`

## Required repo secrets

- `COPILOT_GITHUB_TOKEN` — PAT of a Copilot-enabled account (runs the agent engine)
- `GH_AW_GITHUB_TOKEN` — fine-grained PAT (this repo; contents + pull-requests read/write) used to open the weekly PR and to merge it, so those events trigger CI and the Pages deploy (the default `GITHUB_TOKEN` deliberately doesn't trigger downstream workflows)
