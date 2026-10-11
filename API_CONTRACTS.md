# API Contracts

Base path: `/api`. All request and response bodies are JSON unless stated otherwise. This document describes the routes in `backend/src/routes/index.js` and the schemas in `backend/src/validation/schemas.js`.

## Conventions

**Authentication.** `POST /auth/login` and `POST /auth/register` set an httpOnly cookie `ccrs_session` (`SameSite=Strict`, `Path=/api`, `Secure` when `COOKIE_SECURE=true`) containing a signed JWT. On every authenticated request the server reloads the user, rejects deactivated accounts and revoked tokens, and takes the role **from the database**, never from the request. Tokens are revoked by sign-out and by an admin changing a user's role or active state.

**CSRF.** Every non-GET request must send `X-Requested-With: XMLHttpRequest`, or it gets `403 FORBIDDEN`. Combined with the SameSite cookie and an exact-origin CORS allow-list, this blocks cross-site requests.

**Validation.** Bodies and query strings are validated with strict schemas. **Unknown fields are rejected** with `400`, which prevents mass assignment (for example, sending `role`, `status`, `priority` or `reporter` where they are not allowed). Strings are trimmed. Path ids must be 24-character hex ObjectIds, otherwise `400`.

**Identifiers and dates.** Ids are MongoDB ObjectId strings in `_id` (the auth user object uses `id`). Dates are ISO 8601 UTC strings.

**Pagination.** List endpoints take `page` (from 1) and `limit` and return `{ items, page, limit, total, totalPages }`.

**Visibility.** Complaints a caller may not see return `404`, not `403`, so their existence is not revealed.

