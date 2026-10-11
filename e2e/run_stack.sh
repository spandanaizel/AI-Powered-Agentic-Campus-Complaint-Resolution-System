#!/bin/bash
# Boots backend + built frontend on a fresh database, seeds it, runs the browser E2E suite, then stops both.
# Requires: MONGODB_URI pointing at a reachable MongoDB server (database name is generated), Python Playwright.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
: "${MONGODB_BASE:=mongodb://127.0.0.1:27017}"
export MONGODB_URI="$MONGODB_BASE/ccrs_e2e_$(date +%s)"
export JWT_SECRET="e2e-$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
export PORT=5000 NODE_ENV=development CORS_ORIGINS=http://localhost:4173 UPLOAD_DIR=/tmp/ccrs-e2e-uploads
export GEMINI_API_KEY="" SEED_ADMIN_EMAIL=admin@campus.example
export SEED_ADMIN_PASSWORD="Adm1n-$RANDOM-e2e" SEED_STAFF_PASSWORD="Staff1-$RANDOM-e2e"

(cd "$ROOT/backend" && node scripts/seed.js > /tmp/ccrs-seed.log)
(cd "$ROOT/backend" && node src/server.js > /tmp/ccrs-api.log 2>&1) & API=$!
(cd "$ROOT/frontend" && npx vite build > /tmp/ccrs-build.log 2>&1 && npx vite preview --port 4173 --strictPort > /tmp/ccrs-preview.log 2>&1) & WEB=$!
trap 'kill $API $WEB 2>/dev/null; pkill -f "vite preview" 2>/dev/null || true' EXIT
for i in $(seq 1 60); do curl -sf localhost:4173/api/health >/dev/null 2>&1 && break; sleep 1; done
curl -sf localhost:4173/api/health || { echo "stack did not start"; tail -20 /tmp/ccrs-api.log /tmp/ccrs-preview.log; exit 1; }
echo
python3 "$ROOT/e2e/run_e2e.py"
