/*
 * 픽셀 로고 테스트 — node tests/logo.test.js
 *  1. js/logo-data.js 가 원본 PNG + 생성 도구의 결과와 일치하는지 (로고를 바꾸고 재생성을 잊으면 여기서 걸린다)
 *  2. 만들어진 모양이 온전한지: 스우시가 끊기지 않고, 공 윤곽이 닫혀 있고, 글자 줄 수가 맞고, D 의 구멍이 살아 있는지
 *     (실제로 쓰는 크기뿐 아니라 폭 40~320 을 훑어서 확인)
 *  3. 런타임 API: 크기 고르기, 팔레트, 색 해석, 투명도, 테두리, 이상한 입력 — 가짜 캔버스로 실행해 본다
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const data = require(path.join(ROOT, 'js', 'logo-data.js'));
const logo = require(path.join(ROOT, 'js', 'logo.js'));
const tool = require(path.join(ROOT, 'tools', 'build-logo.js'));
const specs = require(path.join(ROOT, 'tools', 'logo-sprites.json'));

const QUIET = process.argv.indexOf('--quiet') >= 0;
let failed = 0, passed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; if (!QUIET) console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}
function section(title) { console.log('\n' + title); }

const T = 0, R = 1, F = 2, E = 3, W = 4;

// ── 모양 검사 도구 ────────────────────────────────────────────
function isLetter(v) { return v === F || v === E; }

// 글자(KLD)가 차지하는 행 범위: 처음 나오는 글자 행부터 이어지는 덩어리
function letterBlock(sp) {
  let y0 = -1, y1 = -1;
  for (let y = 0; y < sp.h; y++) {
    let any = false;
    for (let x = 0; x < sp.w; x++) if (isLetter(sp.map[y * sp.w + x])) { any = true; break; }
    if (any) { if (y0 < 0) y0 = y; y1 = y; }
    else if (y0 >= 0) break;
  }
  return { y0: y0, y1: y1, rows: y0 < 0 ? 0 : y1 - y0 + 1 };
}

// 스우시·공이 왼쪽 끝 근처부터 오른쪽 끝까지 끊김 없이 이어지는가 (글자보다 위쪽 행에서 열 단위로 본다)
function swooshSpan(sp, limitRow) {
  let first = -1, last = -1, gaps = 0;
  const has = [];
  for (let x = 0; x < sp.w; x++) {
    let r = false;
    for (let y = 0; y < limitRow; y++) { const v = sp.map[y * sp.w + x]; if (v === R || v === W) { r = true; break; } }
    has.push(r);
    if (r) { if (first < 0) first = x; last = x; }
  }
  for (let x = first; x >= 0 && x <= last; x++) if (!has[x]) gaps++;
  return { first: first, last: last, gaps: gaps };
}

// 공의 흰 칸이 전부 빨강이나 흰 칸으로 둘러싸여 있는가
function ballLeaks(sp) {
  let leaks = 0, white = 0;
  for (let y = 0; y < sp.h; y++) {
    for (let x = 0; x < sp.w; x++) {
      if (sp.map[y * sp.w + x] !== W) continue;
      white++;
      [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].forEach(function (p) {
        if (p[0] < 0 || p[1] < 0 || p[0] >= sp.w || p[1] >= sp.h) { leaks++; return; }
        const v = sp.map[p[1] * sp.w + p[0]];
        if (v !== W && v !== R) leaks++;
      });
    }
  }
  return { leaks: leaks, white: white };
}

// 글자 덩어리 안에서 바깥과 이어지지 않은 빈 영역의 수 (D 의 구멍이 하나 있어야 한다)
function enclosedHoles(sp, y0, y1) {
  const w = sp.w + 2, h = (y1 - y0 + 1) + 2;                 // 사방에 한 칸씩 여백을 두고 바깥에서 채워 들어간다
  const solid = new Uint8Array(w * h);
  for (let y = y0; y <= y1; y++) for (let x = 0; x < sp.w; x++) if (isLetter(sp.map[y * sp.w + x])) solid[(y - y0 + 1) * w + x + 1] = 1;
  const seen = new Uint8Array(w * h);
  function flood(start) {
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const k = stack.pop(), x = k % w, y = (k / w) | 0;
      [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].forEach(function (p) {
        if (p[0] < 0 || p[1] < 0 || p[0] >= w || p[1] >= h) return;
        const q = p[1] * w + p[0];
        if (solid[q] || seen[q]) return;
        seen[q] = 1;
        stack.push(q);
      });
    }
  }
  flood(0);
  let holes = 0;
  for (let k = 0; k < w * h; k++) if (!solid[k] && !seen[k]) { holes++; flood(k); }
  return holes;
}

// 원본 비율로 따졌을 때 글자가 차지해야 할 줄 수의 범위 [최소, 최대].
// 맨 윗줄·아랫줄은 일부만 덮이므로 덮인 비율이 임계값(letterT)을 넘는 줄만 센다. 임계값 근처(±0.1)는 어느 쪽이든 허용.
function expectedLetterRows(width, letterT) {
  const s = width / img.w, pad = Math.ceil(1 / s);
  const a = (layout.letters[0] + pad) * s, b = (layout.letters[1] + pad) * s;
  const full = Math.floor(b) - Math.ceil(a);
  const ft = Math.ceil(a) - a, fb = b - Math.floor(b);
  let lo = full, hi = full;
  [ft, fb].forEach(function (f) {
    if (f >= letterT + 0.1) { lo++; hi++; }
    else if (f > letterT - 0.1) hi++;
  });
  return [lo, hi];
}

function shapeProblems(sp, letterRowsRange, opts) {
  opts = opts || {};
  const out = [];
  const lb = letterBlock(sp);
  if (lb.rows === 0) { out.push('글자가 없음'); return out; }
  const span = swooshSpan(sp, lb.y0);
  if (span.first < 0 || span.gaps > 0) out.push('스우시 끊김 gaps=' + span.gaps);
  if (span.first > Math.max(2, sp.w * 0.08)) out.push('스우시 시작이 늦음 first=' + span.first);
  if (span.last < sp.w * 0.95) out.push('스우시가 오른쪽 끝에 못 미침 last=' + span.last);
  const ball = ballLeaks(sp);
  if (ball.white === 0) out.push('공의 흰 칸이 없음');
  if (ball.leaks > 0) out.push('공 윤곽이 열려 있음 leaks=' + ball.leaks);
  if (letterRowsRange && (lb.rows < letterRowsRange[0] || lb.rows > letterRowsRange[1])) {
    out.push('글자 줄 수 ' + lb.rows + ' (원본 비율로는 ' + letterRowsRange.join('~') + ')');
  }
  const holes = enclosedHoles(sp, lb.y0, lb.y1);
  if (!opts.skipHoles && holes !== 1) out.push('글자 안의 구멍 수 ' + holes + ' (D 의 구멍 1개여야 함)');
  return out;
}

// ═════════════════════════════════════════════════════════════
section('1. 데이터 형식');
const keys = Object.keys(data.sprites);
check('스프라이트가 하나 이상 있다', keys.length > 0, String(keys.length));
check('팔레트 light/dark 와 브랜드 빨강이 있다',
  !!(data.colors && data.colors.light && data.colors.dark) && /^#[0-9a-f]{6}$/i.test(data.colors.red || ''));
['light', 'dark'].forEach(function (v) {
  const p = data.colors[v] || {};
  check('팔레트 ' + v + ' 에 r/f/e/w 가 모두 있다', ['r', 'f', 'e', 'w'].every(function (s) { return /^#[0-9a-f]{6}$/i.test(p[s] || ''); }));
});
check('팔레트가 생성 도구의 COLORS 와 같다', JSON.stringify(data.colors) === JSON.stringify(tool.COLORS),
  '다르면 node tools/build-logo.js 를 다시 실행');

// ═════════════════════════════════════════════════════════════
section('2. 원본 PNG 에서 다시 만든 결과와 일치하는가');
const img = tool.decodePNG(fs.readFileSync(tool.SRC));
const layout = tool.analyze(img);
check('원본 PNG 를 읽었다', img.w > 0 && img.h > 0, img.w + 'x' + img.h);
check('배치를 찾았다: 스우시·공 / 글자 / 부제가 위에서 아래로, 공 안쪽 영역',
  layout.swoosh[1] <= layout.letters[0] && layout.letters[1] <= layout.sub[0] && layout.sub[1] <= img.h && !!img.ballBox,
  JSON.stringify(layout));
check('설정 목록과 데이터의 키가 같다', specs.map(function (s) { return s.key; }).join() === keys.join(), keys.join());

specs.forEach(function (spec) {
  const fresh = tool.makeSprite(img, spec);
  const sp = data.sprites[spec.key];
  if (!sp) { check(spec.key + ' 가 데이터에 있다', false); return; }
  const map = logo.decode(spec.key);
  let same = sp.w === fresh.w && sp.h === fresh.h && map.length === fresh.map.length;
  for (let i = 0; same && i < map.length; i++) if (map[i] !== fresh.map[i]) same = false;
  check(spec.key + ' (' + sp.w + 'x' + sp.h + ') 해독 결과가 원본에서 다시 만든 것과 같다', same,
    '다르면 node tools/build-logo.js 를 다시 실행');
  check(spec.key + ' 폭·종류가 설정과 같다', sp.w === spec.width && sp.kind === spec.kind, sp.w + '/' + sp.kind + ' vs ' + spec.width + '/' + spec.kind);

  const count = [0, 0, 0, 0, 0];
  for (let i = 0; i < map.length; i++) count[map[i]]++;
  check(spec.key + ' 에 빨강·글자·공이 모두 있고 인덱스가 0~4 범위다',
    count[R] > 0 && count[F] > 0 && count[W] > 0 && count.reduce(function (a, b) { return a + b; }, 0) === map.length, JSON.stringify(count));

  // 손으로 찍은 것은 글자 줄 수를 원본 비율과 비교하지 않는다
  const range = spec.manual ? null : expectedLetterRows(spec.width, spec.letterT != null ? spec.letterT : 0.5);
  const problems = shapeProblems({ w: sp.w, h: sp.h, map: map }, range);
  check(spec.key + ' 모양이 온전하다 (스우시 연속, 공 닫힘, 글자 줄 수, D 구멍)', problems.length === 0, problems.join('; '));
});

keys.filter(function (k) { return data.sprites[k].kind === 'full'; }).forEach(function (k) {
  const w = data.sprites[k].w;
  const m = keys.find(function (q) { return data.sprites[q].kind === 'mark' && data.sprites[q].w === w; });
  if (!m) return;
  check(k + ' 가 ' + m + ' 보다 높다 (부제 줄)', data.sprites[k].h > data.sprites[m].h);
  // 같은 폭의 mark 와 full 은 부제를 뺀 윗부분이 완전히 같아야 한다
  const a = logo.decode(m), b = logo.decode(k), mh = data.sprites[m].h;
  let same = true;
  for (let i = 0; same && i < w * mh; i++) if (a[i] !== b[i]) same = false;
  check(k + ' 의 윗부분이 ' + m + ' 과 픽셀 단위로 같다', same);
});

// ═════════════════════════════════════════════════════════════
section('3. 폭 40~320 을 훑어도 모양이 깨지지 않는가');
(function () {
  const bad = [];
  let n = 0;
  for (let w = 40; w <= 320; w += 3) {
    const spec = { kind: 'mark', width: w, outline: w >= 96 ? 'inner' : 'none', letterT: w >= 96 ? 0.5 : 0.6 };
    let sp;
    try { sp = tool.makeSprite(img, spec); } catch (e) { bad.push(w + ': 예외 ' + e.message); continue; }
    n++;
    // 44px 미만에서는 D 의 구멍이 한 칸보다 작아질 수 있어 구멍 검사를 뺀다
    const p = shapeProblems(sp, expectedLetterRows(w, spec.letterT), { skipHoles: w < 44 });
    if (p.length) bad.push(w + ': ' + p.join(', '));
  }
  check('mark ' + n + '개 폭 (40~320, 3 간격) 모두 온전하다', bad.length === 0, bad.slice(0, 6).join(' | '));
  const bad2 = [];
  let n2 = 0;
  for (let w = 160; w <= 320; w += 10) {
    let sp;
    try { sp = tool.makeSprite(img, { kind: 'full', width: w, outline: 'inner' }); } catch (e) { bad2.push(w + ': 예외 ' + e.message); continue; }
    n2++;
    const p = shapeProblems(sp, expectedLetterRows(w, 0.5));
    // 부제 줄이 글자 아래에 실제로 있는가
    const lb = letterBlock(sp);
    let subPixels = 0;
    for (let y = lb.y1 + 2; y < sp.h; y++) for (let x = 0; x < sp.w; x++) if (isLetter(sp.map[y * sp.w + x])) subPixels++;
    if (subPixels < w) p.push('부제 픽셀이 너무 적음 ' + subPixels);
    if (p.length) bad2.push(w + ': ' + p.join(', '));
  }
  check('full ' + n2 + '개 폭 (160~320, 10 간격) 모두 온전하다', bad2.length === 0, bad2.slice(0, 6).join(' | '));
  let threw = false;
  try { tool.makeSprite(img, { kind: 'mark', width: 64, outline: 'outer' }); } catch (e) { threw = true; }
  check('지원하지 않는 outline 값은 조용히 넘어가지 않고 오류를 낸다', threw);
})();

// ═════════════════════════════════════════════════════════════
section('4. 크기 고르기');
check('available() 이 참', logo.available() === true);
check('keys("mark") 가 폭 오름차순', (function () {
  const ks = logo.keys('mark');
  for (let i = 1; i < ks.length; i++) if (logo.info(ks[i]).w < logo.info(ks[i - 1]).w) return false;
  return ks.length > 0;
})());
check('pick("mark", 100) → mark96', logo.pick('mark', 100) === 'mark96', String(logo.pick('mark', 100)));
check('pick("mark", 48) → mark48 (경계 포함)', logo.pick('mark', 48) === 'mark48', String(logo.pick('mark', 48)));
check('pick("mark", 47) → mark32', logo.pick('mark', 47) === 'mark32', String(logo.pick('mark', 47)));
check('pick("mark", 31) → null (가장 작은 것도 안 들어감)', logo.pick('mark', 31) === null, String(logo.pick('mark', 31)));
check('pick("mark", 62, 24) → mark56 (티 뒤 백드롭 크기)', logo.pick('mark', 62, 24) === 'mark56', String(logo.pick('mark', 62, 24)));
check('pick("mark", 60, 16) → mark56 (게임의 백드롭 호출)', logo.pick('mark', 60, 16) === 'mark56', String(logo.pick('mark', 60, 16)));
check('pick("full", 216) → full200', logo.pick('full', 216) === 'full200', String(logo.pick('full', 216)));
check('pick("full", 150) → mark 로 대체', logo.pick('full', 150) === 'mark128', String(logo.pick('full', 150)));
check('pick("full", 1000, 60) → 높이 제한 적용', (function () {
  const k = logo.pick('full', 1000, 60);
  return k !== null && logo.info(k).h <= 60;
})(), String(logo.pick('full', 1000, 60)));
check('pick 에 이상한 폭(undefined, NaN, 음수) → null',
  logo.pick('mark') === null && logo.pick('full', NaN) === null && logo.pick('mark', -5) === null);
check('게임이 쓰는 크기가 그대로다 (mark48 48x13, mark56 56x15, full200 200x68)',
  JSON.stringify([logo.info('mark48'), logo.info('mark56'), logo.info('full200')].map(function (i) { return i && [i.w, i.h]; })) === '[[48,13],[56,15],[200,68]]');

// ═════════════════════════════════════════════════════════════
section('5. 없는 키·이상한 이름');
check('info(없는 키) → null', logo.info('nope') === null);
['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__'].forEach(function (k) {
  let ok = true, why = '';
  try {
    if (logo.info(k) !== null) { ok = false; why = 'info'; }
    if (logo.decode(k) !== null) { ok = false; why = 'decode'; }
    if (logo.canvas(k, 'light') !== null) { ok = false; why = 'canvas'; }
    if (logo.dataURL(k, 'light') !== '') { ok = false; why = 'dataURL'; }
  } catch (e) { ok = false; why = '예외 ' + e.message; }
  check('키 "' + k + '" 는 없는 키로 취급된다', ok, why);
});

// ═════════════════════════════════════════════════════════════
section('6. document 가 없는 환경 (Node)');
(function () {
  let threw = false;
  try {
    if (logo.canvas('mark96', 'light') !== null) threw = true;
    if (logo.draw({}, 'mark96', 0, 0, {}) !== null) threw = true;
    if (logo.drawFit({}, 'full', 0, 0, 200, {}) !== null) threw = true;
    if (logo.dataURL('mark96', 'dark', 2) !== '') threw = true;
    logo.decode('nope');
    logo.palette('nope');
    logo.palette({ r: '#fff' });
    logo.clearCache();
  } catch (e) { threw = true; console.log('     예외: ' + e.message); }
  check('예외 없이 null / 빈 문자열을 돌려준다', !threw);
})();

// ═════════════════════════════════════════════════════════════
section('7. 가짜 캔버스로 런타임 실행');

// 브라우저 규칙을 흉내 낸 최소 DOM: fillStyle 정규화, globalAlpha 범위 밖 무시, createImageData 크기 검사
function parseCss(s) {
  s = String(s).trim().toLowerCase();
  const names = { white: [255, 255, 255, 1], black: [0, 0, 0, 1], red: [255, 0, 0, 1], navy: [0, 0, 128, 1], transparent: [0, 0, 0, 0] };
  if (names[s]) return names[s];
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map(function (c) { return c + c; }).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
  }
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(s);
  if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
  return null;
}
function serializeCss(c) {
  function hx(v) { return (v < 16 ? '0' : '') + v.toString(16); }
  if (c[3] === 1) return '#' + hx(c[0]) + hx(c[1]) + hx(c[2]);
  return 'rgba(' + c[0] + ', ' + c[1] + ', ' + c[2] + ', ' + (Math.round(c[3] * 1000) / 1000) + ')';
}
function FakeCanvas() {
  this.width = 0; this.height = 0; this.pixels = null; this.ctx = null;
}
FakeCanvas.prototype.getContext = function () {
  if (this.ctx) return this.ctx;
  const cv = this;
  let fill = '#000000', ga = 1;
  const ctx = { imageSmoothingEnabled: true, calls: [], throwOnDraw: false };
  Object.defineProperty(ctx, 'fillStyle', { get: function () { return fill; }, set: function (v) { const c = parseCss(v); if (c) fill = serializeCss(c); } });
  Object.defineProperty(ctx, 'globalAlpha', { get: function () { return ga; }, set: function (v) { if (typeof v === 'number' && v >= 0 && v <= 1) ga = v; } });
  ctx.createImageData = function (w, h) {
    if (!(w > 0) || !(h > 0)) throw new Error('IndexSizeError');
    return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  };
  ctx.putImageData = function (im) { cv.pixels = im; };
  ctx.drawImage = function (src, x, y, w, h) {
    if (ctx.throwOnDraw) throw new Error('boom');
    ctx.calls.push({ src: src, x: x, y: y, w: w, h: h, alpha: ga, smooth: ctx.imageSmoothingEnabled });
  };
  this.ctx = ctx;
  return ctx;
};
FakeCanvas.prototype.toDataURL = function () { return 'data:image/png;base64,FAKE' + this.width + 'x' + this.height; };

const realWarn = console.warn;
const warnings = [];
console.warn = function (m) { warnings.push(String(m)); };
globalThis.document = { createElement: function () { return new FakeCanvas(); } };
logo.clearCache();

function opaque(cv) { let n = 0; const d = cv.pixels.data; for (let i = 3; i < d.length; i += 4) if (d[i] === 255) n++; return n; }
function soft(cv) { let n = 0; const d = cv.pixels.data; for (let i = 3; i < d.length; i += 4) if (d[i] !== 0 && d[i] !== 255) n++; return n; }
function px(cv, x, y) { const d = cv.pixels.data, o = (y * cv.width + x) * 4; return [d[o], d[o + 1], d[o + 2], d[o + 3]].join(','); }
function countIdx(key) { const m = logo.decode(key), c = [0, 0, 0, 0, 0]; for (let i = 0; i < m.length; i++) c[m[i]]++; return c; }

try {
  // 7-1) canvas(): 인덱스 맵과 픽셀 단위로 일치
  ['mark32', 'mark96', 'full200'].forEach(function (key) {
    ['light', 'dark'].forEach(function (v) {
      const cv = logo.canvas(key, v), map = logo.decode(key), inf = logo.info(key), pal = data.colors[v];
      let ok = cv && cv.width === inf.w && cv.height === inf.h && soft(cv) === 0;
      const d = ok ? cv.pixels.data : null;
      const slots = [null, pal.r, pal.f, pal.e, pal.w];
      for (let i = 0; ok && i < map.length; i++) {
        const want = slots[map[i]];
        if (!want) { if (d[i * 4 + 3] !== 0) ok = false; continue; }
        const n = parseInt(want.slice(1), 16);
        if (d[i * 4] !== ((n >> 16) & 255) || d[i * 4 + 1] !== ((n >> 8) & 255) || d[i * 4 + 2] !== (n & 255) || d[i * 4 + 3] !== 255) ok = false;
      }
      check('canvas(' + key + ', ' + v + ') 가 데이터와 픽셀 단위로 같다', !!ok);
    });
  });
  check('같은 요청은 같은 캔버스를 재사용한다', logo.canvas('mark96', 'light') === logo.canvas('mark96', 'light') &&
    logo.canvas('mark96', { r: '#e60012', f: '#fefefe', e: '#727171', w: '#ffffff' }) === logo.canvas('mark96', 'light'));

  // 7-2) 팔레트
  const c96 = countIdx('mark96'), all96 = c96[R] + c96[F] + c96[E] + c96[W];
  check('모르는 variant 이름은 light 로', logo.canvas('mark96', 'nope') === logo.canvas('mark96', 'light'));
  check("variant 'red' · 'constructor' 도 light 로 (빈 로고가 되지 않는다)",
    logo.canvas('mark96', 'red') === logo.canvas('mark96', 'light') && logo.canvas('mark96', 'constructor') === logo.canvas('mark96', 'light'));
  check("{ w: '' } 는 공 안쪽만 비우고 나머지는 light 를 물려받는다", opaque(logo.canvas('mark96', { w: '' })) === all96 - c96[W],
    opaque(logo.canvas('mark96', { w: '' })) + ' vs ' + (all96 - c96[W]));
  check("{ base: 'dark', w: null } 는 dark 를 물려받는다", (function () {
    const cv = logo.canvas('mark96', { base: 'dark', w: null }), map = logo.decode('mark96');
    const i = Array.prototype.indexOf.call(map, F);
    return opaque(cv) === all96 - c96[W] && px(cv, i % 96, (i / 96) | 0) === '0,0,0,255';
  })());
  check("'transparent' 는 그리지 않음으로 처리된다 (검은색이 되지 않는다)", opaque(logo.canvas('mark96', { w: 'transparent' })) === all96 - c96[W]);
  check('CSS 색 이름을 받는다 (white)', (function () {
    const cv = logo.canvas('mark96', { f: 'white' }), map = logo.decode('mark96');
    const i = Array.prototype.indexOf.call(map, F);
    return px(cv, i % 96, (i / 96) | 0) === '255,255,255,255';
  })());
  warnings.length = 0;
  const half = logo.canvas('mark32', { r: 'rgba(20, 28, 51, 0.5)' });
  check('반투명 색은 불투명으로 그리고 한 번 경고한다', soft(half) === 0 && opaque(half) === opaque(logo.canvas('mark32', 'light')) && warnings.length === 1,
    'warnings=' + warnings.length);
  warnings.length = 0;
  const unknown = logo.canvas('mark32', { r: 'no-such-colour' });
  check('알 수 없는 색은 그 부분을 그리지 않고 한 번 경고한다', opaque(unknown) === opaque(logo.canvas('mark32', 'light')) - countIdx('mark32')[R] && warnings.length === 1,
    'warnings=' + warnings.length);
  const pal = logo.colors();
  pal.light.w = '';
  pal.red = '#00ff00';
  logo.clearCache();
  check('colors() 가 돌려준 객체를 고쳐도 로고는 그대로다', opaque(logo.canvas('mark96', 'light')) === all96 && logo.colors().red === '#e60012');

  // 7-3) 테두리
  const plain = logo.canvas('mark32', 'light'), lined = logo.canvas('mark32', 'light', '#141c33');
  check('outline 을 주면 사방 1픽셀씩 커지고 테두리 픽셀이 생긴다', lined.width === 34 && lined.height === 13 && opaque(lined) > opaque(plain));
  check('outline 본체는 (1,1) 만큼 밀려 그대로 들어 있다', (function () {
    const a = plain.pixels.data, b = lined.pixels.data;
    for (let y = 0; y < 11; y++) for (let x = 0; x < 32; x++) {
      const i = (y * 32 + x) * 4, j = ((y + 1) * 34 + x + 1) * 4;
      if (a[i + 3] === 255 && (a[i] !== b[j] || a[i + 1] !== b[j + 1] || a[i + 2] !== b[j + 2] || b[j + 3] !== 255)) return false;
    }
    return true;
  })());
  check("outline: 'transparent' · '' 는 테두리 없음과 같다", logo.canvas('mark32', 'light', 'transparent') === plain && logo.canvas('mark32', 'light', '') === plain);

  // 7-4) draw()
  const g = new FakeCanvas().getContext();
  g.imageSmoothingEnabled = true;
  g.globalAlpha = 0.8;
  let r = logo.draw(g, 'mark48', 100.4, 50.6, { variant: 'dark', align: 'center', valign: 'middle' });
  let call = g.calls[g.calls.length - 1];
  check('draw 가 본체 영역을 돌려주고 그 자리에 그린다', r && r.x === 76 && r.y === 44 && r.w === 48 && r.h === 13 && r.key === 'mark48' &&
    call.x === 76 && call.y === 44 && call.w === 48 && call.h === 13 && call.smooth === false, JSON.stringify(r));
  check('draw 후 캔버스 상태(imageSmoothingEnabled, globalAlpha)가 원래대로다', g.imageSmoothingEnabled === true && g.globalAlpha === 0.8);
  r = logo.draw(g, 'mark32', 10, 20, { scale: 2, outline: '#141c33', align: 'right', valign: 'bottom' });
  call = g.calls[g.calls.length - 1];
  check('scale 2 + outline: 영역은 본체 기준, 그림은 2픽셀 바깥까지', r.x === 10 - 64 && r.y === 20 - 22 && r.w === 64 && r.h === 22 &&
    call.x === r.x - 2 && call.y === r.y - 2 && call.w === 68 && call.h === 26, JSON.stringify(r) + ' ' + JSON.stringify([call.x, call.y, call.w, call.h]));
  g.globalAlpha = 1;
  let n0 = g.calls.length;
  r = logo.draw(g, 'mark32', 0, 0, { alpha: 0.5 });
  check('alpha 0.5 → 반투명으로 그린다', g.calls.length === n0 + 1 && g.calls[n0].alpha === 0.5 && g.globalAlpha === 1);
  n0 = g.calls.length;
  const neg = logo.draw(g, 'mark32', 0, 0, { alpha: -0.2 }), nan = logo.draw(g, 'mark32', 0, 0, { alpha: NaN });
  check('alpha 음수·NaN → 그리지 않는다 (페이드가 끝을 지나쳐도 번쩍이지 않는다)', g.calls.length === n0 && !!neg && !!nan && neg.w === 32);
  n0 = g.calls.length;
  logo.draw(g, 'mark32', 0, 0, { alpha: 1.7 });
  check('alpha 1 초과 → 1 로', g.calls.length === n0 + 1 && g.calls[n0].alpha === 1);
  ['abc', NaN, 0, -3, Infinity, {}].forEach(function (s) {
    const rr = logo.draw(g, 'mark32', 0, 0, { scale: s });
    check('scale ' + String(s) + ' → 1배', !!rr && rr.w === 32 && rr.h === 11);
  });
  check('scale 1.5 → 2배', logo.draw(g, 'mark32', 0, 0, { scale: 1.5 }).w === 64);
  check('좌표가 숫자가 아니면 null', logo.draw(g, 'mark32', NaN, 0) === null && logo.draw(g, 'mark32', 0, undefined) === null && logo.draw(null, 'mark32', 0, 0) === null);
  check('없는 키 → null', logo.draw(g, 'nope', 0, 0) === null && logo.draw(g, 'constructor', 0, 0) === null);
  g.throwOnDraw = true;
  g.globalAlpha = 0.6;
  warnings.length = 0;
  let res = 'x';
  try { res = logo.draw(g, 'mark32', 0, 0, { alpha: 0.5 }); } catch (e) { res = 'threw'; }
  check('drawImage 가 실패해도 예외를 던지지 않고 null, 상태는 복구', res === null && g.globalAlpha === 0.6 && g.imageSmoothingEnabled === true && warnings.length === 1, String(res));
  g.throwOnDraw = false;
  g.globalAlpha = 1;

  // 7-5) drawFit()
  r = logo.drawFit(g, 'mark', 31, 12, 60, { maxH: 16, variant: 'light', align: 'center', valign: 'middle' });
  check('drawFit(mark, 폭 60, 높이 16) → mark56 을 가운데에', r && r.key === 'mark56' && r.x === 31 - 28 && r.y === 12 - 8, JSON.stringify(r));
  r = logo.drawFit(g, 'full', 108, 8, 200, { align: 'center' });
  check('drawFit(full, 폭 200) → full200, 아래쪽 끝 y=76', r && r.key === 'full200' && r.x === 8 && r.y + r.h === 76, JSON.stringify(r));
  check('drawFit 에 들어갈 것이 없으면 null', logo.drawFit(g, 'mark', 0, 0, 20) === null);
  r = logo.drawFit(g, 'mark', 0, 0, 100, { scale: 2 });
  check('drawFit + scale 2 → 배율을 고려해 고른다 (mark48 x2)', r && r.key === 'mark48' && r.w === 96, JSON.stringify(r));

  // 7-6) dataURL()
  const u1 = logo.dataURL('full200', 'light'), u3 = logo.dataURL('full200', 'light', 3), uo = logo.dataURL('full200', 'light', 3, '#141c33');
  check('dataURL: 배율·테두리에 따라 크기가 달라진다', u1 === 'data:image/png;base64,FAKE200x68' && u3 === 'data:image/png;base64,FAKE600x204' && uo === 'data:image/png;base64,FAKE606x210',
    [u1, u3, uo].join(' '));
  check('dataURL: 없는 키 → 빈 문자열', logo.dataURL('nope', 'light') === '');
} catch (e) {
  check('런타임 검사 중 예외가 나지 않는다', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e));
} finally {
  delete globalThis.document;
  console.warn = realWarn;
  logo.clearCache();
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
