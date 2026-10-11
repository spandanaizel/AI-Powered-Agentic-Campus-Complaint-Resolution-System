# Implementation Report

This report covers the audit of the original *Campus Complaint Management System* source, what was built, how it was verified, and what remains unverified. Every result quoted here comes from a command whose full output is in [`evidence/`](evidence/).

## 1. Verification boundaries (read first)

| Integration | What was done | Status |
|---|---|---|
| **Database** | Every test ran against **FerretDB 1.24** (SQLite backend), which speaks the MongoDB wire protocol. Getting genuine MongoDB was attempted and failed: the official hosts (`fastdl.mongodb.org`, `repo.mongodb.org`, `downloads.mongodb.com`, `www.mongodb.com`) are unreachable from the build environment; the npm and PyPI packages that provide MongoDB only download from those hosts; GitHub carries source code, not server builds; and Docker is unavailable. | **Genuine MongoDB: UNVERIFIED.** `npm run test:mongodb` runs the full suite and refuses to pass unless the server is genuine MongoDB (it was shown to reject FerretDB). |
| **Anthropic model ID** | `claude-haiku-5-5` was checked against Anthropic's official models page (platform.claude.com, fetched October 2026): it is a current Claude API ID for Claude Haiku 5.5. That page also says current models think adaptively by default, which led to the token-budget and truncation handling in section 5. | **Verified against documentation.** Whether *your* key can use it is checked by `npm run verify:anthropic`. |
| **Live Anthropic calls** | **No API key was available** in the environment, so no live call was made. Agents were tested with a simulated provider. The live-check script was tested end to end over real HTTP against a local mock of the Anthropic API, which also confirmed the request headers and that the key is never printed. | **UNVERIFIED for every agent.** Run `npm run verify:anthropic` with a key: one real call per agent task, PASS only if the output came from Anthropic. |
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

All agents run on the server; keys never reach the browser. A scan of the built bundle for keys, the provider URL and secret names found nothing. All agents share one executor (`backend/src/agents/core.js`). It calls the provider, validates output against a schema, falls back on any failure, and records an `AgentRun` (agent, task, status, source, model, duration, error category, but no prompts or complaint text).

| Agent | Guardrails |
|---|---|
| Summary | Complaint text is wrapped and declared to be data, not instructions (prompt-injection defence). Output is schema-validated. The original text is shown alongside and never rewritten. |
| Priority | Uses safety, impact and urgency only. Applied only while the priority is automatic, never over escalation or an override. |
| Assignment | The model may only choose from validated candidates (active staff covering the category with spare capacity). Any other choice is rejected and the least-loaded rule is used. With no candidate, the complaint stays in the admin queue. |
| **Resolution and Response** | Three tasks, for the assignee or an admin only. Details below. |

**Resolution and Response Agent** (`backend/src/agents/resolutionAgent.js`). The earlier version only drafted replies. In this round it was extended in place, reusing the shared executor, into three tasks:

- **Troubleshooting suggestions** (`resolution-suggestions`): ordered steps marked `staff` or `specialist`, likely causes, possible resolutions, safety notes, missing information and limitations. Because the output is staff-only, internal notes may inform it. A deterministic guardrail adds a safety note whenever the complaint mentions a hazard and the model gave none. The fallback is a labelled per-category checklist.
- **Response draft** (`response-draft`): an editable reply built from public messages only. It returns `requiresApproval: true` and sends nothing. Dates or times in an AI draft add a warning.
- **Evidence review** (`evidence-review`): reviews the staff resolution note (given in the request, or the one recorded when the complaint was marked Resolved), whether the student was told, and whether work was started. It returns an assessment, a checklist and follow-up questions. **It does not verify evidence and does not claim to:** it reads text only and cannot see photos or the site. `verified` is always `false` (a model output that claims otherwise has the field stripped, which is tested), and a fixed limitation is appended to every result. The rule-based fallback only confirms that records exist and never returns `likely_sufficient`.

**Staff approval.** No agent sends a message, assigns anyone or changes a status; this is tested by checking that status, assignee, priority, message count and status history are unchanged after all three tasks run. Sending a reply and resolving or closing remain explicit human actions. To give the evidence review a real record to check, **marking a complaint Resolved now requires a resolution note**. The student sees it in their timeline. In the interface, the note written for the review pre-fills that field, and the close dialog shows the latest review with an "advisory, not a verification" label.

