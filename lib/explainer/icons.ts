// 自作のフラットなアイコン（Canvas描画）。100×100の座標で描き、指定の大きさに拡大縮小する。
// 実在の人物・企業ロゴ・既存キャラクターは描かず、誰でも使える汎用的な形だけで構成する（著作権・肖像権への配慮）。
import type { IconName } from './types';

type Ctx = CanvasRenderingContext2D;

const W = '#ffffff';
const D = '#0b1222';

function rr(c: Ctx, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
}
const circ = (c: Ctx, x: number, y: number, r: number) => { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); };
const poly = (c: Ctx, pts: number[]) => { c.beginPath(); c.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]); c.closePath(); };
const fill = (c: Ctx, col: string) => { c.fillStyle = col; c.fill(); };
const stroke = (c: Ctx, col: string, w: number) => { c.strokeStyle = col; c.lineWidth = w; c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke(); };
const line = (c: Ctx, pts: number[], col: string, w: number) => { c.beginPath(); c.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]); stroke(c, col, w); };
const txt = (c: Ctx, s: string, x: number, y: number, size: number, col: string) => { c.fillStyle = col; c.font = `bold ${size}px "Segoe UI","Yu Gothic",sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(s, x, y); };

function person(c: Ctx, m: string, x = 50, s = 1) {
  const cy = 50 - 20 * s, top = 50 + 2 * s, bot = 50 + 38 * s, hw = 27 * s;
  circ(c, x, cy, 15 * s); fill(c, m);
  c.beginPath(); c.moveTo(x - hw, bot); c.quadraticCurveTo(x - hw, top, x, top); c.quadraticCurveTo(x + hw, top, x + hw, bot); c.closePath(); fill(c, m);
}

const DRAW: Record<IconName, (c: Ctx, m: string, t: number) => void> = {
  person: (c, m) => person(c, m),
  group: (c, m) => { c.globalAlpha *= 0.6; person(c, m, 27, 0.75); person(c, m, 73, 0.75); c.globalAlpha /= 0.6; person(c, m, 50, 0.95); },
  building: (c, m) => { rr(c, 24, 10, 52, 82, 4); fill(c, m); for (let r = 0; r < 5; r++) for (let k = 0; k < 3; k++) { rr(c, 32 + k * 14, 18 + r * 13, 8, 8, 1); fill(c, W); } rr(c, 43, 78, 14, 14, 1); fill(c, D); },
  factory: (c, m) => { poly(c, [10, 90, 10, 50, 32, 62, 32, 50, 54, 62, 54, 50, 76, 62, 76, 20, 90, 20, 90, 90]); fill(c, m); rr(c, 20, 72, 10, 10, 1); fill(c, W); rr(c, 42, 72, 10, 10, 1); fill(c, W); rr(c, 64, 72, 10, 10, 1); fill(c, W); circ(c, 86, 10, 5); fill(c, 'rgba(255,255,255,0.5)'); },
  bank: (c, m) => { poly(c, [50, 8, 92, 32, 8, 32]); fill(c, m); for (let k = 0; k < 4; k++) { rr(c, 17 + k * 19, 38, 9, 40, 2); fill(c, m); } rr(c, 8, 82, 84, 10, 2); fill(c, m); circ(c, 50, 22, 5); fill(c, W); },
  government: (c, m) => { rr(c, 14, 50, 72, 40, 3); fill(c, m); c.beginPath(); c.arc(50, 50, 24, Math.PI, 0); fill(c, m); rr(c, 47, 10, 6, 18, 2); fill(c, m); for (let k = 0; k < 4; k++) { rr(c, 22 + k * 16, 58, 8, 26, 2); fill(c, W); } },
  house: (c, m) => { poly(c, [50, 10, 92, 46, 82, 46, 82, 90, 18, 90, 18, 46, 8, 46]); fill(c, m); rr(c, 42, 60, 16, 30, 2); fill(c, W); rr(c, 24, 54, 12, 12, 2); fill(c, W); },
  store: (c, m) => { rr(c, 14, 40, 72, 50, 3); fill(c, m); for (let k = 0; k < 5; k++) { c.beginPath(); c.moveTo(10 + k * 16, 20); c.lineTo(26 + k * 16, 20); c.lineTo(26 + k * 16, 36); c.arc(18 + k * 16, 36, 8, 0, Math.PI); fill(c, k % 2 ? W : m); } rr(c, 10, 14, 80, 8, 3); fill(c, m); rr(c, 24, 56, 22, 18, 2); fill(c, W); rr(c, 56, 56, 18, 34, 2); fill(c, D); },
  money: (c, m) => { rr(c, 8, 28, 84, 46, 6); fill(c, m); circ(c, 50, 51, 13); fill(c, W); txt(c, '¥', 50, 52, 18, m); circ(c, 20, 51, 4); fill(c, W); circ(c, 80, 51, 4); fill(c, W); },
  coin: (c, m) => { circ(c, 50, 54, 34); fill(c, m); circ(c, 50, 54, 26); stroke(c, W, 4); txt(c, '$', 50, 55, 30, W); },
  yen: (c, m) => { circ(c, 50, 50, 40); fill(c, m); txt(c, '¥', 50, 52, 50, W); },
  dollar: (c, m) => { circ(c, 50, 50, 40); fill(c, m); txt(c, '$', 50, 52, 50, W); },
  chartUp: (c, m, t) => { rr(c, 10, 10, 80, 80, 8); fill(c, 'rgba(255,255,255,0.08)'); const k = 0.5 + 0.5 * Math.min(1, t); [[20, 60], [38, 46], [54, 30], [72, 16]].forEach(([x, h], i) => { rr(c, x - 6, 84 - h * k - 6, 12, h * k + 6, 2); fill(c, i === 3 ? m : 'rgba(255,255,255,0.35)'); }); line(c, [16, 66, 38, 52, 54, 40, 82, 18], m, 5); poly(c, [84, 10, 86, 26, 72, 18]); fill(c, m); },
  chartDown: (c, m) => { rr(c, 10, 10, 80, 80, 8); fill(c, 'rgba(255,255,255,0.08)'); [[20, 54], [38, 40], [54, 28], [72, 14]].forEach(([x, h], i) => { rr(c, x - 6, 84 - h, 12, h, 2); fill(c, i === 3 ? m : 'rgba(255,255,255,0.35)'); }); line(c, [16, 22, 38, 40, 54, 50, 80, 72], m, 5); poly(c, [86, 80, 70, 78, 82, 66]); fill(c, m); },
  globe: (c, m, t) => { circ(c, 50, 50, 40); fill(c, m); c.save(); circ(c, 50, 50, 40); c.clip(); const o = (t * 12) % 40; for (const dx of [-40, 0, 40]) { c.beginPath(); c.ellipse(50 + dx + o - 20, 50, 16, 40, 0, 0, Math.PI * 2); stroke(c, 'rgba(255,255,255,0.65)', 3); } line(c, [10, 50, 90, 50], 'rgba(255,255,255,0.65)', 3); line(c, [16, 30, 84, 30], 'rgba(255,255,255,0.4)', 3); line(c, [16, 70, 84, 70], 'rgba(255,255,255,0.4)', 3); c.restore(); },
  ship: (c, m) => { poly(c, [8, 60, 92, 60, 80, 84, 20, 84]); fill(c, m); rr(c, 26, 40, 40, 20, 2); fill(c, m); rr(c, 32, 46, 8, 8, 1); fill(c, W); rr(c, 46, 46, 8, 8, 1); fill(c, W); rr(c, 52, 22, 8, 18, 1); fill(c, m); line(c, [6, 92, 22, 88, 38, 92, 54, 88, 70, 92, 94, 88], 'rgba(255,255,255,0.5)', 3); },
  plane: (c, m) => { c.save(); c.translate(50, 50); c.rotate(-0.6); rr(c, -40, -7, 80, 14, 7); fill(c, m); poly(c, [-6, -4, 10, -4, -10, -38, -20, -38]); fill(c, m); poly(c, [-6, 4, 10, 4, -10, 38, -20, 38]); fill(c, m); poly(c, [-34, -4, -26, -4, -34, -18, -40, -18]); fill(c, m); c.restore(); },
  truck: (c, m) => { rr(c, 6, 30, 56, 40, 3); fill(c, m); poly(c, [62, 40, 82, 40, 94, 56, 94, 70, 62, 70]); fill(c, m); poly(c, [68, 45, 80, 45, 87, 56, 68, 56]); fill(c, W); circ(c, 24, 74, 9); fill(c, D); circ(c, 24, 74, 4); fill(c, W); circ(c, 78, 74, 9); fill(c, D); circ(c, 78, 74, 4); fill(c, W); },
  car: (c, m) => { c.beginPath(); c.moveTo(8, 68); c.lineTo(8, 52); c.lineTo(26, 46); c.lineTo(38, 30); c.lineTo(68, 30); c.lineTo(80, 46); c.lineTo(92, 52); c.lineTo(92, 68); c.closePath(); fill(c, m); poly(c, [32, 46, 41, 35, 50, 35, 50, 46]); fill(c, W); poly(c, [55, 46, 55, 35, 66, 35, 74, 46]); fill(c, W); circ(c, 28, 70, 10); fill(c, D); circ(c, 72, 70, 10); fill(c, D); },
  oil: (c, m) => { rr(c, 24, 14, 52, 76, 8); fill(c, m); line(c, [24, 36, 76, 36], W, 4); line(c, [24, 68, 76, 68], W, 4); c.beginPath(); c.moveTo(50, 44); c.quadraticCurveTo(42, 54, 50, 60); c.quadraticCurveTo(58, 54, 50, 44); fill(c, D); },
  bolt: (c, m) => { poly(c, [58, 6, 20, 56, 46, 56, 38, 94, 80, 40, 54, 40]); fill(c, m); },
  chip: (c, m) => { for (let k = 0; k < 4; k++) { const p = 26 + k * 16; line(c, [p, 8, p, 92], m, 5); line(c, [8, p, 92, p], m, 5); } rr(c, 20, 20, 60, 60, 8); fill(c, m); rr(c, 32, 32, 36, 36, 4); fill(c, D); rr(c, 40, 40, 20, 20, 2); fill(c, W); },
  phone: (c, m) => { rr(c, 28, 6, 44, 88, 9); fill(c, m); rr(c, 33, 16, 34, 62, 3); fill(c, D); circ(c, 50, 86, 4); fill(c, W); rr(c, 37, 22, 26, 6, 2); fill(c, 'rgba(255,255,255,0.6)'); rr(c, 37, 32, 18, 6, 2); fill(c, 'rgba(255,255,255,0.4)'); },
  computer: (c, m) => { rr(c, 10, 14, 80, 54, 6); fill(c, m); rr(c, 16, 20, 68, 42, 3); fill(c, D); poly(c, [40, 68, 60, 68, 64, 84, 36, 84]); fill(c, m); rr(c, 28, 84, 44, 6, 3); fill(c, m); line(c, [24, 50, 38, 38, 50, 44, 72, 28], W, 4); },
  robot: (c, m, t) => { line(c, [50, 6, 50, 18], m, 4); circ(c, 50, 6, 5); fill(c, m); rr(c, 20, 18, 60, 46, 12); fill(c, m); const blink = (t % 3) < 0.12 ? 1 : 7; rr(c, 32, 36 - blink / 2, 12, blink, 3); fill(c, W); rr(c, 56, 36 - blink / 2, 12, blink, 3); fill(c, W); rr(c, 38, 52, 24, 4, 2); fill(c, D); rr(c, 28, 68, 44, 24, 8); fill(c, m); rr(c, 10, 30, 8, 22, 4); fill(c, m); rr(c, 82, 30, 8, 22, 4); fill(c, m); },
  shield: (c, m) => { c.beginPath(); c.moveTo(50, 6); c.lineTo(86, 20); c.quadraticCurveTo(86, 70, 50, 94); c.quadraticCurveTo(14, 70, 14, 20); c.closePath(); fill(c, m); line(c, [34, 50, 46, 62, 68, 38], W, 7); },
  lock: (c, m) => { c.beginPath(); c.arc(50, 40, 20, Math.PI, 0); stroke(c, m, 9); rr(c, 20, 40, 60, 50, 8); fill(c, m); circ(c, 50, 60, 7); fill(c, W); rr(c, 47, 60, 6, 16, 3); fill(c, W); },
  warning: (c, m) => { poly(c, [50, 8, 94, 88, 6, 88]); fill(c, m); rr(c, 45, 34, 10, 30, 4); fill(c, D); circ(c, 50, 74, 6); fill(c, D); },
  check: (c, m) => { circ(c, 50, 50, 42); fill(c, m); line(c, [28, 52, 44, 68, 74, 34], W, 10); },
  cross: (c, m) => { circ(c, 50, 50, 42); fill(c, m); line(c, [32, 32, 68, 68], W, 10); line(c, [68, 32, 32, 68], W, 10); },
  question: (c, m) => { circ(c, 50, 50, 42); fill(c, m); txt(c, '?', 50, 54, 58, W); },
  bulb: (c, m, t) => { const g = 0.5 + 0.5 * Math.sin(t * 3); circ(c, 50, 40, 30 + g * 3); fill(c, 'rgba(255,230,120,0.18)'); circ(c, 50, 40, 26); fill(c, m); rr(c, 38, 62, 24, 14, 3); fill(c, m); rr(c, 40, 78, 20, 6, 3); fill(c, 'rgba(255,255,255,0.7)'); rr(c, 43, 86, 14, 6, 3); fill(c, 'rgba(255,255,255,0.7)'); line(c, [42, 44, 50, 54, 58, 44], W, 4); },
  document: (c, m) => { poly(c, [18, 6, 64, 6, 82, 24, 82, 94, 18, 94]); fill(c, m); poly(c, [64, 6, 64, 24, 82, 24]); fill(c, 'rgba(255,255,255,0.5)'); for (let k = 0; k < 5; k++) { rr(c, 28, 36 + k * 11, k === 4 ? 26 : 44, 5, 2); fill(c, W); } },
  calendar: (c, m) => { rr(c, 10, 16, 80, 76, 8); fill(c, m); rr(c, 10, 16, 80, 20, 8); fill(c, D); rr(c, 26, 8, 8, 16, 3); fill(c, m); rr(c, 66, 8, 8, 16, 3); fill(c, m); for (let r = 0; r < 3; r++) for (let k = 0; k < 4; k++) { rr(c, 18 + k * 17, 44 + r * 15, 11, 10, 2); fill(c, r === 1 && k === 2 ? D : W); } },
  clock: (c, m, t) => { circ(c, 50, 50, 42); fill(c, m); circ(c, 50, 50, 34); fill(c, W); const a = t * 1.2 - Math.PI / 2; line(c, [50, 50, 50 + Math.cos(a) * 26, 50 + Math.sin(a) * 26], D, 4); line(c, [50, 50, 50 + Math.cos(a / 12 + 1) * 18, 50 + Math.sin(a / 12 + 1) * 18], D, 6); circ(c, 50, 50, 4); fill(c, m); },
  scale: (c, m, t) => { const tilt = Math.sin(t * 1.5) * 0.12; rr(c, 47, 14, 6, 70, 3); fill(c, m); rr(c, 30, 84, 40, 8, 3); fill(c, m); c.save(); c.translate(50, 22); c.rotate(tilt); line(c, [-38, 0, 38, 0], m, 5); [-34, 34].forEach((x) => { line(c, [x, 0, x - 10, 26], m, 2); line(c, [x, 0, x + 10, 26], m, 2); c.beginPath(); c.arc(x, 26, 13, 0, Math.PI); fill(c, m); }); c.restore(); },
  handshake: (c, m) => { poly(c, [4, 40, 26, 34, 50, 50, 36, 70, 4, 62]); fill(c, m); poly(c, [96, 40, 74, 34, 46, 42, 34, 54, 46, 58, 60, 50, 74, 68, 96, 62]); fill(c, 'rgba(255,255,255,0.85)'); [40, 50, 60].forEach((x) => { circ(c, x, 64 + (x - 40) * 0.1, 6); fill(c, m); }); },
  leaf: (c, m) => { c.beginPath(); c.moveTo(16, 86); c.quadraticCurveTo(10, 20, 86, 14); c.quadraticCurveTo(86, 84, 16, 86); fill(c, m); line(c, [16, 86, 68, 32], W, 4); line(c, [40, 62, 40, 42], W, 3); line(c, [54, 48, 66, 50], W, 3); },
  fire: (c, m, t) => { const f = Math.sin(t * 8) * 3; c.beginPath(); c.moveTo(50, 6 + f); c.quadraticCurveTo(86, 44, 76, 70); c.quadraticCurveTo(66, 94, 50, 94); c.quadraticCurveTo(34, 94, 24, 70); c.quadraticCurveTo(18, 48, 36, 30); c.quadraticCurveTo(38, 48, 46, 50); c.quadraticCurveTo(40, 26, 50, 6 + f); fill(c, m); c.beginPath(); c.moveTo(50, 50); c.quadraticCurveTo(66, 66, 60, 80); c.quadraticCurveTo(50, 92, 40, 80); c.quadraticCurveTo(36, 66, 50, 50); fill(c, 'rgba(255,240,180,0.9)'); },
  water: (c, m) => { c.beginPath(); c.moveTo(50, 6); c.quadraticCurveTo(84, 50, 80, 64); c.arc(50, 62, 30, 0.07, Math.PI - 0.07); c.quadraticCurveTo(16, 50, 50, 6); fill(c, m); c.beginPath(); c.arc(40, 64, 12, Math.PI * 0.6, Math.PI * 1.1); stroke(c, W, 4); },
  medical: (c, m) => { rr(c, 10, 10, 80, 80, 14); fill(c, m); rr(c, 40, 22, 20, 56, 4); fill(c, W); rr(c, 22, 40, 56, 20, 4); fill(c, W); },
  food: (c, m) => { c.beginPath(); c.arc(50, 50, 38, 0, Math.PI); fill(c, m); rr(c, 8, 46, 84, 8, 4); fill(c, m); circ(c, 36, 40, 8); fill(c, 'rgba(255,255,255,0.8)'); circ(c, 52, 34, 9); fill(c, 'rgba(255,255,255,0.6)'); circ(c, 66, 40, 7); fill(c, 'rgba(255,255,255,0.8)'); line(c, [40, 22, 44, 12], W, 3); line(c, [56, 18, 58, 8], W, 3); },
  target: (c, m, t) => { circ(c, 50, 50, 42); fill(c, m); circ(c, 50, 50, 30); fill(c, W); circ(c, 50, 50, 18); fill(c, m); circ(c, 50, 50, 7); fill(c, W); const k = Math.min(1, t * 1.5); line(c, [94 - 44 * k + 22, 6 + 44 * k - 22, 50 + (1 - k) * 44, 50 - (1 - k) * 44], D, 5); },
  rocket: (c, m, t) => { const f = 6 + Math.sin(t * 20) * 3; c.save(); c.translate(50, 50); c.rotate(0.7); c.beginPath(); c.moveTo(0, -44); c.quadraticCurveTo(20, -20, 14, 22); c.lineTo(-14, 22); c.quadraticCurveTo(-20, -20, 0, -44); fill(c, m); circ(c, 0, -12, 8); fill(c, W); poly(c, [-14, 6, -26, 30, -14, 22]); fill(c, m); poly(c, [14, 6, 26, 30, 14, 22]); fill(c, m); poly(c, [-8, 24, 8, 24, 0, 24 + f * 3]); fill(c, 'rgba(255,190,80,0.95)'); c.restore(); },
  search: (c, m) => { circ(c, 42, 42, 28); stroke(c, m, 10); circ(c, 42, 42, 20); fill(c, 'rgba(255,255,255,0.18)'); line(c, [62, 62, 88, 88], m, 13); },
  megaphone: (c, m, t) => { poly(c, [14, 40, 30, 40, 74, 16, 74, 84, 30, 60, 14, 60]); fill(c, m); rr(c, 28, 58, 12, 26, 4); fill(c, m); const w = (t * 2) % 1; c.globalAlpha *= 1 - w; c.beginPath(); c.arc(78, 50, 10 + w * 16, -0.8, 0.8); stroke(c, m, 4); c.globalAlpha /= Math.max(0.001, 1 - w); },
  battery: (c, m, t) => { rr(c, 8, 28, 76, 44, 8); stroke(c, m, 6); rr(c, 86, 40, 8, 20, 3); fill(c, m); const k = 0.25 + 0.75 * ((t * 0.4) % 1); rr(c, 15, 35, 62 * k, 30, 4); fill(c, m); },
  arrowUp: (c, m) => { poly(c, [50, 6, 88, 48, 64, 48, 64, 94, 36, 94, 36, 48, 12, 48]); fill(c, m); },
  arrowDown: (c, m) => { poly(c, [50, 94, 88, 52, 64, 52, 64, 6, 36, 6, 36, 52, 12, 52]); fill(c, m); },
  flag: (c, m, t) => { rr(c, 16, 6, 6, 88, 3); fill(c, m); const w = Math.sin(t * 4) * 4; c.beginPath(); c.moveTo(22, 10); c.quadraticCurveTo(48, 2 + w, 84, 12); c.lineTo(84, 52); c.quadraticCurveTo(48, 42 - w, 22, 50); c.closePath(); fill(c, m); },
  star: (c, m) => { const p: number[] = []; for (let i = 0; i < 10; i++) { const r = i % 2 ? 18 : 42, a = -Math.PI / 2 + (i * Math.PI) / 5; p.push(50 + Math.cos(a) * r, 54 + Math.sin(a) * r); } poly(c, p); fill(c, m); },
  heart: (c, m, t) => { const s = 1 + Math.max(0, Math.sin(t * 5)) * 0.05; c.save(); c.translate(50, 52); c.scale(s, s); c.beginPath(); c.moveTo(0, 36); c.bezierCurveTo(-50, 4, -34, -40, 0, -16); c.bezierCurveTo(34, -40, 50, 4, 0, 36); fill(c, m); c.restore(); },
  school: (c, m) => { poly(c, [50, 10, 94, 32, 50, 54, 6, 32]); fill(c, m); c.beginPath(); c.moveTo(24, 44); c.lineTo(24, 66); c.quadraticCurveTo(50, 84, 76, 66); c.lineTo(76, 44); c.lineTo(50, 58); c.closePath(); fill(c, m); line(c, [86, 36, 86, 64], m, 4); circ(c, 86, 68, 5); fill(c, m); },
  news: (c, m) => { rr(c, 8, 14, 84, 72, 6); fill(c, m); rr(c, 16, 22, 68, 14, 3); fill(c, W); rr(c, 16, 44, 30, 32, 3); fill(c, 'rgba(255,255,255,0.55)'); for (let k = 0; k < 4; k++) { rr(c, 52, 44 + k * 9, 32, 4, 2); fill(c, W); } },
};

/**
 * アイコンを (cx, cy) を中心に size の大きさで描く。rgb は "r,g,b" 形式の主色。t は経過秒（小さな動き用）。
 */
export function drawIcon(c: Ctx, name: IconName | string, cx: number, cy: number, size: number, rgb: string, t = 0, alpha = 1): void {
  const fn = (DRAW as Record<string, (c: Ctx, m: string, t: number) => void>)[name] ?? DRAW.bulb;
  c.save();
  c.globalAlpha *= alpha;
  c.translate(cx - size / 2, cy - size / 2);
  c.scale(size / 100, size / 100);
  fn(c, `rgb(${rgb})`, t);
  c.restore();
}
