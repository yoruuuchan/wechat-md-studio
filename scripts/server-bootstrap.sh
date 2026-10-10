#!/usr/bin/env bash
# Bootstrap the Reed host on cc-tokyo-01. Idempotent — safe to re-run.
#
#   app user        : mopai (no login shell)
#   app dir         : /opt/mopai/app   (dist/ + .env + data/)
#   port            : 3100 (3000 is taken by another service)
#   tunnel unit     : cloudflared-mopai.service -> wechat.yoru-and-akari.dev
set -euo pipefail

TUNNEL_ID=1c05edf4-f1f1-4156-9aa2-8a1ddca0fa14
APP_USER=mopai
APP_DIR=/opt/mopai/app
HOSTNAME_APP=wechat.yoru-and-akari.dev
PORT=3100

echo "== 1. app user =="
if id "$APP_USER" >/dev/null 2>&1; then
  echo "user $APP_USER exists"
else
  sudo useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
  echo "created user $APP_USER"
fi

echo "== 2. directories =="
sudo mkdir -p /opt/mopai/app /opt/mopai/backups
sudo chown -R "$APP_USER:$APP_USER" /opt/mopai
sudo chmod 750 /opt/mopai

echo "== 3. cloudflared credentials =="
if [ -f /tmp/mopai-tunnel-secret ]; then
  SECRET=$(cat /tmp/mopai-tunnel-secret)
  sudo tee /etc/cloudflared/mopai-tunnel.json >/dev/null <<JSON
{"AccountTag":"5e96dfd2bf22d385e4ffdaa794d74676","TunnelSecret":"$SECRET","TunnelID":"$TUNNEL_ID"}
JSON
  sudo chmod 600 /etc/cloudflared/mopai-tunnel.json
  shred -u /tmp/mopai-tunnel-secret 2>/dev/null || rm -f /tmp/mopai-tunnel-secret
  echo "wrote /etc/cloudflared/mopai-tunnel.json"
else
  echo "no staged secret; keeping existing credentials file if present"
  sudo test -f /etc/cloudflared/mopai-tunnel.json || { echo "MISSING credentials and no secret staged"; exit 1; }
fi

echo "== 4. cloudflared config =="
sudo tee /etc/cloudflared/mopai.yml >/dev/null <<YML
tunnel: $TUNNEL_ID
credentials-file: /etc/cloudflared/mopai-tunnel.json

ingress:
  - hostname: $HOSTNAME_APP
    service: http://127.0.0.1:$PORT
  - service: http_status:404
YML
sudo chmod 644 /etc/cloudflared/mopai.yml

echo "== 5. systemd unit =="
sudo tee /etc/systemd/system/cloudflared-mopai.service >/dev/null <<UNIT
# /etc/systemd/system/cloudflared-mopai.service
[Unit]
Description=Cloudflare Tunnel for Reed
After=network-online.target mopai.service
Wants=network-online.target
Requires=mopai.service

[Service]
Type=simple
ExecStart=/usr/local/bin/cloudflared --no-autoupdate --config /etc/cloudflared/mopai.yml tunnel run
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
UNIT

echo "== 6. app systemd unit =="
sudo tee /etc/systemd/system/mopai.service >/dev/null <<UNIT
# /etc/systemd/system/mopai.service
[Unit]
Description=芦苇 WeChat Markdown Studio
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
ExecStart=/usr/bin/node dist/boot.js
Restart=on-failure
RestartSec=3s
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$APP_DIR/data
MemoryMax=384M

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
echo "== 7. state =="
echo "app user: $(id $APP_USER)"
ls -la /opt/mopai/app
sudo systemctl is-enabled mopai.service 2>/dev/null || echo "mopai.service not enabled yet (waiting for release)"
