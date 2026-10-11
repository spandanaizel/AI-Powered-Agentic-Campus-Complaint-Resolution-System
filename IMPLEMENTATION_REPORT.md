# Implementation Report

This report covers the audit of the original *Campus Complaint Management System* source, what was built, how it was verified, and what remains unverified. Every result quoted here comes from a command whose full output is in [`evidence/`](evidence/).

## 1. Verification boundaries (read first)

| Integration | What was done | Status |
|---|---|---|
| **Database** | Every test ran against **FerretDB 1.24** (SQLite backend), a MongoDB wire-protocol server. Genuine MongoDB could not be obtained: MongoDB's download hosts are unreachable from the build environment, the npm and PyPI MongoDB packages only download from those hosts, and Docker is unavailable. | **Genuine MongoDB: UNVERIFIED.** `npm run test:mongodb` runs the full suite and refuses to pass unless the server is genuine MongoDB (shown rejecting FerretDB). |
| **Gemini model and free tier** | Checked against Google's official pages on 2026-10-11. The pricing page lists `gemini-3.5-flash-lite` input and output as "Free of charge" on the free tier. Its model page lists it as **Stable**, with 1,048,576 input and 65,536 output tokens, structured output and thinking. The rate-limits page states that free-tier limits are per project, depend on the usage tier, and are shown only in AI Studio; **no fixed numbers are published**, so none are claimed here. | **Verified against documentation.** Whether *your* project can use the model, and its actual limits, are shown by `npm run verify:gemini` and AI Studio. |
| **Live Gemini calls** | **None made.** No `GEMINI_API_KEY` was available, and `generativelanguage.googleapis.com` is unreachable from the build environment (connection failed, HTTP 000). The adapter, all four agents and `verify:gemini` were tested through the **real `@google/genai` 2.24.0 SDK over real HTTP against a local mock of the Gemini Interactions and models endpoints**. Response and error shapes come from Google's docs, so this proves our code and the SDK work together, not that Google's live service answers identically. | **UNVERIFIED for every agent.** Run `npm run verify:gemini` (and `-- --all-agents`) with your key. |
| **Deployment** | The production build was served with `vite preview` and a proxy for the browser tests. | The nginx example, HTTPS, Docker and Atlas setups were **not run**. |

## 2. Audit of the original source

The uploaded ZIP contained two React 19 + Vite 7 frontends and nothing else. **There was no backend, database, authentication or AI code**, although the original README described all of them.

| Area | Found | Status | Action |
|---|---|---|---|
| Student frontend (`campus-project/`) | Login form, dashboard, raise complaint with image, list, delete | **Build broken** on case-sensitive filesystems (`./Pages/Login` vs `pages/`, `styles.css` vs `Styles.css`); 1 lint error; "login" accepted any input; all state lost on refresh | Merged into the unified app |
| Admin frontend (`campus-admin-frontend/`) | Dashboard, complaint list and details, assign staff, categories, new complaint, reports, settings | Built (600 kB chunk warning), lint clean; **every figure and record hard-coded**; no login; `/` blank; "Assign" linked to a missing route; forms did nothing or showed `alert("(mock)")`; dropdown values mismatched saved values | Used as the base of the unified app |
| Staff experience | None | Absent | Added |
| Backend, database, auth | None | Absent | Built new (no existing code to preserve) |
| AI agents | None | Absent | Built all four |
| Escalation rule | `data/priority.js`: counted complaints per category `>= 5`, never imported | Wrong and unused | Replaced |

Baseline evidence: the student `npm run build` failed with `Could not resolve "./Pages/Login"`; the admin build passed with a chunk-size warning.

## 3. What was built

**Backend** (`backend/`, Express 5, Mongoose 8, about 2,600 lines including tests). Routes, controllers and services are separated. The models are users, categories, locations, complaints, comments, issue groups, issue reporters, issue escalations, an append-only audit log, and agent runs. Uploads are images only, checked by file signature, stored outside any public folder under random names, and served only through an authorization check. Every endpoint, role and error is documented in [API_CONTRACTS.md](API_CONTRACTS.md).

**Unified frontend** (`frontend/`, React 19, Vite 7, React Router 7). One application with Student, Staff and Admin portals, built on the admin app's structure, dependencies and lockfile. It covers the role-specific navigation, a mobile drawer, a skip link, focus management on navigation, a 404 page, loading skeletons, empty and error states with retry, inline form validation, toast messages, accessible confirmation dialogs, and an error boundary. Admin chart code loads only on admin pages.

