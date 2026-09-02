# IAMSIAM_LISTS M2 - Unified Player Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One play button and one transport bar for every track on the live site - Bandcamp streams via a Cloudflare Worker resolver, YouTube and SoundCloud via their official players, with fallbacks and expired-stream recovery.

**Architecture:** A ~150-line Cloudflare Worker resolves Bandcamp `data-tralbum` stream URLs at play time (parse logic is a pure, unit-tested Node module shared with the Worker). In the browser, `js/player.js` owns a persistent now-playing panel + transport bar that live OUTSIDE the router's `#app` (they survive route changes); `js/adapters.js` provides three adapters behind one interface. Track rows become clickable; the player queue is the currently rendered list's playable tracks.

**Tech Stack:** Vanilla ES modules, Cloudflare Workers (free tier) via `npx wrangler`, YouTube IFrame API, SoundCloud Widget API, node:test. Still zero npm dependencies in the repo (wrangler runs via npx).

**Repo root:** `/Users/travisstewart/MACHINEDRUM/CLAUDE DOCS/IAMSIAM_LISTS` (branch `main`, deploys to GitHub Pages on push; site is LIVE - every push ships, so Tasks 4-8 must keep `main` renderable at every commit).

**Design spec:** `DESIGN.md` §Unified player. Key rules: Bandcamp streams are resolved at play time and never stored; the YouTube player stays visible (ToS); resolve failure falls back to official-embed (when IDs are known) or a LISTEN ON BANDCAMP link + auto-skip; expired stream mid-play → re-resolve once and resume at position.

**File structure locked in by this plan:**

```
worker/parse.mjs        pure: extract data-tralbum JSON from Bandcamp HTML → resolve payload
worker/parse.test.mjs   node:test suite (fixture-driven)
worker/fixture-track.html   trimmed real Bandcamp track page (attribute intact)
worker/resolver.js      Cloudflare Worker: validation, fetch, CORS, cache
worker/wrangler.toml    wrangler config (name: iamsiam-resolver)
js/config.js            WORKER_URL constant
js/adapters.js          bandcamp/youtube/soundcloud adapters + resolver client
js/player.js            queue, transport, panel, row-click wiring
index.html              + player section (panel + transport), hidden until first play
css/site.css            + player styles, active-row state
js/app.js               + row click delegation, active-row re-mark after render
```

**Inputs needed from Travis (Task 3 only):** a Cloudflare account. `npx wrangler login` opens a browser authorization - Travis clicks Allow (account creation at dash.cloudflare.com/sign-up first if he has none; free plan). Everything else is autonomous.

---

### Task 1: Bandcamp parse module (TDD)

**Files:** Create `worker/parse.mjs`, `worker/parse.test.mjs`, `worker/fixture-track.html`

- [ ] **Step 1: Build the fixture from a real page**

```bash
cd "/Users/travisstewart/MACHINEDRUM/CLAUDE DOCS/IAMSIAM_LISTS"
mkdir -p worker
curl -sL -A "Mozilla/5.0" "https://iamsiam.bandcamp.com/track/survival-skills" -o /private/tmp/claude-501/-Users-travisstewart-MACHINEDRUM-CLAUDE-DOCS/fdc1324c-bd8e-4e07-b689-fb1e4d619498/scratchpad/bc_full.html
python3 - <<'PY'
import re, pathlib
h = pathlib.Path("/private/tmp/claude-501/-Users-travisstewart-MACHINEDRUM-CLAUDE-DOCS/fdc1324c-bd8e-4e07-b689-fb1e4d619498/scratchpad/bc_full.html").read_text()
m = re.search(r'<script[^>]*data-tralbum="[^"]*"[^>]*>', h)
og = re.findall(r'<meta property="og:image" content="[^"]*"[^>]*>', h)
pathlib.Path("worker/fixture-track.html").write_text(
  "<html><head>\n" + "\n".join(og[:1]) + "\n</head><body>\n" + m.group(0) + "</script>\n</body></html>\n")
PY
grep -c 'data-tralbum' worker/fixture-track.html
```

