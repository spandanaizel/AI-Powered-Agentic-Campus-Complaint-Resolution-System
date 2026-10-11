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

## 2. Create a Gemini API key (optional, for live AI)

The app runs without a key, in demo mode, where every assistant uses clearly labelled rule-based results. To enable Gemini, follow these steps from Google's getting-started guide (checked October 2026):

1. Sign in with a Google account at [Google AI Studio](https://aistudio.google.com/apikey).
2. New users get a project and an API key created automatically: copy it from the **API keys** page. Otherwise click **Create API key** and follow the dialog to create a key for a project.
3. The free tier needs no billing account. Rate limits apply **per project** and are shown on AI Studio's [rate-limit page](https://aistudio.google.com/rate-limit).
4. Put the key in `backend/.env` (created in the next step) as `GEMINI_API_KEY=...`. That file is git-ignored. Never put the key in `frontend/.env`, frontend code, a commit, a screenshot or a chat message. If a key is exposed, delete it in AI Studio and create a new one.
5. Run `npm run verify:gemini` (section 7) to confirm the key and model work.

**Privacy.** Google's pricing page states that content sent on the free tier is used to improve Google's products; on the paid tier it is not. Complaints can contain personal details. The app never sends reporter names or emails, and it asks Google not to store interactions (`store: false`), but the complaint text itself is sent. Use the paid tier or demo mode if that is not acceptable for your campus.

## 3. Configure the backend

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
| `GEMINI_API_KEY` | optional | Enables the live Gemini agents. Create one at [Google AI Studio](https://aistudio.google.com/apikey); the free tier needs no billing account. **Put it only in `backend/.env`**, never in `frontend/.env`. Without it the app runs in demo mode with labelled rule-based fallbacks. |
| `GEMINI_MODEL` | optional | Default `gemini-3.5-flash-lite`: a Stable model listed as "Free of charge" on the free tier on Google's pricing page (checked 2026-10-11). Other free-tier text models on that page include `gemini-3.1-flash-lite`, `gemini-2.5-flash-lite`, `gemini-2.5-flash` and `gemini-3.8-flash`. Google can change free-tier availability; check the pricing page. |
| `AI_TIMEOUT_MS`, `AI_MAX_TOKENS` | optional | Per-call timeout (default 30000 ms, enforced by the app even if a request hangs) and output budget (default 4000). Gemini counts thinking tokens as output; output cut off at the limit falls back with error category `truncated`. |
| `GEMINI_THINKING_LEVEL` | optional | Thinking level for the Interactions API (for example `low`). Empty uses the model's default. |
| `GEMINI_STRUCTURED_OUTPUT` | optional | Default `true`: asks Gemini for JSON matching a schema. Answers are validated with zod either way. If live calls fail with HTTP 400 `invalid_request`, set it to `false`. |
| `GEMINI_MAX_REQUESTS_PER_MINUTE` | optional | Default `10`. An app-side cap that protects the free-tier quota; calls over the cap use the labelled fallback without contacting Google. Set it to your project's limit from AI Studio; `0` disables it. |
| `GEMINI_QUOTA_COOLDOWN_MINUTES` | optional | Default `60`. After a daily-quota error, Gemini is skipped for this long. |
| `GEMINI_BASE_URL` | optional | Only for a proxy, gateway or local test server |
| `ESCALATION_THRESHOLD` | optional | Default `5` (escalates at the 6th distinct reporter) |
| `ESCALATION_WINDOW_DAYS` | optional | Default `30`; `0` counts across all time |
| `AUTO_ASSIGN_ENABLED` | optional | Default `true` |
| `UPLOAD_DIR`, `MAX_UPLOAD_BYTES` | optional | Where photos are stored (keep it outside any public folder) and the size limit |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_STAFF_PASSWORD` | optional | Used only by `npm run seed` |

## 4. Install, seed and start the backend

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

## 5. Start the frontend

```bash
cd frontend
npm ci
npm run dev
```

Open http://localhost:5173. The development server proxies `/api` to `http://localhost:5000`, so the session cookie works. To point it elsewhere, set `VITE_DEV_API_TARGET` in `frontend/.env`.

## 6. Try the main workflows

1. Create a student account and report a problem (Network, Library) with a photo.
2. Sign in as `network.staff@campus.example`. The complaint is in **My queue** (auto-assigned). Open it, add an internal note, draft and send a reply, and **Start work**. Under **Resolution assistance**, ask for troubleshooting steps, write what was done, and run **Review before resolving**. Then **Mark resolved**: the note you wrote fills the required resolution note, which the student will see.
3. Sign in as the student. You see the reply but not the internal note. **Confirm fixed and close**, or **Reopen** with a reason.
4. To see escalation: have six *different* student accounts report the same category and location. The sixth report makes every open complaint about it Critical, and it appears under Admin, **Repeated issues**.
5. As admin, open a complaint and use **Override priority** (a reason is required). Later escalations will not change that complaint.

## 7. Run the checks

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
# Windows PowerShell: see "Windows (PowerShell in VS Code)" below
```

`test:mongodb` runs the whole suite but stops immediately if the server identifies itself as FerretDB. It prints a `[server-identity]` line, so the log records which server was tested. The escalation tests to watch are in `tests/integration/escalation.test.js`: thresholds, distinct counting, 12 and 60 simultaneous submissions, exactly-once escalation, and override protection. Detection covers FerretDB only; other compatible services (Azure Cosmos DB, Amazon DocumentDB) are not detected, so use a genuine MongoDB server.

### Free-tier limits

Google does not publish fixed free-tier numbers. Its rate-limits page (checked 2026-10-11) says limits are measured as requests per minute, input tokens per minute and requests per day. They apply **per project, not per API key**, depend on the project's usage tier, and are shown in [AI Studio](https://aistudio.google.com/rate-limit). Requests-per-day quotas reset at midnight Pacific time. When a limit is hit, Gemini returns `429 RESOURCE_EXHAUSTED`.

This app makes up to **three Gemini calls per new complaint** (summary, priority, and assignment when two or more staff are eligible), plus one per click on a staff assistant. To stay inside free-tier limits:

- **No retries.** The SDK's automatic retries are turned off; by default it retries a `429` four times.
- **App-side cap.** At most `GEMINI_MAX_REQUESTS_PER_MINUTE` calls per minute (default 10). Calls over the cap use the fallback without contacting Google.
- **Cool-down after a `429`.** Per-minute limit (`rate_limit_exceeded` / `too_many_requests`): Gemini is skipped for the `Retry-After` time, or 30 seconds. Daily quota (`quota_exceeded`): skipped for `GEMINI_QUOTA_COOLDOWN_MINUTES` (default 60).

During a pause, assistants show labelled rule-based results, and **Admin → Settings** shows the pause and when it ends. Complaint submission, assignment, escalation and every other workflow carry on unaffected. Runs are logged with error category `rate_limited` or `quota_exceeded`.

### Verify the live Gemini integration (not yet done by the authors)

No live call has been made: no key was available during development, and Google's API host was unreachable from the build environment. With your key in `backend/.env`:

```bash
cd backend
npm run verify:gemini                    # model check + one real generation; no database needed
npm run verify:gemini -- --all-agents    # also one real call per agent task (needs MONGODB_URI)
```

The script:
- calls `models.get` to confirm the key works and `GEMINI_MODEL` exists for it;
- makes one real Interactions API call (`ai.interactions.create`, the API Google's current docs use) with the production summary prompt and JSON schema, and validates the answer with the app's zod schema;
- with `--all-agents`, runs summary, priority, assignment, troubleshooting suggestions, response draft and evidence review through the real agent code, using a temporary `ccrs_verify_ai_*` database that it drops afterwards.

It never prints the key (it reports only the key's length), and it passes every output line through a scrubber. It reports PASS only for real Gemini output, never for a fallback. Exit codes: `0` all passed, `1` a check failed (the line shows why, for example `rate_limited` or a rejected key), `2` skipped because no key is set. The default mode uses 2 API requests; `--all-agents` uses 8, which a strict free-tier per-minute limit could trip. If so, wait a minute and rerun. A pass proves the integration works, not that the advice is good, so read the printed outputs too.

## Windows (PowerShell in VS Code)

The commands above use macOS/Linux syntax. In VS Code on Windows, open **Terminal → New Terminal** (PowerShell) and use these equivalents:

| Task | PowerShell |
|---|---|
| Copy the settings template | `Copy-Item .env.example .env` |
| Generate a `JWT_SECRET` | `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| Genuine-MongoDB test run | `npm run test:mongodb` (uses `mongodb://127.0.0.1:27017` by default). For another server: `$env:MONGODB_TEST_URI="mongodb://..."; npm run test:mongodb` |
| One-off key for a single command | `$env:GEMINI_API_KEY="..."; npm run verify:gemini` (prefer `backend\.env`) |

- Run `npm` commands for the API from the `backend` folder, and for the web app from the `frontend` folder. `backend\.env` is read from the folder you run the command in.
- **"running scripts is disabled on this system"** when typing `npm`: run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once and answer `Y`, or switch the VS Code terminal to Command Prompt (the `˅` next to `+`).
- Create `.env` with `Copy-Item`, not Notepad. Notepad may save it as `.env.txt`, which the app ignores; check with `Get-ChildItem -Force`.
- The browser end-to-end suite (`e2e/run_stack.sh`) is a bash script. It is optional; on Windows run it from Git Bash or WSL with Python Playwright installed.

## 8. Deploying to production

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
| `Invalid configuration: MONGODB_URI is required` / `JWT_SECRET ...` | Fill in `backend/.env` (section 3). The placeholder secret is rejected on purpose. |
| `Could not connect to MongoDB at the configured MONGODB_URI` | MongoDB not running, wrong host or port, wrong Atlas credentials, or IP not allowed. |
| `/api/health` returns 503 `degraded` | The database connection dropped. Requests return 503 with `DB_UNAVAILABLE` until it recovers. |
| Sign-in works but the next request is 401 | Frontend and API are on different sites, or you opened port 5000 instead of 5173 in development. Use the proxy or one domain. |
| 401 "Your session has expired" | The session lifetime (`JWT_TTL`, default 8h) passed, you signed out elsewhere, or an admin changed your role or deactivated you. Sign in again. |
| 429 "Too many sign-in attempts" | More than `LOGIN_RATE_LIMIT_MAX` failed attempts for that email from your IP in 15 minutes. Wait. |
| 403 "Missing X-Requested-With header" | Direct API call without the CSRF header. The frontend sends it automatically. |
| Photo rejected | Only real JPEG, PNG or WebP files up to `MAX_UPLOAD_BYTES` are accepted; the file content is checked, not the extension. |
| Complaints never assigned automatically | No active staff cover the category, everyone is at capacity, or `AUTO_ASSIGN_ENABLED=false`. Check Admin, Staff coverage. |
| Settings shows "Paused after a Gemini rate limit error" | Google returned `429`. Wait for the time shown, lower traffic, or set `GEMINI_MAX_REQUESTS_PER_MINUTE` to your AI Studio limit. A daily-quota pause lasts `GEMINI_QUOTA_COOLDOWN_MINUTES`; quotas reset at midnight Pacific time. |
| Agent runs fail with `auth_error` | The key is wrong, deleted, or lacks permission for the project. Create a new key in AI Studio and run `npm run verify:gemini`. |
| Triage shows "Rule-based, not AI" | Demo mode (`GEMINI_API_KEY` not set), or Gemini calls are failing (timeouts, `429` free-tier limits, invalid key, blocked content). The server log records the error category; Admin, Settings shows whether Gemini is configured. Run `npm run verify:gemini` to test the key and model directly. |
| Agent runs fall back with `rate_limited` | Free-tier per-project limits reached (`429 RESOURCE_EXHAUSTED`). Check AI Studio; wait for the per-minute or daily reset (midnight Pacific time); or enable billing. |
| Agent runs fall back with `blocked` | Gemini declined the prompt or answer for safety reasons. The fallback result is used; the complaint itself is unaffected. |
| Agent runs fail with `truncated` | The model reached `AI_MAX_TOKENS` before finishing (thinking counts too). Raise `AI_MAX_TOKENS`. |
| `verify:gemini` fails at the model check | HTTP 400/401/403: the key is wrong, revoked, or restricted. HTTP 404: `GEMINI_MODEL` is misspelled or not available to your project. Pick a model listed on Google's models page. |
| "A reason is required" when marking resolved | Intended: enter the resolution note. |
| `EADDRINUSE` | Port 5000 (API), 5173 (dev) or 4173 (preview) is taken. Change `PORT` or stop the other process. |
| Backend tests time out at startup | No MongoDB server at `MONGODB_TEST_URI`. |
