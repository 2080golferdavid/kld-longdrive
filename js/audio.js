/*
 * KLD LONG DRIVE - 칩튠 오디오 엔진
 * WebAudio만으로 모든 효과음과 배경 음악 4곡을 합성한다(샘플·외부 파일 없음).
 * 음색: 펄스 2성부(듀티 12.5/25/50%) + NES식 삼각파 베이스 + 노이즈.
 * AudioContext가 없거나(Node) 잠금 해제 전이면 모든 API가 조용히 아무 일도 하지 않는다.
 */
(function (root) {
  'use strict';
  var KLD = root.KLD = root.KLD || {};

  var EPS = 0.0001;       // 지수 램프에 쓰는 최솟값(0 이하 금지)
  var LOOKAHEAD = 0.12;   // 스케줄러 선행 예약 시간(초)
  var TICK_MS = 25;       // 스케줄러 타이머 주기
  var GAUGE_VOL = 0.13;   // 게이지 음 음량
  var GAUGE_LO = 196;     // 게이지 0 -> 196Hz
  var GAUGE_HI = 988;     // 게이지 1 -> 988Hz

  // ---------- 상태 ----------
  var ctx = null;            // AudioContext (unlock 때 생성)
  var bus = null;            // { master, sfx, music(덕킹), musicVol }
  var unlocked = false;      // unlock() 성공 여부
  var pinged = false;        // 무음 버퍼를 한 번이라도 재생했는지
  var pingAt = 0;            // 마지막 무음 버퍼 재생 시각(ms)
  var pingsOut = 0;          // 아직 끝나지 않은 무음 버퍼 수(컨텍스트가 멈춰 있으면 끝나지 않는다)
  var apiSuspended = false;  // suspend()로 멈춘 상태
  var ctxHeld = false;       // ctx.suspend()를 요청해 둔 상태(state 값은 한 박자 늦게 바뀐다)
  var graceUntil = 0;        // resume 요청 직후 예약을 허용하는 시각(ms)
  var muted = false;
  var vol = { master: 0.8, sfx: 0.9, music: 0.45 };
  var noiseBuf = null;       // 한 번만 만드는 노이즈 버퍼
  var silentBuf = null;      // 1샘플 무음 버퍼
  var waves = {};            // PeriodicWave 캐시
  var live = 0;              // 아직 끝나지 않은 단발 소스 수
  var errors = [];           // 삼킨 예외 기록(테스트·디버그용)
  var wantMusic = null;      // 요청된 곡(잠금 해제 전이면 대기)
  var mus = null;            // 재생 중인 곡 { name, tr, out, sd, t0, n }
  var timer = null;          // 스케줄러 타이머
  var gauge = null;          // 게이지 음 { osc, gain, at }
  var lastSfx = {};          // 효과음별 마지막 재생 시각
  var duckEnd = 0;           // 덕킹이 끝나는 시각
  var duckDepth = 1;         // 현재 덕킹 깊이
  var settleAt = 0;          // 컴프레서가 안정되는 시각(이보다 이른 효과음은 여기로 민다)
  var failed = false;        // 신호 경로를 만들다 실패함(다시 시도하지 않는다)

  // ---------- 작은 도구 ----------
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function unit(v, d) { return clamp(num(v, d), 0, 1); }
  function hz(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function swallow(p) { if (p && typeof p.then === 'function') p.then(null, function () {}); }
  function setP(param, v) { if (param) param.value = v; }
  function off(node) { try { node.disconnect(); } catch (e) { /* 이미 해제됨 */ } }
  function note(e) {
    var s;
    try { s = String((e && e.message) || e); } catch (x) { s = 'unprintable error'; }   // 문자열로 못 바꾸는 값이 던져져도 API는 예외를 내지 않는다
    if (errors.length < 20) errors.push(s);
  }

  // 예약된 자동화를 지운다(가능하면 현재 값을 유지한 채로)
  function hold(p, t) {
    if (typeof p.cancelAndHoldAtTime === 'function') p.cancelAndHoldAtTime(t);
    else p.cancelScheduledValues(t);
  }
  // 값이 튀지 않게 부드럽게 옮긴다
  function glide(p, v, t) { hold(p, t); p.setTargetAtTime(v, t, 0.015); }

  // ---------- 악보 표기 ----------
  // "L2 C4 E4:4 r:2 | ..." : 음이름+옥타브[:길이], r=쉼표, Ln=기본 길이, |=마디선(16스텝 검증)
  var SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function midi(name) {
    var m = /^([A-G])([#b]?)(\d)$/.exec(name);
    if (!m) return null;
    return SEMI[m[1]] + (m[2] === '#' ? 1 : (m[2] === 'b' ? -1 : 0)) + (parseInt(m[3], 10) + 1) * 12;
  }
  function parse(str) {
    var tok = String(str).split(/\s+/), ev = [], pos = 0, def = 2, bad = 0, i, t, p, n, m;
    for (i = 0; i < tok.length; i++) {
      t = tok[i];
      if (!t) continue;
      if (t === '|') { if (pos % 16) bad++; continue; }
      if (t.charAt(0) === 'L') { def = parseInt(t.slice(1), 10) || def; continue; }
      p = t.split(':');
      n = p.length > 1 ? parseInt(p[1], 10) : def;
      if (!(n > 0)) { bad++; continue; }
      if (p[0] !== 'r') {
        m = midi(p[0]);
        if (m === null) bad++; else ev.push({ s: pos, n: n, m: m });
      }
      pos += n;
    }
    return { ev: ev, len: pos, bad: bad };
  }

  // ---------- 컨텍스트와 신호 경로 ----------
  // sfx 버스 + (곡 -> 덕킹 -> 음악 음량) -> 마스터 -> 컴프레서 -> 출력
  function create() {
    var w = (typeof window !== 'undefined' && window) ? window : root;
    var AC = w.AudioContext || w.webkitAudioContext;
    var c, comp, n, d, i, seed;
    if (failed || typeof AC !== 'function') return false;
    try { c = new AC(); } catch (e) { return false; }
    try {
      ctx = c;
      bus = { master: c.createGain(), sfx: c.createGain(), music: c.createGain(), musicVol: c.createGain() };
      bus.master.gain.value = muted ? 0 : vol.master;
      bus.sfx.gain.value = vol.sfx;
      bus.musicVol.gain.value = vol.music;
      bus.music.gain.value = 1;
      bus.sfx.connect(bus.master);
      bus.music.connect(bus.musicVol);
      bus.musicVol.connect(bus.master);
      if (typeof c.createDynamicsCompressor === 'function') {
        comp = c.createDynamicsCompressor();   // 완만한 컴프레서(겹칠 때 클리핑 방지)
        setP(comp.threshold, -12); setP(comp.knee, 10); setP(comp.ratio, 3);
        setP(comp.attack, 0.003);
        // 컴프레서는 만들어진 직후 약 0.1초 동안 소리를 크게 줄인다(내부 검출값이 0에서 출발).
        // 처음에만 릴리스를 짧게 잡아 빨리 회복시키고, 그 뒤에 평소 값(0.2초)으로 돌린다.
        if (comp.release && typeof comp.release.setValueAtTime === 'function') {
          comp.release.setValueAtTime(0.01, c.currentTime);
          comp.release.setValueAtTime(0.2, c.currentTime + 0.12);
        } else {
          setP(comp.release, 0.2);
        }
        bus.master.connect(comp);
        comp.connect(c.destination);
      } else {
        bus.master.connect(c.destination);
      }
      // 노이즈 버퍼(2초)는 한 번만 만들어 계속 쓴다(xorshift 난수, 재생 위치만 매번 다르다).
      n = Math.floor(c.sampleRate * 2);
      noiseBuf = c.createBuffer(1, n, c.sampleRate);
      d = noiseBuf.getChannelData(0);
      seed = 0x2F6E2B1;
      for (i = 0; i < n; i++) {
        seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
        d[i] = ((seed >>> 0) / 4294967296) * 2 - 1;
      }
      silentBuf = c.createBuffer(1, 1, c.sampleRate);
      settleAt = c.currentTime + 0.025;
      // 컨텍스트가 멈추면 타이머도 멈추고, 다시 돌면 이어서 예약한다
      c.onstatechange = function () {
        if (ctx !== c) return;
        if (c.state === 'running') startTimer(); else stopTimer();
      };
    } catch (e2) {
      note(e2);
      failed = true;
      ctx = null; bus = null; noiseBuf = null; silentBuf = null; waves = {};
      try { if (typeof c.close === 'function') swallow(c.close()); } catch (e3) { /* 무시 */ }
      return false;
    }
    return true;
  }

  // state 속성이 없는 구형 webkit 구현은 항상 도는 것으로 본다
  function running() { return ctx.state === undefined || ctx.state === 'running'; }

  // 멈춘 컨텍스트를 깨운다(사용자 제스처 안에서 불려야 확실하다).
  // suspend() 직후에는 state 가 아직 "running" 으로 보일 수 있으므로(상태 변화는 비동기), 멈춰 달라고 해 둔 적이 있으면 무조건 깨운다.
  function wake() {
    if ((ctxHeld || !running()) && typeof ctx.resume === 'function') {
      ctxHeld = false;
      graceUntil = Date.now() + 500;
      swallow(ctx.resume());
    }
  }

  // iOS 잠금 해제용 무음 버퍼 재생
  function ping() {
    var src;
    pinged = true;
    pingAt = Date.now();
    if (pingsOut >= 3) return;   // 컨텍스트가 끝내 돌지 않는 환경에서 탭마다 노드가 쌓이지 않게
    src = ctx.createBufferSource();
    src.buffer = silentBuf;
    src.connect(ctx.destination);
    pingsOut++;
    src.onended = function () { pingsOut--; off(src); };
    src.start(ctx.currentTime);
  }

  // 지금 소리를 예약해도 되는가
  function canPlay() {
    if (!ctx || !unlocked || apiSuspended) return false;
    if (running()) return true;
    return Date.now() < graceUntil;   // 첫 탭 직후(resume 대기 중)에는 허용
  }

  // ---------- 파형 ----------
  var SHAPE = {
    p12: function (x) { return x < 0.125 ? 1 : -1; },
    p25: function (x) { return x < 0.25 ? 1 : -1; },
    p50: function (x) { return x < 0.5 ? 1 : -1; },
    // NES식 4비트 계단 삼각파(작은 스피커에서도 들리는 배음이 생긴다)
    tri: function (x) { var s = Math.floor(x * 32); return (s < 16 ? 15 - s : s - 16) / 7.5 - 1; }
  };
  var FALLBACK = { p12: ['square', 0.45], p25: ['square', 0.65], p50: ['square', 1], tri: ['triangle', 1] };

  // 한 주기 파형 fn(0..1)을 푸리에 급수로 바꿔 PeriodicWave를 만든다(미지원이면 null)
  function fourier(key, fn) {
    var N = 32, M = 256, re, im, n, k, x, ph;
    if (waves[key] !== undefined) return waves[key];
    waves[key] = null;
    if (typeof ctx.createPeriodicWave !== 'function') return null;
    re = new Float32Array(N + 1);
    im = new Float32Array(N + 1);
    for (k = 0; k < M; k++) {
      x = fn((k + 0.5) / M);
      for (n = 1; n <= N; n++) {
        ph = 2 * Math.PI * n * (k + 0.5) / M;
        re[n] += x * Math.cos(ph);
        im[n] += x * Math.sin(ph);
      }
    }
    waves[key] = ctx.createPeriodicWave(re, im);
    return waves[key];
  }

  // 파형 지정. 반환값은 음량 보정 계수(대체 파형을 쓸 때만 1 미만)
  function setWave(osc, w) {
    var pw;
    if (SHAPE[w]) {
      pw = fourier(w, SHAPE[w]);
      if (pw && typeof osc.setPeriodicWave === 'function') { osc.setPeriodicWave(pw); return 1; }
      osc.type = FALLBACK[w][0];
      return FALLBACK[w][1];
    }
    osc.type = w === 'tria' ? 'triangle' : (w === 'saw' ? 'sawtooth' : 'sine');
    return 1;
  }

  // ---------- 단발 음 ----------
  // 시작·정지를 예약하고, 끝나면 연결을 끊어 노드가 쌓이지 않게 한다
  function oneShot(src, extra, t0, t1, offset) {
    live++;
    src.onended = function () {
      var i;
      live--;
      off(src);
      for (i = 0; i < extra.length; i++) off(extra[i]);
    };
    if (offset === undefined) src.start(t0); else src.start(t0, offset);
    src.stop(t1);
  }

  // 오실레이터 한 음.
  // o: { w 파형, f 주파수, f2 끝 주파수, fd 슬라이드 시간, t 시작, d 길이, v 음량,
  //      a 어택, s 서스테인 비율(없으면 타악기형 감쇠), fl 타악기형 끝 음량 비율, dec 디케이, r 릴리스,
  //      vib 비브라토(센트), out 출력 노드 }
  function tone(o) {
    var osc = ctx.createOscillator(), g = ctx.createGain(), p = g.gain;
    var v = Math.max(EPS * 2, o.v * setWave(osc, o.w));
    var t0, d, end, a, r, lv, x, k, sign;
    // 자동화가 걸리기 전 프레임에 기본값 1로 새어 "틱" 소리가 나지 않게 0으로 둔다.
    // 시각을 읽기 전에 한다: value 대입은 setValueAtTime(v, currentTime)과 같고 currentTime 은 JS 실행 중에도 흐른다.
    // 순서가 반대면 이 0이 엔벨로프 시작(t0)보다 뒤에 놓여, 과거 시각을 당겨 주지 않는 구현에서는 음이 통째로 죽는다.
    p.value = 0;
    t0 = Math.max(num(o.t, 0), ctx.currentTime);
    d = Math.max(0.012, o.d); end = t0 + d;
    a = Math.min(o.a === undefined ? 0.004 : o.a, d * 0.5);
    osc.frequency.setValueAtTime(o.f, t0);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), t0 + Math.min(o.fd || d, d));
    p.setValueAtTime(EPS, t0);
    p.linearRampToValueAtTime(v, t0 + a);
    if (o.s === undefined) {   // 타악기형: fl 비율까지 지수 감쇠한 뒤 짧게 닫는다
      r = Math.min(0.008, d * 0.25);
      p.exponentialRampToValueAtTime(Math.max(EPS, v * (o.fl || 0.03)), end - r);
      p.linearRampToValueAtTime(0, end);
    } else {
      r = Math.min(o.r === undefined ? 0.02 : o.r, d * 0.4);
      lv = v;
      if (o.dec) {
        lv = Math.max(EPS, v * o.s);
        p.exponentialRampToValueAtTime(lv, Math.min(t0 + a + o.dec, end - r));
      }
      p.setValueAtTime(lv, end - r);
      p.linearRampToValueAtTime(0, end);
    }
    if (o.vib && osc.detune && d > 0.36) {   // 긴 음에만 늦게 들어오는 비브라토
      x = t0 + 0.18; sign = 1;
      osc.detune.setValueAtTime(0, x);
      for (k = 0; x + 0.09 < end && k < 40; k++) {
        x += 0.09;
        osc.detune.linearRampToValueAtTime(o.vib * sign, x);
        sign = -sign;
      }
    }
    osc.connect(g);
    g.connect(o.out || bus.sfx);
    oneShot(osc, [g], t0, end + 0.01);
  }
  // 짧은 칩 음(UI·확인음): 음량이 천천히 줄어 음높이가 또렷하다
  function blip(w, f, t, d, v) { tone({ w: w, f: f, t: t, d: d, v: v, fl: 0.3 }); }
  // 타격음: 빠르게 감쇠하고, f2가 있으면 그쪽으로 피치가 미끄러진다
  function hit(w, f, t, d, v, f2) { tone({ w: w, f: f, f2: f2, t: t, d: d, v: v }); }

  // 노이즈 한 방. o: { t, d, v, a, ft 필터 종류, f, f2, q, out }
  function noise(o) {
    var src = ctx.createBufferSource(), g = ctx.createGain(), p = g.gain, extra = [g], flt;
    var d = Math.max(0.012, o.d), v = Math.max(EPS * 2, o.v);
    var a = Math.min(o.a === undefined ? 0.002 : o.a, d * 0.8);
    var t0, end;
    p.value = 0;   // 시각을 읽기 전에(tone 참고)
    t0 = Math.max(num(o.t, 0), ctx.currentTime);
    end = t0 + d;
    src.buffer = noiseBuf;
    src.loop = true;
    if (o.ft) {
      flt = ctx.createBiquadFilter();
      flt.type = o.ft;
      flt.frequency.setValueAtTime(o.f, t0);
      if (o.f2) flt.frequency.exponentialRampToValueAtTime(o.f2, end);
      setP(flt.Q, o.q || 0.7);
      src.connect(flt);
      flt.connect(g);
      extra.push(flt);
    } else {
      src.connect(g);
    }
    p.setValueAtTime(EPS, t0);
    p.linearRampToValueAtTime(v, t0 + a);
    p.exponentialRampToValueAtTime(EPS, end);
    g.connect(o.out || bus.sfx);
    oneShot(src, extra, t0, end + 0.01, Math.random() * 1.5);
  }

  // 관중 소리: 노이즈 -> 움직이는 밴드패스 2개(포먼트) -> 부풀었다 잦아드는 엔벨로프
  // o: { t, d, v, pk 정점 위치(0..1), hold 출렁임이 끝나는 위치, fa/fb [시작, 정점, 끝] 주파수 }
  function crowd(o) {
    var src = ctx.createBufferSource(), b1 = ctx.createBiquadFilter(), b2 = ctx.createBiquadFilter();
    var g2 = ctx.createGain(), g = ctx.createGain(), p = g.gain, t0, end, tp, x, k;
    p.value = 0;   // 시각을 읽기 전에(tone 참고)
    t0 = Math.max(o.t, ctx.currentTime); end = t0 + o.d; tp = t0 + o.d * o.pk;
    src.buffer = noiseBuf;
    src.loop = true;
    b1.type = 'bandpass'; setP(b1.Q, 1.1);
    b2.type = 'bandpass'; setP(b2.Q, 2.2);
    b1.frequency.setValueAtTime(o.fa[0], t0);
    b1.frequency.exponentialRampToValueAtTime(o.fa[1], tp);
    b1.frequency.exponentialRampToValueAtTime(o.fa[2], end);
    b2.frequency.setValueAtTime(o.fb[0], t0);
    b2.frequency.exponentialRampToValueAtTime(o.fb[1], tp);
    b2.frequency.exponentialRampToValueAtTime(o.fb[2], end);
    g2.gain.value = 0.5;
    p.setValueAtTime(EPS, t0);
    p.linearRampToValueAtTime(o.v, tp);
    for (x = tp + 0.07, k = 0; x < t0 + o.d * o.hold && k < 24; x += 0.07, k++) {
      p.linearRampToValueAtTime(o.v * (0.72 + 0.28 * Math.random()), x);   // 군중의 출렁임
    }
    p.exponentialRampToValueAtTime(o.v * 0.05, end - 0.06);
    p.linearRampToValueAtTime(0, end);
    src.connect(b1); src.connect(b2);
    b1.connect(g); b2.connect(g2); g2.connect(g);
    g.connect(bus.sfx);
    oneShot(src, [b1, b2, g2, g], t0, end + 0.01, Math.random() * 1.5);
  }

  // 드럼 한 타. c: k 킥, s 스네어, h 닫힌 햇, o 열린 햇, c 크래시(+킥)
  function drum(c, t, out, lv) {
    if (c === 'k' || c === 'c') tone({ w: 'tria', f: 170, f2: 46, fd: 0.09, t: t, d: 0.12, v: 0.3 * lv, out: out });
    if (c === 's') {
      noise({ t: t, d: 0.11, v: 0.3 * lv, ft: 'bandpass', f: 1900, q: 0.6, out: out });
      tone({ w: 'tria', f: 230, f2: 150, t: t, d: 0.05, v: 0.1 * lv, out: out });
    } else if (c === 'h') {
      noise({ t: t, d: 0.03, v: 0.08 * lv, ft: 'highpass', f: 7000, out: out });
    } else if (c === 'o') {
      noise({ t: t, d: 0.13, v: 0.08 * lv, ft: 'highpass', f: 6000, out: out });
    } else if (c === 'c') {
      noise({ t: t, d: 0.55, v: 0.14 * lv, ft: 'highpass', f: 4500, out: out });
    }
  }

  // 음악을 잠깐 줄인다(depth까지 내렸다가 sec 뒤에 복귀). 진행 중인 더 깊은 덕킹은 유지한다.
  function duck(depth, sec) {
    var p = bus.music.gain, t = ctx.currentTime, active = t < duckEnd;
    duckDepth = active ? Math.min(duckDepth, depth) : depth;
    duckEnd = active ? Math.max(duckEnd, t + sec) : t + sec;
    hold(p, t);
    p.setTargetAtTime(duckDepth, t, 0.02);
    p.setTargetAtTime(1, duckEnd, 0.15);
  }

  // 오디오 시계로 t에 fn을 실행한다(via에 잠깐 연결되는 무음 소스 사용)
  function after(t, via, fn) {
    var src = ctx.createBufferSource();
    src.buffer = silentBuf;
    src.connect(via);
    live++;
    src.onended = function () { live--; off(src); fn(); };
    src.start(Math.max(t, ctx.currentTime));
  }

  // ---------- 게이지 음 ----------
  // 오실레이터 하나를 계속 쓰면서 피치만 따라가게 한다(프레임마다 노드를 만들지 않는다)
  function newGauge(f, t) {
    var osc = ctx.createOscillator(), gn = ctx.createGain();
    var g = { osc: osc, gain: gn, at: -1, lv: GAUGE_VOL * setWave(osc, 'p25') };
    osc.frequency.setValueAtTime(f, t);
    gn.gain.value = 0;
    osc.connect(gn);
    gn.connect(bus.sfx);
    live++;
    osc.onended = function () { live--; off(osc); off(gn); };
    osc.start(t);
    return g;
  }

  function gaugeStop(hard) {
    var g = gauge, t;
    if (!g) return;
    gauge = null;
    t = ctx.currentTime;
    hold(g.gain.gain, t);
    if (hard) g.gain.gain.setValueAtTime(0, t); else g.gain.gain.setTargetAtTime(0, t, 0.02);
    try { g.osc.stop(t + 0.15); } catch (e) { g.osc.onended(); }
  }

  function gaugeTone(value) {
    var t, f, g;
    if (typeof value !== 'number' || !isFinite(value)) { if (ctx) gaugeStop(false); return; }
    if (!canPlay()) return;
    t = ctx.currentTime;
    f = GAUGE_LO * Math.pow(GAUGE_HI / GAUGE_LO, clamp(value, 0, 1));
    g = gauge;
    if (!g) g = gauge = newGauge(f, t);
    else g.osc.frequency.setTargetAtTime(f, t, 0.012);
    if (t - g.at > 0.08) {   // 워치독: 호출이 끊기면 0.5초 뒤 스스로 잦아든다
      g.at = t;
      hold(g.gain.gain, t);
      g.gain.gain.setTargetAtTime(g.lv, t, 0.012);
      g.gain.gain.setTargetAtTime(0, t + 0.5, 0.05);
    }
  }

  // ---------- 징글(짧은 팡파르) ----------
  // u: 스텝 길이(초), v: 성부 목록(리드 / 화음 / 베이스), d: 드럼(스텝당 한 글자)
  var JINGLES = {
    // C 장조 아르페지오 상행, 약 0.84초
    newBest: { u: 0.07, v: [
      { w: 'p50', v: 0.15, n: 'L1 G5 C6 E6 G6:3 E6 G6:5' },
      { w: 'p25', v: 0.1, n: 'L1 E5 G5 C6 E6:3 C6 E6:5' },
      { w: 'tri', v: 0.2, n: 'C4:3 C4:3 G3:1 C4:5' }] },
    // C - F - G - C, 1.6초
    record: { u: 0.1, d: 'c..k..s..ssc....', v: [
      { w: 'p50', v: 0.15, n: 'L1 C5 E5 G5 C6:3 A5 F5 A5 B5:2 C6:5' },
      { w: 'p25', v: 0.1, n: 'L1 E4 G4 C5 E5:3 F5 C5 F5 G5:2 E5:5' },
      { w: 'tri', v: 0.2, n: 'C4:3 C4:3 F3:3 G3:2 C4:5' }] },
    // C - F - G - C, 2.0초
    roundWin: { u: 0.125, d: 'k.s.k.s.k.ssc...', v: [
      { w: 'p50', v: 0.15, n: 'L1 E5 G5 C6:2 F5 A5 C6:2 D6 C6 B5 D6 C6:4' },
      { w: 'p25', v: 0.1, n: 'L1 C5 E5 G5:2 C5 F5 A5:2 B5 A5 G5 B5 E5:4' },
      { w: 'tri', v: 0.2, n: 'C4:4 F3:4 G3:4 C4:4' }] },
    // Am 하행(미-레-도-시-라), 약 1.96초. 작고 부드럽게.
    roundLose: { u: 0.14, v: [
      { w: 'p50', v: 0.1, n: 'E5:2 D5:2 C5:2 B4:2 A4:6' },
      { w: 'p25', v: 0.07, n: 'C5:2 B4:2 A4:2 G4:2 E4:6' },
      { w: 'tri', v: 0.17, n: 'A3:6 E3:2 A3:6' }] },
    // D - G - A - D (우승 곡과 같은 D 장조), 4.0초
    champion: { u: 0.125, d: 'c.....ssk.....ssk..s.sssc.......', v: [
      { w: 'p50', v: 0.15, n: 'L1 D4 F#4 A4 D5:5 G4 B4 D5 G5:5 A4 C#5 E5 A5:3 B5 C#6 D6:8' },
      { w: 'p25', v: 0.1, n: 'L1 A3 D4 F#4 A4:5 D4 G4 B4 D5:5 E4 A4 C#5 E5:3 G5 A5 F#5:8' },
      { w: 'tri', v: 0.2, n: 'D3:3 D3:1 A3:2 D3:2 G3:3 G3:1 D4:2 G3:2 A3:3 A3:1 E4:2 A3:2 D4:8' }] }
  };

  function playJingle(name, t) {
    var j = JINGLES[name], i, k, v, e, flat;
    for (i = 0; i < j.v.length; i++) {
      v = j.v[i];
      if (!v.p) v.p = parse(v.n);
      flat = v.w === 'tri';
      for (k = 0; k < v.p.ev.length; k++) {
        e = v.p.ev[k];
        tone({ w: v.w, f: hz(e.m), t: t + e.s * j.u, d: e.n * j.u * 0.92, v: v.v,
          s: flat ? 1 : 0.7, dec: flat ? 0 : 0.08, r: 0.03, vib: e.n * j.u > 0.45 ? 12 : 0 });
      }
    }
    if (j.d) for (i = 0; i < j.d.length; i++) drum(j.d.charAt(i), t + i * j.u, bus.sfx, 0.8);
  }

  // ---------- 효과음 ----------
  // 임팩트 품질별 설정: n 타격 노이즈 음량, hp 노이즈 하이패스(높을수록 날카롭다), b 몸통 "퍽" 음량,
  // f "핑" 기본음, d 울림 길이, r 배음 비율(1.48·2.76은 금속성 비화성 배음), v 배음 음량
  var IMPACT = {
    perfect: { n: 0.42, hp: 3200, b: 0.3, f: 3136, d: 0.45, r: [1, 1.48, 2.76], v: [0.2, 0.1, 0.05] },
    great: { n: 0.33, hp: 2400, b: 0.26, f: 2637, d: 0.3, r: [1, 1.48], v: [0.16, 0.07] },
    good: { n: 0.25, hp: 1700, b: 0.22, f: 2093, d: 0.2, r: [1, 1.48], v: [0.12, 0.045] }
  };

  var MAJOR = [0, 2, 4, 5, 7, 9, 11];   // 장음계(반음 수)

  var SFX = {
    uiMove: function (t) { blip('p25', 1319, t, 0.045, 0.18); },
    uiSelect: function (t) { blip('p25', 988, t, 0.06, 0.2); blip('p25', 1319, t + 0.055, 0.11, 0.21); },
    uiBack: function (t) { blip('p25', 659, t, 0.06, 0.2); blip('p25', 494, t + 0.055, 0.12, 0.2); },
    gaugeStart: function (t) {
      hit('tria', 880, t, 0.06, 0.18, 1175);
      noise({ t: t, d: 0.015, v: 0.1, ft: 'highpass', f: 5000 });
    },
    // 파워가 클수록 높은 "삐딩". 97% 이상이면 반짝이는 아르페지오(MAX!)
    powerSet: function (t, o) {
      var p = unit(o.power, 0.7), f = 392 * Math.pow(2, p * 1.5), sp = [1319, 1661, 1976, 2637], i;
      blip('p50', f, t, 0.04, 0.15);
      blip('p50', f * 1.5, t + 0.035, 0.1, 0.17);
      if (p >= 0.97) for (i = 0; i < 4; i++) blip('p12', sp[i], t + 0.1 + i * 0.045, 0.09, 0.16);
    },
    // 클럽 휘두르는 소리: 위로 쓸어 올리는 밴드패스 노이즈(0.30 -> 0.18초, 셀수록 짧고 밝고 크다)
    swing: function (t, o) {
      var p = unit(o.power, 0.7), d = 0.3 - 0.12 * p;
      noise({ t: t, d: d, v: 0.3 + 0.4 * p, a: d * 0.45, ft: 'bandpass', f: 320 + 200 * p, f2: 2200 + 2600 * p, q: 1.4 });
    },
    // 드라이버 타격: 날카로운 노이즈 + 몸통 "퍽" + 티타늄 "핑"
    impact: function (t, o) {
      var q = o.quality, k = 0.7 + 0.3 * unit(o.power, 0.8), c = IMPACT.hasOwnProperty(q) ? IMPACT[q] : IMPACT.good, i;
      if (q === 'miss') {   // 빗맞음: 둔탁한 "턱"
        noise({ t: t, d: 0.09, v: 0.5 * k, ft: 'lowpass', f: 1400 });
        hit('tria', 210, t, 0.14, 0.3 * k, 90);
        hit('p50', 587, t, 0.07, 0.07 * k);
        hit('p50', 831, t, 0.05, 0.05 * k);
      } else {
        noise({ t: t, d: 0.045, v: c.n * k, ft: 'highpass', f: c.hp });
        hit('tria', 190, t, 0.1, c.b * k, 70);
        for (i = 0; i < c.r.length; i++) {
          hit('p25', c.f * c.r[i], t, c.d * (i ? 0.7 : 1), c.v[i] * k, c.f * c.r[i] * 0.985);
        }
      }
      duck(0.5, 0.25);
    },
    land: function (t, o) {
      var i = unit(o.intensity, 0.6);
      hit('tria', 220, t, 0.17, 0.1 + 0.14 * i, 60);
      noise({ t: t, d: 0.14, v: 0.05 + 0.09 * i, ft: 'bandpass', f: 3000, f2: 1100, q: 0.8 });
    },
    // 두 번째 이후 바운드: 같은 세기라도 첫 착지(land)보다 짧고 여리다
    bounce: function (t, o) {
      var i = unit(o.intensity, 0.5);
      hit('tria', 250, t, 0.1, 0.09 + 0.09 * i, 95);
      noise({ t: t, d: 0.06, v: 0.05 + 0.05 * i, ft: 'bandpass', f: 2600, f2: 1400, q: 0.8 });
    },
    inGrid: function (t) {
      blip('p25', 1047, t, 0.08, 0.17);
      blip('p25', 1319, t + 0.07, 0.08, 0.17);
      blip('p25', 1568, t + 0.14, 0.2, 0.18);
    },
    // OB: 낮고 버징한 두 음이 증4도 아래로 떨어진다
    ob: function (t) {
      var f = [196, 139], i, d;
      for (i = 0; i < 2; i++) {
        d = i ? 0.34 : 0.17;
        tone({ w: 'p12', f: f[i], t: t + i * 0.19, d: d, v: 0.18, s: 1, r: 0.03 });
        tone({ w: 'p25', f: f[i] * 1.012, t: t + i * 0.19, d: d, v: 0.12, s: 1, r: 0.03 });
      }
    },
    newBest: function (t) { playJingle('newBest', t); },
    record: function (t) { playJingle('record', t); duck(0.25, 1.6); },
    crowdCheer: function (t, o) {
      var i = unit(o.intensity, 0.7);
      crowd({ t: t, d: 1.2 + 0.8 * i, v: 0.4 + 0.4 * i, pk: 0.22, hold: 0.6, fa: [520, 1150, 800], fb: [1500, 2600, 2000] });
    },
    crowdAww: function (t) {
      crowd({ t: t, d: 0.9, v: 0.6, pk: 0.15, hold: 0.3, fa: [760, 640, 300], fb: [1500, 1200, 700] });
    },
    tick: function (t) { blip('p12', 2093, t, 0.03, 0.15); hit('tria', 1047, t, 0.03, 0.15); },
    timeUp: function (t) {
      tone({ w: 'p25', f: 110, t: t, d: 0.9, v: 0.16, s: 1, r: 0.06 });
      tone({ w: 'p12', f: 116.5, t: t, d: 0.9, v: 0.13, s: 1, r: 0.06 });
    },
    countdown: function (t, o) {
      var fin = !!o.final;
      tone({ w: 'p50', f: fin ? 1319 : 659, t: t, d: fin ? 0.5 : 0.13, v: 0.2, s: 0.8, dec: 0.05, r: 0.03 });
    },
    roundWin: function (t) { playJingle('roundWin', t); duck(0.15, 2.0); },
    roundLose: function (t) { playJingle('roundLose', t); duck(0.15, 2.0); },
    champion: function (t) { playJingle('champion', t); duck(0.1, 4.0); },
    // 거리 카운터용 초단음. step(1, 2, 3...)을 주면 표지판 통과음으로 쓰여 장음계를 한 음씩 올라간다
    // (G5에서 출발, 8번째 = 한 옥타브 위).
    distTick: function (t, o) {
      var s = Math.floor(num(o.step, 0)), k;
      if (s >= 1) {
        k = Math.min(s - 1, 14);
        blip('p12', 784 * Math.pow(2, Math.floor(k / 7) + MAJOR[k % 7] / 12), t, 0.04, 0.13);
      } else {
        blip('p12', 1760, t, 0.02, 0.09);
      }
    }
  };

  function sfx(name, params) {
    var t, gap, last;
    if (!canPlay() || typeof name !== 'string' || !SFX.hasOwnProperty(name)) return;
    t = ctx.currentTime;
    gap = name === 'distTick' ? 0.04 : 0.025;   // 같은 효과음의 과도한 연타는 무시
    last = lastSfx[name];
    if (last !== undefined && t >= last && t - last < gap) return;
    lastSfx[name] = t;
    SFX[name](Math.max(t, settleAt), (params && typeof params === 'object') ? params : {});
  }

  // ---------- 음악 데이터 ----------
  // 작곡 순서: 화음 진행(주석) -> 베이스(근음·5음) -> 화음 성부(아르페지오) -> 리드(강박은 화음 구성음, 사이는 순차 진행)
  function rep(s, n) { var out = ''; while (n-- > 0) out += s; return out; }

  // 화음 기호열을 패턴 표로 풀어 한 성부를 만든다
  function fromChords(chords, table) {
    var c = chords.split(' '), out = [], i;
    for (i = 0; i < c.length; i++) out.push(table[c[i]]);
    return 'L2 ' + out.join(' ');
  }

  // 반 마디(8분음표 4개) 아르페지오. h가 붙은 것은 높은 자리바꿈.
  var ARP = {
    C: 'E4 G4 C5 G4', G: 'D4 G4 B4 G4', Gh: 'G4 B4 D5 B4', Am: 'E4 A4 C5 A4', F: 'F4 A4 C5 A4', Em: 'E4 G4 B4 G4',
    D: 'D4 F#4 A4 F#4', Dh: 'F#4 A4 D5 A4', A: 'E4 A4 C#5 A4', Ah: 'A4 C#5 E5 C#5', Bm: 'F#4 B4 D5 B4'
  };
  // 반 마디 달리는 베이스: 근음-근음-5음-근음
  var DRIVE = {
    C: 'C3 C3 G3 C3', G: 'G3 G3 D3 G3', Gh: 'G3 G3 D3 G3', Am: 'A3 A3 E3 A3', F: 'F3 F3 C3 F3', Em: 'E3 E3 B3 E3',
    D: 'D3 D3 A3 D3', Dh: 'D3 D3 A3 D3', A: 'A3 A3 E3 A3', Ah: 'A3 A3 E3 A3', Bm: 'B3 B3 F#3 B3'
  };
  // 한 마디 맥박 베이스(티 위의 긴장감): 근음 . 근음 . 근음 . 5음 .
  var PULSE = {
    Am: 'A3:3 r:1 A3:2 r:2 A3:3 r:1 E3:2 r:2', F: 'F3:3 r:1 F3:2 r:2 F3:3 r:1 C3:2 r:2',
    G: 'G3:3 r:1 G3:2 r:2 G3:3 r:1 D3:2 r:2', Dm: 'D3:3 r:1 D3:2 r:2 D3:3 r:1 A3:2 r:2',
    Em: 'E3:3 r:1 E3:2 r:2 E3:3 r:1 B3:2 r:2'
  };
  // 한 마디 느긋한 베이스: 근음(길게) 근음 5음 근음
  var WALK = {
    G: 'G3:6 G3:2 D3:4 G3:4', Em: 'E3:6 E3:2 B3:4 E3:4', C: 'C3:6 C3:2 G3:4 C3:4',
    D: 'D3:6 D3:2 A3:4 D3:4', CD: 'C3:4 G3:4 D3:4 A3:4'
  };
  // 드럼 한 마디(16분음표 16칸)
  var DA = 'k.h.s.h.k.k.s.h.', DC = 'c.h.s.h.k.k.s.h.', DF = 'k.h.s.h.k.s.s.ss';
  var PA = 'k...h...s...h.k.', PB = 'k...h.k.s...h.hh';
  var RA = 'k...h.h.s...h.h.', RB = 'k...h.h.s..kh.h.';

  var VOICE = [
    { gate: 0.88, s: 0.72, dec: 0.09, vib: 12 },   // 리드
    { gate: 0.6, s: 0.5, dec: 0.06, vib: 0 },      // 화음(아르페지오)
    { gate: 0.9, s: 1, dec: 0, vib: 0 }            // 베이스(삼각파는 음량 변화 없음)
  ];

  // 곡을 스텝 표로 컴파일한다. key: 조성("C" 장조, "Am" 단조 ...), w: 파형 3개, v: 음량 3개, dv: 드럼 음량
  function track(key, bpm, gain, w, v, dv, lead, harm, bass, drums) {
    var src = [lead, harm, bass], ch = [], steps = [], lens = [], notes = [], bad = 0, i, k, p, e;
    for (i = 0; i < 3; i++) {
      p = parse(src[i]);
      bad += p.bad;
      lens.push(p.len);
      ch.push({ w: w[i], v: v[i], gate: VOICE[i].gate, s: VOICE[i].s, dec: VOICE[i].dec, vib: VOICE[i].vib });
      for (k = 0; k < p.ev.length; k++) {
        e = p.ev[k];
        (steps[e.s] = steps[e.s] || []).push({ c: i, m: e.m, n: e.n });
        notes.push([e.s, i, e.m, e.n]);   // [스텝, 성부, MIDI 음, 길이] - 테스트의 조성·불협화 검사용
      }
    }
    lens.push(drums.length);
    return { key: key, bpm: bpm, gain: gain, dv: dv, ch: ch, steps: steps, drums: drums, len: lens[0], lens: lens, bad: bad, notes: notes };
  }

  var CH_TITLE = 'C C G G Am Am F Gh C C G G F F G G F F Gh Gh Em Em Am Am F F Gh Gh C C G G';
  var CH_RESULT = 'G G Em Em C C D D G G Em Em C D G G';
  var CH_CHAMP = 'Dh Dh A A Bm Bm Gh Gh Dh Dh A A Gh Ah Dh Dh';

  var TRACKS = {
    // 타이틀 - 씩씩한 스포츠 게임 주제곡. C 장조, 140BPM, 16마디.
    // A: | C | G | Am | F G | C | G | F | G |   B: | F | G | Em | Am | F | G | C | G |
    // 리드: "따~따 따 따 / 따- 따-" 동기를 화음 따라 옮기고(1-3마디), 5-7마디에서 뒤집어 응답, B에서 길게 노래한 뒤 정점(F6)에서 내려온다.
    title: track('C', 140, 1, ['p50', 'p25', 'tri'], [0.15, 0.08, 0.28], 1,
      'E5:3 E5:1 E5:2 G5:2 C6:4 G5:4 | D5:3 D5:1 D5:2 G5:2 B5:4 G5:4 | C5:3 C5:1 C5:2 E5:2 A5:4 G5:2 E5:2 | A5:4 F5:2 A5:2 B5:4 G5:2 B5:2 | ' +
      'C6:3 C6:1 C6:2 G5:2 E5:4 G5:4 | B5:3 B5:1 B5:2 G5:2 D5:4 G5:4 | A5:3 A5:1 A5:2 G5:2 F5:4 A5:4 | G5:4 B5:4 D6:6 r:2 | ' +
      'A5:6 G5:2 F5:4 A5:4 | B5:6 A5:2 G5:4 B5:4 | G5:4 E5:2 G5:2 B5:4 A5:2 G5:2 | A5:6 B5:2 C6:4 E6:4 | ' +
      'F6:4 E6:2 D6:2 C6:4 A5:4 | D6:4 C6:2 B5:2 G5:2 A5:2 B5:2 D6:2 | E6:3 E6:1 E6:2 D6:2 C6:8 | B5:2 D6:2 G6:4 D6:2 B5:2 G5:4',
      fromChords(CH_TITLE, ARP), fromChords(CH_TITLE, DRIVE),
      DC + rep(DA, 6) + DF + DC + rep(DA, 6) + DF),

    // 플레이 - 티 위의 낮은 긴장감. A 단조, 108BPM, 8마디. 게이지 음을 가리지 않게 성기고 작게.
    // | Am | Am | F | G | Am | Am | Dm | Em |
    // 리드: 긴 음 + 짧은 응답 음형을 2마디 단위로 묻고 답한다(5-6마디는 1-2마디의 변형).
    play: track('Am', 108, 0.75, ['p25', 'p12', 'tri'], [0.07, 0.045, 0.2], 0.6,
      'A4:6 r:2 C5:2 E5:2 D5:2 C5:2 | E5:8 r:8 | A4:6 r:2 C5:2 F5:2 E5:2 C5:2 | D5:8 r:2 G4:2 B4:2 D5:2 | ' +
      'A4:6 r:2 C5:2 E5:2 G5:2 E5:2 | A5:8 r:8 | F5:6 r:2 D5:2 F5:2 E5:2 D5:2 | E5:8 r:2 G4:2 B4:2 E5:2',
      'L2 r E4 r A4 r E4 r C5 | r E4 r A4 r E4 r C5 | r F4 r A4 r F4 r C5 | r D4 r G4 r D4 r B4 | ' +
      'r E4 r A4 r E4 r C5 | r E4 r A4 r E4 r C5 | r F4 r A4 r F4 r D5 | r E4 r G4 r E4 r B4',
      fromChords('Am Am F G Am Am Dm Em', PULSE),
      rep(PA, 3) + PB + rep(PA, 3) + PB),

    // 결과 - 느긋하고 밝은 루프. G 장조, 100BPM, 8마디.
    // | G | Em | C | D | G | Em | C D | G |
    // 리드: 1마디 음형을 2마디에서 3도 위로 반복하고, 3-4마디에서 순차 하행으로 받는다. 5-8마디는 반복 후 으뜸음으로 종지.
    result: track('G', 100, 0.9, ['p25', 'p12', 'tri'], [0.15, 0.085, 0.25], 0.7,
      'D5:4 B4:2 D5:2 G5:6 r:2 | G5:4 E5:2 G5:2 B5:6 r:2 | C6:4 B5:2 A5:2 G5:4 E5:4 | F#5:4 A5:4 D5:6 r:2 | ' +
      'D5:4 B4:2 D5:2 G5:6 r:2 | G5:4 E5:2 G5:2 B5:6 r:2 | C6:4 A5:2 G5:2 A5:4 F#5:2 A5:2 | G5:8 D5:4 B4:4',
      fromChords(CH_RESULT, ARP), fromChords('G Em C D G Em CD G', WALK),
      rep(RA, 3) + RB + rep(RA, 3) + RB),

    // 챔피언 - 우승 화면의 개선 행진. D 장조, 126BPM, 8마디.
    // | D | A | Bm | G | D | A | G A | D |
    // 리드: 팡파르 리듬(점8분+16분) 동기를 화음마다 옮기고, 5마디에서 3도 위로 올려 정점(F#6)을 만든 뒤 으뜸음으로 맺는다.
    champion: track('D', 126, 1, ['p50', 'p25', 'tri'], [0.15, 0.08, 0.28], 1,
      'D5:3 D5:1 F#5:2 A5:2 D6:6 A5:2 | C#6:3 C#6:1 E6:2 C#6:2 A5:6 E5:2 | B5:3 B5:1 D6:2 B5:2 F#5:6 B5:2 | G5:3 G5:1 B5:2 D6:2 B5:4 A5:2 G5:2 | ' +
      'F#5:3 F#5:1 A5:2 D6:2 F#6:6 D6:2 | E6:3 E6:1 C#6:2 E6:2 A5:6 C#6:2 | D6:3 D6:1 B5:2 G5:2 E6:3 E6:1 C#6:2 E6:2 | D6:10 A5:2 F#5:2 A5:2',
      fromChords(CH_CHAMP, ARP), fromChords(CH_CHAMP, DRIVE),
      DC + DA + DA + 'k.h.s.h.k.k.s.ss' + DA + DA + DA + 'k.h.s.h.k.s.ssss')
  };

  // ---------- 스케줄러 ----------
  var NONE = [];
  var tickSafe = safe(tick);

  function playStep(m, i, t) {
    var tr = m.tr, list = tr.steps[i] || NONE, k, e, c, dc;
    for (k = 0; k < list.length; k++) {
      e = list[k];
      c = tr.ch[e.c];
      tone({ w: c.w, f: hz(e.m), t: t, d: Math.max(0.03, e.n * m.sd * c.gate), v: c.v,
        s: c.s, dec: c.dec, r: 0.02, vib: e.n >= 6 ? c.vib : 0, out: m.out });
    }
    dc = tr.drums.charAt(i);
    if (dc && dc !== '.') drum(dc, t, m.out, tr.dv);
  }

  // 선행 예약: 스텝 시각은 항상 t0 + n * sd 로 계산해 오차가 쌓이지 않는다
  function tick() {
    var m = mus, now, t, guard = 0;
    if (!ctx || !m || apiSuspended) return;
    // 컨텍스트가 돌지 않으면(자동재생 차단, 전화 등) 타이머도 쉰다. running 으로 바뀌면 onstatechange 가, 다음 입력에서는 unlock() 이 다시 켠다.
    if (!running() && Date.now() >= graceUntil) { stopTimer(); return; }
    now = ctx.currentTime;
    // 타이머가 밀렸으면(백그라운드 탭 등) 몰아서 치지 않고 박자만 다시 맞춘다
    if (m.t0 + m.n * m.sd < now - 0.03) m.t0 = now + 0.05 - m.n * m.sd;
    while (guard++ < 16) {
      t = m.t0 + m.n * m.sd;
      if (t > now + LOOKAHEAD) break;
      playStep(m, m.n % m.tr.len, t);
      m.n++;
    }
  }

  function startTimer() {
    if (timer !== null || !mus || apiSuspended) return;
    timer = setInterval(tickSafe, TICK_MS);
    if (timer && typeof timer.unref === 'function') timer.unref();   // Node에서 프로세스를 붙잡지 않게
  }
  function stopTimer() {
    if (timer !== null) { clearInterval(timer); timer = null; }
  }

  function stopTrack() {
    var m = mus, t;
    stopTimer();
    if (!m) return;
    mus = null;
    t = ctx.currentTime;
    hold(m.out.gain, t);
    m.out.gain.setTargetAtTime(0, t, 0.04);   // 짧은 페이드아웃
    after(t + 0.35, m.out, function () { off(m.out); });
  }

  function startTrack(name) {
    var tr = TRACKS[name], out;
    stopTrack();
    out = ctx.createGain();
    out.gain.value = tr.gain;
    out.connect(bus.music);
    mus = { name: name, tr: tr, out: out, sd: 60 / tr.bpm / 4, t0: ctx.currentTime + 0.06, n: 0 };
    startTimer();
    tick();
  }

  // 요청된 곡이 아직 돌고 있지 않으면 시작하고, 돌고 있으면 스케줄러만 이어 붙인다
  function ensureMusic() {
    if (wantMusic && (!mus || mus.name !== wantMusic)) {
      startTrack(wantMusic);
    } else {
      startTimer();
      tick();
    }
  }

  // ---------- 공개 API ----------
  function unlock() {
    if (!ctx && !create()) return false;
    unlocked = true;
    if (apiSuspended) {
      if (typeof document !== 'undefined' && document && document.hidden) return true;   // 정말 가려져 있으면 resume()을 기다린다
      apiSuspended = false;   // 화면이 보이는데 resume()이 빠진 경우: 사용자 입력을 복귀 신호로 본다
    }
    try {
      wake();
      if (!pinged || (!running() && Date.now() - pingAt > 300)) ping();
    } catch (e) { note(e); }
    try { ensureMusic(); } catch (e2) { note(e2); }
    return true;
  }

  function setMuted(flag) {
    muted = !!flag;
    if (bus) glide(bus.master.gain, muted ? 0 : vol.master, ctx.currentTime);
  }

  function setVolumes(o) {
    var t;
    if (!o || typeof o !== 'object') return;
    if (typeof o.master === 'number' && isFinite(o.master)) vol.master = clamp(o.master, 0, 1);
    if (typeof o.sfx === 'number' && isFinite(o.sfx)) vol.sfx = clamp(o.sfx, 0, 1);
    if (typeof o.music === 'number' && isFinite(o.music)) vol.music = clamp(o.music, 0, 1);
    if (!bus) return;
    t = ctx.currentTime;
    glide(bus.master.gain, muted ? 0 : vol.master, t);
    glide(bus.sfx.gain, vol.sfx, t);
    glide(bus.musicVol.gain, vol.music, t);
  }

  function music(name, opts) {
    var restart = !!(opts && opts.restart);
    if (name === null || name === undefined || name === false || name === '') {
      wantMusic = null;
      if (ctx) stopTrack();
      return;
    }
    if (typeof name !== 'string' || !TRACKS.hasOwnProperty(name)) return;   // 모르는 곡 이름은 무시
    if (wantMusic === name && !restart && (!ctx || !unlocked || (mus && mus.name === name))) return;
    wantMusic = name;
    if (ctx && unlocked) startTrack(name);   // 잠금 해제 전이면 기억만 해 둔다
  }

  function suspend() {
    apiSuspended = true;
    stopTimer();
    if (!ctx) return;
    gaugeStop(true);
    if (typeof ctx.suspend === 'function') {
      ctxHeld = true;
      swallow(ctx.suspend());
    }
  }

  function resume() {
    apiSuspended = false;
    if (!ctx || !unlocked) return;   // 잠금 해제된 적이 없으면 소리를 내지 않는다
    wake();
    ensureMusic();
  }

  // 예외를 밖으로 내보내지 않는 래퍼(삼킨 예외는 _debug().errors 에 남긴다)
  function safe(fn, fallback) {
    return function (a, b) {
      try {
        return fn(a, b);
      } catch (e) {
        note(e);
        return fallback;
      }
    };
  }

  // 테스트·디버그용 내부 상태
  function debug() {
    var out = { live: live, errors: errors.slice(), unlocked: unlocked, timer: timer !== null,
      playing: mus ? mus.name : null, step: mus ? mus.n : -1, stepDur: mus ? mus.sd : 0, tracks: {}, jingles: {} };
    var k, i, tr, lens;
    for (k in TRACKS) {
      if (TRACKS.hasOwnProperty(k)) {
        tr = TRACKS[k];
        out.tracks[k] = { key: tr.key, bpm: tr.bpm, len: tr.len, lens: tr.lens.slice(), bad: tr.bad, notes: tr.notes, drums: tr.drums };
      }
    }
    for (k in JINGLES) {
      if (JINGLES.hasOwnProperty(k)) {
        lens = [];
        for (i = 0; i < JINGLES[k].v.length; i++) lens.push(parse(JINGLES[k].v[i].n).len);
        if (JINGLES[k].d) lens.push(JINGLES[k].d.length);
        out.jingles[k] = { unit: JINGLES[k].u, lens: lens };
      }
    }
    return out;
  }

  var api = {
    unlock: safe(unlock, false),
    isReady: safe(function () { return !!ctx && running(); }, false),
    setMuted: safe(setMuted),
    isMuted: function () { return muted; },
    setVolumes: safe(setVolumes),
    sfx: safe(sfx),
    gaugeTone: safe(gaugeTone),
    music: safe(music),
    currentMusic: function () { return wantMusic; },
    suspend: safe(suspend),
    resume: safe(resume),
    _tick: tickSafe,      // 테스트에서 스케줄러를 직접 돌리는 훅
    _debug: debug
  };

  KLD.audio = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
