import { $ } from './dom.js';

/* ======================================================================
   Theme
   ====================================================================== */
function applyTheme(theme) {
  document.body.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#14171F' : '#F6F1E4');
}
export function initTheme() {
  // 'scaffale-theme' kept as fallback so an older install keeps its choice
  applyTheme(localStorage.getItem('booknest-theme') || localStorage.getItem('scaffale-theme') || 'dark');
  $('#theme-toggle').addEventListener('click', () => {
    const next = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    localStorage.setItem('booknest-theme', next);
  });
}
