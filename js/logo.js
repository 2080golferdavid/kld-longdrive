/*
 * KLD LONG DRIVE — 픽셀 로고
 *
 * js/logo-data.js (tools/build-logo.js 가 공식 로고 PNG에서 자동 생성)의 데이터를 캔버스로 풀어서 그린다.
 * 이미지 파일을 불러오지 않으므로
 *   - index.html 을 더블클릭(file://)으로 열어도 캔버스가 오염되지 않아 기록 카드 저장(toBlob)이 막히지 않고,
 *   - 로딩을 기다릴 필요가 없으며,
 *   - 같은 모양에 팔레트만 바꿔 흰 글자/검은 글자/단색 버전을 만들 수 있다.
 *
 * 사용 예
 *   KLD.logo.drawFit(g, 'full', W / 2, 20, W - 16, { variant: 'light', align: 'center' });   // 타이틀
 *   KLD.logo.draw(g, 'mark48', x, y, { variant: 'dark' });                                     // 밝은 광고판
 *   img.src = KLD.logo.dataURL('full200', 'light');                                           // DOM <img>
 *
 * 스프라이트 종류: 'mark' = KLD 글자 + 스우시 + 공,  'full' = 그 아래에 KOREA LONG DRIVE 까지.
 * variant: 'light'(흰 글자, 어두운 배경용) | 'dark'(검은 글자, 밝은 배경용) | { base, r, f, e, w } 직접 지정
 *   r 빨강, f 글자 채움, e 글자 테두리, w 공 안쪽. 적지 않은 칸은 base('light' 기본)에서 물려받고,
 *   '' · null · 'transparent' 로 적은 칸은 그리지 않는다.
 * 자세한 안내는 docs/LOGO.md.
 */
