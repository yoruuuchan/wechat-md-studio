#!/usr/bin/env bash
# Emergency purge for the anonymous upload pool.
#
#   sudo bash server-anon-purge.sh [--days N] [--apply]
#
# Default is a DRY RUN: it lists what would go and touches nothing. Only
# --apply deletes, and even then only rows with ownerId=0 (the anonymous
# pool) older than N days (default 30), one object at a time, and only after
# the R2 worker confirmed the delete. Owner uploads are never touched.
#
# This is the stopgap until the real GC lands: it cannot see references that
# live in a visitor's localStorage, so a purged image may still be mentioned
# by an old local draft. That trade is deliberate — anonymous images are
# ephemeral by design, and a filled pool blocks real visitors.
set -euo pipefail

DAYS=30
APPLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --days) DAYS="$2"; shift 2 ;;
    --apply) APPLY=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

DB=/opt/mopai/app/data/mopai.db
ENV_FILE=/opt/mopai/app/.env
IMG_BASE_URL=$(sed -n 's/^IMG_BASE_URL=//p' "$ENV_FILE" | tail -1 | tr -d '"\r')
IMG_ADMIN_KEY=$(sed -n 's/^IMG_ADMIN_KEY=//p' "$ENV_FILE" | tail -1 | tr -d '"\r')
[ -n "$IMG_BASE_URL" ] && [ -n "$IMG_ADMIN_KEY" ] || { echo "IMG_BASE_URL / IMG_ADMIN_KEY missing from $ENV_FILE" >&2; exit 1; }

# files.createdAt is unix SECONDS (the column's sqlite default), not millis.
CUTOFF=$(( $(date -u +%s) - DAYS * 86400 ))
echo "== anonymous images older than $DAYS day(s) (cutoff $CUTOFF) =="
[ "$APPLY" = 1 ] || echo "   DRY RUN — pass --apply to actually delete"

deleted=0
failed=0
bytes=0
while IFS=$'\t' read -r key size created; do
  bytes=$(( bytes + size ))
  if [ "$APPLY" != 1 ]; then
    echo "   would delete $key (${size} B)"
    continue
  fi
  code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE -H "X-Admin-Key: $IMG_ADMIN_KEY" -G --data-urlencode "key=$key" "$IMG_BASE_URL/api/upload")
  if [ "$code" = 200 ] || [ "$code" = 204 ]; then
    node -e 'const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync(process.argv[1]);db.prepare("delete from files where key=? and ownerId=0").run(process.argv[2]);' "$DB" "$key"
    deleted=$(( deleted + 1 ))
    echo "   deleted $key (${size} B)"
  else
    failed=$(( failed + 1 ))
    echo "   FAILED $key (worker replied $code) — row kept" >&2
  fi
done < <(node -e 'const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync(process.argv[1],{readOnly:true});for(const r of db.prepare("select key,size,createdAt from files where ownerId=0 and createdAt < ?").all(Number(process.argv[2]))) console.log([r.key,r.size,r.createdAt].join("\t"));' "$DB" "$CUTOFF")

if [ "$APPLY" = 1 ]; then
  echo "== deleted $deleted object(s), $bytes B candidate(s) seen, $failed failure(s) =="
else
  echo "== $bytes B would be reclaimed; re-run with --apply to delete =="
fi