Expected: `1`. The fixture keeps the real entity-encoded attribute and the og:image tag, nothing else (a few KB, safe to commit).

- [ ] **Step 2: Write the failing tests**

```js
// worker/parse.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTrackPage } from './parse.mjs';

const html = readFileSync(new URL('./fixture-track.html', import.meta.url), 'utf8');

test('parses stream URL, title, artist, duration, ids, art from a real page', () => {
  const r = parseTrackPage(html);
  assert.match(r.streamUrl, /^https:\/\/t\d+\.bcbits\.com\/stream\//);
  assert.equal(r.title, 'Survival Skills');
  assert.ok(r.artist.length > 0);
  assert.ok(r.duration > 60);
  assert.ok(Number.isInteger(r.trackId));
  assert.match(r.art, /^https:\/\//);
});

test('throws a clean error when data-tralbum is absent', () => {
  assert.throws(() => parseTrackPage('<html><body>nope</body></html>'), /no data-tralbum/);
});

test('throws a clean error on malformed data-tralbum JSON', () => {
  assert.throws(() => parseTrackPage('<div data-tralbum="{bad">'), /malformed data-tralbum/);
});

test('throws a clean error when the track has no mp3-128 (subscriber-only)', () => {
  const stripped = html.replace(/mp3-128/g, 'mp3-000');
  assert.throws(() => parseTrackPage(stripped), /no public stream/);
});
```

- [ ] **Step 3: Run, witness failure** - `node --test worker/*.test.mjs` → cannot find module.

- [ ] **Step 4: Write `worker/parse.mjs`**

```js
// worker/parse.mjs
// Pure extraction of Bandcamp track-page data. Runs in Node (tests) and the Worker.
const ENT = { '&quot;': '"', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&#39;': "'" };
const decodeEntities = s => s.replace(/&(?:quot|amp|lt|gt|#39);/g, m => ENT[m]);

export function parseTrackPage(html) {
  const m = html.match(/data-tralbum="([^"]*)"/);
  if (!m) throw new Error('no data-tralbum on page');
  let data;
  try { data = JSON.parse(decodeEntities(m[1])); }
  catch { throw new Error('malformed data-tralbum JSON'); }
  const t = data?.trackinfo?.[0];
  const streamUrl = t?.file?.['mp3-128'];
  if (!streamUrl) throw new Error('no public stream for this track');
  const art = html.match(/property="og:image" content="([^"]*)"/)?.[1] ?? null;
  return {
    streamUrl,
    title: data?.current?.title ?? t.title ?? '',  // current.title is canonical; trackinfo title gets artist-prefixed on singles
    artist: data?.artist ?? '',
    duration: Math.round(t.duration ?? 0),
    trackId: t.track_id ?? data?.current?.id ?? null,
    albumId: data?.current?.album_id ?? null,
    art,
  };
}
```

- [ ] **Step 5: Run, witness pass** - `node --test worker/*.test.mjs` → 4 pass.
- [ ] **Step 6: Commit** - `git add worker/ && git commit -m "feat: bandcamp track-page parser with fixture tests"`

---

### Task 2: The resolver Worker

**Files:** Create `worker/resolver.js`, `worker/wrangler.toml`

- [ ] **Step 1: Write `worker/wrangler.toml`**

```toml
name = "iamsiam-resolver"
main = "resolver.js"
compatibility_date = "2026-08-01"
```

- [ ] **Step 2: Write `worker/resolver.js`**

```js
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
```

- [ ] **Step 3: Local integration check** - `cd worker && npx -y wrangler dev --port 8787` (background), then:

```bash
curl -s "http://localhost:8787/?url=https://iamsiam.bandcamp.com/track/survival-skills" | python3 -m json.tool
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:8787/?url=https://evil.example/x"   # expect 400
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:8787/?url=https://iamsiam.bandcamp.com/track/does-not-exist-xyz"   # expect 502 or 404
```

