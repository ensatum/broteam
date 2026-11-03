import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import SessionErrorBoundary from './components/SessionErrorBoundary';
import { sessionLog } from './sessionLog';
import './index.css';

window.addEventListener('error', (event) => {
  sessionLog('error', 'window.error', {
    message: event.message,
    stack: event.error instanceof Error ? event.error.stack : undefined,
    filename: event.filename,
    line: event.lineno,
  });
});
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  sessionLog('error', 'unhandledrejection', {
    message: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});
sessionLog('info', 'renderer start');

// Linux Electron paints an orange focus ring on whatever was clicked, including
// inputs, selects, and table cells. Mouse clicks drop that focus after the
// browser has applied it. Keyboard activation (detail === 0) keeps focus.
// A select stays focused until the next click outside it, so its menu can open.
document.addEventListener(
  'mousedown',
  (event) => {
    if (event.detail === 0) return;
    const target = event.target;
    window.setTimeout(() => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) return;
      if (active === document.body || active === document.documentElement) return;
      if (!(target instanceof Node)) return;
      if (active instanceof HTMLSelectElement) {
        if (!active.contains(target)) active.blur();
        return;
      }
      if (active.closest('input, textarea, [contenteditable="true"]')) return;
      active.blur();
    }, 0);
  },
  true,
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SessionErrorBoundary>
      <App />
    </SessionErrorBoundary>
  </StrictMode>,
);
