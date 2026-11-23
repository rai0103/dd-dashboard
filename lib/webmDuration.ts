// ブラウザの録画（MediaRecorder）が作るWebMには「動画の長さ（Duration）」がファイルに書かれない
// （Chromeの既知の仕様。ffprobeで見ると duration=N/A）。YouTubeはアップロード時に長さが分からないと
// ショート（縦型・3分以内）と判定できず、通常の動画として扱うことがあるため、録画後にWebMの
// 先頭の情報欄（Segment > Info）へDurationを書き足す。外部ライブラリは使わず、必要な部分だけを読む。

const ID_EBML = 0x1a45dfa3, ID_SEGMENT = 0x18538067, ID_INFO = 0x1549a966, ID_CLUSTER = 0x1f43b675;
const ID_TIMECODE_SCALE = 0x2ad7b1, ID_DURATION = 0x4489;

/** EBMLの要素ID（先頭ビットで長さが決まる・印のビットは残す） */
function readId(u: Uint8Array, p: number): { id: number; len: number } | null {
  const b = u[p];
  if (b === undefined) return null;
  const len = b & 0x80 ? 1 : b & 0x40 ? 2 : b & 0x20 ? 3 : b & 0x10 ? 4 : 0;
  if (!len || p + len > u.length) return null;
  let id = 0;
  for (let i = 0; i < len; i++) id = id * 256 + u[p + i];
  return { id, len };
}

/** EBMLの要素サイズ（印のビットは外す）。すべて1は「サイズ不明」（unknown=true） */
function readSize(u: Uint8Array, p: number): { size: number; len: number; unknown: boolean } | null {
  const b = u[p];
  if (b === undefined) return null;
  let len = 1;
  while (len <= 8 && !(b & (0x80 >> (len - 1)))) len++;
  if (len > 8 || p + len > u.length) return null;
  let v = b & (0xff >> len), allOnes = v === (0xff >> len);
  for (let i = 1; i < len; i++) { v = v * 256 + u[p + i]; if (u[p + i] !== 0xff) allOnes = false; }
  return { size: v, len, unknown: allOnes };
}

function readUint(u: Uint8Array, p: number, n: number): number {
  let v = 0;
  for (let i = 0; i < n; i++) v = v * 256 + u[p + i];
  return v;
}

/**
 * WebMにDuration（ミリ秒）を書き込んだ新しいバイト列を返す。形式が想定外のときは元のまま返す（壊さない）。
 * 既にDurationがあれば値だけを書き換える。
 */
export function fixWebmDuration(input: Uint8Array, durationMs: number): Uint8Array {
  if (!(durationMs > 0)) return input;
  const u = input;
  let p = 0;
  const head = readId(u, p);
  if (!head || head.id !== ID_EBML) return input;
  p += head.len;
  const hs = readSize(u, p);
  if (!hs || hs.unknown) return input;
  p += hs.len + hs.size;
  const seg = readId(u, p);
  if (!seg || seg.id !== ID_SEGMENT) return input;
  p += seg.len;
  const ss = readSize(u, p);
  if (!ss) return input;
  p += ss.len;
  const segEnd = ss.unknown ? u.length : Math.min(u.length, p + ss.size);
  // Segmentの直下からInfoを探す（Clusterに着いたら諦める）
  while (p < segEnd) {
    const el = readId(u, p);
    if (!el) return input;
    const es = readSize(u, p + el.len);
    if (!es || es.unknown) return input;
    const dataStart = p + el.len + es.len, dataEnd = dataStart + es.size;
    if (dataEnd > u.length) return input;
    if (el.id === ID_CLUSTER) return input;
    if (el.id !== ID_INFO) { p = dataEnd; continue; }
    // Infoの中身：TimecodeScaleとDurationを探す
    let scale = 1_000_000, durPos = -1, durLen = 0, q = dataStart;
    while (q < dataEnd) {
      const c = readId(u, q);
      if (!c) return input;
      const cs = readSize(u, q + c.len);
      if (!cs || cs.unknown) return input;
      const cd = q + c.len + cs.len;
      if (c.id === ID_TIMECODE_SCALE && cs.size >= 1 && cs.size <= 8) scale = readUint(u, cd, cs.size) || scale;
      if (c.id === ID_DURATION) { durPos = cd; durLen = cs.size; }
      q = cd + cs.size;
    }
    const value = (durationMs * 1_000_000) / scale;
    if (durPos >= 0 && (durLen === 4 || durLen === 8)) {
      const out = u.slice();
      const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
      if (durLen === 8) dv.setFloat64(durPos, value); else dv.setFloat32(durPos, value);
      return out;
    }
    // Duration（ID 44 89・サイズ8・float64）を足したInfoを作り直す。サイズ欄は8バイト固定で書く
    const durEl = new Uint8Array(11);
    durEl[0] = 0x44; durEl[1] = 0x89; durEl[2] = 0x88;
    new DataView(durEl.buffer).setFloat64(3, value);
    const body = es.size + durEl.length;
    const infoHead = new Uint8Array(4 + 8);
    infoHead.set([0x15, 0x49, 0xa9, 0x66]);
    infoHead[4] = 0x01;
    let rest = body;
    for (let i = 11; i >= 5; i--) { infoHead[i] = rest % 256; rest = Math.floor(rest / 256); }
    const out = new Uint8Array(p + infoHead.length + body + (u.length - dataEnd));
    out.set(u.subarray(0, p), 0);
    out.set(infoHead, p);
    out.set(u.subarray(dataStart, dataEnd), p + infoHead.length);
    out.set(durEl, p + infoHead.length + es.size);
    out.set(u.subarray(dataEnd), p + infoHead.length + body);
    return out;
  }
  return input;
}