Expected: first call returns `streamUrl` on `bcbits.com` + title "Survival Skills"; verify the streamUrl itself: `curl -s -o /dev/null -w "%{http_code}" "<streamUrl>"` → 200, content-type audio/mpeg. Kill wrangler dev afterward.

- [ ] **Step 4: Commit** - `git add worker/ && git commit -m "feat: cloudflare resolver worker"`

---

### Task 3: Cloudflare auth + deploy (needs Travis once)

- [ ] **Step 1:** `cd worker && npx -y wrangler whoami` - if not authenticated: run `npx wrangler login` (background, capture the printed URL), give Travis the URL to click Allow (he creates a free account at dash.cloudflare.com/sign-up first if needed). Wait for completion like the gh device flow.
- [ ] **Step 2:** `npx wrangler deploy` from `worker/`. Capture the deployed URL (deployed 2026-09-01: `https://iamsiam-resolver.iamsiam.workers.dev`, account subdomain `iamsiam.workers.dev`).
- [ ] **Step 3:** Re-run the Task 2 Step 3 curls against the deployed URL - same expectations, plus confirm the `Access-Control-Allow-Origin: *` header is present (`curl -sI`).
- [ ] **Step 4: Write `js/config.js`** with the real URL:

```js
// js/config.js
export const WORKER_URL = 'https://iamsiam-resolver.iamsiam.workers.dev';
```

- [ ] **Step 5: Commit** - `git add js/config.js && git commit -m "feat: resolver endpoint config"` (worker/ deploy state lives at Cloudflare; no repo change beyond config).

---

### Task 4: Player UI shell (panel + transport + row affordance)

**Files:** Modify `index.html`, `css/site.css` (site stays fully functional - the player is hidden until JS activates it)

- [ ] **Step 1: index.html** - insert between the intro strip and `<main id="app">`:

```html
<section id="player" hidden>
  <div id="player-media"></div>
  <div id="player-meta">
    <div id="player-track"></div>
    <div id="player-list"></div>
  </div>
  <div id="player-bar">
    <button id="pv" aria-label="previous">&#171;</button>
    <button id="pp" aria-label="play/pause">&#9654;</button>
    <button id="nx" aria-label="next">&#187;</button>
    <span id="t-el">0:00</span>
    <input id="scrub" type="range" min="0" max="1000" value="0" step="1" aria-label="seek">
    <span id="t-to">0:00</span>
    <span id="counter"></span>
  </div>
</section>
```

- [ ] **Step 2: css/site.css** - append:

```css
#player{border-bottom:1px solid var(--border);padding:20px 24px;max-width:760px;margin:0 auto;width:100%}
#player-media{background:#0d0d0d;border:1px solid var(--border);width:100%;aspect-ratio:16/9;max-height:320px;display:flex;align-items:center;justify-content:center;overflow:hidden}
#player-media iframe,#player-media img{width:100%;height:100%;border:0;display:block;object-fit:contain}
#player-media .bc-art{object-fit:cover}
#player-media .player-note{color:var(--meta);font-size:12px;padding:16px;text-align:center}
#player-media .player-note a{border-bottom:1px solid var(--strip)}
#player-meta{display:flex;justify-content:space-between;gap:12px;margin-top:10px;font-size:12px}
#player-track{font-weight:600;text-transform:uppercase;letter-spacing:.02em}
#player-list{color:var(--strip)}
#player-bar{display:flex;align-items:center;gap:10px;margin-top:10px}
#player-bar button{background:none;border:1px solid var(--border);color:var(--fg);font-family:var(--mono);font-size:13px;padding:5px 11px;cursor:pointer}
#player-bar button:hover{border-color:var(--fg)}
#player-bar span{color:var(--meta);font-size:11px;min-width:34px}
#counter{color:var(--strip);text-align:right}
#scrub{flex:1;appearance:none;-webkit-appearance:none;height:2px;background:var(--border);cursor:pointer}
#scrub::-webkit-slider-thumb{appearance:none;-webkit-appearance:none;width:10px;height:10px;background:var(--fg);border-radius:0}
#scrub::-moz-range-thumb{width:10px;height:10px;background:var(--fg);border:0;border-radius:0}
.track.playable .rank,.track.playable .name{cursor:pointer}
.track.playable:hover .rank{color:var(--fg)}
.track.active .rank{background:var(--fg);color:var(--bg);padding:0 4px}
@media (max-width:520px){
  #player{padding:14px 16px}
  #player-bar{flex-wrap:wrap}
  #scrub{order:5;flex-basis:100%}
}
```

