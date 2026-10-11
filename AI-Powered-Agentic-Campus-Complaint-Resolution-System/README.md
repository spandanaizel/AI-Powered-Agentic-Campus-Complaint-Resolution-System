# AI-Powered Agentic Campus Complaint Resolution System

A web application where students report campus problems, staff work through them, and administrators triage, assign and report on them. Four server-side agents help with triage, and a deterministic rule escalates any issue reported by more than five different people.

This repository is the completed version of the original *Campus Complaint Management System* project, which contained two separate frontends with hard-coded data and no backend. See [IMPLEMENTATION_REPORT.md](IMPLEMENTATION_REPORT.md) for the audit of the original and everything that changed.

> **Verification status, in brief.**
> - **Database:** all tests ran against **FerretDB 1.24** (a MongoDB-compatible server). **Genuine MongoDB is unverified**: no MongoDB server could be obtained in the build environment. Run `npm run test:mongodb` in `backend/` against a real server; it refuses to report a pass on anything that is not genuine MongoDB.
> - **AI:** the model ID `claude-haiku-5-5` was checked against Anthropic's published models page. **No live Anthropic API call has been made**, because no API key was available. Agents were tested with a simulated provider, and the live-check script was tested against a local mock of the API. Run `npm run verify:anthropic` with your key to verify.
>
> Details and the remaining limitations are in the implementation report.

## Features

**Student portal.** Register and sign in, report a problem with a category, location, description and optional photo, follow each complaint's status and staff replies, confirm a fix or reopen it with a reason. Escalated issues are clearly marked.

**Staff portal.** A queue of complaints assigned to you, sorted by priority. Each complaint shows the original submission, photo, full history, and triage assistance. Ask for troubleshooting steps, add internal notes that students never see, and reply to students, optionally starting from a drafted reply that you review and edit before sending. Marking a complaint resolved needs a resolution note (what was done and how it was checked), which the student sees. An evidence review can check that note and the record first.

**Admin portal.** Live overview figures and charts, all complaints with search, filters, sorting and pagination, manual assignment and priority overrides (with a required reason), a repeated-issues view, staff coverage (which categories each staff member handles and their capacity), categories and locations, user accounts, date-filtered reports with CSV download, and read-only settings.

**Agents** (server-side; Anthropic Claude when an API key is configured):

| Agent | What it does | Without a key or on failure |
|---|---|---|
| Summary | Condenses a complaint for triage | Shows an excerpt, labelled "not an AI summary" |
| Priority prediction | Recommends Low/Medium/High/Critical with a rationale | Keyword rules, labelled "not AI" |
| Automatic assignment | Picks among *eligible* staff (active, covering the category, under capacity) | Least-loaded eligible staff member |
| Resolution and response | Three tasks for the assigned staff member or an admin: **troubleshooting suggestions** (steps, likely causes, possible resolutions, safety notes); an **editable reply draft**; and an **evidence review** of the resolution record before resolving or closing. Advisory only: it never sends a message or changes a complaint, and the evidence review is always marked *not verified*, because it cannot see photos or confirm that work was done. | Category checklists; a fill-in template; checks that the expected records exist. All are labelled. |

**Repeated-issue escalation.** Complaints with the same category and location are the same issue. When more than five *different* people report it (within a configurable window, 30 days by default), every open complaint about it becomes Critical. Repeat reports by one student count once. The rule is safe under concurrent submissions. A priority set manually by an administrator is never changed by escalation.

## Architecture

```
backend/   Node.js + Express 5 + Mongoose 8 (MongoDB)
  src/routes        HTTP routes and per-route auth/role/validation middleware
  src/controllers   Request handling
  src/services      Business logic: complaints, lifecycle, assignment, escalation, audit, reports
  src/agents        The four agents, Anthropic provider adapter, output schemas, fallbacks
  src/models        Mongoose schemas (users, complaints, issue groups, comments, audit, agent runs)
  src/middleware    Auth (cookie JWT), CSRF header check, validation, uploads, errors
  tests/            Vitest + Supertest: unit and integration tests
frontend/  React 19 + Vite 7 + React Router 7, one app with Student, Staff and Admin portals
  src/api, src/auth, src/components, src/layouts, src/pages/{auth,student,staff,admin,shared}
e2e/       Browser end-to-end suite (Python Playwright + axe-core)
```