**Provider handling.** Default model `claude-haiku-5-5`. The output budget was raised to 4,000 tokens (`AI_MAX_TOKENS`) because adaptive thinking counts against it. Output stopped by the token limit is classified `truncated` and falls back. Thinking blocks are ignored. Rejected credentials map to `provider_error`, and the timeout default is 30 s. Reporter names and emails are never sent to the provider (tested).

## 6. Test evidence

| Check | Command | Result | Evidence |
|---|---|---|---|
| Backend lint | `npm run lint` | Clean | `01-backend-lint.txt` |
| Backend unit and integration tests (**FerretDB**) | `npm test` | **82/82 pass** (10 files); the run logs `[server-identity] product=FerretDB v1.24.0` | `02-backend-tests.txt` |
| Genuine-MongoDB guard | `npm run test:mongodb` against FerretDB | **Refused, as designed** ("the server is FerretDB v1.24.0") | `02b-verification-tools.txt` |
| Live Anthropic check | `npm run verify:anthropic` | **Skipped, exit 2: no API key.** The script's own tests (mock API) pass. | `02b-verification-tools.txt` |
| Frontend lint | `npm run lint` | Clean | `03-frontend-lint.txt` |
| Frontend tests | `npm test` | **24/24 pass** (4 files) | `04-frontend-tests.txt` |
| Frontend production build | `npm run build` | Pass, no chunk-size warning | `05-frontend-build.txt` |
| Escalation suite repeated | 10 consecutive runs | **10/10 runs pass all 15 tests** | `06-escalation-stress.txt` |
| Browser end-to-end (Chromium, real stack, FerretDB) | `e2e/run_stack.sh` | **89/89 checks pass** | `07-e2e-browser.txt`, `07-e2e-results.json` |
| Accessibility (axe-core 4.10, 13 rendered pages) | within the E2E run | **0 violations at any severity** | `07-e2e-results.json` |
| Dependency audit, production | `npm audit --omit=dev` | **0 vulnerabilities** (backend and frontend) | `08-security-and-typecheck.txt` |
| Type checking | n/a | Not applicable: JavaScript project with no TypeScript setup | `08-security-and-typecheck.txt` |

**Resolution and Response Agent tests** (`tests/integration/resolutionAgent.test.js`, 12 tests, plus adapter and script tests):
- **Suggestions:** structure and storage, internal-note context, the hazard safety-note guardrail, and the malformed-output fallback (labelled category checklist).
- **Drafting:** produces a draft with `requiresApproval` and changes nothing.
- **Evidence review:** uses the recorded note; `verified` stays false even when the model claims verification; the fixed limitation is always present; an explicit note overrides the recorded one; the rule fallback never says "likely sufficient".
- **Failures:** timeouts (all three tasks), truncation, and a missing API key (all three tasks).
- **No side effects:** status, assignee, priority, messages and history are unchanged after every task.
- **Access:** students get 403, a non-assigned staff member gets 404, strict body validation is enforced, and students never see `ai`.
- **Adapter:** rejected credentials, the token-limit stop, and thinking blocks ignored.
- **Verify script (local mock API):** 7/7 checks with the key never printed, exit 1 on an unavailable model, exit 2 without a key.

**Escalation and permissions coverage.**
- **Thresholds:** exactly five reporters do not escalate, and the sixth does.
- **Distinct counting:** one student submitting eight times counts once; five students plus repeats stay unescalated; unrelated issues are counted separately.
- **Concurrency:** 12 simultaneous reporters escalate exactly once; simultaneous sixth and seventh reports escalate once; simultaneous duplicates don't inflate the count; and **60 simultaneous submissions across 3 issues** count 15, 6 and 5 distinct reporters exactly, with exactly 2 escalations.
- **Rule effects:** later reports are Critical; overrides are kept; the window rolls over, and a window of 0 counts all time; admin resolution keeps history; escalation shows in the API and the student timeline.
- **Security:** IDOR returns 404; unassigned staff are blocked; status changes are checked per role; the resolution note is required; mass assignment is rejected; internal notes are hidden from students; uploads are checked by signature; admin-only routes are enforced; sign-in errors are generic; rate limiting works; logout revokes replayed cookies; demoted admins lose access immediately; the placeholder secret is rejected.

