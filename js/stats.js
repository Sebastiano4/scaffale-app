import { state } from './state.js';
import { $ } from './dom.js';
import { notifyChanged } from './sync-state.js';

/* ======================================================================
   Reading stats (stored in localStorage)
   ====================================================================== */
export const Stats = {
  key: 'booknest-stats',
  load() {
    try { return JSON.parse(localStorage.getItem(this.key)) || { days: {} }; }
    catch (e) { return { days: {} }; }
  },
  save(s) { try { localStorage.setItem(this.key, JSON.stringify(s)); } catch (e) { /* full */ } notifyChanged(); },
  /* written by sync (another device's stats merged in): no change notification */
  saveRaw(s) { try { localStorage.setItem(this.key, JSON.stringify(s)); } catch (e) { /* full */ } },
  dayKey(offset = 0) {
    const d = new Date(); d.setDate(d.getDate() - offset);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  },
  bump(field, amount) {
    const s = this.load();
    const k = this.dayKey();
    const day = s.days[k] || (s.days[k] = { pages: 0, seconds: 0 });
    day[field] += amount;
    this.save(s);
  },
  addPages(n) { this.bump('pages', n); },
  addSeconds(sec) { if (sec > 0 && sec < 60 * 60 * 12) this.bump('seconds', sec); },
  summary() {
    const s = this.load();
    const today = s.days[this.dayKey()] || { pages: 0, seconds: 0 };
    let wPages = 0, wSeconds = 0, streak = 0;
    for (let i = 0; i < 7; i++) {
      const d = s.days[this.dayKey(i)];
      if (d) { wPages += d.pages; wSeconds += d.seconds; }
    }
    for (let i = 0; i < 365; i++) {
      const d = s.days[this.dayKey(i)];
      if (d && (d.pages > 0 || d.seconds > 60)) streak++;
      else if (i > 0) break; // today can still be empty without breaking the streak
    }
    return { today, wPages, wSeconds, streak };
  },
};

/* ---- Reading goal (books or pages, per week or per year) ---- */
export const Goal = {
  key: 'booknest-goal',
  /* the goal as stored, including a removed one ({ target: 0 }) so the removal can sync */
  raw() { try { return JSON.parse(localStorage.getItem(this.key)); } catch (e) { return null; } },
  load() { const g = this.raw(); return g && g.target ? g : null; },
  save(g) { this.saveRaw({ ...g, savedAt: Date.now() }); notifyChanged(); },
  saveRaw(g) { try { localStorage.setItem(this.key, JSON.stringify(g)); } catch (e) { /* full */ } },
  clear() { this.save({ target: 0 }); },
  // returns { done, target, label, pct } or null
  progress(books) {
    const g = this.load();
    if (!g || !g.target) return null;
    const now = new Date();
    let done = 0, label = '';
    if (g.type === 'books') {
      if (g.period === 'year') {
        const y = now.getFullYear();
        done = books.filter((b) => b.finishedAt && new Date(b.finishedAt).getFullYear() === y).length;
        label = g.target + ' books in ' + y;
      } else {
        const weekAgo = Date.now() - 7 * 864e5;
        done = books.filter((b) => b.finishedAt && b.finishedAt >= weekAgo).length;
        label = g.target + ' books per week';
      }
    } else { // pages
      const s = Stats.load();
      if (g.period === 'year') {
        const y = String(now.getFullYear());
        done = Object.entries(s.days).reduce((sum, [k, v]) => k.startsWith(y) ? sum + (v.pages || 0) : sum, 0);
        label = g.target + ' pages in ' + now.getFullYear();
      } else {
        done = Stats.summary().wPages;
        label = g.target + ' pages per week';
      }
    }
    return { done, target: g.target, label, pct: Math.min(100, Math.round((done / g.target) * 100)) };
  },
};

export function flushReadingTime() {
  if (state.reader.sessionStart) {
    Stats.addSeconds(Math.round((Date.now() - state.reader.sessionStart) / 1000));
    state.reader.sessionStart = null;
  }
}

export function initReadingTimeTracking() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushReadingTime();
    else if (state.reader.book && $('#reader-view').classList.contains('view--active')) state.reader.sessionStart = Date.now();
  });
  window.addEventListener('pagehide', flushReadingTime);
}
