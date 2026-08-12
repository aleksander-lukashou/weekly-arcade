# shellcheck shell=bash
# advancer-mode.sh — the cron advancer's Phase 3 mode switch + stall watchdog (D-11).
#
# Phase 3 migrates a tenant from the v2 cron-driven pipeline to the event-driven
# orchestrator. During (and after) that migration the vendored ticket-advancer
# must NOT keep dispatching tickets for a managed tenant — the orchestrator owns
# dispatch — or the tenant is double-driven. But the cron must still run as a
# SAFETY NET: it detects items stalled under the orchestrator and raises a loud
# issue so a silent orchestrator outage cannot go unnoticed.
#
# Exposes two sourceable, side-effect-free functions (the caller does any issue
# mutation, keeping this lib pure and testable from the mocked harness in
# test/plumbing/advancer-watchdog.test.ts):
#
#   check_orchestrator_managed          -> prints exactly one line: MANAGED | UNMANAGED
#   detect_stalls <repo>                -> prints "STALL <number> <age_hours>" per
#                                          stalled in-progress issue, or "OK"
#
# Config is read ONLY from the vendored, same-repo .github/factory-config.json —
# the read-only projection onboard-target.yml writes into each target (it carries
# orchestrator_managed as a real boolean, plan 03 D-11/D-12). Override the path
# via $CFG for testing.
#
# IMPORTANT fail direction — this defaults to UNMANAGED (the OPPOSITE of
# merge-eligibility.sh's fail-CLOSED). A missing/unreadable config, an absent
# orchestrator_managed key, or any non-`true` value all resolve to UNMANAGED so a
# legacy target with no Phase-3 config keeps its v2 advancer fully operational
# (ORCH-06, success criterion 5). The dangerous state — a stale `false` on a
# tenant the orchestrator now drives — is caught loudly by registry-reconcile
# drift detection (plan 03-03), with orchestrator idempotency keys as the backstop
# (D-11). So defaulting permissive here cannot cause double-dispatch by itself.

# Return MANAGED only when the vendored config exists AND its orchestrator_managed
# field is the literal boolean true; UNMANAGED for every other case. Verdict is
# stdout only; always exit 0.
check_orchestrator_managed() {
  local cfg="${CFG:-.github/factory-config.json}"
  local val

  if [ ! -r "$cfg" ]; then
    echo "UNMANAGED"
    return 0
  fi

  # jq prints the string "null" for an absent key and "false" for a false value —
  # both fall through to UNMANAGED. Only the literal true flips to MANAGED.
  val=$(jq -r '.orchestrator_managed' "$cfg" 2>/dev/null || echo "null")
  if [ "$val" = "true" ]; then
    echo "MANAGED"
  else
    echo "UNMANAGED"
  fi
  return 0
}

# Parse an ISO-8601 UTC timestamp to epoch seconds. GNU date (`-d`, as the
# advancer's epic_watchdog uses) is what runs on the ubuntu-latest cron runner;
# the BSD `-j -f` fallback keeps this lib parseable under the macOS test harness.
# Any failure yields 0 (the 1970 epoch) — defensive house style.
_advancer_epoch_of() {
  local ts="$1"
  date -u -d "$ts" +%s 2>/dev/null \
    || date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$ts" +%s 2>/dev/null \
    || echo 0
}

# Watchdog-only stall detection for a managed tenant. Lists open `in-progress`
# ticket issues and, for each, measures hours since the last `**Factory dispatch**`
# comment (falling back to the issue's own createdAt when the orchestrator has left
# no such comment). Prints one `STALL <number> <age_hours>` line per issue stalled
# >= 2 hours, or the single line `OK` when nothing is stalled. Detection ONLY — no
# dispatch, no label mutation, no issue creation happens in here (the caller raises
# the loud issue), so the function stays pure and unit-testable.
detect_stalls() {
  local repo="$1"
  local issues nums num view last now then_s age found=0

  issues=$(gh issue list -R "$repo" --label in-progress --state open --json number 2>/dev/null || echo "[]")
  nums=$(echo "$issues" | jq -r '.[].number' 2>/dev/null || echo "")

  for num in $nums; do
    view=$(gh issue view "$num" -R "$repo" --json comments,createdAt 2>/dev/null || echo "{}")
    # Reuse epic_watchdog's exact dispatch-comment selector; fall back to the
    # issue's createdAt when no **Factory dispatch** comment exists yet.
    last=$(echo "$view" | jq -r \
      '([.comments[] | select(.body | startswith("**Factory dispatch**"))] | last | .createdAt) // .createdAt // empty' \
      2>/dev/null || echo "")
    now=$(date -u +%s)
    then_s=$(_advancer_epoch_of "${last:-1970-01-01T00:00:00Z}")
    age=$(( (now - then_s) / 3600 ))
    if [ "$age" -ge 2 ]; then
      echo "STALL $num $age"
      found=1
    fi
  done

  [ "$found" -eq 0 ] && echo "OK"
  return 0
}

# Allow direct invocation: `bash advancer-mode.sh [function] [args...]`.
# Defaults to check_orchestrator_managed when no function is named. When sourced,
# ${BASH_SOURCE[0]} != ${0}, so this guard does not fire.
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  cmd="${1:-check_orchestrator_managed}"
  shift 2>/dev/null || true
  "$cmd" "$@"
  exit $?
fi
