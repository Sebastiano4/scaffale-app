import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, createZip, readZip } from '../../js/zip.js';

test('crc32 of "123456789" is CBF43926', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
});

test('roundtrip text and binary entries', async () => {
  const bin = new Uint8Array(70000).map((_, i) => i % 251);
  const zip = await createZip([
    { name: 'library.json', data: '{"a":1}' },
    { name: 'books/x.pdf', data: new Blob([bin]) },
  ]);
  assert.equal(zip.type, 'application/zip');
  const files = await readZip(zip);
  assert.deepEqual([...files.keys()], ['library.json', 'books/x.pdf']);
  assert.equal(await files.get('library.json').text(), '{"a":1}');
  assert.deepEqual(new Uint8Array(await files.get('books/x.pdf').arrayBuffer()), bin);
});

test('starts with local-file signature PK\x03\x04', async () => {
  const zip = await createZip([{ name: 'a.txt', data: 'hi' }]);
  const head = new Uint8Array(await zip.slice(0, 4).arrayBuffer());
  assert.deepEqual([...head], [0x50, 0x4b, 0x03, 0x04]);
});

test('readZip rejects non-zip', async () => {
  await assert.rejects(readZip(new Blob(['not a zip at all'])), /not a zip/);
});
