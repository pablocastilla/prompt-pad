import React from 'react';
import { useStore } from '../store';

export function GaudyToast() {
  const toasts = useStore(s => s.toasts);
  const removeToast = useStore(s => s.removeToast);

  return (
    <div className="gaudy-toast-container">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className="gaudy-toast"
          onClick={() => removeToast(toast.id)}
        >
          <span className="gaudy-toast-badge" aria-hidden="true">✦</span>
          <span className="gaudy-toast-text">{toast.message}</span>
        </div>
      ))}
    </div>
  );
}