### Error shape

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Some fields are invalid", "details": [{ "field": "title", "message": "String must contain at least 5 character(s)" }] } }
```

| HTTP | `code` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Invalid body, query or id; business-rule rejection (`details.code` may be `INVALID_TRANSITION`, `REASON_REQUIRED`, `NO_CHANGE`) |
| 400 | `BAD_JSON` | Body is not valid JSON |
| 401 | `UNAUTHORIZED` | No session, expired or revoked session, or failed sign-in (always `Invalid email or password`) |
| 403 | `FORBIDDEN` | Role not allowed, missing CSRF header, or a status change your role cannot make |
| 404 | `NOT_FOUND` | Unknown route, or a resource you cannot see |
| 409 | `CONFLICT` | Duplicate email or name, concurrent modification, or an action invalid in the current state |
| 413 | `PAYLOAD_TOO_LARGE` | JSON body over 100 kB |
| 429 | `RATE_LIMITED` | Sign-in, registration or agent rate limit |
| 500 | `INTERNAL` | Unexpected error (no stack traces are returned) |
| 503 | `DB_UNAVAILABLE` | Database unreachable |

### Enumerations

- Roles: `student`, `staff`, `admin`
- Statuses: `Submitted`, `Reviewed`, `Assigned`, `In Progress`, `Resolved`, `Closed`, `Rejected`
- Priorities (low to high): `Low`, `Medium`, `High`, `Critical`. **`Critical` is the highest level**, used by escalation.
- `prioritySource` (staff/admin only): `default`, `ai`, `fallback-rules`, `escalation`, `override`
- Comment visibility: `public` (student sees it), `internal` (staff and admins only)

### Status transitions

| From | To | Allowed roles | Reason required |
|---|---|---|---|
| Submitted | Reviewed | admin | no |
| Submitted, Reviewed, Assigned | Rejected | admin | yes |
| Assigned | In Progress | staff (assignee), admin | no |
| In Progress | Resolved | staff (assignee), admin | yes: the **resolution note** (what was done, how it was checked); visible to the student |
| Resolved | Closed | student (owner), admin | no |
| Resolved | In Progress (reopen) | student (owner), admin | yes |
| Closed | In Progress (reopen) | admin | yes |
| Rejected | Reviewed (reopen) | admin | yes |

`Assigned` is entered through `POST /complaints/:id/assign` (or automatic assignment), not a status change. Every transition is recorded in the audit log with actor, previous and new value, time, and reason.

### Rate limits

| Endpoint | Limit |
|---|---|
| `POST /auth/login` | `LOGIN_RATE_LIMIT_MAX` (default 10) per IP + email per 15 minutes |
| `POST /auth/register` | 20 per IP per hour |
| `POST /complaints/:id/agents/*` | 30 per user per minute |

---

## Health

### `GET /health`
No auth. `200 {"status":"ok","db":"connected"}`, or `503 {"status":"degraded","db":"<state>"}`.

## Auth

### `POST /auth/register`
Public. Always creates a **student**.

Body: `name` (2–100), `email` (valid, ≤254, stored lowercase), `password` (8–128, at least one letter and one digit).
`201 { user: { id, name, email, role: "student" } }` and the session cookie. `409` if the email is taken.

### `POST /auth/login`
Public. Body: `email`, `password`. `200 { user }` and the session cookie. `401 Invalid email or password` for an unknown email, wrong password **or** a deactivated account. `429` when rate-limited.

### `POST /auth/logout`
Authenticated. Revokes **all** of the user's sessions and clears the cookie. `204`.

### `GET /auth/me`
Authenticated. `200 { user: { id, name, email, role } }`.

## Categories and locations

| Method and path | Roles | Body / query | Response |
|---|---|---|---|
| `GET /categories` | any signed-in | `includeInactive=true` (honoured for admins) | `{ items: Category[] }` sorted by name |
| `POST /categories` | admin | `name` (2–80), `description?` (≤300) | `201 { item }`; `409` duplicate name |
| `PATCH /categories/:id` | admin | at least one of `name`, `description`, `active` | `{ item }` |
| `GET /locations` | any signed-in | as above | `{ items: Location[] }` |
| `POST /locations` | admin | `name` (2–80) (`description` is accepted but not stored for locations) | `201 { item }` |
| `PATCH /locations/:id` | admin | `name?`, `active?` | `{ item }` |

`Category`: `{ _id, name, description, active, createdAt, updatedAt }`. `Location`: `{ _id, name, active, createdAt, updatedAt }`. Inactive entries cannot be chosen for new complaints.

## Complaints

### `POST /complaints`
Role: **student**. `multipart/form-data`:

| Field | Rules |
|---|---|
| `title` | 5–150 characters |
| `description` | 20–5000 characters; stored as submitted and never rewritten |
| `categoryId` | an active category |
| `locationId` | an active location |
| `attachment` | optional; one JPEG, PNG or WebP image, verified by file signature, at most `MAX_UPLOAD_BYTES` (default 5 MB) |

`201 { complaint, issue: { escalated } }`. The complaint is linked to its issue group and counted for escalation **before** the response is sent. The agents (summary, priority, assignment) then run in the background, so `complaint.ai` and the assignee may fill in shortly after.

### `GET /complaints`
Any signed-in user. **Scoped by role:** students see their own complaints, staff see complaints assigned to them, admins see all.

Query: `page` (default 1), `limit` (1–100, default 20), `status`, `priority`, `categoryId`, `locationId`, `search` (title/description, ≤100), `sort` (`newest` default, `oldest`, `priority`, `updated`). Admin only: `assigneeId` (an id or `unassigned`), `issueGroupId`.

Response items: `{ _id, title, description, status, priority, escalated, category: {_id,name}, location: {_id,name}, reporter: {_id,name,email}, assignee: {_id,name,email} | null, issueGroup, groupGeneration, attachmentCount, createdAt, updatedAt, resolvedAt?, closedAt? }`. Staff and admins also get `prioritySource` and `aiSummary: { text, source } | null`. For students, `reporter` is themselves, `assignee` is reduced to `{ name }`, and `prioritySource` is omitted.

### `GET /complaints/stats`
Scoped as above. `{ total, byStatus: { [status]: n }, byPriority: { [priority]: n } }`.

### `GET /complaints/:id`
Scoped as above (`404` otherwise). `{ complaint }`:

```
_id, title, description, status, priority, category, location, reporter, assignee,
attachments: [{ _id, originalName, mimeType, size, createdAt }],     // never the stored file name
allowedTransitions: [{ to, reasonRequired }],                      // for the caller's role
issue: { id, generation, reporterCount, escalated, escalatedAt } | null,   // staff/admin
issue: { escalated } | null,                                               // student
prioritySource, ai: { summary, priority, assignment },             // staff/admin only
createdAt, updatedAt, resolvedAt?, closedAt?
```

`ai.summary`: `{ text, keyFacts[], categoryHint, limitations, source, model, generatedAt }`.
`ai.priority`: `{ predicted, rationale, confidence, source, model, generatedAt }`.
`ai.assignment`: `{ recommendedStaff: {_id,name} | null, reason, applied, source, model, generatedAt }`.
`ai.resolution`: `{ likelyCauses[], troubleshootingSteps: [{ step, who: "staff"|"specialist" }], possibleResolutions[], safetyNotes[], informationNeeded[], limitations, source, model, generatedAt }`.
`ai.evidenceReview`: `{ assessment, checks: [{ item, status, note }], followUpQuestions[], limitations, verified: false, resolutionNote, statusAtReview, source, model, generatedAt, reviewedBy }`.
A task that has never run may appear as an object with empty arrays and no `generatedAt`; treat `generatedAt` as the marker that it ran.
`source` is `gemini` (Google Gemini model output) or `fallback` (deterministic, not AI). Records created before the switch to Gemini may carry the legacy value `anthropic`; clients should treat any value other than `fallback` as model output. Reporter identities of other students are never returned.

### `GET /complaints/:id/timeline`
Scoped as above. `{ items }` in chronological order, each either:
- `{ kind: "event", id, at, action, label, from, to, reason, actor: { name, role } }`, or
- `{ kind: "comment", id, at, visibility, body, fromAiDraft, actor: { name, role } }`

Students receive only student-visible events (submission, status changes, escalation, priority changes) and `public` comments. They never receive internal notes, assignment events or `fromAiDraft`.

### `GET /complaints/:id/attachments/:attachmentId`
Scoped as above. Streams the image with its stored content type, `Content-Disposition: inline`, `Cache-Control: private`.

### `PATCH /complaints/:id/status`
Scoped as above. Body: `status`, `reason?` (≤1000). Applies the transition table. `400` invalid transition or missing reason, `403` role cannot make this change, `409` the status changed concurrently. Returns `{ complaint }`.

### `PATCH /complaints/:id/priority`
Role: **admin**. Body: `priority`, `reason` (3–1000, required). Sets `prioritySource: "override"`. **Automatic escalation never changes an overridden complaint.** `409` if the same override is already in place. Returns `{ complaint }`.

### `POST /complaints/:id/assign`
Role: **admin**. Body: `staffId`, `reason?`. The assignee must be an **active staff** account whose categories include the complaint's category (`400` otherwise). Submitted/Reviewed complaints become Assigned; Assigned/In Progress keep their status. `409` for Resolved/Closed/Rejected complaints, the same assignee, or a concurrent change. Returns `{ complaint }`.

### `POST /complaints/:id/comments`
Scoped as above. Body: `body` (1–4000), `visibility` (`public` default, or `internal`), `fromAiDraft?` (boolean; ignored for students). Students may only post `public` and not on Closed/Rejected complaints. `201 { comment: { _id, complaint, author: {_id,name,role}, body, visibility, fromAiDraft, createdAt } }`.

## Agents

All agent calls run on the server, through Google's `@google/genai` SDK, with the key from `backend/.env`. Each one records an `AgentRun` (agent, task, status, source, model, duration, error category; no prompts or complaint text). If no provider is configured or the call fails (timeout, rate limit, provider error, output cut off by the token limit, output that fails schema validation), a labelled deterministic fallback is returned with `source: "fallback"` and an `errorCategory`. The caller must be able to see the complaint (`404` otherwise). **No agent endpoint sends a message, assigns anyone or changes a complaint's status**; those are separate, explicit calls (`/comments`, `/assign`, `/status`).

| Method and path | Roles | Body | `result` |
|---|---|---|---|
| `POST /complaints/:id/agents/summary` | staff (assignee), admin | none | `{ text, keyFacts, categoryHint, limitations, source, model, generatedAt, errorCategory }` (stored on the complaint) |
| `POST /complaints/:id/agents/priority` | admin | none | `{ predicted, rationale, confidence, source, model, generatedAt, applied, errorCategory }`. Applied only while the priority is automatic, never over `escalation` or `override`. |
| `POST /complaints/:id/agents/assignment` | admin | none | `{ recommendedStaff, reason, applied: false, source, model, generatedAt, errorCategory }`. Recommendation only; use `/assign` to apply. |

### Resolution and Response Agent

The three endpoints below are tasks of one agent (`AgentRun.agent: "resolution"`, `task` as listed). They require **staff who are the assignee** (another staff member gets `404`, since they cannot see the complaint) or an **admin**. Students get `403`.

| Method and path | Task | Body | `result` |
|---|---|---|---|
| `POST /complaints/:id/agents/resolution-suggestions` | `suggest` | none | `{ likelyCauses[], troubleshootingSteps: [{ step, who }], possibleResolutions[], safetyNotes[], informationNeeded[], limitations, source, model, generatedAt, errorCategory }`, stored as `ai.resolution`. Internal notes may inform it (staff-only output). If the complaint mentions a hazard (fire, smoke, gas, spark, exposed wire, shock, flood, collapse, injury, unsafe) and the model gave no safety note, the server adds one. |
| `POST /complaints/:id/agents/response-draft` | `draft` | `guidance?` (≤800) | `{ draft, warnings[], requiresApproval: true, source, model, contextUsed: { publicMessages, guidanceProvided }, errorCategory }`. **Nothing is sent**: post the edited text with `POST /comments`. Only public messages are used as context. Dates or times in an AI draft add a warning. |
| `POST /complaints/:id/agents/evidence-review` | `evidence` | `resolutionNote?` (≤2000) | `{ assessment, checks[], followUpQuestions[], limitations, verified: false, resolutionNote, statusAtReview, source, model, generatedAt, reviewedBy, errorCategory }`, stored as `ai.evidenceReview`. Reviews `resolutionNote` if given, otherwise the note recorded when the complaint was marked Resolved. |

`assessment` is `likely_sufficient`, `needs_more_information` or `cannot_assess`. **`verified` is always `false`**: the review reads the written record only, cannot inspect photos or confirm work, and `limitations` always ends with that statement. The rule-based fallback only checks that records exist (resolution note, a reply to the student, work started) and never returns `likely_sufficient`.

`errorCategory` values (all agents): `null`, `no_provider` (demo mode: `GEMINI_API_KEY` not set), `timeout`, `rate_limited` (Gemini `429` per-minute limit, a cool-down in progress, or the app-side `GEMINI_MAX_REQUESTS_PER_MINUTE` cap; never retried), `quota_exceeded` (Gemini `429 quota_exceeded`, the daily quota), `auth_error` (key rejected or not permitted: `401`/`403`), `blocked` (Gemini declined for safety or policy reasons, for example `safety` or `spii`), `provider_error` (unknown model, `5xx`, other API errors, network), `truncated` (interaction ended `incomplete`, typically at `AI_MAX_TOKENS`), `malformed_output` (no text, or JSON that fails the zod schema), `no_candidates`, `internal`. While Gemini is paused after a `429`, `GET /settings` reports `agents.provider.coolingDownUntil` and `coolDownReason`; both are `null` otherwise.

Automatic assignment (after creation, when `AUTO_ASSIGN_ENABLED=true`) only considers active staff covering the category with open assignments below `maxOpenAssignments`. A model's choice outside that list is rejected and the least-loaded rule is used instead.

## Repeated issues

Same issue = same `(category, location)`. Distinct reporters are counted per issue **generation**; an admin closing an issue starts a new generation. Escalation happens when distinct reporters exceed `ESCALATION_THRESHOLD` (default 5).

### `GET /issues`
Role: **admin**. Up to 200 groups, escalated first. `{ items: [{ _id, groupKey, category: {_id,name}, location: {_id,name}, generation, windowStartedAt, reporterCount, escalated, escalatedAt, threshold, resolvedGenerations: [{ generation, reporterCount, escalated, closedAt, closedBy, reason }] }] }`. Reporter identities are not returned.

### `POST /issues/:id/resolve`
Role: **admin**. Body: `reason` (3–1000). Archives the current generation's count into `resolvedGenerations` and starts counting from zero. Existing complaints are not modified. `{ item }`.

## Users and staff

### `GET /users`
Role: **admin**. Query: `role?`, `search?` (name/email), `page`, `limit` (≤100, default 25). Paged `User` objects: `{ _id, name, email, role, active, categories: [{_id,name}], maxOpenAssignments, createdAt, updatedAt }`. Password hashes and token versions are never returned.

### `POST /users`
Role: **admin**. Body: `name`, `email`, `password` (same rules as registration), `role` (`staff` or `admin`), `categories?` (staff only), `maxOpenAssignments?` (1–500). `201 { user }`; `409` duplicate email; `400` unknown category.

### `PATCH /users/:id`
Role: **admin**. Body: at least one of `name`, `role`, `active`, `categories`, `maxOpenAssignments`. An admin cannot deactivate or demote themselves, and the last active admin cannot be removed (`400`). Changing `role` or `active` revokes that user's sessions. `{ user }`.

### `GET /staff`
Role: **admin**. Query: `categoryId?`. `{ items: [{ ...User, openAssignments }] }`, where `openAssignments` counts Submitted/Reviewed/Assigned/In Progress complaints assigned to them.

## Reports and settings

### `GET /reports/summary`
Role: **admin**. Query: `from?`, `to?` (dates; filter on complaint creation time; `from` must not be after `to`).
`{ range: {from,to}, total, byStatus, byPriority, byCategory, createdPerDay: [{date,count}], averageResolutionHours | null, unassignedOpen, escalatedIssues }`. `escalatedIssues` is the **current** number of escalated issue groups and is not date-filtered.

### `GET /settings`
Role: **admin**. Read-only effective configuration, with no secrets:
`{ escalation: { threshold, windowDays, rule }, agents: { autoAssign, provider: { configured, name, model, coolingDownUntil, coolDownReason } }, uploads: { maxBytes, types } }`. With a key: `provider: { configured: true, name: "gemini", model: "gemini-3.5-flash-lite", coolingDownUntil: null, coolDownReason: null }`; in demo mode: `{ configured: false, name: null, model: null }`. The API key is never included in this or any other response.
