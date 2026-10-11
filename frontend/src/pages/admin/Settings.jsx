import PageHeader from '../../components/PageHeader';
import { ErrorState, PageLoading } from '../../components/States';
import { useApi } from '../../hooks/useApi';
import { useAuth } from '../../auth/AuthContext';
import { formatDateTime } from '../../constants';

export default function Settings() {
  const { user } = useAuth();
  const s = useApi('/settings');
  return (
    <>
      <PageHeader title="Settings" description="Current system configuration. These values are set in the server’s environment file by whoever runs the system." />
      {s.loading && <PageLoading />}
      {s.error && <ErrorState error={s.error} onRetry={s.reload} />}
      {s.data && (
        <div className="grid-even">
          <section className="panel" aria-labelledby="esc-h">
            <h2 id="esc-h" style={{ fontSize: 'var(--step-1)' }}>Repeated-issue escalation</h2>
            <dl className="kv">
              <dt>Rule</dt><dd>{s.data.escalation.rule}</dd>
              <dt>Threshold</dt><dd>More than {s.data.escalation.threshold} different people</dd>
              <dt>Counting window</dt><dd>{s.data.escalation.windowDays ? `${s.data.escalation.windowDays} days` : 'All time'}</dd>
              <dt>Manual overrides</dt><dd>Kept. Escalation never changes a priority an administrator set.</dd>
            </dl>
          </section>
          <section className="panel" aria-labelledby="ai-s-h">
            <h2 id="ai-s-h" style={{ fontSize: 'var(--step-1)' }}>Triage assistance</h2>
            <dl className="kv">
              <dt>AI provider</dt><dd>{s.data.agents.provider.configured ? `Google Gemini, model ${s.data.agents.provider.model}` : 'Not configured (demo mode). Every assistant uses labelled rule-based fallbacks.'}</dd>
              {s.data.agents.provider.coolingDownUntil && (
                <><dt>Status</dt><dd>Paused after a Gemini {s.data.agents.provider.coolDownReason} until {formatDateTime(s.data.agents.provider.coolingDownUntil)}. Assistants use rule-based fallbacks until then.</dd></>
              )}
              <dt>Automatic assignment</dt><dd>{s.data.agents.autoAssign ? 'On' : 'Off'}</dd>
            </dl>
          </section>
          <section className="panel" aria-labelledby="up-h">
            <h2 id="up-h" style={{ fontSize: 'var(--step-1)' }}>Photo uploads</h2>
            <dl className="kv">
              <dt>Maximum size</dt><dd>{Math.round(s.data.uploads.maxBytes / 1048576)} MB</dd>
              <dt>Allowed types</dt><dd>JPEG, PNG, WebP</dd>
            </dl>
          </section>
          <section className="panel" aria-labelledby="me-h">
            <h2 id="me-h" style={{ fontSize: 'var(--step-1)' }}>Your account</h2>
            <dl className="kv"><dt>Name</dt><dd>{user.name}</dd><dt>Email</dt><dd>{user.email}</dd></dl>
          </section>
        </div>
      )}
    </>
  );
}