**Design.** Public Sans is self-hosted, and the palette is built from the original admin blue. Each complaint row has a priority edge band; escalated issues use a striped band, so the repeated-issue rule is visible at a glance. The original's four coloured stat cards were replaced by a single figure strip.

**Feature mapping from the originals.**

| Original | Now |
|---|---|
| Student login (accepted anything) | Real registration and sign-in; staff and admin accounts created by admins |
| Student dashboard counts | Live counts from the API |
| Raise complaint with image | Kept, with server-side validation and an image preview |
| Student "delete complaint" | **Retired.** Deleting would erase the audit trail and the reporter counts. Students can close a resolved complaint; admins can reject one with a reason. |
| Admin dashboard (hard-coded) | Live figures and charts, plus a "waiting for assignment" list |
| Admin complaint list and details | Search, filters, sorting and pagination in the URL; working status changes, assignment, priority override and comments |
| Assign staff (category → team, local storage) | **Staff coverage**: which categories each staff member handles, and their capacity, stored on the server |
| Categories page | Categories and locations, with add, hide and restore |
| Admin "add new complaint" | **Retired.** A complaint must belong to a student account so that distinct reporters can be counted correctly. |
| Reports (static) | Date-filtered reports from stored data, with CSV download |
| Settings: profile, user list, "enable student accounts" toggle | Read-only configuration view and a full Users page (create staff and admins, deactivate and reactivate). The global toggle was **retired** in favour of per-account deactivation. |
| `Profile.jsx` (never routed, external avatar images) | A Profile page for every role, with no external images |

The original frontend folders are not in the final package. The unified build and the critical workflows were verified first (section 6). The originals remain in the uploaded source ZIP.

## 4. The repeated-issue escalation rule

- **Same issue:** the same category and the same location, both from admin-managed lists. Free text is never used to group complaints.
- **Count:** distinct reporter accounts in the issue's current *generation*. Each (issue, generation, student) pair is a row with a unique index, so repeat or simultaneous submissions by one student count once.
- **Rule:** more than `ESCALATION_THRESHOLD` (default 5) distinct reporters escalates the issue. The sixth person triggers it.
- **Exactly once:** the escalation itself is a row with a unique index per issue generation. Only one concurrent request can create it, so only one escalation audit event is written.
- **Effect:** every open complaint in that generation is set to `Critical`, the highest priority. This includes complaints reported after escalation. Each change is audited and visible to the student. The rule is applied idempotently, so concurrent requests converge on the same result.
- **Manual overrides are protected:** a complaint whose priority an admin set (`prioritySource: override`) is never changed by escalation. AI priority predictions never override escalation or a manual override.
- **Window:** a not-yet-escalated issue counts reports within `ESCALATION_WINDOW_DAYS` (default 30) of its first report; `0` means all time. An escalated issue stays escalated until an admin closes it, which archives the count and starts a new generation.

**A design problem found by testing.** The first version counted reporters with `$addToSet` on a single document. That operation is atomic on genuine MongoDB, but the concurrency tests on FerretDB lost updates: 12 simultaneous reports recorded only 4 to 6 reporters. The design was rebuilt on unique indexes, after checking that FerretDB enforces them under concurrency (40 parallel inserts of 8 distinct keys stored exactly 8). This version is correct on any server that enforces unique indexes. It still needs confirming on genuine MongoDB.

## 5. AI agents

**Provider: Google Gemini (Developer API), replacing Anthropic Claude.** The Anthropic adapter, its live-check script and its tests were removed. The new adapter (`backend/src/agents/providers/gemini.js`) uses Google's official **`@google/genai` SDK, pinned to 2.24.0** (published 2026-09-22; the newest release older than two weeks at the time). The default model is **`gemini-3.5-flash-lite`** (section 1). The adapter exposes the same `complete()` interface as before, so all four agents, their prompts, their zod output schemas, their rule-based fallbacks and the `AgentRun` audit log are unchanged. Model output is now labelled `source: "gemini"`. The legacy value `anthropic` is still accepted in stored records, and the interface treats any non-fallback source as AI output.

