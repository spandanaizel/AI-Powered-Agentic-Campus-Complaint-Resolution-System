// Single source of truth for enums shared by models, validation, services and the API contract.
export const ROLES = Object.freeze(['student', 'staff', 'admin']);

export const STATUSES = Object.freeze([
  'Submitted', 'Reviewed', 'Assigned', 'In Progress', 'Resolved', 'Closed', 'Rejected',
]);
export const OPEN_STATUSES = Object.freeze(['Submitted', 'Reviewed', 'Assigned', 'In Progress']);
export const TERMINAL_STATUSES = Object.freeze(['Closed', 'Rejected']);

// Ordered lowest -> highest. The last entry is the "highest priority level defined by the project".
export const PRIORITIES = Object.freeze(['Low', 'Medium', 'High', 'Critical']);
export const HIGHEST_PRIORITY = PRIORITIES[PRIORITIES.length - 1];
export const DEFAULT_PRIORITY = 'Medium';

// Why a complaint has its current priority. Escalation and human overrides are never
// overwritten by an AI prediction.
export const PRIORITY_SOURCES = Object.freeze(['default', 'ai', 'fallback-rules', 'escalation', 'override']);
export const AUTO_PRIORITY_SOURCES = Object.freeze(['default', 'ai', 'fallback-rules']);

export const COMMENT_VISIBILITY = Object.freeze(['public', 'internal']);
export const AGENTS = Object.freeze(['summary', 'priority', 'assignment', 'resolution']);
// Tasks of the Resolution and Response Agent.
export const RESOLUTION_TASKS = Object.freeze(['suggest', 'draft', 'evidence']);
// AgentRun also accepts 'response', the name used for drafting runs before the agent was extended.
export const AGENT_RUN_NAMES = Object.freeze([...AGENTS, 'response']);
export const EVIDENCE_ASSESSMENTS = Object.freeze(['likely_sufficient', 'needs_more_information', 'cannot_assess']);
