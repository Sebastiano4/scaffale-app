import { state, bookStatus } from './state.js';
import { $, el, showToast, fmtMinutes } from './dom.js';
import { Stats, Goal } from './stats.js';

function statTotals() {
  const s = Stats.load();
  let totalPages = 0, totalSeconds = 0;
  for (const d of Object.values(s.days)) { totalPages += d.pages || 0; totalSeconds += d.seconds || 0; }
  return { totalPages, totalSeconds };
}

function mostReadAuthor(books) {
  const counts = {};
  books.filter((b) => bookStatus(b) === 'read' && b.author).forEach((b) => {
    counts[b.author] = (counts[b.author] || 0) + 1;
  });
  let best = null, n = 0;
  for (const [a, c] of Object.entries(counts)) if (c > n) { best = a; n = c; }
  return best ? { author: best, count: n } : null;
}

function dayKeyOf(date) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

function renderHistoryChart(container) {
  const s = Stats.load();
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const k = Stats.dayKey(i);
    days.push({ k, pages: (s.days[k] && s.days[k].pages) || 0 });
  }
  const max = Math.max(1, ...days.map((d) => d.pages));
  const chart = el('div', 'chart');
  days.forEach((d) => {
    const col = el('div', 'chart__col');
    const bar = el('div', 'chart__bar' + (d.pages === 0 ? ' chart__bar--empty' : ''));
    bar.style.height = Math.max(d.pages === 0 ? 3 : 6, Math.round((d.pages / max) * 100)) + '%';
    bar.title = d.k + ': ' + d.pages + ' pages';
    col.appendChild(bar);
    chart.appendChild(col);
  });
  container.appendChild(chart);
  container.appendChild(el('div', 'chart__caption', 'Pages read · last 14 days'));
}

function renderHeatmap(container) {
  const s = Stats.load();
  const weeks = 13;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dow = (today.getDay() + 6) % 7; // Monday = 0
  const start = new Date(today);
  start.setDate(start.getDate() - (dow + (weeks - 1) * 7));
  const max = Math.max(1, ...Object.values(s.days).map((d) => d.pages || 0));
  const grid = el('div', 'heatmap');
  let col = null;
  for (let i = 0; i < weeks * 7; i++) {
    if (i % 7 === 0) { col = el('div', 'heatmap__col'); grid.appendChild(col); }
    const dt = new Date(start); dt.setDate(dt.getDate() + i);
    const cell = el('div', 'heatmap__cell');
    if (dt > today) { cell.dataset.level = 'future'; col.appendChild(cell); continue; }
    const key = dayKeyOf(dt);
    const pages = (s.days[key] && s.days[key].pages) || 0;
    cell.dataset.level = pages === 0 ? 0 : Math.min(4, Math.ceil((pages / max) * 4));
    cell.title = key + ': ' + pages + ' pages';
    col.appendChild(cell);
  }
  container.appendChild(grid);
  container.appendChild(el('div', 'chart__caption', 'Consistency · last 13 weeks'));
}

function openGoalEditor(rerender) {
  const g = Goal.load() || { type: 'books', period: 'year', target: 12 };
  const host = $('#goal-editor');
  host.innerHTML = '';
  host.hidden = false;
  const mk = (id, label, opts, val) => {
    const wrap = el('label', 'goal-field');
    wrap.appendChild(el('span', null, label));
    const sel = el('select'); sel.id = id;
    opts.forEach(([v, t]) => { const o = el('option', null, t); o.value = v; if (v === val) o.selected = true; sel.appendChild(o); });
    wrap.appendChild(sel);
    return wrap;
  };
  host.appendChild(mk('goal-type', 'Count', [['books', 'Books'], ['pages', 'Pages']], g.type));
  host.appendChild(mk('goal-period', 'Period', [['week', 'per week'], ['year', 'this year']], g.period));
  const numWrap = el('label', 'goal-field');
  numWrap.appendChild(el('span', null, 'Goal'));
  const num = el('input'); num.id = 'goal-target'; num.type = 'number'; num.min = '1'; num.value = g.target;
  numWrap.appendChild(num);
  host.appendChild(numWrap);
  const actions = el('div', 'goal-editor__actions');
  const save = el('button', 'btn btn--primary btn--sm', 'Save goal');
  save.onclick = () => {
    const t = parseInt($('#goal-target').value, 10);
    if (isNaN(t) || t < 1) { showToast('Enter a valid number'); return; }
    Goal.save({ type: $('#goal-type').value, period: $('#goal-period').value, target: t });
    host.hidden = true;
    rerender();
  };
  const remove = el('button', 'btn btn--ghost btn--sm', 'Remove');
  remove.onclick = () => { Goal.clear(); host.hidden = true; rerender(); };
  actions.appendChild(save); actions.appendChild(remove);
  host.appendChild(actions);
}

