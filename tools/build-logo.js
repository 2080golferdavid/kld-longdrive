#!/usr/bin/env node
/*
 * KLD 로고 → 8비트 픽셀 로고 생성기 (의존성 없음, Node 내장 zlib만 사용)
 *
 *   node tools/build-logo.js                  게임용 데이터(js/logo-data.js)와 아이콘·미리보기 생성
 *   node tools/build-logo.js --explore <폴더>  여러 크기를 시험 출력 (보정용)
 *
 * 원본: assets/logo/kld-logo-dark.png (검은 글자 버전). 흰 글자 버전은 모양이 같고 색만 달라서
 *       여기서는 "모양"만 뽑고, 색은 게임에서 팔레트로 입힌다.
 *
 * 방식
 *   0. 원본에서 배치를 찾는다: 투명한 가로 띠로 나뉜 세 덩어리(스우시·공 / KLD / 부제)와 공 안쪽 영역
 *   1. 각 픽셀을 빨강(스우시·공) / 글자 채움 / 글자 테두리 / 공 안쪽(빨강에 갇힌 투명 영역)으로 분류
 *   2. 면적 평균으로 축소해 대상 픽셀마다 각 요소가 차지하는 비율을 구한다
 *   3. 글자와 공은 임계값으로 1비트화. 공은 윤곽을 닫고 흰 바탕에 딤플 점을 찍는다
 *   4. 스우시는 열마다 빨강의 양과 무게중심으로 다시 그린다 (가는 꼬리가 끊기거나 떨리지 않게)
 *   5. 96px 이상은 글자 안쪽에 1픽셀 테두리를 다시 그린다. 부제는 채움만으로 판정한다
 *   크기 목록과 손으로 찍은 mark32 는 tools/logo-sprites.json 에 있다.
 *   결과가 원본·데이터와 맞는지, 폭 40~320 에서 모양이 깨지지 않는지는 node tests/logo.test.js 로 확인한다.
 *   색(COLORS)은 원본에서 뽑지 않고 아래에 적어 둔 값을 쓴다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'logo', 'kld-logo-dark.png');

const COLORS = {
  red: '#e60012',
  light: { r: '#e60012', f: '#fefefe', e: '#727171', w: '#ffffff' },   // 어두운 배경용 (흰 글자)
  dark: { r: '#e60012', f: '#000000', e: '#9fa0a0', w: '#ffffff' }     // 밝은 배경용 (검은 글자)
};

// ── PNG 읽기/쓰기 ────────────────────────────────────────────
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function decodePNG(buf) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) throw new Error('PNG 파일이 아닙니다');
  let pos = 8, ihdr = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      ihdr = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] };
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (!ihdr) throw new Error('IHDR 없음');
  if (ihdr.depth !== 8 || (ihdr.color !== 6 && ihdr.color !== 2) || ihdr.interlace) {
    throw new Error('지원하지 않는 PNG 형식입니다 (8비트 RGB/RGBA, 비인터레이스만 지원). 색 형식=' + ihdr.color + ' 깊이=' + ihdr.depth);
  }
  const bpp = ihdr.color === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = ihdr.w * bpp;
  const out = new Uint8Array(ihdr.w * ihdr.h * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < ihdr.h; y++) {
    const f = raw[y * (stride + 1)];
    const off = y * (stride + 1) + 1;
    const cur = new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = raw[off + i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[i] = v & 255;
    }
    for (let x = 0; x < ihdr.w; x++) {
      const o = (y * ihdr.w + x) * 4;
      out[o] = cur[x * bpp];
      out[o + 1] = cur[x * bpp + 1];
      out[o + 2] = cur[x * bpp + 2];
      out[o + 3] = bpp === 4 ? cur[x * bpp + 3] : 255;
    }
    prev = cur;
  }
  return { w: ihdr.w, h: ihdr.h, data: out };
}

function encodePNG(w, h, rgba) {
  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ── 원본 분석 ───────────────────────────────────────────────
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

/*
 * 로고의 배치를 원본에서 직접 읽는다. 지금 로고는 투명한 가로 띠로 나뉜 세 덩어리다:
 *   위: 스우시와 공 / 가운데: KLD 글자 / 아래: 부제(KOREA LONG DRIVE)
 * 행 번호를 고정하지 않으므로, 같은 구성이면 해상도가 달라져도 그대로 동작한다.
 */
function analyze(img) {
  if (img.layout) return img.layout;
  const w = img.w, h = img.h, d = img.data;
  const segs = [];
  let start = -1;
  for (let y = 0; y <= h; y++) {
    let any = false;
    if (y < h) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] >= 128) { any = true; break; }
    if (any && start < 0) start = y;
    if (!any && start >= 0) { segs.push([start, y]); start = -1; }
  }
  if (segs.length !== 3) {
    throw new Error('로고 구성이 예상과 다릅니다: 투명한 가로 띠로 나뉜 덩어리가 ' + segs.length + '개입니다 (스우시·공 / 글자 / 부제, 3개여야 함)');
  }
  img.layout = {
    swoosh: segs[0], letters: segs[1], sub: segs[2],     // 각각 [시작 행, 끝 행 + 1]
    ballMargin: Math.round(w * 0.02),                    // 공 안쪽 범위에서 빨간 타원 바깥선까지의 여유
    cropMargin: Math.round(h * 0.01)                     // mark 를 자를 때 글자 아래에 남기는 여유
  };
  findBallInterior(img);
  if (!img.ballBox) throw new Error('공(빨강으로 둘러싸인 투명 영역)을 찾지 못했습니다');
  return img.layout;
}

