// Builds tiny valid PDFs with real (extractable) text, for tests.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function makePdf(pageLines, { title = 'Fixture Book', author = 'Test Author' } = {}) {
  const esc = (t) => t.replace(/[\\()]/g, (c) => '\\' + c);
  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };
  const catalog = add(null);
  const pagesId = add(null);
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const info = add(`<< /Title (${esc(title)}) /Author (${esc(author)}) >>`);
  const kids = [];
  for (const lines of pageLines) {
    const body = 'BT /F1 14 Tf 72 720 Td 18 TL ' + lines.map((l) => `(${esc(l)}) '`).join(' ') + ' ET';
    const content = add(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const OUT = fileURLToPath(new URL('./out/', import.meta.url));

export function writeFixture(name, pageLines, meta) {
  mkdirSync(OUT, { recursive: true });
  const p = join(OUT, name);
  writeFileSync(p, makePdf(pageLines, meta));
  return p;
}

// Standard 3-page fixture used across e2e tests. "nest" appears 3x on page 2, 1x on page 3.
export const STANDARD_PAGES = [
  ['Chapter one', 'The quick brown fox jumps over the lazy dog.'],
  ['Chapter two', 'A bird builds a nest. The nest is warm.', 'Every nest is different.'],
  ['Chapter three', 'The end of the nest story.'],
];
