#!/bin/bash
# DEADWILL Full Deploy — запускать на сервере после rsync
# Usage: bash /opt/deadwill/deploy/deploy.sh

set -e
APP_DIR="/opt/deadwill"
cd "$APP_DIR"

echo "=== [1/6] Installing API dependencies ==="
cd src/api
npm install --production --legacy-peer-deps 2>&1 | tail -3
cd "$APP_DIR"

echo "=== [2/6] Installing miniapp dependencies ==="
cd src/miniapp
npm install --legacy-peer-deps 2>&1 | tail -3

echo "=== [3/6] Building miniapp ==="
VITE_API_BASE="" npm run build 2>&1 | tail -5
cd "$APP_DIR"

echo "=== [4/6] Writing .env ==="
cat > .env << 'ENVEOF'
NODE_ENV=production
PORT=3000
BOT_TOKEN=
MINI_APP_URL=http://194.31.223.100
DATABASE_URL=
INITDATA_TTL=86400
PROJECT_TON_WALLET=UQClkZbsM0SBs3nU6BlPwixHiRBm04lcRCoNClmxkz7YWeHD
TONCENTER_BASE=https://toncenter.com/api/v2
TON_API_KEY=
TON_POLL_MS=20000
ALLOW_DEV_AUTH=1
ENVEOF

echo "=== [5/6] Running DB migrations ==="
node src/api/lib/migrate.js && echo "migrations ok"

echo "=== [6/6] Starting with PM2 ==="
pm2 delete deadwill-api 2>/dev/null || true
pm2 start src/api/index.js --name deadwill-api --env production
pm2 save

echo ""
echo "=== [nginx] Configuring reverse proxy ==="
cat > /etc/nginx/sites-available/deadwill << 'NGINXEOF'
server {
    listen 80 default_server;
    server_name _;

    # Mini App (static)
    location / {
        root /opt/deadwill/src/miniapp/dist;
        index index.html;
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache";
    }

    # API
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 30s;
    }
}
NGINXEOF

ln -sf /etc/nginx/sites-available/deadwill /etc/nginx/sites-enabled/deadwill
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx

echo ""
echo "=========================================="
echo " DEADWILL запущен!"
echo " Mini App: http://194.31.223.100"
echo " API:      http://194.31.223.100/api/health"
echo "=========================================="
pm2 status
