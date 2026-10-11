import { describe, it, expect } from 'vitest';
import { checkTransition, allowedNextStatuses } from '../../src/services/lifecycle.js';
import { isOverThreshold } from '../../src/services/escalationService.js';

describe('status transitions', () => {
  it('staff moves Assigned -> In Progress -> Resolved', () => {
    expect(checkTransition({ from: 'Assigned', to: 'In Progress', role: 'staff' }).ok).toBe(true);
    expect(checkTransition({ from: 'In Progress', to: 'Resolved', role: 'staff' }).code).toBe('REASON_REQUIRED'); // resolution note
    expect(checkTransition({ from: 'In Progress', to: 'Resolved', role: 'staff', reason: 'Replaced the access point' }).ok).toBe(true);
  });
  it('students cannot resolve or skip states', () => {
    expect(checkTransition({ from: 'In Progress', to: 'Resolved', role: 'student' }).code).toBe('FORBIDDEN_TRANSITION');
    expect(checkTransition({ from: 'Submitted', to: 'Resolved', role: 'admin' }).code).toBe('INVALID_TRANSITION');
  });
  it('reopening and rejecting require a reason', () => {
    expect(checkTransition({ from: 'Resolved', to: 'In Progress', role: 'student' }).code).toBe('REASON_REQUIRED');
    expect(checkTransition({ from: 'Resolved', to: 'In Progress', role: 'student', reason: 'Still broken' }).ok).toBe(true);
    expect(checkTransition({ from: 'Submitted', to: 'Rejected', role: 'admin', reason: '  ' }).code).toBe('REASON_REQUIRED');
  });
  it('same status is not a transition; staff cannot close', () => {
    expect(checkTransition({ from: 'Assigned', to: 'Assigned', role: 'admin' }).code).toBe('NO_CHANGE');
    expect(checkTransition({ from: 'Resolved', to: 'Closed', role: 'staff' }).ok).toBe(false);
  });
  it('lists allowed next statuses per role', () => {
    expect(allowedNextStatuses('Resolved', 'student').map((t) => t.to).sort()).toEqual(['Closed', 'In Progress']);
    expect(allowedNextStatuses('Submitted', 'staff')).toEqual([]);
  });
});

describe('threshold predicate', () => {
  it('is strictly greater than the threshold', () => {
    expect(isOverThreshold(5, 5)).toBe(false);
    expect(isOverThreshold(6, 5)).toBe(true);
  });
});
