#!/usr/bin/env bash
# Runs verification steps with ONE line of output per step (pass/fail +
# timing), instead of raw `pnpm test`/`npm run preflight` output, which can
# run to hundreds of lines across 6 workspace packages. Full output for
# any step is still captured, just to a log file instead of stdout, so a
# failure can be inspected without the passing steps' noise ever being
# read into context.
#
# Usage:
#   tooling/scripts/verify-quiet.sh typecheck lint test audit build
#   tooling/scripts/verify-quiet.sh              # runs all steps, in order
#
# On failure, the script exits non-zero after printing all requested
# steps' results (it does not stop at the first failure), so one run
# shows the full picture. Each step's full output is at
# /tmp/verify-quiet/<step>.log for inspection.

set -u
cd "$(dirname "$0")/../.." || exit 1

LOG_DIR="/tmp/verify-quiet"
mkdir -p "$LOG_DIR"

ALL_STEPS=(typecheck lint test audit build)
requested=("$@")
if [ ${#requested[@]} -eq 0 ]; then
  requested=("${ALL_STEPS[@]}")
fi

overall_status=0

run_step() {
  local name="$1"
  shift
  local log_file="$LOG_DIR/$name.log"
  local start end elapsed
  start=$(date +%s)
  if "$@" >"$log_file" 2>&1; then
    end=$(date +%s)
    elapsed=$((end - start))
    echo "✓ $name (${elapsed}s)"
  else
    end=$(date +%s)
    elapsed=$((end - start))
    echo "✗ $name (${elapsed}s) — see $log_file"
    overall_status=1
  fi
}

for step in "${requested[@]}"; do
  case "$step" in
    typecheck)
      run_step typecheck npm run typecheck
      ;;
    lint)
      run_step lint npm run lint
      ;;
    test)
      run_step test npm run test
      ;;
    audit)
      run_step audit bash -c '
        set -e
        npm run validate:extension
        npm run audit:architecture
        npm run audit:branding
        npm run audit:tools
        npm run check:mcp-bridge-docs
        if [ -d apps/browser-extension/dist ]; then
          npm run check:tailwind-sources
        fi
      '
      ;;
    build)
      run_step build npm run build
      ;;
    *)
      echo "✗ $step — unknown step (known: ${ALL_STEPS[*]})"
      overall_status=1
      ;;
  esac
done

exit $overall_status
