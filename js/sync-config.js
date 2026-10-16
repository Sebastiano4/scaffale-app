/* Google OAuth client ID for Drive sync (public — it identifies the app, it is not a secret).
   Created in Google Cloud Console › Google Auth Platform › Clients (type "Web application"),
   authorized JavaScript origin: https://sebastiano4.github.io
   Sync is on only on the published site; tests set window.__BOOKNEST_CLIENT_ID__ (a fake Drive). */
const PUBLISHED_CLIENT_ID = '11924889914-7mh07q7scd8ea9iks9rbiodf9gn78p1k.apps.googleusercontent.com';
const PUBLISHED_HOST = 'sebastiano4.github.io';

export const CLIENT_ID = typeof window === 'undefined' ? ''
  : window.__BOOKNEST_CLIENT_ID__ !== undefined ? window.__BOOKNEST_CLIENT_ID__
    : window.location.hostname === PUBLISHED_HOST ? PUBLISHED_CLIENT_ID : '';
