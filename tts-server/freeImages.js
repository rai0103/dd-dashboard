// 著作権フリー（パブリックドメイン・CC0・商用可のCCライセンス・無料素材サイト）の画像検索。
// 日本文化動画アプリ（C:\Users\shini\japan-culture-video の lib/media.ts・app/api/media・app/api/proxy）の
// 画像検索をそのまま移植したもの（解説動画は画像だけを使うため、動画素材の検索は省いている）。
//  - 美術作品（CC0）：The Met / シカゴ美術館 / クリーブランド美術館（キー不要）、スミソニアン（要キー・無料）
//  - 写真：Wikimedia Commons（パブリックドメイン・CC0・CC BY・CC BY-SA のみ）
//          Pixabay（要キー・無料） / Pexels（キーがあれば）
//  - 人物・場所・作品の名前：Wikipedia（日・英）の記事画像（Commonsで自由ライセンスのものだけ）
//  - その他のCCライセンス画像：Openverse（商用可のライセンスのみ）
// キーは tts-server/.env の PIXABAY_API_KEY・PEXELS_API_KEY・SMITHSONIAN_API_KEY（いずれも任意。無ければその検索先だけ省く）。
// 日本語のキーワードは、GEMINI_API_KEY があれば英語の検索語にも直して美術館・Openverse等を検索する。

const UA = 'DDDashboardExplainer/0.1 (personal, non-commercial research tool)';
const cache = new Map();
const TTL = 24 * 3600 * 1000;

async function getJson(url, headers = {}, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, ...headers }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.items;
  try {
    const items = await fn();
    cache.set(key, { at: Date.now(), items });
    return items;
  } catch (e) {
    console.warn(`[free-images] ${key} failed:`, e && e.message ? e.message : e);
    return [];
  }
}

async function mapLimit(arr, limit, fn) {
  const out = new Array(arr.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, arr.length) }, async () => {
    while (i < arr.length) { const idx = i++; out[idx] = await fn(arr[idx]); }
  }));
  return out;
}

const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

