# Discovery: Visual Quality & Issue-Driven Fix Loop

## Problem & User

1. Who currently looks at the weekly game output and decides whether its visuals are "good enough" — is that you (the operator), a specific audience, or nobody reviews it before it goes live?

> Answer:

2. Describe the last time you felt a generated game looked bad. What specifically made it look bad (flat shapes, no animation, wrong colors, something else)?

> Answer:

3. When a game goes live with a bug or visual issue, how is that currently discovered — do you play every game yourself, or does someone else find it and tell you?

> Answer:

4. How many times in the past three months has a shipped game had a problem worth fixing? Were any of those fixes actually applied?

> Answer:

5. Does anyone other than you currently interact with the Weekly Arcade games (e.g., share links, embed them, stream them)? How do you know?

> Answer:

---

## Scope

1. Should the visual upgrade apply retroactively to already-shipped games, or only to games generated after the change goes live?

> Answer:

2. For the fix loop: should the workflow be able to fix any game file in the repo, or only the most recently generated one?

> Answer:

3. Are there game types or topics for which pixel-art sprites and particle effects would be clearly wrong or awkward (e.g., a text quiz, a word game)? If yes, how should the agent handle those?

> Answer:

4. Should the fix PR be auto-merged once CI passes (same as the weekly game flow), or should it wait for a human approval?

> Answer:

5. Is there a maximum number of automated fix attempts allowed per issue before the loop stops and escalates to a human?

> Answer:

---

## Constraints

1. The existing weekly-game workflow targets Kaboom.js and static GitHub Pages. Are both of those constraints fixed for this work, or is switching libraries or hosting in scope?

> Answer:

2. All game assets must be inline (data-URI) today — is there a file-size or character-count limit per game file that we must not exceed?

> Answer:

3. Are there any CI checks beyond what already exist (lint, deploy) that a fix PR must pass before it can merge?

> Answer:

4. The fix loop will open PRs triggered by labeled issues. Who can label an issue `game-fix` — only you, or any GitHub user who can comment on the repo?

> Answer:

5. Is there a cost or rate-limit concern with running the fix agent on every labeled issue (e.g., if 10 issues are labeled at once)?

> Answer:

---

## Success Criteria

1. After the visual-quality rules are deployed, what would you look at in the very next generated game to decide the upgrade worked? Name one or two concrete things you'd check.

> Answer:

2. If a `game-fix` issue is opened today, how long would an acceptable turnaround be before the fix PR is open and passing CI — minutes, hours, or a day?

> Answer:

3. What does a "failed" fix attempt look like to you — the PR exists but CI is red, the PR was never opened, or something else?

> Answer:

4. Six weeks after shipping both changes, what would you look at (metrics, issue count, visual inspection) to confirm the improvements are holding up?

> Answer:
