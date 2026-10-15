export function findOccurrences(textIndex, query, contextChars = 40) {
  const q = query.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!q) return [];
  const out = [];
  const pages = [...textIndex.keys()].sort((a, b) => a - b);
  for (const page of pages) {
    const text = textIndex.get(page).replace(/\s+/g, ' ');
    const lower = text.toLowerCase();
    let i = lower.indexOf(q);
    while (i !== -1) {
      const s = Math.max(0, i - contextChars);
      const e = Math.min(text.length, i + q.length + contextChars);
      out.push({
        page,
        before: (s > 0 ? '…' : '') + text.slice(s, i),
        match: text.slice(i, i + q.length),
        after: text.slice(i + q.length, e) + (e < text.length ? '…' : ''),
      });
      i = lower.indexOf(q, i + q.length);
    }
  }
  return out;
}
