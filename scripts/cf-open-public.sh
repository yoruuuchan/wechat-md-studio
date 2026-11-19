#!/usr/bin/env bash
# Open the site to the public, and wire it into the protection this zone
# already pays for.
#
#   cf-open-public.sh            apply
#   cf-open-public.sh --plan     build the rule change and print it, send nothing
#   cf-open-public.sh --check    read-only: show what is configured right now
#
# Needs a token the read-only one is not:
#   Zone  → Rulesets                 Edit
#   Account → Access → Apps/Policies Edit
#
#   export CLOUDFLARE_API_TOKEN=...
#
# The Free plan allows 5 WAF custom rules and exactly 1 rate limiting rule per
# zone, and this zone has already spent all of them on other projects. So this
# script does NOT add rules — it deletes the Access gate and adds this host to
# the existing high-threat-score challenge rule, leaving every other rule and
# the other projects' rate limit untouched. Flood protection for the open
# upload endpoint lives in the app instead (api/lib/burst.ts, api/lib/anon-quota.ts).
#
# To close the site again: scripts/cf-create-access.sh recreates the Access
# application and the /api/img/* bypass exactly as they were.
set -uo pipefail

HOST="${MOPAI_HOST:-wechat.yoru-and-akari.dev}"
ACC="${CLOUDFLARE_ACCOUNT_ID:-5e96dfd2bf22d385e4ffdaa794d74676}"
ZONE="${CLOUDFLARE_ZONE_ID:-4f9b5c7236e63090439676eec70031e2}"
API="https://api.cloudflare.com/client/v4"
MODE="${1:-apply}"

: "${CLOUDFLARE_API_TOKEN:?export CLOUDFLARE_API_TOKEN first (Zone Rulesets Edit + Account Access Edit)}"
PY="$(command -v python3 || command -v python)"
AUTH="Authorization: Bearer $CLOUDFLARE_API_TOKEN"

api() {  # api METHOD PATH [JSON]
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl --noproxy '*' -4 -sS -m 40 -X "$method" -H "$AUTH" -H 'Content-Type: application/json' \
      -d "$body" "$API$path"
  else
    curl --noproxy '*' -4 -sS -m 40 -X "$method" -H "$AUTH" "$API$path"
  fi
}

ruleset_id() {  # ruleset_id PHASE
  api GET "/zones/$ZONE/rulesets" | "$PY" -c "
import sys, json
for r in json.load(sys.stdin).get('result', []):
    if r.get('phase') == sys.argv[1]:
        print(r['id']); break
" "$1"
}

echo "== $HOST (zone $ZONE, mode: $MODE) =="

