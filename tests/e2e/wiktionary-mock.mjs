// Serves Wiktionary answers from saved fixtures (tests/fixtures/wiktionary), so tests never hit the network.
//   it-<word>.json : it.wiktionary action=parse response
//   en-<word>.json : en.wiktionary REST /page/definition response
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../fixtures/wiktionary/', import.meta.url));
const fixture = (name) => (existsSync(DIR + name) ? readFileSync(DIR + name, 'utf8') : null);
const CORS = { 'access-control-allow-origin': '*' };

// state.offline = true makes every request fail like a dropped connection; state.calls counts requests.
export async function mockWiktionary(page) {
  const state = { offline: false, calls: [] };
  await page.route('https://it.wiktionary.org/**', (route) => {
    const word = new URL(route.request().url()).searchParams.get('page');
    state.calls.push('it:' + word);
    if (state.offline) return route.abort('internetdisconnected');
    const body = fixture('it-' + word + '.json')
      || JSON.stringify({ error: { code: 'missingtitle', info: "The page you specified doesn't exist." } });
    return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body });
  });
  await page.route('https://en.wiktionary.org/**', (route) => {
    const word = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop());
    state.calls.push('en:' + word);
    if (state.offline) return route.abort('internetdisconnected');
    const body = fixture('en-' + word + '.json');
    return body
      ? route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body })
      : route.fulfill({ status: 404, contentType: 'application/json', headers: CORS, body: '{"title":"Not found."}' });
  });
  return state;
}
