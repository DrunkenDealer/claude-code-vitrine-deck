#!/usr/bin/env bash
# Runs each scenario headless against a scratch copy of its fixture repo, then grades it.
#   VITRINE_HOME=/path/to/Vitrine evals/run.sh [habit-ios budget-android traps-kmp]
# Each run pushes one anonymous deck to vitrine.mashlab.app (deleted within 24 h) under its own
# XDG_CONFIG_HOME, so your own Vitrine session is never touched.
set -euo pipefail
: "${VITRINE_HOME:?set VITRINE_HOME to a Vitrine checkout}"
here="$(cd "$(dirname "$0")" && pwd)"
scenarios=("${@:-habit-ios budget-android traps-kmp}")
read -ra scenarios <<<"${scenarios[*]}"
out="$here/results/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$out"

prompt='Make the store screenshots for this app — the screenshots are in ./screenshots. Go ahead without asking me anything; use your judgement and finish the whole thing.'

for s in "${scenarios[@]}"; do
  [ -d "$here/fixtures/$s/screenshots" ] || node "$here/fixtures/shots.mjs" "$s"
  (
    work="$(mktemp -d "${TMPDIR:-/tmp}/vd-$s.XXXX")"
    cp -R "$here/fixtures/$s/." "$work/"
    git -C "$work" init -q && git -C "$work" add -A && git -C "$work" -c user.name=eval -c user.email=eval@localhost commit -qm fixture
    mkdir -p "$work.xdg"
    echo "$s: $work"
    (cd "$work" && XDG_CONFIG_HOME="$work.xdg" VITRINE_HOME="$VITRINE_HOME" claude -p "$prompt" \
      --output-format stream-json --verbose --no-session-persistence \
      --permission-mode acceptEdits --allowedTools "Bash Read Write Edit Glob Grep Skill" \
      --add-dir "$VITRINE_HOME" --max-budget-usd "${BUDGET:-20}" >"$out/$s.jsonl" 2>"$out/$s.err") || true
    VITRINE_HOME="$VITRINE_HOME" XDG_CONFIG_HOME="$work.xdg" node "$here/grade.mjs" "$s" "$work" "$out/$s.jsonl" "$work.xdg" >"$out/$s.grade.txt" || true
    echo "$work" >"$out/$s.workdir"
  ) &
done
wait
for s in "${scenarios[@]}"; do echo "── $s"; cat "$out/$s.grade.txt"; done
echo "results: $out"
