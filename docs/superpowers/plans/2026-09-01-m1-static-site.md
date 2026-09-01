# IAMSIAM_LISTS M1 - Static Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** IAMSIAM_LISTS live on GitHub Pages, rendering both existing weekly lists from JSON with track info, source badges, and working buy links (no player yet - that is M2).

**Architecture:** Static single-page site, no build step. Vanilla JS hash router renders JSON list files. A Node validator (TDD) guards the data schema. Deployed from the repo root via GitHub Pages.

**Tech Stack:** Vanilla HTML/CSS/JS (ES modules), Node 18+ (`node:test`) for the validator, `gh` CLI for repo + Pages setup. No dependencies, no framework.

**Repo root:** `/Users/travisstewart/MACHINEDRUM/CLAUDE DOCS/IAMSIAM_LISTS` (git repo already initialized, contains `DESIGN.md`).

**Design spec:** `DESIGN.md` at repo root. Read it first.

---

## Inputs needed from Travis (gather at Task 1, block only the data task on them)

1. **Scrufizzer's full list** - 5 grime instrumentals + 5 grime verses (artist, title, and his details/notes per track), plus the week date.
2. **Confirmation of the jungle top 10 tracklist** parsed from the carousel WAV filenames (table in Task 6).
3. **Confirmation of the IAMSIAM Instagram URL** used in the footer/about.

## File structure (locked in by this plan)

```
IAMSIAM_LISTS/
  index.html                 app shell: header, nav, #app mount, footer
  css/site.css               entire aesthetic (black / IBM Plex Mono / studio palette)
  js/app.js                  hash router + data loading + all render functions
  assets/logo.png            IAMSIAM logo w/ alpha (extracted from studio tool)
  index.json                 array of week entries {slug, date, curator, listTitle}
  lists/<slug>.json          one file per week; slug = YYYY-MM-DD-curator[-suffix]
  art/<date>/NN.jpg          track artwork (optional per track in M1)
  tools/validate-lists.mjs   schema validator: exported pure fn + CLI
  tools/validate-lists.test.mjs
  .claude/launch.json        dev server config (python http.server on 8734)
  .gitignore
  DESIGN.md                  (exists)
```

Schema note (addendum to DESIGN.md schema): tracks MAY carry an optional `"section"` string (e.g. `"top 5 grime instrumentals"`) - the renderer prints a section header whenever it changes. This handles Scrufizzer's 5+5 format.

---

### Task 1: Scaffolding + inputs

**Files:**
- Create: `.gitignore`, `.claude/launch.json`
- Create: `assets/logo.png` (extracted)

- [ ] **Step 1: Ask Travis for the three inputs** listed above (Scrufizzer list + date, jungle tracklist confirmation using the Task 6 table, Instagram URL). Continue with Tasks 1-5 while waiting; only Task 6 blocks on answers.

- [ ] **Step 2: Write `.gitignore`**

```gitignore
.DS_Store
node_modules/
```

- [ ] **Step 3: Write `.claude/launch.json`**

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "iamsiam-lists",
      "runtimeExecutable": "python3",
      "runtimeArgs": ["-m", "http.server", "8734"],
      "port": 8734
    }
  ]
}
```

- [ ] **Step 4: Extract the IAMSIAM logo PNG from the studio tool**

The studio file embeds logos as base64 data URIs. Extract the `iamsiam` one:

```bash
cd "/Users/travisstewart/MACHINEDRUM/CLAUDE DOCS/IAMSIAM_LISTS" && mkdir -p assets css js lists tools art
grep -oE 'data:image/(png|webp);base64,[A-Za-z0-9+/=]+' \
  "../vu_meter_visual_tool/iamsiam-studio.html" | head -5 > /tmp/logo_candidates.txt
