/* Minimal Google Drive v3 client for the app's hidden appDataFolder. */
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

export class DriveError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function call(token, url, opts = {}) {
  let res;
  try {
    res = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + token, ...(opts.headers || {}) } });
  } catch (e) {
    throw new DriveError(0, 'network: ' + e.message);
  }
  if (!res.ok) {
    let msg = '';
    try { msg = await res.text(); } catch (e) { /* ignore */ }
    throw new DriveError(res.status, msg.slice(0, 300) || ('HTTP ' + res.status));
  }
  return res;
}

/* [{ id, name, size }] of every file in the app folder */
export async function listFiles(token) {
  const out = [];
  let pageToken = '';
  do {
    const url = API + '/files?spaces=appDataFolder&pageSize=1000&fields=nextPageToken,files(id,name,size)'
      + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
    const j = await (await call(token, url)).json();
    out.push(...(j.files || []));
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return out;
}

export async function downloadJson(token, id) {
  return (await call(token, API + '/files/' + id + '?alt=media')).json();
}

export async function downloadBlob(token, id, type = 'application/pdf') {
  const buf = await (await call(token, API + '/files/' + id + '?alt=media')).arrayBuffer();
  return new Blob([buf], { type });
}

/* New file in appDataFolder (resumable upload: works for large PDFs). Returns its id. */
export async function createFile(token, name, blob) {
  const type = blob.type || 'application/octet-stream';
  const start = await call(token, UPLOAD + '?uploadType=resumable', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': type },
    body: JSON.stringify({ name, parents: ['appDataFolder'] }),
  });
  const location = start.headers.get('Location');
  if (!location) throw new DriveError(0, 'upload session not started');
  const done = await call(token, location, { method: 'PUT', headers: { 'Content-Type': type }, body: blob });
  return (await done.json()).id;
}

export async function updateFile(token, id, blob) {
  await call(token, UPLOAD + '/' + id + '?uploadType=media', {
    method: 'PATCH',
    headers: { 'Content-Type': blob.type || 'application/octet-stream' },
    body: blob,
  });
}

export async function deleteFile(token, id) {
  await call(token, API + '/files/' + id, { method: 'DELETE' });
}
