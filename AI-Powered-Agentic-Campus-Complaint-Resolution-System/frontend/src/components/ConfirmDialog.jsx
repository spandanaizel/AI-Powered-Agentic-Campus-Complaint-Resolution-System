import { useEffect, useId, useRef, useState } from 'react';

function DialogBody({ id, title, children, confirmLabel, danger, reasonLabel, reasonRequired, reasonHint, initialReason = '', busy, onConfirm, onCancel }) {
  // Mounted only while open, so the reason field starts from initialReason each time.
  const [reason, setReason] = useState(initialReason);
  const [error, setError] = useState('');
  const submit = (e) => {
    e.preventDefault();
    if (reasonRequired && !reason.trim()) { setError('Enter a reason.'); return; }
    onConfirm(reason.trim());
  };
  return (
    <form onSubmit={submit} noValidate>
      <h2 id={`${id}-t`} style={{ fontSize: 'var(--step-1)' }}>{title}</h2>
      {children}
      {reasonLabel && (
        <div className="field">
          <label htmlFor={`${id}-r`}>{reasonLabel}{reasonRequired ? '' : ' (optional)'}</label>
          {reasonHint && <span id={`${id}-h`} className="hint">{reasonHint}</span>}
          <textarea id={`${id}-r`} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={Boolean(error)} aria-describedby={[reasonHint && `${id}-h`, error && `${id}-e`].filter(Boolean).join(' ') || undefined} maxLength={1000} />
          {error && <span id={`${id}-e`} className="error">{error}</span>}
        </div>
      )}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy}>{busy ? 'Saving…' : confirmLabel}</button>
      </div>
    </form>
  );
}

/**
 * Accessible confirmation built on <dialog> (focus trapping, Esc to close, backdrop).
 * If `reasonLabel` is set, a reason textarea is shown; `reasonRequired` makes it mandatory.
 */
export default function ConfirmDialog({ open, onCancel, ...rest }) {
  const ref = useRef(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close?.();
  }, [open]);
  return (
    <dialog ref={ref} className="modal" aria-labelledby={`${id}-t`} onCancel={(e) => { e.preventDefault(); onCancel(); }}>
      {open && <DialogBody id={id} onCancel={onCancel} {...rest} />}
    </dialog>
  );
}