Security model: sessions are an httpOnly, SameSite=Strict cookie. Every request reloads the user from the database (role and active status are never trusted from the client), and every complaint query is scoped to what the caller may see. Unsafe requests must carry an `X-Requested-With` header. Inputs are validated with strict schemas that reject unknown fields. AI provider calls and keys stay on the server.

## Prerequisites

- Node.js 20 or newer (developed and tested on Node 22)
- MongoDB 6 or newer, local or hosted (for example MongoDB Atlas)
- Optional: an Anthropic API key for the live agents
- Optional, for the browser end-to-end suite: Python 3 with `pip install playwright` and `playwright install chromium`

## Quick start

```bash
# 1. Backend
cd backend
cp .env.example .env            # then set MONGODB_URI and a random JWT_SECRET (see the file)
npm ci
npm run seed                    # creates categories, locations, an admin and one staff user per category
npm run dev                     # API on http://localhost:5000

# 2. Frontend (second terminal)
cd frontend
npm ci
npm run dev                     # app on http://localhost:5173 (proxies /api to the backend)
```

Sign in with the admin email and the password printed by `npm run seed`. Students create their own accounts on the sign-in page. Full step-by-step instructions, production notes and troubleshooting are in [EXECUTION_GUIDE.md](EXECUTION_GUIDE.md).

## Environment variables

All variables, with safe placeholders and comments, are in [`backend/.env.example`](backend/.env.example) and [`frontend/.env.example`](frontend/.env.example); [`.env.example`](.env.example) at the root collects both. The ones you must set are `MONGODB_URI` and `JWT_SECRET`. The server refuses to start without them, or with the placeholder secret.

## Commands

| Where | Command | Purpose |
|---|---|---|
| backend | `npm run dev` / `npm start` | Run the API (watch mode / plain) |
| backend | `npm run seed` | Idempotent reference data and staff/admin accounts |
| backend | `npm test` | Unit and integration tests (needs a MongoDB server, see below) |
| backend | `npm run test:mongodb` | The same tests, refusing to run unless the server is genuine MongoDB |
| backend | `npm run verify:anthropic` | Live check with your key: model availability plus one real call per agent task |
| backend | `npm run lint` | ESLint |
| frontend | `npm run dev` | Development server |
| frontend | `npm run build` / `npm run preview` | Production build / serve the build locally |
| frontend | `npm test` | Component, routing and client tests (no server needed) |
| frontend | `npm run lint` | ESLint |
| root | `MONGODB_BASE=mongodb://127.0.0.1:27017 e2e/run_stack.sh` | Full browser end-to-end run on a fresh database |

Backend integration tests create and drop uniquely named databases on the server given by `MONGODB_TEST_URI` (default `mongodb://127.0.0.1:27017`). Run them once against real MongoDB before relying on this system; so far they have only been run against FerretDB.

## Troubleshooting

- **Server exits with "Invalid configuration".** Set `MONGODB_URI` and a random `JWT_SECRET` of 32+ characters in `backend/.env`.
- **"Could not connect to MongoDB".** Check that MongoDB is running and the URI (host, port, credentials, database) is right.
- **Signed in, but every request returns 401.** The frontend and API must be on the same site (the cookie is SameSite=Strict). In development use the Vite proxy (open port 5173, not 5000). In production serve both behind one domain.
- **"Missing X-Requested-With header" (403).** You are calling the API directly; send `X-Requested-With: XMLHttpRequest` on POST/PATCH requests.
- **Triage panels say "Rule-based, not AI".** No `ANTHROPIC_API_KEY` is set, or the provider call failed. See Settings in the admin portal, and the server log for the error category. `npm run verify:anthropic` checks the key and model directly.
- **"Mark resolved" asks for a note.** A resolution note is required on purpose; it is the record the student sees and the evidence review checks.
- **New complaints stay unassigned.** No active staff member covers that category or all are at capacity. Fix it under Admin, Staff coverage.

More in [EXECUTION_GUIDE.md](EXECUTION_GUIDE.md#common-errors).

## Documentation

- [EXECUTION_GUIDE.md](EXECUTION_GUIDE.md): install, configure, run, test and deploy
- [API_CONTRACTS.md](API_CONTRACTS.md): every endpoint, roles, schemas and errors
- [IMPLEMENTATION_REPORT.md](IMPLEMENTATION_REPORT.md): audit, changes, test evidence, limitations
