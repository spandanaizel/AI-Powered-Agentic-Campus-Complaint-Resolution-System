import { useState } from 'react';
import { FiAlertTriangle } from 'react-icons/fi';
import { SourceTag } from './Badges';
import { useToast } from './Toast';
import { api } from '../api/client';
import { formatDateTime } from '../constants';

const ASSESSMENT = {
  likely_sufficient: 'The record looks sufficient',
  needs_more_information: 'More information needed',
  cannot_assess: 'Cannot assess from the record',
};
const CHECK = { present: 'Present', missing: 'Missing', unclear: 'Unclear' };

/**
 * Resolution and Response Agent, staff-facing tasks: troubleshooting suggestions and a review of the
 * resolution record. Advisory only. Nothing here changes the complaint; resolving and closing stay
 * explicit actions in the Status panel.
 */
export default function ResolutionPanel({ complaint, note, onNoteChange, onRefresh }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  // The database returns empty sub-objects for tasks that never ran, so test generatedAt, not presence.
  const res = complaint.ai?.resolution?.generatedAt ? complaint.ai.resolution : null;
  const ev = complaint.ai?.evidenceReview?.generatedAt ? complaint.ai.evidenceReview : null;
  const canReview = ['In Progress', 'Resolved'].includes(complaint.status);

  const run = async (path, body, msg) => {
    setBusy(path);
    try { await api(`/complaints/${complaint._id}/agents/${path}`, { method: 'POST', body }); toast.success(msg); onRefresh(); }
    catch (err) { toast.error(err.message); } finally { setBusy(''); }
  };

  return (
    <section className="panel" aria-labelledby="res-h">
      <h2 id="res-h" style={{ fontSize: 'var(--step-1)' }}>Resolution assistance</h2>
      <p className="small muted">Advice for staff. It never changes the complaint or contacts the student.</p>

      <div className="ai-box">
        <h3>Troubleshooting {res?.source && <SourceTag source={res.source} model={res.model} />}</h3>
        {res?.troubleshootingSteps?.length ? (
          <>
            {res.safetyNotes?.length > 0 && (
              <div className="banner banner-error" style={{ marginBottom: '.5rem' }}>
                <FiAlertTriangle aria-hidden="true" />
                <div>{res.safetyNotes.map((n) => <p key={n} className="small"><strong>Safety:</strong> {n}</p>)}</div>
              </div>
            )}
            <ol className="small" style={{ margin: '0 0 .5rem', paddingLeft: '1.2rem' }}>
              {res.troubleshootingSteps.map((s) => <li key={s.step}>{s.step}{s.who === 'specialist' && <> <span className="badge st">Specialist</span></>}</li>)}
            </ol>
            {res.likelyCauses?.length > 0 && <p className="small"><strong>Likely causes:</strong> {res.likelyCauses.join('; ')}</p>}
            {res.possibleResolutions?.length > 0 && <p className="small"><strong>Possible resolutions:</strong> {res.possibleResolutions.join('; ')}</p>}
            {res.informationNeeded?.length > 0 && <p className="small"><strong>Still unknown:</strong> {res.informationNeeded.join('; ')}</p>}
            <p className="small muted">{res.limitations}</p>
          </>
        ) : <p className="small muted">No suggestions yet.</p>}
        <button type="button" className="btn btn-quiet btn-sm" disabled={Boolean(busy)} onClick={() => run('resolution-suggestions', undefined, 'Suggestions updated.')}>
          {busy === 'resolution-suggestions' ? 'Working…' : res ? 'Refresh suggestions' : 'Suggest troubleshooting steps'}
        </button>
      </div>

      <div className="ai-box">
        <h3>Resolution evidence review {ev?.source && <SourceTag source={ev.source} model={ev.model} />}</h3>
        {canReview ? (
          <>
            {complaint.status === 'In Progress' && (
              <div className="field">
                <label htmlFor="res-note">What was done</label>
                <span id="res-note-hint" className="hint">What you fixed, and how you checked it works. This becomes the resolution note the student sees when you mark it resolved.</span>
                <textarea id="res-note" value={note} onChange={(e) => onNoteChange(e.target.value)} maxLength={1000} aria-describedby="res-note-hint" style={{ minHeight: '4.5rem' }} />
              </div>
            )}
            <button type="button" className="btn btn-secondary btn-sm" disabled={Boolean(busy)}
              onClick={() => run('evidence-review', complaint.status === 'In Progress' && note.trim() ? { resolutionNote: note.trim() } : {}, 'Review updated.')}>
              {busy === 'evidence-review' ? 'Reviewing…' : complaint.status === 'Resolved' ? 'Review before closing' : 'Review before resolving'}
            </button>
          </>
        ) : <p className="small muted">Available once work is in progress.</p>}
        {ev?.assessment && (
          <div style={{ marginTop: '.75rem' }}>
            <p className="small" style={{ marginBottom: '.35rem' }}><strong>{ASSESSMENT[ev.assessment]}</strong> <span className="muted">({ev.statusAtReview}, {formatDateTime(ev.generatedAt)})</span></p>
            <ul className="small" style={{ margin: '0 0 .5rem', paddingLeft: '1.1rem' }}>
              {ev.checks.map((c) => <li key={c.item}><strong>{CHECK[c.status]}:</strong> {c.item}{c.note ? `. ${c.note}` : ''}</li>)}
            </ul>
            {ev.followUpQuestions?.length > 0 && <p className="small"><strong>Answer before closing:</strong> {ev.followUpQuestions.join(' ')}</p>}
            <p className="small"><strong>Not verified.</strong> <span className="muted">{ev.limitations}</span></p>
          </div>
        )}
      </div>
    </section>
  );
}
