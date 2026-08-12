# shellcheck shell=bash
# merge-eligibility.sh — the SOLE GATE-02 enforcement mechanism (D-16).
#
# GitHub-native rulesets / branch protection are unavailable on this account's
# plan (RESEARCH Finding 1), so this bash precondition chain IS the entire
# merge gate in Phase 2 — there is NO "GitHub itself refuses the merge"
# structural backstop behind it. Every precondition here is the gate's actual
# integrity, not a defense-in-depth layer.
#
# Exposes one function, callable both from auto-merger.yml's run: step and from
# an out-of-run mocked test harness (test/plumbing/merge-eligibility.test.ts):
#
#   check_merge_eligibility "$PR" "$R"
#
# It prints exactly one line — "ELIGIBLE" (exit 0) or "REFUSED: <reason>"
# (exit 1) — evaluating the preconditions in this fixed order, first failure
# wins (matching the plan's Behavior block):
#
#   1. hold label absent
#   2. author is the App bot (node_id match) AND every commit verified  (TEN-04)
#   3. all required checks individually green via the check-runs API     (GATE-01)
#   4. registry autonomy flag == "auto"                                  (TEN-04)
#
# Config (appBotNodeId / requiredChecks / autonomy) is read ONLY from the
# vendored, same-repo .github/factory-config.json — a read-only projection that
# plan 02-11 writes into each onboarded target at onboarding time (single-sourced
# from contracts/scaffold-gates.json + targets.json + the App's own bot-user
# lookup). It is NEVER a live cross-repo read of the factory-only targets.json /
# contracts/scaffold-gates.json (those files do not exist in a target's context).
# Override the path via $CFG for testing.
#
# Author-node-id and commit-verification use the REST endpoints CONFIRMED live by
# plan 02-04 (test/fixtures/APP-TOKEN-FINDINGS.md):
#   - author:       gh api repos/$R/pulls/$PR        --jq .user.node_id
#   - verification: gh api repos/$R/pulls/$PR/commits --jq '[.[].commit.verification.verified]|all'
# The `gh pr view --json author/commits` GraphQL paths are silent-false traps
# (author.id is absent; commits carry no .verification field) and are
# deliberately NOT used here.
#
# Fails CLOSED (REFUSED) if .github/factory-config.json is missing/unreadable or
# any required field is empty — never a silent permissive fallback (T-09-03).

check_merge_eligibility() {
  PR="$1"
  R="$2"
  CFG="${CFG:-.github/factory-config.json}"

  # Fail closed if the vendored config is missing or unreadable (T-09-03).
  if [ ! -r "$CFG" ]; then
    echo "REFUSED: .github/factory-config.json missing or unreadable ($CFG) — failing closed"
    return 1
  fi

  # 1. hold label — human brake (moved unchanged from auto-merger.yml).
  HOLD=$(gh pr view "$PR" -R "$R" --json labels \
    --jq '[.labels[].name] | index("hold") != null' 2>/dev/null || echo "")
  if [ "$HOLD" = "true" ]; then
    echo "REFUSED: hold label present on PR #$PR"
    return 1
  fi

  # 2. author identity + commit verification (TEN-04, D-12).
  #    Both derived from the API (node_id / verification.verified), never from a
  #    spoofable display name (T-09-01). Independent of merge-actor identity.
  BOT_NODE_ID=$(jq -r '.appBotNodeId // empty' "$CFG" 2>/dev/null || echo "")
  if [ -z "$BOT_NODE_ID" ]; then
    echo "REFUSED: appBotNodeId absent from config — cannot verify authorship (fail closed)"
    return 1
  fi
  PR_AUTHOR_NODE_ID=$(gh api "repos/$R/pulls/$PR" --jq '.user.node_id' 2>/dev/null || echo "")
  if [ "$PR_AUTHOR_NODE_ID" != "$BOT_NODE_ID" ]; then
    echo "REFUSED: author/verification check failed — PR author node_id ('$PR_AUTHOR_NODE_ID') does not match App bot ('$BOT_NODE_ID')"
    return 1
  fi
  ALL_VERIFIED=$(gh api "repos/$R/pulls/$PR/commits" \
    --jq '[.[].commit.verification.verified] | all' 2>/dev/null || echo "")
  if [ "$ALL_VERIFIED" != "true" ]; then
    echo "REFUSED: author/verification check failed — not every commit is verified (verification.verified != true)"
    return 1
  fi

  # 3. all required checks individually green via the check-runs API (GATE-01, D-13).
  #    REQUIRED_CHECKS is read from the vendored config — never hardcoded a second
  #    time here (avoids the sentinel-drift risk CONCERNS.md flags).
  REQUIRED_CHECKS=$(jq -r '.requiredChecks | join(" ")' "$CFG" 2>/dev/null || echo "")
  if [ -z "$REQUIRED_CHECKS" ]; then
    echo "REFUSED: requiredChecks absent from config — failing closed"
    return 1
  fi
  HEAD_SHA=$(gh pr view "$PR" -R "$R" --json headRefOid --jq .headRefOid 2>/dev/null || echo "")
  if [ -z "$HEAD_SHA" ]; then
    echo "REFUSED: could not resolve head SHA for PR #$PR (fail closed)"
    return 1
  fi
  # No --paginate: a single commit's check-runs fit one page (100) for this gate,
  # and --paginate with a per-page --jq filter would emit one array PER PAGE
  # ([…]\n[…]), not one merged array — making STATE multi-line and the gate
  # misfire (WR-02).
  CHECK_RUNS=$(gh api "repos/$R/commits/$HEAD_SHA/check-runs" \
    --jq '.check_runs' 2>/dev/null || echo "[]")
  for NAME in $REQUIRED_CHECKS; do
    # Pick the NEWEST run for this check by started_at, not by array position
    # (the API does not guarantee chronological order — an older success after a
    # newer failure must not win, WR-03). A required check counts as green ONLY
    # when completed with success or neutral; "skipped" never ran and must NOT
    # satisfy a required gate (WR-04, fail closed).
    STATE=$(echo "$CHECK_RUNS" | jq -r --arg n "$NAME" \
      '[.[] | select(.name == $n)] | sort_by(.started_at) | last
       | if . == null then "missing"
         elif .status == "completed"
              and (.conclusion == "success" or .conclusion == "neutral")
         then "green"
         else "red"
         end' 2>/dev/null || echo "red")
    if [ "$STATE" != "green" ]; then
      echo "REFUSED: required check '$NAME' is not green (state: $STATE)"
      return 1
    fi
  done

  # 4. registry autonomy flag (TEN-04, D-14). Any value other than "auto"
  #    refuses the merge, regardless of how green everything else is.
  AUTONOMY=$(jq -r '.autonomy // "manual"' "$CFG" 2>/dev/null || echo "manual")
  if [ "$AUTONOMY" != "auto" ]; then
    echo "REFUSED: registry autonomy flag is '$AUTONOMY' (not 'auto') for $R"
    return 1
  fi

  echo "ELIGIBLE"
  return 0
}

# Allow direct invocation as a script: `bash merge-eligibility.sh <PR> <R>`.
# When sourced, ${BASH_SOURCE[0]} != ${0}, so this guard does not fire.
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  check_merge_eligibility "$@"
  exit $?
fi
