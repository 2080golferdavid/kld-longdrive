/*
 * KLD LONG DRIVE - js/physics.js 테스트 (의존성 없는 Node 스크립트)
 *
 *   node tests/physics.test.js            보정표 + 불변식 검사 (성공 0, 실패 1 로 종료)
 *   node tests/physics.test.js --table    220 mph 응답표(발사각 x 스핀 x 바람, 사이드스핀·옆바람 편차)도 함께 출력
 *
 * '독립 검증' 절은 physics.js 내부를 쓰지 않고 다시 계산한 값과 비교한다:
 *   - 명세(스핀 벡터 · 항력 · 마그누스)만으로 짠 참조 적분기, 진공 해석해, 방위각 회전 불변
 *   - 샘플에서 역산한 Cd / Cl 을 공개된 현대 골프공 풍동 자료와 비교 (터무니없는 계수로 표만 맞추는 것을 막는다)
 */
'use strict';

var path = require('path');
var P = require(path.join(__dirname, '..', 'js', 'physics.js'));

var C = P.CONST;
var failures = 0;
var checks = 0;

function check(name, ok, detail) {
  checks++;
  if (ok) {
    console.log('  PASS  ' + name + (detail ? '  (' + detail + ')' : ''));
  } else {
    failures++;
    console.log('  FAIL  ' + name + (detail ? '  (' + detail + ')' : ''));
  }
}

function section(title) {
  console.log('\n[' + title + ']');
}

function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }
function lpad(s, n) { s = String(s); while (s.length < n) s = ' ' + s; return s; }
function f1(v) { return v.toFixed(1); }

var yd = P.mToYd;
var mph = P.mphToMs;

function shot(speedMph, launchAngle, backspin, azimuth, sidespin) {
  return {
    ballSpeed: mph(speedMph),
    launchAngle: launchAngle,
    azimuth: azimuth || 0,
    backspin: backspin,
    sidespin: sidespin || 0
  };
}