// ---- The Met (CC0) ----
function searchMet(q, max = 6) {
  return cached(`met:${q}`, async () => {
    const s = await getJson(`https://collectionapi.metmuseum.org/public/collection/v1/search?hasImages=true&q=${encodeURIComponent(q)}`);
    const ids = (s.objectIDs || []).slice(0, 18);
    const objs = await mapLimit(ids, 6, (id) => getJson(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`).catch(() => null));
    const out = [];
    for (const o of objs) {
      if (!o || !o.isPublicDomain || !o.primaryImage) continue;
      out.push({
        id: `met-${o.objectID}`, url: o.primaryImage, thumbnailUrl: o.primaryImageSmall || o.primaryImage,
        source: 'The Met (CC0)', caption: [o.title, o.objectDate].filter(Boolean).join(', '),
        credit: [o.artistDisplayName, 'The Metropolitan Museum of Art'].filter(Boolean).join(' / '), pageUrl: o.objectURL,
      });
      if (out.length >= max) break;
    }
    return out;
  });
}

// ---- Art Institute of Chicago (CC0) ----
function searchAic(q, max = 6) {
  return cached(`aic:${q}`, async () => {
    const d = await getJson(
      `https://api.artic.edu/api/v1/artworks/search?q=${encodeURIComponent(q)}&query[term][is_public_domain]=true&fields=id,title,image_id,artist_title,date_display&limit=${max + 4}`,
      { 'AIC-User-Agent': UA },
    );
    const iiif = (d && d.config && d.config.iiif_url) || 'https://www.artic.edu/iiif/2';
    return (d.data || []).filter((a) => a.image_id).slice(0, max).map((a) => ({
      id: `aic-${a.id}`, url: `${iiif}/${a.image_id}/full/1686,/0/default.jpg`, thumbnailUrl: `${iiif}/${a.image_id}/full/843,/0/default.jpg`,
      source: 'Art Institute of Chicago (CC0)', caption: [a.title, a.date_display].filter(Boolean).join(', '),
      credit: [a.artist_title, 'Art Institute of Chicago'].filter(Boolean).join(' / '), pageUrl: `https://www.artic.edu/artworks/${a.id}`,
    }));
  });
}

// ---- Cleveland Museum of Art (CC0) ----
function searchCleveland(q, max = 6) {
  return cached(`cma:${q}`, async () => {
    const d = await getJson(`https://openaccess-api.clevelandart.org/api/artworks/?q=${encodeURIComponent(q)}&cc0=1&has_image=1&limit=${max}`);
    return (d.data || []).filter((a) => a.images && a.images.web && a.images.web.url).map((a) => ({
      id: `cma-${a.id}`, url: (a.images.print && a.images.print.url) || a.images.web.url, thumbnailUrl: a.images.web.url,
      source: 'Cleveland Museum of Art (CC0)', caption: [a.title, a.creation_date].filter(Boolean).join(', '),
      credit: [strip((a.creators && a.creators[0] && a.creators[0].description) || ''), 'Cleveland Museum of Art'].filter(Boolean).join(' / '),
      pageUrl: a.url, width: a.images.print && a.images.print.width, height: a.images.print && a.images.print.height,
    }));
  });
}

// ---- Wikimedia Commons（ライセンスを確認して自由に使えるものだけ） ----
const OK_LICENSE = /^(public domain|pd\b|cc0|cc by(-sa)? \d)/i;
function searchWikimedia(q, max = 6) {
  return cached(`wm:${q}`, async () => {
    const url = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=20'
      + `&gsrsearch=${encodeURIComponent(`${q} filetype:bitmap`)}&prop=imageinfo&iiprop=url|extmetadata|size|mime&iiurlwidth=1920`;
    const d = await getJson(url);
    const pages = Object.values((d && d.query && d.query.pages) || {});
    pages.sort((a, b) => (a.index || 0) - (b.index || 0));
    const out = [];
    for (const p of pages) {
      const ii = p.imageinfo && p.imageinfo[0];
      if (!ii || !/jpe?g|png|webp/i.test(ii.mime || '')) continue;
      if ((ii.width || 0) < 1200) continue;
      const em = ii.extmetadata || {};
      const lic = strip((em.LicenseShortName && em.LicenseShortName.value) || '');
      if (!OK_LICENSE.test(lic)) continue;
      const artist = strip((em.Artist && em.Artist.value) || '').slice(0, 80);
      out.push({
        id: `wm-${p.pageid}`, url: ii.thumburl || ii.url, thumbnailUrl: (ii.thumburl || ii.url).replace(/\/\d+px-/, '/500px-'),
        source: `Wikimedia Commons (${lic})`,
        caption: strip((em.ObjectName && em.ObjectName.value) || p.title.replace(/^File:/, '').replace(/\.\w+$/, '')),
        credit: [artist, lic].filter(Boolean).join(' / '), pageUrl: ii.descriptionurl, width: ii.width, height: ii.height,
      });
      if (out.length >= max) break;
    }
    return out;
  });
}

// ---- Smithsonian Open Access（CC0のみ。キーは SMITHSONIAN_API_KEY） ----
function searchSmithsonian(q, max = 6) {
  const key = process.env.SMITHSONIAN_API_KEY;
  if (!key) return Promise.resolve([]);
  return cached(`si:${q}`, async () => {
    const query = `${q} AND online_media_type:"Images"`;
    const d = await getJson(`https://api.si.edu/openaccess/api/v1.0/search?q=${encodeURIComponent(query)}&rows=${max * 3}&api_key=${key}`);
    const out = [];
    for (const r of (d && d.response && d.response.rows) || []) {
      const c = r.content || {};
      const dn = c.descriptiveNonRepeating || {};
      const media = ((dn.online_media && dn.online_media.media) || []).find((m) => m && m.type === 'Images' && /cc0/i.test((m.usage && m.usage.access) || '') && m.content);
      if (!media) continue;
      const base = String(media.content);
      const sized = (n) => (/deliveryService/.test(base) ? `${base}${base.includes('?') ? '&' : '?'}max=${n}` : base);
      const maker = ((c.freetext && c.freetext.name) || []).map((n) => n && n.content).filter(Boolean)[0] || '';
      const date = ((c.freetext && c.freetext.date) || []).map((n) => n && n.content).filter(Boolean)[0] || '';
      const unit = dn.data_source || r.unitCode || 'Smithsonian';
      out.push({
        id: `si-${r.id}`, url: sized(2400), thumbnailUrl: media.thumbnail || sized(400), source: 'Smithsonian (CC0)',
        caption: [r.title || (dn.title && dn.title.content), date].filter(Boolean).join(', '),
        credit: [strip(maker), unit].filter(Boolean).join(' / '), pageUrl: dn.record_link || dn.guid,
      });
      if (out.length >= max) break;
    }
    return out;
  });
}

// ---- Wikipedia の記事画像（人物・建物・作品など。Commonsにあり自由ライセンスのものだけ） ----
async function commonsFiles(names) {
  if (!names.length) return [];
  const titles = names.map((n) => `File:${n}`).join('|');
  const d = await getJson(`https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|extmetadata|size|mime&iiurlwidth=1920&titles=${encodeURIComponent(titles)}`);
  const out = [];
  for (const p of Object.values((d && d.query && d.query.pages) || {})) {
    const ii = p.imageinfo && p.imageinfo[0];
    if (!ii || !/jpe?g|png|webp|tiff/i.test(ii.mime || '')) continue;
    const em = ii.extmetadata || {};
    const lic = strip((em.LicenseShortName && em.LicenseShortName.value) || '');
    if (!OK_LICENSE.test(lic)) continue;
    const artist = strip((em.Artist && em.Artist.value) || '').slice(0, 80);
    const url = /tiff/i.test(ii.mime) ? ii.thumburl : ii.thumburl || ii.url;
    if (!url) continue;
    out.push({
      id: `wm-${p.pageid}`, url, thumbnailUrl: url.replace(/\/\d+px-/, '/500px-'), source: `Wikipedia / Commons (${lic})`,
      caption: strip((em.ImageDescription && em.ImageDescription.value) || (em.ObjectName && em.ObjectName.value) || p.title.replace(/^File:/, '')).slice(0, 160),
      credit: [artist, lic].filter(Boolean).join(' / '), pageUrl: ii.descriptionurl, width: ii.width, height: ii.height,
    });
  }
  return out;
}

function searchWikipedia(q, lang, max = 4) {
  return cached(`wp:${lang}:${q}`, async () => {
    const d = await getJson(`https://${lang}.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrlimit=${max}&prop=pageimages&piprop=name&gsrsearch=${encodeURIComponent(q)}`);
    const pages = Object.values((d && d.query && d.query.pages) || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
    const norm = (n) => n.replace(/^File:/, '').replace(/_/g, ' ').trim();
    const articleOf = new Map();
    for (const pg of pages) if (pg.pageimage && !articleOf.has(norm(pg.pageimage))) articleOf.set(norm(pg.pageimage), pg.title);
    const names = Array.from(articleOf.keys());
    const files = await commonsFiles(names);
    const fileName = (c) => norm(decodeURIComponent((c.pageUrl || '').split('/File:')[1] || ''));
    return files
      .sort((x, y) => names.indexOf(fileName(x)) - names.indexOf(fileName(y)))
      .map((c) => {
        const art = articleOf.get(fileName(c));
        return { ...c, caption: art ? `${art}${c.caption ? ` — ${c.caption}` : ''}`.slice(0, 180) : c.caption };
      });
  });
}

// ---- Openverse（Flickr等のCC画像の横断検索。商用利用できるライセンスのみ） ----
function searchOpenverse(q, max = 8) {
  return cached(`ov:${q}`, async () => {
    const d = await getJson(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&license_type=commercial&mature=false&page_size=${max + 4}`);
    const out = [];
    for (const r of d.results || []) {
      if (!r.url || (r.width && r.width < 1000)) continue;
      const lic = r.license === 'pdm' ? 'Public domain' : r.license === 'cc0' ? 'CC0' : `CC ${String(r.license).toUpperCase()} ${r.license_version || ''}`.trim();
      out.push({
        id: `ov-${r.id}`, url: r.url, thumbnailUrl: r.thumbnail || r.url, source: `Openverse / ${r.source || r.provider} (${lic})`,
        caption: r.title, credit: [r.creator, lic].filter(Boolean).join(' / '), pageUrl: r.foreign_landing_url, width: r.width, height: r.height,
      });
      if (out.length >= max) break;
    }
    return out;
  });
}

// ---- Pixabay（キーは PIXABAY_API_KEY） ----
function searchPixabayPhotos(q, max = 6) {
  const key = process.env.PIXABAY_API_KEY;
  if (!key) return Promise.resolve([]);
  return cached(`pxb:${q}`, async () => {
    const d = await getJson(`https://pixabay.com/api/?key=${key}&q=${encodeURIComponent(q.slice(0, 100))}&image_type=photo&orientation=horizontal&safesearch=true&min_width=1600&per_page=${Math.max(5, max)}`);
    return (d.hits || []).slice(0, max).map((h) => ({
      id: `pxb-${h.id}`, url: h.fullHDURL || h.largeImageURL, thumbnailUrl: h.webformatURL, source: 'Pixabay (Free)',
      caption: h.tags, credit: h.user ? `${h.user} / Pixabay` : 'Pixabay', pageUrl: h.pageURL, width: h.imageWidth, height: h.imageHeight,
    }));
  });
}

// ---- Pexels（キーがある場合のみ） ----
function searchPexelsPhotos(q, max = 5) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return Promise.resolve([]);
  return cached(`pex:${q}`, async () => {
    const d = await getJson(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=${max}&orientation=landscape`, { Authorization: key });
    return (d.photos || []).map((p) => ({
      id: `pex-${p.id}`, url: `${p.src.original}?auto=compress&cs=tinysrgb&w=2400`, thumbnailUrl: p.src.medium, source: 'Pexels (Free)',
      caption: p.alt, credit: p.photographer ? `${p.photographer} / Pexels` : 'Pexels', pageUrl: p.url, width: p.width, height: p.height,
    }));
  });
}

/** 複数の結果リストを交互に並べ、重複を除く */
function interleave(lists, max) {
  const out = [];
  const seen = new Set();
  for (let i = 0; out.length < max; i++) {
    let any = false;
    for (const l of lists) {
      if (i < l.length) {
        any = true;
        if (!seen.has(l[i].id)) { seen.add(l[i].id); out.push(l[i]); }
      }
    }
    if (!any) break;
  }
  return out.slice(0, max);
}

const CJK = /[\u3040-\u30ff\u3400-\u9fff]/;

/**
 * キーワード検索（例：「日銀」「Bank of Japan」「ナスダック」）。日本語のキーワードは、英語の検索語（enTerms）も使って
 * 美術館・Openverse等を検索する。Wikipediaの記事画像を先頭に、残りは各検索先を交互に並べる（日本文化動画アプリと同じ順）。
 */
async function searchByKeyword(keyword, enTerms, max = 24) {
  const k = keyword.trim();
  const en = Array.from(new Set([...(CJK.test(k) ? [] : [k]), ...enTerms.map((x) => String(x).trim()).filter(Boolean)])).slice(0, 2);
  const e1 = en[0] || k;
  const lists = await Promise.all([
    CJK.test(k) ? searchWikipedia(k, 'ja', 4) : searchWikipedia(k, 'en', 4),
    en[0] ? searchWikipedia(e1, 'en', 3) : Promise.resolve([]),
    searchWikimedia(CJK.test(k) ? k : e1, 6),
    en[0] && CJK.test(k) ? searchWikimedia(e1, 4) : Promise.resolve([]),
    searchMet(e1, 4),
    searchAic(e1, 4),
    searchCleveland(e1, 4),
    searchSmithsonian(e1, 4),
    searchOpenverse(e1, 6),
    searchPixabayPhotos(e1, 4),
    searchPexelsPhotos(e1, 3),
  ]);
  const [wpA, wpB, ...others] = lists;
  const top = interleave([wpA, wpB], 8);
  const rest = interleave(others, max).filter((x) => !top.some((t) => t.id === x.id));
  return [...top, ...rest].slice(0, max);
}

// ---- 日本語のキーワードを、美術館・画像サイトで通じる英語の検索語にする（GEMINI_API_KEYがあるときだけ） ----
const termCache = new Map();
async function englishTerms(keyword, context) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return [];
  const ck = `${keyword}|${String(context || '').slice(0, 80)}`;
  if (termCache.has(ck)) return termCache.get(ck);
  const model = process.env.GEMINI_SEARCH_MODEL || 'gemini-3.8-flash';
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `Convert this Japanese image-search keyword into 2 short English search terms that museum catalogues, Wikipedia and stock photo sites would use (proper names in standard romanization; add a type word only if helpful).\nKeyword: ${keyword}\n${context ? `Context (the video scene): ${String(context).slice(0, 400)}` : ''}` }] }],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: { type: 'OBJECT', properties: { terms: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['terms'] } },
      }),
    });
    const data = await r.json();
    if (!r.ok) return [];
    const parts = (data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
    const txt = parts.map((p) => p.text || '').join('');
    const terms = (JSON.parse(txt).terms || []).map(String).filter(Boolean).slice(0, 2);
    termCache.set(ck, terms);
    return terms;
  } catch {
    return [];
  }
}

// Wikimedia（upload.wikimedia.org）は決まった幅のサムネイルしか配信しないため、URLの幅を最寄りの標準サイズに直す
const STANDARD = [20, 40, 60, 120, 250, 330, 500, 960, 1280, 1920, 3840];
function normalizeWikimediaUrl(url) {
  return url.replace(/^(https:\/\/upload\.wikimedia\.org\/.+\/thumb\/.+\/)(\d+)px-/, (_m, head, w) => {
    const n = Number(w);
    const std = STANDARD.find((x) => x >= n) || 3840;
    return `${head}${std}px-`;
  });
}

// ---- Pixabay の画像URLは一定時間で無効になる。IDから新しいURLを取り直す ----
async function refreshPixabayUrl(mid, oldUrl) {
  const key = process.env.PIXABAY_API_KEY;
  const m = String(mid || '').match(/^pxb-(\d+)$/);
  if (!key || !m) return null;
  try {
    const d = await getJson(`https://pixabay.com/api/?key=${key}&id=${m[1]}`);
    const h = d && d.hits && d.hits[0];
    if (!h) return null;
    return /_640\./.test(oldUrl) || /_180\./.test(oldUrl) ? h.webformatURL : h.fullHDURL || h.largeImageURL || h.webformatURL || null;
  } catch {
    return null;
  }
}

/** POST /api/free-images {keyword, enTerms?, context?, max?} → {items, terms} */
async function handlePostFreeImages(body) {
  const kw = typeof body.keyword === 'string' ? body.keyword.trim() : '';
  if (!kw) return { status: 400, json: { error: 'BAD_REQUEST', message: 'キーワードが空です。' } };
  const given = Array.isArray(body.enTerms) ? body.enTerms.map(String).filter(Boolean).slice(0, 2) : [];
  const terms = given.length ? given : CJK.test(kw) ? await englishTerms(kw, String(body.context || '')) : [];
  const items = await searchByKeyword(kw, terms, Math.min(48, Number(body.max) || 30));
  return { status: 200, json: { items, terms } };
}

/**
 * GET /api/free-image-proxy?url=...&mid=... 素材を tts-server 経由で読み込む（ブラウザのCanvasで描画・書き出しするには
 * 外部画像のままだと汚染されるため、いったんこのサーバー経由で取り込み、画像ライブラリに保存する）。
 * https の外部サイトだけ許可し（自分のPC・社内ネットワークは不可）、返すのは画像だけ。
 */
async function handleGetFreeImageProxy(reqUrl, res) {
  const sp = new URL(reqUrl, 'http://localhost').searchParams;
  const u = sp.get('url');
  const mid = sp.get('mid') || '';
  const fail = (status, msg) => { res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(msg); };
  if (!u) return fail(400, 'url is required');
  let target;
  try { target = new URL(normalizeWikimediaUrl(u)); } catch { return fail(400, 'bad url'); }
  const h = target.hostname;
  const privateHost = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[|::1)/.test(h) || !h.includes('.');
  if (target.protocol !== 'https:' || privateHost) return fail(403, 'host not allowed');
  const headers0 = { 'user-agent': UA, 'AIC-User-Agent': UA, accept: 'image/avif,image/webp,image/*,*/*;q=0.8' };
  let upstream = await fetch(target, { headers: headers0, redirect: 'follow' }).catch(() => null);
  // シカゴ美術館のIIIF画像は大きいサイズが許可されていない作品があるため、推奨サイズ（843幅）でやり直す
  if ((!upstream || !upstream.ok) && /artic\.edu$/.test(target.hostname) && /\/full\/\d+,\//.test(target.pathname)) {
    const alt = new URL(target);
    alt.pathname = alt.pathname.replace(/\/full\/\d+,\//, '/full/843,/');
    upstream = await fetch(alt, { headers: headers0, redirect: 'follow' }).catch(() => null);
  }
  if ((!upstream || !upstream.ok) && /^pxb-\d+$/.test(mid)) {
    const fresh = await refreshPixabayUrl(mid, target.toString());
    if (fresh) upstream = await fetch(fresh, { headers: headers0, redirect: 'follow' }).catch(() => null);
  }
  if (!upstream) return fail(502, 'upstream unreachable');
  if (!upstream.ok) return fail(502, `upstream ${upstream.status}`);
  const ctype = upstream.headers.get('content-type') || '';
  if (!/^image\//i.test(ctype) && !/octet-stream/i.test(ctype)) return fail(415, 'not an image');
  const buf = Buffer.from(await upstream.arrayBuffer());
  res.writeHead(200, { 'Content-Type': ctype || 'application/octet-stream', 'Content-Length': buf.length, 'Cache-Control': 'private, max-age=86400' });
  res.end(buf);
}

module.exports = { handlePostFreeImages, handleGetFreeImageProxy, searchByKeyword, normalizeWikimediaUrl };
