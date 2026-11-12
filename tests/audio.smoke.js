'use strict';
/*
 * js/audio.js 스모크 테스트 (의존성 없음)
 *   node tests/audio.smoke.js   -> 성공 0 / 실패 1
 * 가짜 AudioContext를 globalThis.window에 설치한 뒤 모듈을 불러 전체 API를 돌려 본다.
 * 가짜는 0 이하 값의 exponentialRamp에 예외를 던지고, 과거 시각 예약을 모두 기록한다.
 * 실제 브라우저(Chromium)에서 확인한 동작도 흉내 낸다:
 *   - AudioParam.value 대입은 setValueAtTime(v, currentTime)과 같고, 과거 시각의 이벤트는 현재 시각으로 당겨진다.
 *     (st.noClamp: 당겨 주지 않는 구현을 가정한 더 엄격한 조건)
 *   - st.live = n: currentTime 이 JS 실행 도중에도 흐른다(읽을 때마다 n 프레임. 128 = 렌더 퀀텀 하나, 512 = 큰 출력 버퍼).
 *   - st.async: resume()/suspend()의 상태 변화가 st.settle() 때까지 미뤄진다(명세대로 비동기).
 *   - st.blocked: resume()이 끝나지 않는다(자동재생 차단, 출력 장치 없음).
 * 엔진의 setInterval 타이머와 Date.now 는 가로채서 테스트가 직접 돌린다. 타이머가 꺼져 있으면 실제처럼 예약도 멈춘다.
 */
var path = require('path');
var MODULE = path.join(__dirname, '..', 'js', 'audio.js');

var failures = 0, checks = 0;
function ok(cond, msg) {
  checks++;
  if (!cond) { failures++; console.log('    FAIL: ' + msg); }
}
function section(name) { console.log('- ' + name); }

// ---------- 타이머·벽시계 가로채기 ----------
var timers = {}, timerSeq = 0, wall = Date.now();
globalThis.setInterval = function (fn, ms) { timers[++timerSeq] = { fn: fn, ms: ms }; return timerSeq; };
globalThis.clearInterval = function (id) { delete timers[id]; };
Date.now = function () { return wall; };
function timerCount() { return Object.keys(timers).length; }
function fireTimers() { Object.keys(timers).forEach(function (id) { if (timers[id]) timers[id].fn(); }); }

// 모듈을 새 상태로 다시 불러온다 (win === undefined 이면 window 자체를 없앤다)
function fresh(win) {
  timers = {};
  if (win === undefined) delete globalThis.window; else globalThis.window = win;
  delete require.cache[require.resolve(MODULE)];
  delete globalThis.KLD;
  return require(MODULE);
}

