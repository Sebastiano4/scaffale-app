/* Sync between devices: pure change stamping and merge rules (no DOM, no network).
   Books are matched by `hash`; see docs/superpowers/specs/2026-10-17-booknest-drive-sync-design.md */
import { mergeStats } from './backup-format.js';

export const META_FIELDS = ['title', 'author', 'category', 'rating', 'review', 'status', 'startedAt', 'finishedAt', 'readingMode'];
export const POS_FIELDS = ['lastPage', 'lastOpenedAt'];
export const LISTS = ['bookmarks', 'quotes', 'words'];
const STATIC_FIELDS = ['filename', 'numPages', 'addedAt', 'thumbnail', 'hash'];
const DEVICE_ONLY = ['fileBlob', 'remoteOnly'];

/* JSON with sorted keys, so equal data compares equal whatever the key order. */
export function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort()
      .map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}

const pick = (o, fields) => fields.map((f) => (o ? o[f] : undefined));
const withoutT = (item) => { const { _t, ...rest } = item || {}; return rest; };
const maxMap = (a = {}, b = {}) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = Math.max(out[k] || 0, v);
  return out;
};

/* Stamp what changed between the stored record `old` and `next` (mutates `next`).
   Returns true if anything that syncs changed. */
export function stampChanges(old, next, now = Date.now()) {
  const t = { ...(old && old._t), ...(next._t || {}) };
  if (old && old._t) for (const k of Object.keys(old._t)) t[k] = Math.max(old._t[k] || 0, (next._t && next._t[k]) || 0);
  let changed = !old;
  if (!old) { t.meta = t.meta || now; t.pos = t.pos || now; }
  else {
    if (canon(pick(old, META_FIELDS)) !== canon(pick(next, META_FIELDS))) { t.meta = now; changed = true; }
    if (canon(pick(old, POS_FIELDS)) !== canon(pick(next, POS_FIELDS))) { t.pos = now; changed = true; }
    if (old.hash !== next.hash) changed = true;
  }
  next._t = t;

  // keep tombstones the stored record knows about, even if `next` is a stale copy
  const gone = {};
  for (const l of LISTS) {
    const merged = maxMap(old && old._gone && old._gone[l], next._gone && next._gone[l]);
    if (Object.keys(merged).length) gone[l] = merged;
  }
  for (const l of LISTS) {
    const before = new Map(((old && old[l]) || []).map((it) => [it.id, it]));
    const after = next[l] || [];
    for (const it of after) {
      const prev = before.get(it.id);
      if (!prev || canon(withoutT(prev)) !== canon(withoutT(it))) { it._t = now; changed = true; }
      else it._t = prev._t !== undefined ? prev._t : it._t;
    }
    const ids = new Set(after.map((it) => it.id));
    for (const id of before.keys()) {
      if (!ids.has(id)) { (gone[l] = gone[l] || {})[id] = now; changed = true; }
    }
  }
  if (Object.keys(gone).length) next._gone = gone; else delete next._gone;
  return changed;
}

const stampOf = (b, group) => (b && b._t && b._t[group]) || (group === 'pos' ? (b && b.lastOpenedAt) || 0 : (b && b.addedAt) || 0);

/* Most recent change anywhere in the book (decides deletion vs re-add). */
export function latestStamp(b) {
  let t = Math.max(stampOf(b, 'meta'), stampOf(b, 'pos'), b.addedAt || 0);
  for (const l of LISTS) for (const it of b[l] || []) t = Math.max(t, it._t || 0);
  return t;
}

/* Merge two copies of the same book; `local` keeps its id and device-only fields. */
export function mergeBook(local, remote) {
  const out = { ...local };
  const groups = [['meta', META_FIELDS], ['pos', POS_FIELDS]];
  out._t = {};
  for (const [g, fields] of groups) {
    const win = stampOf(remote, g) > stampOf(local, g) ? remote : local;
    for (const f of fields) { if (win[f] === undefined) delete out[f]; else out[f] = win[f]; }
    out._t[g] = Math.max(stampOf(local, g), stampOf(remote, g));
  }
  for (const f of STATIC_FIELDS) if (out[f] === undefined && remote[f] !== undefined) out[f] = remote[f];

  const gone = {};
  for (const l of LISTS) {
    const g = maxMap(local._gone && local._gone[l], remote._gone && remote._gone[l]);
    if (Object.keys(g).length) gone[l] = g;
    const byId = new Map();
    for (const it of local[l] || []) byId.set(it.id, it);
    for (const it of remote[l] || []) {
      const cur = byId.get(it.id);
      if (!cur || (it._t || 0) > (cur._t || 0)) byId.set(it.id, it);
    }
    out[l] = [...byId.values()].filter((it) => !(g[it.id] && g[it.id] >= (it._t || 0)));
  }
  if (Object.keys(gone).length) out._gone = gone; else delete out._gone;
  return out;
}

/* What goes into library.json for one book. */
export function toRemoteRecord(book) {
  const rec = { ...book };
  for (const f of DEVICE_ONLY) delete rec[f];
  return rec;
}

const sameBook = (a, b) => {
  const strip = (x) => { const r = toRemoteRecord(x); delete r.id; return r; };
  return canon(strip(a)) === canon(strip(b));
};

/* local: { books: [records with hash], deleted: {hash: ts}, stats, goal }
   remote: library.json content (or an empty one)
   → { create, update, remove (local records), remote: new library.json content, remoteChanged, deleted, stats, goal } */
export function mergeLibrary(local, remote) {
  const rBooks = (remote && remote.books) || {};
  const deleted = maxMap(local.deleted, remote && remote.deleted);
  const localByHash = new Map(local.books.filter((b) => b.hash).map((b) => [b.hash, b]));
  const hashes = new Set([...localByHash.keys(), ...Object.keys(rBooks)]);
  const out = { create: [], update: [], remove: [], deleted };
  const newRemote = {};

  for (const h of hashes) {
    const l = localByHash.get(h);
    const r = rBooks[h];
    const merged = l && r ? mergeBook(l, r) : l ? { ...l } : { ...r };
    if (deleted[h] && deleted[h] >= latestStamp(merged)) {
      if (l) out.remove.push(l);
      continue;
    }
    if (deleted[h]) delete deleted[h]; // added again after the deletion
    if (!l) out.create.push(merged);
    else if (!sameBook(l, merged)) out.update.push(merged);
    const rec = toRemoteRecord(merged);
    if (r && r.id) rec.id = r.id;
    newRemote[h] = rec;
  }

  const stats = mergeStats(local.stats || { days: {} }, remote && remote.stats);
  const lg = local.goal || null;
  const rg = (remote && remote.goal) || null;
  const goal = !lg ? rg : !rg ? lg : ((rg.savedAt || 0) > (lg.savedAt || 0) ? rg : lg);

  const prevRemote = remote || {};
  out.remote = { app: 'BookNest', syncVersion: 1, books: newRemote, deleted, stats, goal };
  out.remoteChanged = !prevRemote.books
    || canon(Object.fromEntries(Object.entries(rBooks).map(([h, b]) => [h, { ...b, id: undefined }])))
      !== canon(Object.fromEntries(Object.entries(newRemote).map(([h, b]) => [h, { ...b, id: undefined }])))
    || canon(prevRemote.deleted || {}) !== canon(deleted)
    || canon(prevRemote.stats || { days: {} }) !== canon(stats)
    || canon(prevRemote.goal || null) !== canon(goal);
  out.stats = stats;
  out.goal = goal;
  return out;
}