- [ ] **Step 3:** Serve locally, confirm the site renders IDENTICALLY to production (player hidden), no console errors. Commit: `"feat: player shell markup and styles (inert until wired)"`. Push is safe at this point.

---

### Task 5: Adapters module

**Files:** Create `js/adapters.js`

Common adapter interface - every adapter implements:
`{ mount(track, mediaEl): Promise<void>, play(), pause(), seek(seconds), time(): number, duration(): number, destroy(), onended: cb, onerror: cb }`

- [ ] **Step 1: Write `js/adapters.js`**

```js
// IAMSIAM_LISTS - per-source playback adapters behind one interface.
import { WORKER_URL } from './config.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ---------- bandcamp: resolved mp3-128 in an <audio> element ---------- */
export function bandcampAdapter() {
  let audio = null, meta = null, track = null, retried = false;
  const a = {
    onended: null, onerror: null,
    async mount(t, mediaEl) {
      track = t;
      const r = await fetch(`${WORKER_URL}/?url=${encodeURIComponent(t.stream.url)}`);
      if (!r.ok) throw Object.assign(new Error('resolve failed'), { code: r.status });
      meta = await r.json();
      mediaEl.innerHTML = meta.art ? `<img class="bc-art" src="${esc(meta.art)}" alt="">` : '';
      audio = new Audio();
      audio.src = meta.streamUrl;
      audio.preload = 'auto';
      audio.addEventListener('ended', () => a.onended?.());
      audio.addEventListener('error', async () => {
        // Signed URL likely expired mid-session: re-resolve once, resume position.
        if (retried || !track) { a.onerror?.(new Error('stream error')); return; }
        retried = true;
        const pos = audio.currentTime;
        try {
          const r2 = await fetch(`${WORKER_URL}/?url=${encodeURIComponent(track.stream.url)}`);
          if (!r2.ok) throw new Error('re-resolve failed');
          audio.src = (await r2.json()).streamUrl;
          audio.currentTime = pos;
          await audio.play();
        } catch (e) { a.onerror?.(e); }
      });
    },
    play: () => audio?.play().catch(() => a.onerror?.(new Error('playback blocked'))),
    pause: () => audio?.pause(),
    seek: s => { if (audio) audio.currentTime = s; },
    time: () => audio?.currentTime ?? 0,
    duration: () => (audio?.duration || meta?.duration || 0),
    destroy: () => { if (audio) { audio.pause(); audio.src = ''; audio = null; } },
  };
  return a;
}

/* ---------- youtube: official IFrame API, player visible (ToS) ---------- */
let ytReady = null;
function loadYT() {
  if (ytReady) return ytReady;
  ytReady = new Promise((res, rej) => {
    if (window.YT?.Player) return res();
    const prev = window.onYouTubeIframeAPIReady;
    const timer = setTimeout(() => fail(new Error('youtube api timeout')), 15000);
    const fail = err => { clearTimeout(timer); ytReady = null; rej(err); };
    window.onYouTubeIframeAPIReady = () => { prev?.(); clearTimeout(timer); res(); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => fail(new Error('youtube api blocked'));
    document.head.appendChild(s);
  });
  return ytReady;
}
export const ytVideoId = url =>
  String(url ?? '').match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/)?.[1] ?? null;

export function youtubeAdapter() {
  let player = null, readyP = null;
  const a = {
    onended: null, onerror: null,
    async mount(t, mediaEl) {
      const id = ytVideoId(t.stream.url);
      if (!id) throw new Error('bad youtube url');
      await loadYT();
      const host = document.createElement('div');
      mediaEl.innerHTML = ''; mediaEl.appendChild(host);
      readyP = new Promise((res, rej) => {
        player = new YT.Player(host, {
          videoId: id, width: '100%', height: '100%',
          playerVars: { playsinline: 1, rel: 0 },
          events: {
            onReady: () => res(),
            onError: () => { rej(new Error('youtube error')); a.onerror?.(new Error('youtube error')); },
            onStateChange: e => { if (e.data === YT.PlayerState.ENDED) a.onended?.(); },
          },
        });
      });
      await readyP;
    },
    play: () => player?.playVideo(),
    pause: () => player?.pauseVideo(),
    seek: s => player?.seekTo(s, true),
    time: () => player?.getCurrentTime?.() ?? 0,
    duration: () => player?.getDuration?.() ?? 0,
    destroy: () => { player?.destroy?.(); player = null; },
  };
  return a;
}

/* ---------- soundcloud: official Widget API ---------- */
let scReady = null;
function loadSC() {
  if (scReady) return scReady;
  scReady = new Promise((res, rej) => {
    if (window.SC?.Widget) return res();
    const timer = setTimeout(() => fail(new Error('soundcloud api timeout')), 15000);
    const fail = err => { clearTimeout(timer); scReady = null; rej(err); };
    const s = document.createElement('script');
    s.src = 'https://w.soundcloud.com/player/api.js';
    s.onload = () => { clearTimeout(timer); res(); };
    s.onerror = () => fail(new Error('soundcloud api blocked'));
    document.head.appendChild(s);
  });
  return scReady;
}

export function soundcloudAdapter() {
  let widget = null, dur = 0, pos = 0;
  const a = {
    onended: null, onerror: null,
    async mount(t, mediaEl) {
      await loadSC();
      const src = 'https://w.soundcloud.com/player/?url=' + encodeURIComponent(t.stream.url) +
        '&color=%23ffffff&inverse=true&show_teaser=false&visual=true';
      mediaEl.innerHTML = `<iframe allow="autoplay" src="${esc(src)}"></iframe>`;
      widget = SC.Widget(mediaEl.querySelector('iframe'));
      await new Promise((res, rej) => {
        const timer = setTimeout(() => rej(new Error('soundcloud timeout')), 12000);
        widget.bind(SC.Widget.Events.READY, () => {
          clearTimeout(timer);
          widget.getDuration(ms => { dur = ms / 1000; });
          widget.bind(SC.Widget.Events.PLAY_PROGRESS, e => { pos = e.currentPosition / 1000; });
          widget.bind(SC.Widget.Events.FINISH, () => a.onended?.());
          widget.bind(SC.Widget.Events.ERROR, () => a.onerror?.(new Error('soundcloud error')));
          res();
        });
      });
    },
    play: () => widget?.play(),
    pause: () => widget?.pause(),
    seek: s => { widget?.seekTo(s * 1000); pos = s; },
    time: () => pos,
    duration: () => dur,
    destroy: () => { widget = null; },
  };
  return a;
}

export const adapterFor = t =>
  t?.stream?.type === 'bandcamp' ? bandcampAdapter()
  : t?.stream?.type === 'youtube' ? youtubeAdapter()
  : t?.stream?.type === 'soundcloud' ? soundcloudAdapter()
  : null;
```

