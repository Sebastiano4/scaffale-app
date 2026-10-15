import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashBlob } from '../../js/hash.js';

test('sha-256 of "abc"', async () => {
  assert.equal(await hashBlob(new Blob(['abc'])),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
