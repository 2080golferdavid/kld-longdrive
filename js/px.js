/*
 * KLD LONG DRIVE — 픽셀 그리기 도구
 * 캔버스의 안티앨리어싱을 피하려고 선·원·다각형을 전부 fillRect로 찍는다.
 */
(function (root) {
  'use strict';
  var KLD = root.KLD = root.KLD || {};

  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, w | 0);
    c.height = Math.max(1, h | 0);
    var g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    return c;
  }

  function rect(g, x, y, w, h, color) {
    if (w <= 0 || h <= 0) return;
    g.fillStyle = color;
    g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  // 굵기 t 의 픽셀 선 (브레젠험, 정사각 붓)
  function line(g, x0, y0, x1, y1, color, t) {
    t = t || 1;
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    var dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    var sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    var err = dx - dy;
    var o = Math.floor((t - 1) / 2);
    g.fillStyle = color;
    for (var guard = 0; guard < 4000; guard++) {
      g.fillRect(x0 - o, y0 - o, t, t);
      if (x0 === x1 && y0 === y1) break;
      var e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
  }

  // 점선 (on 픽셀 그리고 off 픽셀 건너뛴다)
  function dashLine(g, x0, y0, x1, y1, color, on, off) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    var dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    var sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    var err = dx - dy, i = 0, period = on + off;
    g.fillStyle = color;
    for (var guard = 0; guard < 4000; guard++) {
      if (i % period < on) g.fillRect(x0, y0, 1, 1);
      i++;
      if (x0 === x1 && y0 === y1) break;
      var e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
  }

  // 채운 원
  function disc(g, cx, cy, r, color) {
    cx = Math.round(cx); cy = Math.round(cy);
    g.fillStyle = color;
    var r2 = (r + 0.35) * (r + 0.35);
    for (var dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) {
      var half = Math.floor(Math.sqrt(Math.max(0, r2 - dy * dy)));
      if (r2 - dy * dy < 0) continue;
      g.fillRect(cx - half, cy + dy, half * 2 + 1, 1);
    }
  }

  // 채운 타원
  function ellipse(g, cx, cy, rx, ry, color) {
    cx = Math.round(cx); cy = Math.round(cy);
    g.fillStyle = color;
    if (ry < 1) { g.fillRect(cx - Math.round(rx), cy, Math.round(rx) * 2 + 1, 1); return; }
    for (var dy = -Math.ceil(ry); dy <= Math.ceil(ry); dy++) {
      var k = 1 - (dy * dy) / ((ry + 0.35) * (ry + 0.35));
      if (k < 0) continue;
      var half = Math.floor(rx * Math.sqrt(k));
      g.fillRect(cx - half, cy + dy, half * 2 + 1, 1);
    }
  }

  // 볼록 다각형 채우기 (스캔라인)
  function poly(g, pts, color) {
    var minY = Infinity, maxY = -Infinity, i;
    for (i = 0; i < pts.length; i++) {
      if (pts[i][1] < minY) minY = pts[i][1];
      if (pts[i][1] > maxY) maxY = pts[i][1];
    }
    minY = Math.round(minY); maxY = Math.round(maxY);
    g.fillStyle = color;
    for (var y = minY; y <= maxY; y++) {
      var lo = Infinity, hi = -Infinity;
      for (i = 0; i < pts.length; i++) {
        var a = pts[i], b = pts[(i + 1) % pts.length];
        var ay = a[1], by = b[1];
        if (ay === by) {
          if (Math.round(ay) === y) {
            lo = Math.min(lo, a[0], b[0]); hi = Math.max(hi, a[0], b[0]);
          }
          continue;
        }
        var t = (y - ay) / (by - ay);
        if (t < 0 || t > 1) continue;
        var x = a[0] + (b[0] - a[0]) * t;
        if (x < lo) lo = x;
        if (x > hi) hi = x;
      }
      if (lo <= hi) g.fillRect(Math.round(lo), y, Math.round(hi) - Math.round(lo) + 1, 1);
    }
  }

  // 체커 디더 (colorB 를 격자 한 칸 건너 찍는다)
  function dither(g, x, y, w, h, color, phase) {
    x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
    g.fillStyle = color;
    for (var j = 0; j < h; j++) {
      for (var i = ((j + (phase || 0)) & 1); i < w; i += 2) {
        g.fillRect(x + i, y + j, 1, 1);
      }
    }
  }

  // 두꺼운 테두리 상자 (패널)
  function panel(g, x, y, w, h, fill, border, shade) {
    x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
    g.fillStyle = border;
    g.fillRect(x + 1, y, w - 2, h);
    g.fillRect(x, y + 1, w, h - 2);
    g.fillStyle = fill;
    g.fillRect(x + 1, y + 1, w - 2, h - 2);
    if (shade) {
      g.fillStyle = shade;
      g.fillRect(x + 1, y + h - 2, w - 2, 1);
    }
  }

  // 색 유틸
  function hexToRgb(hex) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex(r, g, b) {
    function c(v) { v = Math.max(0, Math.min(255, Math.round(v))); return (v < 16 ? '0' : '') + v.toString(16); }
    return '#' + c(r) + c(g) + c(b);
  }
  function mix(a, b, t) {
    var A = hexToRgb(a), B = hexToRgb(b);
    return rgbToHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
  }

  // 수학 유틸
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  // 키프레임 보간: keys = [[t0, v0], [t1, v1], ...] (t 오름차순)
  function keyframe(keys, t) {
    if (t <= keys[0][0]) return keys[0][1];
    for (var i = 1; i < keys.length; i++) {
      if (t <= keys[i][0]) {
        var a = keys[i - 1], b = keys[i];
        var u = (t - a[0]) / (b[0] - a[0]);
        return a[1] + (b[1] - a[1]) * u;
      }
    }
    return keys[keys.length - 1][1];
  }
  // 시드 난수 (mulberry32)
  function rng(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // 정규분포 난수 (박스-뮬러)
  function gauss(rand) {
    var u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  var api = {
    makeCanvas: makeCanvas, rect: rect, line: line, dashLine: dashLine, disc: disc, ellipse: ellipse,
    poly: poly, dither: dither, panel: panel, hexToRgb: hexToRgb, rgbToHex: rgbToHex, mix: mix,
    clamp: clamp, lerp: lerp, smooth: smooth, keyframe: keyframe, rng: rng, gauss: gauss
  };
  KLD.px = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