/*
 * 공 안쪽 찾기: 스우시 띠에서 바깥과 이어지지 않은 투명 픽셀(= 빨간 타원에 갇힌 영역).
 * 원본에서는 이 부분이 뚫려 있어 배경색이 비친다. 픽셀 버전에서는 골프공답게 흰색으로 칠할 수 있도록 따로 표시한다.
 */
function findBallInterior(img) {
  const L = img.layout || analyze(img);
  const w = img.w, h = Math.min(img.h, L.letters[0], L.swoosh[1] + 4), d = img.data;
  const open = new Uint8Array(w * h);          // 1 = 투명
  for (let i = 0; i < w * h; i++) open[i] = d[i * 4 + 3] < 128 ? 1 : 0;
  const seen = new Uint8Array(w * h);
  const stack = [];
  function push(x, y) {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const k = y * w + x;
    if (!open[k] || seen[k]) return;
    seen[k] = 1;
    stack.push(k);
  }
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) {
    const k = stack.pop(), x = k % w, y = (k / w) | 0;
    push(x - 1, y); push(x + 1, y); push(x, y - 1); push(x, y + 1);
  }
  const inside = new Uint8Array(img.w * img.h);
  let n = 0, x0 = w, x1 = 0, y0 = h, y1 = 0;
  for (let k = 0; k < w * h; k++) {
    if (open[k] && !seen[k]) {
      inside[k] = 1; n++;
      const x = k % w, y = (k / w) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  img.ballInside = inside;
  img.ballBox = n ? [x0, y0, x1, y1] : null;
  return { count: n, box: [x0, y0, x1, y1] };
}

// ── 분류 + 면적 평균 축소 ────────────────────────────────────
/*
 * 원본의 y0~y1 행을 폭 dstW 로 줄이면서, 대상 픽셀마다 빨강/채움/테두리/공 안쪽이 차지하는 면적 비율을 구한다.
 * y0 가 음수면 그만큼 위에 빈 여백을 둔다.
 */
function coverage(img, y0, y1, dstW) {
  const srcW = img.w, d = img.data;
  const s = dstW / srcW;
  const dstH = Math.max(1, Math.ceil((y1 - y0) * s - 1e-9));
  const red = new Float32Array(dstW * dstH);
  const fill = new Float32Array(dstW * dstH);
  const edge = new Float32Array(dstW * dstH);
  const ball = new Float32Array(dstW * dstH);
  const inside = img.ballInside;
  for (let y = Math.max(0, y0); y < y1; y++) {
    const ty0 = (y - y0) * s, ty1 = ty0 + s;
    const jy0 = Math.floor(ty0), jy1 = Math.min(dstH - 1, Math.floor(ty1 - 1e-9));
    for (let x = 0; x < srcW; x++) {
      const i = (y * srcW + x) * 4;
      const a = d[i + 3] / 255;
      const wb = inside && inside[y * srcW + x] ? 1 - a : 0;   // 공 안쪽
      if (a === 0 && wb === 0) continue;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      let wr = 0, wf = 0, we = 0;
      if (a === 0) { /* 공 안쪽의 완전 투명 픽셀 */ }
      else if (r - Math.max(g, b) > 70) wr = a;            // 빨강
      else {
        const lum = (r + g + b) / 3;                        // 검정(채움) ↔ 회색(테두리)
        const f = clamp((150 - lum) / 110, 0, 1);
        wf = a * f;
        we = a * (1 - f);
      }
      const tx0 = x * s, tx1 = tx0 + s;
      const ix0 = Math.floor(tx0), ix1 = Math.min(dstW - 1, Math.floor(tx1 - 1e-9));
      for (let jy = jy0; jy <= jy1; jy++) {
        const oy = Math.min(ty1, jy + 1) - Math.max(ty0, jy);
        for (let ix = ix0; ix <= ix1; ix++) {
          const ox = Math.min(tx1, ix + 1) - Math.max(tx0, ix);
          const k = jy * dstW + ix, wgt = ox * oy;
          red[k] += wr * wgt;
          fill[k] += wf * wgt;
          edge[k] += we * wgt;
          ball[k] += wb * wgt;
        }
      }
    }
  }
  return { w: dstW, h: dstH, s: s, red: red, fill: fill, edge: edge, ball: ball };
}

// 인덱스: 0 투명, 1 빨강, 2 글자 채움, 3 글자 테두리, 4 공 안쪽
const T = 0, R = 1, F = 2, E = 3, W = 4;

/*
 * spec = { kind: 'mark' | 'full', width, outline: 'inner' | 'none' }
 * 선택 값: redT(공 테두리 임계값), letterT, subT, ballT, tailT, dimples(false 면 공 무늬 없음), despur
 */
function buildSprite(img, spec) {
  const L = analyze(img);
  const withSub = spec.kind === 'full';
  const s0 = spec.width / img.w;
  const padSrc = Math.ceil(1 / s0);                 // 위쪽에 대상 픽셀 한 줄만큼 여백 (공 윗선이 들어갈 자리)
  const y1 = withSub ? img.h : Math.min(img.h, L.letters[1] + L.cropMargin);
  const cov = coverage(img, -padSrc, y1, spec.width);
  const w = cov.w, h = cov.h, s = cov.s;
  const map = new Uint8Array(w * h);
  const redT = spec.redT != null ? spec.redT : 0.45;
  const letterT = spec.letterT != null ? spec.letterT : 0.5;
  const subT = spec.subT != null ? spec.subT : 0.5;
  const ballT = spec.ballT != null ? spec.ballT : 0.4;
  const tailT = spec.tailT != null ? spec.tailT : 0.05;      // 스우시의 가는 꼬리 끝을 어디까지 살릴지
  const row = function (srcY) { return (srcY + padSrc) * s; };                 // 원본 행 → 대상 행(실수)
  const subRow0 = withSub ? Math.floor(row(L.sub[0])) : h;
  const bandRows = Math.min(h, Math.ceil(row(L.swoosh[1])) + 1);              // 스우시·공이 있을 수 있는 행 (한 줄 여유 포함)
  const letterRow0 = Math.floor(row(L.letters[0]));                            // 글자가 시작하는 행. 폭에 따라 bandRows - 1 과 같을 수 있다

  // 공이 있는 열 범위 (빨간 타원 바깥선까지 포함)
  const box = img.ballBox;
  const bx0 = Math.max(0, Math.floor((box[0] - L.ballMargin) * s)), bx1 = Math.min(w - 1, Math.ceil((box[2] + L.ballMargin) * s));

  // 1) 글자와 공
  for (let k = 0; k < w * h; k++) {
    const x = k % w, y = (k / w) | 0;
    if (y < bandRows) {
      if (x >= bx0 && x <= bx1) {
        if (cov.ball[k] >= ballT) map[k] = W;
        else if (cov.red[k] >= redT) map[k] = R;
      }
      // 띠의 여유 행이 글자의 첫 행과 겹치는 폭이 있다 → 그 행에서는 글자 판정도 해야 글자 윗줄이 잘리지 않는다
      if (y < letterRow0 || map[k] !== T) continue;
    }
    // 부제는 획이 가늘어서 테두리까지 합치면 글자 속이 메워진다 → 채움만 본다
    if (y >= subRow0) { if (cov.fill[k] >= subT) map[k] = F; }
    else if (cov.fill[k] + cov.edge[k] >= letterT) map[k] = F;
  }

  // 2) 공 다듬기
  const isBall = function (x, y) { return x >= 0 && y >= 0 && x < w && y < bandRows && map[y * w + x] === W; };
  //  2-1) 공 안에 외따로 찍힌 빨강(원본 딤플의 찌꺼기)은 지우고, 규칙적인 점무늬로 다시 표현한다
  for (let y = 0; y < bandRows; y++) {
    for (let x = bx0; x <= bx1; x++) {
      if (map[y * w + x] !== R) continue;
      const n = (isBall(x - 1, y) ? 1 : 0) + (isBall(x + 1, y) ? 1 : 0) + (isBall(x, y - 1) ? 1 : 0) + (isBall(x, y + 1) ? 1 : 0);
      if (n >= 3) map[y * w + x] = W;
    }
  }
  //  2-1b) 공 아랫부분은 원본에서 물결 모양이라 축소하면 흰 조각이 흩어진다 →
  //         가장 넓은 행보다 아래에서, 최대 폭의 절반이 안 되는 흰 줄은 빨강으로 메운다
  {
    const runs = [];                                   // { y, x0, len }
    let maxLen = 0, widestY = -1;
    for (let y = 0; y < bandRows; y++) {
      let x = bx0;
      while (x <= bx1) {
        if (map[y * w + x] !== W) { x++; continue; }
        let n = 0;
        while (x + n <= bx1 && map[y * w + x + n] === W) n++;
        runs.push({ y: y, x0: x, len: n });
        if (n > maxLen) { maxLen = n; widestY = y; }
        x += n;
      }
    }
    runs.forEach(function (r) {
      if (r.y > widestY && r.len < maxLen * 0.5) for (let i = 0; i < r.len; i++) map[r.y * w + r.x0 + i] = R;
    });
  }
  //  2-2) 딤플: 사방이 흰 칸에만 엇갈린 점 (공이 작으면 해당 칸이 없어 자연히 생략된다)
  if (spec.dimples !== false) {
    const dots = [];
    for (let y = 0; y < bandRows; y++) {
      for (let x = bx0; x <= bx1; x++) {
        if (!isBall(x, y)) continue;
        if (!isBall(x - 1, y) || !isBall(x + 1, y) || !isBall(x, y - 1) || !isBall(x, y + 1)) continue;
        if ((x + (y % 2) * 2) % 4 === 0) dots.push(y * w + x);
      }
    }
    dots.forEach(function (k) { map[k] = R; });
  }
  //  2-3) 윤곽 닫기: 흰 칸이 바깥과 맞닿으면 그 자리를 빨강으로 (가는 윗선이 축소 과정에서 사라지는 것 보정)
  let hasBall = false;
  {
    const rim = [];
    for (let y = 0; y < bandRows; y++) {
      for (let x = 0; x < w; x++) {
        if (map[y * w + x] === W) { hasBall = true; continue; }
        if (map[y * w + x] !== T) continue;
        if (isBall(x - 1, y) || isBall(x + 1, y) || isBall(x, y - 1) || isBall(x, y + 1)) rim.push(y * w + x);
      }
    }
    rim.forEach(function (k) { map[k] = R; });
  }

  // 3) 스우시: 단순 임계값으로는 가는 꼬리가 끊기거나 두께가 들쭉날쭉해지므로 열마다 다시 그린다.
  //    - 공 바깥 열: 빨강의 "양"(= 두께)과 "무게중심"을 구해 그 자리에 그 두께로 찍는다.
  //    - 공이 있는 열: 스우시 윗선이 공 밑동과 붙어 있어 양을 따로 잴 수 없다 → 두께는 공 양옆 값을 이어 받고,
  //      밑선(그 열에서 가장 아래에 있는 빨강의 경계)만 직접 잰다. 타원 밑동은 1)에서 임계값으로 이미 찍혔으므로
  //      타원과 스우시 사이의 빈틈(원본에서 투명한 부분)은 그대로 남는다.
  //    - 줄이 바뀌는 것은 값이 확실히 움직였을 때만 허용해서(히스테리시스) 계단이 떨리지 않게 한다.
  {
    const mass = new Float32Array(w), cen = new Float32Array(w), bot = new Float32Array(w);
    for (let x = 0; x < w; x++) {
      let m = 0, c = 0, last = -1;
      for (let y = 0; y < bandRows; y++) {
        const v = cov.red[y * w + x];
        m += v;
        c += v * (y + 0.5);
        if (v > 0.02) last = y;
      }
      mass[x] = m;
      cen[x] = m > 0 ? c / m : 0;
      bot[x] = last >= 0 ? last + Math.min(1, cov.red[last * w + x]) : -1;
    }
    const mL = bx0 > 0 ? mass[bx0 - 1] : (bx1 + 1 < w ? mass[bx1 + 1] : 1);
    const mR = bx1 + 1 < w ? mass[bx1 + 1] : mL;
    let curBottom = null, curT = null;
    for (let x = 0; x < w; x++) {
      const inBall = hasBall && x >= bx0 && x <= bx1;
      let m;
      if (inBall) {
        if (bot[x] < 0) { curBottom = null; curT = null; continue; }
        m = mL + (mR - mL) * ((x - bx0 + 1) / (bx1 - bx0 + 2));
      } else {
        m = mass[x];
        if (m < tailT) { curBottom = null; curT = null; continue; }
      }
      let t = Math.max(1, Math.round(m));
      if (curT !== null && Math.abs(m - curT) < 0.62) t = curT;      // 두께도 확실히 변했을 때만 바꾼다
      curT = t;
      const want = inBall ? bot[x] : cen[x] + t / 2;                  // 아래쪽 모서리 기준 (밑선이 매끈하게)
      if (curBottom === null || Math.abs(want - curBottom) > 0.62) curBottom = Math.round(want);
      const top = clamp(curBottom - t, 0, bandRows - t);
      for (let y = top; y < top + t; y++) if (map[y * w + x] === T) map[y * w + x] = R;
    }
  }

  // 3-1) 스우시 혹 제거: 좌우가 비어 있는데 바로 위나 아래에 긴 빨간 줄이 붙어 있는 한 칸짜리 점
  {
    const isR = function (x, y) { return x >= 0 && y >= 0 && x < w && y < bandRows && map[y * w + x] === R; };
    const runLen = function (x, y) {
      if (!isR(x, y)) return 0;
      let a = x, b = x;
      while (isR(a - 1, y)) a--;
      while (isR(b + 1, y)) b++;
      return b - a + 1;
    };
    const kill = [];
    for (let y = 0; y < bandRows; y++) {
      for (let x = 0; x < w; x++) {
        if (!isR(x, y) || isR(x - 1, y) || isR(x + 1, y)) continue;
        if (isBall(x - 1, y) || isBall(x + 1, y) || isBall(x, y - 1) || isBall(x, y + 1)) continue;   // 공 테두리는 건드리지 않는다
        if (runLen(x, y - 1) >= 3 || runLen(x, y + 1) >= 3) kill.push(y * w + x);
      }
    }
    kill.forEach(function (k) { map[k] = T; });
  }

  // 3-2) 밑선 다듬기: 열마다 빨강의 가장 아래 행을 구해 5칸 중앙값으로 고른다 (1~2칸짜리 패임·혹 제거, 계단은 유지)
  {
    const bottom = new Int32Array(w).fill(-1);
    for (let x = 0; x < w; x++) {
      for (let y = bandRows - 1; y >= 0; y--) if (map[y * w + x] === R) { bottom[x] = y; break; }
    }
    for (let x = 0; x < w; x++) {
      if (bottom[x] < 0) continue;
      const win = [];
      for (let d = -2; d <= 2; d++) {
        const xx = x + d;
        if (xx >= 0 && xx < w && bottom[xx] >= 0) win.push(bottom[xx]);
      }
      win.sort(function (a, b) { return a - b; });
      const target = win[(win.length - 1) >> 1];
      if (target === bottom[x]) continue;
      if (target < bottom[x]) {
        // 튀어나온 부분 깎기 (단, 그 열의 빨강이 전부 사라지면 안 된다)
        let above = false;
        for (let y = target; y >= 0; y--) if (map[y * w + x] === R) { above = true; break; }
        if (above) for (let y = target + 1; y <= bottom[x]; y++) if (map[y * w + x] === R) map[y * w + x] = T;
      } else {
        for (let y = bottom[x] + 1; y <= target; y++) if (map[y * w + x] === T) map[y * w + x] = R;
      }
    }
  }

  // 4) 글자 정리: 한 칸짜리 뾰족한 돌기 제거
  function isLetter(x, y) {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    const v = map[y * w + x];
    return v === F || v === E;
  }
  const letterRows = Math.min(h, subRow0);
  if (spec.despur !== false) {
    const kill = [];
    for (let y = letterRow0; y < letterRows; y++) {
      for (let x = 0; x < w; x++) {
        if (map[y * w + x] !== F) continue;
        const n = (isLetter(x - 1, y) ? 1 : 0) + (isLetter(x + 1, y) ? 1 : 0) + (isLetter(x, y - 1) ? 1 : 0) + (isLetter(x, y + 1) ? 1 : 0);
        if (n <= 1) kill.push(y * w + x);
      }
    }
    kill.forEach(function (k) { map[k] = T; });
  }

  // 5) 글자 테두리 (부제 제외): 글자 몸통의 가장자리 1픽셀을 테두리 색으로.
  //    바깥쪽 테두리가 필요하면 생성 단계가 아니라 그릴 때 KLD.logo 의 outline 옵션을 쓴다.
  const out = new Uint8Array(map);
  if (spec.outline === 'inner') {
    for (let y = letterRow0; y < letterRows; y++) {
      for (let x = 0; x < w; x++) {
        if (map[y * w + x] !== F) continue;
        if (!isLetter(x - 1, y) || !isLetter(x + 1, y) || !isLetter(x, y - 1) || !isLetter(x, y + 1)) out[y * w + x] = E;
      }
    }
  } else if (spec.outline && spec.outline !== 'none') {
    throw new Error('알 수 없는 outline 값: ' + spec.outline + ' (inner 또는 none)');
  }
  return { w: w, h: h, map: out };
}

// 위아래 빈 줄 제거
function trim(sp) {
  const w = sp.w;
  let top = 0, bottom = sp.h - 1;
  function empty(y) { for (let x = 0; x < w; x++) if (sp.map[y * w + x] !== T) return false; return true; }
  while (top < bottom && empty(top)) top++;
  while (bottom > top && empty(bottom)) bottom--;
  const h = bottom - top + 1;
  return { w: w, h: h, map: sp.map.slice(top * w, (bottom + 1) * w) };
}

// ── 출력 도우미 ──────────────────────────────────────────────
function hex(c) {
  const n = parseInt(c.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function newImage(w, h, bg) {
  const d = new Uint8Array(w * h * 4);
  if (bg) {
    const c = hex(bg);
    for (let i = 0; i < w * h; i++) { d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255; }
  }
  return { w: w, h: h, data: d };
}
function fillRect(im, x, y, w, h, color) {
  const c = hex(color);
  for (let j = Math.max(0, y); j < Math.min(im.h, y + h); j++) {
    for (let i = Math.max(0, x); i < Math.min(im.w, x + w); i++) {
      const o = (j * im.w + i) * 4;
      im.data[o] = c[0]; im.data[o + 1] = c[1]; im.data[o + 2] = c[2]; im.data[o + 3] = 255;
    }
  }
}
function blit(im, sp, pal, x, y, k) {
  const cols = [null, pal.r, pal.f, pal.e, pal.w];
  for (let j = 0; j < sp.h; j++) {
    for (let i = 0; i < sp.w; i++) {
      const col = cols[sp.map[j * sp.w + i]];
      if (col) fillRect(im, x + i * k, y + j * k, k, k, col);
    }
  }
}
function savePNG(file, im) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, encodePNG(im.w, im.h, im.data));
}

// 행 단위 런 길이 압축: "12.3r5f" (개수 1은 생략, 줄 끝의 투명은 생략)
function rle(sp) {
  const ch = ['.', 'r', 'f', 'e', 'w'];
  const rows = [];
  for (let y = 0; y < sp.h; y++) {
    let row = '', x = 0;
    let end = sp.w;
    while (end > 0 && sp.map[y * sp.w + end - 1] === T) end--;
    while (x < end) {
      const v = sp.map[y * sp.w + x];
      let n = 1;
      while (x + n < end && sp.map[y * sp.w + x + n] === v) n++;
      row += (n > 1 ? n : '') + ch[v];
      x += n;
    }
    rows.push(row);
  }
  return rows.join('/');
}

// ── 게임에 넣을 크기 목록 ─────────────────────────────────────
const SPRITES = require('./logo-sprites.json');

// 손으로 찍은 스프라이트: 너무 작아서 자동 축소로는 글자가 뭉개지는 크기에 쓴다.
// rows 의 글자: . 투명 / r 빨강 / f 글자 채움 / e 글자 테두리 / w 공 안쪽
function manualSprite(spec) {
  const idx = { '.': T, r: R, f: F, e: E, w: W };
  const h = spec.manual.length, w = spec.width;
  const map = new Uint8Array(w * h);
  spec.manual.forEach(function (row, y) {
    if (row.length !== w) throw new Error(spec.key + ' ' + (y + 1) + '번째 줄 길이가 ' + row.length + ' (폭 ' + w + ' 이어야 함)');
    for (let x = 0; x < w; x++) {
      const v = idx[row.charAt(x)];
      if (v === undefined) throw new Error(spec.key + ' 에 알 수 없는 글자 "' + row.charAt(x) + '"');
      map[y * w + x] = v;
    }
  });
  return { w: w, h: h, map: map };
}

// 설정 한 줄 → 스프라이트 (자동 축소 또는 손으로 찍은 것)
function makeSprite(img, spec) {
  return trim(spec.manual ? manualSprite(spec) : buildSprite(img, spec));
}

function buildAll(img) {
  const out = {};
  SPRITES.forEach(function (spec) { out[spec.key] = Object.assign({ kind: spec.kind }, makeSprite(img, spec)); });
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const img = decodePNG(fs.readFileSync(SRC));
  console.log('원본 ' + path.relative(ROOT, SRC) + ' ' + img.w + 'x' + img.h);
  const layout = analyze(img);
  console.log('배치: 스우시·공 ' + JSON.stringify(layout.swoosh) + ' / 글자 ' + JSON.stringify(layout.letters) + ' / 부제 ' + JSON.stringify(layout.sub) + ', 공 안쪽 범위 ' + JSON.stringify(img.ballBox));

  if (args[0] === '--explore') {
    const dir = path.resolve(args[1] || '.');
    explore(img, dir);
    return;
  }

  const sprites = buildAll(img);

  // 1) 게임용 데이터
  const lines = [];
  lines.push('/*');
  lines.push(' * KLD 픽셀 로고 데이터 — tools/build-logo.js 가 자동 생성한다. 직접 고치지 말 것.');
  lines.push(' * 원본: assets/logo/kld-logo-dark.png  (. 투명 / r 빨강 / f 글자 채움 / e 글자 테두리 / w 공 안쪽, 런 길이 압축)');
  lines.push(' */');
  lines.push('(function (root) {');
  lines.push("  'use strict';");
  lines.push('  var KLD = root.KLD = root.KLD || {};');
  lines.push('  KLD.logoData = {');
  lines.push('    colors: ' + JSON.stringify(COLORS) + ',');
  lines.push('    sprites: {');
  const keys = Object.keys(sprites);
  keys.forEach(function (key, i) {
    const sp = sprites[key];
    lines.push('      ' + key + ': { kind: ' + JSON.stringify(sp.kind) + ', w: ' + sp.w + ', h: ' + sp.h + ', rle: ' + JSON.stringify(rle(sp)) + ' }' + (i < keys.length - 1 ? ',' : ''));
  });
  lines.push('    }');
  lines.push('  };');
  lines.push("  if (typeof module !== 'undefined' && module.exports) module.exports = KLD.logoData;");
  lines.push("})(typeof globalThis !== 'undefined' ? globalThis : this);");
  lines.push('');
  const dataFile = path.join(ROOT, 'js', 'logo-data.js');
  fs.writeFileSync(dataFile, lines.join('\n'));
  console.log('생성 ' + path.relative(ROOT, dataFile) + ' (' + fs.statSync(dataFile).size + ' bytes)');
  keys.forEach(function (key) { console.log('  ' + key + ': ' + sprites[key].w + 'x' + sprites[key].h); });

  // 2) 미리보기 시트 (어두운 배경 + 밝은 배경)
  const k = 3, pad = 12;
  let sheetW = 0, sheetH = pad;
  keys.forEach(function (key) { sheetW = Math.max(sheetW, sprites[key].w * k); sheetH += sprites[key].h * k + pad; });
  const sheet = newImage(sheetW * 2 + pad * 4, sheetH, '#141c33');
  fillRect(sheet, sheetW + pad * 2, 0, sheetW + pad * 2, sheetH, '#8fd0f8');
  let y = pad;
  keys.forEach(function (key) {
    blit(sheet, sprites[key], COLORS.light, pad, y, k);
    blit(sheet, sprites[key], COLORS.dark, sheetW + pad * 3, y, k);
    y += sprites[key].h * k + pad;
  });
  const sheetFile = path.join(ROOT, 'assets', 'logo', 'pixel-preview.png');
  savePNG(sheetFile, sheet);
  console.log('생성 ' + path.relative(ROOT, sheetFile));

  // 3) 아이콘과 공유용 이미지
  makeIcon(sprites, 180, path.join(ROOT, 'assets', 'icon-180.png'));
  makeIcon(sprites, 512, path.join(ROOT, 'assets', 'icon-512.png'));
  makeFavicon(path.join(ROOT, 'assets', 'favicon-32.png'));
  makeOg(sprites, path.join(ROOT, 'assets', 'og-image.png'));
}

// 정사각 아이콘: 남색 바탕 + 빨간 띠 + 가운데 픽셀 로고
function makeIcon(sprites, size, file) {
  const im = newImage(size, size, '#141c33');
  // 화면에 맞는 가장 큰 정수배 로고 고르기
  const candidates = Object.keys(sprites).filter(function (k) { return sprites[k].kind === 'mark'; })
    .map(function (k) { return sprites[k]; }).sort(function (a, b) { return a.w - b.w; });
  // 폭이 아이콘의 70~90%가 되는 조합 중에서 원본 스프라이트가 가장 큰(= 가장 정교한) 것을 고른다
  let best = null, fallback = null;
  candidates.forEach(function (sp) {
    for (let k = 1; sp.w * k <= size * 0.9; k++) {
      const w = sp.w * k;
      if (!fallback || w > fallback.w) fallback = { sp: sp, k: k, w: w };
      if (w >= size * 0.7 && (!best || sp.w > best.sp.w)) best = { sp: sp, k: k, w: w };
    }
  });
  if (!best) best = fallback || { sp: candidates[0], k: 1, w: candidates[0].w };
  const unit = Math.max(1, Math.round(size / 32));
  fillRect(im, 0, size - unit * 5, size, unit * 2, '#e60012');
  fillRect(im, 0, size - unit * 2, size, unit * 2, '#2e9e4f');
  const x = Math.round((size - best.w) / 2);
  const y = Math.round((size - unit * 5 - best.sp.h * best.k) / 2);
  blit(im, best.sp, COLORS.light, x, y, best.k);
  savePNG(file, im);
  console.log('생성 ' + path.relative(ROOT, file) + ' (' + size + 'x' + size + ', 로고 ' + best.sp.w + 'px x' + best.k + ')');
}

// 파비콘 32x32: 로고를 그대로 줄이면 알아볼 수 없으므로 같은 모티프(스우시 위의 공 + KLD)를 직접 찍는다
function makeFavicon(file) {
  const S = 32;
  const im = newImage(S, S, '#141c33');
  // 모서리 둥글게
  [[0, 0], [S - 2, 0], [0, S - 2], [S - 2, S - 2]].forEach(function (c) {
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      const cornerX = c[0] === 0 ? i : 1 - i, cornerY = c[1] === 0 ? j : 1 - j;
      if (cornerX + cornerY < 1) { const o = ((c[1] + j) * S + c[0] + i) * 4; im.data[o + 3] = 0; }
    }
  });
  // 스우시: 왼쪽 아래에서 오른쪽 위로 올라가는 빨간 선 (오른쪽으로 갈수록 굵게)
  for (let x = 2; x < 30; x++) {
    const y = Math.round(17 - (x - 2) * 0.16);
    fillRect(im, x, y, 1, x > 14 ? 2 : 1, '#e60012');
  }
  // 공: 빨간 테두리 + 흰 몸통 + 딤플
  const cx = 22, cy = 8, r = 5;
  for (let dy = -r - 1; dy <= r + 1; dy++) {
    for (let dx = -r - 1; dx <= r + 1; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 <= (r + 0.4) * (r + 0.4)) fillRect(im, cx + dx, cy + dy, 1, 1, '#ffffff');
      else if (d2 <= (r + 1.4) * (r + 1.4)) fillRect(im, cx + dx, cy + dy, 1, 1, '#e60012');
    }
  }
  [[-2, -2], [1, -3], [3, -1], [-3, 1], [0, 0], [2, 2], [-1, 3]].forEach(function (d) { fillRect(im, cx + d[0], cy + d[1], 1, 1, '#e60012'); });
  // KLD (3x5 글자를 2배로)
  const glyphs = { K: ['101', '101', '110', '101', '101'], L: ['100', '100', '100', '100', '111'], D: ['110', '101', '101', '101', '110'] };
  let gx = 5;
  'KLD'.split('').forEach(function (ch) {
    glyphs[ch].forEach(function (row, j) {
      for (let i = 0; i < 3; i++) if (row.charAt(i) === '1') fillRect(im, gx + i * 2, 20 + j * 2, 2, 2, '#fefefe');
    });
    gx += 8;
  });
  savePNG(file, im);
  console.log('생성 ' + path.relative(ROOT, file) + ' (32x32)');
}