// ---------- 가짜 AudioContext ----------
// legacy: webkit 접두사 시절 흉내 (PeriodicWave, cancelAndHoldAtTime, detune, resume()의 Promise, value 대입 이벤트 없음)
// ancient: 그보다 더 옛 구현 (state, resume(), suspend() 자체가 없고 컨텍스트가 항상 돈다)
function makeFake(legacy, ancient) {
  var st = {
    contexts: 0, ctx: null, past: [], leaks: [], log: [], active: [], connected: 0, master: null, comp: null,
    made: { osc: 0, buf: 0, gain: 0, filt: 0, comp: 0, wave: 0, buffer: 0 },
    params: [], pending: [], live: 0, noClamp: false, async: false, blocked: false
  };

  // --- AudioParam ---
  function Param(name, v) { this.name = name; this._v = v; this.ev = []; this.last = null; st.params.push(this); }
  // value 대입: Chrome·Safari 에서는 setValueAtTime(v, currentTime)과 같다(구형 흉내에서는 기본값만 바뀐다)
  Object.defineProperty(Param.prototype, 'value', {
    get: function () { return this._v; },
    set: function (v) {
      if (typeof v !== 'number' || !isFinite(v)) throw new Error('value setter on ' + this.name + ': bad value ' + v);
      this._v = v;
      if (!legacy) this._push({ k: 'set', v: v, t: st.ctx._t, auto: true });
    }
  });
  // 인자를 검사하고, 과거 시각이면 기록한 뒤 현재 시각으로 당겨서 돌려준다
  Param.prototype._chk = function (kind, v, t) {
    if (typeof v !== 'number' || !isFinite(v)) throw new Error(kind + ' on ' + this.name + ': bad value ' + v);
    if (typeof t !== 'number' || !isFinite(t)) throw new Error(kind + ' on ' + this.name + ': bad time ' + t);
    if (t < st.ctx._t - 1e-9) st.past.push(kind + ' on ' + this.name + ' at ' + t + ' (now ' + st.ctx._t + ')');
    return (!legacy && !st.noClamp && t < st.ctx._t) ? st.ctx._t : t;
  };
  Param.prototype._push = function (e) {   // 시각 순서를 유지하며 삽입
    var i = this.ev.length;
    while (i > 0 && this.ev[i - 1].t > e.t) i--;
    this.ev.splice(i, 0, e);
    this.last = e.v;
    return this;
  };
  Param.prototype._start = function () { return this.last === null ? this.value : this.last; };
  Param.prototype.setValueAtTime = function (v, t) {
    t = this._chk('setValueAtTime', v, t);
    return this._push({ k: 'set', v: v, t: t });
  };
  Param.prototype.linearRampToValueAtTime = function (v, t) {
    t = this._chk('linearRamp', v, t);
    return this._push({ k: 'lin', v: v, t: t });
  };
  Param.prototype.exponentialRampToValueAtTime = function (v, t) {
    t = this._chk('exponentialRamp', v, t);
    if (!(v > 0)) throw new Error('exponentialRamp target <= 0 on ' + this.name);
    if (!(this._start() > 0)) throw new Error('exponentialRamp start <= 0 on ' + this.name);
    return this._push({ k: 'exp', v: v, t: t });
  };
  Param.prototype.setTargetAtTime = function (v, t, tc) {
    t = this._chk('setTarget', v, t);
    if (!(tc > 0)) throw new Error('setTargetAtTime: bad time constant ' + tc);
    return this._push({ k: 'tgt', v: v, t: t, tc: tc });
  };
  Param.prototype.cancelScheduledValues = function (t) {
    this._chk('cancelScheduledValues', 0, t);
    this.ev = this.ev.filter(function (e) { return e.t < t; });
    return this;
  };
  if (!legacy) {
    Param.prototype.cancelAndHoldAtTime = function (t) {
      var v = this.valueAt(t);
      this._chk('cancelAndHold', 0, t);
      this.ev = this.ev.filter(function (e) { return e.t < t; });
      return this._push({ k: 'set', v: v, t: t });
    };
  }
  // 자동화 타임라인을 평가한다(피크 추정용, 이 엔진이 쓰는 조합만 정확히 다룬다)
  Param.prototype.valueAt = function (t) {
    var v = this.value, t0 = 0, i, e, nx, te, a;
    for (i = 0; i < this.ev.length; i++) {
      e = this.ev[i];
      if (e.k === 'set') {
        if (e.t > t) break;
        v = e.v; t0 = e.t;
      } else if (e.k === 'tgt') {
        if (e.t > t) break;
        nx = this.ev[i + 1];
        te = nx ? Math.min(t, nx.t) : t;
        v = e.v + (v - e.v) * Math.exp(-(te - e.t) / e.tc);
        t0 = te;
      } else {
        if (e.t <= t) { v = e.v; t0 = e.t; continue; }
        a = e.t > t0 ? (t - t0) / (e.t - t0) : 1;
        return e.k === 'lin' ? v + (e.v - v) * a : v * Math.pow(e.v / v, a);
      }
    }
    return v;
  };
  // 시간 순서로 본 타임라인 감사. 지수 램프가 0 이하에서 출발하면 실제 브라우저에서는 예외 없이 그 구간이 통째로 무음이 된다.
  // (위의 예외 검사는 호출 순서만 본다. value 대입 이벤트가 나중 시각으로 끼어드는 경우는 여기서만 잡힌다.)
  st.audit = function () {
    var out = [], i, k, p, v, e;
    for (i = 0; i < st.params.length; i++) {
      p = st.params[i]; v = p._v;
      for (k = 0; k < p.ev.length; k++) {
        e = p.ev[k];
        if (e.k === 'exp' && !(v > 0 && e.v > 0)) out.push(p.name + ' at ' + e.t.toFixed(4) + ': ' + v + ' -> ' + e.v);
        v = e.v;
      }
    }
    return out;
  };

  // --- AudioNode ---
  function Node(kind) { this.kind = kind; this.outs = []; if (st.made[kind] !== undefined) st.made[kind]++; }
  Node.prototype.connect = function (dest) {
    if (!dest || !(dest instanceof Node)) throw new Error('connect: bad destination');
    if (this.outs.length === 0) st.connected++;
    this.outs.push(dest);
    if (dest.kind === 'comp') st.master = this;
    return dest;
  };
  Node.prototype.disconnect = function () {
    if (this.outs.length > 0) st.connected--;
    this.outs = [];
  };

  // --- 소스 노드 (오실레이터 / 버퍼 소스) ---
  function Source(kind) {
    Node.call(this, kind);
    this.onended = null; this.startAt = null; this.stopAt = Infinity; this.ended = false; this.madeAt = st.ctx._t;
  }
  Source.prototype = Object.create(Node.prototype);
  Source.prototype.start = function (when, offset) {
    if (this.startAt !== null) throw new Error('start() called twice');
    if (when === undefined) when = st.ctx._t;
    if (typeof when !== 'number' || !isFinite(when)) throw new Error('start: bad time ' + when);
    if (offset !== undefined && !(offset >= 0)) throw new Error('start: bad offset ' + offset);
    if (when < st.ctx._t - 1e-9) st.past.push('start at ' + when + ' (now ' + st.ctx._t + ')');
    if (this.kind === 'buf' && !this.buffer) throw new Error('start: no buffer');
    this.startAt = when;
    if (this.kind === 'buf' && !this.loop) this.stopAt = when + this.buffer.duration;
    // 시작 직전의 경로 이득이 0이 아니면, 엔벨로프가 걸리기 전 프레임에 소리가 새어 "틱" 잡음이 난다
    // (실제 브라우저에서 GainNode 기본값 1 때문에 생기던 문제의 회귀 검사)
    if (!(this.kind === 'buf' && this.buffer.length === 1) && pathGain(this, when - 0.0005, 0) > 1e-3) {
      st.leaks.push(this.kind + ' at ' + when);
    }
    st.log.push(this);
    st.active.push(this);
  };
  Source.prototype.stop = function (when) {
    if (this.startAt === null) throw new Error('stop() before start()');
    if (when === undefined) when = st.ctx._t;
    if (typeof when !== 'number' || !isFinite(when)) throw new Error('stop: bad time ' + when);
    if (when < st.ctx._t - 1e-9) st.past.push('stop at ' + when + ' (now ' + st.ctx._t + ')');
    this.stopAt = Math.min(this.stopAt, Math.max(when, this.startAt));
  };

  // --- AudioContext ---
  function Ctx() {
    st.contexts++;
    st.ctx = this;
    this._t = 0;
    this.sampleRate = 44100;
    if (!ancient) this.state = 'suspended';
    this.onstatechange = null;
    this.destination = new Node('dest');
  }
  // 시계. live 모드에서는 값을 읽어 간 직후에 시계가 흐른다(Chrome 의 currentTime 은 JS 실행 도중에도 변한다).
  // 그래서 방금 읽은 "지금"은 다음 호출 때 이미 과거다.
  Object.defineProperty(Ctx.prototype, 'currentTime', {
    get: function () {
      var t = this._t;
      if (st.live && (ancient || this.state === 'running')) this._t += st.live / 44100;
      return t;
    }
  });
  Ctx.prototype._state = function (s) {
    if (this.state === s) return;
    this.state = s;
    if (typeof this.onstatechange === 'function') this.onstatechange();
  };
  // 상태 변화 요청. async 면 settle() 때까지 미루고, blocked 면 running 으로는 넘어가지 않는다.
  function stateOp(ctx, s) {
    function apply() { if (s === 'running' && st.blocked) return false; ctx._state(s); return true; }
    if (st.async || !apply()) st.pending.push(apply);
    return legacy ? undefined : Promise.resolve();
  }
  if (!ancient) {
    Ctx.prototype.resume = function () { return stateOp(this, 'running'); };
    Ctx.prototype.suspend = function () { return stateOp(this, 'suspended'); };
  }
  st.settle = function () {
    var ops = st.pending, keep = [], i;
    st.pending = [];
    for (i = 0; i < ops.length; i++) if (!ops[i]()) keep.push(ops[i]);
    st.pending = keep.concat(st.pending);
  };
  Ctx.prototype.createGain = function () { var g = new Node('gain'); g.gain = new Param('gain.gain', 1); return g; };
  Ctx.prototype.createOscillator = function () {
    var o = new Source('osc');
    o.type = 'sine';
    o.frequency = new Param('osc.frequency', 440);
    if (!legacy) {
      o.detune = new Param('osc.detune', 0);
      o.setPeriodicWave = function (w) { if (!w || !w.isWave) throw new Error('setPeriodicWave: bad wave'); o.type = 'custom'; };
    }
    return o;
  };
  Ctx.prototype.createBufferSource = function () {
    var s = new Source('buf');
    s.buffer = null; s.loop = false;
    s.playbackRate = new Param('buf.playbackRate', 1);
    return s;
  };
  Ctx.prototype.createBuffer = function (ch, len, rate) {
    if (!(ch >= 1) || !(len >= 1) || !(rate >= 3000)) throw new Error('createBuffer: bad arguments');
    var data = new Float32Array(len);
    st.made.buffer++;
    return { numberOfChannels: ch, length: len, sampleRate: rate, duration: len / rate, getChannelData: function () { return data; } };
  };
  Ctx.prototype.createBiquadFilter = function () {
    var f = new Node('filt');
    f.type = 'lowpass';
    f.frequency = new Param('filter.frequency', 350);
    f.Q = new Param('filter.Q', 1);
    f.gain = new Param('filter.gain', 0);
    return f;
  };
  Ctx.prototype.createDynamicsCompressor = function () {
    var c = new Node('comp');
    c.threshold = new Param('comp.threshold', -24); c.knee = new Param('comp.knee', 30);
    c.ratio = new Param('comp.ratio', 12); c.attack = new Param('comp.attack', 0.003);
    c.release = new Param('comp.release', 0.25);
    st.comp = c;
    return c;
  };
  if (!legacy) {
    Ctx.prototype.createPeriodicWave = function (re, im) {
      if (!re || !im || re.length !== im.length || re.length < 2) throw new Error('createPeriodicWave: bad arrays');
      st.made.wave++;
      return { isWave: true };
    };
  }
  // 시간을 흘려 보내고, 끝난 소스의 onended를 부른다. 멈춘 컨텍스트의 시계는 가지 않는다.
  Ctx.prototype._advance = function (dt) {
    var now, keep = [], done = [], i, s;
    if (!ancient && this.state !== 'running') return;
    this._t += dt;
    now = this._t;
    for (i = 0; i < st.active.length; i++) {
      s = st.active[i];
      if (s.stopAt <= now) done.push(s); else keep.push(s);
    }
    st.active = keep;
    for (i = 0; i < done.length; i++) {
      done[i].ended = true;
      if (typeof done[i].onended === 'function') done[i].onended();
    }
  };

  // --- 피크 추정 ---
  // 소스 진폭을 1로 보고 destination까지의 이득을 곱해 더한 값(컴프레서는 1배).
  // 필터를 지난 노이즈는 통과 대역 비율로 RMS를 구해 파고율 3.3을 곱한 통계적 추정치를 쓴다.
  // 실제 Chromium 렌더링(OfflineAudioContext)과 견주면 1.1~1.4배 크게 나오는 보수적인 상한이다.
  function filterFactor(f, t) {
    var hz = f.frequency.valueAt(t), ny = st.ctx.sampleRate / 2, frac;
    if (f.type === 'bandpass') frac = (Math.PI / 2) * (hz / f.Q.value) / ny;
    else if (f.type === 'lowpass') frac = 1.11 * hz / ny;
    else frac = 1 - 1.11 * hz / ny;
    return Math.min(1, 3.3 * 0.577 * Math.sqrt(Math.max(0, Math.min(1, frac))));
  }
  function pathGain(node, t, depth) {
    var sum = 0, i, d;
    if (depth > 12) return 0;
    for (i = 0; i < node.outs.length; i++) {
      d = node.outs[i];
      if (d.kind === 'dest') sum += 1;
      else if (d.kind === 'gain') sum += Math.abs(d.gain.valueAt(t)) * pathGain(d, t, depth + 1);
      else if (d.kind === 'filt') sum += filterFactor(d, t) * pathGain(d, t, depth + 1);
      else sum += pathGain(d, t, depth + 1);
    }
    return sum;
  }
  st.levelAt = function (t) {
    var sum = 0, i, s;
    for (i = 0; i < st.active.length; i++) {
      s = st.active[i];
      if (s.startAt <= t && t < s.stopAt) sum += pathGain(s, t, 0);
    }
    return sum;
  };
  st.peak = function (from, to, step) {
    var max = 0, t, v;
    for (t = from; t <= to; t += step) { v = st.levelAt(t); if (v > max) max = v; }
    return max;
  };
  // 소스에서 마스터까지 첫 출력을 따라간 노드 목록(끝이 마스터). 마스터에 닿지 않으면 null.
  st.chain = function (src) {
    var list = [], n = src.outs[0], hops = 0;
    while (n && hops++ < 8) { list.push(n); if (n === st.master) return list; n = n.outs[0]; }
    return null;
  };
  st.nodesMade = function () { return st.made.osc + st.made.buf + st.made.gain + st.made.filt + st.made.comp; };

  return { st: st, Ctx: Ctx };
}