// 결정적 난수 (LCG)
function makeLcg(seed) {
  var s = seed >>> 0;
  return function () {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// 결과 한 건의 형식·일관성 검사. 문제가 있으면 설명 문자열, 없으면 '' 를 돌려준다
function validate(r, opt) {
  opt = opt || {};
  var i;
  var numeric = ['sampleDt', 'count', 'duration', 'carry', 'carryZ', 'flightTime', 'apex', 'apexX',
    'landingAngle', 'landingSpeed', 'total', 'finalZ', 'roll'];
  for (i = 0; i < numeric.length; i++) {
    if (typeof r[numeric[i]] !== 'number' || !isFinite(r[numeric[i]])) return numeric[i] + ' is not finite';
  }
  if (typeof r.inGrid !== 'boolean') return 'inGrid is not boolean';
  if (!(r.samples instanceof Float32Array)) return 'samples is not Float32Array';
  if (r.sampleDt !== C.SAMPLE_DT) return 'sampleDt mismatch';
  if (r.count < 2 || r.samples.length !== r.count * 3) return 'count / samples length mismatch';
  for (i = 0; i < r.samples.length; i++) {
    if (!isFinite(r.samples[i])) return 'sample ' + i + ' is not finite';
  }
  for (i = 0; i < r.count; i++) {
    if (r.samples[i * 3 + 1] < -1e-6) return 'sample below ground at ' + i;
  }
  if (r.samples[0] !== 0 || Math.abs(r.samples[1] - 0.03) > 1e-6 || r.samples[2] !== 0) return 'first sample is not the tee';
  if (Math.abs(r.duration - (r.count - 1) * r.sampleDt) > 1e-9) return 'duration != (count-1)*sampleDt';
  if (r.duration > 40 + 1e-9) return 'duration over 40 s';
  if (r.flightTime < 0 || r.flightTime > r.duration + 1e-9) return 'flightTime out of range';
  if (r.landingAngle < 0 || r.landingAngle > 90 + 1e-9) return 'landingAngle out of range';
  if (r.roll !== r.total - r.carry) return 'roll != total - carry';

  // 이벤트
  var ev = r.events;
  if (!Array.isArray(ev) || ev.length === 0) return 'no events';
  var lands = 0, rolls = 0, rests = 0, prevT = -1;
  for (i = 0; i < ev.length; i++) {
    var e = ev[i];
    if (['land', 'bounce', 'roll', 'rest'].indexOf(e.type) < 0) return 'unknown event type ' + e.type;
    if (!isFinite(e.t) || !isFinite(e.x) || !isFinite(e.z) || !isFinite(e.speed)) return 'event not finite';
    if (e.speed < 0 || e.t < 0 || e.t > r.duration + 1e-9) return 'event speed / time out of range';
    if (e.t < prevT) return 'events out of order';
    prevT = e.t;
    if (e.type === 'land') lands++;
    if (e.type === 'roll') rolls++;
    if (e.type === 'rest') rests++;
    if (e.type === 'bounce' && lands === 0) return 'bounce before land';
  }
  var lastEv = ev[ev.length - 1];
  if (lastEv.type !== 'rest' || rests !== 1) return 'last event is not a single rest';
  if (lastEv.t !== r.duration || lastEv.x !== r.total || lastEv.z !== r.finalZ) return 'rest event mismatch';
  if (rolls > 1) return 'more than one roll event';
  if (ev.length > 70) return 'too many events (' + ev.length + ')';

  var last = (r.count - 1) * 3;
  if (opt.moved) {
    if (lands !== 1 || ev[0].type !== 'land') return 'first event is not land';
    if (ev[0].x !== r.carry || ev[0].z !== r.carryZ || ev[0].t !== r.flightTime || ev[0].speed !== r.landingSpeed) return 'land event mismatch';
    if (r.samples[last] !== r.total || r.samples[last + 1] !== 0 || r.samples[last + 2] !== r.finalZ) return 'last sample != (total, 0, finalZ)';
    // 접촉 이벤트는 재생 경로(샘플 선형 보간) 위에 있어야 한다. 접촉을 낀 샘플 구간에서 벗어날 수 있는 한도 = 속도 * 간격 / 2
    for (i = 0; i < ev.length; i++) {
      if (ev[i].type !== 'land' && ev[i].type !== 'bounce') continue;
      var pe = P.positionAt(r, ev[i].t), tol = 0.5 * ev[i].speed * r.sampleDt + 0.05;
      if (Math.sqrt((pe.x - ev[i].x) * (pe.x - ev[i].x) + (pe.z - ev[i].z) * (pe.z - ev[i].z)) > tol || pe.y > tol) {
        return ev[i].type + ' event off the sampled path at t=' + ev[i].t.toFixed(3);
      }
    }
  }
  if (typeof opt.gridHalfWidth === 'number') {
    var expectIn = Math.abs(r.finalZ) <= opt.gridHalfWidth && r.total > 0;
    if (r.inGrid !== expectIn) return 'inGrid inconsistent';
  }
  if (typeof opt.maxStep === 'number') {
    var m = maxSampleStep(r);
    if (m > opt.maxStep) return 'sample jump ' + m.toFixed(3) + ' m';
  }
  return '';
}

function maxSampleStep(r) {
  var s = r.samples, m = 0;
  for (var i = 1; i < r.count; i++) {
    var a = (i - 1) * 3, b = i * 3;
    var d = Math.sqrt((s[b] - s[a]) * (s[b] - s[a]) + (s[b + 1] - s[a + 1]) * (s[b + 1] - s[a + 1]) + (s[b + 2] - s[a + 2]) * (s[b + 2] - s[a + 2]));
    if (d > m) m = d;
  }
  return m;
}

function sameResult(a, b) {
  var keys = ['sampleDt', 'count', 'duration', 'carry', 'carryZ', 'flightTime', 'apex', 'apexX',
    'landingAngle', 'landingSpeed', 'total', 'finalZ', 'roll', 'inGrid'];
  var i;
  for (i = 0; i < keys.length; i++) if (a[keys[i]] !== b[keys[i]]) return false;
  if (a.samples.length !== b.samples.length) return false;
  for (i = 0; i < a.samples.length; i++) if (a.samples[i] !== b.samples[i]) return false;
  return JSON.stringify(a.events) === JSON.stringify(b.events);
}

function deepFreeze(o) {
  Object.keys(o).forEach(function (k) {
    if (o[k] && typeof o[k] === 'object') deepFreeze(o[k]);
  });
  return Object.freeze(o);
}

// 두 샘플 간격 동안 110 m/s 공이 가는 거리
var MAX_STEP = 110 * 2 * C.SAMPLE_DT;

/*
 * 참조 적분기: 명세(스핀 벡터 · 항력 · 마그누스 · 높이별 바람)만 보고 따로 짠 비행 계산. physics.js 의 코드는 쓰지 않는다.
 * 계수 식만 defaultEnv().aero 의 공개 값으로 맞춘다:  Cd = max(cdMin, cd0 + cd1 S / (S + sd)),  Cl = cl1 S / (S + sl)
 * 첫 착지까지만 계산한다 (발사각 2도 이상에서만 비교할 것: 그 아래는 physics.js 가 스핀을 줄인다).
 */
function refFlight(launch, env, dt) {
  env = env || {};
  dt = dt || 1 / 1920;
  var A = P.defaultEnv().aero, D2R = Math.PI / 180;
  var g = C.G, rad = C.BALL_RADIUS;
  var k = 0.5 * (env.airDensity === undefined ? C.AIR_DENSITY : env.airDensity) * Math.PI * rad * rad / C.BALL_MASS;
  var wX = env.windX || 0, wZ = env.windZ || 0, wp = env.windProfile || null;
  var el = launch.launchAngle * D2R, az = launch.azimuth * D2R;
  var bs = launch.backspin * Math.PI / 30, ss = launch.sidespin * Math.PI / 30;
  // omega = backspin * r + sidespin * (0, -1, 0),  r = (-sin az, 0, cos az)
  var om = [-Math.sin(az) * bs, -ss, Math.cos(az) * bs];
  var om0 = Math.sqrt(om[0] * om[0] + om[1] * om[1] + om[2] * om[2]);
  var st = [0, 0.03, 0,
    launch.ballSpeed * Math.cos(el) * Math.cos(az), launch.ballSpeed * Math.sin(el), launch.ballSpeed * Math.cos(el) * Math.sin(az)];
  function deriv(s, t) {
    var wk = 1;
    if (wp) wk = Math.max(wp.min, Math.min(wp.max, wp.base + s[1] / wp.scale));
    var rx = s[3] - wX * wk, ry = s[4], rz = s[5] - wZ * wk;
    var sp = Math.sqrt(rx * rx + ry * ry + rz * rz);
    var w = om0 * Math.exp(-t / A.spinDecay), S = w * rad / sp;
    var cd = Math.max(A.cdMin, A.cd0 + A.cd1 * S / (S + A.sd)), cl = A.cl1 * S / (S + A.sl);
    var ax = -k * cd * sp * rx, ay = -g - k * cd * sp * ry, azz = -k * cd * sp * rz;
    var cx = om[1] * rz - om[2] * ry, cy = om[2] * rx - om[0] * rz, cz = om[0] * ry - om[1] * rx;   // omega x v_rel
    var cn = Math.sqrt(cx * cx + cy * cy + cz * cz);
    if (cn > 0) { var f = k * cl * sp * sp / cn; ax += f * cx; ay += f * cy; azz += f * cz; }
    return [s[3], s[4], s[5], ax, ay, azz];
  }
  function axpy(s, d, h) { return [s[0] + h * d[0], s[1] + h * d[1], s[2] + h * d[2], s[3] + h * d[3], s[4] + h * d[4], s[5] + h * d[5]]; }
  var t = 0, apex = st[1], prev = st, i;
  for (var n = 0; n < 60 / dt; n++) {
    var k1 = deriv(st, t), k2 = deriv(axpy(st, k1, dt / 2), t + dt / 2), k3 = deriv(axpy(st, k2, dt / 2), t + dt / 2), k4 = deriv(axpy(st, k3, dt), t + dt);
    prev = st;
    st = st.slice();
    for (i = 0; i < 6; i++) st[i] += dt / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
    t += dt;
    if (st[1] > apex) apex = st[1];
    if (st[1] < 0) {
      var a = prev[1] / (prev[1] - st[1]);                // 마지막 스텝 안에서 선형 보간
      var c = axpy(prev, [st[0] - prev[0], st[1] - prev[1], st[2] - prev[2], st[3] - prev[3], st[4] - prev[4], st[5] - prev[5]], a);
      return {
        carry: c[0], carryZ: c[2], flightTime: t - dt + a * dt, apex: apex,
        landingAngle: Math.atan2(-c[4], Math.sqrt(c[3] * c[3] + c[5] * c[5])) / D2R,
        landingSpeed: Math.sqrt(c[3] * c[3] + c[4] * c[4] + c[5] * c[5])
      };
    }
  }
  return null;
}

/*
 * 블랙박스 계수 측정: 처음 세 샘플의 2차 차분으로 t = sampleDt 때의 가속도를 구하고, 중력을 빼서 Cd / Cl 을 역산한다.
 * (구현이 실제로 쓰는 계수를 재므로 physics.js 의 식이 바뀌어도 그대로 쓸 수 있다)
 */
function measureCoefficients(ballSpeed, rpm, launchAngle) {
  var r = P.simulate({ ballSpeed: ballSpeed, launchAngle: launchAngle === undefined ? 10 : launchAngle, azimuth: 0, backspin: rpm, sidespin: 0 });
  var s = r.samples, dt = r.sampleDt;
  var k = 0.5 * C.AIR_DENSITY * Math.PI * C.BALL_RADIUS * C.BALL_RADIUS / C.BALL_MASS;
  var ax = (s[6] - 2 * s[3] + s[0]) / (dt * dt), ay = (s[7] - 2 * s[4] + s[1]) / (dt * dt) + C.G;
  var vx = (s[6] - s[0]) / (2 * dt), vy = (s[7] - s[1]) / (2 * dt);
  var v = Math.sqrt(vx * vx + vy * vy);
  return {
    S: rpm * Math.PI / 30 * C.BALL_RADIUS / v,
    cd: -(ax * vx + ay * vy) / v / (k * v * v),          // 속도 반대 방향 성분
    cl: (ay * vx - ax * vy) / v / (k * v * v)            // 속도에 수직(위쪽) 성분
  };
}

var PGA = shot(167, 10.9, 2686);
var LPGA = shot(140, 13.2, 2611);
var IRON6 = shot(127, 14.1, 6231);
var LONG = shot(220, 12.0, 2200);

// ---------------------------------------------------------------------------
section('API');
// ---------------------------------------------------------------------------
(function () {
  var constKeys = ['G', 'BALL_MASS', 'BALL_RADIUS', 'AIR_DENSITY', 'YD_PER_M', 'MPH_PER_MS', 'SAMPLE_DT'];
  var okConst = constKeys.every(function (k) { return typeof C[k] === 'number' && isFinite(C[k]); });
  check('CONST fields', okConst && C.SAMPLE_DT === 1 / 120 && C.AIR_DENSITY === 1.225);
  var fns = ['defaultEnv', 'simulate', 'positionAt', 'mphToMs', 'msToMph', 'mToYd', 'ydToM'];
  check('functions exported', fns.every(function (k) { return typeof P[k] === 'function'; }));
  check('registered as KLD.physics', typeof globalThis !== 'undefined' && globalThis.KLD && globalThis.KLD.physics === P);
  var e1 = P.defaultEnv(), e2 = P.defaultEnv();
  e1.fairway.rollFriction = 99; e1.windX = 7;
  check('defaultEnv returns a fresh, complete object',
    e2.windX === 0 && e2.windZ === 0 && e2.windProfile === null && e2.airDensity === 1.225 && Math.abs(e2.gridHalfWidth - 27.432) < 1e-12 &&
    typeof e2.fairway === 'object' && typeof e2.rough === 'object' && e2.fairway.rollFriction !== 99);
  check('unit helpers',
    Math.abs(P.mphToMs(100) - 44.704) < 1e-9 && Math.abs(P.msToMph(44.704) - 100) < 1e-9 &&
    Math.abs(P.mToYd(0.9144) - 1) < 1e-12 && Math.abs(P.ydToM(1) - 0.9144) < 1e-12);

  // 브라우저의 일반 <script> 처럼 module / require 없이 실행해도 같은 결과가 나와야 한다
  var src = require('fs').readFileSync(path.join(__dirname, '..', 'js', 'physics.js'), 'utf8');
  var vm = require('vm');
  var sandbox = vm.createContext({});
  var browserOk = false;
  try {
    vm.runInContext(src, sandbox);
    var B = sandbox.KLD.physics;
    var rb = B.simulate(shot(220, 12, 2200, 1, 300), { windX: -2, windZ: 1 });
    var rn = P.simulate(shot(220, 12, 2200, 1, 300), { windX: -2, windZ: 1 });
    browserOk = rb.total === rn.total && rb.finalZ === rn.finalZ && rb.carry === rn.carry && rb.count === rn.count &&
      B.positionAt(rb, 3).x === P.positionAt(rn, 3).x;
  } catch (err) { browserOk = false; }
  check('runs as a classic <script> (no module / require)', browserOk);

  var code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  check('no DOM, no Math.random, no ES2019+ syntax',
    !/Math\.random|\bdocument\b|\bwindow\b|\?\.|\?\?|\bimport\b|\bexport\b|\bclass\b/.test(code));
})();

// ---------------------------------------------------------------------------
section('보정표 (무풍 · 해수면 · azimuth 0 · sidespin 0)');
// ---------------------------------------------------------------------------
(function () {
  var rows = [];
  function row(name, metric, lo, hi, actual, expectedText) {
    var ok = actual >= lo && actual <= hi;
    rows.push({ name: name, metric: metric, expected: expectedText, actual: actual, ok: ok });
    checks++;
    if (!ok) failures++;
  }
  var r;

  r = P.simulate(PGA);
  row('PGA driver 167mph 10.9deg 2686rpm', 'carry yd', 275 * 0.97, 275 * 1.03, yd(r.carry), '275 +-3%');
  row('', 'apex yd', 32 * 0.85, 32 * 1.15, yd(r.apex), '32 +-15%');
  row('', 'land deg', 33, 43, r.landingAngle, '38 +-5');
  row('', 'total yd', 290, 305, yd(r.total), '290-305');

  r = P.simulate(LPGA);
  row('LPGA driver 140mph 13.2deg 2611rpm', 'carry yd', 218 * 0.96, 218 * 1.04, yd(r.carry), '218 +-4%');
  row('', 'apex yd', 25 * 0.8, 25 * 1.2, yd(r.apex), '25 +-20%');
  row('', 'land deg', 31, 43, r.landingAngle, '37 +-6');

  r = P.simulate(IRON6);
  row('PGA 6-iron 127mph 14.1deg 6231rpm', 'carry yd', 183 * 0.92, 183 * 1.08, yd(r.carry), '183 +-8%');
  row('', 'apex yd', 30 * 0.75, 30 * 1.25, yd(r.apex), '30 +-25%');
  row('', 'land deg', 42, 58, r.landingAngle, '50 +-8');

  r = P.simulate(LONG);
  row('Long driver 220mph 12.0deg 2200rpm', 'carry yd', 385, 405, yd(r.carry), '385-405');
  row('', 'roll yd', 18, 40, yd(r.roll), '18-40');

  // 참고(웹 자료): R&A "Analysis of Trackman data gathered at World Long Drive events" (2019)
  // 남자 평균 214 mph / 11.2 deg / 2789 rpm -> 캐리 평균 352, 중앙값 361 yd
  r = P.simulate(shot(214, 11.2, 2789));
  row('WLD 2019 men avg 214mph 11.2deg 2789rpm', 'carry yd', 340, 380, yd(r.carry), '352 mean/361 med');

  console.log('  ' + pad('case', 42) + pad('metric', 10) + pad('expected', 18) + lpad('actual', 8) + '  ok');
  rows.forEach(function (q) {
    console.log('  ' + pad(q.name, 42) + pad(q.metric, 10) + pad(q.expected, 18) + lpad(f1(q.actual), 8) + '  ' + (q.ok ? 'PASS' : 'FAIL'));
  });
})();

// ---------------------------------------------------------------------------
section('바람 · 사이드스핀 감도 (장타 220 mph 기준)');
// ---------------------------------------------------------------------------
(function () {
  var base = P.simulate(LONG);
  var head = P.simulate(LONG, { windX: -5 });
  var tail = P.simulate(LONG, { windX: 5 });
  var cross = P.simulate(LONG, { windZ: 5 });
  var side = P.simulate(shot(220, 12, 2200, 0, 400));
  var az = P.simulate(shot(220, 12, 2200, 2, 0));

  var headLoss = (1 - head.carry / base.carry) * 100;
  var tailGain = (tail.carry / base.carry - 1) * 100;
  // 명세의 범위 그대로 (여유를 두지 않는다)
  check('headwind 5 m/s costs roughly 8-14% of carry', headLoss >= 8 && headLoss <= 14, headLoss.toFixed(2) + '%');
  check('tailwind 5 m/s adds roughly 5-10% of carry', tailGain >= 5 && tailGain <= 10, tailGain.toFixed(2) + '%');
  check('headwind hurts more than tailwind helps', headLoss > tailGain);
  check('crosswind 5 m/s -> 20-40 yd sideways at landing', yd(cross.carryZ) >= 20 && yd(cross.carryZ) <= 40, f1(yd(cross.carryZ)) + ' yd');
  check('sidespin +400 rpm -> 20-40 yd right at landing', yd(side.carryZ) >= 20 && yd(side.carryZ) <= 40, f1(yd(side.carryZ)) + ' yd');
  var at400 = az.carryZ / az.carry * 400;
  check('azimuth +2 deg -> about +14 yd at 400 yd', Math.abs(at400 - 14) < 1, f1(at400) + ' yd');

  // 참고(웹 자료, TrackMan): 캐리 300 yd 드라이브가 20 mph 맞바람에 259, 순풍에 333 yd
  var d = shot(180, 11, 2500), w20 = mph(20);
  var d0 = P.simulate(d), dh = P.simulate(d, { windX: -w20 }), dt = P.simulate(d, { windX: w20 });
  var dHead = (1 - dh.carry / d0.carry) * 100, dTail = (dt.carry / d0.carry - 1) * 100;
  check('300-yd drive, 20 mph wind (TrackMan: -13.7% / +11.0%)', dHead > 10.5 && dHead < 17 && dTail > 7 && dTail < 14,
    'carry ' + f1(yd(d0.carry)) + ' yd, -' + dHead.toFixed(1) + '% / +' + dTail.toFixed(1) + '%');
})();

// ---------------------------------------------------------------------------
section('독립 검증 (참조 적분기 · 해석해 · 공력 계수 · 탄도 모양)');
// ---------------------------------------------------------------------------
(function () {
  // 1) 따로 짠 참조 적분기(스텝 1/1920 s)와 첫 착지까지의 비행 비교
  var profile = { base: 0.5, scale: 50, min: 0.5, max: 2.0 };
  var cases = [
    [PGA, {}],
    [LONG, {}],
    [shot(220, 12, 2200, 2, 400), { windX: -5, windZ: 3 }],
    [shot(220, 15.5, 2650, -3, -600), { windX: 5, windZ: -4, windProfile: profile }],
    [shot(127, 14.1, 6231, 1, 300), { windZ: 6, airDensity: 1.1 }],
    [shot(150, 29, 5200, 0, 300), { windX: -3 }],
    [shot(136, 3.5, 3800, -1, -200), { windX: 2 }],   // 게임의 '탑볼' 샷 (낮은 발사각이지만 스핀은 그대로 적용돼야 한다)
    [shot(220, 2, 2200), {}]                          // 스핀을 줄이기 시작하는 경계(2도) 바로 위
  ];
  var worst = { carry: 0, carryZ: 0, flightTime: 0, apex: 0, landingAngle: 0, landingSpeed: 0 };
  cases.forEach(function (c) {
    var a = P.simulate(c[0], c[1]), b = refFlight(c[0], c[1]);
    Object.keys(worst).forEach(function (key) { worst[key] = Math.max(worst[key], Math.abs(a[key] - b[key])); });
  });
  check('flight matches an independent RK4 reference',
    worst.carry < 0.01 && worst.carryZ < 0.01 && worst.flightTime < 1e-3 && worst.apex < 0.01 && worst.landingAngle < 0.01 && worst.landingSpeed < 0.01,
    'worst carry ' + worst.carry.toExponential(1) + ' m, carryZ ' + worst.carryZ.toExponential(1) + ' m, apex ' + worst.apex.toExponential(1) + ' m, time ' + worst.flightTime.toExponential(1) + ' s');

  // 2) 진공(공기 밀도 0): 포물선 해석해
  var v0 = 50, el = 30 * Math.PI / 180, y0 = 0.03;
  var vac = P.simulate({ ballSpeed: v0, launchAngle: 30, azimuth: 0, backspin: 3000, sidespin: 500 }, { airDensity: 0 });
  var vy0 = v0 * Math.sin(el), vx0 = v0 * Math.cos(el);
  var tVac = (vy0 + Math.sqrt(vy0 * vy0 + 2 * C.G * y0)) / C.G;
  check('vacuum flight is the analytic parabola',
    Math.abs(vac.carry - vx0 * tVac) < 1e-4 && Math.abs(vac.flightTime - tVac) < 1e-6 && Math.abs(vac.apex - (y0 + vy0 * vy0 / (2 * C.G))) < 1e-3 && vac.carryZ === 0,
    'carry ' + vac.carry.toFixed(4) + ' vs ' + (vx0 * tVac).toFixed(4) + ' m');

  // 3) 방위각과 바람을 같이 돌리면 결과도 그대로 돈다 (지면은 전부 페어웨이로 두고 비교)
  var base = P.simulate(shot(220, 12, 2200, 0, 350), { windX: 4, windZ: -3, gridHalfWidth: 1e6 });
  var worstRot = 0;
  [-170, -90, -45, -10, 7, 30, 90, 135, 180].forEach(function (th) {
    var cs = Math.cos(th * Math.PI / 180), sn = Math.sin(th * Math.PI / 180);
    var r = P.simulate(shot(220, 12, 2200, th, 350), { windX: 4 * cs + 3 * sn, windZ: 4 * sn - 3 * cs, gridHalfWidth: 1e6 });
    worstRot = Math.max(worstRot,
      Math.abs(r.carry - (base.carry * cs - base.carryZ * sn)), Math.abs(r.carryZ - (base.carry * sn + base.carryZ * cs)),
      Math.abs(r.total - (base.total * cs - base.finalZ * sn)), Math.abs(r.finalZ - (base.total * sn + base.finalZ * cs)),
      Math.abs(r.apex - base.apex), Math.abs(r.duration - base.duration));
  });
  check('rotating azimuth and wind together rotates the result', worstRot < 1e-3, 'worst ' + worstRot.toExponential(1) + ' m');

  // 4) 구현이 실제로 쓰는 Cd / Cl 을 공개된 현대 골프공 자료와 비교.
  //    Acushnet 특허 US 7,156,757 Table 1 (중앙값): [Re, 스핀 비, sqrt(Cl^2 + Cd^2), atan(Cl / Cd) deg]. 약 3000 rpm 으로 속도만 바꾼 점들이다.
  var published = [[230000, 0.085, 0.265, 33], [207000, 0.095, 0.271, 36], [184000, 0.106, 0.280, 38], [161000, 0.122, 0.291, 40],
    [138000, 0.142, 0.311, 41], [115000, 0.170, 0.344, 42], [92000, 0.213, 0.390, 43], [69000, 0.284, 0.440, 42]];
  var NU = 1.46e-5, worstCd = 0, worstCl = 0;
  published.forEach(function (row) {
    var v = row[0] * NU / (2 * C.BALL_RADIUS), rpm = row[1] * v / C.BALL_RADIUS * 30 / Math.PI;
    var m = measureCoefficients(v, rpm);
    var cd = row[2] * Math.cos(row[3] * Math.PI / 180), cl = row[2] * Math.sin(row[3] * Math.PI / 180);
    worstCd = Math.max(worstCd, Math.abs(m.cd / cd - 1));
    worstCl = Math.max(worstCl, Math.abs(m.cl / cl - 1));
  });
  check('Cd / Cl agree with published modern-ball data for spin ratios 0.085-0.284', worstCd < 0.12 && worstCl < 0.08,
    'worst Cd ' + (worstCd * 100).toFixed(1) + '%, Cl ' + (worstCl * 100).toFixed(1) + '%');
  // 장타 발사 조건(스핀 비 0.05 안팎)은 위 자료 범위 밖의 외삽이다. 220 mph 기준(캐리 385~405 yd)을 맞추느라
  // 풍동값(약 0.21)보다 항력이 낮게 잡혀 있다. 그래도 물리적으로 말이 되는 범위 안에 있는지만 본다.
  var lowS = measureCoefficients(mph(220), 2200, 12), midS = measureCoefficients(mph(167), 2686, 10.9), highS = measureCoefficients(mph(127), 6231, 14.1);
  check('coefficients stay in a physical range from long-drive launch to iron shots',
    lowS.cd >= 0.15 && lowS.cd <= 0.25 && lowS.cl >= 0.08 && lowS.cl <= 0.14 &&
    midS.cd >= 0.19 && midS.cd <= 0.25 && midS.cl >= 0.12 && midS.cl <= 0.18 &&
    highS.cd >= 0.27 && highS.cd <= 0.36 && highS.cl >= 0.24 && highS.cl <= 0.33 &&
    lowS.cd < midS.cd && midS.cd < highS.cd && lowS.cl < midS.cl && midS.cl < highS.cl,
    'S ' + lowS.S.toFixed(3) + ': Cd ' + lowS.cd.toFixed(3) + ' Cl ' + lowS.cl.toFixed(3) +
    ' | S ' + midS.S.toFixed(3) + ': Cd ' + midS.cd.toFixed(3) + ' Cl ' + midS.cl.toFixed(3) +
    ' | S ' + highS.S.toFixed(3) + ': Cd ' + highS.cd.toFixed(3) + ' Cl ' + highS.cl.toFixed(3));
  // 스핀이 아주 적어도 항력은 하한(cdMin) 아래로 내려가지 않고, 무회전 공에는 양력이 없다
  var floorS = measureCoefficients(mph(229), 1600, 12), noSpinC = measureCoefficients(mph(229), 0, 12);
  var cdMin = P.defaultEnv().aero.cdMin;
  check('drag has a floor at very low spin; no spin means no lift',
    cdMin >= 0.15 && Math.abs(floorS.cd - cdMin) < 2e-3 && Math.abs(noSpinC.cd - cdMin) < 2e-3 && Math.abs(noSpinC.cl) < 2e-3 && floorS.cl > 0.05,
    'S ' + floorS.S.toFixed(3) + ': Cd ' + floorS.cd.toFixed(3) + ' Cl ' + floorS.cl.toFixed(3) + ' | no spin: Cd ' + noSpinC.cd.toFixed(3) + ' Cl ' + noSpinC.cl.toFixed(3));

  // 보정에 쓰지 않은 클럽으로 교차 확인: TrackMan PGA TOUR 평균표 [볼 스피드 mph, 발사각, 스핀 rpm, 최고점 yd, 캐리 yd]
  // (스핀 비 0.08~0.46 전 구간에서 계수가 말이 되는지 본다. 보정 대상은 드라이버와 6번 아이언뿐이다)
  var tour = [['3-wood', 158, 9.2, 3655, 30, 243], ['5-wood', 152, 9.4, 4350, 31, 230], ['hybrid', 146, 10.2, 4437, 29, 225],
    ['3-iron', 142, 10.4, 4630, 27, 212], ['4-iron', 137, 11.0, 4836, 28, 203], ['5-iron', 132, 12.1, 5361, 31, 194],
    ['7-iron', 120, 16.3, 7097, 32, 172], ['8-iron', 115, 18.1, 7998, 31, 160], ['9-iron', 109, 20.4, 8647, 30, 148], ['PW', 102, 24.2, 9304, 29, 136]];
  var worstCarry = 0, worstApex = 0, worstClub = '';
  tour.forEach(function (c) {
    var r = P.simulate(shot(c[1], c[2], c[3]));
    var dc = yd(r.carry) / c[5] - 1, da = yd(r.apex) / c[4] - 1;
    if (Math.abs(dc) > Math.abs(worstCarry)) { worstCarry = dc; worstClub = c[0]; }
    if (Math.abs(da) > Math.abs(worstApex)) worstApex = da;
  });
  check('uncalibrated clubs (3-wood .. PW, TrackMan PGA TOUR averages): carry within 5%, apex within 20%',
    Math.abs(worstCarry) < 0.05 && Math.abs(worstApex) < 0.20,
    'worst carry ' + (worstCarry * 100).toFixed(1) + '% (' + worstClub + '), worst apex ' + (worstApex * 100).toFixed(1) + '%');

  // 5) 탄도 모양: 체공 시간과 최고점 위치
  var pga = P.simulate(PGA), lpga = P.simulate(LPGA), iron = P.simulate(IRON6), lng = P.simulate(LONG);
  check('PGA driver hang time is roughly 6-7 s', pga.flightTime >= 6.0 && pga.flightTime <= 7.0, pga.flightTime.toFixed(2) + ' s');
  var fr = [pga, lpga, iron, lng].map(function (r) { return r.apexX / r.carry; });
  check('apex sits at 55-70% of carry and the descent is steeper than the climb',
    fr.every(function (f) { return f >= 0.55 && f <= 0.70; }) &&
    pga.landingAngle > 2 * PGA.launchAngle && lpga.landingAngle > 2 * LPGA.launchAngle &&
    iron.landingAngle > 2 * IRON6.launchAngle && lng.landingAngle > 2 * LONG.launchAngle,
    fr.map(function (f) { return (f * 100).toFixed(0) + '%'; }).join(' '));
  // 속도가 줄어든 채 떨어진다: 착지 속도는 발사 속도의 절반 이하
  check('landing speed is well below launch speed', pga.landingSpeed < 0.5 * PGA.ballSpeed && lng.landingSpeed < 0.5 * LONG.ballSpeed,
    f1(P.msToMph(pga.landingSpeed)) + ' / ' + f1(P.msToMph(lng.landingSpeed)) + ' mph');

  // 6) 스핀 감쇠: 시상수 기본값은 20~30 s, 실제로 쓰인다 (빨리 줄면 뒤쪽 양력이 줄어 덜 뜨고 완만하게 떨어진다)
  var tau = P.defaultEnv().aero.spinDecay;
  var fastDecay = P.simulate(PGA, { aero: { spinDecay: 5 } }), slowDecay = P.simulate(PGA, { aero: { spinDecay: 1e6 } });
  check('spin decays with a 20-30 s time constant, and the decay matters', tau >= 20 && tau <= 30 &&
    fastDecay.apex < pga.apex - 1 && fastDecay.landingAngle < pga.landingAngle - 2 && slowDecay.apex > pga.apex && slowDecay.landingAngle > pga.landingAngle,
    'tau ' + tau + ' s; apex ' + f1(yd(fastDecay.apex)) + ' (tau 5) < ' + f1(yd(pga.apex)) + ' < ' + f1(yd(slowDecay.apex)) + ' yd (no decay)');

  // 7) 기준값 고정: 다른 모듈(js/config.js 의 샷 값, tests/balance.js 의 난이도)이 이 숫자에 맞춰 조정돼 있다.
  //    계수나 지면 값을 일부러 바꿨다면 여기 숫자를 새 값으로 고치고, 게임 쪽 밸런스를 다시 확인할 것.
  var golden = [
    ['PGA driver', P.simulate(PGA), 274.44, 297.56],
    ['long driver 220/12/2200', lng, 388.44, 413.81],
    ['220 mph 12.5 deg 2300 rpm', P.simulate(shot(220, 12.5, 2300)), 385.84, 410.20],
    ['same, az 1 deg, sidespin 200, wind -3 / +2 with game profile',
      P.simulate(shot(220, 12.5, 2300, 1, 200), { windX: -3, windZ: 2, windProfile: { base: 0.5, scale: 50, min: 0.5, max: 2.0 } }), 360.56, 364.11],
    ['long driver into the rough (az 6 deg)', P.simulate(shot(220, 12, 2200, 6, 0)), 386.31, 391.30]
  ];
  var drift = golden.filter(function (gRow) { return Math.abs(yd(gRow[1].carry) - gRow[2]) > 0.3 || Math.abs(yd(gRow[1].total) - gRow[3]) > 0.3; })
    .map(function (gRow) { return gRow[0] + ': ' + yd(gRow[1].carry).toFixed(2) + ' / ' + yd(gRow[1].total).toFixed(2) + ' (was ' + gRow[2] + ' / ' + gRow[3] + ')'; });
  var windy = golden[3][1];
  // 탑볼(발사각 0도 이하)의 총거리: 바운드·구름 중의 공기 저항까지 포함한 값
  var top2 = yd(P.simulate(shot(220, -2, 2200)).total), top0 = yd(P.simulate(shot(220, 0, 2200)).total);
  if (Math.abs(top2 - 228.5) > 1 || Math.abs(top0 - 245.6) > 1) drift.push('topped 220 mph: ' + top2.toFixed(1) + ' / ' + top0.toFixed(1) + ' (was 228.5 / 245.6)');
  check('reference numbers unchanged (carry / total within 0.3 yd)', drift.length === 0 &&
    Math.abs(yd(windy.carryZ) - 39.33) < 0.3 && Math.abs(yd(windy.finalZ) - 40.21) < 0.3 && windy.inGrid === false, drift.join(' | '));
})();

// ---------------------------------------------------------------------------
section('높이별 바람 (env.windProfile)');
// ---------------------------------------------------------------------------
(function () {
  // 게임 설정(js/config.js)이 넘기는 형태: 배율 = clamp(base + y / scale, min, max)
  var profile = { base: 0.5, scale: 50, min: 0.5, max: 2.0 };
  var l = shot(220, 12, 2200, 1, 200);

  var doubled = P.simulate(l, { windX: 3, windZ: -1, windProfile: { base: 2, scale: 0, min: 2, max: 2 } });
  var uniform = P.simulate(l, { windX: 6, windZ: -2 });
  check('constant x2 profile equals doubling the wind', sameResult(doubled, uniform));

  var none = P.simulate(l, { windX: 3, windZ: -1 });
  var same = [null, undefined, 'x', 7, {}, { base: NaN }, { base: 1, scale: -5 }].every(function (wp) {
    return sameResult(P.simulate(l, { windX: 3, windZ: -1, windProfile: wp }), none);
  });
  check('missing / unusable profile means a uniform wind', same);

  var calm = P.simulate(l, { windProfile: profile });
  check('profile has no effect in calm air', sameResult(calm, P.simulate(l)));

  // 배율은 [min, max] 로 잘린다
  //  - base 가 min 보다 작고 높이 변화가 사실상 없으면(scale 아주 큼) 배율은 어디서나 min -> 바람을 그만큼 줄인 것과 같다
  //  - 높이에 따라 아주 가파르게 커지면(scale 1 mm) 2 mm 위로는 배율이 max -> 바람을 max 배 한 것과 (거의) 같다
  var floorP = P.simulate(l, { windX: 4, windZ: -2, windProfile: { base: -3, scale: 1e9, min: 0.5, max: 2 } });
  var ceilP = P.simulate(l, { windX: 2, windZ: -1, windProfile: { base: 0, scale: 0.001, min: 0, max: 2 } });
  var halfWind = P.simulate(l, { windX: 2, windZ: -1 }), twiceWind = P.simulate(l, { windX: 4, windZ: -2 });
  check('profile multiplier is clamped to [min, max]',
    Math.abs(floorP.carry - halfWind.carry) < 1e-3 && Math.abs(floorP.carryZ - halfWind.carryZ) < 1e-3 &&
    Math.abs(ceilP.carry - twiceWind.carry) < 0.05 && Math.abs(ceilP.carryZ - twiceWind.carryZ) < 0.05 &&
    Math.abs(twiceWind.carry - halfWind.carry) > 3,
    'min: ' + f1(yd(floorP.carry)) + ' vs ' + f1(yd(halfWind.carry)) + ' yd, max: ' + f1(yd(ceilP.carry)) + ' vs ' + f1(yd(twiceWind.carry)) + ' yd');

  // 높이 뜨는 공일수록 바람을 더 탄다
  var high = shot(220, 16, 2300), low = shot(220, 9.5, 2050), skim = shot(150, 4, 2500);
  function gain(launch, env) { return P.simulate(launch, env).carry - P.simulate(launch).carry; }
  var gHighP = gain(high, { windX: 3, windProfile: profile }), gHighU = gain(high, { windX: 3 });
  var gLowP = gain(low, { windX: 3, windProfile: profile });
  var gSkimP = gain(skim, { windX: 3, windProfile: profile }), gSkimU = gain(skim, { windX: 3 });
  check('high shots ride the wind more than low shots', gHighP > gHighU && gHighP > gLowP * 1.3,
    'tail 3 m/s: high +' + f1(yd(gHighP)) + ' yd (uniform +' + f1(yd(gHighU)) + '), low +' + f1(yd(gLowP)) + ' yd');
  // 지면 가까이 나는 공은 배율이 1보다 작아 바람 영향이 줄어든다
  check('ground-hugging shots feel less wind', Math.abs(gSkimP) < Math.abs(gSkimU) * 0.8,
    'carry change ' + f1(yd(gSkimP)) + ' yd vs uniform ' + f1(yd(gSkimU)) + ' yd');
  var hHighP = -gain(high, { windX: -3, windProfile: profile }), hLowP = -gain(low, { windX: -3, windProfile: profile });
  check('headwind hurts high shots more', hHighP > hLowP * 1.3, 'head 3 m/s: high -' + f1(yd(hHighP)) + ' yd, low -' + f1(yd(hLowP)) + ' yd');

  var cross = P.simulate(l, { windZ: 3, windProfile: profile }), crossL = P.simulate(l, { windZ: -3, windProfile: profile });
  check('profile keeps left / right symmetry', (function () {
    var a = P.simulate(shot(220, 12, 2200, 0, 0), { windZ: 3, windProfile: profile });
    var b = P.simulate(shot(220, 12, 2200, 0, 0), { windZ: -3, windProfile: profile });
    return a.carryZ > 0 && Math.abs(a.carryZ + b.carryZ) < 1e-9 && Math.abs(a.carry - b.carry) < 1e-9;
  })() && validate(cross, { moved: true, maxStep: MAX_STEP }) === '' && validate(crossL, { moved: true, maxStep: MAX_STEP }) === '');
})();

// ---------------------------------------------------------------------------
section('부호 규약');
// ---------------------------------------------------------------------------
(function () {
  var r0 = P.simulate(LONG);
  check('straight shot stays on the target line', r0.carryZ === 0 && r0.finalZ === 0 && r0.inGrid === true);

  var azR = P.simulate(shot(220, 12, 2200, 3, 0)), azL = P.simulate(shot(220, 12, 2200, -3, 0));
  check('azimuth + starts right (+z), - starts left', azR.carryZ > 0 && azR.finalZ > 0 && azL.carryZ < 0 && azL.finalZ < 0);
  check('azimuth mirror symmetry', Math.abs(azR.carryZ + azL.carryZ) < 1e-9 && Math.abs(azR.carry - azL.carry) < 1e-9);

  var ssR = P.simulate(shot(220, 12, 2200, 0, 500)), ssL = P.simulate(shot(220, 12, 2200, 0, -500));
  check('sidespin + curves right (+z), - curves left', ssR.carryZ > 0 && ssR.finalZ > 0 && ssL.carryZ < 0 && ssL.finalZ < 0);
  check('sidespin mirror symmetry', Math.abs(ssR.carryZ + ssL.carryZ) < 1e-9 && Math.abs(ssR.carry - ssL.carry) < 1e-9);
  // 휘는 공: 출발은 직선 위, 뒤로 갈수록 더 벌어진다
  var early = P.positionAt(ssR, 1.0), late = P.positionAt(ssR, ssR.flightTime * 0.9);
  check('sidespin curve grows along the flight', early.z > 0 && late.z / late.x > early.z / early.x * 1.5);

  var wR = P.simulate(LONG, { windZ: 4 }), wL = P.simulate(LONG, { windZ: -4 });
  check('windZ + pushes right (+z), - pushes left', wR.carryZ > 0 && wR.finalZ > 0 && wL.carryZ < 0 && wL.finalZ < 0);
  check('windZ mirror symmetry', Math.abs(wR.carryZ + wL.carryZ) < 1e-9 && Math.abs(wR.carry - wL.carry) < 1e-9);

  var tail = P.simulate(LONG, { windX: 4 }), head = P.simulate(LONG, { windX: -4 });
  check('windX + is a tailwind (longer), - is a headwind (shorter)', tail.carry > r0.carry && head.carry < r0.carry);

  var noSpin = P.simulate(shot(220, 12, 0));
  check('backspin produces upward lift', r0.apex > noSpin.apex * 2 && r0.flightTime > noSpin.flightTime * 1.5 && r0.carry > noSpin.carry,
    'apex ' + f1(yd(r0.apex)) + ' vs ' + f1(yd(noSpin.apex)) + ' yd');
})();

// ---------------------------------------------------------------------------
section('단조성');
// ---------------------------------------------------------------------------
(function () {
  var ok = true, prev = -Infinity, w, r, list = [];
  for (w = -15; w <= 15; w += 2.5) {
    r = P.simulate(LONG, { windX: w });
    if (!(r.carry > prev)) ok = false;
    prev = r.carry;
    list.push(Math.round(yd(r.carry)));
  }
  check('more tailwind -> more carry (long driver, -15..+15 m/s)', ok, list.join(' '));

  ok = true; prev = -Infinity;
  for (w = -15; w <= 15; w += 2.5) {
    r = P.simulate(PGA, { windX: w });
    if (!(r.carry > prev)) ok = false;
    prev = r.carry;
  }
  check('more tailwind -> more carry (PGA driver)', ok);

  ok = true; prev = -Infinity;
  var prevTotal = -Infinity;
  for (var v = 100; v <= 240; v += 5) {
    r = P.simulate(shot(v, 12.5, 2300));
    if (!(r.carry > prev) || !(r.total > prevTotal)) ok = false;
    prev = r.carry; prevTotal = r.total;
  }
  check('more ball speed -> more carry and total (100..240 mph)', ok);

  // 게임 구간의 공정성: 볼 스피드를 0.1 mph 씩 올릴 때 기록(total)이 줄거나 툭 튀지 않는다 (바운드 횟수가 바뀌는 지점 포함)
  ok = true;
  var worstStep = 0, worstAt = '';
  [[9.5, 2000, {}], [12.5, 2300, {}], [15.5, 2650, {}],
    [12.5, 2300, { windX: -3, windProfile: { base: 0.5, scale: 50, min: 0.5, max: 2.0 } }],
    [12.5, 2300, { windX: 3, windProfile: { base: 0.5, scale: 50, min: 0.5, max: 2.0 } }]].forEach(function (c) {
    var prevT = -Infinity;
    for (var s10 = 2000; s10 <= 2350; s10++) {
      var q = P.simulate(shot(s10 / 10, c[0], c[1]), c[2]);
      var step = yd(q.total) - prevT;
      if (prevT > -Infinity) {
        if (!(step > 0)) ok = false;
        if (step > worstStep) { worstStep = step; worstAt = (s10 / 10) + ' mph, ' + c[0] + ' deg'; }
      }
      prevT = yd(q.total);
    }
  });
  check('total grows smoothly with ball speed in the game range (200..235 mph, 0.1 mph steps)', ok && worstStep < 0.6,
    'largest step ' + worstStep.toFixed(2) + ' yd at ' + worstAt);

  ok = true; prev = Infinity;
  for (var rho = 0.9; rho <= 1.3001; rho += 0.05) {
    r = P.simulate(LONG, { airDensity: rho });
    if (!(r.carry < prev)) ok = false;
    prev = r.carry;
  }
  check('denser air -> less carry', ok);
})();

// ---------------------------------------------------------------------------
section('결정성 · 입력 불변');
// ---------------------------------------------------------------------------
(function () {
  var launch = shot(213, 11.7, 2450, 1.3, -260);
  var env = { windX: -2.2, windZ: 1.4, gridHalfWidth: 27.432, fairway: { rollFriction: 0.3 } };
  var a = P.simulate(launch, env);
  P.simulate(shot(150, 30, 6000, -8, 900), { windX: 9 });   // 사이에 다른 샷을 끼워 넣는다
  var b = P.simulate(launch, env);
  check('same input twice -> identical output', sameResult(a, b));
  check('results do not share the sample buffer', a.samples !== b.samples && a.samples.buffer !== b.samples.buffer);

  var fl = deepFreeze(shot(220, 12, 2200, 1, 200));
  var fe = deepFreeze({ windX: 3, windZ: -2, airDensity: 1.2, gridHalfWidth: 25, windProfile: { base: 0.5, scale: 50, min: 0.5, max: 2 },
    fairway: { rollFriction: 0.4 }, rough: { rollFriction: 1.2 } });
  var beforeL = JSON.stringify(fl), beforeE = JSON.stringify(fe);
  var threw = false;
  try { P.simulate(fl, fe); } catch (err) { threw = true; }
  check('simulate() does not mutate its arguments', !threw && JSON.stringify(fl) === beforeL && JSON.stringify(fe) === beforeE);

  var partial = P.simulate(LONG, { fairway: { rollFriction: 3 } });
  var full = P.simulate(LONG);
  check('partial env override falls back to defaults', partial.carry === full.carry && partial.total < full.total && partial.total > partial.carry);
})();

// ---------------------------------------------------------------------------
section('NaN 없음 (퍼즈)');
// ---------------------------------------------------------------------------
(function () {
  var rnd = makeLcg(20261111);
  var bad = [], n = 400, i, launch, env, r, msg;
  for (i = 0; i < n; i++) {
    launch = {
      ballSpeed: rnd() < 0.05 ? -5 * rnd() : 110 * rnd(),
      launchAngle: rnd() < 0.8 ? -5 + 45 * rnd() : -30 + 120 * rnd(),
      azimuth: rnd() < 0.8 ? -20 + 40 * rnd() : -180 + 360 * rnd(),
      backspin: 10000 * rnd() * rnd(),
      sidespin: -3000 + 6000 * rnd()
    };
    env = {
      windX: -15 + 30 * rnd(),
      windZ: -15 + 30 * rnd(),
      airDensity: 0.9 + 0.4 * rnd(),
      gridHalfWidth: 60 * rnd()
    };
    try {
      r = P.simulate(launch, env);
      msg = validate(r, { moved: launch.ballSpeed > 0, gridHalfWidth: env.gridHalfWidth, maxStep: MAX_STEP });
    } catch (err) {
      msg = 'threw ' + err.message;
    }
    if (msg) bad.push('#' + i + ' ' + msg + ' ' + JSON.stringify(launch) + ' ' + JSON.stringify(env));
  }
  check(n + ' random launches / winds: finite, consistent, continuous', bad.length === 0, bad.length ? bad.slice(0, 3).join(' | ') : '');

  // 엉뚱한 값
  var junk = [NaN, Infinity, -Infinity, undefined, null, 'abc', {}, true, -1e12, 1e12];
  var fields = ['ballSpeed', 'launchAngle', 'azimuth', 'backspin', 'sidespin'];
  var envFields = ['windX', 'windZ', 'airDensity', 'gridHalfWidth', 'fairway', 'rough', 'aero', 'windProfile', 'substeps'];
  var bad2 = [], count = 0;
  fields.forEach(function (f) {
    junk.forEach(function (j) {
      var l = shot(200, 12, 2400, 1, 100);
      l[f] = j;
      count++;
      try {
        var m = validate(P.simulate(l, { windX: 2 }), {});
        if (m) bad2.push(f + '=' + String(j) + ': ' + m);
      } catch (err) { bad2.push(f + '=' + String(j) + ': threw ' + err.message); }
    });
  });
  envFields.forEach(function (f) {
    junk.forEach(function (j) {
      var e = {};
      e[f] = j;
      count++;
      try {
        var m = validate(P.simulate(shot(200, 12, 2400, 1, 100), e), { moved: true });
        if (m) bad2.push('env.' + f + '=' + String(j) + ': ' + m);
      } catch (err) { bad2.push('env.' + f + '=' + String(j) + ': threw ' + err.message); }
    });
  });
  [undefined, null, 5, 'x', [], {}].forEach(function (l) {
    count++;
    try {
      var r2 = P.simulate(l, null);
      var m = validate(r2, {});
      if (m || r2.total !== 0 || r2.inGrid !== false) bad2.push('launch=' + String(l) + ': ' + (m || 'should stay on the tee'));
    } catch (err) { bad2.push('launch=' + String(l) + ': threw ' + err.message); }
  });
  // 지면 · 공력 값 하나하나에 엉뚱한 값: 무시하고 기본값을 쓴다 (결과가 기본 설정과 완전히 같아야 한다)
  var plain = P.simulate(shot(200, 12, 2400, 1, 100), { windX: 2 });
  var def = P.defaultEnv();
  [['fairway', def.fairway], ['rough', def.rough], ['aero', def.aero]].forEach(function (grp) {
    Object.keys(grp[1]).forEach(function (key) {
      [NaN, Infinity, -Infinity, undefined, null, 'abc', {}, true].forEach(function (j) {
        var e = { windX: 2 };
        e[grp[0]] = {};
        e[grp[0]][key] = j;
        count++;
        try {
          if (!sameResult(P.simulate(shot(200, 12, 2400, 1, 100), e), plain)) bad2.push('env.' + grp[0] + '.' + key + '=' + String(j) + ': not ignored');
        } catch (err) { bad2.push('env.' + grp[0] + '.' + key + '=' + String(j) + ': threw ' + err.message); }
      });
    });
  });
  var weirdGround = { fairway: { restitution: 5, restitutionMin: -3, restitutionSpeed: 0, tangentialLoss: -2, rollFriction: -1, minBounce: 0, stopSpeed: 0 }, rough: { rollFriction: NaN } };
  count++;
  try {
    var m3 = validate(P.simulate(LONG, weirdGround), { moved: true, maxStep: MAX_STEP });
    if (m3) bad2.push('weird ground: ' + m3);
  } catch (err) { bad2.push('weird ground: threw ' + err.message); }
  check(count + ' junk inputs: no throw, no NaN', bad2.length === 0, bad2.length ? bad2.slice(0, 3).join(' | ') : '');
})();

// ---------------------------------------------------------------------------
section('지면');
// ---------------------------------------------------------------------------
(function () {
  // 같은 비행, 다른 지면: 그리드 안(페어웨이) vs 그리드 밖(러프)
  var launch = shot(220, 12, 2200, 3, 0);
  var onFairway = P.simulate(launch, { gridHalfWidth: 500 });
  var onRough = P.simulate(launch, { gridHalfWidth: 1 });
  function groundRun(r) {
    return Math.sqrt((r.total - r.carry) * (r.total - r.carry) + (r.finalZ - r.carryZ) * (r.finalZ - r.carryZ));
  }
  check('rough stops shorter than fairway', onRough.carry === onFairway.carry && groundRun(onRough) < 0.5 * groundRun(onFairway) && groundRun(onRough) > 0,
    f1(yd(groundRun(onRough))) + ' vs ' + f1(yd(groundRun(onFairway))) + ' yd');
  check('inGrid follows the resting position', onFairway.inGrid === true && onRough.inGrid === false);

  var r = P.simulate(LONG);
  var types = r.events.map(function (e) { return e.type; });
  check('event order: land -> bounce(s) -> roll -> rest',
    types[0] === 'land' && types[types.length - 1] === 'rest' && types[types.length - 2] === 'roll' &&
    types.indexOf('bounce') === 1 && types.filter(function (t) { return t === 'bounce'; }).length === types.length - 3,
    types.join(' '));
  var bounceSpeeds = r.events.filter(function (e) { return e.type === 'land' || e.type === 'bounce'; }).map(function (e) { return e.speed; });
  var decaying = bounceSpeeds.every(function (v, i) { return i === 0 || v < bounceSpeeds[i - 1]; });
  check('each contact is slower than the one before', decaying, bounceSpeeds.map(f1).join(' > ') + ' m/s');
  check('ground direction keeps the heading (no sidespin kick)', (function () {
    var q = P.simulate(shot(220, 12, 2200, 2, 300));
    var land = q.events[0], rest = q.events[q.events.length - 1];
    var ok = true, dirZ = null;
    q.events.forEach(function (e, i) {
      if (i === 0) return;
      var prev = q.events[i - 1];
      var dx = e.x - prev.x, dz = e.z - prev.z;
      if (Math.sqrt(dx * dx + dz * dz) < 0.05) return;
      var slope = dz / dx;
      if (dirZ === null) dirZ = slope;
      else if (Math.abs(slope - dirZ) > 2e-3) ok = false;
    });
    return ok && rest.x > land.x;
  })());

  var steep = P.simulate(shot(220, 15.5, 2650)), shallow = P.simulate(shot(220, 9.5, 2000));
  check('steeper landing -> less roll', steep.landingAngle > shallow.landingAngle && steep.roll < shallow.roll,
    f1(steep.landingAngle) + ' deg ' + f1(yd(steep.roll)) + ' yd vs ' + f1(shallow.landingAngle) + ' deg ' + f1(yd(shallow.roll)) + ' yd');

  // --- 러프 <-> 그리드 경계를 넘는 공 ---
  var GH = 27.432;
  // carryZ 가 목표값이 되는 방위각을 이분법으로 찾는다 (carryZ 는 방위각에 단조 증가)
  function azimuthFor(targetZ, sidespin, env) {
    var lo = 0, hi = 25;
    for (var i = 0; i < 50; i++) {
      var mid = (lo + hi) / 2;
      if (P.simulate(shot(220, 12, 2200, mid, sidespin), env).carryZ > targetZ) hi = mid; else lo = mid;
    }
    return (lo + hi) / 2;
  }
  function crossing(launch, env) {
    var r = P.simulate(launch, env);
    return {
      r: r, run: groundRun(r),
      fairwayRun: groundRun(P.simulate(launch, Object.assign({}, env, { gridHalfWidth: 1e6 }))),
      roughRun: groundRun(P.simulate(launch, Object.assign({}, env, { gridHalfWidth: 0 }))),
      msg: validate(r, { moved: true, gridHalfWidth: GH, maxStep: MAX_STEP })
    };
  }
  // (a) 오른쪽으로 출발해 왼쪽 옆바람에 밀려 들어오며 러프에 착지 -> 다음 접촉부터는 그리드 안 (페어웨이 값으로 튄다)
  var windIn = { windZ: -10 };
  var inward = crossing(shot(220, 12, 2200, azimuthFor(GH + 0.2, 0, windIn), 0), windIn);
  check('lands in the rough, runs into the grid -> counts as in grid',
    inward.msg === '' && inward.r.carryZ > GH && inward.r.finalZ > 0 && inward.r.finalZ < GH && inward.r.inGrid === true &&
    inward.run > inward.roughRun * 1.2 && inward.run < inward.fairwayRun * 0.8,
    'carryZ ' + inward.r.carryZ.toFixed(2) + ' -> finalZ ' + inward.r.finalZ.toFixed(2) + ' m, run ' + inward.run.toFixed(1) +
    ' m (all rough ' + inward.roughRun.toFixed(1) + ', all fairway ' + inward.fairwayRun.toFixed(1) + ')' + inward.msg);
  // (b) 훅(왼쪽으로 휘는 공)도 같은 식으로 들어온다
  var hook = crossing(shot(220, 12, 2200, azimuthFor(GH + 0.2, -900, {}), -900), {});
  check('hook landing just outside the grid comes back in',
    hook.msg === '' && hook.r.carryZ > GH && hook.r.finalZ < GH && hook.r.inGrid === true && hook.run > hook.roughRun * 1.2,
    'carryZ ' + hook.r.carryZ.toFixed(2) + ' -> finalZ ' + hook.r.finalZ.toFixed(2) + ' m' + hook.msg);
  // (c) 그리드 안쪽 가장자리에 착지해 바깥으로 튀어 나가는 공: 러프에서 금방 멈추고 OB
  var outward = crossing(shot(220, 12, 2200, azimuthFor(GH - 0.3, 0, {}), 0), {});
  check('lands inside the grid edge, runs out into the rough -> out of grid',
    outward.msg === '' && outward.r.carryZ < GH && outward.r.finalZ > GH && outward.r.inGrid === false &&
    outward.run < outward.fairwayRun * 0.9 && outward.run > outward.roughRun * 1.5,
    'carryZ ' + outward.r.carryZ.toFixed(2) + ' -> finalZ ' + outward.r.finalZ.toFixed(2) + ' m, run ' + outward.run.toFixed(1) +
    ' m (all fairway ' + outward.fairwayRun.toFixed(1) + ', all rough ' + outward.roughRun.toFixed(1) + ')' + outward.msg);
  // (d) 구르는 도중에 경계를 넘으면 그때부터 러프 마찰: 낮게 깔려 길게 구르는 공으로 확인
  var skim = shot(160, 4, 2500, 6.8, 0);
  var sk = crossing(skim, {});
  var rollEv = sk.r.events.filter(function (e) { return e.type === 'roll'; })[0];
  check('rolling across the grid edge switches to rough friction',
    sk.msg === '' && rollEv && Math.abs(rollEv.z) < GH && sk.r.finalZ > GH && sk.r.inGrid === false && sk.run < sk.fairwayRun - 1,
    'roll starts at z ' + (rollEv ? rollEv.z.toFixed(2) : '?') + ', rests at z ' + sk.r.finalZ.toFixed(2) + ' m, run ' + sk.run.toFixed(1) +
    ' vs all-fairway ' + sk.fairwayRun.toFixed(1) + ' m' + sk.msg);

  // 왼쪽 러프도 오른쪽과 똑같이 다룬다 (좌우 대칭): 러프에 떨어지는 공을 양쪽으로 보내 본다
  var rr = P.simulate(shot(220, 12, 2200, 6, 0)), rl = P.simulate(shot(220, 12, 2200, -6, 0));
  var sr = P.simulate(shot(220, 12, 2200, 0, 500)), sl = P.simulate(shot(220, 12, 2200, 0, -500));
  check('left rough mirrors right rough (totals equal, both out of grid)',
    Math.abs(rr.carryZ) > GH && rr.total === rl.total && rr.finalZ === -rl.finalZ && rr.inGrid === false && rl.inGrid === false &&
    groundRun(rr) < 0.5 * groundRun(r) && Math.abs(sr.carryZ) > GH && sr.total === sl.total && sr.finalZ === -sl.finalZ && sl.inGrid === false,
    'az +-6: total ' + f1(yd(rr.total)) + ' / ' + f1(yd(rl.total)) + ' yd, run ' + f1(yd(groundRun(rl))) + ' yd');

  // 바운드 중에는 바람을 받는다 (구르는 동안은 받지 않는다): 바로 땅에 떨어지는 탑볼로 지면 구간만 본다
  var topCalm = P.simulate(shot(220, -2, 2200), { gridHalfWidth: 1e6 });
  var topTail = P.simulate(shot(220, -2, 2200), { windX: 15, gridHalfWidth: 1e6 });
  var topHead = P.simulate(shot(220, -2, 2200), { windX: -15, gridHalfWidth: 1e6 });
  var topCross = P.simulate(shot(220, -2, 2200), { windZ: 15, gridHalfWidth: 1e6 });
  check('wind acts on the bounce hops (tailwind longer, headwind shorter, crosswind drifts)',
    topCalm.finalZ === 0 && topTail.total > topCalm.total * 1.1 && topHead.total < topCalm.total * 0.9 && topCross.finalZ > 5 &&
    validate(topCross, { moved: true, maxStep: MAX_STEP }) === '',
    'run ' + f1(yd(topHead.total)) + ' / ' + f1(yd(topCalm.total)) + ' / ' + f1(yd(topTail.total)) + ' yd, crosswind drift ' + f1(yd(topCross.finalZ)) + ' yd');

  // 지면·착지 후 항력 값은 실제로 쓰이고, 방향도 맞다 (값을 키우면 덜 구른다)
  function runWith(env) { return groundRun(P.simulate(LONG, env)); }
  var runDefault = runWith({});
  check('ground parameters are live and act in the right direction',
    runWith({ aero: { groundCd: 0 } }) > runDefault + 1 && runWith({ aero: { groundCd: 1 } }) < runDefault - 1 &&
    runWith({ fairway: { spinGrip: 0 } }) > runDefault + 0.5 && runWith({ fairway: { spinGrip: 1 } }) < runDefault - 1 &&
    runWith({ fairway: { rollFriction: 0.175 } }) > runDefault + 0.5 && runWith({ fairway: { rollFriction: 0.7 } }) < runDefault - 0.3 &&
    runWith({ fairway: { tangentialLoss: 0.1 } }) > runDefault + 1 && runWith({ fairway: { restitution: 0.8, restitutionMin: 0.5 } }) > runDefault + 1 &&
    runWith({ fairway: { tilt: 0 } }) !== runDefault && runWith({ fairway: { minBounce: 3 } }) !== runDefault &&
    runWith({ rough: { rollFriction: 0.1, restitution: 0.9 } }) === runDefault,
    'default run ' + f1(yd(runDefault)) + ' yd; groundCd 0 / 1: ' + f1(yd(runWith({ aero: { groundCd: 0 } }))) + ' / ' + f1(yd(runWith({ aero: { groundCd: 1 } }))) +
    ', spinGrip 0 / 1: ' + f1(yd(runWith({ fairway: { spinGrip: 0 } }))) + ' / ' + f1(yd(runWith({ fairway: { spinGrip: 1 } }))) + ' yd');

  // 지면 접촉으로 속도가 늘지 않는다: 톱스핀(음수 백스핀)이 아무리 세도, 가파르게 떨어져도 마찬가지. 뒤로 튀지도 않는다
  var energyOk = true, energyWhy = '';
  [shot(40, 25, -10000), shot(30, 30, -12000), shot(20, 40, -15000), shot(150, 8, -3000),       // 느린 공 + 센 톱스핀
    shot(220, 80, 0), shot(220, 88, 0), shot(150, 89.5, 0), shot(220, 75, 2200), shot(150, 29, 5200),
    shot(60, 50, 16000), shot(60, 60, 12000), shot(100, 50, 10000)].forEach(function (l, idx) {   // 로브 샷: 가파른 착지 + 센 백스핀
    var q = P.simulate(l, { gridHalfWidth: 1e6 });
    var contacts = q.events.filter(function (e) { return e.type === 'land' || e.type === 'bounce'; });
    for (var i = 1; i < contacts.length; i++) {
      if (contacts[i].speed > contacts[i - 1].speed) { energyOk = false; energyWhy = 'case ' + idx + ': ' + contacts.map(function (e) { return e.speed.toFixed(2); }).join(' > '); }
    }
    // 착지 직전의 수평 진행 방향 기준으로, 이후 이벤트 위치가 뒤로 가지 않는다
    var before = P.positionAt(q, q.flightTime - 0.03), land = q.events[0];
    var hx = land.x - before.x, hz = land.z - before.z, hl = Math.sqrt(hx * hx + hz * hz);
    if (hl > 1e-6) {
      for (i = 1; i < q.events.length; i++) {
        var along = ((q.events[i].x - q.events[i - 1].x) * hx + (q.events[i].z - q.events[i - 1].z) * hz) / hl;
        if (along < -1e-3) { energyOk = false; energyWhy = 'case ' + idx + ': moved back ' + along.toFixed(3) + ' m after ' + q.events[i - 1].type; }
      }
    }
    if (validate(q, { moved: true, maxStep: MAX_STEP })) { energyOk = false; energyWhy = 'case ' + idx + ': ' + validate(q, { moved: true, maxStep: MAX_STEP }); }
  });
  check('contacts never add speed or kick the ball backwards (topspin, steep landings)', energyOk, energyWhy);

  // 지면 구간에서는 뒤로 가지 않고, 정지 직전까지 서서히 느려진다 (갑자기 멈추거나 순간 이동하지 않는다)
  var smooth = true, why = '';
  [LONG, PGA, shot(220, 9.5, 2000, 1.5, 200), shot(136, 3.5, 3800), shot(150, 29, 5200)].forEach(function (l, idx) {
    var q = P.simulate(l), s = q.samples, n = q.count;
    var from = Math.ceil(q.events.filter(function (e) { return e.type === 'roll'; })[0].t / q.sampleDt) + 1;
    var prevV = Infinity;
    for (var i = from; i < n; i++) {
      var v = Math.sqrt(Math.pow(s[i * 3] - s[i * 3 - 3], 2) + Math.pow(s[i * 3 + 2] - s[i * 3 - 1], 2)) / q.sampleDt;
      if (s[i * 3] < s[i * 3 - 3] - 1e-4 || s[i * 3 + 1] !== 0 || v > prevV + 0.02) { smooth = false; why = 'case ' + idx + ' sample ' + i; }
      prevV = v;
    }
    if (prevV > 0.25) { smooth = false; why = 'case ' + idx + ' stops from ' + prevV.toFixed(2) + ' m/s'; }
  });
  check('rolling ball slows down smoothly to rest', smooth, why);
})();

// ---------------------------------------------------------------------------
section('경계 조건');
// ---------------------------------------------------------------------------
(function () {
  var ok = true, detail = [];
  [0, -3, NaN].forEach(function (v) {
    var r = P.simulate({ ballSpeed: v, launchAngle: 12, azimuth: 0, backspin: 2200, sidespin: 0 });
    var last = (r.count - 1) * 3;
    if (validate(r, {}) || r.total !== 0 || r.finalZ !== 0 || r.inGrid !== false || r.carry !== 0 ||
        r.samples[last] !== 0 || Math.abs(r.samples[last + 1] - 0.03) > 1e-6 || r.events.length !== 1) { ok = false; detail.push(String(v)); }
  });
  check('ballSpeed <= 0: ball stays on the tee (total 0, inGrid false)', ok, detail.join(','));

  ok = true; detail = [];
  [0, -0.5, -2, -10, -45, -90].forEach(function (la) {
    var r = P.simulate(shot(220, la, 2200));
    var msg = validate(r, { moved: true, maxStep: MAX_STEP });
    var hasRoll = r.events.some(function (e) { return e.type === 'roll'; });
    if (msg || r.flightTime > 0.1 || !hasRoll || r.total < 0 || (la > -45 && !(r.total > r.carry))) { ok = false; detail.push(la + ': ' + (msg || 'flight ' + r.flightTime.toFixed(3) + ' s')); }
    else detail.push(la + ':' + f1(yd(r.total)));
  });
  check('launchAngle <= 0: topped ball lands at once, then bounces / rolls', ok, detail.join('  ') + ' yd');

  // apex 는 첫 착지 전의 최고 높이다: 탑볼은 바운드가 아무리 높아도 티 높이 그대로
  var topped = P.simulate(shot(220, -10, 2200)), bounceTop = 0;
  for (var bi = 0; bi < topped.count; bi++) bounceTop = Math.max(bounceTop, topped.samples[bi * 3 + 1]);
  check('apex is the flight apex (bounces of a topped ball do not count)',
    Math.abs(topped.apex - 0.03) < 1e-9 && topped.apexX === 0 && bounceTop > 1, 'apex ' + topped.apex + ' m, highest bounce ' + bounceTop.toFixed(2) + ' m');

  // 적분 스텝은 1/240 s 보다 길어지지 않는다 (substeps 를 1 이하로 줘도 2 로 올린다)
  var fullStep = P.simulate(LONG);
  check('integration step never exceeds 1/240 s', [1, 0, -3, 0.4, 2].every(function (n) {
    var q = P.simulate(LONG, { substeps: n });
    return q.carry === fullStep.carry && q.total === fullStep.total && q.count === fullStep.count;
  }));

  ok = true; detail = [];
  [50, 70, 85, 89.9, 90].forEach(function (la) {
    var r = P.simulate(shot(220, la, 2200));
    var msg = validate(r, { moved: true, maxStep: MAX_STEP });
    if (msg || !(r.apex > 50)) { ok = false; detail.push(la + ': ' + msg); }
  });
  var up = P.simulate(shot(220, 90, 2200));
  check('very high launch angles', ok && up.total < yd(1) * 400 && Math.abs(up.finalZ) < 1e-6, detail.join(' '));
  // 수직에 가까울수록 백스핀의 마그누스 힘이 뒤쪽을 향한다: 60도는 앞에, 85도는 티 뒤에 떨어진다. 무회전 수직 발사는 제자리
  var up60 = P.simulate(shot(220, 60, 2200)), up85 = P.simulate(shot(220, 85, 2200)), upNoSpin = P.simulate(shot(220, 90, 0));
  check('near-vertical launches: backspin carries the ball back over the tee; no spin lands on the tee',
    up60.carry > 50 && up85.carry < -20 && up85.inGrid === false && Math.abs(upNoSpin.carry) < 0.01 && Math.abs(upNoSpin.total) < 0.01 && upNoSpin.apex > 100,
    '60 deg: ' + f1(up60.carry) + ' m, 85 deg: ' + f1(up85.carry) + ' m, 90 deg no spin: ' + upNoSpin.carry.toFixed(3) + ' m');

  ok = true; detail = [];
  for (var k = 0; k < 8; k++) {
    var ang = k * Math.PI / 4;
    var env = { windX: 15 * Math.cos(ang), windZ: 15 * Math.sin(ang) };
    [LONG, shot(220, 40, 5000, 5, 800), shot(120, 60, 8000, -10, -1500)].forEach(function (l) {
      var msg = validate(P.simulate(l, env), { moved: true, gridHalfWidth: 27.432, maxStep: MAX_STEP });
      if (msg) { ok = false; detail.push(k + ': ' + msg); }
    });
  }
  check('strong winds (15 m/s from 8 directions)', ok, detail.slice(0, 3).join(' '));

  // 극단값 격자: 속도 x 발사각 x 스핀 x 바람(두 축 +-15 m/s) x 공기 밀도
  ok = true; detail = [];
  var gridCount = 0, longest2 = 0;
  [0, -5, 0.5, 40, 120].forEach(function (v) {
    [-5, 0, 60, 89].forEach(function (la) {
      [0, 12000].forEach(function (spin) {
        [[15, 0], [-15, 0], [0, 15], [0, -15], [15, -15], [-15, 15]].forEach(function (w) {
          [0.9, 1.3].forEach(function (rho) {
            var l = { ballSpeed: v, launchAngle: la, azimuth: (gridCount % 5) - 2, backspin: spin, sidespin: gridCount % 2 ? 600 : -600 };
            var e = { windX: w[0], windZ: w[1], airDensity: rho };
            if (gridCount % 3 === 0) e.windProfile = { base: 0.5, scale: 50, min: 0.5, max: 2.0 };
            gridCount++;
            var q, msg;
            try {
              q = P.simulate(l, e);
              msg = validate(q, { moved: v > 0, gridHalfWidth: 27.432, maxStep: MAX_STEP });
              if (!msg && v <= 0 && (q.total !== 0 || q.inGrid !== false)) msg = 'should stay on the tee';
              if (!msg && q.duration > longest2) longest2 = q.duration;
            } catch (err) { msg = 'threw ' + err.message; }
            if (msg) { ok = false; detail.push(JSON.stringify(l) + ' ' + JSON.stringify(e) + ': ' + msg); }
          });
        });
      });
    });
  });
  check(gridCount + ' extreme combinations (speed 0..120 m/s, launch -5..89 deg, spin 0 / 12000 rpm, wind +-15 m/s, density 0.9 / 1.3)',
    ok && longest2 < 30, ok ? 'longest ' + longest2.toFixed(1) + ' s' : detail.slice(0, 2).join(' | '));

  // 멈추지 않는 지면 -> 40 s 에서 강제 종료
  var endless = P.simulate(shot(220, -2, 2200), { fairway: { rollFriction: 0, minBounce: 50 }, aero: { groundCd: 0 }, gridHalfWidth: 1e6 });
  check('simulated time is capped at 40 s', validate(endless, { moved: true }) === '' && endless.duration === 40 && endless.count === 4801,
    'duration ' + endless.duration + ' s, total ' + f1(yd(endless.total)) + ' yd');
  // 40 s 가 됐을 때 아직 떠 있는 공(끝없이 튀는 지면): 그 자리에서 지면으로 내려 세운다. 유한한 값, 마지막 샘플 y = 0
  var bouncy = P.simulate(shot(220, 45, 2200),
    { fairway: { restitution: 0.95, restitutionMin: 0.95, minBounce: 0.05, tangentialLoss: 0, impactFriction: 0, rollFriction: 0 }, aero: { groundCd: 0 }, gridHalfWidth: 1e6 });
  check('a ball still bouncing at 40 s is stopped there', validate(bouncy, { moved: true }) === '' && bouncy.duration === 40 && bouncy.count === 4801 &&
    bouncy.events.some(function (e) { return e.type === 'bounce'; }), validate(bouncy, { moved: true }));

  // 안전 범위를 넘는 입력은 잘라 쓴다 (문서화된 한도: 볼 스피드 150 m/s, 스핀 +-20000 rpm, 바람 +-50 m/s, 발사각 +-90 deg, 공기 밀도 0~5)
  var b12 = { ballSpeed: 60, launchAngle: 20, azimuth: 0, backspin: 2000, sidespin: 0 };
  function withField(o, key, v) { var c = {}; Object.keys(o).forEach(function (kk) { c[kk] = o[kk]; }); c[key] = v; return c; }
  check('out-of-range inputs are clamped to the documented limits',
    sameResult(P.simulate(withField(b12, 'ballSpeed', 1e9)), P.simulate(withField(b12, 'ballSpeed', 150))) &&
    sameResult(P.simulate(withField(b12, 'backspin', 1e7)), P.simulate(withField(b12, 'backspin', 20000))) &&
    sameResult(P.simulate(withField(b12, 'sidespin', -1e7)), P.simulate(withField(b12, 'sidespin', -20000))) &&
    sameResult(P.simulate(withField(b12, 'launchAngle', 500)), P.simulate(withField(b12, 'launchAngle', 90))) &&
    sameResult(P.simulate(withField(b12, 'launchAngle', -500)), P.simulate(withField(b12, 'launchAngle', -90))) &&
    sameResult(P.simulate(b12, { windX: 1e6, windZ: -1e6 }), P.simulate(b12, { windX: 50, windZ: -50 })) &&
    sameResult(P.simulate(b12, { airDensity: 99 }), P.simulate(b12, { airDensity: 5 })) &&
    sameResult(P.simulate(b12, { airDensity: -4 }), P.simulate(b12, { airDensity: 0 })));
  // 숫자가 아닌 발사 값은 0 으로 본다 (볼 스피드가 그러면 공은 티에 남는다)
  check('non-numeric launch fields fall back to 0',
    ['launchAngle', 'azimuth', 'backspin', 'sidespin'].every(function (key) {
      return [NaN, undefined, 'x', null, Infinity].every(function (j) {
        return sameResult(P.simulate(withField(b12, key, j)), P.simulate(withField(b12, key, 0)));
      });
    }) && P.simulate(withField(b12, 'ballSpeed', '60')).total === 0);

  var longest = 0;
  [LONG, PGA, shot(220, 45, 2200), shot(220, 90, 2200), shot(220, 12, 2200, 0, 0)].forEach(function (l) {
    longest = Math.max(longest, P.simulate(l, { windX: 15 }).duration);
  });
  check('normal shots finish well inside the cap', longest < 30, 'longest ' + longest.toFixed(1) + ' s');
})();

// ---------------------------------------------------------------------------
section('샘플 · positionAt');
// ---------------------------------------------------------------------------
(function () {
  var list = [PGA, LPGA, IRON6, LONG, shot(220, 12, 2200, 3, 500), shot(240, 9, 1800), shot(220, -2, 2200)];
  var worst = 0, ok = true, exact = true;
  list.forEach(function (l) {
    var r = P.simulate(l, { windX: 3, windZ: -2 });
    worst = Math.max(worst, maxSampleStep(r));
    if (validate(r, { moved: true })) ok = false;
    var last = (r.count - 1) * 3;
    if (r.samples[last] !== r.total || r.samples[last + 1] !== 0 || r.samples[last + 2] !== r.finalZ) exact = false;
  });
  check('sample continuity (max step <= ' + MAX_STEP.toFixed(3) + ' m)', ok && worst <= MAX_STEP, 'worst ' + worst.toFixed(3) + ' m');
  check('last sample equals (total, 0, finalZ)', exact);

  var r = P.simulate(shot(220, 12, 2200, 1.5, 250), { windZ: 2 });
  var dt = r.sampleDt, s = r.samples;
  var p0 = P.positionAt(r, 0), pNeg = P.positionAt(r, -3), pNan = P.positionAt(r, NaN);
  check('positionAt: t <= 0 -> start position',
    p0.x === 0 && Math.abs(p0.y - 0.03) < 1e-6 && p0.z === 0 && p0.phase === 'air' && pNeg.x === 0 && pNeg.phase === 'air' && pNan.x === 0);
  var pEnd = P.positionAt(r, r.duration), pAfter = P.positionAt(r, r.duration + 100);
  check('positionAt: t >= duration -> rest position, phase "rest"',
    pEnd.x === r.total && pEnd.y === 0 && pEnd.z === r.finalZ && pEnd.phase === 'rest' && pAfter.x === r.total && pAfter.phase === 'rest');
  var k = 300, mid = P.positionAt(r, (k + 0.5) * dt), at = P.positionAt(r, k * dt);
  check('positionAt: linear interpolation between samples',
    Math.abs(at.x - s[k * 3]) < 1e-4 && Math.abs(at.y - s[k * 3 + 1]) < 1e-4 && Math.abs(at.z - s[k * 3 + 2]) < 1e-4 &&
    Math.abs(mid.x - (s[k * 3] + s[k * 3 + 3]) / 2) < 1e-4 && Math.abs(mid.y - (s[k * 3 + 1] + s[k * 3 + 4]) / 2) < 1e-4 &&
    Math.abs(mid.z - (s[k * 3 + 2] + s[k * 3 + 5]) / 2) < 1e-4);
  var before = P.positionAt(r, r.flightTime - 0.01), after = P.positionAt(r, r.flightTime + 0.01);
  var lateGround = P.positionAt(r, r.duration - 0.01);
  check('positionAt: phase air -> ground -> rest', before.phase === 'air' && after.phase === 'ground' && lateGround.phase === 'ground');
  // 이벤트 위치가 보간 궤적 위에 있는지 (착지점)
  var atLand = P.positionAt(r, r.flightTime);
  check('landing event sits on the sampled path', Math.abs(atLand.x - r.carry) < 0.05 && Math.abs(atLand.z - r.carryZ) < 0.05 && atLand.y < 0.2);
  var hi = 0, hiX = 0;
  for (var i = 0; i * dt <= r.flightTime; i++) if (s[i * 3 + 1] > hi) { hi = s[i * 3 + 1]; hiX = s[i * 3]; }
  check('apex / apexX match the samples', Math.abs(hi - r.apex) < 1e-3 && Math.abs(hiX - r.apexX) < 1.0);

  // 경계 시각들: 정확히 flightTime, 구르는 중, 정지 직전 / 직후, 이상한 t
  var rollEvent = r.events.filter(function (e) { return e.type === 'roll'; })[0];
  var tRoll = (rollEvent.t + r.duration) / 2, pRoll = P.positionAt(r, tRoll);
  var justBefore = P.positionAt(r, r.duration - 1e-9), inf = P.positionAt(r, Infinity), negInf = P.positionAt(r, -Infinity);
  check('positionAt: exactly flightTime is "ground"; rolling stays on the ground between the roll point and rest',
    atLand.phase === 'ground' && P.positionAt(r, r.flightTime - 1e-9).phase === 'air' &&
    pRoll.phase === 'ground' && pRoll.y === 0 && pRoll.x > rollEvent.x && pRoll.x < r.total &&
    justBefore.phase === 'ground' && Math.abs(justBefore.x - r.total) < 1e-3 &&
    inf.phase === 'rest' && inf.x === r.total && negInf.x === 0 && negInf.phase === 'air');
  // positionAt 은 어떤 t 에서도 유한한 값을 주고, 시간이 가면 지나온 경로를 그대로 따라간다
  var okPath = true, prevX = -1;
  for (var tt = -0.5; tt <= r.duration + 0.5; tt += 0.0173) {
    var q = P.positionAt(r, tt);
    if (!isFinite(q.x) || !isFinite(q.y) || !isFinite(q.z) || q.y < 0 || q.x < prevX - 1e-6 || ['air', 'ground', 'rest'].indexOf(q.phase) < 0) okPath = false;
    prevX = q.x;
  }
  check('positionAt: finite, non-negative height, never moves backwards downrange', okPath);
  // 티에 그대로 있는 공
  var tee = P.simulate({ ballSpeed: 0, launchAngle: 12, azimuth: 0, backspin: 2200, sidespin: 0 });
  var tee0 = P.positionAt(tee, 0), tee1 = P.positionAt(tee, 5);
  check('positionAt: a ball left on the tee stays at the tee position',
    tee0.x === 0 && tee0.z === 0 && Math.abs(tee0.y - 0.03) < 1e-6 && tee1.x === 0 && tee1.z === 0 && Math.abs(tee1.y - 0.03) < 1e-6 && tee1.phase === 'rest');
})();

// ---------------------------------------------------------------------------
section('적분 스텝 안정성 · 속도');
// ---------------------------------------------------------------------------
(function () {
  var worst = 0;
  [[PGA, {}], [LPGA, {}], [IRON6, {}], [LONG, {}], [shot(220, 12, 2200, 2, 400), { windX: -5, windZ: 3 }]].forEach(function (c) {
    var a = P.simulate(c[0], Object.assign({ substeps: 2 }, c[1]));
    var b = P.simulate(c[0], Object.assign({ substeps: 4 }, c[1]));
    worst = Math.max(worst, Math.abs(a.carry - b.carry) / b.carry, Math.abs(a.total - b.total) / b.total);
  });
  check('halving the step changes carry by < 0.3%', worst < 0.003, 'worst relative change ' + worst.toExponential(2));

  var i, n = 400, sum = 0;
  function varied(j) {
    return shot(195 + (j % 30), 9 + (j % 8), 1900 + (j % 10) * 90, (j % 7) - 3, (j % 9) * 80 - 320);
  }
  for (i = 0; i < 60; i++) sum += P.simulate(varied(i), { windX: (i % 5) - 2 }).total;   // 워밍업
  var t0 = process.hrtime();
  for (i = 0; i < n; i++) sum += P.simulate(varied(i), { windX: (i % 5) - 2, windZ: (i % 3) - 1 }).total;
  var d = process.hrtime(t0);
  var avgMs = (d[0] * 1e3 + d[1] / 1e6) / n;
  check('average simulate() time well under 2 ms', avgMs < 2 && isFinite(sum), avgMs.toFixed(3) + ' ms per call');

  // 가장 오래 걸리는 호출: 오래 뜨는 공(강한 순풍 · 높은 탄도)과 40 s 상한까지 가는 지면 설정. 여유 있는 한도만 건다
  function timeOf(launch, env) {
    var best = Infinity;
    for (var k = 0; k < 3; k++) {
      var t1 = process.hrtime();
      P.simulate(launch, env);
      var dd = process.hrtime(t1);
      best = Math.min(best, dd[0] * 1e3 + dd[1] / 1e6);
    }
    return best;
  }
  var slowest = Math.max(
    timeOf({ ballSpeed: 150, launchAngle: 60, azimuth: 0, backspin: 2200, sidespin: 0 }, { windX: 15, airDensity: 0.9 }),
    timeOf(shot(220, 45, 2200), { fairway: { restitution: 0.95, restitutionMin: 0.95, minBounce: 0.05, tangentialLoss: 0, impactFriction: 0, rollFriction: 0 }, aero: { groundCd: 0 } }),
    timeOf(shot(220, -2, 2200), { fairway: { rollFriction: 0, minBounce: 50 }, aero: { groundCd: 0 }, gridHalfWidth: 1e6 }));
  check('worst-case simulate() time stays small (long hang time, 40 s cap)', slowest < 15, slowest.toFixed(3) + ' ms');
})();

// ---------------------------------------------------------------------------
// 응답표 (선택)
// ---------------------------------------------------------------------------
if (process.argv.indexOf('--table') >= 0) {
  var printTable = function (title, extraEnv) {
    section(title);
    [9.5, 12.5, 15.5].forEach(function (la) {
      [2000, 2300, 2650].forEach(function (sp) {
        var cells = [0, -3, 3].map(function (w) {
          var r = P.simulate(shot(220, la, sp), Object.assign({ windX: w }, extraEnv));
          return lpad(f1(yd(r.carry)), 6) + ' /' + lpad(f1(yd(r.total)), 6);
        });
        console.log('  ' + lpad(la.toFixed(1), 5) + ' deg ' + lpad(sp, 5) + ' rpm   ' + cells.join('   |  '));
      });
    });
  };
  printTable('응답표: 볼 스피드 220 mph, 캐리/총거리 yd (무풍 | 맞바람 3 m/s | 순풍 3 m/s), 높이와 무관한 바람', {});
  printTable('응답표: 같은 조건, 게임의 높이별 바람 배율 windProfile { base 0.5, scale 50, min 0.5, max 2 }',
    { windProfile: { base: 0.5, scale: 50, min: 0.5, max: 2.0 } });

  // 좌우 편차표: 220 mph, 12.5 deg, 2300 rpm. 착지 지점 / 정지 지점의 z (yd), 그리고 그리드(좌우 30 yd) 안에 멈췄는지
  var lateralRow = function (label, r) {
    console.log('  ' + pad(label, 12) + lpad(f1(yd(r.carryZ)), 7) + ' /' + lpad(f1(yd(r.finalZ)), 6) + '    carry ' + f1(yd(r.carry)) + '  total ' + f1(yd(r.total)) +
      '  ' + (r.inGrid ? 'in grid' : 'OUT'));
  };
  section('좌우 편차: 사이드스핀 (무풍) - 착지 z / 정지 z (yd)');
  [0, 150, 300, 450, 600].forEach(function (ss) { lateralRow(ss + ' rpm', P.simulate(shot(220, 12.5, 2300, 0, ss))); });
  section('좌우 편차: 옆바람 (높이와 무관한 바람) - 착지 z / 정지 z (yd)');
  [0, 2, 4, 6].forEach(function (w) { lateralRow(w + ' m/s', P.simulate(shot(220, 12.5, 2300), { windZ: w })); });
  section('좌우 편차: 옆바람 (게임의 높이별 바람 배율) - 착지 z / 정지 z (yd)');
  [0, 2, 4, 6].forEach(function (w) {
    lateralRow(w + ' m/s', P.simulate(shot(220, 12.5, 2300), { windZ: w, windProfile: { base: 0.5, scale: 50, min: 0.5, max: 2.0 } }));
  });
}

console.log('\n' + (failures === 0 ? 'OK' : 'FAILED') + ': ' + (checks - failures) + '/' + checks + ' checks passed');
process.exit(failures === 0 ? 0 : 1);