// 링크 미리보기 이미지 1200x630: 밤하늘 띠 + 큰 픽셀 로고 + 잔디
function makeOg(sprites, file) {
  const W = 1200, H = 630, u = 6;
  const im = newImage(W, H, '#0b1030');
  const bands = ['#0b1030', '#131a45', '#1c2760', '#2a3a80'];
  const hs = [0.30, 0.24, 0.22, 0.24];
  const skyH = 474;
  let y = 0;
  bands.forEach(function (c, i) {
    const bh = Math.round(skyH * hs[i]);
    fillRect(im, 0, y, W, bh, c);
    if (i > 0) {                       // 띠 사이 디더
      for (let x = 0; x < W; x += u * 2) fillRect(im, x, y - u, u, u, c);
    }
    y += bh;
  });
  // 로고 자리 (별과 같은 6px 격자에 맞춘다)
  const sp = sprites.full160 || sprites.mark160;
  const k = u;
  const lx = Math.round((W - sp.w * k) / 2 / u) * u;
  const ly = Math.round(((skyH - sp.h * k) / 2 - u) / u) * u;
  // 별: 로고 상자(한 칸 여유 포함)와 겹치는 자리는 건너뛴다 → 로고에 별 조각이 달라붙지 않는다
  let seed = 12345;
  function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  for (let i = 0; i < 150; i++) {
    const sx = Math.floor(rnd() * (W / u)) * u, sy = Math.floor(rnd() * 62) * u;
    const bright = rnd() > 0.7;
    if (sx + u > lx - u && sx < lx + sp.w * k + u && sy + u > ly - u && sy < ly + sp.h * k + u) continue;
    fillRect(im, sx, sy, u, u, bright ? '#ffffff' : '#8fa3e8');
  }
  // 잔디
  fillRect(im, 0, skyH, W, H - skyH, '#236b3c');
  fillRect(im, 0, skyH + u * 3, W, u * 12, '#4fae52');
  for (let x = 0; x < W; x += u * 16) fillRect(im, x, skyH + u * 3, u * 8, u * 12, '#44a049');
  fillRect(im, 0, skyH + u * 3, W, u, '#f4f4f4');
  fillRect(im, 0, skyH + u * 15, W, u, '#f4f4f4');
  // 로고
  blit(im, sp, COLORS.light, lx, ly, k);
  savePNG(file, im);
  console.log('생성 ' + path.relative(ROOT, file) + ' (1200x630)');
}