// ---------- 공통 ----------
var API = ['unlock', 'isReady', 'setMuted', 'isMuted', 'setVolumes', 'sfx', 'gaugeTone', 'music', 'currentMusic', 'suspend', 'resume'];
var SFX = [
  ['uiMove'], ['uiSelect'], ['uiBack'], ['gaugeStart'],
  ['powerSet', { power: 0.5 }], ['powerSet', { power: 1 }],
  ['swing', { power: 0 }], ['swing', { power: 1 }],
  ['impact', { quality: 'perfect', power: 1 }], ['impact', { quality: 'great', power: 0.9 }],
  ['impact', { quality: 'good', power: 0.7 }], ['impact', { quality: 'miss', power: 1 }],
  ['land', { intensity: 1 }], ['bounce', { intensity: 0.4 }], ['inGrid'], ['ob'], ['newBest'], ['record'],
  ['crowdCheer', { intensity: 0 }], ['crowdCheer', { intensity: 1 }], ['crowdAww'], ['tick'], ['timeUp'],
  ['countdown', { final: false }], ['countdown', { final: true }],
  ['roundWin'], ['roundLose'], ['champion'], ['distTick']
];
// 명세에 적힌 효과음 이름 전부
var SPEC_SFX = ['uiMove', 'uiSelect', 'uiBack', 'gaugeStart', 'powerSet', 'swing', 'impact', 'land', 'bounce', 'inGrid', 'ob',
  'newBest', 'record', 'crowdCheer', 'crowdAww', 'tick', 'timeUp', 'countdown', 'roundWin', 'roundLose', 'champion', 'distTick'];
var TRACKS = ['title', 'play', 'result', 'champion'];
// 명세의 길이(초) 허용 범위
var DURATION = {
  swing: [0.17, 0.32], newBest: [0.6, 1.0], record: [1.4, 1.8], crowdCheer: [1.19, 2.05], crowdAww: [0.8, 1.0],
  roundWin: [1.8, 2.2], roundLose: [1.8, 2.2], champion: [3.8, 4.2], distTick: [0.005, 0.05], uiMove: [0.01, 0.1]
};
var GARBAGE = { power: 'x', quality: 7, intensity: NaN, final: 'no' };
// 읽기만 해도 예외가 나는 인자(문자열로도 바꿀 수 없는 값을 던진다)
var EVIL = {};
['power', 'quality', 'intensity', 'final', 'step', 'restart', 'master', 'sfx', 'music'].forEach(function (k) {
  Object.defineProperty(EVIL, k, { get: function () { throw Object.create(null); } });
});
var ODD_NAMES = ['__proto__', 'constructor', 'hasOwnProperty', 'toString', 'valueOf', '', ' ', 'UIMOVE'];

function callEverything(A) {
  var i;
  A.unlock(); A.isReady(); A.setMuted(true); A.isMuted(); A.setMuted(false);
  A.setVolumes({ master: 0.5, sfx: 0.5, music: 0.5 }); A.setVolumes({}); A.setVolumes(); A.setVolumes(null);
  A.setVolumes({ master: NaN, sfx: 'x', music: -3 });
  for (i = 0; i < SFX.length; i++) {
    A.sfx(SFX[i][0], SFX[i][1]); A.sfx(SFX[i][0]); A.sfx(SFX[i][0], null); A.sfx(SFX[i][0], GARBAGE);
  }
  A.sfx('nope'); A.sfx(); A.sfx(null, null); A.sfx({}, 3);
  A.gaugeTone(0); A.gaugeTone(0.5); A.gaugeTone(1); A.gaugeTone(7); A.gaugeTone(-2);
  A.gaugeTone(NaN); A.gaugeTone('x'); A.gaugeTone(); A.gaugeTone(null);
  for (i = 0; i < TRACKS.length; i++) { A.music(TRACKS[i]); A.music(TRACKS[i], { restart: true }); A.currentMusic(); }
  A.music('nope'); A.music(42); A.music(); A.music(null);
  A.suspend(); A.resume(); A._tick(); A._debug();
}
// 악의적인 인자로 전체 API를 두드린다. 예외가 밖으로 나오면 그 예외를 돌려준다.
function callHostile(A) {
  try {
    SPEC_SFX.forEach(function (n) { A.sfx(n, EVIL); A.sfx(n, []); A.sfx(n, function () {}); A.sfx(n, 5); });
    ODD_NAMES.forEach(function (n) { A.sfx(n); A.sfx(n, EVIL); A.music(n); A.music(n, EVIL); });
    TRACKS.forEach(function (n) { A.music(n, EVIL); A.music(n, 7); });
    A.sfx(EVIL, EVIL); A.sfx(Object.create(null)); A.music(EVIL, EVIL); A.music(Object.create(null));
    A.setVolumes(EVIL); A.setVolumes(Object.create(null)); A.setVolumes([1, 2, 3]);
    A.gaugeTone(EVIL); A.gaugeTone(Object.create(null)); A.gaugeTone(Infinity); A.gaugeTone(-Infinity);
    A.setMuted(EVIL); A.setMuted(Object.create(null)); A.setMuted(0);
    A.unlock(EVIL); A.suspend(EVIL); A.resume(EVIL); A.isReady(EVIL); A.isMuted(EVIL); A.currentMusic(EVIL);
    return null;
  } catch (e) {
    return e || new Error('threw ' + e);
  }
}

// 가짜 시간을 25ms씩 흘리며 엔진의 타이머를 울린다(타이머가 꺼져 있으면 아무 일도 일어나지 않는다)
function run(A, st, sec, each) {
  var n = Math.round(sec / 0.025), i;
  for (i = 0; i < n; i++) { st.ctx._advance(0.025); wall += 25; fireTimers(); if (each) each(i); }
}
function noProblems(A, st, where) {
  var e = A._debug().errors, bad = st.audit();
  ok(e.length === 0, where + ': 삼킨 예외 ' + JSON.stringify(e));
  ok(st.past.length === 0, where + ': 과거 시각 예약 ' + st.past.length + '건 ' + JSON.stringify(st.past.slice(0, 3)));
  ok(st.leaks.length === 0, where + ': 엔벨로프 시작 전 소리 누출 ' + st.leaks.length + '건 ' + JSON.stringify(st.leaks.slice(0, 3)));
  ok(bad.length === 0, where + ': 0 이하에서 출발하는 지수 램프 ' + bad.length + '건 ' + JSON.stringify(bad.slice(0, 2)));
}

// ---------- 1. AudioContext가 없는 환경 ----------
section('AudioContext 없음: 전체 API가 무동작이고 예외 없음');
[undefined, {}].forEach(function (win) {
  var A = fresh(win), threw = null;
  API.concat(['_tick', '_debug']).forEach(function (n) { ok(typeof A[n] === 'function', 'API 함수 ' + n + ' 가 없다'); });
  ok(globalThis.KLD && globalThis.KLD.audio === A, 'KLD.audio 로 내보내야 한다');
  try { callEverything(A); } catch (e) { threw = e; }
  ok(!threw, 'API 호출 중 예외: ' + threw);
  ok(A.unlock() === false, 'unlock()은 false여야 한다');
  ok(A.isReady() === false, 'isReady()는 false여야 한다');
  ok(A._debug().errors.length === 0, '삼킨 예외가 없어야 한다');
  ok(timerCount() === 0, '컨텍스트가 없으면 타이머도 없어야 한다');
  A.setMuted(true);
  ok(A.isMuted() === true, 'isMuted()가 설정을 기억해야 한다');
  A.music('play');
  ok(A.currentMusic() === 'play', '요청한 곡 이름을 기억해야 한다');
  A.music(null);
  ok(A.currentMusic() === null, 'music(null) 후에는 null');
  threw = callHostile(A);
  ok(!threw, '악의적인 인자에서 예외가 밖으로 나옴: ' + (threw && threw.stack));
});

