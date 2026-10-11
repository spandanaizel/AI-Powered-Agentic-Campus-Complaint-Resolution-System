# Execution Guide

Step-by-step instructions to install, configure, run, test and deploy the system from a clean extraction of the ZIP.

## 1. Install prerequisites

| Tool | Version | Check |
|---|---|---|
| Node.js | 20 or newer (tested on 22.22) | `node -v` |
| npm | 10 or newer | `npm -v` |
| MongoDB | 6 or newer | `mongosh --eval "db.version()"` |

Choose one way to get MongoDB:

- **Local install:** follow the MongoDB Community Server instructions for your OS, then start the service. The default URI is `mongodb://127.0.0.1:27017`.
- **Docker:** `docker run -d --name ccrs-mongo -p 27017:27017 -v ccrs-mongo:/data/db mongo:7`
- **MongoDB Atlas:** create a cluster and a database user, allow your IP, and copy the `mongodb+srv://` connection string.

> These setup routes are standard MongoDB options. They were not exercised in the build sandbox, which had no MongoDB server; the code was tested against FerretDB 1.24, a MongoDB-compatible server.

## 2. Configure the backend

```bash
cd backend
cp .env.example .env
```

Edit `backend/.env`:

| Variable | Required | What to put |
|---|---|---|
| `MONGODB_URI` | yes | For example `mongodb://127.0.0.1:27017/campus_complaints` or your Atlas URI with a database name |
| `JWT_SECRET` | yes | A random string of at least 32 characters. Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. The placeholder is rejected. |
| `CORS_ORIGINS` | dev default fine | Exact origin(s) of the frontend, comma-separated |
| `COOKIE_SECURE` | production | `true` when served over HTTPS |
| `ANTHROPIC_API_KEY` | optional | Enables live AI agents. Without it, agents use labelled non-AI fallbacks. |
| `ANTHROPIC_MODEL` | optional | Default `claude-haiku-5-5`, a current Claude API model ID per Anthropic's models page (checked October 2026) |
| `AI_TIMEOUT_MS`, `AI_MAX_TOKENS` | optional | Per-call timeout (default 30000) and output budget (default 4000). Current models think adaptively, and thinking counts against the budget; output cut off at the limit falls back with error category `truncated`. |
| `ANTHROPIC_BASE_URL` | optional | Only for a proxy or gateway |
| `ESCALATION_THRESHOLD` | optional | Default `5` (escalates at the 6th distinct reporter) |
| `ESCALATION_WINDOW_DAYS` | optional | Default `30`; `0` counts across all time |
| `AUTO_ASSIGN_ENABLED` | optional | Default `true` |
| `UPLOAD_DIR`, `MAX_UPLOAD_BYTES` | optional | Where photos are stored (keep it outside any public folder) and the size limit |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_STAFF_PASSWORD` | optional | Used only by `npm run seed` |

## 3. Install, seed and start the backend

```bash
cd backend
npm ci
npm run seed
npm run dev
```

`npm run seed` is safe to run repeatedly. It creates five categories (Network, Hostel, Infrastructure, Security, Electricity, carried over from the original admin frontend), eight campus locations, one administrator, and one staff account per category. If the seed passwords are not set in `.env`, random passwords are generated and **printed once**; store them securely. Existing accounts are never modified.

Check the API: `curl http://localhost:5000/api/health` should return `{"status":"ok","db":"connected"}`.

### Accounts for trying the system

| Role | How to get one |
|---|---|
| Admin | `SEED_ADMIN_EMAIL` (default `admin@campus.example`) with the seeded password |
| Staff | `network.staff@campus.example`, `hostel.staff@…`, `infrastructure.staff@…`, `security.staff@…`, `electricity.staff@…` with the seeded password |
| Student | Use **Create one** on the sign-in page |

Admins can create more staff and admin accounts under **Users**, and set which categories each staff member handles under **Staff coverage**.

## 4. Start the frontend

```bash
cd frontend
npm ci
npm run dev
```

Open http://localhost:5173. The development server proxies `/api` to `http://localhost:5000`, so the session cookie works. To point it elsewhere, set `VITE_DEV_API_TARGET` in `frontend/.env`.

## 5. Try the main workflows

1. Create a student account and report a problem (Network, Library) with a photo.
2. Sign in as `network.staff@campus.example`. The complaint is in **My queue** (auto-assigned). Open it, add an internal note, draft and send a reply, and **Start work**. Under **Resolution assistance**, ask for troubleshooting steps, write what was done, and run **Review before resolving**. Then **Mark resolved**: the note you wrote fills the required resolution note, which the student will see.
3. Sign in as the student. You see the reply but not the internal note. **Confirm fixed and close**, or **Reopen** with a reason.
4. To see escalation: have six *different* student accounts report the same category and location. The sixth report makes every open complaint about it Critical, and it appears under Admin, **Repeated issues**.
5. As admin, open a complaint and use **Override priority** (a reason is required). Later escalations will not change that complaint.

## 6. Run the checks

```bash
# Backend: lint, then unit + integration tests (needs a MongoDB server at MONGODB_TEST_URI)
cd backend
npm run lint
MONGODB_TEST_URI=mongodb://127.0.0.1:27017 npm test

# Frontend: lint, tests (no server needed), production build
cd ../frontend
npm run lint
npm test
npm run build
```

The backend tests create uniquely named `ccrs_test_*` databases and drop them afterwards. Do not point `MONGODB_TEST_URI` at a production server.

### Verify against genuine MongoDB (not yet done by the authors)

All recorded test runs used FerretDB, a MongoDB-compatible server, because no genuine MongoDB server was available in the build environment. To close that gap:

