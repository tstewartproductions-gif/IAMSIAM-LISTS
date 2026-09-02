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
  ytReady = new Promise(res => {
    if (window.YT?.Player) return res();
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); res(); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
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
  scReady = new Promise(res => {
    if (window.SC?.Widget) return res();
    const s = document.createElement('script');
    s.src = 'https://w.soundcloud.com/player/api.js';
    s.onload = () => res();
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
