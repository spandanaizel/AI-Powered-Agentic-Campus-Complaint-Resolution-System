export const STATUSES = ['Submitted', 'Reviewed', 'Assigned', 'In Progress', 'Resolved', 'Closed', 'Rejected'];
export const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];

export const STATUS_HELP = {
  Submitted: 'Received, waiting for review',
  Reviewed: 'Checked by an administrator',
  Assigned: 'A staff member is responsible',
  'In Progress': 'Work is under way',
  Resolved: 'Staff marked it fixed. Confirm or reopen.',
  Closed: 'Finished',
  Rejected: 'Not accepted. See the reason in the timeline.',
};

export const formatDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
export const formatDateTime = (d) => (d ? new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

// Anything not produced by the deterministic fallback rules is model output (currently Gemini).
export const isAiSource = (source) => Boolean(source) && source !== 'fallback' && source !== 'none';