wc -l /tmp/logo_candidates.txt
```

Decode each candidate (`sed 's/^data:image[^,]*,//' | base64 -d > assets/logo.png`), check with `file assets/logo.png` (expect `PNG image data` with alpha) and view it with the Read tool to confirm it is the IAMSIAM logo (the mark used in the IG carousels), matching by size against the studio UI's logoInfo dimensions if ambiguous. If the embedded asset is webp, convert: `sips -s format png assets/logo.webp --out assets/logo.png`. If no candidate is the right mark, ask Travis for the PNG he loads into the studio tool.

- [ ] **Step 5: Commit**

```bash
git add .gitignore .claude/launch.json assets/logo.png
git commit -m "chore: scaffolding, dev server config, logo asset"
```

---

### Task 2: Validator (TDD)

**Files:**
- Create: `tools/validate-lists.mjs`
- Test: `tools/validate-lists.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
// tools/validate-lists.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateList } from './validate-lists.mjs';

const good = () => ({
  curator: 'machinedrum',
  listTitle: 'top 10 jungle collaborations',
  date: '2026-08-24',
  tracks: [{
    rank: 1,
    artist: 'Africa Hitech',
    title: 'Out In The Streets (VIP)',
    details: 'warp · 2011 · 170 BPM',
    stream: { type: 'bandcamp', url: 'https://africahitech.bandcamp.com/track/x' },
    buy: [{ platform: 'bandcamp', url: 'https://africahitech.bandcamp.com/track/x' }]
  }]
});

test('valid list passes with no errors', () => {
  assert.deepEqual(validateList(good()).errors, []);
});

test('missing artist is an error', () => {
  const l = good(); delete l.tracks[0].artist;
  assert.match(validateList(l).errors.join(' '), /track 1: missing artist/);
});

test('bad stream type is an error', () => {
  const l = good(); l.tracks[0].stream.type = 'spotify';
  assert.match(validateList(l).errors.join(' '), /stream\.type/);
});

test('empty buy array is an error', () => {
  const l = good(); l.tracks[0].buy = [];
  assert.match(validateList(l).errors.join(' '), /buy/);
});

test('bad date is an error', () => {
  const l = good(); l.date = 'aug 24';
  assert.match(validateList(l).errors.join(' '), /date/);
});

test('non-http url is an error', () => {
  const l = good(); l.tracks[0].buy[0].url = 'ftp://nope';
  assert.match(validateList(l).errors.join(' '), /url/);
});

