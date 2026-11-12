/*
 * KLD LONG DRIVE — 렌더러
 * 플레이 화면 전체(월드·HUD·게이지·미니맵·버튼)를 저해상도 캔버스에 그린다.
 * 게임 상태 G 는 game.js 가 만들고, 여기서는 읽기만 한다.
 */
(function (root) {
  'use strict';
  var KLD = root.KLD = root.KLD || {};
  var P = KLD.px, T = KLD.text;

  var PPM = 1.5;                  // 가로: 1m 당 픽셀
  var YD = 0.9144;                // 1야드 = 0.9144m
  var GRID_HALF = 30 * YD;        // 그리드 반폭(m) — init 때 설정값으로 덮어쓴다

  // 색각 이상에도 읽히도록 파랑·노랑 축과 밝기 차이로 구분한다
  var COL = {
    safe: '#3fa7ff', full: '#ffd23f', over: '#ff5a4d',
    perfect: '#ffffff', great: '#ffd23f', good: '#3fa7ff',
    target: '#7ee6f7', best: '#ffd23f', gold: '#ffd23f',
    ok: '#8ff0a0', bad: '#ff8f85', ink: '#070a1c'
  };

  var V = {
    canvas: null, g: null, W: 320, H: 200, sDev: 1, cssScale: 1, left: 0, top: 0,
    L: null, Lfull: null, Ldeck: null
  };

  // ── 테마 ────────────────────────────────────────────────
  var THEMES = {
    morning: {
      dark: false,
      sky: ['#58aef0', '#7dc4f6', '#a8dcfa', '#d6f1fd'],
      sun: { x: 0.8, y: 0.3, r: 9, color: '#fff7c2', glow: '#ffe98a' }, stars: false,
      cloud: '#ffffff', cloudShade: '#cfe8f7',
      mtnFar: '#9cc3e4', mtnNear: '#78a6cf',
      tree: '#3c8f58', treeLight: '#55a86a', treeDark: '#2c7346',
      roughFar: '#3f9b4c', roughFarDark: '#348741',
      fairA: '#74c450', fairB: '#66b646',
      roughNear: '#2f8c43', roughNearDark: '#277a3a', tuft: '#4fae58',
      line: '#f6f6f0', ink: '#141c33', shadow: '#2d7a3c',
      signBg: '#fbfbf2', signInk: '#141c33', standA: '#aab4c8', standB: '#8793ab', glow: null
    },
    day: {
      dark: false,
      sky: ['#2f8fe8', '#4fa6f0', '#7cc0f7', '#abd9fb'],
      sun: { x: 0.7, y: 0.16, r: 8, color: '#ffffff', glow: '#fff4b0' }, stars: false,
      cloud: '#ffffff', cloudShade: '#c4e0f5',
      mtnFar: '#7ea9d6', mtnNear: '#5f8fc4',
      tree: '#2f8a4c', treeLight: '#48a55f', treeDark: '#226c3b',
      roughFar: '#399647', roughFarDark: '#2e823c',
      fairA: '#6cc04a', fairB: '#5fb242',
      roughNear: '#2b873f', roughNearDark: '#237536', tuft: '#49a953',
      line: '#f6f6f0', ink: '#141c33', shadow: '#2a7638',
      signBg: '#fbfbf2', signInk: '#141c33', standA: '#aab4c8', standB: '#8793ab', glow: null
    },
    sunset: {
      dark: true,
      sky: ['#3d3273', '#8b4380', '#e06a55', '#fbb347'],
      sun: { x: 0.74, y: 0.74, r: 13, color: '#ffe27a', glow: '#ff9d4d' }, stars: false,
      cloud: '#ffd3b3', cloudShade: '#e58f7c',
      mtnFar: '#6a4479', mtnNear: '#4d2f62',
      tree: '#2c5244', treeLight: '#3f6b52', treeDark: '#213f36',
      roughFar: '#3d7f3c', roughFarDark: '#336e33',
      fairA: '#7ab648', fairB: '#6ca63f',
      roughNear: '#34753a', roughNearDark: '#2a6431', tuft: '#54964a',
      line: '#fff3dc', ink: '#1d1430', shadow: '#2c6233',
      signBg: '#fff3dc', signInk: '#1d1430', standA: '#9a8fa8', standB: '#7a6f8a', glow: null
    },
    night: {
      dark: true,
      sky: ['#090d28', '#11183f', '#1a2558', '#263672'],
      sun: { x: 0.78, y: 0.2, r: 7, color: '#f4f1d0', glow: '#8f9bd0', moon: true }, stars: true,
      cloud: '#34437a', cloudShade: '#263466',
      mtnFar: '#172050', mtnNear: '#10173a',
      tree: '#12352e', treeLight: '#1b4a3d', treeDark: '#0c2621',
      roughFar: '#256b3d', roughFarDark: '#1d5932',
      fairA: '#55b455', fairB: '#49a54b',
      roughNear: '#1f6338', roughNearDark: '#18522e', tuft: '#34864a',
      line: '#ffffff', ink: '#070a1c', shadow: '#1b5a33',
      signBg: '#ffe98a', signInk: '#141c33', standA: '#56618a', standB: '#414b70', glow: '#fff7c2'
    }
  };

  var cur = { themeName: 'day', th: THEMES.day, skyC: null, mtnFarC: null, mtnNearC: null, treeC: null, roughC: null, key: '' };
  var cloudSprites = null;

  function hasLogo() { return !!(KLD.logo && KLD.logo.available && KLD.logo.available()); }

  // ── 초기화·크기 ──────────────────────────────────────────
  function init(canvas) {
    V.canvas = canvas;
    V.g = canvas.getContext('2d', { alpha: false });
    V.g.imageSmoothingEnabled = false;
    GRID_HALF = KLD.config.rules.gridWidthYd * YD / 2;
    resize();
  }

  function viewportSize() {
    var vv = root.visualViewport;
    // 핀치로 확대하면 visualViewport 가 그만큼 작아진다. 배율을 되돌려 실제 화면 크기로 맞춘다.
    // (화면 키보드가 올라온 경우는 배율이 그대로라 높이만 줄어든다.)
    var k = (vv && vv.scale > 0) ? vv.scale : 1;
    var w = vv && vv.width ? vv.width * k : root.innerWidth;
    var h = vv && vv.height ? vv.height * k : root.innerHeight;
    return { w: Math.max(1, w), h: Math.max(1, h) };
  }

  function resize() {
    var dpr = Math.max(1, root.devicePixelRatio || 1);
    var vp = viewportSize();
    var cssW = vp.w, cssH = vp.h;
    var devW = Math.round(cssW * dpr), devH = Math.round(cssH * dpr);
    var s = Math.max(1, Math.floor(Math.min(devW, devH) / 200));
    // 긴 변도 본다. 정사각형에 가까운 화면(태블릿 세로, 펼친 폴더블)에서 짧은 변만 보고 배율을 잡으면
    // 세로형은 높이가, 가로형은 폭이 모자라 플레이 화면이 찌그러진다. (세로형 H ≥ 340, 가로형 W ≥ 300)
    if (devH > devW * 1.15) s = Math.max(1, Math.min(s, Math.floor(devH / 340)));
    else s = Math.max(1, Math.min(s, Math.floor(devW / 300)));
    var W = Math.floor(devW / s), H = Math.floor(devH / s);
    W = Math.min(W, 480); H = Math.min(H, 560);
    W = Math.max(W, 160); H = Math.max(H, 160);
    var cssScale = s / dpr;
    // 화면이 너무 작아 최소 해상도를 못 채우면 CSS에서 축소한다
    if (W * cssScale > cssW + 0.5 || H * cssScale > cssH + 0.5) cssScale = Math.min(cssW / W, cssH / H);
    V.W = W; V.H = H; V.sDev = s; V.cssScale = cssScale;
    V.canvas.width = W; V.canvas.height = H;
    V.g.imageSmoothingEnabled = false;
    var dispW = W * cssScale, dispH = H * cssScale;
    V.left = Math.round((cssW - dispW) / 2 * dpr) / dpr;
    V.top = Math.round((cssH - dispH) / 2 * dpr) / dpr;
    V.canvas.style.width = dispW + 'px';
    V.canvas.style.height = dispH + 'px';
    V.canvas.style.left = V.left + 'px';
    V.canvas.style.top = V.top + 'px';
    V.Ldeck = computeLayout(W, H, true);
    V.Lfull = computeLayout(W, H, false);
    V.L = V.Ldeck;
    cur.key = '';                                    // 캐시 무효화
    return V;
  }

  /*
   * 레이아웃. 세로형은 위에서부터 월드 → 게이지 → 미니맵 → 버튼.
   * 게이지를 월드 바로 아래에 두어 눈은 게이지에, 엄지는 맨 아래 SWING 에 가도록 한다.
   */
  function computeLayout(W, H, withDeck) {
    var portrait = H > W * 1.15;
    var L = { portrait: portrait, W: W, H: H, deckShown: withDeck, btn: {} };
    var pad = 4, y, deckH;
    if (!withDeck) {
      L.world = { x: 0, y: 0, w: W, h: H };
      L.deck = null;
    } else if (portrait) {
      deckH = P.clamp(Math.round(H * 0.42), 158, 236);
      L.world = { x: 0, y: 0, w: W, h: H - deckH };
      L.deck = { x: 0, y: H - deckH, w: W, h: deckH };
      y = L.deck.y + 6;
      L.gauge = { x: pad, y: y, w: W - pad * 2, h: 46 }; y += 46 + 4;
      L.minimap = { x: pad, y: y, w: W - pad * 2, h: 44 }; y += 44 + 4;
      var bh = H - y - 6;                            // 맨 아래 6px 은 비워 둔다 (브라우저 하단 바 오탭 방지)
      if (bh >= 84) {
        var half = Math.floor((W - pad * 2 - 4) / 2), ab = 36;
        L.btn.aimL = { x: pad, y: y, w: ab, h: 32 };
        L.btn.aimR = { x: pad + half - ab, y: y, w: ab, h: 32 };
        L.aimRead = { x: pad + ab, y: y, w: half - ab * 2, h: 32 };
        L.btn.traj = { x: pad + half + 4, y: y, w: W - pad - (pad + half + 4), h: 32 };
        L.btn.swing = { x: pad, y: y + 36, w: W - pad * 2, h: bh - 36 };
      } else {
        L.btn.aimL = { x: pad, y: y, w: 28, h: bh };
        L.btn.aimR = { x: pad + 30, y: y, w: 28, h: bh };
        L.btn.traj = { x: pad + 62, y: y, w: 44, h: bh };
        L.btn.swing = { x: pad + 110, y: y, w: W - pad - (pad + 110), h: bh };
        L.aimRead = null;
      }
    } else {
      deckH = 52;
      L.world = { x: 0, y: 0, w: W, h: H - deckH };
      L.deck = { x: 0, y: H - deckH, w: W, h: deckH };
      y = L.deck.y + 5;
      var h = deckH - 9;
      var gW = Math.floor(W * 0.38);
      L.gauge = { x: pad, y: y, w: gW, h: h };
      var mmW = Math.floor(W * 0.32);
      L.minimap = { x: pad + gW + 4, y: y, w: mmW, h: h };
      var bx = L.minimap.x + mmW + 4, bw = W - bx - pad;
      var third = Math.floor((bw - 4) / 3);
      L.btn.aimL = { x: bx, y: y, w: third, h: 18 };
      L.btn.aimR = { x: bx + third + 2, y: y, w: third, h: 18 };
      L.btn.traj = { x: bx + (third + 2) * 2, y: y, w: bw - (third + 2) * 2, h: 18 };
      L.btn.swing = { x: bx, y: y + 20, w: bw, h: h - 20 };
      L.aimRead = null;
    }
    var groundH = portrait ? 74 : 56;
    // 타이틀(덱 없음): 아래쪽에 DOM 메뉴가 얹히므로 선수가 메뉴 위로 보이도록 지면 띠를 넉넉히 잡는다
    if (!withDeck) groundH = portrait ? Math.max(Math.round(H * 0.3), 160) : Math.max(Math.round(H * 0.36), 76);
    L.groundH = groundH;
    L.horizon = L.world.y + L.world.h - groundH;
    L.farRoughH = 12;
    L.fairH = portrait ? 32 : 24;
    L.farLineY = L.horizon + L.farRoughH;
    L.fairTop = L.farLineY + 1;
    L.nearLineY = L.fairTop + L.fairH;
    L.fairCY = L.fairTop + Math.floor(L.fairH / 2);
    L.worldBottom = L.world.y + L.world.h;
    L.pxPerZ = (L.fairH / 2) / GRID_HALF;
    L.skyH = L.horizon - L.world.y;
    // 공이 올라갈 수 있는 위쪽 한계 (그 위는 HUD 와 큰 숫자 자리). 이보다 높으면 화살표로 높이만 알려 준다.
    L.topLimit = L.world.y + (portrait ? 70 : 30);
    // 세로 배율: 높은 탄도의 정점(약 74m)까지 그 한계 아래에 들어오게 잡는다
    L.ppmY = P.clamp((L.fairCY - 2 - L.topLimit) / 74, 0.9, 2.6);
    // 아이콘 버튼 (일시정지·소리)
    // 조준·탄도 버튼이 둘 다 잠긴 라운드에서 쓰는 큰 스윙 버튼
    if (withDeck) {
      var top = Math.min(L.btn.swing.y, L.btn.aimL.y), left = Math.min(L.btn.swing.x, L.btn.aimL.x);
      L.btn.swingFull = { x: left, y: top, w: L.btn.swing.x + L.btn.swing.w - left, h: L.btn.swing.y + L.btn.swing.h - top };
    }
    L.btn.pause = { x: W - 17, y: 31, w: 14, h: 14 };
    L.btn.mute = { x: W - 34, y: 31, w: 14, h: 14 };
    return L;
  }

  // ── 좌표 변환 ────────────────────────────────────────────
  var camX = 0;
  function wx(x) { return Math.round(V.L.world.x + (x - camX) * PPM); }
  function gy(z) {
    var L = V.L;
    var y = L.fairCY + Math.round(z * L.pxPerZ);
    return P.clamp(y, L.horizon + 4, L.worldBottom - 4);
  }

  // ── 캐시된 배경 레이어 ───────────────────────────────────
  function ensureCaches() {
    var L = V.L;
    var key = cur.themeName + '|' + V.W + 'x' + V.H + '|' + L.horizon + '|' + L.worldBottom;
    if (key === cur.key) return;
    cur.key = key;
    var th = cur.th;
    buildSky(th, L);
    cur.mtnFarC = buildMountains(th.mtnFar, 512, 54, 11, 0.9);
    cur.mtnNearC = buildMountains(th.mtnNear, 512, 34, 29, 1.7);
    cur.treeC = buildTrees(th);
    cur.roughC = buildRough(th, L);
    if (!cloudSprites || cloudSprites.key !== cur.themeName) buildClouds(th);
  }

  function buildSky(th, L) {
    var w = L.world.w, h = Math.max(8, L.skyH + 2);
    var c = P.makeCanvas(w, h), g = c.getContext('2d');
    var parts = [0.36, 0.26, 0.21, 0.17], y = 0, i;
    for (i = 0; i < 4; i++) {
      var bh = i === 3 ? h - y : Math.round(h * parts[i]);
      P.rect(g, 0, y, w, bh, th.sky[i]);
      if (i > 0) {                                  // 띠 경계에 디더 두 줄
        P.dither(g, 0, y - 2, w, 2, th.sky[i], 0);
        P.dither(g, 0, y, w, 2, th.sky[i - 1], 1);
      }
      y += bh;
    }
    if (th.stars) {
      var r = P.rng(7);
      for (i = 0; i < Math.round(w * h / 260); i++) {
        var sx = Math.floor(r() * w), sy = Math.floor(r() * h * 0.8);
        P.rect(g, sx, sy, 1, 1, r() < 0.3 ? '#ffffff' : '#9fb0e8');
      }
    }
    // 해·달
    var s = th.sun, cx = Math.round(w * s.x), cy = Math.round(h * s.y);
    P.disc(g, cx, cy, s.r + 2, s.glow);
    P.disc(g, cx, cy, s.r, s.color);
    if (s.moon) P.disc(g, cx + 3, cy - 2, s.r - 1, th.sky[0]);
    cur.skyC = c;
  }

  // 이음매 없는 산 능선 타일 (주기가 타일 폭의 약수인 사인 합)
  function buildMountains(color, tw, maxH, seed, rough) {
    var c = P.makeCanvas(tw, maxH), g = c.getContext('2d');
    var r = P.rng(seed);
    var ph = [r() * 6.28, r() * 6.28, r() * 6.28, r() * 6.28];
    g.fillStyle = color;
    for (var x = 0; x < tw; x++) {
      var a = x / tw * Math.PI * 2;
      var v = 0.5 + 0.26 * Math.sin(a * 2 + ph[0]) + 0.16 * Math.sin(a * 5 + ph[1]) +
              0.08 * Math.sin(a * 11 + ph[2]) * rough + 0.04 * Math.sin(a * 23 + ph[3]) * rough;
      var hh = Math.round(P.clamp(v, 0.12, 1) * maxH);
      g.fillRect(x, maxH - hh, 1, hh);
    }
    return c;
  }

  function buildTrees(th) {
    var tw = 256, hh = 20;
    var c = P.makeCanvas(tw, hh), g = c.getContext('2d');
    var r = P.rng(41), x;
    P.rect(g, 0, hh - 6, tw, 6, th.treeDark);
    for (x = 0; x < tw; x += 8) {
      var rad = 4 + Math.floor(r() * 3), cy = hh - 6 - Math.floor(r() * 3);
      P.disc(g, x + 4, cy, rad, th.tree);
      P.disc(g, x + 3, cy - 1, rad - 2, th.treeLight);
    }
    for (x = 0; x < tw; x += 16) P.rect(g, x + 7, hh - 4, 1, 4, th.treeDark);
    return c;
  }

  function buildRough(th, L) {
    var tw = 96, hh = Math.max(4, L.worldBottom - L.nearLineY);
    var c = P.makeCanvas(tw, hh), g = c.getContext('2d');
    P.rect(g, 0, 0, tw, hh, th.roughNear);
    var r = P.rng(5), n = Math.round(tw * hh / 14), i;
    for (i = 0; i < n; i++) {
      var x = Math.floor(r() * tw), y = Math.floor(r() * hh);
      P.rect(g, x, y, 1, 1 + (r() < 0.4 ? 1 : 0), r() < 0.5 ? th.tuft : th.roughNearDark);
    }
    return c;
  }

  function buildClouds(th) {
    var shapes = [
      [[6, 8, 5], [13, 6, 6], [21, 8, 5], [27, 9, 3]],
      [[5, 7, 4], [11, 6, 5], [17, 7, 4]],
      [[7, 9, 6], [16, 7, 8], [26, 9, 6], [33, 10, 4], [3, 11, 3]]
    ];
    var list = [];
    for (var i = 0; i < shapes.length; i++) {
      var c = P.makeCanvas(40, 18), g = c.getContext('2d'), s = shapes[i], k;
      for (k = 0; k < s.length; k++) P.disc(g, s[k][0], s[k][1] + 1, s[k][2], th.cloudShade);
      for (k = 0; k < s.length; k++) P.disc(g, s[k][0], s[k][1] - 1, s[k][2], th.cloud);
      g.clearRect(0, 13, 40, 5);                     // 바닥을 평평하게
      list.push(c);
    }
    var r = P.rng(99), items = [];
    for (var n = 0; n < 9; n++) {
      items.push({ x: r() * 700, y: 0.06 + r() * 0.42, sp: Math.floor(r() * 3), par: 0.03 + r() * 0.05 });
    }
    cloudSprites = { key: cur.themeName, list: list, items: items };
  }

  function setTheme(name) {
    if (!THEMES[name]) name = 'day';
    if (cur.themeName !== name) {
      cur.themeName = name; cur.th = THEMES[name]; cur.key = '';
    }
  }

  // ── 월드 ────────────────────────────────────────────────
  function tile(g, c, offset, y) {
    var tw = c.width;
    var o = ((Math.round(offset) % tw) + tw) % tw;
    for (var x = -o; x < V.L.world.w; x += tw) g.drawImage(c, V.L.world.x + x, y);
  }

  function drawBackground(G) {
    var g = V.g, L = V.L;
    g.drawImage(cur.skyC, L.world.x, L.world.y);
    // 구름: 바람 + 패럴랙스
    var items = cloudSprites.items, list = cloudSprites.list, i;
    var drift = G.time * (1.2 + (G.wind ? G.wind.x : 0) * 0.9);
    for (i = 0; i < items.length; i++) {
      var it = items[i];
      var x = it.x + drift * (0.6 + it.par * 6) - camX * PPM * it.par;
      x = ((x % 760) + 760) % 760 - 60;
      if (x > L.world.w) continue;
      g.drawImage(list[it.sp], Math.round(L.world.x + x), Math.round(L.world.y + L.skyH * it.y));
    }
    tile(g, cur.mtnFarC, camX * PPM * 0.06, L.horizon - cur.mtnFarC.height - 6);
    tile(g, cur.mtnNearC, camX * PPM * 0.13, L.horizon - cur.mtnNearC.height - 2);
    tile(g, cur.treeC, camX * PPM * 0.4, L.horizon - cur.treeC.height + 3);
  }

  function drawGround(G) {
    var g = V.g, L = V.L, th = cur.th, w = L.world.w, x0 = L.world.x;
    // 바탕(먼 러프 색)으로 지면 띠 전체를 먼저 칠한다
    P.rect(g, x0, L.horizon, w, L.worldBottom - L.horizon, th.roughFar);
    P.rect(g, x0, L.horizon, w, 2, th.roughFarDark);
    // 페어웨이: 10야드마다 줄무늬
    var stripe = 10 * YD;
    var first = Math.floor(camX / stripe);
    for (var k = first; ; k++) {
      var sx0 = wx(k * stripe), sx1 = wx((k + 1) * stripe);
      if (sx0 > x0 + w) break;
      var cx0 = Math.max(sx0, x0), cx1 = Math.min(sx1, x0 + w);
      if (cx1 > cx0) P.rect(g, cx0, L.fairTop, cx1 - cx0, L.fairH, (k & 1) ? th.fairB : th.fairA);
    }
    // 티 뒤쪽(음수 x)은 러프 처리
    var tee = wx(-4);
    if (tee > x0) P.rect(g, x0, L.fairTop, Math.min(w, tee - x0), L.fairH, th.roughFar);
    // 가까운 러프 (타일)
    var rc = cur.roughC, o = ((Math.round(camX * PPM) % rc.width) + rc.width) % rc.width;
    for (var x = -o; x < w; x += rc.width) g.drawImage(rc, x0 + x, L.nearLineY + 1);
    P.rect(g, x0, L.nearLineY, w, 1, th.roughNear);
    // 그리드 선 (티에서부터)
    var lineStart = Math.max(x0, wx(0));
    if (lineStart < x0 + w) {
      P.rect(g, lineStart, L.farLineY, x0 + w - lineStart, 1, th.line);
      P.rect(g, lineStart, L.nearLineY, x0 + w - lineStart, 1, th.line);
    }
    // 50야드마다 가로선, 400야드는 금색
    var clubYd = KLD.config.rules.clubLineYd;
    var m0 = Math.max(1, Math.floor(camX / (50 * YD)));
    for (var m = m0; m <= 14; m++) {
      var lx = wx(m * 50 * YD);
      if (lx > x0 + w) break;
      if (lx < x0) continue;
      if (m * 50 === clubYd) {
        P.rect(g, lx - 1, L.fairTop, 3, L.fairH, COL.gold);
        P.dither(g, lx - 1, L.fairTop, 3, L.fairH, '#fff7c2', Math.floor(G.time * 6) & 1);
      } else P.rect(g, lx, L.fairTop, 1, L.fairH, th.line);
    }
    // 티 박스
    var tx = wx(0);
    if (tx > x0 - 40 && tx < x0 + w + 40) {
      P.rect(g, tx - 14, L.fairCY - 5, 20, 12, th.fairB);
      P.rect(g, tx - 14, L.fairCY - 5, 20, 1, th.line);
      P.rect(g, tx - 14, L.fairCY + 6, 20, 1, th.line);
      P.rect(g, tx - 14, L.fairCY - 5, 1, 12, th.line);
      P.rect(g, tx, L.fairTop, 1, L.fairH, th.line);
    }
  }

  // 관중: 결정적 색상의 작은 사람들
  var CROWD_COLORS = ['#e60012', '#ffd23f', '#4fa6f0', '#ffffff', '#58c96b', '#f08a24', '#b06ad8', '#ff8fb0'];
  function drawPerson(g, x, y, idx, hop) {
    var c = CROWD_COLORS[(idx * 7 + 3) % CROWD_COLORS.length];
    y -= hop;
    P.rect(g, x, y, 2, 2, (idx % 3 === 0) ? '#d99a70' : '#f2b88f');
    P.rect(g, x - 1, y + 2, 4, 3, c);
  }

  function crowdHop(G, idx) {
    var e = G.crowd || 0;
    if (e <= 0.02) return ((Math.floor(G.time * 1.5 + idx * 0.37) % 9) === 0) ? 1 : 0;
    return (Math.sin(G.time * 14 + idx * 1.7) > 0.2 - e * 0.6) ? Math.round(1 + e) : 0;
  }

  function drawObjects(G) {
    var g = V.g, L = V.L, th = cur.th, w = L.world.w, x0 = L.world.x;
    var brand = KLD.config.brand;
    var i, sx, base = L.farLineY;

    // 전광판 (티 왼쪽)
    sx = wx(-33);
    if (sx > x0 - 50 && sx < x0 + w) {
      P.rect(g, sx + 4, base - 6, 2, 6, th.ink);
      P.rect(g, sx + 28, base - 6, 2, 6, th.ink);
      P.panel(g, sx, base - 26, 34, 21, '#0c1020', th.ink);
      T.draw(g, 'BEST', sx + 17, base - 24, { color: '#7d8bb5', align: 'center' });
      var bestTxt = (G.set && G.set.best > 0) ? String(Math.round(G.unit === 'm' ? G.set.best : G.set.best / YD)) : '---';
      T.draw(g, bestTxt, sx + 17, base - 15, { color: COL.gold, align: 'center' });
    }

    // 백드롭 (선수 뒤 현수막)
    sx = wx(-9);
    if (sx > x0 - 70 && sx < x0 + w) {
      var bw = 62, bh = 24;
      P.rect(g, sx + 3, base - 4, 2, 4, th.ink);
      P.rect(g, sx + bw - 5, base - 4, 2, 4, th.ink);
      P.panel(g, sx, base - bh - 3, bw, bh, brand.colors.dark, th.ink);
      P.rect(g, sx + 1, base - bh - 2, bw - 2, 2, brand.colors.primary);
      P.rect(g, sx + 1, base - 6, bw - 2, 2, brand.colors.primary);
      if (!(hasLogo() && KLD.logo.drawFit(g, 'mark', sx + Math.round(bw / 2), base - 15, bw - 2, { maxH: 16, variant: 'light', align: 'center', valign: 'middle' }))) {
        T.draw(g, brand.name, sx + bw / 2, base - bh + 1, { scale: 2, color: '#ffffff', align: 'center' });
      }
    }

    // 관중석 (티 오른쪽, 먼 쪽)
    sx = wx(30);
    var standW = 78;
    if (sx > x0 - standW && sx < x0 + w) {
      var rows = 5, top = L.horizon - rows * 6 + 3;
      for (var r = 0; r < rows; r++) {
        var ry = top + r * 6;
        P.rect(g, sx + (rows - 1 - r) * 2, ry + 4, standW - (rows - 1 - r) * 4, 3, (r & 1) ? th.standB : th.standA);
        for (var c = 0; c < Math.floor((standW - (rows - 1 - r) * 4 - 4) / 5); c++) {
          var idx = r * 31 + c;
          if (idx % 11 === 5) continue;                // 빈자리
          drawPerson(g, sx + (rows - 1 - r) * 2 + 3 + c * 5, ry, idx, crowdHop(G, idx));
        }
      }
      P.rect(g, sx, L.horizon + 2, standW, 3, th.standB);
    }

    // 야간 조명탑
    if (th.glow) {
      for (i = -1; i < 6; i++) {
        var lx = wx(i * 110 + 20);
        if (lx < x0 - 20 || lx > x0 + w + 20) continue;
        P.rect(g, lx, L.horizon - 52, 2, 54, '#2a3358');
        P.rect(g, lx - 5, L.horizon - 58, 12, 7, '#3a4470');
        P.rect(g, lx - 4, L.horizon - 57, 10, 5, th.glow);
        P.dither(g, lx - 9, L.horizon - 61, 20, 13, 'rgba(255,247,194,0.35)', (i & 1));
      }
    }

    // 광고판: 거리 표지판 줄보다 위(지평선 위)에 100야드마다 하나씩. 표지판·깃발에 가려지지 않는다.
    var sponsors = brand.sponsors || [];
    var k, xm, base2 = L.horizon - 8, postTo = L.horizon + 3;
    var firstB = Math.max(1, Math.floor(camX / (100 * YD)) - 1);
    if (sponsors.length) {
      for (k = firstB; k <= 6; k++) {
        var bsx = wx((k * 100 + 75) * YD);
        if (bsx > x0 + w + 60) break;
        if (bsx > x0 - 60) drawBoard(g, bsx, base2, sponsors[k % sponsors.length], k, th, postTo);
      }
    }
    // 구경꾼 무리
    for (k = 1; k <= 4; k++) {
      var csx = wx((k * 100 + 28) * YD);
      if (csx > x0 - 30 && csx < x0 + w + 30) {
        for (i = 0; i < 5; i++) drawPerson(g, csx + i * 5, L.horizon + 4 - (i & 1), k * 13 + i, crowdHop(G, k * 13 + i));
      }
    }
    // 거리 표지판과 깃발 (50야드마다)
    var firstK = Math.max(1, Math.floor(camX / (50 * YD)));
    var clubYd = KLD.config.rules.clubLineYd;
    for (k = firstK; k <= 14; k++) {
      xm = k * 50 * YD;
      sx = wx(xm);
      if (sx > x0 + w + 60) break;
      if (sx >= x0 - 40) drawSign(g, sx, base, String(k * 50), th, G, k * 50 === clubYd);
    }
  }

  function drawSign(g, sx, base, label, th, G, gold) {
    var tw = T.measure(label), bw = tw + 6;
    var bx = sx - Math.round(bw / 2);
    P.rect(g, bx + 2, base - 4, 1, 4, th.ink);
    P.rect(g, bx + bw - 3, base - 4, 1, 4, th.ink);
    P.panel(g, bx, base - 15, bw, 11, gold ? COL.gold : th.signBg, th.ink);
    T.draw(g, label, bx + 3, base - 13, { color: th.signInk });
    // 깃발: 바람 방향으로 나부낀다
    var wind = G.wind || { x: 0, z: 0 };
    var px = bx + bw + 2;
    P.rect(g, px, base - 19, 1, 19, th.ink);
    var dir = wind.x >= 0 ? 1 : -1, strength = Math.min(1, Math.abs(wind.x) / 3 + Math.abs(wind.z) / 6);
    var flap = (Math.floor(G.time * (3 + strength * 6)) + sx) & 1;
    var len = strength < 0.15 ? 2 : (4 + flap);
    var fx = dir > 0 ? px + 1 : px - len;
    P.rect(g, fx, base - 19 + (strength < 0.15 ? 1 : 0), len, 3, '#e60012');
    if (len > 3) P.rect(g, dir > 0 ? fx + len - 1 : fx, base - 18, 1, 1, '#ffffff');
  }

  // 광고판 하나. base = 판의 아랫변, postTo = 기둥이 닿는 지면 높이.
  function drawBoard(g, sx, base, text, k, th, postTo) {
    var brand = KLD.config.brand;
    var postH = Math.max(0, (postTo == null ? base : postTo) - base);
    if (text === 'LOGO') {
      if (hasLogo()) {
        var lw = 54, bx0 = sx - Math.round(lw / 2);
        if (postH) { P.rect(g, bx0 + 5, base, 2, postH, th.ink); P.rect(g, bx0 + lw - 7, base, 2, postH, th.ink); }
        P.panel(g, bx0, base - 17, lw, 17, '#ffffff', th.ink);
        KLD.logo.draw(g, 'mark48', sx, base - 9, { variant: 'dark', align: 'center', valign: 'middle' });
        return;
      }
      text = brand.name;
    }
    if (text === 'SUMMIT' && KLD.summit && KLD.summit.available()) {
      // KOREA LONG DRIVE SUMMIT 2026 로고 (흰 판 위의 작은 픽셀 스프라이트, js/summit-logo.js)
      var sw = KLD.summit.w + 6, sh = KLD.summit.h + 6, sbx = sx - Math.round(sw / 2);
      if (postH) { P.rect(g, sbx + 6, base, 2, postH, th.ink); P.rect(g, sbx + sw - 8, base, 2, postH, th.ink); }
      P.panel(g, sbx, base - sh, sw, sh, '#ffffff', th.ink);
      KLD.summit.draw(g, sbx + 3, base - sh + 3);
      return;
    }
    var tw = T.measure(text), bw = tw + 8;
    var bx = sx - Math.round(bw / 2);
    var bg = (k % 3 === 0) ? brand.colors.primary : ((k % 3 === 1) ? brand.colors.dark : '#f4f4f0');
    var fg = (k % 3 === 2) ? brand.colors.dark : '#ffffff';
    if (postH) { P.rect(g, bx + 4, base, 1, postH, th.ink); P.rect(g, bx + bw - 5, base, 1, postH, th.ink); }
    P.panel(g, bx, base - 11, bw, 11, bg, th.ink);
    T.draw(g, text, bx + 4, base - 9, { color: fg });
  }

  // 필드 위 마커 (넘어야 할 기록, 내 최고 기록). 가까이 붙어도 이름표가 겹치지 않게 높이를 달리한다.
  function drawMarkers(G) {
    var g = V.g, L = V.L, th = cur.th, x0 = L.world.x, w = L.world.w;
    var list = G.markers || [];
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (!(m.x > 0)) continue;
      var sx = wx(m.x);
      if (sx < x0 - 40 || sx > x0 + w + 40) continue;
      var pole = 24 + i * 12;
      P.dashLine(g, sx, L.fairTop, sx, L.nearLineY - 1, m.color, 2, 2);
      P.rect(g, sx, L.farLineY - pole, 1, pole, th.ink);
      var label = m.label, font = m.font || 'bit';
      var tw = T.measure(label, { font: font });
      var bh = (font === 'kos') ? 12 : 11;
      P.panel(g, sx + 1, L.farLineY - pole - 1, tw + 6, bh, m.color, th.ink);
      T.draw(g, label, sx + 4, L.farLineY - pole + 1, { color: th.ink, font: font });
    }
  }

  // 이번 세트에 친 공들이 필드에 놓여 있다
  function drawOldBalls(G) {
    var g = V.g, L = V.L, balls = (G.set && G.set.balls) || [];
    for (var i = 0; i < balls.length; i++) {
      var b = balls[i];
      if (!b) continue;
      var sx = wx(b.total);
      if (sx < L.world.x - 4 || sx > L.world.x + L.world.w + 4) continue;
      var y = gy(b.z);
      P.rect(g, sx - 1, y - 1, 2, 2, b.valid ? '#ffffff' : '#ff8f85');
    }
  }

  function drawBall(G) {
    var g = V.g, L = V.L, th = cur.th, b = G.ball;
    if (!b || !b.visible) return;
    var sx = wx(b.x), ground = gy(b.z);
    var sy = ground - 2 - Math.round(b.y * L.ppmY);
    var i;
    // 궤적
    var tr = b.trail || [];
    for (i = 0; i < tr.length; i++) {
      var t = tr[i], tx = wx(t.x), ty = gy(t.z) - 2 - Math.round(t.y * L.ppmY);
      if (tx < L.world.x - 2 || tx > L.world.x + L.world.w + 2) continue;
      var age = (tr.length - i) / tr.length;
      P.rect(g, tx, ty, 1, 1, age < 0.35 ? '#ffffff' : (age < 0.7 ? '#dff3ff' : '#a9d4f2'));
    }
    // 그림자
    if (b.y > 0.3) {
      var sw = b.y > 25 ? 1 : (b.y > 8 ? 2 : 3);
      P.rect(g, sx - Math.floor(sw / 2), ground, sw, 1, th.shadow);
    }
    // 티
    if (b.onTee) P.rect(g, sx, ground - 1, 1, 2, '#ffe9c2');
    // 화면 위로 벗어나면 높이 표시
    var topLimit = L.topLimit;
    if (sy < topLimit) {
      var hTxt = Math.round(G.unit === 'm' ? b.y : b.y / YD) + (G.unit === 'm' ? 'M' : 'Y');
      T.draw(g, '↑', sx - 2, topLimit, { color: '#ffffff', outline: th.ink });
      T.draw(g, hTxt, sx + 6, topLimit, { color: '#ffffff', outline: th.ink });
      return;
    }
    // 공 (윤곽 + 본체)
    g.fillStyle = th.ink;
    g.fillRect(sx - 1, sy - 2, 3, 5);
    g.fillRect(sx - 2, sy - 1, 5, 3);
    g.fillStyle = '#ffffff';
    g.fillRect(sx - 1, sy - 1, 3, 3);
    g.fillStyle = '#c9d6e8';
    g.fillRect(sx + 1, sy + 1, 1, 1);
  }

  function drawParticles(G) {
    var g = V.g, L = V.L, list = G.particles || [], i;
    for (i = 0; i < list.length; i++) {
      var p = list[i];
      var sx = wx(p.x), sy = gy(p.z) - Math.round(p.y * L.ppmY);
      g.fillStyle = p.color;
      g.fillRect(sx, sy, p.size || 1, p.size || 1);
    }
  }

  function drawGolfer(G) {
    var L = V.L, th = cur.th, g = V.g;
    var gx = wx(0) - KLD.golfer.BALL_DX, gyy = gy(0) + 1;
    if (gx < L.world.x - 70 || gx > L.world.x + L.world.w + 70) return;
    P.ellipse(g, gx, gyy + 1, 13, 2, th.shadow);
    KLD.golfer.draw(g, gx, gyy, G.golfer || { phase: 'address', time: G.time });
  }

  // 임팩트 직후 선수 머리 위로 떠오르는 판정 글자
  function drawStamp(G) {
    var s = G.stamp;
    if (!s || s.t <= 0) return;
    var g = V.g;
    var age = s.dur - s.t;
    if (age < 0.3 && Math.floor(age * 30) % 2 === 1) return;      // 처음 잠깐 깜빡
    var x = wx(0) + 6, y = gy(0) - 60 - Math.round(Math.min(1, age / 0.5) * 8);
    var sc = 2;
    var half = Math.round(T.measure(s.text, { scale: sc }) / 2);
    x = P.clamp(x, V.L.world.x + half + 3, V.L.world.x + V.L.world.w - half - 3);
    T.draw(g, s.text, x, y, { scale: sc, color: s.color, outline: cur.th.ink, align: 'center' });
  }

  // 픽셀 원 테두리 (중점 알고리즘). 안티앨리어싱 없이 th 픽셀 두께.
  function ringPx(g, cx, cy, r, color, th) {
    if (r < 1) return;
    g.fillStyle = color;
    var x = Math.round(r), y = 0, err = 1 - x;
    while (x >= y) {
      g.fillRect(cx + x, cy + y, th, th); g.fillRect(cx - x, cy + y, th, th);
      g.fillRect(cx + x, cy - y, th, th); g.fillRect(cx - x, cy - y, th, th);
      g.fillRect(cx + y, cy + x, th, th); g.fillRect(cx - y, cy + x, th, th);
      g.fillRect(cx + y, cy - x, th, th); g.fillRect(cx - y, cy - x, th, th);
      y++;
      if (err < 0) err += 2 * y + 1; else { x--; err += 2 * (y - x) + 1; }
    }
  }

  /*
   * KLD SMASH 연출 (레드존 퍼펙트): 임팩트 지점에서 퍼지는 충격파 링·집중선·불꽃, 위아래 레터박스, 큰 배너.
   * 모든 움직임은 경과 시간(age)에서 바로 계산한다 (상태를 따로 갖지 않는다). '움직임 줄이기'면 배너만 정지 상태로 보여 준다.
   */
  function drawSmash(G) {
    var s = G.smash;
    if (!s || s.t <= 0) return;
    var g = V.g, W = V.L.world, age = s.dur - s.t, calm = !!G.reduceMotion;
    var bx = wx(0) + 4, by = gy(0) - 6, i, rr;
    var ink = cur.th.ink, GOLD = COL.gold;

    g.save();
    g.beginPath(); g.rect(W.x, W.y, W.w, W.h); g.clip();

    if (!calm) {
      var rand = P.rng(s.seed || 1);
      // 집중선: 임팩트에서 사방으로 뻗는다
      if (age < 0.6) {
        var k = age / 0.6, n = 24;
        for (i = 0; i < n; i++) {
          var a = (i / n) * Math.PI * 2 + (rand() - 0.5) * 0.18;
          var r0 = 14 + age * 110 + rand() * 10, r1 = r0 + 26 + 90 * (1 - k) + rand() * 30;
          P.line(g, bx + Math.cos(a) * r0, by + Math.sin(a) * r0, bx + Math.cos(a) * r1, by + Math.sin(a) * r1,
            (i % 3 === 0) ? '#ffffff' : GOLD, (k < 0.4 && i % 2 === 0) ? 2 : 1);
        }
      }
      // 충격파 링 두 겹
      for (i = 0; i < 2; i++) {
        rr = (age - i * 0.09) * 300;
        if (rr > 2 && rr < 260) ringPx(g, Math.round(bx), Math.round(by), rr, i ? GOLD : '#fff6c0', rr < 90 ? 3 : 2);
      }
      // 불꽃: 중력을 받으며 흩어진다
      if (age < 1.0) {
        for (i = 0; i < 44; i++) {
          var sa = rand() * Math.PI * 2, sp = 50 + rand() * 170, life = 0.5 + rand() * 0.5;
          if (age > life) continue;
          var px = bx + Math.cos(sa) * sp * age, py = by + Math.sin(sa) * sp * age + 90 * age * age;
          g.fillStyle = (i % 3 === 0) ? '#ffffff' : ((i % 3 === 1) ? GOLD : '#ff8f85');
          g.fillRect(Math.round(px), Math.round(py), (i % 4 === 0) ? 2 : 1, (i % 4 === 0) ? 2 : 1);
        }
      }
      // 레터박스: 빠르게 들어왔다가 끝에서 물러난다
      var barK = P.smooth(Math.min(1, age / 0.1)) * Math.min(1, (s.dur - age) / 0.25);
      var bh = Math.round(13 * barK);
      if (bh > 0) { P.rect(g, W.x, W.y, W.w, bh, '#070a1c'); P.rect(g, W.x, W.y + W.h - bh, W.w, bh, '#070a1c'); }
    }

    // 배너: KLD 로고 + SMASH!!
    var fade = s.dur - age < 0.25 && Math.floor(age * 20) % 2 === 1;
    if (!fade) {
      var cx = W.x + Math.round(W.w / 2), cy = W.y + Math.round(W.h * 0.3);
      var sc = calm ? 4 : (age < 0.07 ? 7 : (age < 0.14 ? 5 : 4));
      var fit = Math.floor((W.w - 12) / T.measure('SMASH!!', { scale: 1 }));
      sc = Math.max(2, Math.min(sc, fit));
      var jx = (!calm && age < 0.4) ? Math.round(Math.sin(age * 150) * 2) : 0;
      var jy = (!calm && age < 0.4) ? Math.round(Math.cos(age * 130) * 2) : 0;
      var word = 'SMASH!!';
      var col = (!calm && age < 0.6 && Math.floor(age * 14) % 2 === 1) ? '#ffffff' : GOLD;
      var ty = cy + jy;
      if (hasLogo()) KLD.logo.drawFit(g, 'mark', cx + jx, ty - 4, Math.min(W.w - 20, 118), { variant: 'light', align: 'center', valign: 'bottom', outline: ink });
      else T.draw(g, 'KLD', cx + jx, ty - 4 - 14, { scale: 2, color: '#ffffff', outline: ink, align: 'center' });
      T.draw(g, word, cx + jx + Math.max(1, sc >> 1), ty + Math.max(1, sc >> 1), { scale: sc, color: '#e60012', outline: ink, align: 'center' });
      T.draw(g, word, cx + jx, ty, { scale: sc, color: col, outline: ink, align: 'center' });
    }
    g.restore();
  }

  function drawWorld(G) {
    var g = V.g, L = V.L;
    ensureCaches();
    camX = G.cam ? G.cam.x : 0;
    g.save();
    g.beginPath();
    g.rect(L.world.x, L.world.y, L.world.w, L.world.h);
    g.clip();
    var sh = G.shake;
    if (sh && sh.t > 0 && !G.reduceMotion) {
      var mag = sh.mag * (sh.t / sh.dur);
      var dx = Math.round(Math.sin(G.time * 90) * mag), dy = Math.round(Math.cos(G.time * 70) * mag * 0.6);
      if (dx || dy) {
        // 흔들려서 드러나는 가장자리를 하늘과 잔디 색으로 먼저 채운다 (검은 띠가 보이지 않게)
        g.drawImage(cur.skyC, L.world.x, L.world.y);
        P.rect(g, L.world.x, L.horizon, L.world.w, L.nearLineY - L.horizon, cur.th.roughFar);
        P.rect(g, L.world.x, L.nearLineY, L.world.w, L.worldBottom - L.nearLineY, cur.th.roughNear);
        g.translate(dx, dy);
      }
    }
    drawBackground(G);
    drawGround(G);
    drawObjects(G);
    drawMarkers(G);
    drawOldBalls(G);
    drawGolfer(G);
    drawBall(G);
    drawParticles(G);
    drawStamp(G);
    g.restore();
  }

  // ── 표기 도우미 ──────────────────────────────────────────
  function distNum(m, unit, dec) {
    var v = unit === 'm' ? m : m / YD;
    return v.toFixed(dec == null ? 1 : dec);
  }
  function unitLabel(unit) { return unit === 'm' ? 'M' : 'YD'; }
  function clockText(sec) {
    sec = Math.max(0, Math.ceil(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  // ── HUD ────────────────────────────────────────────────
  function drawHud(G) {
    var g = V.g, L = V.L, th = cur.th, W = V.W;
    var ink = th.ink, t = KLD.i18n.t;
    var set = G.set;
    if (!set) return;
    // 왼쪽: 라운드 이름 + 공 아이콘
    T.draw(g, G.roundLabel || '', 4, 3, { font: 'ko', color: '#ffffff', outline: ink });
    var n = KLD.config.rules.ballsPerSet, i;
    if (G.mode === 'tournament') {
      for (i = 0; i < n; i++) {
        var bx = 5 + i * 8, by = 19;
        var b = set.balls[i];
        g.fillStyle = ink;
        g.fillRect(bx - 1, by, 7, 5); g.fillRect(bx, by - 1, 5, 7);
        var col = '#ffffff';
        if (b) col = b.valid ? (i === set.bestIdx ? COL.gold : '#9fd8ff') : '#56607a';
        else if (i === set.ballIndex && Math.floor(G.time * 3) % 2 === 0 && G.phase === 'address') col = '#bfe6ff';
        g.fillStyle = col;
        g.fillRect(bx, by, 5, 5);
        if (b && !b.valid) {                           // OB: X 표시 (색에 기대지 않는다)
          g.fillStyle = '#ff8f85';
          g.fillRect(bx, by, 1, 1); g.fillRect(bx + 4, by, 1, 1); g.fillRect(bx + 1, by + 1, 1, 1); g.fillRect(bx + 3, by + 1, 1, 1);
          g.fillRect(bx + 2, by + 2, 1, 1); g.fillRect(bx + 1, by + 3, 1, 1); g.fillRect(bx + 3, by + 3, 1, 1);
          g.fillRect(bx, by + 4, 1, 1); g.fillRect(bx + 4, by + 4, 1, 1);
        }
      }
    } else {
      T.draw(g, t('hud.shots') + ' ' + set.count, 4, 18, { font: 'kos', color: '#ffffff', outline: ink });
    }
    // 가운데: 시계 + 바람
    var cx = Math.round(W / 2);
    var hasClock = G.mode === 'tournament';
    if (hasClock) {
      var low = set.timeLeft <= 10;
      var ccol = low ? ((Math.floor(G.time * 4) % 2) ? '#ff8f85' : '#ffffff') : '#ffffff';
      var sc = (low && Math.floor(G.time * 4) % 2) ? 2 : 2;
      T.draw(g, clockText(set.timeLeft), cx, 3, { scale: sc, color: ccol, outline: ink, align: 'center' });
      if (G.clockPop && G.clockPop.t > 0) {
        T.draw(g, G.clockPop.text, cx + 26, 6 - Math.round((1 - G.clockPop.t / G.clockPop.dur) * 5), { color: '#ff8f85', outline: ink });
      }
    }
    drawWind(G, cx, hasClock ? 20 : 6);
    // 오른쪽: 최고 기록 / 타깃
    var bestTxt = set.best > 0 ? distNum(set.best, G.unit) : '---';
    var vw = T.draw(g, bestTxt, W - 4, 4, { color: COL.best, outline: ink, align: 'right' });
    T.draw(g, 'BEST', W - 7 - vw, 4, { color: '#ffffff', outline: ink, align: 'right' });
    if (G.targetInfo) {
      var tv = T.draw(g, G.targetInfo.value, W - 4, 16, { color: COL.target, outline: ink, align: 'right' });
      T.draw(g, G.targetInfo.label, W - 7 - tv, 14, { font: 'kos', color: '#ffffff', outline: ink, align: 'right' });
    }
    // 아이콘 버튼
    drawIcon(g, L.btn.pause, 'pause', th);
    drawIcon(g, L.btn.mute, G.muted ? 'muteOff' : 'muteOn', th);
  }

  function drawIcon(g, r, kind, th) {
    P.panel(g, r.x, r.y, r.w, r.h, 'rgba(20,28,51,0.75)', th.ink);
    var x = r.x + 3, y = r.y + 3;
    g.fillStyle = '#ffffff';
    if (kind === 'pause') {
      g.fillRect(x + 1, y + 1, 2, 6); g.fillRect(x + 5, y + 1, 2, 6);
    } else {
      g.fillRect(x, y + 3, 2, 3); g.fillRect(x + 2, y + 2, 1, 5); g.fillRect(x + 3, y + 1, 1, 7);
      if (kind === 'muteOn') { g.fillRect(x + 5, y + 2, 1, 1); g.fillRect(x + 6, y + 3, 1, 3); g.fillRect(x + 5, y + 6, 1, 1); }
      else { g.fillStyle = '#ff8f85'; g.fillRect(x + 5, y + 2, 1, 1); g.fillRect(x + 6, y + 3, 1, 1); g.fillRect(x + 7, y + 4, 1, 1); g.fillRect(x + 7, y + 2, 1, 1); g.fillRect(x + 5, y + 4, 1, 1); }
    }
  }

  // 바람 표시: 화살표(미니맵과 같은 방향계: 오른쪽 = 타깃 방향) + 순풍/역풍 + 세기, 그 아래 돌풍 예고
  function drawWind(G, cx, y) {
    var g = V.g, th = cur.th, t = KLD.i18n.t;
    var w = G.wind || { x: 0, z: 0 };
    var sp = Math.sqrt(w.x * w.x + w.z * w.z);
    var label, col;
    if (sp < 0.3) { label = t('wind.calm'); col = '#ffffff'; }
    else if (Math.abs(w.x) >= Math.abs(w.z)) {
      if (w.x > 0) { label = t('wind.tail'); col = COL.ok; } else { label = t('wind.head'); col = COL.bad; }
    } else { label = t('wind.cross'); col = COL.gold; }
    var num = sp.toFixed(1);
    var lw = T.measure(label, { font: 'kos' }), nw = T.measure(num);
    var lockW = G.windLocked ? T.measure('LOCK') + 4 : 0;
    var total = 11 + 3 + lw + 3 + nw + lockW;
    var x = cx - Math.round(total / 2);
    // 화살표 상자
    P.panel(g, x, y - 1, 11, 11, 'rgba(20,28,51,0.8)', G.windLocked ? COL.gold : th.ink);
    var ax = x + 5, ay = y + 4;
    if (sp >= 0.3) {
      var ux = w.x / sp, uz = w.z / sp;
      var tipx = ax + Math.round(ux * 4), tipy = ay + Math.round(uz * 4);
      P.line(g, ax - Math.round(ux * 4), ay - Math.round(uz * 4), tipx, tipy, col, 1);
      var bx1 = tipx - Math.round(ux * 2 - uz * 2), by1 = tipy - Math.round(uz * 2 + ux * 2);
      var bx2 = tipx - Math.round(ux * 2 + uz * 2), by2 = tipy - Math.round(uz * 2 - ux * 2);
      P.line(g, tipx, tipy, bx1, by1, col, 1);
      P.line(g, tipx, tipy, bx2, by2, col, 1);
    } else {
      P.rect(g, ax - 1, ay - 1, 3, 3, col);
    }
    T.draw(g, label, x + 14, y - 1, { font: 'kos', color: col, outline: th.ink });
    T.draw(g, num, x + 14 + lw + 3, y + 1, { color: '#ffffff', outline: th.ink });
    if (G.windLocked) T.draw(g, 'LOCK', x + 14 + lw + 3 + nw + 4, y + 1, { color: COL.gold, outline: th.ink });
    // 돌풍 예고 (바람이 고정되기 전에만)
    var gu = w.gust;
    if (gu && !G.windLocked) {
      var along = Math.abs(gu.dx) >= Math.abs(gu.dz);
      var gcol = along ? (gu.dx > 0 ? COL.ok : COL.bad) : COL.gold;
      var mag = along ? gu.dx : Math.abs(gu.dz);
      var txt;
      if (gu.phase === 'incoming') txt = t('wind.gustIn', { s: Math.ceil(gu.eta) }) + ' ' + (mag > 0 ? '+' : '') + mag.toFixed(1);
      else txt = t('wind.gustNow') + ' ' + (mag > 0 ? '+' : '') + mag.toFixed(1);
      if (gu.phase === 'incoming' || Math.floor(G.time * 6) % 2 === 0) {
        T.draw(g, txt, cx, y + 12, { font: 'kos', color: gcol, outline: th.ink, align: 'center' });
      }
    }
  }

  // ── 임팩트 직후 볼 스피드 / 비행 중 거리 / 결과 배너 / 런치 모니터 ──
  // 큰 숫자(볼 스피드·비행 거리)를 그린다. 세로형은 가운데 위, 가로형은 공이 지나가는 가운데를 피해 왼쪽 위.
  function drawBigNumber(label, txt, unit, color) {
    var g = V.g, L = V.L, th = cur.th;
    var sc = L.portrait ? 3 : 2;
    var w = T.measure(txt, { scale: sc }), uw = T.measure(unit);
    var x, y;
    if (L.portrait) { x = Math.round(L.world.x + L.world.w / 2) - Math.round((w + 3 + uw) / 2); y = L.world.y + 46; }
    else { x = L.world.x + 5; y = L.world.y + 43; }
    T.draw(g, label, L.portrait ? Math.round(L.world.x + L.world.w / 2) : x, y - 10, { color: '#ffffff', outline: th.ink, align: L.portrait ? 'center' : 'left' });
    T.draw(g, txt, x, y, { scale: sc, color: color, outline: th.ink });
    T.draw(g, unit, x + w + 3, y + 7 * sc - 7, { color: color, outline: th.ink });
  }

  function drawSpeedPop(G) {
    var s = G.speedPop;
    if (!s || s.t <= 0) return false;
    drawBigNumber('BALL SPEED', String(Math.round(s.mph)), 'MPH', s.color || COL.gold);
    return true;
  }

  function drawLive(G) {
    var live = G.live;
    if (!live || !live.visible) return;
    drawBigNumber(live.tag || '', distNum(live.dist, G.unit, 0), unitLabel(G.unit), live.color || '#ffffff');
  }

  /*
   * 결과 화면 배치. 배너(큰 숫자 + 설명 두 줄)와 런치 모니터가 겹치지 않도록 한 번에 정한다.
   * 세로형은 화면 높이에 따라 모니터를 다섯 줄 → 핵심 세 줄 → 두 줄 띠 → 생략 순으로 줄이고,
   * 필요하면 배너를 HUD 바로 아래까지 올린다. 모니터가 배너를 덮는 일은 없다.
   * 반환값: { cx, cy, mon: null | { x, y, w, h, mode: 'full'|'short'|'strip' } }
   */
  var BANNER_H = 50;                                   // 배너 한 덩어리의 높이 (3배 숫자 21 + 설명 12 + 10 + 간격)
  function resultLayout(G) {
    var L = V.L;
    var cx = Math.round(L.world.x + L.world.w / 2);
    var cy = L.world.y + Math.round(L.world.h * (L.portrait ? 0.26 : 0.36));
    var m = G.monitor;
    if (!m || !m.visible) return { cx: cx, cy: cy, mon: null };
    var rows = m.rows || [], nAll = rows.length, nMain = 0, i;
    for (i = 0; i < nAll; i++) if (!rows[i].minor) nMain++;
    var w, x;
    if (!L.portrait) {
      // 가로형: 배너는 왼쪽, 런치 모니터는 오른쪽. 하늘이 낮아서 핵심 줄만 보여 준다.
      w = Math.min(Math.round(L.world.w * 0.62), 172);
      return {
        cx: Math.round(L.world.x + (L.world.w - w - 6) / 2), cy: cy,
        mon: { x: L.world.x + L.world.w - w - 6, y: L.world.y + 48, w: w, h: 17 + nMain * 10, mode: 'short' }
      };
    }
    w = Math.min(L.world.w - 12, 196);
    x = Math.round(L.world.x + (L.world.w - w) / 2);
    var top = L.world.y + 36;                          // 시계·바람 표시 바로 아래
    var sky = L.horizon - 2, far = L.fairTop - 2;      // 아래 한계: 지평선 위 / 먼 러프 띠까지 (페어웨이는 가리지 않는다)
    // 줄 수가 많은 쪽, 그리고 땅을 덜 가리는 쪽을 먼저 시도한다
    var tries = [
      ['full', 17 + nAll * 10, sky],
      ['short', 17 + nMain * 10, sky], ['short', 17 + nMain * 10, far],
      ['strip', 5 + Math.min(2, nMain) * 10, sky], ['strip', 5 + Math.min(2, nMain) * 10, far]
    ];
    for (i = 0; i < tries.length; i++) {
      var h = tries[i][1], c = Math.min(cy, tries[i][2] - h - BANNER_H);
      if (c >= top && (tries[i][0] === 'full' || nMain > 0)) {
        return { cx: cx, cy: c, mon: { x: x, y: c + BANNER_H, w: w, h: h, mode: tries[i][0] } };
      }
    }
    return { cx: cx, cy: cy, mon: null };              // 자리가 없으면 배너만
  }

  function drawBanner(G) {
    var b = G.banner;
    if (!b || b.t <= 0) return;
    var g = V.g, L = V.L, th = cur.th;
    var a = resultLayout(G);
    var font = b.font || 'bit';
    var sc = b.scale || (L.portrait ? 3 : 2);
    var maxW = L.world.w - 12;
    while (sc > 1 && T.measure(b.text, { scale: sc, font: font }) > maxW) sc--;
    var blink = b.blink ? (Math.floor(G.time * 8) % 2 === 0) : true;
    if (blink) T.draw(g, b.text, a.cx, a.cy, { scale: sc, font: font, color: b.color || '#ffffff', outline: th.ink, align: 'center' });
    var h = T.height({ scale: sc, font: font });
    // 설명 줄은 가운데 정렬. 가로형처럼 배너 자리가 좁을 때 긴 줄이 화면 왼쪽 밖으로 잘리지 않게 한다.
    function subLine(text, y, font, color) {
      var w = T.measure(text, { font: font });
      var x = Math.max(L.world.x + 3, a.cx - Math.round(w / 2));
      T.draw(g, text, x, y, { font: font, color: color || '#ffffff', outline: th.ink });
    }
    if (b.sub) subLine(b.sub, a.cy + h + 4, 'ko', b.subColor);
    if (b.sub2) subLine(b.sub2, a.cy + h + 18, 'kos', b.sub2Color);
  }

  function drawMonitor(G) {
    var M = resultLayout(G).mon;
    if (!M) return;
    var g = V.g, th = cur.th, lineH = 10;
    var all = G.monitor.rows || [], rows = [], i;
    for (i = 0; i < all.length; i++) if (M.mode === 'full' || !all[i].minor) rows.push(all[i]);
    var x = M.x, y = M.y, w = M.w, ry0 = y + 3;
    if (M.mode === 'strip') rows = rows.slice(0, 2);
    P.panel(g, x, y, w, M.h, '#0c1020', th.ink);
    if (M.mode !== 'strip') {
      P.rect(g, x + 1, y + 1, w - 2, 10, '#1e2a52');
      T.draw(g, 'LAUNCH MONITOR', x + Math.round(w / 2), y + 2, { color: COL.target, align: 'center' });
      ry0 = y + 13;
    }
    for (i = 0; i < rows.length; i++) {
      var r = rows[i], ry = ry0 + i * lineH;
      T.draw(g, r.label, x + 5, ry, { font: 'kos', color: '#aab4d0' });
      T.draw(g, r.value, x + w - 5, ry + 1, { color: r.color || '#ffffff', align: 'right' });
    }
  }

  function drawToast(G) {
    var s = G.toast;
    if (!s || s.t <= 0) return;
    var g = V.g, L = V.L;
    var w = T.measure(s.text, { font: 'kos' }) + 12;
    var k = Math.min(1, (s.dur - s.t) / 0.18, s.t / 0.18);
    var x = Math.round(L.world.x + (L.world.w - w) / 2);
    var y = L.worldBottom - 2 - Math.round(15 * k);
    P.panel(g, x, y, w, 14, '#141c33', s.color || COL.target);
    T.draw(g, s.text, x + 6, y + 2, { font: 'kos', color: s.color || '#ffffff' });
  }

  function drawHint(G) {
    if (!G.hint) return;
    var g = V.g, L = V.L, th = cur.th;
    if (Math.floor(G.time * 2.2) % 2 === 1) return;
    T.draw(g, G.hint, Math.round(L.world.x + L.world.w / 2), L.worldBottom - 30,
      { font: 'ko', color: '#ffffff', outline: th.ink, align: 'center' });
  }

  // 워밍업 안내: 지금 할 일을 한 줄로
  function drawCoach(G) {
    var c = G.coach;
    if (!c) return;
    var g = V.g, L = V.L;
    var tw = Math.max(T.measure(c.text, { font: 'ko' }), c.sub ? T.measure(c.sub, { font: 'kos' }) : 0);
    var w = Math.min(L.world.w - 8, tw + 20), h = c.sub ? 32 : 20;
    var x = Math.round(L.world.x + (L.world.w - w) / 2);
    var y = L.world.y + Math.round(L.world.h * 0.3);
    P.panel(g, x, y, w, h, '#141c33', COL.gold);
    T.draw(g, c.text, x + Math.round(w / 2), y + 4, { font: 'ko', color: '#ffffff', align: 'center' });
    if (c.sub) T.draw(g, c.sub, x + Math.round(w / 2), y + 18, { font: 'kos', color: COL.gold, align: 'center' });
  }

  // ── 컨트롤 덱 ───────────────────────────────────────────
  var DECK_BG = '#141c33', DECK_EDGE = '#2c3a66', DECK_INK = '#070a1c';

  function drawDeck(G) {
    var g = V.g, L = V.L;
    if (!L.deck) return;
    P.rect(g, L.deck.x, L.deck.y, L.deck.w, L.deck.h, DECK_BG);
    P.rect(g, L.deck.x, L.deck.y, L.deck.w, 2, DECK_EDGE);
    P.rect(g, L.deck.x, L.deck.y + 2, L.deck.w, 1, DECK_INK);
    drawGauge(G, L.gauge);
    drawMinimap(G, L.minimap);
    drawButtons(G);
  }

  function drawMinimap(G, R) {
    var g = V.g;
    var maxM = G.mapMax || 500 * YD;
    P.panel(g, R.x, R.y, R.w, R.h, '#1d5632', DECK_INK);
    var ix = R.x + 7, iw = R.w - 12;
    var sx = iw / maxM;
    var cy = R.y + Math.floor(R.h / 2);
    var sz = (R.h / 2 - 4) / 42;
    function mx(x) { return Math.round(ix + x * sx); }
    function my(z) { return Math.round(cy + P.clamp(z * sz, -(R.h / 2 - 3), R.h / 2 - 3)); }
    var gh = Math.round(GRID_HALF * sz);
    // 그리드
    P.rect(g, mx(0), cy - gh, mx(maxM) - mx(0), gh * 2 + 1, '#3f9b4c');
    var k, clubYd = KLD.config.rules.clubLineYd;
    for (k = 1; k * 100 * YD <= maxM + 1; k++) {
      var lx = mx(k * 100 * YD);
      var gold = (k * 100 === clubYd);
      P.rect(g, lx, cy - gh, 1, gh * 2 + 1, gold ? COL.gold : '#63b866');
      T.draw(g, String(k), lx - 2, R.y + R.h - 9, { color: gold ? COL.gold : '#9ed6a4' });
    }
    P.rect(g, mx(0), cy - gh - 1, mx(maxM) - mx(0), 1, '#ffffff');
    P.rect(g, mx(0), cy + gh + 1, mx(maxM) - mx(0), 1, '#ffffff');
    // 조준선
    var aim = (G.aim || 0) * Math.PI / 180;
    var ex = Math.min(maxM, 430 * YD), ez = Math.tan(aim) * ex;
    P.dashLine(g, mx(0), cy, mx(ex), my(ez), '#ffffff', 1, 2);
    // 마커
    var list = G.markers || [], i;
    for (i = 0; i < list.length; i++) {
      var m = list[i];
      if (!(m.x > 0)) continue;
      P.dashLine(g, mx(m.x), cy - gh, mx(m.x), cy + gh, m.color, 1, 1);
      // 타깃은 ▲, 내 최고는 ● (모양으로도 구분)
      if (m.shape === 'tri') { g.fillStyle = m.color; g.fillRect(mx(m.x), cy - gh - 4, 1, 1); g.fillRect(mx(m.x) - 1, cy - gh - 3, 3, 1); }
    }
    // 정타 예상 낙하점 (+ 표시): 바람·조준·탄도에 따라 움직인다
    var pr = G.predict;
    if (pr && G.phase === 'address' && pr.x > 0) {
      var qx = mx(Math.min(pr.x, maxM)), qy = my(pr.z);
      g.fillStyle = pr.inGrid ? '#ffffff' : '#ff8f85';
      g.fillRect(qx - 2, qy, 5, 1); g.fillRect(qx, qy - 2, 1, 5);
    }
    // 이전 공
    var balls = (G.set && G.set.balls) || [];
    for (i = 0; i < balls.length; i++) {
      var b = balls[i];
      if (!b) continue;
      var bx = mx(b.total), by = my(b.z);
      if (b.valid) {
        var best = (i === G.set.bestIdx);
        P.rect(g, bx - 1, by - 1, best ? 3 : 2, best ? 3 : 2, best ? COL.gold : '#ffffff');
      } else {
        g.fillStyle = '#ff8f85';
        g.fillRect(bx - 1, by - 1, 1, 1); g.fillRect(bx + 1, by - 1, 1, 1); g.fillRect(bx, by, 1, 1);
        g.fillRect(bx - 1, by + 1, 1, 1); g.fillRect(bx + 1, by + 1, 1, 1);
      }
    }
    // 비행 중인 공 + 지나온 길
    var ball = G.ball;
    if (ball && ball.visible && !ball.onTee) {
      var path = ball.mapPath || [];
      g.fillStyle = '#cfe9ff';
      for (i = 0; i < path.length; i++) g.fillRect(mx(path[i].x), my(path[i].z), 1, 1);
      if (Math.floor(G.time * 10) % 2 === 0) P.rect(g, mx(ball.x) - 1, my(ball.z) - 1, 3, 3, '#ffffff');
      else P.rect(g, mx(ball.x), my(ball.z), 1, 1, '#ffffff');
    }
    // 티
    P.rect(g, mx(0) - 2, cy - 2, 2, 5, COL.gold);
    // 조준 표시
    var a = G.aim || 0;
    if (Math.abs(a) > 0.01) {
      var txt = (a < 0 ? 'L' : 'R') + Math.abs(a).toFixed(1);
      T.draw(g, txt, R.x + R.w - 4, R.y + 3, { color: '#ffffff', align: 'right', shadow: DECK_INK });
    }
  }

  function drawGauge(G, R) {
    var g = V.g, C = KLD.config.gauge;
    var ga = G.gauge || {};
    var barH = Math.floor((R.h - 22) / 2);
    var y1 = R.y + 9, y2l = y1 + barH + 3, y2 = y2l + 9;
    var x = R.x, w = R.w, ix = x + 1, iw = w - 2;
    var i;

    // ── 파워 ──
    var pActive = ga.phase === 'power', pLocked = ga.power != null;
    var range = ga.overShown ? C.overMax : 1;              // 레드존이 열린 라운드는 108%까지 그린다
    function px(p) { return ix + Math.round(P.clamp(p / range, 0, 1) * iw); }
    var lx = T.draw(g, 'POWER', x + 1, R.y, { color: pActive ? '#ffffff' : '#8a96b8' }) + x + 5;
    // 레드존 남은 횟수
    if (ga.overShown) {
      for (i = 0; i < C.overCharges; i++) {
        var on = i < (ga.overLeft || 0);
        g.fillStyle = on ? COL.over : '#3a4466';
        g.fillRect(lx + i * 7 + 1, R.y, 3, 1); g.fillRect(lx + i * 7, R.y + 1, 5, 3); g.fillRect(lx + i * 7 + 1, R.y + 4, 3, 2); g.fillRect(lx + i * 7 + 2, R.y + 6, 1, 1);
      }
      lx += C.overCharges * 7 + 3;
    }
    var pv = pActive ? ga.cursor : (pLocked ? ga.power : 0);
    var rightW = 0;
    if (pActive || pLocked) {
      var zone = pv > 1.0005 ? 'over' : (pv >= C.fullFrom ? 'full' : 'safe');
      var pc = COL[zone];
      var pct = Math.round(pv * 100) + '%';
      var mph = ga.mph ? ' ' + Math.round(ga.mph) + 'MPH' : '';
      var full = pct + mph;
      if (T.measure(full) > w - (lx - x) - 4) full = pct;
      rightW = T.draw(g, full, x + w - 1, R.y, { color: pc, align: 'right' });
    }
    // NEED: 넘어야 할 기록에 필요한 최소 파워
    if (ga.need != null && !pLocked) {
      var ntxt = ga.need > range ? 'NEED MORE' : 'NEED ' + Math.round(ga.need * 100) + '%';
      if (lx + T.measure(ntxt) < x + w - rightW - 4) T.draw(g, ntxt, lx, R.y, { color: COL.target });
    }
    P.rect(g, x, y1, w, barH, DECK_INK);
    var zones = [[0, C.fullFrom, COL.safe], [C.fullFrom, 1, COL.full]];
    if (ga.overShown) zones.push([1, C.overMax, COL.over]);
    for (i = 0; i < zones.length; i++) {
      var z = zones[i];
      var zx0 = px(z[0]), zx1 = px(z[1]);
      P.rect(g, zx0, y1 + 1, zx1 - zx0, barH - 2, P.mix(z[2], '#0c1020', 0.66));
      var fillTo = px(pv);
      if (fillTo > zx0) P.rect(g, zx0, y1 + 1, Math.min(zx1, fillTo) - zx0, barH - 2, z[2]);
      if (i === 2) {                                          // 레드존은 빗금으로도 구분
        P.dither(g, zx0, y1 + 1, zx1 - zx0, barH - 2, DECK_INK, 0);
        if (!(ga.overLeft > 0)) P.rect(g, zx0, y1 + 1, zx1 - zx0, barH - 2, 'rgba(7,10,28,0.6)');
      }
      if (i > 0) P.rect(g, zx0, y1, 1, barH, DECK_INK);
    }
    if (ga.need != null && !pLocked && ga.need <= range) {
      var nx = px(ga.need);
      g.fillStyle = COL.target;
      g.fillRect(nx - 2, y1 - 2, 5, 1); g.fillRect(nx - 1, y1 - 1, 3, 1); g.fillRect(nx, y1, 1, barH);
    }
    if (pActive || pLocked) {
      var cxp = px(pv);
      P.rect(g, cxp - 2, y1 - 1, 4, barH + 2, DECK_INK);
      P.rect(g, cxp - 1, y1 - 1, 2, barH + 2, '#ffffff');
    }

    // ── 임팩트 ──
    var iActive = ga.phase === 'impact';
    var impW = T.draw(g, 'IMPACT', x + 1, y2l, { color: iActive ? '#ffffff' : '#8a96b8' });
    if (ga.verdict) T.draw(g, ga.verdict.text, x + w - 1, y2l, { color: ga.verdict.color, align: 'right' });
    P.rect(g, x, y2, w, barH, DECK_INK);
    P.rect(g, ix, y2 + 1, iw, barH - 2, '#1a2242');
    var win = ga.window != null ? ga.window : (C.windowMs.safe / 1000 / C.sweepSec);
    var sweetX = ix + C.sweetPos * iw;
    function zoneRect(half) {
      var a = Math.max(ix, Math.round(sweetX - half * win * iw)), b = Math.min(ix + iw, Math.round(sweetX + half * win * iw) + 1);
      return [a, b - a];
    }
    var dim = !(iActive || pActive || ga.tapU != null);
    var zr = zoneRect(1.0);
    P.rect(g, zr[0], y2 + 1, zr[1], barH - 2, '#2b2f55');
    zr = zoneRect(C.good);                                    // GOOD: 파랑 + 디더
    P.rect(g, zr[0], y2 + 1, zr[1], barH - 2, dim ? P.mix(COL.good, '#0c1020', 0.6) : COL.good);
    P.dither(g, zr[0], y2 + 1, zr[1], barH - 2, '#12305a', 1);
    zr = zoneRect(C.great);                                   // GREAT: 노랑
    P.rect(g, zr[0], y2 + 1, zr[1], barH - 2, dim ? P.mix(COL.great, '#0c1020', 0.55) : COL.great);
    zr = zoneRect(C.perfect);                                 // PERFECT: 흰색
    P.rect(g, zr[0], y2 + 1, Math.max(2, zr[1]), barH - 2, dim ? '#aab2c8' : COL.perfect);
    // 스위트스팟 ▼ 표식과 박자 눈금(스위트스팟까지의 절반 지점)
    var sxp = Math.round(sweetX);
    g.fillStyle = '#ffffff';
    g.fillRect(sxp - 2, y2 - 3, 5, 1); g.fillRect(sxp - 1, y2 - 2, 3, 1); g.fillRect(sxp, y2 - 1, 1, 1);
    g.fillRect(sxp, y2 + barH, 1, 2);
    var beatX = ix + Math.round(C.sweetPos / 2 * iw);
    var beatOn = iActive && ga.cursor >= C.sweetPos / 2 && ga.cursor < C.sweetPos / 2 + 0.08;
    P.rect(g, beatX, y2 - 2, 1, 2, beatOn ? COL.gold : '#8a96b8');
    P.rect(g, beatX, y2 + barH, 1, 2, beatOn ? COL.gold : '#8a96b8');
    if (beatOn) P.rect(g, beatX - 1, y2 + 1, 3, barH - 2, 'rgba(255,210,63,0.5)');
    // 훅/슬라이스 안내
    var hookW = T.measure('◀HOOK'), sliceW = T.measure('SLICE▶');
    var leftEdge = sweetX - win * iw, rightEdge = sweetX + win * iw;
    var ty = y2 + Math.floor((barH - 7) / 2);
    var arrowW = T.measure('▶');
    if (barH >= 9) {
      // 글자가 들어갈 자리가 없으면 화살표만 남긴다 (스위트스팟이 오른쪽에 있어 늦은 쪽은 늘 좁다)
      if (leftEdge - ix > hookW + 6) T.draw(g, '◀HOOK', ix + 3, ty, { color: '#6f7aa0' });
      else if (leftEdge - ix > arrowW + 5) T.draw(g, '◀', ix + 3, ty, { color: '#6f7aa0' });
      if (ix + iw - rightEdge > sliceW + 4) T.draw(g, 'SLICE▶', ix + iw - sliceW - 2, ty, { color: '#6f7aa0' });
      else {
        // 스위트스팟이 오른쪽에 있어 늦은 쪽은 바 안에 글자 자리가 없다 → 판정이 뜨기 전까지 머리줄 오른쪽에 적는다
        if (ix + iw - rightEdge > arrowW + 5) T.draw(g, '▶', ix + iw - arrowW - 2, ty, { color: '#6f7aa0' });
        if (!ga.verdict && x + w - 1 - sliceW > x + 1 + impW + 6) T.draw(g, 'SLICE▶', x + w - 1, y2l, { color: '#6f7aa0', align: 'right' });
      }
    }
    if (iActive) {
      var cu = ix + Math.round(P.clamp(ga.cursor, 0, 1) * iw);
      if (ga.prevCursor != null) {                            // 잔상: 낮은 프레임에서도 움직임이 읽히게
        var pu = ix + Math.round(P.clamp(ga.prevCursor, 0, 1) * iw);
        P.rect(g, pu - 1, y2 + 1, 2, barH - 2, 'rgba(255,255,255,0.35)');
      }
      P.rect(g, cu - 2, y2 - 1, 4, barH + 2, DECK_INK);
      P.rect(g, cu - 1, y2 - 1, 2, barH + 2, '#ffffff');
    }
    if (ga.tapU != null) {
      var tu = ix + Math.round(P.clamp(ga.tapU, 0, 1) * iw);
      P.rect(g, tu - 2, y2 - 1, 4, barH + 2, DECK_INK);
      P.rect(g, tu - 1, y2 - 1, 2, barH + 2, ga.verdict ? ga.verdict.color : '#ffffff');
    }
  }

  function drawButton(g, r, label, opts) {
    opts = opts || {};
    var fill = opts.fill || '#24336b', border = opts.border || '#4d5f9e';
    var down = opts.down ? 1 : 0;
    P.rect(g, r.x + 1, r.y + r.h - 1, r.w - 2, 1, DECK_INK);
    P.panel(g, r.x, r.y + down, r.w, r.h - 1, fill, border, opts.shade || P.mix(fill, '#000000', 0.3));
    var font = opts.font || 'bit', sc = opts.scale || 1;
    var th = T.height({ font: font, scale: sc });
    if (label) {
      T.draw(g, label, r.x + Math.round(r.w / 2), r.y + down + Math.round((r.h - 1 - th) / 2), {
        font: font, scale: sc, color: opts.color || '#ffffff', align: 'center', shadow: opts.textShadow
      });
    }
  }

  function swingRect(L, un) {
    return (!un.aim && !un.traj && L.btn.swingFull) ? L.btn.swingFull : L.btn.swing;
  }

  function drawButtons(G) {
    var g = V.g, L = V.L, t = KLD.i18n.t, B = L.btn;
    var pressed = G.pressed || {};
    var un = G.unlock || {};
    var canAdjust = G.phase === 'address';
    var dimFill = '#1b2547', dimBorder = '#2c3a66', dimCol = '#56607a';
    if (un.aim) {
      drawButton(g, B.aimL, '◀', canAdjust ? { down: pressed.aimL } : { fill: dimFill, border: dimBorder, color: dimCol });
      drawButton(g, B.aimR, '▶', canAdjust ? { down: pressed.aimR } : { fill: dimFill, border: dimBorder, color: dimCol });
      if (L.aimRead) {
        var a = G.aim || 0, r = L.aimRead;
        T.draw(g, t('deck.aim'), r.x + Math.round(r.w / 2), r.y + 3, { font: 'kos', color: '#aab4d0', align: 'center' });
        var txt = Math.abs(a) < 0.01 ? '0.0' : ((a < 0 ? 'L' : 'R') + Math.abs(a).toFixed(1));
        T.draw(g, txt, r.x + Math.round(r.w / 2), r.y + 18, { color: '#ffffff', align: 'center' });
      }
    }
    if (un.traj) {
      var trajName = t('traj.' + (G.traj || 'mid'));
      var loft = KLD.config.shot.traj[G.traj || 'mid'].loft + '°';
      if (B.traj.h >= 30) {
        drawButton(g, B.traj, '', canAdjust ? { down: pressed.traj } : { fill: dimFill, border: dimBorder });
        var d = pressed.traj ? 1 : 0;
        T.draw(g, t('deck.traj') + ' ' + loft, B.traj.x + Math.round(B.traj.w / 2), B.traj.y + 3 + d, { font: 'kos', color: canAdjust ? '#aab4d0' : dimCol, align: 'center' });
        T.draw(g, trajName, B.traj.x + Math.round(B.traj.w / 2), B.traj.y + 15 + d, { font: 'ko', color: canAdjust ? '#ffffff' : dimCol, align: 'center' });
      } else {
        drawButton(g, B.traj, trajName, canAdjust ? { down: pressed.traj, font: 'ko' } : { fill: dimFill, border: dimBorder, color: dimCol, font: 'ko' });
      }
    }
    // 스윙 버튼: 단계에 따라 이름이 바뀐다
    var label = 'SWING', fill = '#e60012', border = '#ff8f85';
    if (G.phase === 'power') { label = 'POWER!'; fill = '#b8860b'; border = COL.full; }
    else if (G.phase === 'top' || G.phase === 'downswing') { label = 'IMPACT!'; fill = '#1f7a3a'; border = '#b7f0c0'; }
    else if (G.phase === 'flight') { label = '▶▶'; fill = '#24336b'; border = '#4d5f9e'; }
    else if (G.phase === 'result') { label = 'NEXT'; fill = '#24336b'; border = '#4d5f9e'; }
    else if (G.phase !== 'address') { fill = dimFill; border = dimBorder; }
    var sr = swingRect(L, un);
    var big = sr.h >= 30 && sr.w >= 80;
    drawButton(g, sr, label, { fill: fill, border: border, down: pressed.swing, scale: big ? 2 : 1, textShadow: P.mix(fill, '#000000', 0.45) });
  }

  // ── 타이틀 아트 ─────────────────────────────────────────
  function drawTitle(G) {
    var g = V.g, L = V.L, th = cur.th, brand = KLD.config.brand;
    var cx = Math.round(V.W / 2);
    var top = Math.round(L.world.h * (L.portrait ? 0.09 : 0.05));
    var bob = Math.round(Math.sin(G.time * 2) * 1.5);
    var drawn = null;
    if (hasLogo()) {
      drawn = KLD.logo.drawFit(g, 'full', cx, top + bob, V.W - 16, {
        variant: th.dark ? 'light' : 'dark', align: 'center', maxH: Math.floor(L.skyH * 0.52)
      });
    }
    if (drawn) {
      top += drawn.h + 6;
      if (String(drawn.key).indexOf('full') !== 0) {
        T.draw(g, brand.subtitle, cx, top + bob, { color: '#ffffff', outline: th.ink, align: 'center' });
        top += 12;
      }
    } else {
      var sc = Math.max(3, Math.min(8, Math.floor((V.W - 30) / (T.measure(brand.name) + 2))));
      sc = Math.min(sc, Math.max(3, Math.floor(L.skyH * 0.36 / 7)));
      T.drawBig(g, brand.name, cx, top + bob, sc, ['#ffffff', '#ffffff', '#f4f4f4', '#e8e8e8', '#dcdcdc', '#d0d0d0', '#c4c4c4'], th.ink, 'rgba(7,10,28,0.55)', 'center');
      top += 7 * sc + 6;
      T.draw(g, brand.subtitle, cx, top + bob, { color: '#ffffff', outline: th.ink, align: 'center' });
      top += 12;
    }
    var tag = brand.tagline[KLD.i18n.lang()] || brand.tagline.ko;
    T.draw(g, tag, cx, top + bob, { font: 'ko', color: COL.gold, outline: th.ink, align: 'center' });
  }

  // ── 전체 효과 ───────────────────────────────────────────
  function drawFx(G) {
    var g = V.g, list = G.fx || [], i;
    for (i = 0; i < list.length; i++) {
      var p = list[i];
      g.fillStyle = p.color;
      g.fillRect(Math.round(p.x), Math.round(p.y), p.size || 1, p.size || 1);
    }
    if (G.flash && G.flash.t > 0) {
      var k = P.clamp(G.flash.t / G.flash.dur, 0, 1);
      if (G.flash.border || G.reduceMotion) {
        // 테두리만 번쩍 (OB, 또는 '움직임 줄이기' 설정)
        if (k > 0.5 || Math.floor(G.time * 12) % 2 === 0) {
          var L = V.L.world, bw = 2;
          g.fillStyle = G.flash.color || '#ffffff';
          g.fillRect(L.x, L.y, L.w, bw); g.fillRect(L.x, L.y + L.h - bw, L.w, bw);
          g.fillRect(L.x, L.y, bw, L.h); g.fillRect(L.x + L.w - bw, L.y, bw, L.h);
        }
      } else {
        g.globalAlpha = k * Math.min(G.flash.max || 0.5, G.flash.alpha || 0.5);
        g.fillStyle = G.flash.color || '#ffffff';
        g.fillRect(0, 0, V.W, V.H);
        g.globalAlpha = 1;
      }
    }
    if (G.fade > 0) {
      // 8비트식 페이드: 줄무늬가 닫힌다
      var f = P.clamp(G.fade, 0, 1), bandH = 8;
      g.fillStyle = '#070a1c';
      for (var y = 0; y < V.H; y += bandH) g.fillRect(0, y, V.W, Math.ceil(bandH * f));
    }
  }

  // ── 한 프레임 ───────────────────────────────────────────
  function frame(G) {
    var g = V.g;
    V.L = G.showDeck ? V.Ldeck : V.Lfull;
    setTheme(G.theme || 'day');
    g.fillStyle = '#070a1c';
    g.fillRect(0, 0, V.W, V.H);
    drawWorld(G);
    drawSmash(G);
    if (G.showTitle) drawTitle(G);
    if (G.showHud) {
      if (!drawSpeedPop(G)) drawLive(G);
      drawBanner(G);
      drawMonitor(G);
      drawCoach(G);
      drawHint(G);
      drawToast(G);
      drawHud(G);
    } else {
      drawBanner(G);
    }
    if (G.showDeck) drawDeck(G);
    drawFx(G);
  }

  // 화면 좌표(CSS px) → 내부 픽셀
  function toInternal(clientX, clientY) {
    return { x: (clientX - V.left) / V.cssScale, y: (clientY - V.top) / V.cssScale };
  }

  // 내부 픽셀 좌표가 어느 버튼 위인지
  function hit(x, y, G) {
    var L = G && !G.showDeck ? V.Lfull : V.Ldeck;
    var B = L.btn, names = [];
    if (G && G.showHud) names = ['pause', 'mute'];
    var un = (G && G.unlock) || {};
    if (L.deck) {
      if (un.aim) names.push('aimL', 'aimR');
      if (un.traj) names.push('traj');
      names.push('swing');
    }
    for (var i = 0; i < names.length; i++) {
      var r = names[i] === 'swing' ? swingRect(L, un) : B[names[i]];
      if (!r) continue;
      var m = (names[i] === 'pause' || names[i] === 'mute') ? 4 : 1;   // 작은 버튼은 판정 여유
      if (x >= r.x - m && x < r.x + r.w + m && y >= r.y - m && y < r.y + r.h + m) return names[i];
    }
    return null;
  }

  var api = {
    V: V, THEMES: THEMES, COL: COL, PPM: PPM, YD: YD,
    init: init, resize: resize, frame: frame, setTheme: setTheme,
    toInternal: toInternal, hit: hit, resultLayout: resultLayout,
    distNum: distNum, unitLabel: unitLabel, clockText: clockText,
    layout: function (withDeck) { return withDeck ? V.Ldeck : V.Lfull; }
  };
  KLD.render = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