**How the adapter behaves** (each point checked against the real SDK with a local mock of the Gemini API):
- **API:** one **Interactions API** call per task (`ai.interactions.create`), the API Google's current getting-started and text-generation guides use. An earlier, unshipped draft of this adapter used the older `models.generateContent`; it was replaced before delivery.
- **Request:** `system_instruction`; `store: false` (Google is asked not to keep the interaction); `generation_config` with `max_output_tokens` (`AI_MAX_TOKENS`, default 4,000, since thinking counts as output), `temperature: 0.2` and an optional `thinking_level`; and `response_format` with `mime_type: application/json` plus a per-agent JSON schema.
- **Schemas:** limited to `type`, `properties`, `items`, `enum` and `required`, the subset shown in Google's examples. For assignment, the staff-ID field is an enum of the validated candidates. `GEMINI_STRUCTURED_OUTPUT=false` drops the schema if a live deployment rejects it, and zod validates every answer either way.
- **Key handling:** read from `GEMINI_API_KEY` in `backend/.env` only. The SDK sends it in the `x-goog-api-key` header, never the URL (tested). It is scrubbed from error text, never stored in agent runs or complaints, never returned by the API, and never sent to the browser (tested; the built bundle contains no Gemini key or endpoint).
- **No retries.** The Interactions client retries a `429` four times by default: 5 requests over 6.8 s, measured against the mock. The adapter passes `maxRetries: 0`, giving 1 request that fails in milliseconds.
- **Free-tier protection:**
  - an app-side cap (`GEMINI_MAX_REQUESTS_PER_MINUTE`, default 10);
  - after a per-minute `429`, a pause for `Retry-After` or 30 s;
  - after a daily `quota_exceeded`, a pause for `GEMINI_QUOTA_COOLDOWN_MINUTES` (default 60).
  
  During a pause no request reaches Google, and agents fall back at once. Admin → Settings shows the pause.
