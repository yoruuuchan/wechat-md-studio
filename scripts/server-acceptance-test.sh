#!/usr/bin/env bash
# Acceptance test for 公众号排版助手 on cc-tokyo-01.
# Runs ON the server against 127.0.0.1:3100, so it exercises the full app + R2
# chain without a browser and without going through Cloudflare.
set -uo pipefail

APP="http://127.0.0.1:3100"

ACCESS_KEY=$(sudo grep '^ACCESS_KEY=' /opt/mopai/app/.env | cut -d= -f2-)
echo "access key loaded (len=${#ACCESS_KEY})"
if [ -z "$ACCESS_KEY" ]; then
  echo "FATAL: ACCESS_KEY is empty — run this as a user that can sudo, or every"
  echo "       owner-path check below silently degrades into an anonymous one."
  exit 1
fi

FAILURES=0
verdict() {  # verdict LABEL OK
  if [ "$2" = "1" ]; then echo "  [PASS] $1"; else echo "  [FAIL] $1"; FAILURES=$((FAILURES + 1)); fi
}

echo
echo "### 1. app reachable, SPA fallback"
for p in / /login; do
  code=$(curl -4 -sS -m 10 -o /dev/null -w '%{http_code}' -H 'Accept: text/html' "$APP$p")
  echo "  $p -> $code"
done

echo
echo "### 2. auth.me anonymous (expect json null)"
curl -4 -sS -m 10 "$APP/api/trpc/auth.me" | head -c 200; echo

echo
echo "### 3. wrong access key rejected"
curl -4 -sS -m 10 -X POST -H 'Content-Type: application/json' \
  -d '{"json":{"accessKey":"definitely-wrong"}}' "$APP/api/trpc/auth.login" | head -c 200; echo

echo
echo "### 4. login with real access key"
COOKIE_JAR=$(mktemp)
SET_COOKIE=$(curl -4 -sS -m 10 -c "$COOKIE_JAR" -D - -o /dev/null -X POST -H 'Content-Type: application/json' \
  -d "{\"json\":{\"accessKey\":\"$ACCESS_KEY\"}}" "$APP/api/trpc/auth.login" | grep -i '^set-cookie:' || true)
echo "  set-cookie: ${SET_COOKIE:0:120}"
# First-party session cookie: Lax keeps it out of third-party-cookie and
# partitioning rules; None made browsers drop the session on refresh.
# Secure is set only off-localhost, and this suite usually runs on loopback.
case "$SET_COOKIE" in
  *HttpOnly*SameSite=Lax*) echo "  [PASS] cookie attributes HttpOnly+Lax" ;;
  *) echo "  [FAIL] unexpected cookie attributes: $SET_COOKIE"; exit 1 ;;
esac
case "$APP" in
  *127.0.0.1* | *localhost*) ;;
  *)
    case "$SET_COOKIE" in
      *Secure*) echo "  [PASS] Secure present on public host" ;;
      *) echo "  [FAIL] public host without Secure: $SET_COOKIE"; exit 1 ;;
    esac
    ;;
esac
curl -4 -sS -m 10 -c "$COOKIE_JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"json\":{\"accessKey\":\"$ACCESS_KEY\"}}" "$APP/api/trpc/auth.login" | head -c 200; echo
echo "  cookie set: $(grep -c mopai_sid "$COOKIE_JAR" || true)"

echo
echo "### 5. auth.me with session"
curl -4 -sS -m 10 -b "$COOKIE_JAR" "$APP/api/trpc/auth.me" | head -c 260; echo

echo
echo "### 6. upload an image"
PNG_B64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
UP=$(curl -4 -sS -m 30 -b "$COOKIE_JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"json\":{\"name\":\"acceptance.png\",\"contentBase64\":\"$PNG_B64\",\"contentType\":\"image/png\"}}" \
  "$APP/api/trpc/storage.upload")
echo "  $UP"
KEY=$(printf '%s' "$UP" | python3 -c 'import sys,json,re; m=re.search(r"\"key\":\"([^\"]+)\"", sys.stdin.read()); print(m.group(1) if m else "")')
echo "  key = $KEY"
# Anonymous uploads succeed too now, so an empty ACCESS_KEY would no longer fail
# here — it would quietly upload as a visitor. The key carries the owner id, so
# assert on it or a broken login passes as a working deploy.
if printf '%s' "$KEY" | grep -q -- '-mopai-1-'; then
  echo "  [PASS] uploaded as the owner"
