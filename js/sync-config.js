/* Google OAuth client ID for Drive sync (public — it identifies the app, it is not a secret).
   Created in Google Cloud Console › Google Auth Platform › Clients (type "Web application").
   Empty = sync disabled and hidden. Tests set window.__BOOKNEST_CLIENT_ID__. */
export const CLIENT_ID = (typeof window !== 'undefined' && window.__BOOKNEST_CLIENT_ID__) || '';
