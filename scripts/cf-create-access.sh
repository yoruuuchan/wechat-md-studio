#!/usr/bin/env bash
# Create the Cloudflare Access application + email policy for Reed. Idempotent.
#
# Scope: wechat.yoru-and-akari.dev only. Image reads go to mopai-img.yoru-and-akari.dev
# (a Worker custom domain), which is deliberately NOT covered here — WeChat has to
# be able to fetch the images when it re-hosts them.
set -uo pipefail
set -a; source $HOME/.config/codex/private.env 2>/dev/null; set +a

ACC=5e96dfd2bf22d385e4ffdaa794d74676
AUTH="Authorization: Bearer $CLOUDFLARE_API_TOKEN"
APP_NAME="芦苇 Reed"
APP_DOMAIN="wechat.yoru-and-akari.dev"
ALLOW_EMAIL="${ACCESS_ALLOW_EMAIL:?set ACCESS_ALLOW_EMAIL to the Access allowlist email}"
IDP_ID="02dc55ac-e7e2-4623-b699-ff8bdcb4f825"
SESSION="168h"

echo "=== find existing app for $APP_DOMAIN ==="
APP_ID=$(curl -4 -sS -m 30 -H "$AUTH" "https://api.cloudflare.com/client/v4/accounts/$ACC/access/apps" \
  | python3 -c "
import sys,json
d=json.load(sys.stdin)
for a in d.get('result',[]):
    if (a.get('domain') or '') == '$APP_DOMAIN':
        print(a['id']); break
")

if [ -n "$APP_ID" ]; then
  echo "reusing app $APP_ID"
else
  echo "creating app"
  APP_ID=$(curl -4 -sS -m 30 -X POST -H "$AUTH" -H "Content-Type: application/json" \
    -d "{\"name\":\"$APP_NAME\",\"domain\":\"$APP_DOMAIN\",\"type\":\"self_hosted\",\"session_duration\":\"$SESSION\",\"allowed_idps\":[\"$IDP_ID\"],\"auto_redirect_to_identity\":true,\"http_only_cookie_attribute\":true,\"app_launcher_visible\":true}" \
    "https://api.cloudflare.com/client/v4/accounts/$ACC/access/apps" \
    | python3 -c 'import sys,json; d=json.load(sys.stdin); print((d.get("result") or {}).get("id",""))')
  if [ -z "$APP_ID" ]; then echo "APP CREATE FAILED"; exit 1; fi
  echo "created app $APP_ID"
fi

echo "=== ensure email policy ==="
POLICY_ID=$(curl -4 -sS -m 30 -H "$AUTH" "https://api.cloudflare.com/client/v4/accounts/$ACC/access/apps/$APP_ID/policies" \
  | python3 -c "
import sys,json
d=json.load(sys.stdin)
for p in d.get('result',[]):
    if p.get('decision')=='allow':
        print(p['id']); break
")

if [ -n "$POLICY_ID" ]; then
  echo "reusing policy $POLICY_ID"
else
  echo "creating policy"
  curl -4 -sS -m 30 -X POST -H "$AUTH" -H "Content-Type: application/json" \
    -d "{\"name\":\"Allow $ALLOW_EMAIL\",\"decision\":\"allow\",\"include\":[{\"email\":{\"email\":\"$ALLOW_EMAIL\"}}]}" \
    "https://api.cloudflare.com/client/v4/accounts/$ACC/access/apps/$APP_ID/policies" \
    | python3 -c 'import sys,json; d=json.load(sys.stdin); print("  ok" if d.get("success") else d.get("errors"))'
fi

echo "=== resulting app ==="
curl -4 -sS -m 30 -H "$AUTH" "https://api.cloudflare.com/client/v4/accounts/$ACC/access/apps/$APP_ID" \
  | python3 -c '
import sys,json
r=(json.load(sys.stdin).get("result") or {})
for k in ["id","name","domain","type","session_duration","allowed_idps","auto_redirect_to_identity"]:
    print("  %-26s %r" % (k, r.get(k)))
'
echo "=== resulting policies ==="
curl -4 -sS -m 30 -H "$AUTH" "https://api.cloudflare.com/client/v4/accounts/$ACC/access/apps/$APP_ID/policies" \
  | python3 -c '
import sys,json
for p in json.load(sys.stdin).get("result",[]):
    print("  %r decision=%s include=%s" % (p.get("name"), p.get("decision"), json.dumps(p.get("include"))))
'

# ---------------------------------------------------------------------------
# Public image reads.
#
# WeChat re-hosts images by fetching them server-side, so /api/img/* must be
# reachable with no session. Application paths are matched most-specific-first,
# so this app wins over the site-wide one above while everything else on the
# hostname stays gated.
# ---------------------------------------------------------------------------
IMG_APP_DOMAIN="wechat.yoru-and-akari.dev/api/img/*"

echo
echo "=== find existing app for $IMG_APP_DOMAIN ==="
IMG_APP_ID=$(curl -4 -sS -m 30 -H "$AUTH" "https://api.cloudflare.com/client/v4/accounts/$ACC/access/apps" \
  | python3 -c "
import sys,json
d=json.load(sys.stdin)
for a in d.get('result',[]):
    if (a.get('domain') or '') == '$IMG_APP_DOMAIN':
        print(a['id']); break
")

if [ -n "$IMG_APP_ID" ]; then
  echo "reusing image app $IMG_APP_ID"
else
  echo "creating image app"
  IMG_APP_ID=$(curl -4 -sS -m 30 -X POST -H "$AUTH" -H "Content-Type: application/json" \
    -d "{\"name\":\"芦苇 public images\",\"domain\":\"$IMG_APP_DOMAIN\",\"type\":\"self_hosted\",\"session_duration\":\"24h\",\"app_launcher_visible\":false}" \
    "https://api.cloudflare.com/client/v4/accounts/$ACC/access/apps" \
    | python3 -c 'import sys,json; d=json.load(sys.stdin); print((d.get("result") or {}).get("id",""))')
  if [ -z "$IMG_APP_ID" ]; then echo "IMAGE APP CREATE FAILED"; exit 1; fi
  echo "created image app $IMG_APP_ID"
fi

echo "=== ensure bypass policy on image app ==="
IMG_POLICY_ID=$(curl -4 -sS -m 30 -H "$AUTH" "https://api.cloudflare.com/client/v4/accounts/$ACC/access/apps/$IMG_APP_ID/policies" \
  | python3 -c "
import sys,json
d=json.load(sys.stdin)
for p in d.get('result',[]):
    if p.get('decision')=='bypass':
        print(p['id']); break
")

if [ -n "$IMG_POLICY_ID" ]; then
  echo "reusing bypass policy $IMG_POLICY_ID"
else
  echo "creating bypass policy"
  curl -4 -sS -m 30 -X POST -H "$AUTH" -H "Content-Type: application/json" \
    -d '{"name":"Public image reads","decision":"bypass","include":[{"everyone":{}}]}' \
    "https://api.cloudflare.com/client/v4/accounts/$ACC/access/apps/$IMG_APP_ID/policies" \
    | python3 -c 'import sys,json; d=json.load(sys.stdin); print("  ok" if d.get("success") else d.get("errors"))'
fi

echo "=== image app state ==="
curl -4 -sS -m 30 -H "$AUTH" "https://api.cloudflare.com/client/v4/accounts/$ACC/access/apps/$IMG_APP_ID" \
  | python3 -c '
import sys,json
r=(json.load(sys.stdin).get("result") or {})
print("  domain=%r type=%s" % (r.get("domain"), r.get("type")))
'
curl -4 -sS -m 30 -H "$AUTH" "https://api.cloudflare.com/client/v4/accounts/$ACC/access/apps/$IMG_APP_ID/policies" \
  | python3 -c '
import sys,json
for p in json.load(sys.stdin).get("result",[]):
    print("  %r decision=%s include=%s" % (p.get("name"), p.get("decision"), json.dumps(p.get("include"))))
'