- [ ] **Step 2:** `node --check js/adapters.js`; commit `"feat: playback adapters (bandcamp/youtube/soundcloud)"`. (Behavioral verification happens in Task 6's integration - adapters are inert until player.js exists; pushing is still safe.)

---

### Task 6: Player core

**Files:** Create `js/player.js`; modify `js/app.js` (two small hooks)

- [ ] **Step 1: Write `js/player.js`**

```js
// IAMSIAM_LISTS - unified transport over the current list's playable tracks.
import { adapterFor } from './adapters.js';

const $ = id => document.getElementById(id);
const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const P = {
  list: null, queue: [], i: -1, adapter: null, playing: false,
  seq: 0, timer: null, scrubbing: false,
};

function els() {
  return { root: $('player'), media: $('player-media'), track: $('player-track'),
    listEl: $('player-list'), pp: $('pp'), pv: $('pv'), nx: $('nx'),
    el: $('t-el'), to: $('t-to'), scrub: $('scrub'), counter: $('counter') };
}

function markRows() {
  const cur = P.queue[P.i];
  document.querySelectorAll('.track').forEach(row => {
    const rank = Number(row.dataset.rank);
    const playable = !!P.list && P.queue.some(t => t.rank === rank);
    row.classList.toggle('playable', playable || !!row.dataset.rank);
    row.classList.toggle('active', !!cur && P.listShown && rank === cur.rank);
  });
}

function updateBar() {
  const e = els();
  if (!P.adapter) return;
  const t = P.adapter.time(), d = P.adapter.duration();
  e.el.textContent = fmt(t); e.to.textContent = fmt(d);
  if (!P.scrubbing && d > 0) e.scrub.value = Math.round((t / d) * 1000);
}

async function loadIndexTrack(idx) {
  const mySeq = ++P.seq;
  const e = els(); const t = P.queue[idx];
  if (!t) return;
  P.adapter?.destroy(); P.adapter = null; P.i = idx;
  e.root.hidden = false;
  e.track.textContent = `${t.artist} — ${t.title}`;
  e.listEl.textContent = `${P.list.curator} · ${P.list.listTitle}`;
  e.counter.textContent = `${idx + 1}/${P.queue.length}`;
  e.media.innerHTML = `<div class="player-note">LOADING…</div>`;
  markRows();
  const ad = adapterFor(t);
  ad.onended = () => next();
  ad.onerror = () => fail(t);
  try {
    await ad.mount(t, e.media);
  } catch (err) {
    console.error(err);
    if (mySeq === P.seq) fail(t);
    return;
  }
  if (mySeq !== P.seq) { ad.destroy(); return; }
  P.adapter = ad;
  play();
}

function fail(t) {
  const e = els();
  const link = t.stream?.url ?? t.buy?.[0]?.url;
  e.media.innerHTML = `<div class="player-note">COULDN'T PLAY THIS ONE HERE${link ?
    ` — <a href="${link.replace(/"/g, '&quot;')}" target="_blank" rel="noopener">LISTEN AT THE SOURCE</a>` : ''}</div>`;
  setPlaying(false);
}

function setPlaying(on) {
  P.playing = on;
  els().pp.innerHTML = on ? '&#10073;&#10073;' : '&#9654;';
  clearInterval(P.timer);
  if (on) P.timer = setInterval(updateBar, 250);
}

function play() { P.adapter?.play(); setPlaying(true); updateBar(); }
function pause() { P.adapter?.pause(); setPlaying(false); }
function next() { if (P.i < P.queue.length - 1) loadIndexTrack(P.i + 1); else setPlaying(false); }
function prev() { if (P.adapter && P.adapter.time() > 3) { P.adapter.seek(0); return; } if (P.i > 0) loadIndexTrack(P.i - 1); }

export function playTrack(list, rank) {
  const queue = list.tracks.filter(t => t.stream?.url);
  const idx = queue.findIndex(t => t.rank === rank);
  if (idx === -1) return;
  P.list = list; P.queue = queue; P.listShown = true;
  loadIndexTrack(idx);
}

// Called by the router after every render so active-row marking survives navigation.
export function onRender(currentList) {
  P.listShown = !!(P.list && currentList &&
    P.list.curator === currentList.curator && P.list.date === currentList.date);
  markRows();
}

export function initPlayer() {
  const e = els();
  e.pp.addEventListener('click', () => (P.playing ? pause() : play()));
  e.nx.addEventListener('click', next);
  e.pv.addEventListener('click', prev);
  e.scrub.addEventListener('input', () => { P.scrubbing = true; });
  e.scrub.addEventListener('change', () => {
    P.scrubbing = false;
    const d = P.adapter?.duration() ?? 0;
    if (d > 0) P.adapter.seek((e.scrub.value / 1000) * d);
  });
  document.getElementById('app').addEventListener('click', ev => {
    if (ev.target.closest('.buy')) return;
    const row = ev.target.closest('.track');
    if (!row || !window.__currentList) return;
    playTrack(window.__currentList, Number(row.dataset.rank));
  });
}
```