- **Timeout guaranteed by the app:** its own deadline (`AI_TIMEOUT_MS`, default 30 s), raced against the call and aborting it.
- **Error mapping** (codes from Google's API-errors page):
  - `401`/`403` → `auth_error`;
  - `429 quota_exceeded` → `quota_exceeded`, and other `429`s → `rate_limited`;
  - safety/policy codes (`safety`, `spii`, `prohibited_content` and others) → `blocked`;
  - `404` → `provider_error` ("model not found");
  - `5xx`, other errors and network failures → `provider_error`;
  - an `incomplete` interaction → `truncated`; a `failed` one → `provider_error`;
  - no text → `malformed_output`.
  
  Thought steps are excluded from the answer.

**The four agents (unchanged responsibilities and guardrails):**

| Agent | Guardrails |
|---|---|
| Summary | Complaint text is wrapped and declared to be data, not instructions (prompt-injection defence). Output is schema-validated. The original text is shown alongside and never rewritten. |
| Priority | Uses safety, impact and urgency only. Applied only while the priority is automatic, never over escalation or an override. |
| Assignment | The model may only choose from validated candidates (active staff covering the category with spare capacity); any other choice is rejected and the least-loaded rule is used. With no candidate, the complaint stays in the admin queue. |
| Resolution and Response | Troubleshooting suggestions (with a deterministic hazard safety-note guardrail), an editable reply draft that is never sent automatically, and an evidence review that is always `verified: false` because it reads text only. Staff or the assignee approve every send and status change. |

**Demo mode.** With no `GEMINI_API_KEY`, every agent returns its labelled rule-based fallback and logs `no_provider`. The admin Settings page shows "Not configured (demo mode)". All features keep working.

**Free-tier considerations.** A new complaint uses up to three Gemini calls (summary, priority, and assignment when two or more staff are eligible), plus one per staff click on an assistant. Google publishes free-tier rate limits per project in AI Studio, not as fixed numbers in its docs, so the default cap of 10 per minute is a conservative assumption, not a documented limit. Per Google's pricing page, free-tier content is used to improve Google's products. Reporter names and emails are never sent, but complaint text is, so use the paid tier or demo mode if that is unacceptable.

## 6. Test evidence

All results below are from the final clean-install run; full output is in `evidence/`.

| Check | Command | Result | Evidence |
|---|---|---|---|
| Backend lint | `npm run lint` | Clean | `01-backend-lint.txt` |
| Backend unit and integration tests (**FerretDB**) | `npm test` | **108/108 pass** (12 files); run logs `[server-identity] product=FerretDB v1.24.0` | `02-backend-tests.txt` |
| Genuine-MongoDB guard | `npm run test:mongodb` against FerretDB | **Refused, as designed** | `02b-verification-tools.txt` |
| Live Gemini check | `npm run verify:gemini` | **Skipped, exit 2: no API key** (and Google's API host unreachable from this environment) | `02b-verification-tools.txt` |
| Frontend lint | `npm run lint` | Clean | `03-frontend-lint.txt` |
| Frontend tests | `npm test` | **25/25 pass** (4 files) | `04-frontend-tests.txt` |
| Frontend production build | `npm run build` | Pass | `05-frontend-build.txt` |
| Escalation suite repeated | 10 consecutive runs | **10/10 runs pass all 15 tests** | `06-escalation-stress.txt` |
| Browser end-to-end (Chromium, real stack, demo mode) | `e2e/run_stack.sh` | **89/89 checks pass** | `07-e2e-browser.txt`, `07-e2e-results.json` |
| Accessibility (axe-core, 13 rendered pages) | within the E2E run | **0 violations** | `07-e2e-results.json` |
| Secrets in frontend bundle/source; Google key pattern anywhere in tree | grep | **None found** | `08-security-and-typecheck.txt` |
| Dependency audit, production (incl. `@google/genai`) | `npm audit --omit=dev` | **0 vulnerabilities** | `08-security-and-typecheck.txt` |
| Type checking | n/a | Not applicable (JavaScript, no TypeScript setup) | `08-security-and-typecheck.txt` |

**Gemini tests (33 backend tests).** Every one runs the real `@google/genai` 2.24.0 SDK over real HTTP against a local mock of the Gemini Interactions and models endpoints (`tests/mockGemini.js`). **None calls Google.**

- **Adapter** (`tests/unit/geminiProvider.test.js`, 19 tests):
  - **Request shape:** exactly one Interactions request; key in the `x-goog-api-key` header and never in the URL; `store: false`, `system_instruction`, `generation_config` and a JSON-schema `response_format`; an optional `thinking_level`; structured output can be switched off; thought steps are excluded from the answer.
  - **Error mapping, with one request each (no retries) and the key never in error text:** `401` and `403` → `auth_error`; `safety` and `spii` → `blocked`; `404`, `500`, `503`, `504` and `invalid_request` → `provider_error`; `incomplete` → `truncated`; `failed` → `provider_error`; empty output → `malformed_output`; a hung request → `timeout`.
  - **Rate limits:** a per-minute `429` honours `Retry-After` with no calls during the pause; 30 s without the header; the daily `quota_exceeded` gets its own category and a 60-minute pause; the app-side cap blocks extra calls (and `0` disables it).
  - **Model check:** passes when the model exists, and fails cleanly on `404`.
- **Agents** (`tests/integration/geminiAgents.test.js`, 9 tests):
  - Summary, priority and assignment succeed with `source: "gemini"`. Every request uses `store: false` and JSON output, and the assignment schema's enum equals exactly the eligible staff IDs. The reporter's email is never sent.
  - All three Resolution and Response tasks succeed on Gemini and change nothing: no status change, no message sent.
  - Output that fails zod validation falls back, labelled.
  - **Core workflows survive Gemini failures:** for a per-minute `429`, the daily quota, an invalid key (`401`) and a `503`, submitting a complaint through the API still returns `201` and the complaint is still auto-assigned by the deterministic rule, with the AI runs logged as fallbacks under the right category.
  - After a `429`, later complaints fall back without calling Gemini.
  - The key is never stored in agent runs or complaints, nor returned by `/api/settings`.
- **Verify script** (`tests/integration/verifyGeminiScript.test.js`, 5 tests, run as a real process): default mode 2/2; `--all-agents` 8/8 (7 Interactions calls plus the model check); exit 1 when the model is missing (no generation attempted) or when rate-limited; exit 2 and "UNVERIFIED" with no key; the key never appears in output.

**Preserved behaviour, re-verified in the same run:**
- **Escalation rule:** the >5-distinct-reporter rule, including concurrency and override protection (15 tests, 10/10 repeated runs).
- **Permissions and data protection:** role-based permissions and IDOR protection, mass-assignment rejection, and audit logs.
- **Human approval:** agents never send messages or change status; resolving requires a note; the evidence review is never "verified".
- **Validation:** zod checks every model answer.
- **The full browser suite.**

**Defects found and fixed in this round:**
- The previous, unshipped Gemini draft used the older `models.generateContent` API and a `thinkingBudget` setting. It was rebuilt on the Interactions API that Google's current guides use, with `store: false`, per-agent JSON schemas and `thinking_level`.
- The SDK's default of retrying a `429` four times would have multiplied free-tier quota use. Retries are now off.
- There was no protection against repeatedly hitting an exhausted quota. The app-side cap and the cool-downs were added, and daily quota is now distinguished from per-minute limits.
- Rejected keys were reported as generic `provider_error`; they now have their own `auth_error` category.
- `npm run test:mongodb` used `VAR=value command` syntax, which fails in Windows PowerShell and Command Prompt. It now runs through a small cross-platform Node script (`backend/scripts/test-mongodb.js`) with the same behaviour.
- The settings test assumed the old provider-status shape and was updated for the new cool-down fields. Test names that claimed escalation coverage they didn't assert were corrected.

## 7. Configuration decisions

- **Session:** an httpOnly, SameSite=Strict JWT cookie, plus a required `X-Requested-With` header on unsafe methods (CSRF defence). Roles are reloaded from the database on every request. A token version revokes sessions on sign-out, role change or deactivation. Sign-out ends all of a user's sessions.
- **Lifecycle:** Submitted → Reviewed → Assigned → In Progress → Resolved → Closed, with Rejected and reason-required reopen paths (table in API_CONTRACTS.md). Resolving requires a resolution note. Students can confirm or reopen their own resolved complaints.
- **Priorities:** Low, Medium, High, Critical. Critical is the highest and is used by escalation.
- **Defaults:** escalation threshold 5, window 30 days, automatic assignment on, model `gemini-3.5-flash-lite` (Google Gemini free tier) with a 4,000-token budget, a 30 s app-enforced timeout, no automatic retries, an app-side cap of 10 Gemini requests per minute, and a 60-minute pause after a daily-quota error, 8-hour sessions, 5 MB images. All are configurable in `backend/.env`.

## 8. Known limitations and remaining work

**Unverified (required before relying on the system):**

1. **Live Gemini calls, for every agent.** None were made: no `GEMINI_API_KEY` was available, and `generativelanguage.googleapis.com` is unreachable from the build environment. Run `npm run verify:gemini`, then `npm run verify:gemini -- --all-agents`. A pass shows the integration works; a person should still review the quality of real outputs. Specific points only a live call can confirm:
   - that Google accepts the JSON schemas (if not, set `GEMINI_STRUCTURED_OUTPUT=false`);
   - whether `incomplete` is the status Google uses for token-limit cut-offs;
   - whether real 429 responses include `Retry-After`.
2. **Free-tier limits for your project.** Google shows these only in AI Studio. The default cap of 10 requests per minute is an assumption; set `GEMINI_MAX_REQUESTS_PER_MINUTE` to your actual limit.
3. **Genuine MongoDB.** Never run here. Run `MONGODB_TEST_URI=... npm run test:mongodb` against a real MongoDB 6+ server. FerretDB already behaved differently once (section 4), and server detection covers FerretDB only.

**Privacy and policy:**

4. **Free-tier data use.** Google's pricing page states that free-tier content is used to improve Google's products. Reporter names and emails are never sent and `store: false` is requested, but complaint text is sent. Use the paid tier or demo mode if that is unacceptable.

**Limits of the implementation:**

5. **Cool-downs and the app-side cap are per server process.** Several backend instances would each keep their own count; free-tier limits are per Google project.
6. **The evidence review does not verify evidence.** It reads text only, cannot inspect photos, and there is no upload for photos of the fix.
7. **Dev-only advisories remain** in `vitest` 3 and its dependencies (`tinypool` critical, `@vitest/mocker` moderate). They are never shipped; vitest 5.0.3 is deferred under the two-week rule.
8. **Other missing features:**
   - no notifications;
   - no manual re-grouping of issues;
   - no password reset or self-service profile editing.
9. **Scale and edge cases:**
   - sorting by priority happens in memory, and the issues list is capped at 200 groups;
   - rare window race: if the counting window lapses while several reports arrive at the same moment, one may be counted in the old generation;
   - signed-out pages log one expected 401 to the browser console.
10. **Operations:**
    - attachments use local disk;
    - the browser suite requires Python Playwright;
    - the nginx, HTTPS, Docker and Atlas instructions were not run.