// ── 보정용: 여러 크기를 한 장에 ───────────────────────────────
function explore(img, dir) {
  const sets = [
    { name: 'mark', specs: [32, 40, 48, 64, 80, 96, 128, 160, 200].map(function (w) {
      return { kind: 'mark', width: w, outline: w >= 96 ? 'inner' : 'none', letterT: w >= 96 ? 0.5 : 0.6 };
    }) },
    { name: 'full', specs: [128, 160, 200, 240].map(function (w) {
      return { kind: 'full', width: w, outline: 'inner' };
    }) }
  ];
  sets.forEach(function (set) {
    const k = 3, pad = 10;
    const built = set.specs.map(function (s) { return trim(buildSprite(img, s)); });
    let sheetW = 0, sheetH = pad;
    built.forEach(function (sp) { sheetW = Math.max(sheetW, sp.w * k); sheetH += sp.h * k + pad; });
    const sheet = newImage(sheetW * 2 + pad * 4, sheetH, '#141c33');
    fillRect(sheet, sheetW + pad * 2, 0, sheetW + pad * 2, sheetH, '#8fd0f8');
    let y = pad;
    built.forEach(function (sp, i) {
      blit(sheet, sp, COLORS.light, pad, y, k);
      blit(sheet, sp, COLORS.dark, sheetW + pad * 3, y, k);
      y += sp.h * k + pad;
      console.log(set.name + ' ' + set.specs[i].width + ' → ' + sp.w + 'x' + sp.h + ' (' + set.specs[i].outline + ')');
    });
    savePNG(path.join(dir, 'explore-' + set.name + '.png'), sheet);
  });
}

// 글자로 찍어 보기 (보정용)
function ascii(sp) {
  const ch = [' ', 'r', '#', '+', 'o'];
  const rows = [];
  for (let y = 0; y < sp.h; y++) {
    let row = '';
    for (let x = 0; x < sp.w; x++) row += ch[sp.map[y * sp.w + x]];
    rows.push(row.replace(/\s+$/, ''));
  }
  return rows.join('\n');
}

module.exports = {
  decodePNG: decodePNG, encodePNG: encodePNG, analyze: analyze, findBallInterior: findBallInterior, coverage: coverage,
  buildSprite: buildSprite, makeSprite: makeSprite, trim: trim, rle: rle, ascii: ascii, COLORS: COLORS, SRC: SRC
};

if (require.main === module) main();
