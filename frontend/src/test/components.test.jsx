import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ComplaintList from '../components/ComplaintList';
import { ToastProvider, useToast } from '../components/Toast';
import { SourceTag } from '../components/Badges';
import userEvent from '@testing-library/user-event';
import { mockApi, renderApp, me } from './utils';

const row = (over) => ({ _id: 'c1', title: 'Wi-Fi down', priority: 'Critical', status: 'Assigned', escalated: true, createdAt: '2026-10-01T00:00:00Z', category: { name: 'Network' }, location: { name: 'Library' }, ...over });

describe('ticket list', () => {
  it('marks escalated complaints with a badge and the striped band', () => {
    const { container } = render(<MemoryRouter><ComplaintList items={[row(), row({ _id: 'c2', title: 'Tap', priority: 'Low', escalated: false })]} basePath="/student/complaints" /></MemoryRouter>);
    expect(screen.getAllByText('Escalated')).toHaveLength(1);
    expect(container.querySelector('[data-escalated="true"]')).toHaveAttribute('data-priority', 'Critical');
    expect(screen.getByRole('link', { name: 'Wi-Fi down' })).toHaveAttribute('href', '/student/complaints/c1');
  });
});

describe('agent provenance labels', () => {
  it('labels Gemini output and legacy stored AI output as AI, and fallbacks as not AI', () => {
    render(<><SourceTag source="anthropic" /><SourceTag source="none" /></>);
    expect(screen.getByText('AI suggestion')).toBeInTheDocument();
    expect(screen.getByText('Rule-based, not AI')).toBeInTheDocument();
  });
  it('never presents fallback output as AI', () => {
    render(<><SourceTag source="fallback" /><SourceTag source="gemini" model="gemini-3.5-flash-lite" /></>);
    expect(screen.getByText('Rule-based, not AI')).toBeInTheDocument();
    expect(screen.getByText('AI suggestion')).toHaveAttribute('title', 'Model: gemini-3.5-flash-lite');
  });
});

const detail = (role, over = {}) => ({
  _id: 'c1', title: 'Wi-Fi down in library', description: 'Original text from the student.', status: 'Resolved', priority: 'Critical',
  createdAt: '2026-10-01T00:00:00Z', category: { _id: 'k', name: 'Network' }, location: { name: 'Library' },
  issue: role === 'student' ? { escalated: true } : { escalated: true, reporterCount: 7 },
  allowedTransitions: role === 'student' ? [{ to: 'Closed', reasonRequired: false }, { to: 'In Progress', reasonRequired: true }] : [],
  attachments: [], ...over,
});

