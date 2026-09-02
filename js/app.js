import { initPlayer, onRender } from './player.js';
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
  <article class="track${t.stream?.url ? ' playable' : ''}" data-rank="${esc(t.rank)}">
    <span class="rank">${esc(pad2(t.rank))}</span>
    <span class="art">${safeArt(t.art) ? `<img src="${esc(safeArt(t.art))}" loading="lazy" alt="">` : ''}</span>
    <span class="name">${esc(t.artist)} — ${esc(t.title)}</span>
    <span class="actions">
      <span class="badge">${esc(t.stream?.type || 'unreleased')}</span>
      ${buyHref ? `<a class="buy" href="${esc(buyHref)}" target="_blank" rel="noopener">BUY ON ${esc(buy.platform)}</a>` : ''}
    </span>
    ${t.details ? `<span class="details">${esc(t.details)}</span>` : ''}
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
    <p>Every week a different artist or friend of the label shares a top 10 of their liking. Listen here, and if something moves you, buy it. Every track links to the store that supports the artist most directly.</p>
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
  window.__currentList = state.current;
  app.innerHTML = view.html;
  onRender(state.current);
  document.title = view.title;
  window.scrollTo(0, 0);
}

addEventListener('hashchange', route);
initPlayer();
route();
