#!/usr/bin/env bash
# Install an uploaded release into /opt/mopai/app and restart the services.
#
#   server-install-release.sh [path-to-tarball]   (default /tmp/mopai-release.tar.gz)
#
# The tarball is left in place so a re-run does not need a re-upload; pass
# --clean to remove it afterwards.
set -euo pipefail

RELEASE="${1:-/tmp/mopai-release.tar.gz}"
if [ "${RELEASE}" = "--clean" ]; then RELEASE=/tmp/mopai-release.tar.gz; fi

if [ ! -f "$RELEASE" ]; then
  echo "release not found: $RELEASE" >&2
  exit 1
fi

echo "== extract $RELEASE =="
rm -rf /tmp/mopai-extract
mkdir -p /tmp/mopai-extract
tar -xzf "$RELEASE" -C /tmp/mopai-extract
test -f /tmp/mopai-extract/dist/boot.js || { echo "tarball has no dist/boot.js" >&2; exit 1; }
ls -la /tmp/mopai-extract/dist

# React ships its development bundle whenever the build machine's .env carries
# NODE_ENV=development, because vite reads that value out of .env and uses it as
# the compilation condition. That bundle has reached production more than once.
ENTRY=$(grep -o 'assets/index-[A-Za-z0-9_-]*\.js' /tmp/mopai-extract/dist/public/index.html | head -1)
if [ -n "$ENTRY" ] && grep -q "jsxDEV" "/tmp/mopai-extract/dist/public/$ENTRY"; then
  if [ "${MOPAI_ALLOW_DEV_BUNDLE:-}" = "1" ]; then
    echo "WARN: installing React's development bundle ($ENTRY) anyway" >&2
  else
    echo "REFUSED: $ENTRY contains jsxDEV — this is React's development build." >&2
    echo "  Cause: NODE_ENV=development in the build machine's app/.env." >&2
    echo "  Fix: delete that line from .env, rebuild, re-upload." >&2
    echo "  Deliberately want it? re-run with MOPAI_ALLOW_DEV_BUNDLE=1." >&2
    exit 1
  fi
fi

echo "== install into /opt/mopai/app =="
sudo rm -rf /opt/mopai/app/dist
sudo cp -r /tmp/mopai-extract/dist /opt/mopai/app/dist
sudo mkdir -p /opt/mopai/app/data
sudo chown -R mopai:mopai /opt/mopai/app
sudo chmod 750 /opt/mopai/app/data
echo "app dir:"
sudo ls -la /opt/mopai/app
echo "dist:"
sudo ls -la /opt/mopai/app/dist

echo "== enable and restart app =="
sudo systemctl enable mopai.service
# restart, not "enable --now": the unit is already running and would otherwise
# keep serving the previous bundle from memory
sudo systemctl restart mopai.service
sleep 5
sudo systemctl is-active mopai.service || true
echo "--- status ---"
sudo systemctl status mopai.service --no-pager -l | head -25 || true
echo "--- recent logs ---"
sudo journalctl -u mopai.service -n 40 --no-pager || true

echo "== local health check =="
curl -4 -sS -m 10 -o /dev/null -w "GET / -> %{http_code}\n" http://127.0.0.1:3100/ || true
curl -4 -sS -m 10 -H "Accept: text/html" -o /dev/null -w "GET /login -> %{http_code}\n" http://127.0.0.1:3100/login || true
curl -4 -sS -m 10 -o /dev/null -w "GET /api/trpc/auth.me -> %{http_code}\n" http://127.0.0.1:3100/api/trpc/auth.me || true

echo "== clean extract dir =="
rm -rf /tmp/mopai-extract
echo done