else
  echo "  [FAIL] not an owner key (login probably failed, ACCESS_KEY empty?)"
  FAILURES=$((FAILURES + 1))
fi

echo
echo "### 7. storage.list shows the row"
LIST=$(curl -4 -sS -m 10 -b "$COOKIE_JAR" "$APP/api/trpc/storage.list")
echo "  $(printf '%s' "$LIST" | head -c 400)"
if printf '%s' "$LIST" | grep -q 'acceptance.png'; then
  echo "  [PASS] the owner sees their own upload"
else
  echo "  [FAIL] the upload is missing from the owner's list"
  FAILURES=$((FAILURES + 1))
fi

echo
echo "### 8. /api/img/<key> redirects, target returns 200"
if [ -n "$KEY" ]; then
  LOC=$(curl -4 -sS -m 15 -o /dev/null -w '%{redirect_url}' "$APP/api/img/$KEY")
  echo "  302 -> $LOC"
  FINAL=$(curl -4 -sS -m 20 -o /dev/null -w 'status=%{http_code} type=%{content_type} bytes=%{size_download}' "$LOC")
  echo "  final: $FINAL"
  case "$FINAL" in
    status=200\ type=image/png*) echo "  [PASS] publicly readable as an image" ;;
    *) echo "  [FAIL] unexpected final response"; FAILURES=$((FAILURES + 1)) ;;
  esac
fi

echo
echo "### 9. upload without a session now works (the gate is gone)"
ANON_JAR=$(mktemp)
ANON_UP=$(curl -4 -sS -m 30 -c "$ANON_JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"json\":{\"name\":\"anon-acceptance.png\",\"contentBase64\":\"$PNG_B64\",\"contentType\":\"image/png\"}}" \
  "$APP/api/trpc/storage.upload")
echo "  $ANON_UP"
ANON_KEY=$(printf '%s' "$ANON_UP" | python3 -c 'import sys,json,re; m=re.search(r"\"key\":\"([^\"]+)\"", sys.stdin.read()); print(m.group(1) if m else "")')
verdict "anonymous upload accepted" "$([ -n "$ANON_KEY" ] && echo 1 || echo 0)"
verdict "visitor cookie minted" "$(grep -q mopai_vid "$ANON_JAR" && echo 1 || echo 0)"

echo
echo "### 10. an anonymous visitor only sees their own images"
ANON_LIST=$(curl -4 -sS -m 10 -b "$ANON_JAR" "$APP/api/trpc/storage.list")
echo "  $(printf '%s' "$ANON_LIST" | head -c 300)"
verdict "the owner's image is not in the anonymous list" \
  "$([ -n "$KEY" ] && ! printf '%s' "$ANON_LIST" | grep -q "$KEY" && echo 1 || echo 0)"
verdict "the anonymous image is" "$(printf '%s' "$ANON_LIST" | grep -q 'anon-acceptance' && echo 1 || echo 0)"

echo
echo "### 11. markup renamed to .png is still refused"
HTML_B64=$(printf '%s' '<html><script>alert(1)</script></html>' | base64 -w0)
BAD=$(curl -4 -sS -m 15 -b "$ANON_JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"json\":{\"name\":\"evil.png\",\"contentBase64\":\"$HTML_B64\",\"contentType\":\"image/png\"}}" \
  "$APP/api/trpc/storage.upload")
echo "  $(printf '%s' "$BAD" | head -c 260)"
verdict "BAD_REQUEST on non-image bytes" "$(printf '%s' "$BAD" | grep -q 'BAD_REQUEST' && echo 1 || echo 0)"

echo
echo "### 12. clean up the anonymous test image"
DEL=$(curl -4 -sS -m 20 -b "$ANON_JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"json\":{\"key\":\"$ANON_KEY\"}}" "$APP/api/trpc/storage.remove")
echo "  $DEL"
verdict "the anonymous caller can delete its own image" "$(printf '%s' "$DEL" | grep -q '"ok":true' && echo 1 || echo 0)"

rm -f "$COOKIE_JAR" "$ANON_JAR"
echo
if [ "$FAILURES" -eq 0 ]; then
  echo "### done — all checks passed"
else
  echo "### done — $FAILURES CHECK(S) FAILED"
  exit 1
fi
