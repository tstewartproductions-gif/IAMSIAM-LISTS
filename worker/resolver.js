// Cloudflare Worker: resolves a Bandcamp track URL to its public mp3-128 stream.
// GET /?url=https://<artist>.bandcamp.com/track/<slug>
import { parseTrackPage } from './parse.mjs';

const BC_URL = /^https:\/\/[a-z0-9][a-z0-9-]*\.bandcamp\.com\/track\/[a-z0-9-]+\/?$/;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, ...extra } });

export default {
  async fetch(request) {
    if (request.method !== 'GET') return json({ error: 'GET only' }, 405);
    const target = new URL(request.url).searchParams.get('url') ?? '';
    if (!BC_URL.test(target)) return json({ error: 'not a bandcamp track url' }, 400);

    const cache = caches.default;
    const cacheKey = new Request(new URL(request.url).origin + '/?url=' + encodeURIComponent(target));
    let hit; try { hit = await cache.match(cacheKey); } catch {}
    if (hit) return hit;

    let page;
    try {
      page = await fetch(target, { headers: { 'User-Agent': 'Mozilla/5.0 (iamsiam-lists resolver)' } });
    } catch {
      return json({ error: 'bandcamp unreachable' }, 502);
    }
    if (!page.ok) return json({ error: `bandcamp returned ${page.status}` }, 502);

    let payload;
    try {
      payload = parseTrackPage(await page.text());
    } catch (err) {
      return json({ error: String(err.message) }, 404);
    }
    // Signed stream URLs expire after ~hours; cache briefly so repeat plays are instant.
    const res = json(payload, 200, { 'Cache-Control': 'public, s-maxage=1200' });
    try { await cache.put(cacheKey, res.clone()); } catch {}
    return res;
  },
};
