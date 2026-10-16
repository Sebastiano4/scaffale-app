/* Google sign-in for Drive sync: Google Identity Services token client, drive.appdata scope.
   Tokens last ~1 h and can only be renewed from a tap (the browser blocks popups otherwise),
   so requestToken() must be called synchronously inside a click handler. */
import { CLIENT_ID } from './sync-config.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const TOKEN_KEY = 'booknest-drive-token';
const MARGIN_MS = 60_000; // treat a token as expired a minute early

let client = null;
let pending = null; // { resolve, reject } of the request in flight

export const syncConfigured = () => !!CLIENT_ID;

function gisReady() {
  return !!(window.google && window.google.accounts && window.google.accounts.oauth2);
}

/* Load the Google script ahead of time, so a tap can open the sign-in popup at once. */
export function preloadAuth() {
  if (!syncConfigured()) return Promise.resolve(false);
  if (gisReady()) { initClient(); return Promise.resolve(true); }
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => { initClient(); resolve(true); };
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
}

function initClient() {
  if (client || !gisReady()) return;
  client = window.google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPE,
    callback: (resp) => {
      const p = pending; pending = null;
      if (!p) return;
      if (resp.error || !resp.access_token) { p.reject(new Error(resp.error || 'no token')); return; }
      const token = { value: resp.access_token, exp: Date.now() + (Number(resp.expires_in) || 3600) * 1000 };
      try { localStorage.setItem(TOKEN_KEY, JSON.stringify(token)); } catch (e) { /* storage full */ }
      p.resolve(token.value);
    },
    error_callback: (err) => {
      const p = pending; pending = null;
      if (p) p.reject(new Error((err && err.type) || 'popup closed'));
    },
  });
}

/* A still-valid token, or null. */
export function currentToken() {
  try {
    const t = JSON.parse(localStorage.getItem(TOKEN_KEY));
    return t && t.exp - MARGIN_MS > Date.now() ? t.value : null;
  } catch (e) { return null; }
}

/* Ask Google for a token. Call it straight from a tap. */
export function requestToken() {
  initClient();
  if (!client) return Promise.reject(new Error('Google sign-in is not available (offline?)'));
  if (pending) pending.reject(new Error('superseded'));
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    client.requestAccessToken({ prompt: '' });
  });
}

/* The stored token stopped working (revoked, clock skew…): forget it. */
export function dropToken() {
  try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
}

export function signOut() {
  const t = currentToken();
  dropToken();
  if (t && gisReady()) { try { window.google.accounts.oauth2.revoke(t, () => {}); } catch (e) { /* ignore */ } }
}
