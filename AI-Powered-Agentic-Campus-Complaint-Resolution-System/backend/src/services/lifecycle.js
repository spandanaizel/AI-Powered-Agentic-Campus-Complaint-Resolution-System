// Complaint status state machine. Pure functions — no I/O — so they are unit-testable.
//
//   Submitted -> Reviewed -> Assigned -> In Progress -> Resolved -> Closed
//   Rejected from Submitted/Reviewed/Assigned; reopen: Resolved/Closed -> In Progress, Rejected -> Reviewed.
// "Assigned" is normally entered through the assignment endpoint, not a raw status change.

const T = (from, to, roles, { reasonRequired = false } = {}) => ({ from, to, roles, reasonRequired });

export const TRANSITIONS = [
  T('Submitted', 'Reviewed', ['admin']),
  T('Submitted', 'Rejected', ['admin'], { reasonRequired: true }),
  T('Reviewed', 'Rejected', ['admin'], { reasonRequired: true }),
  T('Assigned', 'Rejected', ['admin'], { reasonRequired: true }),
  T('Assigned', 'In Progress', ['staff', 'admin']),
  // The reason is the resolution note: what was done. It is the record the evidence review checks.
  T('In Progress', 'Resolved', ['staff', 'admin'], { reasonRequired: true }),
  // Student confirms the fix, or an admin closes it.
  T('Resolved', 'Closed', ['student', 'admin']),
  // Reopen: student disputes the fix, or admin reopens.
  T('Resolved', 'In Progress', ['student', 'admin'], { reasonRequired: true }),
  T('Closed', 'In Progress', ['admin'], { reasonRequired: true }),
  T('Rejected', 'Reviewed', ['admin'], { reasonRequired: true }),
];

export function findTransition(from, to) {
  return TRANSITIONS.find((t) => t.from === from && t.to === to) || null;
}

/** Returns { ok: true, transition } or { ok: false, code, message }. */
export function checkTransition({ from, to, role, reason }) {
  if (from === to) return { ok: false, code: 'NO_CHANGE', message: `Complaint is already ${to}` };
  const t = findTransition(from, to);
  if (!t) return { ok: false, code: 'INVALID_TRANSITION', message: `Cannot move a complaint from ${from} to ${to}` };
  if (!t.roles.includes(role)) return { ok: false, code: 'FORBIDDEN_TRANSITION', message: `Your role cannot move a complaint from ${from} to ${to}` };
  if (t.reasonRequired && !(reason && reason.trim())) return { ok: false, code: 'REASON_REQUIRED', message: 'A reason is required for this status change' };
  return { ok: true, transition: t };
}

export function allowedNextStatuses(from, role) {
  return TRANSITIONS.filter((t) => t.from === from && t.roles.includes(role)).map((t) => ({ to: t.to, reasonRequired: t.reasonRequired }));
}
