import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { FiX } from 'react-icons/fi';

const ToastContext = createContext(null);
let nextId = 1;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const show = useCallback((message, kind = 'info') => {
    const id = nextId++;
    // Keep at most three on screen so they never bury the page; the oldest goes first.
    setToasts((t) => [...t, { id, message, kind }].slice(-3));
    setTimeout(() => dismiss(id), kind === 'error' ? 8000 : 5000);
  }, [dismiss]);
  const value = useMemo(() => ({ success: (m) => show(m, 'success'), error: (m) => show(m, 'error'), info: (m) => show(m) }), [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <span>{t.message}</span>
            <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss notification"><FiX aria-hidden="true" /></button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export const useToast = () => useContext(ToastContext);