export function renderStats() {
  const books = state.books;
  const s = Stats.summary();
  const totals = statTotals();
  const finished = books.filter((b) => bookStatus(b) === 'read').length;
  const inProgress = books.filter((b) => bookStatus(b) === 'reading').length;
  const speed = totals.totalSeconds > 0 ? (totals.totalPages / (totals.totalSeconds / 3600)) : 0;
  const author = mostReadAuthor(books);

  const body = $('#stats-body');
  body.innerHTML = '';

  // --- reading goal ---
  const prog = Goal.progress(books);
  const goalBox = el('div', 'goal');
  if (prog) {
    goalBox.appendChild(el('div', 'goal__label', '🎯 ' + prog.label));
    const barWrap = el('div', 'goal__bar');
    const fill = el('div', 'goal__fill'); fill.style.width = prog.pct + '%';
    barWrap.appendChild(fill);
    goalBox.appendChild(barWrap);
    goalBox.appendChild(el('div', 'goal__meta', prog.done + ' / ' + prog.target + (prog.pct >= 100 ? ' · reached! 🎉' : ' · ' + prog.pct + '%')));
    const edit = el('button', 'goal__edit', 'Edit goal');
    edit.onclick = () => openGoalEditor(renderStats);
    goalBox.appendChild(edit);
  } else {
    const setBtn = el('button', 'goal__edit', '＋ Set a reading goal');
    setBtn.onclick = () => openGoalEditor(renderStats);
    goalBox.appendChild(setBtn);
  }
  body.appendChild(goalBox);
  const editorHost = el('div', 'goal-editor'); editorHost.id = 'goal-editor'; editorHost.hidden = true;
  body.appendChild(editorHost);

  // --- summary tiles ---
  const tiles = el('div', 'stat-tiles');
  const tile = (big, small) => {
    const t = el('div', 'stat-tile');
    t.appendChild(el('div', 'stat-tile__big', big));
    t.appendChild(el('div', 'stat-tile__small', small));
    tiles.appendChild(t);
  };
  tile(String(s.today.pages), 'pages today');
  tile(String(s.streak), s.streak === 1 ? 'day streak' : 'days streak');
  tile(String(finished), finished === 1 ? 'book finished' : 'books finished');
  tile(String(inProgress), 'reading');
  body.appendChild(tiles);

  // --- history chart + heatmap ---
  const charts = el('div', 'stat-charts');
  renderHistoryChart(charts);
  renderHeatmap(charts);
  body.appendChild(charts);

  // --- detail rows ---
  const rows = el('div', 'stat-rows');
  const row = (label, value) => {
    const r = el('div', 'stat-row');
    r.appendChild(el('span', 'stat-row__label', label));
    r.appendChild(el('span', 'stat-row__value', value));
    rows.appendChild(r);
  };
  row('Last 7 days', s.wPages + ' pages · ' + fmtMinutes(s.wSeconds));
  row('Total read', totals.totalPages + ' pages · ' + fmtMinutes(totals.totalSeconds));
  if (speed > 0) row('Average speed', Math.round(speed) + ' pages/hour');
  if (author) row('Most-read author', author.author + ' (' + author.count + ')');
  row('Books in library', String(books.length));
  body.appendChild(rows);

  $('#stats-modal').hidden = false;
}

export function initStatsView() {
  $('#stats-modal').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.hidden = true; });
  $('#stats-close').addEventListener('click', () => { $('#stats-modal').hidden = true; });
  $('#menu-stats').addEventListener('click', () => {
    $('#library-menu').hidden = true;
    renderStats();
  });
}