test('missing details is only a warning', () => {
  const l = good(); delete l.tracks[0].details;
  const r = validateList(l);
  assert.deepEqual(r.errors, []);
  assert.match(r.warnings.join(' '), /details/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tools/*.test.mjs`
Expected: FAIL - cannot find module `./validate-lists.mjs`.

- [ ] **Step 3: Write the validator**

```js
// tools/validate-lists.mjs
// Schema guard for weekly list JSON. Errors block publish; warnings don't.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const STREAM_TYPES = ['bandcamp', 'soundcloud', 'youtube', 'other'];
const isUrl = u => typeof u === 'string' && /^https?:\/\/.+/.test(u);

export function validateList(list) {
  const errors = [], warnings = [];
  for (const k of ['curator', 'listTitle', 'date'])
    if (!list?.[k] || typeof list[k] !== 'string') errors.push(`missing ${k}`);
  if (list?.date && !/^\d{4}-\d{2}-\d{2}$/.test(list.date))
    errors.push(`date must be YYYY-MM-DD, got "${list.date}"`);
  if (!Array.isArray(list?.tracks) || list.tracks.length === 0)
    errors.push('tracks must be a non-empty array');

  for (const [i, t] of (list?.tracks ?? []).entries()) {
    const at = `track ${i + 1}`;
    if (typeof t.rank !== 'number') errors.push(`${at}: missing rank`);
    if (!t.artist) errors.push(`${at}: missing artist`);
    if (!t.title) errors.push(`${at}: missing title`);
    if (!t.stream || !STREAM_TYPES.includes(t.stream.type))
      errors.push(`${at}: stream.type must be one of ${STREAM_TYPES.join('|')}`);
    if (!isUrl(t.stream?.url)) errors.push(`${at}: stream.url must be http(s) url`);
    if (!Array.isArray(t.buy) || t.buy.length === 0)
      errors.push(`${at}: buy must be a non-empty array`);
    for (const b of t.buy ?? [])
      if (!b.platform || !isUrl(b.url)) errors.push(`${at}: buy entry needs platform + http(s) url`);
    if (!t.details) warnings.push(`${at}: no details line`);
    if (!t.art) warnings.push(`${at}: no artwork`);
  }
  return { errors, warnings };
}

// CLI: validate every list + index.json cross-references
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  let failed = false;
  const index = JSON.parse(readFileSync(path.join(root, 'index.json'), 'utf8'));
  for (const entry of index) {
    const file = path.join(root, 'lists', `${entry.slug}.json`);
    if (!existsSync(file)) { console.error(`✗ index.json: lists/${entry.slug}.json missing`); failed = true; continue; }
    const { errors, warnings } = validateList(JSON.parse(readFileSync(file, 'utf8')));
    for (const w of warnings) console.warn(`  ⚠ ${entry.slug}: ${w}`);
    for (const e of errors) { console.error(`✗ ${entry.slug}: ${e}`); failed = true; }
    if (!errors.length) console.log(`✓ ${entry.slug}`);
  }
  const listed = new Set(index.map(e => `${e.slug}.json`));
  for (const f of readdirSync(path.join(root, 'lists')))
    if (f.endsWith('.json') && !listed.has(f)) console.warn(`  ⚠ lists/${f} not in index.json`);
  process.exit(failed ? 1 : 0);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tools/*.test.mjs`
Expected: 7 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add tools/
git commit -m "feat: list schema validator with tests"
```

**Task 2 amendments (adopted 2026-09-01 after quality review + real data):**
- Real data surfaced tracks with NO legitimate buy source (dubplates, video-only freestyles): empty `buy` array is now a WARNING, not an error (missing/non-array `buy` stays an error). DESIGN.md updated to match.
- Real data also surfaced a track with NO public stream at all (PRISM x Wheez-ie "Battalion Edit", private dubplate): `stream` may be absent → WARNING; renderer shows an UNRELEASED badge and the player (M2) skips such tracks. DESIGN.md updated to match.
- Quality-review fixes adopted: new exported `validateIndexEntry(entry, list)` (slug format `^[a-z0-9-]+$`, date/curator/listTitle present and matching the list file - index.json drives the home page sort and archive tiles, so it must be validated); malformed containers/elements return errors instead of throwing; `isText` (non-blank string) checks for curator/listTitle/artist/title/platform; rank must be integer >= 1 and unique per list; date round-trip check (rejects 2026-13-45); type-error messages say "must be", "missing" reserved for absent fields; CLI wraps JSON reads in try/catch (clean ✗ lines, keeps validating other lists), warns when referenced `art`/`envelope` files don't exist, prints a summary line, uses `process.exitCode`; one spawned CLI test over a tmpdir fixture tree (exit 0 good / 1 broken).

---

### Task 3: App shell + stylesheet

**Files:**
- Create: `index.html`
- Create: `css/site.css`

- [ ] **Step 1: Write `index.html`**

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>IAMSIAM LISTS</title>
<meta name="description" content="A weekly playlist of music curated by friends and family of the IAMSIAM label.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="css/site.css">
</head>
<body>
<header class="site-head">
  <a class="brand" href="#/"><img src="assets/logo.png" alt="IAMSIAM"><span>LISTS</span></a>
  <nav>
    <a href="#/">THIS WEEK</a>
    <a href="#/archive">ARCHIVE</a>
    <a href="#/about">ABOUT</a>
  </nav>
</header>
<p class="intro-strip">INTRODUCING IAMSIAM LISTS : A WEEKLY COLLECTION OF MUSIC RECOMMENDATIONS, CURATED BY FRIENDS AND FAMILY</p>
<main id="app"></main>
<footer class="site-foot">
  <a href="https://www.instagram.com/_iamsiam_/" target="_blank" rel="noopener">INSTAGRAM</a>
  <a href="https://iamsiam.bandcamp.com" target="_blank" rel="noopener">BANDCAMP</a>
</footer>
<script type="module" src="js/app.js"></script>
</body>
</html>
```

(Instagram URL verified 2026-09-01: `_iamsiam_` is linked from the iamsiam.bandcamp.com sidebar.)

- [ ] **Step 2: Write `css/site.css`**

Palette comes from the studio tool defaults: title `#ffffff`, meta `#8f8f88`, strip `#6b6b66`, border `#2c2c2a`.

```css
:root{
  color-scheme:dark;
  --bg:#000; --fg:#fff; --meta:#8f8f88; --strip:#7d7d78; --border:#2c2c2a; --hover:#0d0d0d;
  --mono:'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,monospace;
}
*{box-sizing:border-box;margin:0;padding:0}
html{background:var(--bg)}
body{
  background:var(--bg);color:var(--fg);font-family:var(--mono);
  font-size:14px;line-height:1.5;min-height:100vh;
  display:flex;flex-direction:column;
}
a{color:inherit;text-decoration:none}
a:focus-visible,.buy:focus-visible{outline:1px solid var(--fg);outline-offset:2px}

.site-head{
  display:flex;align-items:center;justify-content:space-between;gap:16px;
  padding:20px 24px;border-bottom:1px solid var(--border);
}
.brand{display:flex;align-items:center;gap:10px;font-weight:600;letter-spacing:.12em}
.brand img{height:22px;width:auto;display:block}
.site-head nav{display:flex;gap:18px;font-size:12px;color:var(--meta)}
.site-head nav a:hover{color:var(--fg)}

.intro-strip{
  padding:10px 24px;border-bottom:1px solid var(--border);
  color:var(--strip);font-size:11px;letter-spacing:.08em;
}

main{flex:1;width:100%;max-width:760px;margin:0 auto;padding:28px 24px 64px}

.list-head{margin-bottom:24px}
.list-head .curator{font-size:12px;color:var(--meta);letter-spacing:.1em;text-transform:uppercase}
.list-head h1{font-size:20px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-top:4px}
.list-head .date{font-size:11px;color:var(--strip);margin-top:4px}

.section-head{
  margin:28px 0 8px;padding-bottom:6px;border-bottom:1px solid var(--border);
  color:var(--meta);font-size:12px;text-transform:uppercase;letter-spacing:.1em;
}

.track{
  display:grid;grid-template-columns:34px 48px 1fr auto;gap:6px 14px;
  padding:16px 0;border-bottom:1px solid var(--border);align-items:start;
}
.track .rank{color:var(--strip);font-weight:600}
.track .art{width:48px;height:48px;border:1px solid var(--border);overflow:hidden}
.track .art img{width:100%;height:100%;object-fit:cover;display:block}
.track .art:empty{border:0}
.track .name{font-weight:600;text-transform:uppercase;letter-spacing:.02em}
.track .details{grid-column:3;color:var(--meta);font-size:12px}
.track .note{grid-column:3;color:var(--strip);font-size:12px;font-style:italic}
.track .actions{display:flex;flex-direction:column;align-items:flex-end;gap:8px}
.badge{
  font-size:10px;color:var(--meta);border:1px solid var(--border);
  padding:2px 6px;letter-spacing:.1em;text-transform:uppercase;
}
.buy{
  font-size:11px;font-weight:600;letter-spacing:.1em;
  border:1px solid var(--fg);padding:6px 12px;white-space:nowrap;
  text-transform:uppercase;
}
.buy:hover{background:var(--fg);color:var(--bg)}

.archive-grid{display:grid;gap:1px;background:var(--border);border:1px solid var(--border)}
.archive-grid a{background:var(--bg);padding:18px;display:block}
.archive-grid a:hover{background:var(--hover)}
.archive-grid .curator{color:var(--meta);font-size:12px;letter-spacing:.1em;text-transform:uppercase}
.archive-grid .title{font-weight:600;text-transform:uppercase;margin-top:2px}
.archive-grid .date{color:var(--strip);font-size:11px;margin-top:4px}

.about p{color:var(--meta);max-width:52ch;margin-bottom:16px}
.about a{border-bottom:1px solid var(--strip)}

.site-foot{
  display:flex;gap:18px;padding:20px 24px;border-top:1px solid var(--border);
  font-size:11px;color:var(--strip);letter-spacing:.1em;
}
.site-foot a:hover{color:var(--fg)}

.error-view{color:var(--meta);padding:40px 0}

@media (max-width:520px){
  .track{grid-template-columns:26px 40px 1fr}
  .track .art{width:40px;height:40px}
  .track .actions{grid-column:3;flex-direction:row;align-items:center;margin-top:8px}
  .site-head{flex-direction:column;align-items:flex-start;gap:10px}
}
```

- [ ] **Step 3: Commit**

```bash
git add index.html css/site.css
git commit -m "feat: app shell and site stylesheet (studio palette)"
```

---

### Task 4: Router + renderers

**Files:**
- Create: `js/app.js`

- [ ] **Step 1: Write `js/app.js`**

```js
// IAMSIAM_LISTS - hash router + renderers. No deps, no build.
const app = document.getElementById('app');
const state = { seq: 0, index: undefined, lists: Object.create(null), current: null };

const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad2 = n => String(n).padStart(2, '0');
const safeUrl = u => /^https?:\/\//i.test(String(u ?? '')) ? String(u) : '';
const safeArt = p => /^[\w][\w./-]*$/.test(String(p ?? '')) && !String(p).includes('//') ? String(p) : '';

async function getIndex() {
  if (state.index === undefined) {
    const r = await fetch('index.json');
    if (!r.ok) throw new Error(`index.json ${r.status}`);
    state.index = await r.json();
  }
  return state.index;
}

async function getList(slug) {
  if (!(slug in state.lists)) {
    const r = await fetch(`lists/${encodeURIComponent(slug)}.json`);
    if (!r.ok) throw new Error(`list "${slug}" not found`);
    state.lists[slug] = await r.json();
  }
  return state.lists[slug];
}

function trackRow(t) {
  const buy = t.buy?.[0];
  const buyHref = buy ? safeUrl(buy.url) : '';
  return `
  <article class="track" data-rank="${esc(t.rank)}">
    <span class="rank">${esc(pad2(t.rank))}</span>
    <span class="art">${safeArt(t.art) ? `<img src="${esc(safeArt(t.art))}" loading="lazy" alt="">` : ''}</span>
    <span class="name">${esc(t.artist)} — ${esc(t.title)}</span>
    <span class="actions">
      <span class="badge">${esc(t.stream?.type || 'unreleased')}</span>
      ${buyHref ? `<a class="buy" href="${esc(buyHref)}" target="_blank" rel="noopener">BUY ON ${esc(buy.platform)}</a>` : ''}
    </span>
    ${t.details ? `<span class="details">${esc(t.details)}</span>` : ''}
    ${t.note ? `<span class="note">${esc(t.note)}</span>` : ''}
  </article>`;
}

function listView(list) {
  if (!list || !Array.isArray(list.tracks)) throw new Error('malformed list');
  let html = `
  <div class="list-head">
    <div class="curator">CURATED BY ${esc(list.curator)}</div>
    <h1>${esc(list.listTitle)}</h1>
    <div class="date">${esc(list.date)}</div>
  </div>`;
  let section = null;
  for (const t of list.tracks) {
    if (t.section && t.section !== section) {
      section = t.section;
      html += `<h2 class="section-head">${esc(section)}</h2>`;
    }
    html += trackRow(t);
  }
  return { html, title: `IAMSIAM LISTS · ${list.listTitle}`, list };
}

async function homeView() {
  const index = await getIndex();
  if (!Array.isArray(index)) console.error('index.json: expected an array');
  const latest = Array.isArray(index) ? [...index].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0] : null;
  if (!latest) return { html: `<div class="error-view">NO LISTS YET</div>`, title: 'IAMSIAM LISTS' };
  return listView(await getList(latest.slug));
}

async function archiveView() {
  const index = await getIndex();
  if (!Array.isArray(index)) console.error('index.json: expected an array');
  const items = (Array.isArray(index) ? [...index] : []).sort((a, b) => String(b.date).localeCompare(String(a.date))).map(e => `
    <a href="#/list/${esc(e.slug)}">
      <div class="curator">${esc(e.curator)}</div>
      <div class="title">${esc(e.listTitle)}</div>
      <div class="date">${esc(e.date)}</div>
    </a>`).join('');
  if (!items) return { html: `<div class="error-view">NO LISTS YET</div>`, title: 'IAMSIAM LISTS · ARCHIVE' };
  return { html: `<div class="archive-grid">${items}</div>`, title: 'IAMSIAM LISTS · ARCHIVE' };
}

function aboutView() {
  return { title: 'IAMSIAM LISTS · ABOUT', html: `
  <div class="about">
    <p>IAMSIAM LISTS is a weekly collection of music recommendations, curated by friends and family of the IAMSIAM label.</p>
    <p>Every week a different artist or friend of the label shares a top 10 of their liking. Listen here, and if something moves you, buy it — every track links to the store that supports the artist most directly.</p>
    <p><a href="https://www.instagram.com/_iamsiam_/" target="_blank" rel="noopener">INSTAGRAM</a> · <a href="https://iamsiam.bandcamp.com" target="_blank" rel="noopener">BANDCAMP</a></p>
  </div>` };
}

async function route() {
  const seq = ++state.seq;
  const hash = location.hash.replace(/^#\/?/, '');
  let view;
  try {
    if (hash === '') view = await homeView();
    else if (hash === 'archive') view = await archiveView();
    else if (hash === 'about') view = aboutView();
    else if (hash.startsWith('list/')) view = listView(await getList(decodeURIComponent(hash.slice(5))));
    else view = await homeView();
  } catch (err) {
    console.error(err);
    view = { html: `<div class="error-view">COULDN'T LOAD THAT</div>`, title: 'IAMSIAM LISTS' };
  }
  if (seq !== state.seq) return;
  state.current = view.list ?? null;
  app.innerHTML = view.html;
  document.title = view.title;
  window.scrollTo(0, 0);
}

addEventListener('hashchange', route);
route();
```

(Badge shows `unreleased` when `stream` is absent, per the Task 2 amendments; a track with empty `buy` renders no buy button - the existing guard covers it.)

- [ ] **Step 2: Smoke-check with placeholder data, then remove it**

Create a temporary `index.json` + `lists/` entry using the `good()` fixture shape from the validator test, start the dev server (`preview_start` name `iamsiam-lists`), open `http://localhost:8734`, verify: home renders the track row, `#/archive` shows one tile, `#/about` renders, `#/list/<nonexistent-slug>` shows the error view (unknown top-level hashes deliberately fall back to home). Then delete the temp data (real data lands in Task 6).

- [ ] **Step 3: Commit**

```bash
git add js/app.js
git commit -m "feat: hash router and list/archive/about renderers"
```

**Task 4 amendments (adopted 2026-09-01 after quality review, code blocks above re-synced from committed files):** renderer hardened - every sink escaped (incl. rank, which had a live XSS), https-only allowlist on buy hrefs, route-token guard against re-entrant renders, graceful NO LISTS YET empty states, generic error copy (detail to console), per-route document.title, prototype-safe list cache, artwork thumbnails (48px, per DESIGN's M1 artwork promise), uppercasing moved to CSS. The em-dash artist — title separator is kept deliberately: it mirrors the studio tool's info layer.

---

### Task 5: GitHub repo + Pages

**Files:** none (infrastructure)

- [ ] **Step 1: Check gh auth**

Run: `gh auth status`
Expected: logged in as `tstewartproductions-gif`. If not, ask Travis to run `gh auth login` (his GitHub credentials - do it himself, per policy).

- [ ] **Step 2: Create the repo and push** (confirm with Travis before first push - it makes the code public)

```bash
cd "/Users/travisstewart/MACHINEDRUM/CLAUDE DOCS/IAMSIAM_LISTS"
gh repo create IAMSIAM-LISTS --public --source . --remote origin --push
```

- [ ] **Step 3: Enable Pages from main branch root**

```bash
gh api "repos/{owner}/IAMSIAM-LISTS/pages" --method POST \
  -f "source[branch]=main" -f "source[path]=/"
```

Expected: HTTP 201. If 409 (already exists), fine.

- [ ] **Step 4: Verify deploy**

Run (repeat until 200, deploys take ~1 min):
`curl -s -o /dev/null -w "%{http_code}" https://tstewartproductions-gif.github.io/IAMSIAM-LISTS/`
Expected: `200`. Then open it in the browser tool and confirm the shell renders.

- [ ] **Step 5: Commit** (nothing to commit if clean; this step is the gate that Pages is live)

---

### Task 6: Real data - both lists

**Files:**
- Create: `index.json`
- Create: `lists/2026-08-24-machinedrum.json`
- Create: `lists/<date>-scrufizzer.json` (date from Travis)
- Create: `art/<date>/*.jpg` (best effort)

**Jungle top 10, parsed from `../vu_meter_visual_tool/MACHINEDRUM_LIST/` WAV filenames - confirm each row with Travis before resolving:**

| # | Filename fragment | Best guess artist - title | Confident? |
|---|---|---|---|
| 01 | Africa Hitech - Out In The Streets (VIP) | Africa Hitech - Out In The Streets (VIP) | yes |
| 02 | dwarde & tim reaper - untitled junglist 320 | Dwarde & Tim Reaper - Untitled Junglist | yes |
| 03 | Brighter Dayz Rashad 13 | (DJ Rashad collab - confirm exact billing/title) | no |
| 04 | EXITVS007 A - Skeptical & dBridge - I've Seen | Skeptical & dBridge - I've Seen | yes |
| 05 | Various Artists-WAP100-001-Freeman, Hardy An | AFX & Squarepusher - Freeman Hardy & Willis Acid | mostly |
| 06 | adlai & Loqum - TIME ATTACK TRAX - 03 ROCTHEBOAT BREAK FLIP | Adlai & Loqum - ROCTHEBOAT BREAK FLIP | yes |
| 07 | PRISM x WHEEZ-IE - BATTALION EDIT | PRISM x Wheez-ie - Battalion Edit | yes |
| 08 | G JONES & EPROM - THE REAL | G Jones & EPROM - The Real | yes |
| 09 | Thys & Nick Thayer - Go Again v18 | Thys & Nick Thayer - Go Again | yes |
| 10 | The Limit_SC_Master | (confirm artist billing - collab list, so who + who?) | no |

- [ ] **Step 1: Confirm tracklists** (from Task 1 inputs). Get Scrufizzer's 10 entries with sections `top 5 grime instrumentals` / `top 5 grime verses`.

- [ ] **Step 2: Resolve stream + buy sources per track** (this is a manual dry run of the future `/add-list` skill). For each track, in order:
  1. Search Bandcamp (`site:bandcamp.com "<artist>" "<title>"`, plus artist/label pages). If found: `stream = {type:'bandcamp', url}` and `buy[0] = {platform:'bandcamp', url}`.
  2. Search Beatport for a buy link → append `{platform:'beatport', url}`.
  3. If no Bandcamp stream: try SoundCloud (official artist page), then YouTube (official upload/topic channel) for `stream`; `type` accordingly.
  4. If sold elsewhere only (Boomkat, Juno, iTunes, label store): that becomes the buy link, `platform` named for the actual store.
  5. Nothing anywhere (dubplates/unreleased): `stream.type:'other'` with the most canonical listenable URL available, and buy may fall back to the artist's general store page - note it for Travis to review.
  Record every resolution in the JSON. Verify each URL with `curl -s -o /dev/null -w "%{http_code}"` (expect 200 or 3xx).

- [ ] **Step 3: Fetch artwork (best effort)** - for Bandcamp/SoundCloud/YouTube sources, pull the page's `og:image` into `art/<date>/NN.jpg` (`curl -sL <page> | grep -oE 'og:image" content="[^"]*'` then download). Skip failures - art is a warning, and M3's carousel assets can backfill.

- [ ] **Step 4: Write the two list files + index.json.** Shape per DESIGN.md schema (+ optional `section`). `index.json`:

```json
[
  { "slug": "2026-08-24-machinedrum", "date": "2026-08-24", "curator": "machinedrum", "listTitle": "top 10 jungle collaborations" },
  { "slug": "<date>-scrufizzer", "date": "<date>", "curator": "scrufizzer", "listTitle": "top 5 grime instrumentals + top 5 grime verses of all time" }
]
```

(`<date>` replaced with the confirmed real date; `details` lines built from label · year · BPM · length where known - Beatport/Bandcamp pages supply most of it.)

- [ ] **Step 5: Validate**

Run: `node tools/validate-lists.mjs`
Expected: `✓` per list, exit 0 (warnings acceptable).

- [ ] **Step 6: Review gate with Travis** - show a table of every track: stream source, buy source, gaps. Wait for OK.

- [ ] **Step 7: Commit + push**

```bash
git add index.json lists/ art/
git commit -m "feat: first two lists - scrufizzer grime, machinedrum jungle collaborations"
git push
```

---

### Task 7: QA pass + M1 gate

- [ ] **Step 1: Full check on the live Pages URL** (browser tool): home shows the newest list; every buy link opens the right store page; archive shows both weeks and loads each; about renders; `#/list/<nonexistent-slug>` shows the error view (unknown top-level hashes deliberately fall back to home).
- [ ] **Step 2: Mobile pass** - `resize_window` mobile preset: track rows wrap per the 520px breakpoint, nothing overflows horizontally.
- [ ] **Step 3: Screenshot desktop + mobile for Travis.**
- [ ] **Step 4: Declare M1 complete** only after Travis confirms the look direction (this doubles as the design-iteration gate from DESIGN.md). Then M2 (unified player) gets its own plan.

---

## Self-review notes

- Spec coverage (M1 scope from DESIGN.md): repo + Pages live ✓ (Task 5), both lists from JSON ✓ (Task 6), artwork best-effort ✓ (Task 6 Step 3 - full art guaranteed by M3 assets), details/badges/buy links ✓ (Tasks 4, 6), validator ✓ (Task 2), look-iteration gate ✓ (Task 7). Player, VU, worker, `/add-list` are explicitly M2-M4 and get their own plans.
- Types consistent: `validateList` shape matches renderer expectations (`stream.type`, `buy[0].platform/url`, optional `details/note/section`).
- Known execution-time lookups (Scrufizzer list, uncertain jungle rows, URLs) are defined as concrete research steps with rules and verification, never left as silent gaps.