(function (root) {
  'use strict';
  var KLD = root.KLD = root.KLD || {};

  var INDEX = { '.': 0, r: 1, f: 2, e: 3, w: 4 };
  var SLOT = [null, 'r', 'f', 'e', 'w'];
  var DEFAULT_COLORS = {
    red: '#e60012',
    light: { r: '#e60012', f: '#fefefe', e: '#727171', w: '#ffffff' },
    dark: { r: '#e60012', f: '#000000', e: '#9fa0a0', w: '#ffffff' }
  };
  var MAX_SCALE = 64;

  var mapCache = Object.create(null);        // key → Uint8Array
  var canvasCache = Object.create(null);     // key|팔레트|테두리 → canvas
  var urlCache = Object.create(null);        // key|팔레트|배율|테두리 → data URL
  var colorCache = Object.create(null);      // 색 문자열 → [r, g, b] | null
  var colorCtx = null;
  var warned = Object.create(null);

  function own(obj, key) {
    return obj != null && typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key);
  }

  function warnOnce(msg) {
    if (warned[msg]) return;
    warned[msg] = true;
    if (typeof console !== 'undefined' && console.warn) console.warn('[KLD.logo] ' + msg);
  }

  function sprites() { return (KLD.logoData && KLD.logoData.sprites) || {}; }
  function rawColors() { return (KLD.logoData && KLD.logoData.colors) || DEFAULT_COLORS; }

  // 키에 해당하는 스프라이트. 'constructor' 같은 이름이 Object.prototype 에서 딸려 오지 않게 자기 속성만 본다.
  function sprite(key) {
    var all = sprites();
    var sp = own(all, key) ? all[key] : null;
    return (sp && typeof sp === 'object' && sp.w > 0 && sp.h > 0) ? sp : null;
  }

  function isPalette(p) { return !!p && typeof p === 'object'; }

  function copyPalette(p) { return { r: p.r, f: p.f, e: p.e, w: p.w }; }

  // 바깥에 내주는 색 정보는 사본이다 (고쳐도 로고에는 영향이 없다)
  function colors() {
    var c = rawColors();
    return {
      red: c.red || DEFAULT_COLORS.red,
      light: copyPalette(isPalette(c.light) ? c.light : DEFAULT_COLORS.light),
      dark: copyPalette(isPalette(c.dark) ? c.dark : DEFAULT_COLORS.dark)
    };
  }

  function available() {
    var all = sprites();
    for (var k in all) if (own(all, k) && sprite(k)) return true;
    return false;
  }

  function info(key) {
    var sp = sprite(key);
    return sp ? { key: key, kind: sp.kind, w: sp.w, h: sp.h } : null;
  }

  // 종류별 키 목록 (폭 오름차순). kind 를 생략하면 전부.
  function keys(kind) {
    var all = sprites(), out = [];
    for (var k in all) {
      if (own(all, k) && sprite(k) && (!kind || all[k].kind === kind)) out.push(k);
    }
    out.sort(function (a, b) { return all[a].w - all[b].w || all[a].h - all[b].h; });
    return out;
  }

  // 런 길이 데이터 → 인덱스 맵 (0 투명, 1 빨강, 2 채움, 3 테두리, 4 공 안쪽)
  function decode(key) {
    var sp = sprite(key);
    if (!sp) return null;
    if (mapCache[key]) return mapCache[key];
    var map = new Uint8Array(sp.w * sp.h);
    var rows = String(sp.rle).split('/');
    for (var y = 0; y < rows.length && y < sp.h; y++) {
      var row = rows[y], x = 0, n = 0, hasN = false;
      for (var i = 0; i < row.length; i++) {
        var c = row.charCodeAt(i);
        if (c >= 48 && c <= 57) { n = n * 10 + (c - 48); hasN = true; continue; }
        var count = hasN ? n : 1;
        var ch = row.charAt(i);
        var v = own(INDEX, ch) ? INDEX[ch] : 0;
        for (var j = 0; j < count && x < sp.w; j++) map[y * sp.w + x++] = v;
        n = 0; hasN = false;
      }
    }
    mapCache[key] = map;
    return map;
  }

  /*
   * variant → 팔레트 { r, f, e, w }
   *  - 'light' / 'dark' : 기본 팔레트. 모르는 이름은 'light'.
   *  - 객체 : base('light' 기본) 팔레트 위에 적힌 칸만 덮어쓴다. 값이 '' · null 이면 그 칸은 그리지 않는다.
   */
  function palette(variant) {
    var c = rawColors();
    var light = isPalette(c.light) ? c.light : DEFAULT_COLORS.light;
    function named(name) { return (own(c, name) && isPalette(c[name])) ? c[name] : null; }
    if (variant && typeof variant === 'object') {
      var base = named(variant.base) || light;
      return {
        r: variant.r === undefined ? base.r : variant.r,
        f: variant.f === undefined ? base.f : variant.f,
        e: variant.e === undefined ? base.e : variant.e,
        w: variant.w === undefined ? base.w : variant.w
      };
    }
    return named(variant) || light;
  }

  function paletteKey(p) {
    return [p.r || '', p.f || '', p.e || '', p.w || ''].join(',');
  }

  /*
   * 색 문자열 → [r, g, b]. '#rgb' / '#rrggbb' 는 직접 읽고, 그 밖의 CSS 색(이름, rgb() 등)은 캔버스에 맡겨 정규화한다.
   *  - 빈 값과 완전 투명('transparent', 알파 0)은 "그리지 않음"(null)
   *  - 반투명 색은 불투명으로 그리고 한 번 경고한다 (픽셀 로고에는 반투명 픽셀을 만들지 않는다. 흐리게 하려면 alpha 옵션)
   *  - 알 수 없는 색은 null 이며 한 번 경고한다
   */
  function parseColor(color) {
    if (color == null || color === '') return null;
    var s = String(color).trim();
    if (s === '') return null;
    if (s in colorCache) return colorCache[s];
    var out = null, known = false;
    var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
    if (m) {
      var h = m[1];
      if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
      var n = parseInt(h, 16);
      out = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      known = true;
    } else if (typeof document !== 'undefined') {
      try {
        if (!colorCtx) colorCtx = document.createElement('canvas').getContext('2d');
        // 잘못된 값은 무시되어 직전 색이 남는다 → 서로 다른 두 색에서 시작해 결과가 같을 때만 유효
        colorCtx.fillStyle = '#000000'; colorCtx.fillStyle = s;
        var a = String(colorCtx.fillStyle);
        colorCtx.fillStyle = '#ffffff'; colorCtx.fillStyle = s;
        var b = String(colorCtx.fillStyle);
        if (a === b) {
          var hm = /^#([0-9a-f]{6})$/i.exec(a);
          var rm = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(a);
          if (hm) {
            var v = parseInt(hm[1], 16);
            out = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
            known = true;
          } else if (rm) {
            known = true;
            var alpha = rm[4] === undefined ? 1 : +rm[4];
            if (alpha > 0) {
              out = [+rm[1], +rm[2], +rm[3]];
              if (alpha < 1) warnOnce('반투명 색 "' + s + '" 은 불투명으로 그립니다. 흐리게 하려면 draw 의 alpha 옵션을 쓰세요.');
            }
          }
        }
      } catch (e) { out = null; }
    }
    if (!known) warnOnce('알 수 없는 색이라 그 부분을 그리지 않습니다: ' + s);
    colorCache[s] = out;
    return out;
  }

  /*
   * 스프라이트를 1배 크기 캔버스로 만든다 (한 번 만들면 재사용하므로 돌려받은 캔버스는 수정하지 말 것).
   * outline(색)을 주면 로고 전체 윤곽 바깥에 1픽셀 테두리를 두른다. 이때 캔버스는 사방 1픽셀씩 커진다.
   */
  function canvas(key, variant, outline) {
    var sp = sprite(key);
    if (!sp || typeof document === 'undefined') return null;
    var pal = palette(variant);
    var oc = parseColor(outline);
    var pad = oc ? 1 : 0;
    var ck = key + '|' + paletteKey(pal) + '|' + (oc ? oc.join('.') : '');
    if (canvasCache[ck]) return canvasCache[ck];
    var cw = sp.w + pad * 2, ch = sp.h + pad * 2;
    var c = document.createElement('canvas');
    c.width = cw;
    c.height = ch;
    var g = c.getContext('2d');
    var img = g.createImageData(cw, ch), d = img.data, map = decode(key);
    var rgb = [null, parseColor(pal.r), parseColor(pal.f), parseColor(pal.e), parseColor(pal.w)];
    var x, y, o;
    if (oc) {
      // 보이는 픽셀의 8방향 이웃을 테두리 색으로 칠한다 (본체는 아래에서 덮어쓴다)
      for (y = 0; y < sp.h; y++) {
        for (x = 0; x < sp.w; x++) {
          if (!rgb[map[y * sp.w + x]]) continue;
          for (var dy = 0; dy <= 2; dy++) {
            for (var dx = 0; dx <= 2; dx++) {
              o = ((y + dy) * cw + x + dx) * 4;
              d[o] = oc[0]; d[o + 1] = oc[1]; d[o + 2] = oc[2]; d[o + 3] = 255;
            }
          }
        }
      }
    }
    for (y = 0; y < sp.h; y++) {
      for (x = 0; x < sp.w; x++) {
        var col = rgb[map[y * sp.w + x]];
        if (!col) continue;
        o = ((y + pad) * cw + x + pad) * 4;
        d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    canvasCache[ck] = c;
    return c;
  }

  /*
   * pick(kind, maxW, maxH) — 주어진 폭(과 높이)에 들어가는 가장 큰 스프라이트의 키.
   * 'full' 이 하나도 안 들어가면 'mark' 중에서 고른다. 아무것도 안 들어가면 null.
   */
  function pick(kind, maxW, maxH) {
    var list = keys(kind), all = sprites(), best = null;
    for (var i = 0; i < list.length; i++) {
      var sp = all[list[i]];
      if (sp.w <= maxW && (maxH == null || sp.h <= maxH)) best = list[i];
    }
    if (!best && kind === 'full') return pick('mark', maxW, maxH);
    return best;
  }

  function cleanScale(scale) {
    var s = Math.round(+scale);
    if (!isFinite(s) || s < 1) return 1;     // NaN, 무한대, 0, 음수, 숫자가 아닌 값
    return s > MAX_SCALE ? MAX_SCALE : s;
  }

  /*
   * draw(g, key, x, y, opts) — 로고를 그린다. 그린 영역 { x, y, w, h, key } 를 돌려주고, 그릴 수 없으면 null.
   * opts: { variant, scale(정수, 기본 1), align: 'left'|'center'|'right', valign: 'top'|'middle'|'bottom',
   *         alpha(0~1, 범위를 벗어나면 잘라낸다), outline(색: 윤곽 바깥에 1픽셀 테두리) }
   * 위치·크기는 테두리를 뺀 로고 본체 기준이다. 테두리는 그 바깥으로 scale 픽셀씩 더 나간다.
   */
  function draw(g, key, x, y, opts) {
    opts = opts || {};
    var sp = sprite(key);
    if (!sp || !g || !isFinite(x) || !isFinite(y)) return null;
    var c = canvas(key, opts.variant, opts.outline);
    if (!c) return null;
    var scale = cleanScale(opts.scale == null ? 1 : opts.scale);
    var pad = (c.width - sp.w) / 2;                    // 테두리가 있으면 1, 없으면 0
    var w = sp.w * scale, h = sp.h * scale;
    x = Math.round(x);
    y = Math.round(y);
    if (opts.align === 'center') x -= Math.round(w / 2);
    else if (opts.align === 'right') x -= w;
    if (opts.valign === 'middle') y -= Math.round(h / 2);
    else if (opts.valign === 'bottom') y -= h;
    var a = 1;
    if (opts.alpha != null) {
      a = +opts.alpha;
      if (!(a > 0)) a = 0;                             // 음수·NaN 은 "안 보임" (페이드가 끝을 지나쳐도 번쩍이지 않게)
      else if (a > 1) a = 1;
    }
    if (a > 0) {
      var smooth = g.imageSmoothingEnabled, alpha = g.globalAlpha, failed = false;
      try {
        g.imageSmoothingEnabled = false;
        g.globalAlpha = alpha * a;
        g.drawImage(c, x - pad * scale, y - pad * scale, c.width * scale, c.height * scale);
      } catch (e) {
        failed = true;                                 // 로고는 장식이므로 게임 루프를 멈추지 않는다 (호출부는 null 을 보고 글자 로고로 대체)
        warnOnce('로고를 그리지 못했습니다: ' + (e && e.message ? e.message : e));
      } finally {
        g.globalAlpha = alpha;
        g.imageSmoothingEnabled = smooth;
      }
      if (failed) return null;
    }
    return { x: x, y: y, w: w, h: h, key: key };
  }

  // 폭 maxW 안에 들어가는 가장 큰 것을 골라 그린다. opts.maxH 로 높이도 제한할 수 있다.
  function drawFit(g, kind, x, y, maxW, opts) {
    opts = opts || {};
    var scale = cleanScale(opts.scale == null ? 1 : opts.scale);
    var key = pick(kind, Math.floor(maxW / scale), opts.maxH != null ? Math.floor(opts.maxH / scale) : null);
    if (!key) return null;
    return draw(g, key, x, y, opts);
  }

  // DOM <img> 에 쓸 PNG data URL. scale 배로 키워서(가장 가까운 픽셀) 만든다. outline 을 주면 이미지가 사방 scale 픽셀씩 커진다.
  function dataURL(key, variant, scale, outline) {
    var c = canvas(key, variant, outline);
    if (!c) return '';
    scale = cleanScale(scale == null ? 1 : scale);
    var oc = parseColor(outline);
    var uk = key + '|' + paletteKey(palette(variant)) + '|' + scale + '|' + (oc ? oc.join('.') : '');
    if (urlCache[uk]) return urlCache[uk];
    var out = c;
    if (scale !== 1) {
      out = document.createElement('canvas');
      out.width = c.width * scale;
      out.height = c.height * scale;
      var g = out.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(c, 0, 0, out.width, out.height);
    }
    var url = '';
    try { url = out.toDataURL('image/png'); } catch (e) { url = ''; }
    if (url) urlCache[uk] = url;
    return url;
  }

  function clearCache() {
    mapCache = Object.create(null);
    canvasCache = Object.create(null);
    urlCache = Object.create(null);
    colorCache = Object.create(null);
  }

  var api = {
    available: available, info: info, keys: keys, pick: pick, decode: decode,
    canvas: canvas, draw: draw, drawFit: drawFit, dataURL: dataURL, palette: palette, clearCache: clearCache,
    colors: colors, SLOT: SLOT
  };
  KLD.logo = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