// ---------- 2. 곡 데이터 ----------
section('곡 데이터: 모든 채널의 루프 길이가 같고 마디가 맞음, 조성 안의 음만 쓰고 강박에 거친 불협화 없음');
(function () {
  var d = fresh(undefined)._debug(), k, same;
  var PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function scaleOf(key) {   // "C" 장조, "Am" 자연 단조 ...
    var acc = key.charAt(1) === '#' ? 1 : (key.charAt(1) === 'b' ? -1 : 0), tonic = PC[key.charAt(0)] + acc;
    return (/m$/.test(key) ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11]).map(function (x) { return (tonic + x + 12) % 12; });
  }
  TRACKS.forEach(function (name) {
    var tr = d.tracks[name], scale, grid = [[], [], []], outKey = 0, seam = 0, overlap = 0, clash = [], s, i;
    ok(!!tr, name + ' 트랙이 있어야 한다');
    if (!tr) return;
    same = tr.lens.every(function (n) { return n === tr.lens[0]; });
    ok(tr.lens.length === 4 && same, name + ' 채널 길이가 다르다: ' + tr.lens);
    ok(tr.len > 0 && tr.len % 16 === 0, name + ' 길이가 마디 단위가 아니다: ' + tr.len);
    ok(tr.bad === 0, name + ' 악보 오류 ' + tr.bad + '건');
    ok(typeof tr.drums === 'string' && /^[kshoc.]+$/.test(tr.drums) && tr.drums.length === tr.len, name + ' 드럼 문자열이 이상하다');
    // 음 목록 [스텝, 성부(0 리드 / 1 화음 / 2 베이스), MIDI 음, 길이]
    ok(typeof tr.key === 'string' && PC[tr.key.charAt(0)] !== undefined && !!tr.notes && tr.notes.length > 50, name + ' 조성·음 목록이 있어야 한다');
    if (typeof tr.key !== 'string' || !tr.notes) return;
    scale = scaleOf(tr.key);
    tr.notes.forEach(function (n) {
      if (scale.indexOf(n[2] % 12) < 0) outKey++;
      if (n[0] + n[3] > tr.len) seam++;
      for (i = 0; i < n[3]; i++) {
        if (grid[n[1]][n[0] + i] !== undefined) overlap++;
        grid[n[1]][n[0] + i] = { m: n[2], on: i === 0 };
      }
    });
    ok(outKey === 0, name + ': 조성(' + tr.key + ') 밖의 음 ' + outKey + '개');
    ok(seam === 0, name + ': 루프 이음매를 넘어가는 음 ' + seam + '개');
    ok(overlap === 0, name + ': 한 성부 안에서 겹치는 음 ' + overlap + '개');
    // 강박(1·3박), 또는 박 머리에서 새로 울리는 음이 다른 성부와 단2도(단9도)·증4도로 부딪히면 거칠게 들린다
    for (s = 0; s < tr.len; s++) {
      [[0, 2], [0, 1], [1, 2]].forEach(function (pr) {
        var a = grid[pr[0]][s], b = grid[pr[1]][s], iv;
        if (!a || !b) return;
        iv = Math.abs(a.m - b.m) % 12;
        if ((iv === 1 || iv === 6) && (s % 8 === 0 || (s % 4 === 0 && (a.on || b.on)))) clash.push(s);
      });
    }
    ok(clash.length === 0, name + ': 강박의 거친 불협화 ' + clash.length + '건 (스텝 ' + clash.slice(0, 6).join(',') + ')');
    console.log('    ' + name + ': ' + tr.key + ', ' + tr.bpm + 'BPM, ' + (tr.len / 16) + '마디, ' + (tr.len * 15 / tr.bpm).toFixed(1) + '초, 음 ' + tr.notes.length + '개');
  });
  ok(Math.abs(d.tracks.title.bpm - 140) <= 6 && d.tracks.title.len / 16 >= 8 && d.tracks.title.len / 16 <= 16, 'title은 약 140BPM, 8-16마디');
  ok(Math.abs(d.tracks.play.bpm - 108) <= 6 && d.tracks.play.len / 16 === 8, 'play는 약 108BPM, 8마디');
  for (k in d.jingles) {
    same = d.jingles[k].lens.every(function (n) { return n === d.jingles[k].lens[0]; });
    ok(same, k + ' 징글 성부 길이가 다르다: ' + d.jingles[k].lens);
  }
})();

