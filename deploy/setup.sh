#!/usr/bin/env bash
#
# One-shot provisioning for the Nirantara API on a fresh Debian/Ubuntu VM
# (Google Cloud e2-micro Always Free, or any equivalent box).
#
#   curl -fsSL https://raw.githubusercontent.com/stackeducationorg/nirantara-ipo/main/deploy/setup.sh | sudo bash -s -- api.yourdomain.com you@example.com
#
# Safe to re-run: every step checks for existing state before acting.

set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"
REPO="https://github.com/stackeducationorg/nirantara-ipo.git"
APP_USER="nirantara"
APP_DIR="/opt/nirantara"

if [[ -z "$DOMAIN" || -z "$EMAIL" ]]; then
  echo "usage: sudo bash setup.sh <api-domain> <email-for-letsencrypt>" >&2
  exit 1
fi

if [[ $EUID -ne 0 ]]; then
  echo "run with sudo" >&2
  exit 1
fi

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }

# ---------------------------------------------------------------- swap
# An e2-micro has 1GB of RAM. Chromium alone can ask for more than half of that
# during a page load, so without swap the kernel will kill the API process.
say "Swap"
if ! swapon --show | grep -q '/swapfile'; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  # A low swappiness keeps the VM off swap until it genuinely needs it.
  sysctl -w vm.swappiness=10
  grep -q 'vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf
  echo "2GB swap enabled"
else
  echo "swap already present"
fi

# ---------------------------------------------------------------- packages
say "System packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git nginx certbot python3-certbot-nginx ca-certificates gnupg build-essential

if ! command -v node >/dev/null || [[ "$(node -v | cut -c2-3)" -lt 20 ]]; then
  say "Node.js 22"
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key |
    gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt-get install -y -qq nodejs
fi
echo "node $(node -v)"

# ---------------------------------------------------------------- app user
say "Application user"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"

# ---------------------------------------------------------------- source
say "Source"
if [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" fetch --quiet origin main
  git -C "$APP_DIR" reset --hard --quiet origin/main
else
  git clone --quiet "$REPO" "$APP_DIR"
fi
mkdir -p "$APP_DIR/server/data"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# ---------------------------------------------------------------- build
say "Install and build"
cd "$APP_DIR/server"
# The browser download is skipped here and handled explicitly below, so a failure
# there cannot abort the whole install.
sudo -u "$APP_USER" PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --omit=dev --no-audit --no-fund
sudo -u "$APP_USER" npm install --no-audit --no-fund --silent typescript
sudo -u "$APP_USER" npx tsc -p tsconfig.json
echo "built to server/dist"

# ---------------------------------------------------------------- chromium
say "Chromium for registrar lookups"
if npx --yes playwright@1.49.1 install --with-deps chromium 2>/dev/null; then
  # Playwright installs into root's cache; move it somewhere the service user can read.
  mkdir -p /opt/playwright
  cp -rn /root/.cache/ms-playwright/. /opt/playwright/ 2>/dev/null || true
  chown -R "$APP_USER:$APP_USER" /opt/playwright
  BROWSERS_OK=1
  echo "chromium installed"
else
  BROWSERS_OK=0
  echo "chromium unavailable — continuing with browser registrars disabled"
fi

# ---------------------------------------------------------------- env
say "Environment"
ENV_FILE="$APP_DIR/server/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  KEY="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
  ADMIN="$(node -e 'console.log(require("crypto").randomBytes(24).toString("base64url"))')"
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=4000
DATA_DIR=$APP_DIR/server/data

# Encrypts every stored PAN. Losing this makes existing rows unreadable — back it up.
PAN_ENCRYPTION_KEY=$KEY

# Only these origins may call the API. Add your Vercel URL and any custom domain.
CORS_ORIGINS=https://web-five-delta-87.vercel.app

ADMIN_TOKEN=$ADMIN

ENABLE_JOBS=true
ENABLE_BROWSER_REGISTRARS=$([[ "$BROWSERS_OK" == "1" ]] && echo true || echo false)
BROWSER_HEADLESS=true
PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
EOF
  chown "$APP_USER:$APP_USER" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "wrote $ENV_FILE with a fresh encryption key"
else
  echo "$ENV_FILE already exists — left untouched"
fi

# ---------------------------------------------------------------- service
say "systemd service"
cp "$APP_DIR/deploy/nirantara-api.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now nirantara-api
sleep 4
systemctl is-active --quiet nirantara-api && echo "service running" || {
  echo "service failed to start:"; journalctl -u nirantara-api -n 30 --no-pager; exit 1;
}

# ---------------------------------------------------------------- nginx + TLS
say "nginx and certificate for $DOMAIN"
sed "s/__DOMAIN__/$DOMAIN/g" "$APP_DIR/deploy/nginx.conf" > /etc/nginx/sites-available/nirantara
ln -sf /etc/nginx/sites-available/nirantara /etc/nginx/sites-enabled/nirantara
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

if [[ ! -d "/etc/letsencrypt/live/$DOMAIN" ]]; then
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect
else
  echo "certificate already present"
fi
systemctl reload nginx

say "Done"
echo "  API      https://$DOMAIN/api/health"
echo "  Logs     journalctl -u nirantara-api -f"
echo "  Restart  systemctl restart nirantara-api"
echo
echo "Next: seed the IPO data with"
echo "  cd $APP_DIR/server && sudo -u $APP_USER npx tsx src/cli/sync.ts"