- [ ] **Step 2: Hook into `js/app.js`** - exactly three edits:
  1. Top: `import { initPlayer, onRender } from './player.js';`
  2. In `route()`, immediately after `state.current = view.list ?? null;` add: `window.__currentList = state.current; onRender(state.current);`
  3. At the bottom, before `route();` add: `initPlayer();`

- [ ] **Step 3: Local integration test** (serve on 8734, browser pane): click row 03 on the jungle list (a Bandcamp track) → player section appears, LOADING…, artwork fills the panel, audio starts, elapsed counts, scrub works (drag to mid-track), pause/resume works, prev restarts then goes back, next advances to 04. Click a grime YouTube row → video visible and playing in the panel, transport controls it. Scrufizzer row 03 (Pulse X, bandcamp) then row 05 (youtube) - transitions clean. Let a short track finish → auto-advance. Navigate to `#/archive` mid-playback → audio keeps playing, transport still works; navigate back → active row re-highlights. Console: no errors (YT logs some benign warnings - note them).
- [ ] **Step 4:** Commit `"feat: unified player - transport, queue, row wiring"`. Push and spot-check on the LIVE site (this is the first push where the player is active).

---

### Task 7: SoundCloud + failure paths + polish pass

- [ ] **Step 1:** Live/local test the one SoundCloud track (jungle 02, Dwarde & Tim Reaper): widget shows in panel, plays, transport + scrub work, FINISH advances.
- [ ] **Step 2:** Failure drills (local, with temporary hacks NOT committed): point `WORKER_URL` at an unreachable host → Bandcamp row shows COULDN'T PLAY + LISTEN AT THE SOURCE link, transport doesn't wedge, next still works. Restore config. Mock an expired stream (set `audio.src` to a tampered bcbits URL via devtools after play, trigger error) → verify the one-shot re-resolve path resumes near position.
- [ ] **Step 3:** Mobile pass (375px): panel and wrapped transport usable, scrub full-width, tapping rows plays, no overflow. iOS-specific note: first play must come from the tap (it does - row click), `playsinline` set for YT.
- [ ] **Step 4:** Commit any fixes. Push.