// ---------- 3. 최신 브라우저 흉내 ----------
(function () {
  var f = makeFake(false), st = f.st, A = fresh({ AudioContext: f.Ctx });
  var base, table = [], i, r, r2, g, gg, mark, n, d, peak, duck, chain, v, pings;

  // 효과음을 한 번 내고 { n 새 소스 수, dur 길이, peak 추정 피크 }를 돌려준다
  function fire(name, params, useParams) {
    var m = st.log.length, now = st.ctx.currentTime, end = now, made, k;
    if (useParams) A.sfx(name, params); else A.sfx(name);
    made = st.log.slice(m);
    for (k = 0; k < made.length; k++) {
      ok(made[k].stopAt !== Infinity, name + ': 정지 예약이 없는 소스');
      if (made[k].stopAt !== Infinity) end = Math.max(end, made[k].stopAt);
    }
    return { n: made.length, dur: end - now, peak: made.length ? st.peak(now, end, 0.001) : 0 };
  }

  section('잠금 해제 전: 소리도 컨텍스트도 만들지 않음');
  A.sfx('uiMove'); A.gaugeTone(0.5); A.gaugeTone(null); A.resume(); A.suspend(); A.resume();
  A.setMuted(false); A.setVolumes({ master: 0.8 }); A._tick();
  A.music('title');
  ok(st.contexts === 0, '잠금 해제 전에 AudioContext가 만들어졌다');
  ok(timerCount() === 0, '잠금 해제 전에 타이머가 돌고 있다');
  ok(A.currentMusic() === 'title', '대기 중인 곡 이름');
  ok(A.isReady() === false, '잠금 해제 전 isReady()');

  section('unlock(): 컨텍스트 생성, 무음 버퍼, 대기 중이던 곡 시작, 멱등');
  ok(A.unlock() === true, 'unlock()은 true');
  ok(st.contexts === 1 && A.isReady() === true, '컨텍스트가 하나 만들어지고 running');
  pings = st.log.filter(function (s) { return s.kind === 'buf' && s.buffer.length === 1 && s.outs[0] === st.ctx.destination; });
  ok(pings.length === 1, '1샘플 무음 버퍼 재생: ' + pings.length);
  ok(st.master && st.comp && st.comp.outs[0] === st.ctx.destination, '마스터 -> 컴프레서 -> 출력 연결');
  d = A._debug();
  ok(d.playing === 'title' && d.timer === true, '대기 중이던 title이 시작됨');
  ok(timerCount() === 1 && timers[Object.keys(timers)[0]].ms >= 15 && timers[Object.keys(timers)[0]].ms <= 40, '스케줄러 타이머는 하나, 주기 약 25ms');
  ok(st.log.length > 1, '첫 음들이 예약됨');
  A.sfx('uiMove');
  ok(Math.abs(st.log[st.log.length - 1].startAt - 0.025) < 1e-9, '컨텍스트 생성 직후의 효과음은 컴프레서 안정 시각(25ms)으로 밀려야 한다');
  for (i = 0; i < 5; i++) A.unlock();
  ok(st.contexts === 1 && A._debug().step === d.step && timerCount() === 1, 'unlock() 반복 호출은 아무것도 바꾸지 않음');
  ok(st.log.filter(function (s) { return s.kind === 'buf' && s.buffer.length === 1 && s.outs[0] === st.ctx.destination; }).length === 1, 'unlock() 반복 호출이 무음 버퍼를 다시 재생함');
  A.music(null);
  ok(A.currentMusic() === null && A._debug().timer === false && timerCount() === 0, 'music(null)은 곡과 타이머를 멈춤');
  run(A, st, 2);
  base = st.connected;   // 버스만 남은 상태
  ok(A._debug().live === 0, '곡을 멈춘 뒤 단발 노드가 남지 않음');
  noProblems(A, st, 'unlock');

  section('효과음 ' + SFX.length + '종: 인자 있음 / 없음 / 엉터리 인자');
  SPEC_SFX.forEach(function (name) {
    ok(SFX.some(function (x) { return x[0] === name; }), '명세의 효과음 ' + name + ' 이 시험 목록에 없다');
  });
  for (i = 0; i < SFX.length; i++) {
    r = fire(SFX[i][0], SFX[i][1], true);
    ok(r.n > 0, SFX[i][0] + ': 소리가 예약되지 않음');
    if (DURATION[SFX[i][0]]) {
      ok(r.dur >= DURATION[SFX[i][0]][0] && r.dur <= DURATION[SFX[i][0]][1], SFX[i][0] + ' 길이 ' + r.dur.toFixed(3) + '초가 범위 밖');
    }
    ok(r.peak > 0.02 && r.peak <= 0.9, SFX[i][0] + ' 추정 피크가 범위 밖: ' + r.peak.toFixed(2));
    table.push(SFX[i][0] + (SFX[i][1] ? JSON.stringify(SFX[i][1]).replace(/"/g, '') : '') + ' ' + r.dur.toFixed(2) + 's pk' + r.peak.toFixed(2));
    run(A, st, r.dur + 0.3);
    ok(fire(SFX[i][0], undefined, false).n > 0, SFX[i][0] + ': 인자 없이 소리가 나지 않음');
    run(A, st, 0.1);
    ok(fire(SFX[i][0], GARBAGE, true).n > 0, SFX[i][0] + ': 엉터리 인자에서 소리가 나지 않음');
    run(A, st, 0.1);
    ok(fire(SFX[i][0], null, true).n > 0, SFX[i][0] + ': null 인자에서 소리가 나지 않음');
    run(A, st, r.dur + 0.3);   // 다음 효과음의 피크 추정에 섞이지 않게 완전히 끝낸다
  }
  for (i = 0; i < table.length; i += 4) console.log('    ' + table.slice(i, i + 4).join(' | '));
  ok(fire('nope', undefined, false).n === 0 && fire(undefined, undefined, false).n === 0, '모르는 효과음은 무시');
  ODD_NAMES.forEach(function (name) { ok(fire(name, undefined, false).n === 0, '이름 ' + JSON.stringify(name) + ' 은 무시되어야 한다'); });
  run(A, st, 0.2);
  // 같은 세기라면 두 번째 이후 바운드(bounce)가 첫 착지(land)보다 여려야 한다
  [0.3, 0.6, 1].forEach(function (x) {
    r = fire('land', { intensity: x }, true); run(A, st, 0.5);
    r2 = fire('bounce', { intensity: x }, true); run(A, st, 0.5);
    ok(r2.peak < r.peak && r2.dur < r.dur, 'bounce(' + x + ')가 land(' + x + ')보다 여리고 짧아야 한다: ' + r2.peak.toFixed(3) + ' / ' + r.peak.toFixed(3));
  });
  r = fire('swing', { power: 0 }, true); run(A, st, 0.5);
  r2 = fire('swing', { power: 1 }, true); run(A, st, 0.5);
  ok(r2.peak > r.peak && r2.dur < r.dur, 'swing 은 파워가 클수록 크고 짧아야 한다');
  r = fire('crowdCheer', { intensity: 0 }, true); run(A, st, 2.5);
  r2 = fire('crowdCheer', { intensity: 1 }, true); run(A, st, 2.5);
  ok(r2.peak > r.peak && r2.dur > r.dur, 'crowdCheer 는 세기가 클수록 크고 길어야 한다');
  ok(fire('distTick', undefined, false).n > 0, 'distTick 첫 호출');
  st.ctx._advance(0.01);
  ok(fire('distTick', undefined, false).n === 0, 'distTick 40ms 이내 재호출은 무시');
  st.ctx._advance(0.05);
  ok(fire('distTick', undefined, false).n > 0, 'distTick 40ms 뒤 재호출');
  run(A, st, 0.2);
  A.sfx('distTick', { step: 8 });
  ok(Math.abs(st.log[st.log.length - 1].frequency.ev[0].v - 1568) < 2, 'distTick step 8은 한 옥타브 위(1568Hz)');
  A.sfx('powerSet', { power: 0.2 }); n = st.log[st.log.length - 1].frequency.ev[0].v; run(A, st, 0.3);
  A.sfx('powerSet', { power: 0.9 });
  ok(st.log[st.log.length - 1].frequency.ev[0].v > n * 1.5, 'powerSet 은 파워가 클수록 높아야 한다');
  run(A, st, 6);
  ok(st.connected === base && A._debug().live === 0, '효과음이 끝난 뒤 노드가 남음: ' + (st.connected - base) + ' / live ' + A._debug().live);
  ok(st.made.buffer === 2, '버퍼는 노이즈와 무음 두 개만 만들어 재사용해야 한다: ' + st.made.buffer);
  noProblems(A, st, 'sfx');

  section('gaugeTone: 오실레이터 하나로 196 -> 988Hz, 정지, 워치독');
  mark = st.log.length; n = st.nodesMade();
  for (i = 0; i <= 60; i++) { A.gaugeTone(i / 60); st.ctx._advance(1 / 60); }
  g = st.log[mark]; gg = g ? g.outs[0] : null;
  ok(g && Math.abs(g.frequency.ev[0].v - 196) < 1, '값 0은 약 196Hz');
  ok(g && Math.abs(g.frequency.ev[g.frequency.ev.length - 1].v - 988) < 1, '값 1은 약 988Hz');
  ok(g && Math.abs(g.frequency.ev[30].v - Math.sqrt(196 * 988)) < 3, '값 0.5는 기하 평균(지수 매핑)');
  ok(g && g.frequency.ev.slice(1).every(function (e) { return e.k === 'tgt'; }), '피치 갱신은 setTargetAtTime 이어야 한다');
  ok(gg && gg.gain.valueAt(st.ctx.currentTime) > 0.05 && gg.gain.valueAt(st.ctx.currentTime) < 0.2, '게이지 음량');
  for (i = 60; i >= 0; i--) { A.gaugeTone(i / 60); st.ctx._advance(1 / 60); }
  ok(st.nodesMade() - n === 2 && st.log.length - mark === 1, '스윕 내내 노드는 오실레이터와 게인 하나씩: ' + (st.nodesMade() - n));
  A.gaugeTone(null); A.gaugeTone(null);
  run(A, st, 0.3);
  ok(g && g.ended && st.connected === base, 'gaugeTone(null) 뒤 정지·해제');
  A.gaugeTone(0.5);
  g = st.log[st.log.length - 1]; gg = g.outs[0];
  st.ctx._advance(1.2);
  ok(gg.gain.valueAt(st.ctx.currentTime) < 0.001, '갱신이 끊기면 스스로 잦아듦(워치독)');
  n = st.made.osc;
  A.gaugeTone(0.6); st.ctx._advance(0.1);
  ok(st.made.osc === n && gg.gain.valueAt(st.ctx.currentTime) > 0.05, '다시 부르면 같은 오실레이터로 이어짐');
  A.gaugeTone(undefined);
  run(A, st, 0.3);
  ok(st.connected === base, 'gaugeTone(undefined)도 정지로 처리');
  noProblems(A, st, 'gaugeTone');

  TRACKS.forEach(function (name) {
    var m, sd, maxLive = 0, liveAt = {}, made, first = Infinity, offGrid = 0, late = 0, osc = 0, buf = 0, pk = 0, k, x;
    section('music("' + name + '"): 40초 재생');
    m = st.log.length;
    A.music(name);
    d = A._debug();
    sd = d.stepDur;
    ok(A.currentMusic() === name && d.playing === name && d.timer && timerCount() === 1, name + ' 재생 상태');
    ok(Math.abs(sd - 15 / d.tracks[name].bpm) < 1e-12, name + ': 스텝 길이는 16분음표(15 / BPM 초)');
    run(A, st, 40, function (j) {
      if (st.connected > maxLive) maxLive = st.connected;
      if ((j + 1) % 400 === 0) liveAt[(j + 1) / 40] = st.connected;
      pk = Math.max(pk, st.peak(st.ctx.currentTime, st.ctx.currentTime + 0.024, 0.004));
    });
    made = st.log.slice(m).filter(function (s) { return !(s.kind === 'buf' && s.buffer.length === 1); });
    for (k = 0; k < made.length; k++) {
      if (made[k].startAt < first) first = made[k].startAt;
      if (made[k].kind === 'osc') osc++; else buf++;
      if (made[k].startAt - made[k].madeAt > 0.2) late++;
    }
    for (k = 0; k < made.length; k++) {
      x = (made[k].startAt - first) / sd;
      if (Math.abs(x - Math.round(x)) > 1e-6) offGrid++;
    }
    ok(osc > 200 && buf > 60, name + ': 음 ' + osc + ' / 드럼 노이즈 ' + buf);
    ok(offGrid === 0, name + ': 박자 격자를 벗어난 음 ' + offGrid + '개(드리프트)');
    ok(late === 0, name + ': 선행 예약 범위를 넘은 음 ' + late + '개');
    ok(Math.abs(A._debug().step - 40 / sd) <= 3, name + ': 스텝 수 ' + A._debug().step + ' (기대 ' + (40 / sd).toFixed(1) + ')');
    ok(maxLive - base < 120, name + ': 동시 연결 노드 최대 ' + (maxLive - base));
    ok(liveAt[40] <= liveAt[10] + 12 && liveAt[30] <= liveAt[10] + 12, name + ': 노드가 계속 늘어남 ' + JSON.stringify(liveAt));
    console.log('    소스 ' + made.length + '개, 동시 연결 최대 ' + (maxLive - base) + ', 10/20/30/40초 시점 ' +
      [liveAt[10], liveAt[20], liveAt[30], liveAt[40]].map(function (v2) { return v2 - base; }).join('/') +
      ', 음악만의 추정 피크 ' + pk.toFixed(2));
    ok(pk > 0.02 && pk < 0.5, name + ': 음악 추정 피크 ' + pk.toFixed(2));
    noProblems(A, st, name);
  });
  ok(st.made.buffer === 2, '곡을 돌린 뒤에도 버퍼는 두 개: ' + st.made.buffer);

  section('덕킹: impact / record / roundWin / roundLose / champion 이 음악 버스를 잠깐 줄였다가 되돌림');
  A.music('play', { restart: true }); run(A, st, 3);
  chain = null;
  for (i = st.active.length - 1; i >= 0 && !chain; i--) chain = st.chain(st.active[i]);
  ok(chain && chain.length >= 5, '음악 음에서 마스터까지의 경로(엔벨로프 -> 곡 -> 덕킹 -> 음악 음량 -> 마스터)');
  duck = chain ? chain[chain.length - 3] : null;
  if (duck) {
    [['impact', { quality: 'perfect', power: 1 }, 0.3], ['record', undefined, 1.6], ['roundWin', undefined, 2.0],
      ['roundLose', undefined, 2.0], ['champion', undefined, 4.0]].forEach(function (c) {
      ok(Math.abs(duck.gain.valueAt(st.ctx.currentTime) - 1) < 0.03, c[0] + ' 전에는 음악 버스 이득이 1이어야 한다');
      A.sfx(c[0], c[1]);
      run(A, st, 0.15);
      v = duck.gain.valueAt(st.ctx.currentTime);
      ok(v < 0.8 && v >= 0, c[0] + ': 음악이 줄지 않음 (' + v.toFixed(2) + ')');
      run(A, st, c[2] + 1.2);
      v = duck.gain.valueAt(st.ctx.currentTime);
      ok(v > 0.97 && v <= 1.0001, c[0] + ': 덕킹이 풀리지 않음 (' + v.toFixed(2) + ')');
    });
    ['uiMove', 'inGrid', 'newBest', 'crowdCheer', 'tick', 'land'].forEach(function (name) {
      A.sfx(name); run(A, st, 0.15);
      ok(duck.gain.valueAt(st.ctx.currentTime) > 0.97, name + ' 은 음악을 줄이지 않아야 한다');
      run(A, st, 2.2);
    });
    // 겹친 덕킹: 깊은 쪽과 늦게 끝나는 쪽을 따른다
    A.sfx('champion'); run(A, st, 0.5); A.sfx('impact', { quality: 'good' }); run(A, st, 1);
    ok(duck.gain.valueAt(st.ctx.currentTime) < 0.3, '짧은 덕킹이 진행 중인 긴 덕킹을 풀어 버림');
    run(A, st, 5);
    ok(duck.gain.valueAt(st.ctx.currentTime) > 0.97, '겹친 덕킹 뒤 복귀');
  }
  noProblems(A, st, '덕킹');

  section('곡 전환 / 재시작 / 음소거 / 음량 / 일시정지 / 타이머 지연');
  A.music('title'); run(A, st, 1);
  n = A._debug().step;
  A.music('title');
  ok(A._debug().step === n, '같은 곡을 다시 요청하면 무동작');
  A.music('title', { restart: true });
  ok(A._debug().step < n && A._debug().playing === 'title', 'restart 옵션은 처음부터 다시');
  A.music('nope');
  ok(A.currentMusic() === 'title', '모르는 곡 이름은 무시');
  run(A, st, 0.5);
  chain = null;
  for (i = st.active.length - 1; i >= 0 && !chain; i--) chain = st.chain(st.active[i]);
  g = chain && chain.length >= 5 ? chain[chain.length - 4] : null;   // 재생 중인 곡의 출력 게인
  ok(g && g.gain.valueAt(st.ctx.currentTime) > 0.5, '곡 출력 게인을 찾음');
  A.music('play');
  if (g) {
    ok(g.gain.valueAt(st.ctx.currentTime + 0.005) > 0.5, '이전 곡은 뚝 끊기지 않고 짧게 페이드되어야 한다');
    ok(g.gain.valueAt(st.ctx.currentTime + 0.25) < 0.02, '이전 곡의 페이드가 0.25초 안에 끝나야 한다');
  }
  run(A, st, 1);
  ok(g && g.outs.length === 0, '이전 곡의 출력 게인이 해제됨');
  ok(A._debug().playing === 'play' && A.currentMusic() === 'play' && timerCount() === 1, '곡 전환');
  A.setMuted(1);
  ok(A.isMuted() === true, 'isMuted()는 불리언이어야 한다');
  A.setMuted(0);
  ok(A.isMuted() === false, 'isMuted()는 불리언이어야 한다');
  A.setMuted(true); run(A, st, 0.3);
  ok(A.isMuted() === true && st.master.gain.valueAt(st.ctx.currentTime) < 0.001, '음소거는 마스터 게인 0');
  mark = st.log.length; run(A, st, 1);
  ok(st.log.length > mark && timerCount() === 1, '음소거 중에도 타이머와 예약은 계속됨');
  A.setMuted(false); run(A, st, 0.3);
  ok(Math.abs(st.master.gain.valueAt(st.ctx.currentTime) - 0.8) < 0.01, '음소거 해제 시 마스터 0.8');
  A.setVolumes({ master: 2, sfx: 'x', music: NaN }); run(A, st, 0.3);
  ok(Math.abs(st.master.gain.valueAt(st.ctx.currentTime) - 1) < 0.01, '음량은 0..1로 제한');
  A.setVolumes({ master: -1 }); run(A, st, 0.3);
  ok(st.master.gain.valueAt(st.ctx.currentTime) < 0.01, '음수 음량은 0');
  A.setVolumes({ master: 0.8 }); A.setVolumes(null); A.setVolumes(); run(A, st, 0.3);
  if (duck) {
    A.setVolumes({ music: 0.2 }); run(A, st, 0.3);
    ok(Math.abs(duck.outs[0].gain.valueAt(st.ctx.currentTime) - 0.2) < 0.01, '음악 음량은 음악 버스에만 걸린다');
    A.setVolumes({ sfx: 0.5 }); run(A, st, 0.3);
    A.sfx('timeUp'); chain = st.chain(st.log[st.log.length - 1]);
    ok(chain && chain.length === 3 && Math.abs(chain[1].gain.valueAt(st.ctx.currentTime) - 0.5) < 0.01, '효과음 음량은 효과음 버스에 걸린다');
    A.setVolumes({ sfx: 0.9, music: 0.45 }); run(A, st, 1.5);
  }
  A.gaugeTone(0.4);
  A.suspend();
  mark = st.log.length;
  fireTimers(); A._tick(); A.sfx('uiMove'); A.gaugeTone(0.5);
  ok(st.ctx.state === 'suspended' && A._debug().timer === false && timerCount() === 0 && st.log.length === mark, 'suspend() 중에는 타이머도 예약도 없음');
  globalThis.document = { hidden: true };
  ok(A.unlock() === true && st.ctx.state === 'suspended', '화면이 가려진 동안의 unlock()은 깨우지 않음');
  A.resume();
  ok(st.ctx.state === 'running' && A._debug().timer === true && timerCount() === 1, 'resume()으로 복귀');
  A.suspend();
  A.music('result');
  globalThis.document = { hidden: false };
  mark = st.log.length;
  ok(A.unlock() === true && st.ctx.state === 'running' && A._debug().timer === true, '화면이 보이면 unlock()이 누락된 resume()을 대신함');
  delete globalThis.document;
  run(A, st, 0.5);
  ok(A._debug().playing === 'result' && st.log.length > mark, 'suspend() 중에 요청한 곡이 복귀 후 재생됨');
  A.suspend(); A.music('play'); mark = st.log.length; A.resume(); run(A, st, 0.5);
  ok(A._debug().playing === 'play' && st.log.length > mark, 'suspend() 중에 바꾼 곡이 resume() 후 재생됨');
  run(A, st, 1);
  st.ctx._advance(5);   // 타이머가 5초 동안 멈춘 상황
  mark = st.log.length; n = A._debug().step;
  A._tick();            // 테스트용 훅: 타이머 없이 스케줄러를 한 번 돌린다
  ok(A._debug().step > n, '_tick() 훅이 스케줄러를 돌려야 한다');
  ok(A._debug().step - n <= 3 && st.log.length - mark <= 16,
    '타이머 지연 뒤 밀린 스텝을 몰아서 예약함: 스텝 ' + (A._debug().step - n) + ', 소스 ' + (st.log.length - mark));
  run(A, st, 1);
  // 타이머가 살짝(20ms 안팎) 늦는 상황: 지나간 스텝은 과거가 아니라 현재 시각으로 당겨져야 한다
  for (i = 0; i < 20; i++) { run(A, st, 0.2 + i * 0.013); st.ctx._advance(0.145); A._tick(); }
  A.music(null);
  run(A, st, 2);
  mark = st.log.length; run(A, st, 1);
  ok(st.log.length === mark && timerCount() === 0, '정지 후에는 예약 없음');
  ok(st.connected === base && A._debug().live === 0, '전부 멈춘 뒤 남은 노드: ' + (st.connected - base));
  ok(st.made.buffer === 2, '끝까지 버퍼는 두 개: ' + st.made.buffer);
  noProblems(A, st, '전환');

  section('피크 추정: 음악 + 임팩트 + 관중 환호가 겹칠 때 (컴프레서 앞, 1.0 = 풀스케일)');
  A.music('title'); run(A, st, 3);
  A.sfx('impact', { quality: 'perfect', power: 1 });
  A.sfx('crowdCheer', { intensity: 1 });
  peak = st.peak(st.ctx.currentTime, st.ctx.currentTime + 0.025, 0.001);
  run(A, st, 2.5, function () {
    var x = st.peak(st.ctx.currentTime, st.ctx.currentTime + 0.025, 0.001);
    if (x > peak) peak = x;
  });
  console.log('    title + impact(perfect) + crowdCheer(1): 추정 피크 ' + peak.toFixed(2));
  ok(peak < 1.25, '겹침 피크가 너무 큼: ' + peak.toFixed(2));
  A.music(null); run(A, st, 3);
  noProblems(A, st, '피크');

  section('악의적인 인자: 예외가 밖으로 나오지 않고 엔진이 계속 동작');
  r = callHostile(A);
  ok(!r, '예외가 밖으로 나옴: ' + (r && (r.stack || String(r))));
  A.music(null); A.gaugeTone(null); A.setMuted(false); A.resume(); A.unlock();
  run(A, st, 6);
  mark = st.log.length; A.sfx('uiSelect'); A.music('result'); run(A, st, 1);
  ok(st.log.length > mark + 2 && A._debug().playing === 'result', '악의적인 호출 뒤에도 정상 동작');
  A.music(null); run(A, st, 2);
  ok(A._debug().live === 0 && st.connected === base, '악의적인 호출 뒤 남은 노드: ' + (st.connected - base));
  ok(st.past.length === 0 && st.audit().length === 0, '악의적인 호출이 타임라인을 망가뜨림');
})();

// ---------- 4. 구형(webkit 접두사) 브라우저 흉내 ----------
section('구형 구현(webkitAudioContext, PeriodicWave·cancelAndHold·detune 없음)');
(function () {
  var f = makeFake(true), st = f.st, A = fresh({ webkitAudioContext: f.Ctx }), i, base;
  A.music('champion');
  ok(A.unlock() === true && A.isReady(), '구형에서도 unlock()');
  A.music(null); run(A, st, 1);
  base = st.connected;
  for (i = 0; i < SFX.length; i++) { A.sfx(SFX[i][0], SFX[i][1]); run(A, st, 0.1); }
  for (i = 0; i <= 30; i++) { A.gaugeTone(i / 30); st.ctx._advance(1 / 60); }
  A.gaugeTone(null);
  TRACKS.forEach(function (name) { A.music(name); run(A, st, 6); });
  A.setMuted(true); A.setMuted(false); A.setVolumes({ music: 0.3 }); A.suspend(); A.resume();
  ok(st.made.wave === 0 && st.log.some(function (s) { return s.kind === 'osc' && s.type === 'square'; }), '펄스파가 square로 대체됨');
  A.music(null); run(A, st, 6);
  ok(st.connected === base && A._debug().live === 0, '구형에서도 노드가 남지 않음: ' + (st.connected - base));
  noProblems(A, st, '구형');
})();

section('더 옛 구현(state·resume()·suspend() 없음): 항상 도는 컨텍스트로 취급');
(function () {
  var f = makeFake(true, true), st = f.st, A = fresh({ webkitAudioContext: f.Ctx }), n, mark;
  A.music('title');
  ok(A.unlock() === true && A.isReady() === true, 'state 가 없으면 준비된 것으로 본다');
  run(A, st, 1);
  ok(A._debug().playing === 'title' && A._debug().step > 5 && timerCount() === 1, '곡이 진행됨');
  A.suspend();
  mark = st.log.length; n = A._debug().step;
  run(A, st, 2);         // 컨텍스트를 멈출 방법이 없어 시계는 계속 간다
  A.sfx('uiMove'); A.gaugeTone(0.5);
  ok(st.log.length === mark && timerCount() === 0 && A._debug().step === n, 'suspend() 중에는 타이머도 예약도 없음');
  A.resume();
  ok(timerCount() === 1, 'resume()이 스케줄러를 다시 켜야 한다');
  ok(A._debug().step - n >= 1 && A._debug().step - n <= 3, 'resume() 뒤 밀린 스텝을 몰아서 치지 않고 이어감: ' + (A._debug().step - n));
  run(A, st, 1);
  ok(st.log.length > mark + 5, 'resume() 뒤 곡이 이어짐');
  A.sfx('record'); A.gaugeTone(0.3); A.gaugeTone(null); A.setMuted(true); A.setMuted(false);
  A.music(null); run(A, st, 6);
  ok(A._debug().live === 0 && timerCount() === 0, '더 옛 구현에서도 노드가 남지 않음: ' + A._debug().live);
  noProblems(A, st, '더 옛 구현');
})();

// ---------- 5. JS 실행 도중에도 시계가 흐르는 브라우저(Chrome) ----------
section('흐르는 시계: currentTime 이 호출 도중에 변해도 엔벨로프가 죽지 않음');
[[128, false], [512, false], [128, true], [512, true]].forEach(function (cfg) {
  var f = makeFake(false), st = f.st, A = fresh({ AudioContext: f.Ctx }), i, base, bad;
  var tag = '흐르는 시계(' + cfg[0] + '프레임' + (cfg[1] ? ', 과거 시각을 당기지 않는 구현' : '') + ')';
  st.noClamp = cfg[1];
  A.unlock(); run(A, st, 0.5);
  base = st.connected;
  st.live = cfg[0];
  for (i = 0; i < SFX.length; i++) { A.sfx(SFX[i][0], SFX[i][1]); run(A, st, 0.3); }
  for (i = 0; i <= 30; i++) { A.gaugeTone(i / 30); st.ctx._advance(1 / 60); }
  A.gaugeTone(null);
  TRACKS.forEach(function (name) { A.music(name); run(A, st, 5); A.sfx('impact', { quality: 'perfect', power: 1 }); A.sfx('record'); });
  A.setMuted(true); A.setMuted(false); A.setVolumes({ master: 0.7, sfx: 0.8, music: 0.5 });
  A.music(null);
  st.live = 0;
  run(A, st, 8);
  bad = st.audit();
  ok(A._debug().errors.length === 0, tag + ': 삼킨 예외 ' + JSON.stringify(A._debug().errors));
  ok(bad.length === 0, tag + ': 0 이하에서 출발해 통째로 무음이 되는 지수 램프 ' + bad.length + '건 ' + JSON.stringify(bad.slice(0, 2)));
  ok(st.log.length > 400 && st.log.every(function (s) { return s.stopAt !== Infinity; }), tag + ': 정지 예약이 없는 소스');
  ok(st.connected === base && A._debug().live === 0, tag + ': 남은 노드 ' + (st.connected - base));
});

// ---------- 6. 상태 변화가 비동기인 브라우저 ----------
section('비동기 상태 변화: 첫 탭, suspend() 직후의 resume(), OS 인터럽트');
(function () {
  var f = makeFake(false), st = f.st, A, m, n;
  st.async = true;
  A = fresh({ AudioContext: f.Ctx });
  A.music('play');
  ok(A.unlock() === true && A.isReady() === false, 'resume()이 끝나기 전에는 isReady()가 false');
  m = st.log.length; A.sfx('uiSelect');
  ok(st.log.length > m, '첫 탭의 효과음은 resume() 대기 중에도 예약됨');
  st.settle();
  ok(A.isReady() === true && timerCount() === 1, 'resume()이 끝나면 준비 완료');
  run(A, st, 1);
  ok(A._debug().playing === 'play' && A._debug().step > 3, '대기 중이던 곡이 진행됨: 스텝 ' + A._debug().step);
  // suspend() 직후에는 state 가 아직 "running" 이다. 이때의 resume()도 컨텍스트를 깨워야 한다.
  A.suspend();
  ok(st.ctx.state === 'running' && timerCount() === 0 && A._debug().timer === false, 'suspend() 직후(상태가 바뀌기 전)에도 타이머는 멈춰야 한다');
  A.resume();
  st.settle();
  ok(st.ctx.state === 'running' && timerCount() === 1, 'suspend() 직후의 resume()이 컨텍스트를 깨우지 못함: ' + st.ctx.state);
  n = A._debug().step; run(A, st, 1);
  ok(A._debug().step > n, 'suspend()/resume() 연속 호출 뒤 곡이 이어짐');
  m = st.log.length; A.sfx('uiMove');
  ok(st.log.length > m, 'suspend()/resume() 연속 호출 뒤 효과음이 남');
  A.suspend(); A.unlock(); st.settle();
  ok(st.ctx.state === 'running', 'suspend() 직후의 unlock()(화면 보임)이 컨텍스트를 깨우지 못함');
  A.suspend(); st.settle();
  ok(st.ctx.state === 'suspended' && timerCount() === 0, '정상적인 suspend()');
  n = st.ctx.currentTime; run(A, st, 1);
  ok(st.ctx.currentTime === n, '멈춘 컨텍스트의 시계는 가지 않음');
  A.resume(); st.settle();
  ok(st.ctx.state === 'running' && timerCount() === 1, '정상적인 resume()');
  run(A, st, 1);
  // 전화·알람 같은 OS 인터럽트
  st.ctx._state('interrupted');
  ok(timerCount() === 0 && A.isReady() === false, '인터럽트되면 타이머가 멈추고 준비 상태가 아님');
  wall += 1000;
  m = st.log.length; A.sfx('uiMove'); A.gaugeTone(0.5);
  ok(st.log.length === m, '멈춘 컨텍스트에는 예약하지 않음');
  A.unlock(); st.settle();
  ok(st.ctx.state === 'running' && timerCount() === 1, 'unlock()이 인터럽트된 컨텍스트를 되살림');
  n = A._debug().step; fireTimers();
  ok(A._debug().step - n <= 3, '인터럽트 뒤 밀린 스텝을 몰아서 예약함: ' + (A._debug().step - n));
  run(A, st, 2);
  A.music(null); A.gaugeTone(null); run(A, st, 3);
  ok(A._debug().live === 0 && timerCount() === 0, '비동기: 남은 노드 ' + A._debug().live);
  noProblems(A, st, '비동기');
})();

section('자동재생 차단: 컨텍스트가 돌지 않으면 타이머가 쉬고, 계속 두드려도 노드가 쌓이지 않음');
(function () {
  var f = makeFake(false), st = f.st, A, i, m, n;
  st.async = true; st.blocked = true;
  A = fresh({ AudioContext: f.Ctx });
  A.music('title');
  ok(A.unlock() === true && A.isReady() === false, '차단되어도 unlock()은 true(컨텍스트 있음), isReady()는 false');
  st.settle();
  ok(st.ctx.state === 'suspended' && timerCount() === 1, '유예 시간 동안은 타이머가 돈다');
  for (i = 0; i < 40; i++) { wall += 25; fireTimers(); }
  ok(timerCount() === 0 && A._debug().timer === false, '컨텍스트가 돌지 않으면 스케줄러 타이머도 쉰다');
  m = st.log.length; A.sfx('uiMove'); A.gaugeTone(0.3);
  ok(st.log.length === m, '유예 시간이 지나면 예약하지 않음');
  n = st.nodesMade();
  for (i = 0; i < 300; i++) {
    A.unlock(); A.setMuted(false); A.sfx('uiMove'); A.sfx('impact', { quality: 'perfect' }); A.gaugeTone((i % 10) / 10);
    wall += 120; fireTimers(); st.settle();
  }
  ok(st.nodesMade() - n < 60, '차단된 동안 300번 두드려 만든 노드: ' + (st.nodesMade() - n));
  for (i = 0; i < 40; i++) { wall += 25; fireTimers(); }
  ok(timerCount() === 0, '두드림이 멈추면 타이머도 다시 쉰다');
  st.blocked = false;
  A.unlock(); st.settle();
  ok(A.isReady() === true && timerCount() === 1, '허용되면 준비 완료');
  m = st.log.length; run(A, st, 2);
  ok(A._debug().playing === 'title' && st.log.length > m, '허용된 뒤 곡이 진행됨');
  A.music(null); A.gaugeTone(null); run(A, st, 6);
  ok(A._debug().live === 0 && timerCount() === 0, '차단: 남은 노드 ' + A._debug().live);
  noProblems(A, st, '차단');
})();

// ---------- 7. 생성 실패 ----------
section('생성 실패: 컨텍스트나 노드를 만들지 못해도 예외가 밖으로 나오지 않고, 나중에 회복');
(function () {
  var f = makeFake(false), st = f.st, boom = 'ctor', A, threw = null, r, mark;
  function Ctor() { if (boom === 'ctor') throw new Error('boom ctor'); f.Ctx.call(this); }
  Ctor.prototype = f.Ctx.prototype;
  ['createGain', 'createOscillator', 'createBufferSource', 'createBiquadFilter'].forEach(function (m) {
    var orig = f.Ctx.prototype[m];
    f.Ctx.prototype[m] = function () { if (boom === m) throw new Error('boom ' + m); return orig.apply(this, arguments); };
  });
  A = fresh({ AudioContext: Ctor });
  try { r = A.unlock(); A.sfx('uiMove'); A.music('title'); A.gaugeTone(0.5); A.suspend(); A.resume(); } catch (e) { threw = e; }
  ok(!threw && r === false && st.contexts === 0 && A.isReady() === false, '생성자가 실패하면 unlock()은 false, 예외 없음: ' + threw);
  boom = null;
  ok(A.unlock() === true && st.contexts === 1, '생성자 실패 뒤에는 다음 입력에서 다시 시도');
  run(A, st, 1);
  ok(A._debug().playing === 'title', '다시 시도한 뒤 대기 중이던 곡이 재생됨');
  ['createGain', 'createOscillator', 'createBufferSource', 'createBiquadFilter'].forEach(function (m) {
    var i;
    threw = null;
    boom = m;
    try {
      for (i = 0; i < SFX.length; i++) A.sfx(SFX[i][0], SFX[i][1]);
      A.gaugeTone(0.5); A.gaugeTone(null); A.music('play'); A.music('title', { restart: true }); A.music(null);
      A.setMuted(true); A.setMuted(false); A.setVolumes({ master: 0.8 }); A.suspend(); A.resume(); A.unlock(); A._tick();
    } catch (e) { threw = e; }
    boom = null;
    ok(!threw, m + ' 실패가 예외로 새어 나옴: ' + threw);
    A.resume(); A.unlock(); A.gaugeTone(null);
    run(A, st, 6);
    mark = st.log.length;
    A.music('result', { restart: true }); A.sfx('uiSelect'); run(A, st, 1);
    ok(A._debug().playing === 'result' && st.log.length > mark + 3 && timerCount() === 1, m + ' 실패 뒤 정상 동작으로 돌아오지 못함');
  });
  A.music(null); run(A, st, 6);
  ok(timerCount() === 0 && st.contexts === 1 && st.past.length === 0 && st.audit().length === 0, '생성 실패 뒤 타이머·타임라인 상태');
  ok(A._debug().live === 0, '생성 실패 뒤 남은 단발 노드: ' + A._debug().live);
})();

// ---------- 8. 무작위 호출 순서 ----------
section('무작위 호출 순서(비동기 상태, 인터럽트, 가려진 화면 포함): 예외·과거 예약·누수 없음');
(function () {
  var seed, total = 0;
  function rnd(s) { s.x ^= s.x << 13; s.x ^= s.x >>> 17; s.x ^= s.x << 5; return (s.x >>> 0) / 4294967296; }
  for (seed = 1; seed <= 24; seed++) {
    var s = { x: (seed * 2654435761) | 1 }, legacy = seed % 4 === 0, f = makeFake(legacy), st = f.st, A, i, r, item, threw = null;
    st.async = seed % 2 === 1;
    A = fresh(legacy ? { webkitAudioContext: f.Ctx } : { AudioContext: f.Ctx });
    try {
      for (i = 0; i < 500; i++) {
        r = rnd(s);
        if (r < 0.10) A.unlock();
        else if (r < 0.34) { item = SFX[Math.floor(rnd(s) * SFX.length)]; A.sfx(item[0], rnd(s) < 0.7 ? item[1] : undefined); }
        else if (r < 0.50) A.gaugeTone(rnd(s) < 0.15 ? null : rnd(s));
        else if (r < 0.58) A.music(rnd(s) < 0.2 ? null : TRACKS[Math.floor(rnd(s) * 4)], rnd(s) < 0.2 ? { restart: true } : undefined);
        else if (r < 0.61) A.suspend();
        else if (r < 0.65) A.resume();
        else if (r < 0.68) A.setMuted(rnd(s) < 0.5);
        else if (r < 0.71) A.setVolumes({ master: rnd(s), sfx: rnd(s), music: rnd(s) });
        else if (r < 0.74) st.settle();
        else if (r < 0.755 && st.ctx) st.ctx._state(rnd(s) < 0.5 ? 'interrupted' : 'running');
        else if (r < 0.77) globalThis.document = { hidden: rnd(s) < 0.5 };
        else if (st.ctx) { st.settle(); run(A, st, 0.025 * (1 + Math.floor(rnd(s) * 8))); }
        A.isReady(); A.currentMusic(); A.isMuted();
        total++;
      }
      // 마무리: 전부 멈추면 깨끗이 정리되어야 한다
      delete globalThis.document;
      A.resume(); A.unlock(); st.settle(); st.settle();
      if (st.ctx) st.ctx._state('running');
      A.music(null); A.gaugeTone(null);
      if (st.ctx) run(A, st, 8);
    } catch (e) { threw = e; }
    delete globalThis.document;
    ok(!threw, '시드 ' + seed + ': 예외 ' + (threw && threw.stack));
    if (!st.ctx) continue;
    ok(A._debug().errors.length === 0, '시드 ' + seed + ': 삼킨 예외 ' + JSON.stringify(A._debug().errors.slice(0, 3)));
    ok(st.past.length === 0, '시드 ' + seed + ': 과거 시각 예약 ' + st.past.length + '건 ' + JSON.stringify(st.past.slice(0, 2)));
    ok(st.leaks.length === 0 && st.audit().length === 0, '시드 ' + seed + ': 엔벨로프 문제');
    ok(A._debug().live === 0 && timerCount() === 0, '시드 ' + seed + ': 남은 단발 노드 ' + A._debug().live + ', 타이머 ' + timerCount());
    ok(st.connected <= 5 && st.contexts === 1 && st.made.buffer === 2, '시드 ' + seed + ': 남은 연결 ' + st.connected + ', 컨텍스트 ' + st.contexts + ', 버퍼 ' + st.made.buffer);
  }
  console.log('    24개 시드, API 호출 ' + total + '회');
})();

console.log(failures ? ('\nFAILED: ' + failures + ' / ' + checks + ' checks') : ('\nOK: ' + checks + ' checks passed'));
process.exit(failures ? 1 : 0);
