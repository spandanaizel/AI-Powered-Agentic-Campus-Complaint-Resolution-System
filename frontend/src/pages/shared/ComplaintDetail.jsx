import { useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { FiAlertOctagon, FiCheckCircle } from 'react-icons/fi';
import PageHeader from '../../components/PageHeader';
import { StatusBadge, PriorityBadge, SourceTag } from '../../components/Badges';
import { ErrorState, PageLoading } from '../../components/States';
import ConfirmDialog from '../../components/ConfirmDialog';
import ResolutionPanel from '../../components/ResolutionPanel';
import { useToast } from '../../components/Toast';
import { useApi } from '../../hooks/useApi';
import { useAuth } from '../../auth/AuthContext';
import { api, attachmentUrl } from '../../api/client';
import { PRIORITIES, STATUS_HELP, formatDateTime, formatDate } from '../../constants';

const BASE = { student: '/student/complaints', staff: '/staff', admin: '/admin/complaints' };
const LIST_LABEL = { student: 'My complaints', staff: 'My queue', admin: 'All complaints' };
const ACTION_LABEL = {
  Reviewed: 'Mark reviewed', 'In Progress': 'Start work', Resolved: 'Mark resolved', Closed: 'Confirm fixed and close', Rejected: 'Reject',
};
const actionLabel = (from, to) => (to === 'In Progress' && ['Resolved', 'Closed'].includes(from) ? 'Reopen' : to === 'Reviewed' && from === 'Rejected' ? 'Reopen for review' : ACTION_LABEL[to] || to);

function Timeline({ items, role }) {
  if (!items.length) return <p className="muted">No activity yet.</p>;
  return (
    <ol className="timeline">
      {items.map((i) => (
        <li key={i.id} className={i.kind === 'comment' ? `comment ${i.visibility === 'internal' ? 'internal' : ''}` : ''}>
          <div>
            {i.kind === 'comment' ? (
              <strong>{i.actor?.name}{i.visibility === 'internal' ? ' added an internal note' : ' wrote'}</strong>
            ) : (
              <strong>{describeEvent(i, role)}</strong>
            )}
            {' '}<span className="when">{formatDateTime(i.at)}</span>
          </div>
          {i.kind === 'comment' && <div className="body">{i.body}</div>}
          {i.kind === 'comment' && i.fromAiDraft && <div className="small muted">Started from an AI draft and reviewed by staff before sending.</div>}
          {i.kind === 'event' && i.reason && <div className="small muted">Reason: {i.reason}</div>}
        </li>
      ))}
    </ol>
  );
}

function describeEvent(e, role) {
  const automatic = !e.actor || ['agent', 'system'].includes(e.actor.role);
  const who = e.actor?.name || 'System';
  switch (e.action) {
    case 'complaint.created': return 'Complaint submitted';
    case 'complaint.status_changed':
      if (automatic) return e.to === 'Assigned' ? 'Assigned to a staff member automatically' : `Status changed to ${e.to} automatically`;
      return `${who} changed the status from ${e.from} to ${e.to}`;
    case 'complaint.priority_escalated': return `Priority raised to ${e.to}: several people reported the same problem`;
    case 'complaint.priority_overridden': return `${who} set the priority to ${e.to}`;
    case 'complaint.priority_predicted': return `Priority set to ${e.to} by ${role === 'student' ? 'the system' : 'the priority agent'}`;
    case 'complaint.assigned': return automatic ? 'Matched to a staff member automatically' : `${who} assigned the complaint`;
    case 'complaint.reassigned': return `${who} reassigned the complaint`;
    default: return e.label || e.action;
  }
}

function AiPanel({ complaint, role, onRefresh }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const ai = complaint.ai || {};
  const run = async (agent) => {
    setBusy(agent);
    try {
      await api(`/complaints/${complaint._id}/agents/${agent}`, { method: 'POST' });
      toast.success('Updated.');
      onRefresh();
    } catch (err) { toast.error(err.message); } finally { setBusy(''); }
  };
  const rerun = (agent, label) => (
    <button type="button" className="btn btn-quiet btn-sm" onClick={() => run(agent)} disabled={Boolean(busy)}>{busy === agent ? 'Running…' : label}</button>
  );
  return (
    <section className="panel" aria-labelledby="ai-h">
      <h2 id="ai-h" style={{ fontSize: 'var(--step-1)' }}>Triage assistance</h2>
      <p className="small muted">Suggestions only. People make the decisions; the original complaint is shown on the left.</p>
      <div className="ai-box">
        <h3>Summary {ai.summary?.source && <SourceTag source={ai.summary.source} model={ai.summary.model} />}</h3>
        {ai.summary?.text ? (
          <>
            <p className="small" style={{ marginBottom: '.35rem' }}>{ai.summary.text}</p>
            {ai.summary.keyFacts?.length > 0 && <ul className="small" style={{ margin: '0 0 .35rem', paddingLeft: '1.1rem' }}>{ai.summary.keyFacts.map((k) => <li key={k}>{k}</li>)}</ul>}
            {ai.summary.categoryHint && <p className="small">Possible better category: {ai.summary.categoryHint}</p>}
            {ai.summary.limitations && <p className="small muted">{ai.summary.limitations}</p>}
          </>
        ) : <p className="small muted">Not generated yet.</p>}
        {rerun('summary', ai.summary?.text ? 'Regenerate summary' : 'Generate summary')}
      </div>
      {role === 'admin' && (
        <>
          <div className="ai-box">
            <h3>Priority recommendation {ai.priority?.source && <SourceTag source={ai.priority.source} model={ai.priority.model} />}</h3>
            {ai.priority?.predicted ? (
              <>
                <p className="small" style={{ marginBottom: '.35rem' }}><PriorityBadge priority={ai.priority.predicted} /> {ai.priority.confidence != null && <span className="muted">Confidence {Math.round(ai.priority.confidence * 100)}%</span>}</p>
                <p className="small">{ai.priority.rationale}</p>
                {complaint.prioritySource !== 'ai' && complaint.prioritySource !== 'fallback-rules' && complaint.prioritySource !== 'default' && (
                  <p className="small muted">Not applied: the current priority comes from {complaint.prioritySource === 'escalation' ? 'repeated-issue escalation' : 'an administrator'}.</p>
                )}
              </>
            ) : <p className="small muted">Not generated yet.</p>}
            {rerun('priority', 'Re-run prediction')}
          </div>
          <div className="ai-box">
            <h3>Assignment recommendation {ai.assignment?.source && <SourceTag source={ai.assignment.source} model={ai.assignment.model} />}</h3>
            {ai.assignment?.reason ? (
              <>
                {ai.assignment.recommendedStaff && <p className="small" style={{ marginBottom: '.25rem' }}>Recommended: <strong>{ai.assignment.recommendedStaff.name || 'staff member'}</strong>{ai.assignment.applied ? ' (applied automatically)' : ''}</p>}
                <p className="small">{ai.assignment.reason}</p>
              </>
            ) : <p className="small muted">Not generated yet.</p>}
            {rerun('assignment', 'Get a recommendation')}
          </div>
        </>
      )}
    </section>
  );
}

function AdminControls({ complaint, onRefresh }) {
  const toast = useToast();
  const staff = useApi('/staff', { query: { categoryId: complaint.category?._id } });
  const [staffId, setStaffId] = useState('');
  const [priority, setPriority] = useState(complaint.priority);
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const assignable = !['Resolved', 'Closed', 'Rejected'].includes(complaint.status);
  const eligible = (staff.data?.items || []).filter((s) => s.active);

  const act = async (fn, msg) => {
    setBusy(true);
    try { await fn(); toast.success(msg); setDialog(null); onRefresh(); } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  return (
    <section className="panel" aria-labelledby="adm-h">
      <h2 id="adm-h" style={{ fontSize: 'var(--step-1)' }}>Administrator actions</h2>
      <div className="field">
        <label htmlFor="assignee">Assign to</label>
        {staff.error ? <ErrorState error={staff.error} onRetry={staff.reload} /> : (
          <select id="assignee" value={staffId} onChange={(e) => setStaffId(e.target.value)} disabled={!assignable || staff.loading}>
            <option value="">{staff.loading ? 'Loading staff…' : eligible.length ? 'Choose a staff member…' : 'No active staff cover this category'}</option>
            {eligible.map((s) => <option key={s._id} value={s._id} disabled={String(s._id) === String(complaint.assignee?._id)}>{s.name} ({s.openAssignments}/{s.maxOpenAssignments} open)</option>)}
          </select>
        )}
        {!assignable && <span className="hint">{complaint.status} complaints can’t be reassigned.</span>}
      </div>
      <button type="button" className="btn btn-secondary btn-sm" disabled={!staffId || !assignable} onClick={() => setDialog('assign')}>{complaint.assignee ? 'Reassign' : 'Assign'}</button>

      <div className="field" style={{ marginTop: '1.25rem' }}>
        <label htmlFor="priority">Priority</label>
        <select id="priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
          {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <span className="hint">{complaint.prioritySource === 'override' ? 'Set manually. Automatic escalation will not change it.' : 'Changing it here is a manual override. Automatic escalation will not change it afterwards.'}</span>
      </div>
      <button type="button" className="btn btn-secondary btn-sm" disabled={priority === complaint.priority && complaint.prioritySource === 'override'} onClick={() => setDialog('priority')}>Override priority</button>

      <ConfirmDialog open={dialog === 'assign'} title="Assign this complaint?" confirmLabel="Assign" busy={busy} reasonLabel="Note for the record"
        onCancel={() => setDialog(null)}
        onConfirm={(reason) => act(() => api(`/complaints/${complaint._id}/assign`, { method: 'POST', body: { staffId, ...(reason ? { reason } : {}) } }), 'Complaint assigned.')}>
        <p>{eligible.find((s) => s._id === staffId)?.name} will see it in their queue.</p>
      </ConfirmDialog>
      <ConfirmDialog open={dialog === 'priority'} title={`Set priority to ${priority}?`} confirmLabel="Override priority" busy={busy} reasonLabel="Reason" reasonRequired
        onCancel={() => setDialog(null)}
        onConfirm={(reason) => act(() => api(`/complaints/${complaint._id}/priority`, { method: 'PATCH', body: { priority, reason } }), 'Priority updated.')}>
        <p>This is recorded in the audit history. Repeated-issue escalation will no longer change this complaint’s priority.</p>
      </ConfirmDialog>
    </section>
  );
}

function Composer({ complaint, role, canDraft, onPosted }) {
  const toast = useToast();
  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState('public');
  const [fromDraft, setFromDraft] = useState(false);
  const [guidance, setGuidance] = useState('');
  const [draftInfo, setDraftInfo] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const closedForStudent = role === 'student' && ['Closed', 'Rejected'].includes(complaint.status);

  const draft = async () => {
    setBusy('draft'); setError('');
    try {
      const d = await api(`/complaints/${complaint._id}/agents/response-draft`, { method: 'POST', body: guidance.trim() ? { guidance: guidance.trim() } : {} });
      setBody(d.result.draft); setVisibility('public'); setFromDraft(true); setDraftInfo(d.result);
    } catch (err) { setError(err.message); } finally { setBusy(''); }
  };
  const send = async (e) => {
    e.preventDefault();
    if (!body.trim()) { setError('Write a message first.'); return; }
    setBusy('send'); setError('');
    try {
      await api(`/complaints/${complaint._id}/comments`, { method: 'POST', body: { body: body.trim(), visibility: role === 'student' ? 'public' : visibility, ...(role !== 'student' ? { fromAiDraft: fromDraft && visibility === 'public' } : {}) } });
      setBody(''); setFromDraft(false); setDraftInfo(null); setGuidance('');
      toast.success(visibility === 'internal' && role !== 'student' ? 'Internal note added.' : 'Message sent.');
      onPosted();
    } catch (err) { setError(err.message); } finally { setBusy(''); }
  };

  if (closedForStudent) return <p className="muted small">This complaint is {complaint.status.toLowerCase()}, so new updates can’t be added.</p>;

  return (
    <form onSubmit={send} noValidate className="stack" style={{ marginTop: '1rem' }}>
      {role !== 'student' && (
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="small" style={{ fontWeight: 600 }}>Who can see this</legend>
          <div className="row small">
            <label><input type="radio" name="vis" value="public" checked={visibility === 'public'} onChange={() => setVisibility('public')} /> Reply to the student</label>
            <label><input type="radio" name="vis" value="internal" checked={visibility === 'internal'} onChange={() => { setVisibility('internal'); setFromDraft(false); }} /> Internal note (staff and admins only)</label>
          </div>
        </fieldset>
      )}
      {canDraft && visibility === 'public' && (
        <details>
          <summary className="small" style={{ cursor: 'pointer', fontWeight: 600 }}>Draft a reply with the resolution assistant</summary>
          <div className="field" style={{ marginTop: '.5rem' }}>
            <label htmlFor="guidance">What should the reply say?</label>
            <span id="guidance-hint" className="hint">Facts the reply may state, such as what was done. The assistant won’t promise dates you don’t give it.</span>
            <textarea id="guidance" value={guidance} onChange={(e) => setGuidance(e.target.value)} maxLength={800} aria-describedby="guidance-hint" style={{ minHeight: '4rem' }} />
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={draft} disabled={Boolean(busy)}>{busy === 'draft' ? 'Drafting…' : 'Create draft'}</button>
        </details>
      )}
      {draftInfo && (
        <div className="banner banner-info" role="status">
          <div className="stack">
            <p><SourceTag source={draftInfo.source} model={draftInfo.model} /> Draft inserted below. Review and edit it before sending; nothing has been sent.</p>
            {draftInfo.warnings?.map((w) => <p key={w} className="small"><strong>Check:</strong> {w}</p>)}
          </div>
        </div>
      )}
      <div className="field">
        <label htmlFor="msg">{role === 'student' ? 'Add an update' : visibility === 'internal' ? 'Internal note' : 'Message to the student'}</label>
        <textarea id="msg" value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} aria-invalid={Boolean(error)} aria-describedby={error ? 'msg-err' : undefined} />
        {error && <span id="msg-err" className="error" role="alert">{error}</span>}
      </div>
      <div><button type="submit" className="btn btn-primary" disabled={Boolean(busy)}>{busy === 'send' ? 'Sending…' : role !== 'student' && visibility === 'internal' ? 'Add internal note' : 'Send message'}</button></div>
    </form>
  );
}

export default function ComplaintDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const role = user.role;
  const location = useLocation();
  const toast = useToast();
  const detail = useApi(`/complaints/${id}`);
  const tl = useApi(`/complaints/${id}/timeline`);
  const [transition, setTransition] = useState(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = () => { detail.reload(); tl.reload(); };

  if (detail.loading && !detail.data) return <><PageHeader title="Complaint" crumbs={[{ to: BASE[role], label: LIST_LABEL[role] }]} /><PageLoading /></>;
  if (detail.error) {
    return (
      <>
        <PageHeader title={detail.error.status === 404 ? 'Complaint not found' : 'Complaint'} crumbs={[{ to: BASE[role], label: LIST_LABEL[role] }]} />
        <ErrorState error={detail.error} onRetry={detail.error.status === 404 ? null : detail.reload} title={detail.error.status === 404 ? 'It doesn’t exist or you don’t have access to it' : undefined} />
      </>
    );
  }
  const c = detail.data.complaint;
  const transitions = c.allowedTransitions || [];
  const canDraft = role === 'admin' || (role === 'staff' && String(c.assignee?._id) === String(user.id));

  const doTransition = async (reason) => {
    setBusy(true);
    try {
      await api(`/complaints/${c._id}/status`, { method: 'PATCH', body: { status: transition.to, ...(reason ? { reason } : {}) } });
      toast.success(`Status changed to ${transition.to}.`);
      if (transition.to === 'Resolved') setResolutionNote('');
      setTransition(null); refresh();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title={c.title} crumbs={[{ to: BASE[role], label: LIST_LABEL[role] }]} />
      <div className="row" style={{ marginTop: '-1rem', marginBottom: '1.25rem' }}>
        <StatusBadge status={c.status} /><PriorityBadge priority={c.priority} />
        <span className="muted small">Reported {formatDate(c.createdAt)}</span>
      </div>

      {location.state?.justCreated && (
        <div className="banner banner-success" role="status"><FiCheckCircle aria-hidden="true" /><p>Your complaint was submitted. You’ll see status changes and staff replies on this page.</p></div>
      )}
      {c.issue?.escalated && (
        <div className="banner banner-escalated" role="note">
          <FiAlertOctagon aria-hidden="true" />
          <p><strong>Escalated to top priority.</strong> {role === 'student'
            ? 'Several students have reported this same problem in this location.'
            : `${c.issue.reporterCount} different people have reported this problem (${c.category?.name}, ${c.location?.name}). The rule escalates any issue reported by more than 5 people.`}
            {c.prioritySource === 'override' && role !== 'student' && ' This complaint keeps its manually set priority.'}</p>
        </div>
      )}

      <div className="grid-2">
        <div className="stack">
          <section className="panel" aria-labelledby="orig-h">
            <h2 id="orig-h" style={{ fontSize: 'var(--step-1)' }}>{role === 'student' ? 'What you reported' : 'Original complaint'}</h2>
            <p className="original">{c.description}</p>
            <dl className="kv">
              <dt>Category</dt><dd>{c.category?.name}</dd>
              <dt>Location</dt><dd>{c.location?.name}</dd>
              {role !== 'student' && <><dt>Reported by</dt><dd>{c.reporter?.name} <span className="muted">({c.reporter?.email})</span></dd></>}
              <dt>Assigned to</dt><dd>{c.assignee?.name || 'Not assigned yet'}</dd>
              {role !== 'student' && c.issue && <><dt>Same-issue reports</dt><dd>{c.issue.reporterCount} {c.issue.reporterCount === 1 ? 'person' : 'different people'}</dd></>}
            </dl>
            {c.attachments?.length > 0 && (
              <div className="attachments" style={{ marginTop: '1rem' }}>
                <h3 style={{ fontSize: 'var(--step-0)' }}>Photo</h3>
                {c.attachments.map((a) => (
                  <a key={a._id} href={attachmentUrl(c._id, a._id)} target="_blank" rel="noopener noreferrer">
                    <img src={attachmentUrl(c._id, a._id)} alt={`Photo attached to the complaint: ${a.originalName}`} loading="lazy" />
                  </a>
                ))}
              </div>
            )}
          </section>

          <section className="panel" aria-labelledby="tl-h">
            <h2 id="tl-h" style={{ fontSize: 'var(--step-1)' }}>History and messages</h2>
            {tl.loading && !tl.data && <PageLoading label="Loading history" />}
            {tl.error && <ErrorState error={tl.error} onRetry={tl.reload} />}
            {tl.data && <Timeline items={tl.data.items} role={role} />}
            <Composer complaint={c} role={role} canDraft={canDraft} onPosted={tl.reload} />
          </section>
        </div>

        <div className="stack">
          <section className="panel" aria-labelledby="st-h">
            <h2 id="st-h" style={{ fontSize: 'var(--step-1)' }}>Status: {c.status}</h2>
            <p className="small muted">{STATUS_HELP[c.status]}</p>
            {transitions.length > 0 ? (
              <div className="row">
                {transitions.map((t) => (
                  <button key={t.to} type="button" className={`btn btn-sm ${t.to === 'Rejected' ? 'btn-secondary' : 'btn-primary'}`} onClick={() => setTransition(t)}>{actionLabel(c.status, t.to)}</button>
                ))}
              </div>
            ) : <p className="small muted">{role === 'admin' && ['Submitted', 'Reviewed'].includes(c.status) ? 'Assign it to move it forward.' : 'No status changes are available to you right now.'}</p>}
          </section>
          {canDraft && <ResolutionPanel complaint={c} note={resolutionNote} onNoteChange={setResolutionNote} onRefresh={refresh} />}
          {role !== 'student' && <AiPanel complaint={c} role={role} onRefresh={refresh} />}
          {role === 'admin' && <AdminControls key={`${c._id}-${c.priority}-${c.assignee?._id}`} complaint={c} onRefresh={refresh} />}
        </div>
      </div>

      <ConfirmDialog open={Boolean(transition)} title={transition ? `${actionLabel(c.status, transition.to)}?` : ''} confirmLabel={transition ? actionLabel(c.status, transition.to) : ''}
        danger={transition?.to === 'Rejected'} busy={busy}
        reasonLabel={transition ? (transition.to === 'Resolved' ? 'Resolution note' : 'Reason') : undefined}
        reasonHint={transition?.to === 'Resolved' ? 'What was done and how you checked it. The student will see this note.' : undefined}
        initialReason={transition?.to === 'Resolved' ? resolutionNote : ''}
        reasonRequired={transition?.reasonRequired}
        onCancel={() => setTransition(null)} onConfirm={doTransition}>
        {transition && <p>The status will change from {c.status} to {transition.to}. {role !== 'student' ? 'The student will see this change.' : ''}</p>}
        {transition?.to === 'Closed' && role !== 'student' && (
          c.ai?.evidenceReview?.assessment
            ? <p className="small">Latest evidence review: <strong>{{ likely_sufficient: 'record looks sufficient', needs_more_information: 'more information needed', cannot_assess: 'cannot assess from the record' }[c.ai.evidenceReview.assessment]}</strong>. It is advisory and not a verification of the work.</p>
            : <p className="small muted">No evidence review has been run. You can run one in Resolution assistance before closing.</p>
        )}
      </ConfirmDialog>
    </>
  );
}