**Browser coverage.**
- **Student:** registration, reporting with a photo, and confirmation; escalation at the sixth distinct reporter seen in the UI, but not at five with a repeat.
- **Staff:** queue, internal note, reviewed draft reply, troubleshooting suggestions, evidence review (first flagging missing information, then labelled not verified), and resolving with the review note carried into the required field.
- **Student again:** sees the reply and the resolution note but not the internal note, and closes the complaint.
- **Admin:** issues view shows 6 reporters; a priority override with a required reason survives a seventh report.
- **Access and routing:** server-side 403/404 for students; client redirects; 404 page; signed-out redirect.
- **Layout:** no horizontal scrolling on six pages at 375, 768 and 1280 px; the mobile drawer works; the skip link is first in tab order.

**Defects found and fixed during verification.**
- *Earlier rounds:*
  - the concurrency loss in reporter counting (section 4);
  - charts focusable while hidden from screen readers;
  - the skip link not first in tab order;
  - heading levels skipping;
  - oversized radio buttons;
  - "AI agent" wording in the student timeline;
  - a fallback reason worded twice;
  - the placeholder secret being accepted;
  - an unsupported notification claim;
  - `react-router-dom` 7.13.0 → 7.18.4 for 2 high-severity advisories; in-range build-tool updates (vite 7.3.7, rollup, postcss, esbuild).
- *This round:*
  - Output budgets of 800–900 tokens could be exhausted by adaptive thinking before any answer appeared. The budget was raised, and truncation is now detected.
  - The panel showed "Refresh suggestions" when nothing had run, because the database returns empty sub-objects. Caught by the browser suite; a regression test was added.
  - Toasts could stack until they covered the page; they are now capped at three.

## 7. Configuration decisions

- **Session:** an httpOnly, SameSite=Strict JWT cookie, plus a required `X-Requested-With` header on unsafe methods (CSRF defence). Roles are reloaded from the database on every request. A token version revokes sessions on sign-out, role change or deactivation. Sign-out ends all of a user's sessions.
- **Lifecycle:** Submitted → Reviewed → Assigned → In Progress → Resolved → Closed, with Rejected and reason-required reopen paths (table in API_CONTRACTS.md). Resolving requires a resolution note. Students can confirm or reopen their own resolved complaints.
- **Priorities:** Low, Medium, High, Critical. Critical is the highest and is used by escalation.
- **Defaults:** escalation threshold 5, window 30 days, automatic assignment on, model `claude-haiku-5-5` with a 4,000-token budget and a 30 s timeout, 8-hour sessions, 5 MB images. All are configurable in `backend/.env`.

## 8. Known limitations and remaining work

**Unverified (required before relying on the system):**

1. **Genuine MongoDB.** Never run here (section 1). Run `MONGODB_TEST_URI=... npm run test:mongodb` against a real MongoDB 6+ server. FerretDB already behaved differently once (section 4), so this matters, particularly for the concurrency tests. Server detection covers FerretDB only.
2. **Live Anthropic calls, for every agent.** No key was available. Run `npm run verify:anthropic`. A pass shows the integration works; a person should still review the quality of real summaries, priorities, troubleshooting steps, drafts and evidence reviews before staff rely on them. Request details that only a live call can confirm include the `anthropic-version: 2023-06-01` header, which current docs still use, and whether 4,000 tokens is enough headroom for adaptive thinking.

**Limits of the implementation:**

3. **The evidence review does not verify evidence.** It reads the text record only. It cannot inspect photos (it is told only how many there are) or confirm that work happened. Staff can attach evidence only as text; there is no upload for photos of the fix.
4. **Dev-only advisories remain** in `vitest` 3 and its dependencies (`tinypool` critical, `@vitest/mocker` moderate) in both projects. They only run tests and are never shipped. The fix is vitest 5.0.3, a major upgrade published 2026-09-30, deferred until it has been public for at least two weeks.
5. **No notifications.** Students and staff see updates only when they open the app.
6. **No manual re-grouping.** Grouping is strictly category plus location; an admin cannot move a complaint into a different issue group.
7. **No password reset** and no self-service profile editing.
8. **Sorting by priority is done in memory** in the list endpoint (fine at campus scale), and the issues list is capped at 200 groups.
9. **Rare window race.** If the counting window lapses while several reports for one issue arrive at the same moment, one may be counted in the old generation. This only affects issues that have not escalated.
10. **Console noise.** Signed-out pages log one expected 401 from the session check.
11. **Attachments** are stored on local disk and need a persistent, backed-up volume. There is no virus scanning beyond signature checks.
12. **The browser suite** requires Python Playwright and was run only in the build environment.
