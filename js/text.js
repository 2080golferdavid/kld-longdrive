/*
 * KLD LONG DRIVE — 픽셀 텍스트
 *  - 'bit' : 내장 5x7 비트맵 폰트 (영문 대문자·숫자·기호). 네트워크 없이도 항상 나온다.
 *  - 'ko'  : 웹폰트 Galmuri11 (12px) — 한글용
 *  - 'kos' : 웹폰트 Galmuri9 (10px)  — 작은 한글
 * 웹폰트 글리프는 한 글자씩 작은 캔버스에 그린 뒤 알파를 이진화해서 캐시한다(번짐 없는 1비트 픽셀).
 */
(function (root) {
  'use strict';
  var KLD = root.KLD = root.KLD || {};

  // ── 5x7 비트맵 글리프 ─────────────────────────────────────
  var G = {
    'A': ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
    'B': ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
    'C': ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
    'D': ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
    'E': ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
    'F': ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
    'G': ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
    'H': ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
    'I': ['111', '010', '010', '010', '010', '010', '111'],
    'J': ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
    'K': ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
    'L': ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
    'M': ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
    'N': ['10001', '10001', '11001', '10101', '10011', '10001', '10001'],
    'O': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
    'P': ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
    'Q': ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
    'R': ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
    'S': ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
    'T': ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
    'U': ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
    'V': ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
    'W': ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
    'X': ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
    'Y': ['10001', '10001', '10001', '01010', '00100', '00100', '00100'],
    'Z': ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
    '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
    '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
    '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
    '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
    '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
    '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
    '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
    '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
    '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
    '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
    ' ': ['000', '000', '000', '000', '000', '000', '000'],
    '.': ['00', '00', '00', '00', '00', '11', '11'],
    ',': ['00', '00', '00', '00', '11', '01', '10'],
    ':': ['00', '11', '11', '00', '11', '11', '00'],
    '!': ['11', '11', '11', '11', '11', '00', '11'],
    '?': ['01110', '10001', '00001', '00010', '00100', '00000', '00100'],
    '-': ['0000', '0000', '0000', '1111', '0000', '0000', '0000'],
    '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
    '/': ['00001', '00001', '00010', '00100', '01000', '10000', '10000'],
    '%': ['11001', '11001', '00010', '00100', '01000', '10011', '10011'],
    '\'': ['11', '01', '10', '00', '00', '00', '00'],
    '(': ['001', '010', '100', '100', '100', '010', '001'],
    ')': ['100', '010', '001', '001', '001', '010', '100'],
    '<': ['0001', '0010', '0100', '1000', '0100', '0010', '0001'],
    '>': ['1000', '0100', '0010', '0001', '0010', '0100', '1000'],
    '=': ['0000', '0000', '1111', '0000', '1111', '0000', '0000'],
    '*': ['00000', '00100', '10101', '01110', '10101', '00100', '00000'],
    '#': ['01010', '01010', '11111', '01010', '11111', '01010', '01010'],
    '_': ['00000', '00000', '00000', '00000', '00000', '00000', '11111'],
    '°': ['010', '101', '010', '000', '000', '000', '000'],
    '→': ['00000', '00100', '00010', '11111', '00010', '00100', '00000'],
    '←': ['00000', '00100', '01000', '11111', '01000', '00100', '00000'],
    '↑': ['00100', '01110', '10101', '00100', '00100', '00100', '00100'],
    '↓': ['00100', '00100', '00100', '00100', '10101', '01110', '00100'],
    '▶': ['1000', '1100', '1110', '1111', '1110', '1100', '1000'],
    '◀': ['0001', '0011', '0111', '1111', '0111', '0011', '0001'],
    '●': ['01110', '11111', '11111', '11111', '11111', '11111', '01110'],
    '○': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
    '×': ['00000', '10001', '01010', '00100', '01010', '10001', '00000'],
    '♪': ['00110', '00101', '00100', '00100', '01100', '11100', '01000']
  };

  var WEB = {
    ko:  { px: 12, family: '"Galmuri11"', base: 10, lineH: 12 },
    kos: { px: 10, family: '"Galmuri9"',  base: 8,  lineH: 10 }
  };
  var FALLBACK = '"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", "Nanum Gothic", sans-serif';
  var PAD = 2;               // 글리프 캔버스 위쪽 여백

  var cache = {};            // cache[font|color][ch] = { c, w }
  var advCache = {};         // advCache[font][ch] = 폭
  var measureCtx = null;
  var webFontLoaded = false;

  function getMeasureCtx() {
    if (!measureCtx) measureCtx = KLD.px.makeCanvas(4, 4).getContext('2d');
    return measureCtx;
  }

  function fontString(f) {
    return f.px + 'px ' + f.family + ', ' + FALLBACK;
  }

  function bitGlyph(ch) {
    var rows = G[ch];
    if (!rows && ch >= 'a' && ch <= 'z') rows = G[ch.toUpperCase()];
    return rows || null;
  }

  function makeBitGlyph(rows, color) {
    var w = rows[0].length;
    var c = KLD.px.makeCanvas(w, 7);
    var g = c.getContext('2d');
    g.fillStyle = color;
    for (var y = 0; y < 7; y++) {
      for (var x = 0; x < w; x++) {
        if (rows[y].charAt(x) === '1') g.fillRect(x, y, 1, 1);
      }
    }
    return { c: c, w: w + 1, oy: 0 };
  }

  function webAdvance(fontKey, ch) {
    var a = advCache[fontKey] || (advCache[fontKey] = {});
    if (a[ch] != null) return a[ch];
    var m = getMeasureCtx();
    m.font = fontString(WEB[fontKey]);
    var w = Math.max(1, Math.round(m.measureText(ch).width));
    a[ch] = w;
    return w;
  }

  function makeWebGlyph(fontKey, ch, color) {
    var f = WEB[fontKey];
    var adv = webAdvance(fontKey, ch);
    var w = adv + 2, h = f.px + PAD + 3;
    var c = KLD.px.makeCanvas(w, h);
    var g = c.getContext('2d');
    g.font = fontString(f);
    g.textBaseline = 'alphabetic';
    g.fillStyle = color;
    g.fillText(ch, 0, f.base + PAD);
    // 알파 이진화: 반투명 가장자리를 없애 또렷한 픽셀로 만든다
    try {
      var img = g.getImageData(0, 0, w, h), d = img.data;
      for (var i = 3; i < d.length; i += 4) d[i] = d[i] >= 112 ? 255 : 0;
      g.putImageData(img, 0, 0);
    } catch (e) { /* 보안 제한 등으로 실패해도 그대로 쓴다 */ }
    return { c: c, w: adv, oy: PAD };
  }

  function getGlyph(fontKey, ch, color) {
    var key = fontKey + '|' + color;
    var m = cache[key] || (cache[key] = {});
    var gph = m[ch];
    if (gph) return gph;
    if (fontKey === 'bit') {
      var rows = bitGlyph(ch);
      gph = rows ? makeBitGlyph(rows, color) : null;
      if (!gph) {
        // 비트맵 폰트에 없는 글자(한글 등)는 작은 웹폰트로 대신한다
        gph = makeWebGlyph('kos', ch, color);
        gph = { c: gph.c, w: gph.w, oy: gph.oy + 1 };
      }
    } else {
      gph = makeWebGlyph(fontKey, ch, color);
    }
    m[ch] = gph;
    return gph;
  }

  function advance(fontKey, ch) {
    if (fontKey === 'bit') {
      var rows = bitGlyph(ch);
      if (rows) return rows[0].length + 1;
      return webAdvance('kos', ch);
    }
    return webAdvance(fontKey, ch);
  }

  /*
   * 문자열을 "화면에서 한 글자로 보이는 묶음"으로 나눈다.
   * 보통 글자는 그대로 한 자씩이고, 이모지(서로게이트 쌍), 피부색·국기·가족 이모지(여러 코드가 합쳐진 것),
   * 풀어 쓴 한글 자모처럼 여러 코드가 한 글자를 이루는 경우만 묶는다. 이름 입력에 이모지를 넣어도 카드에 깨지지 않는다.
   */
  var COMPLEX = /[\u0300-\u036f\u1100-\u11ff\u200d\ufe0e\ufe0f\ud800-\udfff]/;
  var segmenter = null, unitCache = {}, unitCount = 0;
  function units(str) {
    if (!COMPLEX.test(str)) return null;                 // 빠른 길: 한 자씩 (호출하는 쪽에서 charAt 으로 돈다)
    var hit = unitCache[str];
    if (hit) return hit;
    var out = [], i;
    if (segmenter === null) {
      try { segmenter = (typeof Intl !== 'undefined' && Intl.Segmenter) ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : false; }
      catch (e) { segmenter = false; }
    }
    if (segmenter) {
      var it = segmenter.segment(str)[Symbol.iterator](), step;
      while (!(step = it.next()).done) out.push(step.value.segment);
    } else {
      // 구형 브라우저: 서로게이트 쌍만 묶고, 혼자서는 그릴 수 없는 결합 기호는 버린다
      for (i = 0; i < str.length; i++) {
        var c = str.charCodeAt(i), ch = str.charAt(i);
        if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) { ch = str.substr(i, 2); i++; }
        else if (c === 0x200D || c === 0xFE0E || c === 0xFE0F) continue;
        out.push(ch);
      }
    }
    if (unitCount > 400) { unitCache = {}; unitCount = 0; }
    unitCache[str] = out; unitCount++;
    return out;
  }

  function measure(str, opts) {
    opts = opts || {};
    var fontKey = opts.font || 'bit', scale = opts.scale || 1;
    str = String(str);
    var w = 0, i, u = units(str);
    if (u) for (i = 0; i < u.length; i++) w += advance(fontKey, u[i]);
    else for (i = 0; i < str.length; i++) w += advance(fontKey, str.charAt(i));
    if (fontKey === 'bit' && str.length) w -= 1;      // 마지막 글자 뒤 간격 제외
    return w * scale;
  }

  function height(opts) {
    opts = opts || {};
    var fontKey = opts.font || 'bit', scale = opts.scale || 1;
    return (fontKey === 'bit' ? 7 : WEB[fontKey].lineH) * scale;
  }

  function drawRun(g, str, x, y, fontKey, color, scale) {
    var cx = x, u = units(str), n = u ? u.length : str.length;
    for (var i = 0; i < n; i++) {
      var ch = u ? u[i] : str.charAt(i);
      var gph = getGlyph(fontKey, ch, color);
      if (ch !== ' ') {
        if (scale === 1) g.drawImage(gph.c, cx, y - gph.oy);
        else g.drawImage(gph.c, cx, y - gph.oy * scale, gph.c.width * scale, gph.c.height * scale);
      }
      cx += gph.w * scale;
    }
  }

  /*
   * draw(g, str, x, y, opts)
   * opts: { font: 'bit'|'ko'|'kos', color, scale, align: 'left'|'center'|'right', shadow, outline }
   * (x, y) 는 글자 상자의 왼쪽 위(정렬에 따라 가운데·오른쪽 기준).
   */
  function draw(g, str, x, y, opts) {
    opts = opts || {};
    str = String(str);
    var fontKey = opts.font || 'bit';
    var scale = opts.scale || 1;
    var color = opts.color || '#ffffff';
    var w = measure(str, opts);
    x = Math.round(x); y = Math.round(y);
    if (opts.align === 'center') x -= Math.round(w / 2);
    else if (opts.align === 'right') x -= w;
    var o = scale;
    if (opts.outline) {
      drawRun(g, str, x - o, y, fontKey, opts.outline, scale);
      drawRun(g, str, x + o, y, fontKey, opts.outline, scale);
      drawRun(g, str, x, y - o, fontKey, opts.outline, scale);
      drawRun(g, str, x, y + o, fontKey, opts.outline, scale);
      drawRun(g, str, x - o, y - o, fontKey, opts.outline, scale);
      drawRun(g, str, x + o, y - o, fontKey, opts.outline, scale);
      drawRun(g, str, x - o, y + o, fontKey, opts.outline, scale);
      drawRun(g, str, x + o, y + o, fontKey, opts.outline, scale);
    }
    if (opts.shadow) drawRun(g, str, x + o, y + o, fontKey, opts.shadow, scale);
    drawRun(g, str, x, y, fontKey, color, scale);
    return w;
  }

  /*
   * 로고용 큰 글자: 비트맵 글리프를 scale 배로 찍고, 줄마다 다른 색(rowColors)을 쓴다.
   */
  function drawBig(g, str, x, y, scale, rowColors, outline, shadow, align) {
    str = String(str).toUpperCase();
    var w = measure(str, { font: 'bit', scale: scale });
    x = Math.round(x); y = Math.round(y);
    if (align === 'center') x -= Math.round(w / 2);
    else if (align === 'right') x -= w;
    function pass(dx, dy, colorFn) {
      var cx = x + dx, u = units(str), n = u ? u.length : str.length;
      for (var i = 0; i < n; i++) {
        var rows = bitGlyph(u ? u[i] : str.charAt(i)) || G[' '];
        for (var r = 0; r < 7; r++) {
          g.fillStyle = colorFn(r);
          for (var c = 0; c < rows[r].length; c++) {
            if (rows[r].charAt(c) === '1') g.fillRect(cx + c * scale, y + dy + r * scale, scale, scale);
          }
        }
        cx += (rows[0].length + 1) * scale;
      }
    }
    var o = Math.max(1, Math.round(scale / 2));
    if (shadow) pass(o * 2, o * 2, function () { return shadow; });
    if (outline) {
      var offs = [[-o, 0], [o, 0], [0, -o], [0, o], [-o, -o], [o, -o], [-o, o], [o, o]];
      for (var k = 0; k < offs.length; k++) pass(offs[k][0], offs[k][1], function () { return outline; });
    }
    pass(0, 0, function (r) { return rowColors[Math.min(r, rowColors.length - 1)]; });
    return w;
  }

  function clearCache() {
    cache = {};
    advCache = {};
  }

  // 웹폰트를 불러 본다. 불러왔으면 (대체 폰트로 만들어 둔) 글리프 캐시를 비워 다시 그리게 한다.
  function tryLoad() {
    return Promise.all([
      document.fonts.load('12px "Galmuri11"', '가A1'),
      document.fonts.load('10px "Galmuri9"', '가A1')
    ]).then(function (res) {
      if (res[0] && res[0].length) { webFontLoaded = true; clearCache(); }
      return webFontLoaded;
    }).catch(function () { return webFontLoaded; });
  }

  // 웹폰트 로딩을 기다린다. 실패하거나 느리면 대체 폰트로 계속 진행하고, 늦게 도착하면 그때 바꿔 그린다.
  function init(timeoutMs) {
    if (typeof document === 'undefined' || !document.fonts || !document.fonts.load) {
      return Promise.resolve(false);
    }
    var loads = tryLoad();
    // 폰트 스타일시트는 화면을 막지 않게 늦게 붙으므로(index.html), 도착하면 한 번 더 시도한다
    var link = document.getElementById && document.getElementById('font-css');
    if (link && link.addEventListener) link.addEventListener('load', function () { setTimeout(tryLoad, 0); });
    // DOM 쪽에서 폰트가 늦게 로딩된 경우에도 캔버스 글자를 다시 만든다
    if (document.fonts.addEventListener) {
      document.fonts.addEventListener('loadingdone', function (ev) {
        var faces = (ev && ev.fontfaces) || [], hit = false;
        for (var i = 0; i < faces.length; i++) if (/Galmuri/i.test(String(faces[i].family))) hit = true;
        if (hit) webFontLoaded = true;
        if (hit || !faces.length) clearCache();
      });
    }
    var timeout = new Promise(function (resolve) {
      setTimeout(function () { resolve(false); }, timeoutMs || 2500);
    });
    return Promise.race([loads, timeout]).then(function (ok) {
      clearCache();
      return ok || webFontLoaded;
    });
  }

  var api = {
    init: init, draw: draw, drawBig: drawBig, measure: measure, height: height, clearCache: clearCache,
    isWebFontLoaded: function () { return webFontLoaded; },
    units: function (str) { str = String(str); return units(str) || str.split(''); },
    hasGlyph: function (ch) { return !!bitGlyph(ch); }
  };
  KLD.text = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
