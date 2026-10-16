// An in-memory Google Drive (appDataFolder only) + a stub Google sign-in, shared by several
// browser contexts so one test can play "PC" and "tablet" against the same cloud.
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'access-control-allow-headers': 'Authorization, Content-Type, X-Upload-Content-Type',
  'access-control-expose-headers': 'Location',
};

export function createFakeDrive() {
  const files = new Map(); // id -> { id, name, body: Buffer, type }
  const sessions = new Map(); // upload id -> { name, type }
  let next = 1;
  const drive = {
    files,
    revoked: new Set(),
    offline: false,
    requests: [],
    byName: (name) => [...files.values()].find((f) => f.name === name),
    library: () => { const f = drive.byName('library.json'); return f ? JSON.parse(f.body.toString('utf8')) : null; },

    async attach(context) {
      await context.addInitScript(() => {
        window.__BOOKNEST_CLIENT_ID__ = 'test-client';
        let n = 0;
        window.google = { accounts: { oauth2: {
          initTokenClient: (cfg) => ({
            requestAccessToken: () => setTimeout(() => cfg.callback({ access_token: 'tok-' + Date.now() + '-' + (++n), expires_in: 3600 }), 20),
          }),
          revoke: (t, cb) => cb && cb(),
        } } };
      });
      await context.route(/^https:\/\/www\.googleapis\.com\//, (route) => handle(route));
    },
  };

  const json = (route, status, obj, headers = {}) => route.fulfill({
    status, headers: { ...CORS, 'content-type': 'application/json', ...headers }, body: JSON.stringify(obj),
  });

  async function handle(route) {
    const req = route.request();
    const method = req.method();
    const url = new URL(req.url());
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (drive.offline) return route.abort('internetdisconnected');
    const auth = req.headers().authorization || '';
    const token = auth.replace(/^Bearer /, '');
    drive.requests.push(method + ' ' + url.pathname + url.search);
    if (!token.startsWith('tok-') || drive.revoked.has(token)) return json(route, 401, { error: { code: 401 } });

    // list
    if (method === 'GET' && url.href.startsWith(API + '/files?')) {
      return json(route, 200, { files: [...files.values()].map(({ id, name, body }) => ({ id, name, size: String(body.length) })) });
    }
    // download
    let m = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/);
    if (m && method === 'GET' && url.searchParams.get('alt') === 'media') {
      const f = files.get(m[1]);
      if (!f) return json(route, 404, { error: { code: 404 } });
      return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': f.type }, body: f.body });
    }
    if (m && method === 'DELETE') { files.delete(m[1]); return route.fulfill({ status: 204, headers: CORS }); }
    // resumable upload: start
    if (method === 'POST' && url.href.startsWith(UPLOAD) && url.searchParams.get('uploadType') === 'resumable') {
      const meta = JSON.parse(req.postData() || '{}');
      const sid = 's' + next++;
      sessions.set(sid, { name: meta.name, type: req.headers()['x-upload-content-type'] || 'application/octet-stream' });
      return route.fulfill({ status: 200, headers: { ...CORS, Location: UPLOAD + '?uploadType=resumable&upload_id=' + sid }, body: '' });
    }
    // resumable upload: bytes
    if (method === 'PUT' && url.searchParams.get('upload_id')) {
      const s = sessions.get(url.searchParams.get('upload_id'));
      const id = 'f' + next++;
      files.set(id, { id, name: s.name, type: s.type, body: req.postDataBuffer() || Buffer.alloc(0) });
      return json(route, 200, { id, name: s.name });
    }
    // simple update
    m = url.pathname.match(/^\/upload\/drive\/v3\/files\/([^/]+)$/);
    if (m && method === 'PATCH') {
      const f = files.get(m[1]);
      if (!f) return json(route, 404, { error: { code: 404 } });
      f.body = req.postDataBuffer() || Buffer.alloc(0);
      return json(route, 200, { id: f.id });
    }
    return json(route, 400, { error: { message: 'fake drive: unhandled ' + method + ' ' + url.href } });
  }

  return drive;
}
