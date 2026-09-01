// IAMSIAM_LISTS - hash router + renderers. No deps, no build.
const app = document.getElementById('app');
const state = { index: null, lists: {} };

const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad2 = n => String(n).padStart(2, '0');

async function getIndex() {
  if (!state.index) {
    const r = await fetch('index.json');
    if (!r.ok) throw new Error(`index.json ${r.status}`);
    state.index = await r.json();
  }
  return state.index;
}

async function getList(slug) {
  if (!state.lists[slug]) {
    const r = await fetch(`lists/${encodeURIComponent(slug)}.json`);
    if (!r.ok) throw new Error(`list "${slug}" not found`);
    state.lists[slug] = await r.json();
  }
  return state.lists[slug];
}

function buyLabel(buy) {
  return `BUY ON ${esc(buy.platform).toUpperCase()}`;
}

function trackRow(t) {
  const buy = t.buy?.[0];
  return `
  <article class="track">
    <span class="rank">${pad2(t.rank)}</span>
    <span class="name">${esc(t.artist)} — ${esc(t.title)}</span>
    <span class="actions">
      <span class="badge">${esc(t.stream ? t.stream.type : 'unreleased')}</span>
      ${buy ? `<a class="buy" href="${esc(buy.url)}" target="_blank" rel="noopener">${buyLabel(buy)}</a>` : ''}
    </span>
    ${t.details ? `<span class="details">${esc(t.details)}</span>` : ''}
    ${t.note ? `<span class="note">${esc(t.note)}</span>` : ''}
  </article>`;
}

function renderList(list) {
  let html = `
  <div class="list-head">
    <div class="curator">CURATED BY ${esc(list.curator).toUpperCase()}</div>
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
  app.innerHTML = html;
}

async function renderHome() {
  const index = await getIndex();
  const latest = [...index].sort((a, b) => b.date.localeCompare(a.date))[0];
  renderList(await getList(latest.slug));
}

async function renderArchive() {
  const index = await getIndex();
  const items = [...index].sort((a, b) => b.date.localeCompare(a.date)).map(e => `
    <a href="#/list/${esc(e.slug)}">
      <div class="curator">${esc(e.curator).toUpperCase()}</div>
      <div class="title">${esc(e.listTitle)}</div>
      <div class="date">${esc(e.date)}</div>
    </a>`).join('');
  app.innerHTML = `<div class="archive-grid">${items}</div>`;
}

function renderAbout() {
  app.innerHTML = `
  <div class="about">
    <p>IAMSIAM LISTS is a weekly collection of music recommendations, curated by friends and family of the IAMSIAM label.</p>
    <p>Every week a different artist or friend of the label shares a top 10 of their liking. Listen here, and if something moves you, buy it — every track links to the store that supports the artist most directly.</p>
    <p><a href="https://www.instagram.com/_iamsiam_/" target="_blank" rel="noopener">INSTAGRAM</a> · <a href="https://iamsiam.bandcamp.com" target="_blank" rel="noopener">BANDCAMP</a></p>
  </div>`;
}

async function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  try {
    if (hash === '') await renderHome();
    else if (hash === 'archive') await renderArchive();
    else if (hash === 'about') renderAbout();
    else if (hash.startsWith('list/')) renderList(await getList(hash.slice(5)));
    else await renderHome();
  } catch (err) {
    app.innerHTML = `<div class="error-view">COULDN'T LOAD THAT — ${esc(err.message)}</div>`;
  }
  window.scrollTo(0, 0);
}

addEventListener('hashchange', route);
route();