# --------------------------------------------------------------------------
# 1. Cloudflare Access. The site app is the gate; the /api/img/* app only
#    existed to punch a hole in it, so both go once the site is public.
# --------------------------------------------------------------------------
echo "-- access applications --"
APPS=$(api GET "/accounts/$ACC/access/apps?per_page=100" | HOST="$HOST" "$PY" -c "
import sys, json, os
host = os.environ['HOST']
for a in json.load(sys.stdin).get('result', []):
    d = a.get('domain') or ''
    if d == host or d.startswith(host + '/'):
        print(a['id'], d)
")

if [ -z "$APPS" ]; then
  echo "  none: $HOST is already public"
elif [ "$MODE" != "apply" ]; then
  while read -r app_id domain; do
    [ -n "$app_id" ] && echo "  would delete $domain ($app_id)"
  done <<< "$APPS"
else
  while read -r app_id domain; do
    [ -z "$app_id" ] && continue
    ok=$(api DELETE "/accounts/$ACC/access/apps/$app_id" | "$PY" -c 'import sys,json; print(json.load(sys.stdin).get("success"))')
    echo "  deleted $domain ($app_id) -> $ok"
  done <<< "$APPS"
fi

# --------------------------------------------------------------------------
# 2. Join the existing high-threat-score challenge rule instead of spending a
#    slot that does not exist. Idempotent, and only that one rule is rewritten.
# --------------------------------------------------------------------------
CUSTOM_ID=$(ruleset_id http_request_firewall_custom)
echo "-- waf custom rules ($CUSTOM_ID) --"
CURRENT=$(api GET "/zones/$ZONE/rulesets/$CUSTOM_ID")

if [ "$MODE" = "--check" ]; then
  echo "$CURRENT" | "$PY" -c "
import sys, json
for r in json.load(sys.stdin).get('result', {}).get('rules', []):
    print('  %-46s %-18s enabled=%s' % (r.get('description'), r.get('action'), r.get('enabled')))
    print('      %s' % r.get('expression'))
"
else
  PATCH=$(echo "$CURRENT" | HOST="$HOST" "$PY" -c "
import json, os, re, sys
host = os.environ['HOST']
rules = json.load(sys.stdin).get('result', {}).get('rules', [])
target = next((r for r in rules if str(r.get('description', '')).startswith('Challenge high-threat-score')), None)
if target is None:
    print(json.dumps({'skip': 'no high-threat-score rule on this zone; nothing to join'})); sys.exit(0)
expr = target['expression']
if host in expr:
    print(json.dumps({'skip': 'the challenge rule already covers ' + host})); sys.exit(0)

eq = re.search(r'http\.host eq \"([^\"]+)\"', expr)
inset = re.search(r'http\.host in \{([^}]*)\}', expr)
if eq:
    new = expr[:eq.start()] + 'http.host in {\"%s\" \"%s\"}' % (eq.group(1), host) + expr[eq.end():]
elif inset:
    new = expr[:inset.end(1)] + ' \"%s\"' % host + expr[inset.end(1):]
else:
    print(json.dumps({'skip': 'cannot find a host condition to extend', 'expression': expr})); sys.exit(0)

target['expression'] = new
clean = [{k: v for k, v in r.items() if k not in ('ref', 'last_updated', 'version')} for r in rules]
print(json.dumps({'rules': clean, 'new_expression': new}))
")
  SKIP=$(echo "$PATCH" | "$PY" -c 'import sys,json; print(json.load(sys.stdin).get("skip",""))')
  if [ -n "$SKIP" ]; then
    echo "  skipped: $SKIP"
  else
    echo "$PATCH" | "$PY" -c 'import sys,json; print("  new expression:", json.load(sys.stdin)["new_expression"])'
    if [ "$MODE" = "--plan" ]; then
      echo "  plan only: nothing sent"
    else
      api PATCH "/zones/$ZONE/rulesets/$CUSTOM_ID" "$PATCH" | "$PY" -c "
import sys, json
d = json.load(sys.stdin)
print('  success:', d.get('success'), d.get('errors') or '')
for r in (d.get('result') or {}).get('rules', []):
    print('  %-46s %-18s enabled=%s' % (r.get('description'), r.get('action'), r.get('enabled')))
"
    fi
  fi
fi

# --------------------------------------------------------------------------
# 3. Report the rate limiting slot instead of fighting for it.
# --------------------------------------------------------------------------
RATE_ID=$(ruleset_id http_ratelimit)
echo "-- rate limiting (free plan: 1 rule per zone) --"
api GET "/zones/$ZONE/rulesets/$RATE_ID" | "$PY" -c "
import sys, json
rules = json.load(sys.stdin).get('result', {}).get('rules', [])
if not rules:
    print('  no rule installed — the slot is free if you want to spend it on uploads')
for r in rules:
    rl = r.get('ratelimit') or {}
    print('  %-30s %s req/%ss, block %ss' % (r.get('description'), rl.get('requests_per_period'), rl.get('period'), rl.get('mitigation_timeout')))
    print('      %s' % r.get('expression'))
"

cat <<NOTE
-- what protects the open upload endpoint --
  app    per-IP burst limit      12 uploads / minute        (api/lib/burst.ts)
  app    per-visitor allowance   30 images + 100 MB / 24 h  (api/lib/anon-quota.ts)
  app    shared anonymous cap    1.5 GB total               (ANON_TOTAL_BYTES)
  app    daily site volume       512 MB / UTC day           (ANON_DAILY_TOTAL_BYTES)
  app    per-IP daily volume     256 MB / UTC day per /64  (ANON_IP_DAILY_BYTES)
  app    content sniffing        only jpeg/png/gif/webp     (api/lib/image-type.ts)
  edge   high-threat-score challenge, scanner UA block, path traversal block,
         dangerous method block — the zone-wide rules already installed
  edge   AI bot protection: block; Bot Fight Mode stays OFF on purpose, because
         it challenges known bots zone-wide and WeChat's server-side image
         fetcher is one of them — turning it on would break published articles.
  next   Turnstile (free, unlimited) if the quotas prove too loose. Skipped for
         now: a failed challenge would block mainland visitors from uploading.
NOTE

echo "== done =="