```bash
# Any genuine MongoDB 6+ server, e.g.  docker run -d -p 27017:27017 mongo:7
cd backend
MONGODB_TEST_URI=mongodb://127.0.0.1:27017 npm run test:mongodb
```

`test:mongodb` runs the whole suite but stops immediately if the server identifies itself as FerretDB. It prints a `[server-identity]` line, so the log records which server was tested. The escalation tests to watch are in `tests/integration/escalation.test.js`: thresholds, distinct counting, 12 and 60 simultaneous submissions, exactly-once escalation, and override protection. Detection covers FerretDB only; other compatible services (Azure Cosmos DB, Amazon DocumentDB) are not detected, so use a genuine MongoDB server.

### Verify the live Anthropic integration (not yet done by the authors)

No live call has been made, because no API key was available during development. With a key:

```bash
cd backend
ANTHROPIC_API_KEY=your-key MONGODB_URI=mongodb://127.0.0.1:27017/anything npm run verify:anthropic
```

Prefer putting the key in `backend/.env` or your shell's secret store rather than typing it on a shared machine. The script:
- asks the Models API whether `ANTHROPIC_MODEL` is available to your key;
- makes one real call for each agent task: summary, priority, assignment, troubleshooting suggestions, response draft, and evidence review;
- uses a temporary `ccrs_verify_ai_*` database and drops it afterwards;
- never prints the key.

It reports PASS only when the output came from Anthropic, not from a fallback. Exit codes: `0` all passed, `1` something failed (the line shows the error category), `2` skipped because no key was set. Each run costs a few cents at most with the default model. Read the printed outputs as well: a passing call proves the integration works, not that the advice is good.

**Browser end-to-end suite** (optional; boots the whole stack on a fresh `ccrs_e2e_*` database, seeds it, and drives Chromium):

```bash
pip install playwright && playwright install chromium
cd e2e && npm ci && cd ..
MONGODB_BASE=mongodb://127.0.0.1:27017 e2e/run_stack.sh
```

Results and screenshots are written to `e2e/results/`. Ports 5000 and 4173 must be free.

## 7. Deploying to production

The frontend is a static build. The API is a Node process. Serve both **from the same site** over HTTPS, because the session cookie is `SameSite=Strict`.

1. Build the frontend: `cd frontend && npm ci && npm run build`. Output is in `frontend/dist/`.
2. Run the backend with `NODE_ENV=production`, `COOKIE_SECURE=true`, `CORS_ORIGINS=https://your.domain`, and a process manager (systemd, pm2, or a container). In production the app trusts one reverse-proxy hop for client IPs (rate limiting).
3. Put a reverse proxy in front. An example nginx server block (an example only; it was not deployed or tested as part of this work):

```nginx
server {
  listen 443 ssl;
  server_name complaints.example.edu;
  # ssl_certificate / ssl_certificate_key ...
  client_max_body_size 6m;                     # slightly above MAX_UPLOAD_BYTES
  root /srv/ccrs/frontend/dist;
  location /api/ { proxy_pass http://127.0.0.1:5000; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
  location / { try_files $uri /index.html; }   # client-side routing fallback
}
```

4. Persist and back up `UPLOAD_DIR` and the MongoDB database.
5. Run `npm run seed` once against the production database, then change the seeded passwords by creating real accounts and deactivating the defaults if you prefer.

The site serves `robots.txt` with `Disallow: /` and a `noindex` meta tag, because every page sits behind sign-in. No sitemap is provided for the same reason.

## Common errors

| Symptom | Cause and fix |
|---|---|
| `Invalid configuration: MONGODB_URI is required` / `JWT_SECRET ...` | Fill in `backend/.env` (section 2). The placeholder secret is rejected on purpose. |
| `Could not connect to MongoDB at the configured MONGODB_URI` | MongoDB not running, wrong host or port, wrong Atlas credentials, or IP not allowed. |
| `/api/health` returns 503 `degraded` | The database connection dropped. Requests return 503 with `DB_UNAVAILABLE` until it recovers. |
| Sign-in works but the next request is 401 | Frontend and API are on different sites, or you opened port 5000 instead of 5173 in development. Use the proxy or one domain. |
| 401 "Your session has expired" | The session lifetime (`JWT_TTL`, default 8h) passed, you signed out elsewhere, or an admin changed your role or deactivated you. Sign in again. |
| 429 "Too many sign-in attempts" | More than `LOGIN_RATE_LIMIT_MAX` failed attempts for that email from your IP in 15 minutes. Wait. |
| 403 "Missing X-Requested-With header" | Direct API call without the CSRF header. The frontend sends it automatically. |
| Photo rejected | Only real JPEG, PNG or WebP files up to `MAX_UPLOAD_BYTES` are accepted; the file content is checked, not the extension. |
| Complaints never assigned automatically | No active staff cover the category, everyone is at capacity, or `AUTO_ASSIGN_ENABLED=false`. Check Admin, Staff coverage. |
| Triage shows "Rule-based, not AI" | `ANTHROPIC_API_KEY` not set, or calls are failing (timeouts, rate limits, invalid key). The server log records the error category; Admin, Settings shows whether a provider is configured. Run `npm run verify:anthropic` to test the key and model directly. |
| Agent runs fail with `truncated` | The model reached `AI_MAX_TOKENS` before finishing (thinking counts too). Raise `AI_MAX_TOKENS`. |
| `verify:anthropic` fails at the model check | The key cannot use `ANTHROPIC_MODEL` (wrong ID, or not enabled for your organisation). Pick a model ID listed for your account. |
| "A reason is required" when marking resolved | Intended: enter the resolution note. |
| `EADDRINUSE` | Port 5000 (API), 5173 (dev) or 4173 (preview) is taken. Change `PORT` or stop the other process. |
| Backend tests time out at startup | No MongoDB server at `MONGODB_TEST_URI`. |
