/* ======================================================================
   Helpers
   ====================================================================== */
export const $ = (sel) => document.querySelector(sel);
export const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function showToast(msg, ms = 2200, action = null) {
  const t = $('#toast');
  t.textContent = msg;
  if (action) {
    const b = el('button', 'toast__action', escapeHtml(action.label));
    b.type = 'button';
    b.onclick = () => { clearTimeout(showToast._t); t.hidden = true; action.onClick(); };
    t.appendChild(b);
  }
  t.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => (t.hidden = true), ms);
}

export function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function fmtDate(ts) {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch (e) { return '—'; }
}

export function fmtMinutes(seconds) {
  const m = Math.round(seconds / 60);
  if (m < 60) return m + ' min';
  return Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
}
