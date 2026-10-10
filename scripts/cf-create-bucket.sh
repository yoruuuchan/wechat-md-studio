#!/usr/bin/env bash
# Create the R2 bucket for Reed images. Idempotent.
set -uo pipefail
set -a; source $HOME/.config/codex/private.env 2>/dev/null; set +a

ACC=5e96dfd2bf22d385e4ffdaa794d74676
AUTH="Authorization: Bearer $CLOUDFLARE_API_TOKEN"

echo "token len: ${#CLOUDFLARE_API_TOKEN}"

echo "=== existing buckets ==="
curl -4 -sS -m 30 -H "$AUTH" "https://api.cloudflare.com/client/v4/accounts/$ACC/r2/buckets" \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print([b["name"] for b in d.get("result",{}).get("buckets",[])])'

echo "=== create mopai-assets ==="
curl -4 -sS -m 30 -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"name":"mopai-assets"}' \
  "https://api.cloudflare.com/client/v4/accounts/$ACC/r2/buckets" | head -c 500
echo

echo "=== buckets now ==="
curl -4 -sS -m 30 -H "$AUTH" "https://api.cloudflare.com/client/v4/accounts/$ACC/r2/buckets" \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print([b["name"] for b in d.get("result",{}).get("buckets",[])])'
