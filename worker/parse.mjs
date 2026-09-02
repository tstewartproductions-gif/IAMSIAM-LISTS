// worker/parse.mjs
// Pure extraction of Bandcamp track-page data. Runs in Node (tests) and the Worker.
const ENT = { '&quot;': '"', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&#39;': "'" };
const decodeEntities = s => s.replace(/&(?:quot|amp|lt|gt|#39);/g, m => ENT[m]);

export function parseTrackPage(html) {
  const m = html.match(/data-tralbum="([^"]*)"/);
  if (!m) throw new Error('no data-tralbum on page');
  const data = JSON.parse(decodeEntities(m[1]));
  const t = data?.trackinfo?.[0];
  const streamUrl = t?.file?.['mp3-128'];
  if (!streamUrl) throw new Error('no public stream for this track');
  const art = html.match(/property="og:image" content="([^"]*)"/)?.[1] ?? null;
  return {
    streamUrl,
    title: data?.current?.title ?? t.title ?? '',
    artist: data?.artist ?? '',
    duration: Math.round(t.duration ?? 0),
    trackId: t.track_id ?? data?.current?.id ?? null,
    albumId: data?.current?.album_id ?? null,
    art,
  };
}
