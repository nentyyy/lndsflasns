#!/bin/bash
# DEADWILL Server Setup Script
# Run as root: bash setup_server.sh

set -e

echo "=== DEADWILL Deploy ==="

# 1. Update system
apt-get update -q

# 2. Install Node.js 20 LTS
if ! command -v node &>/dev/null || [[ $(node -e "process.exit(process.version.split('.')[0].replace('v','') < 20 ? 1 : 0)") -ne 0 ]]; then
  echo "Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
node --version
npm --version

# 3. Install PM2 globally
npm install -g pm2 --quiet

# 4. Install nginx
apt-get install -y nginx

# 5. Create app directory
mkdir -p /opt/deadwill
cd /opt/deadwill

# 6. Copy project (run from local machine via rsync before this step)
# rsync -avz --exclude node_modules --exclude .git /local/path/ root@server:/opt/deadwill/

echo "=== Server packages ready ==="
