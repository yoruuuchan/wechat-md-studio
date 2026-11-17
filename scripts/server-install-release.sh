#!/usr/bin/env bash
# Install an uploaded release into /opt/mopai/app and restart the services.
#
#   server-install-release.sh [path-to-tarball]   (default /tmp/mopai-release.tar.gz)
#
# The tarball is left in place so a re-run does not need a re-upload; pass
# --clean to remove it afterwards.
#
# The new dist is copied beside the running one and swapped in by rename, so
# the old release stays whole until the new one has passed the health check.
# If the service does not come up healthy, the previous dist is put back, the
# service restarted on it, and the script exits non-zero with FAILED.
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

# Overridable only so the swap and rollback can be exercised away from the server.
APP=${MOPAI_APP_DIR:-/opt/mopai/app}
echo "== install into $APP =="
sudo rm -rf "$APP/dist.new" "$APP/dist.prev"
sudo cp -r /tmp/mopai-extract/dist "$APP/dist.new"
if [ -d "$APP/dist" ]; then sudo mv "$APP/dist" "$APP/dist.prev"; fi
sudo mv "$APP/dist.new" "$APP/dist"
sudo mkdir -p "$APP/data"
sudo chown -R mopai:mopai "$APP"
sudo chmod 750 "$APP/data"
echo "app dir:"
sudo ls -la "$APP"
echo "dist:"
sudo ls -la "$APP/dist"

ROUTES="/ /login /api/trpc/auth.me"
route_code() {
  curl -4 -sS -m 10 -H "Accept: text/html" -o /dev/null -w "%{http_code}" "http://127.0.0.1:3100$1" 2>/dev/null || echo 000
}

# Restart, then wait up to 30 s for the unit to be active and every route to
# answer 200. Prints the final state of each; returns non-zero if any failed.
restart_and_check() {
  # restart, not "enable --now": the unit is already running and would
  # otherwise keep serving the previous bundle from memory
  sudo systemctl restart mopai.service
  local healthy=1 route
  for _ in $(seq 1 15); do
    sleep 2
    sudo systemctl is-active --quiet mopai.service || continue
    healthy=0
    for route in $ROUTES; do
      [ "$(route_code "$route")" = 200 ] || healthy=1
    done
    [ "$healthy" = 0 ] && break
  done
  echo "service: $(sudo systemctl is-active mopai.service || true)"
  for route in $ROUTES; do echo "GET $route -> $(route_code "$route")"; done
  return "$healthy"
}

echo "== enable and restart app =="
sudo systemctl enable mopai.service
echo "== local health check =="
if restart_and_check; then
  echo "--- status ---"
  sudo systemctl status mopai.service --no-pager -l | head -25 || true
  echo "--- recent logs ---"
  sudo journalctl -u mopai.service -n 40 --no-pager || true
  sudo rm -rf "$APP/dist.prev"
  echo "== clean extract dir =="
  rm -rf /tmp/mopai-extract
  echo done
  exit 0
fi

echo "--- recent logs of the failed release ---" >&2
sudo journalctl -u mopai.service -n 60 --no-pager >&2 || true
if [ -d "$APP/dist.prev" ]; then
  echo "== rolling back to the previous dist ==" >&2
  sudo rm -rf "$APP/dist.failed"
  sudo mv "$APP/dist" "$APP/dist.failed"
  sudo mv "$APP/dist.prev" "$APP/dist"
  if restart_and_check; then
    echo "FAILED: the new release did not pass the health check; the previous release is back and healthy." >&2
    echo "  The failed build is kept at $APP/dist.failed for inspection." >&2
  else
    echo "FAILED: the new release did not pass the health check, and the previous release did not come back healthy either." >&2
    echo "  Restore from /opt/mopai/backups (newest dist-* and mopai-*.db) by hand." >&2
  fi
else
  echo "FAILED: the new release did not pass the health check and there was no previous dist to restore." >&2
fi
exit 1