---

### Task 8: M2 gate

- [ ] **Step 1:** Full pass over ALL 19 tracks on the live site - each starts, plays audibly, and its transport works (batch by adapter; note any dead embeds).
- [ ] **Step 2:** Update `DESIGN.md` milestone list (M2 done) + memory.
- [ ] **Step 3:** Travis listens on his phone + desktop and approves. Gate closes; M3 (VU meter) is next.

---

## Self-review notes

- Spec coverage vs DESIGN §Unified player: worker resolve at play time ✓ (T2/T3), never stored ✓ (runtime only + 20-min edge cache), three adapters ✓ (T5), visible YT ✓ (panel), transport set exactly as specified ✓ (T4/T6), expired-stream recovery ✓ (bandcamp adapter retry), resolve-failure fallback ✓ (`fail()` note + source link; official-embed variant via trackId deliberately DEFERRED - the note+link is simpler and the reviewer can weigh in), player skips stream-less tracks ✓ (queue filter).
- Placeholder scan: `<subdomain>` in Task 3 is filled at deploy time by instruction, not left in committed code (config.js is written in Step 4 with the real URL).
- Types consistent: adapter interface identical across all three; `playTrack(list, rank)` matches the row dataset written by M1's renderer.
- Live-site safety: every commit boundary leaves the site working (shell is inert until Task 6 Step 2 wires it).
