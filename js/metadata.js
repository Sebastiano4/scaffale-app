/* PDF metadata helpers. No DOM access or pdf.js import at module load (unit-testable in Node). */

export function titleCase(s) {
  return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

// Guess { title, author } from a filename when PDF metadata is missing.
export function guessFromFilename(filename) {
  let base = filename.replace(/\.pdf$/i, '');
  base = base.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();

  const seps = [' - ', ' – ', ' — '];
  let parts = null;
  for (const sep of seps) {
    if (base.includes(sep)) { parts = base.split(sep).map((s) => s.trim()); break; }
  }

  if (parts && parts.length >= 2) {
    const [a, b] = [parts[0], parts.slice(1).join(' - ')];
    const wordsA = a.split(' ').filter(Boolean);
    // Short, capitalized, comma-free chunk looks like "Author Name"
    const looksLikeName = (s, words) =>
      words.length <= 4 && !/\d/.test(s) && words.every((w) => /^[A-ZÀ-Ý]/.test(w));
    if (looksLikeName(a, wordsA)) {
      return { title: titleCase(b), author: titleCase(a) };
    }
    return { title: titleCase(a), author: titleCase(b) };
  }

  return { title: titleCase(base) || 'Untitled', author: '' };
}

export async function extractMetadata(pdfDoc, filename) {
  let title = '', author = '';
  try {
    const meta = await pdfDoc.getMetadata();
    title = (meta.info && meta.info.Title || '').trim();
    author = (meta.info && meta.info.Author || '').trim();
  } catch (e) { /* ignore */ }

  const guess = guessFromFilename(filename);
  return {
    title: title || guess.title,
    author: author || guess.author,
  };
}

export async function renderThumbnail(pdfDoc) {
  const page = await pdfDoc.getPage(1);
  const baseVp = page.getViewport({ scale: 1 });
  const targetW = 340;
  const scale = targetW / baseVp.width;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL('image/jpeg', 0.75);
}