describe('complaint detail', () => {
  it('student sees escalation and their actions, but no AI or admin tools', async () => {
    mockApi({ 'GET /api/auth/me': me('student'), 'GET /api/complaints/c1': [200, { complaint: detail('student') }], 'GET /api/complaints/c1/timeline': [200, { items: [] }] });
    renderApp('/student/complaints/c1');
    expect(await screen.findByRole('heading', { name: 'Wi-Fi down in library' })).toBeInTheDocument();
    expect(screen.getByText(/Several students have reported this same problem/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm fixed and close' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeInTheDocument();
    expect(screen.queryByText('Triage assistance')).not.toBeInTheDocument();
    expect(screen.queryByText('Administrator actions')).not.toBeInTheDocument();
    expect(screen.queryByText(/Internal note/)).not.toBeInTheDocument();
  });
  it('shows the reporter count to staff and labels fallback AI output honestly', async () => {
    mockApi({
      'GET /api/auth/me': me('staff'),
      'GET /api/complaints/c1': [200, { complaint: detail('staff', { assignee: { _id: 'u1', name: 'Pat staff' }, ai: { summary: { text: 'Excerpt', source: 'fallback', limitations: 'AI summary unavailable.' } } }) }],
      'GET /api/complaints/c1/timeline': [200, { items: [] }],
    });
    renderApp('/staff/complaints/c1');
    expect(await screen.findByText(/7 different people have reported this problem/)).toBeInTheDocument();
    expect(screen.getByText('Rule-based, not AI')).toBeInTheDocument();
    expect(screen.getByLabelText(/Internal note/)).toBeInTheDocument();
    expect(screen.getByText('Draft a reply with the resolution assistant')).toBeInTheDocument();
  });
  it('a 404 from the API reads as no access, without a retry loop', async () => {
    mockApi({ 'GET /api/auth/me': me('student'), 'GET /api/complaints/zz': [404, { error: { message: 'Complaint not found' } }], 'GET /api/complaints/zz/timeline': [404, { error: { message: 'Complaint not found' } }] });
    renderApp('/student/complaints/zz');
    expect(await screen.findByRole('heading', { name: 'Complaint not found' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Try again/ })).not.toBeInTheDocument();
  });
});

describe('resolution assistance', () => {
  const staffDetail = (over = {}) => detail('staff', {
    status: 'In Progress', assignee: { _id: 'u1', name: 'Pat staff' },
    allowedTransitions: [{ to: 'Resolved', reasonRequired: true }],
    ai: {
      resolution: { generatedAt: '2026-10-01T00:00:00Z', source: 'gemini', model: 'm', troubleshootingSteps: [{ step: 'Check AP-7 lights', who: 'staff' }, { step: 'Rewire the socket', who: 'specialist' }], safetyNotes: ['Isolate power first.'], likelyCauses: [], possibleResolutions: [], informationNeeded: [], limitations: 'Check on site before acting.' },
      evidenceReview: { source: 'fallback', assessment: 'needs_more_information', statusAtReview: 'In Progress', generatedAt: '2026-10-01T00:00:00Z', verified: false, checks: [{ item: 'The student was told about the outcome', status: 'missing', note: 'Send the student a reply before closing.' }], followUpQuestions: [], limitations: 'Advisory only. This review reads the written record.' },
    },
    ...over,
  });

  it('shows steps, specialist and safety markers, and labels the evidence review as not verified', async () => {
    mockApi({ 'GET /api/auth/me': me('staff'), 'GET /api/complaints/c1': [200, { complaint: staffDetail() }], 'GET /api/complaints/c1/timeline': [200, { items: [] }] });
    renderApp('/staff/complaints/c1');
    expect(await screen.findByRole('heading', { name: 'Resolution assistance' })).toBeInTheDocument();
    expect(screen.getByText('Rewire the socket')).toBeInTheDocument();
    expect(screen.getByText('Specialist')).toBeInTheDocument();
    expect(screen.getByText('Isolate power first.')).toBeInTheDocument();
    expect(screen.getByText('More information needed')).toBeInTheDocument();
    expect(screen.getByText('Not verified.')).toBeInTheDocument();
  });

  it('the note written for the review pre-fills the required resolution note, and resolving needs it', async () => {
    const calls = mockApi({
      'GET /api/auth/me': me('staff'), 'GET /api/complaints/c1': [200, { complaint: staffDetail() }], 'GET /api/complaints/c1/timeline': [200, { items: [] }],
      'PATCH /api/complaints/c1/status': [200, { complaint: staffDetail({ status: 'Resolved', allowedTransitions: [] }) }],
    });
    const user = userEvent.setup();
    renderApp('/staff/complaints/c1');
    await user.type(await screen.findByLabelText('What was done'), 'Replaced AP-7 and tested from room 204.');
    await user.click(screen.getByRole('button', { name: 'Mark resolved' }));
    const note = screen.getByLabelText('Resolution note');
    expect(note).toHaveValue('Replaced AP-7 and tested from room 204.');
    await user.clear(note);
    await user.click(screen.getByRole('dialog').querySelector('button[type=submit]'));
    expect(screen.getByText('Enter a reason.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false); // nothing sent without the note
    await user.type(note, 'Replaced AP-7.');
    await user.click(screen.getByRole('dialog').querySelector('button[type=submit]'));
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(JSON.parse(patch.init.body)).toEqual({ status: 'Resolved', reason: 'Replaced AP-7.' });
  });

  it('is not shown to a staff member who is not the assignee', async () => {
    mockApi({ 'GET /api/auth/me': me('staff'), 'GET /api/complaints/c1': [200, { complaint: staffDetail({ assignee: { _id: 'someone-else', name: 'Other' } }) }], 'GET /api/complaints/c1/timeline': [200, { items: [] }] });
    renderApp('/staff/complaints/c1');
    expect(await screen.findByRole('heading', { name: 'Triage assistance' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Resolution assistance' })).not.toBeInTheDocument();
  });
});

describe('resolution assistance with a never-run agent', () => {
  it('treats the empty stored sub-object as "no suggestions yet" (regression)', async () => {
    const c = detail('staff', { status: 'In Progress', assignee: { _id: 'u1', name: 'Pat staff' }, ai: { resolution: { likelyCauses: [], troubleshootingSteps: [], safetyNotes: [] }, evidenceReview: { checks: [], verified: false } } });
    mockApi({ 'GET /api/auth/me': me('staff'), 'GET /api/complaints/c1': [200, { complaint: c }], 'GET /api/complaints/c1/timeline': [200, { items: [] }] });
    renderApp('/staff/complaints/c1');
    expect(await screen.findByRole('button', { name: 'Suggest troubleshooting steps' })).toBeInTheDocument();
    expect(screen.queryByText('Not verified.')).not.toBeInTheDocument();
  });
});

describe('toasts', () => {
  it('shows at most three at a time, dropping the oldest', async () => {
    function Spam() { const t = useToast(); return <button type="button" onClick={() => { for (let i = 1; i <= 5; i += 1) t.info(`Message ${i}`); }}>go</button>; }
    render(<ToastProvider><Spam /></ToastProvider>);
    await userEvent.setup().click(screen.getByRole('button', { name: 'go' }));
    expect(screen.queryByText('Message 2')).not.toBeInTheDocument();
    expect(screen.getByText('Message 3')).toBeInTheDocument();
    expect(screen.getByText('Message 5')).toBeInTheDocument();
  });
});
