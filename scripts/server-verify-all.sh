#!/usr/bin/env bash
# Re-run every deployed-side check for Reed.
#
# Every check runs even if an earlier one fails, but the overall exit code is
# non-zero when any of them did - otherwise a broken deployment reports success.
set -uo pipefail

failed=0
for s in server-acceptance-test.sh server-e2e-check.sh server-round2-check.sh; do
  echo
  echo "################ ${s} ################"
  if ! bash "/opt/mopai/scripts/${s}"; then
    echo "  !! ${s} FAILED"
    failed=$((failed + 1))
  fi
done

echo
if [ "$failed" -eq 0 ]; then
  echo "ALL DEPLOYED CHECKS PASSED"
else
  echo "$failed CHECK SCRIPT(S) FAILED"
fi
exit "$failed"
