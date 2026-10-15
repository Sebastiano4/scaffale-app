export const bookFilePath = (id) => 'books/' + id + '.pdf';

export function buildManifest(books, stats, goal, now = Date.now()) {
  return {
    app: 'BookNest',
    version: 2,
    exportedAt: now,
    stats,
    goal,
    books: books.map(({ fileBlob, ...meta }) => ({ ...meta, file: bookFilePath(meta.id) })),
  };
}

export function validateManifest(data) {
  if (!data || data.app !== 'BookNest' || !Array.isArray(data.books)) throw new Error('invalid backup');
}

export function mergeStats(current, incoming) {
  const out = { ...current, days: { ...(current.days || {}) } };
  for (const [k, v] of Object.entries((incoming && incoming.days) || {})) {
    const c = out.days[k] || { pages: 0, seconds: 0 };
    out.days[k] = { pages: Math.max(c.pages || 0, v.pages || 0), seconds: Math.max(c.seconds || 0, v.seconds || 0) };
  }
  return out;
}
