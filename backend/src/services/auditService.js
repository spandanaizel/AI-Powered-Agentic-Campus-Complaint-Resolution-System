import { AuditEvent } from '../models/index.js';

/**
 * Append an audit event. `actor` is a user document/id, or null for system/agent actions.
 */
export function audit({ actor = null, actorType, action, resourceType = 'Complaint', resourceId, from, to, reason, studentVisible = false }) {
  return AuditEvent.create({
    actor: actor?._id ?? actor,
    actorType: actorType ?? (actor ? 'user' : 'system'),
    action, resourceType, resourceId, from, to, reason, studentVisible,
  });
}
