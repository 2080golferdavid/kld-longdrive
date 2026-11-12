/*
 * 게이지 · 샷 모델 · 바람 · 대회 진행 · 저장의 불변식 테스트 — node tests/shot.test.js
 * 난이도 숫자(CPU 능력)에 기대지 않는 것만 확인한다. 난이도는 tests/balance.js 가 본다.
 */
'use strict';
var path = require('path');
var JS = path.join(__dirname, '..', 'js');

// 저장 테스트용 가짜 localStorage (storage.js 를 불러오기 전에 설치)
var store = {};
globalThis.localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem: function (k, v) { store[k] = String(v); },
  removeItem: function (k) { delete store[k]; }
};
globalThis.KLD = {};
['config', 'i18n', 'px', 'physics', 'shot', 'tournament', 'storage'].forEach(function (f) { require(path.join(JS, f + '.js')); });

var KLD = globalThis.KLD, S = KLD.shot, PH = KLD.physics, TN = KLD.tournament, C = KLD.config, ST = KLD.storage;
var YD = 0.9144;
var pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else { fail++; console.log('  FAIL  ' + name + (detail ? '  -> ' + detail : '')); }
}
function near(a, b, tol) { return Math.abs(a - b) <= tol; }
function half() { return 0.5; }

// 노이즈 없는 샷 (테스트 동안만 노이즈를 0으로)
function cleanShot(p, e, traj, wx, wz, aim) {
  var saved = C.shot.noise;
  C.shot.noise = { launch: 0, spin: 0, azimuth: 0, speed: 0 };
  var b = S.buildLaunch({ power: p, e: e, aim: aim || 0, traj: traj || 'mid' }, half);
  C.shot.noise = saved;
  var r = PH.simulate(b.launch, S.env({ x: wx || 0, z: wz || 0 }));
  return { b: b, r: r, yd: r.total / YD, side: r.finalZ / YD };
}

// ── 1. 파워 게이지 커서 ───────────────────────────────────
(function () {
  var g = C.gauge;
  check('커서는 0에서 시작', S.powerCursor(0, 1).p === 0);
  var prev = -1, mono = true, t;
  for (t = 0; t < S.timeToPower(1) - 0.001; t += 0.005) {
    var p = S.powerCursor(t, 1).p;
    if (p < prev - 1e-9) mono = false;
    prev = p;
  }
  check('첫 상승은 단조 증가', mono);
  var okInv = true;
  [0.05, 0.12, 0.3, 0.6, 0.9, 0.97, 1.0].forEach(function (x) {
    if (!near(S.powerCursor(S.timeToPower(x), 1.08).p, x, 1e-6)) okInv = false;
  });
  check('timeToPower 는 powerCursor 의 역함수', okInv);
  var peak1 = 0, peak2 = 0;
  for (t = 0; t < 3; t += 0.001) { peak1 = Math.max(peak1, S.powerCursor(t, 1).p); peak2 = Math.max(peak2, S.powerCursor(t, g.overMax).p); }
  check('레드존이 없으면 100%에서 튕긴다', peak1 <= 1 + 1e-9 && peak1 > 0.995, String(peak1));
  check('레드존이 있으면 overMax 까지 오른다', peak2 <= g.overMax + 1e-9 && peak2 > g.overMax - 0.005, String(peak2));
  var tDone = S.timeToPower(1) + (g.powerCycles * 2 - 1) * (1 / g.powerRate) + 0.05;
  check('정해진 왕복 뒤에는 done', S.powerCursor(tDone, 1).done === true && S.powerCursor(tDone - 0.2, 1).done === false);
  check('등속 구간 속도 = powerRate', near((S.powerCursor(0.9, 1).p - S.powerCursor(0.8, 1).p) / 0.1, g.powerRate, 1e-6));
})();

// ── 2. 판정 창 ───────────────────────────────────────────
(function () {
  var g = C.gauge;
  check('구간 구분', S.zoneOf(0.5) === 'safe' && S.zoneOf(g.fullFrom) === 'full' && S.zoneOf(1.0) === 'full' && S.zoneOf(1.04) === 'over');
  check('구간별 창(ms)', S.windowMs(0.5) === g.windowMs.safe && S.windowMs(0.95) === g.windowMs.full && S.windowMs(1.05) === g.windowMs.over);
  check('창은 파워가 높을수록 좁다', g.windowMs.safe > g.windowMs.full && g.windowMs.full > g.windowMs.over);
  check('배율 적용', near(S.windowMs(0.95, 1.5), g.windowMs.full * 1.5, 1e-9));
  check('windowHalf = ms / 통과 시간', near(S.windowHalf(0.95), g.windowMs.full / 1000 / g.sweepSec, 1e-12));
  check('스위트스팟에서 오차 0', near(S.impactError(g.sweetPos, 0.95), 0, 1e-12));
  check('늦으면 +, 빠르면 -', S.impactError(g.sweetPos + 0.05, 0.95) > 0 && S.impactError(g.sweetPos - 0.05, 0.95) < 0);
  // FULL 구간에서 50ms 늦게 치면 e = 0.5
  var u = g.sweetPos + 0.050 / g.sweepSec;
  check('50ms 늦음 = e 0.5 (FULL)', near(S.impactError(u, 0.95), 50 / g.windowMs.full, 1e-9));
  check('등급 경계', S.judge(g.perfect) === 'perfect' && S.judge(-g.great) === 'great' && S.judge(g.good) === 'good' && S.judge(g.good + 0.01) === 'miss');
  check('스위트스팟 뒤에 MISS 판정이 들어갈 자리가 있다', (1 - g.sweetPos) >= S.windowHalf(1.0) * 1.0);
})();

// ── 3. 샷 모델 ───────────────────────────────────────────
(function () {
  var a = S.buildLaunch({ power: 1, e: 0, aim: 0, traj: 'mid' }, Math.random);
  var b = S.buildLaunch({ power: 1, e: 0, aim: 0, traj: 'mid' }, Math.random);
  check('PERFECT 는 노이즈가 없다 (같은 입력 = 같은 결과)', a.launch.ballSpeed === b.launch.ballSpeed && a.launch.azimuth === b.launch.azimuth && a.launch.backspin === b.launch.backspin);
  check('PERFECT 스매시 = 1.50', near(a.smash, 1.5, 0.002), a.smash.toFixed(4));
  check('파워 100% 헤드 스피드 = 설정값', near(a.clubSpeedMph, C.player.clubSpeedMaxMph, 1e-9));
  var o = S.buildLaunch({ power: C.gauge.overMax, e: 0, aim: 0, traj: 'mid' }, half);
  check('레드존 끝에서 헤드 스피드 +4%', near(o.clubSpeedMph / C.player.clubSpeedMaxMph, 1 + C.gauge.overSpeedPerUnit * (C.gauge.overMax - 1), 1e-9));
  check('스매시는 하한 아래로 내려가지 않는다', S.buildLaunch({ power: 1, e: 1.5, aim: 0, traj: 'mid' }, half).smash >= C.shot.smashFloor * 0.69);
  check('심한 미스는 탑볼/뽕샷', S.buildLaunch({ power: 1, e: -1.5 }, half).kind === 'top' && S.buildLaunch({ power: 1, e: 1.5 }, half).kind === 'sky');
  check('e 는 ±1.5 로 잘린다', S.buildLaunch({ power: 1, e: -9 }, half).e === -1.5 && S.buildLaunch({ power: 1, e: 9 }, half).e === 1.5);
  check('vmax 를 주면 그 선수 스피드 기준', near(S.buildLaunch({ power: 1, e: 0, vmax: 140 }, half).clubSpeedMph, 140, 1e-9));
  check('spinScale 0 이면 사이드스핀 0', S.buildLaunch({ power: 1, e: 0.7, spinScale: 0 }, half).launch.sidespin === 0);

  var perfect = cleanShot(1, 0);
  check('풀파워 정타는 그리드 안, 400야드 이상', perfect.r.inGrid && perfect.yd > 400 && perfect.yd < 425, perfect.yd.toFixed(1));
  check('레드존 정타가 더 멀리 간다 (+10야드 이상)', cleanShot(C.gauge.overMax, 0).yd > perfect.yd + 10);
  check('파워 90%는 100%보다 15야드 이상 짧다', cleanShot(0.9, 0).yd < perfect.yd - 15);
  // 등급이 결과를 약속한다: 무풍·조준 0 에서 GOOD 까지는 그리드 안
  var okGrid = true, detail = '';
  [1.0, C.gauge.overMax, 0.92].forEach(function (p) {
    [-C.gauge.good, C.gauge.good, -C.gauge.great, C.gauge.great].forEach(function (e) {
      var s = cleanShot(p, e);
      if (!s.r.inGrid) { okGrid = false; detail += ' p' + p + ' e' + e + ' side ' + s.side.toFixed(1); }
    });
  });
  check('GOOD 까지는 그리드 안 (무풍·조준 0)', okGrid, detail);
  check('큰 미스(|e| 1.2)는 OB', !cleanShot(1, 1.2).r.inGrid && !cleanShot(1, -1.2).r.inGrid);
  check('늦으면 오른쪽, 빠르면 왼쪽', cleanShot(1, 0.6).side > 5 && cleanShot(1, -0.6).side < -5);
  check('드로우(빠름)가 페이드(늦음)보다 멀리 간다', cleanShot(1, -0.5).yd > cleanShot(1, 0.5).yd);
  check('조준 +2도는 오른쪽으로', cleanShot(1, 0, 'mid', 0, 0, 2).side > 8);
})();

// ── 4. 탄도와 바람 ────────────────────────────────────────
(function () {
  function tot(tr, wx) { return cleanShot(1, 0, tr, wx, 0).yd; }
  check('맞바람 4m/s: 저 > 중 > 고', tot('low', -4) > tot('mid', -4) + 5 && tot('mid', -4) > tot('high', -4) + 5,
    [tot('low', -4), tot('mid', -4), tot('high', -4)].map(function (v) { return v.toFixed(0); }).join('/'));
  check('순풍 4m/s: 고 > 중 > 저', tot('high', 4) > tot('mid', 4) + 4 && tot('mid', 4) > tot('low', 4) + 5,
    [tot('low', 4), tot('mid', 4), tot('high', 4)].map(function (v) { return v.toFixed(0); }).join('/'));
  var calm = [tot('low', 0), tot('mid', 0), tot('high', 0)];
  check('무풍: 세 탄도 차이 6야드 이내', Math.max.apply(null, calm) - Math.min.apply(null, calm) <= 6, calm.map(function (v) { return v.toFixed(1); }).join('/'));
  check('순풍이 셀수록 멀리', tot('mid', 2) > tot('mid', 0) + 8 && tot('mid', 4) > tot('mid', 2) + 8);
  [1, 2.5, 4].forEach(function (z) {
    var s = cleanShot(1, 0, 'mid', 0, z, S.idealAim(z));
    check('idealAim 이 옆바람 ' + z + 'm/s 를 상쇄 (±8야드)', Math.abs(s.side) <= 8, s.side.toFixed(1));
    check('옆바람 ' + z + 'm/s 는 오른쪽으로 민다', cleanShot(1, 0, 'mid', 0, z, 0).side > 3);
  });

  // 바람 생성기
  var rand = KLD.px.rng(42);
  var w = S.createWind(C.rounds[3], rand);
  var okFinite = true, okInfo = true, sawIncoming = false, sawActive = false, maxDev = 0, t, v;
  for (t = 0; t < 400; t += 0.37) {
    v = w.at(t);
    if (!isFinite(v.x) || !isFinite(v.z)) okFinite = false;
    if (v.gust) {
      if (v.gust.phase === 'incoming') { sawIncoming = true; if (!(v.gust.eta > 0 && v.gust.eta <= S.GUST.forecast + 1e-9)) okInfo = false; }
      else if (v.gust.phase === 'active') { sawActive = true; if (!(v.gust.remain > 0 && v.gust.remain <= S.GUST.rise + S.GUST.hold + 1e-9)) okInfo = false; }
      else okInfo = false;
    }
    maxDev = Math.max(maxDev, Math.abs(v.x - C.rounds[3].wind.baseX));
  }
  check('바람 값은 항상 유한', okFinite);
  check('돌풍 예고·진행 정보가 범위 안', okInfo && sawIncoming && sawActive);
  check('돌풍 세기가 설정 범위 안', maxDev <= C.rounds[3].gust.ax + 0.4, maxDev.toFixed(2));
  var again = S.createWind(C.rounds[3], KLD.px.rng(42));
  check('같은 시드면 같은 바람', again.at(123.4).x === w.at(123.4).x && again.at(7).z === w.at(7).z);
  check('at(t) 는 호출 순서와 무관하게 같은 값', w.at(50).x === w.at(50).x && near(w.at(10).x, S.createWind(C.rounds[3], KLD.px.rng(42)).at(10).x, 1e-12));
  var calmW = S.createWind(C.rounds[0], KLD.px.rng(1));
  var noGust = true, dev = 0;
  for (t = 0; t < 200; t += 0.5) { v = calmW.at(t); if (v.gust) noGust = false; dev = Math.max(dev, Math.abs(v.x - C.rounds[0].wind.baseX)); }
  check('돌풍 없는 라운드는 잔물결만 (±0.35 이내)', noGust && dev <= 0.35, dev.toFixed(2));
  var t0 = Date.now();
  var far = w.at(36000);
  check('아주 먼 시각도 금방 계산된다', isFinite(far.x) && Date.now() - t0 < 500, (Date.now() - t0) + 'ms');
})();

// ── 4b. 돌풍 예고 ────────────────────────────────────────
(function () {
  // 돌풍이 불기 전 forecast 초 동안은 줄곧 예고가 떠 있어야 한다 (앞 돌풍이 잦아드는 중이어도)
  var rc = null;
  C.rounds.forEach(function (r) { if (r.gust && !rc) rc = r; });
  var worst = 99, starts = 0, bad = 0;
  for (var seed = 1; seed <= 12; seed++) {
    var w = S.createWind(rc, KLD.px.rng(seed)), prev = null, lead = 0, dt = 0.05;
    for (var tt = 0; tt < 150; tt += dt) {
      var gi = w.at(tt).gust;
      if (gi && gi.phase === 'incoming') lead += dt;
      else if (gi && gi.phase === 'active') {
        if (!prev || prev.phase !== 'active' || gi.remain > prev.remain + 0.5) {    // 새 돌풍이 시작된 순간
          starts++;
          if (tt > S.GUST.forecast + 0.1) { worst = Math.min(worst, lead); if (lead < S.GUST.forecast - 0.15) bad++; }
        }
        lead = 0;
      } else lead = 0;
      prev = gi;
    }
  }
  check('돌풍은 항상 ' + S.GUST.forecast + '초 전부터 예고된다', starts > 50 && bad === 0, 'starts ' + starts + ', bad ' + bad + ', 가장 짧은 예고 ' + worst.toFixed(2) + 's');
})();

// ── 5. 대회 진행 ─────────────────────────────────────────
(function () {
  function newT(seed) { return TN.create(seed); }
  function prep(T) { return TN.prepareRound(T, S.createWind(TN.roundConfig(T), T.rand)); }

  // (a) 매번 크게 이기면 4라운드 뒤 우승
  var T = newT(7), R, out, i;
  for (i = 0; i < C.rounds.length; i++) {
    R = prep(T);
    // 넘어야 할 기록 = 예선은 CPU 8위 기록, 매치는 상대 세트의 인정된 공 중 최장 (상대가 전부 놓치면 0)
    var expect = 0;
    if (R.type === 'match') R.oppSet.balls.forEach(function (bb) { if (bb.valid && bb.total > expect) expect = bb.total; });
    else expect = R.cpuSets.map(function (cs) { return cs.best; }).sort(function (x, y) { return y - x; })[TN.ADVANCE - 1] || 0;
    check('라운드 ' + i + ' 준비: 넘어야 할 기록이 규칙대로다', R.target >= 0 && R.target === expect, R.target + ' vs ' + expect);
    out = TN.finishRound(T, R, 500);
    check('라운드 ' + i + ' 통과', out.advanced === true);
    if (i < C.rounds.length - 1) { check('아직 우승 아님', !out.champion); TN.advance(T); }
  }
  check('마지막 라운드를 이기면 우승', out.champion === true && out.finalRank === 1);
  check('대진 라운드 수 4-2-1', T.bracket.rounds.length === 3 && T.bracket.rounds[0].length === 4 && T.bracket.rounds[1].length === 2 && T.bracket.rounds[2].length === 1);
  check('로그는 라운드마다 하나', T.log.length === C.rounds.length);
  check('예선 1위는 8번 시드를 만난다', (function () {
    var m = T.bracket.rounds[0][0];
    return (m.a.isPlayer && m.a.seed === 1 && m.b.seed === 8);
  })());

  // (b) 예선에서 기록이 없으면 탈락
  T = newT(8); R = prep(T);
  out = TN.finishRound(T, R, 0);
  check('예선 무기록은 탈락', out.advanced === false && T.bracket === null && out.rank >= 1 && out.rank <= C.cpu.length + 1);
  check('예선 순위표는 CPU 전원 + 플레이어', out.entries.length === C.cpu.length + 1);

  // (c) 컷 라인 바로 위는 통과, 바로 아래는 탈락
  T = newT(9); R = prep(T);
  var cut = R.target;
  check('컷보다 길면 통과', TN.fieldStanding(R, cut + 0.01).rank <= TN.ADVANCE);
  check('컷보다 짧으면 탈락권', TN.fieldStanding(R, cut - 0.01).rank > TN.ADVANCE);

  // (d) 8강에서 지고 → 되돌리고 → 이기면 정상 진행
  T = newT(10); R = prep(T); TN.finishRound(T, R, 500); TN.advance(T);
  R = prep(T);
  out = TN.finishRound(T, R, 1);
  check('짧은 기록은 패배', out.advanced === false && out.finalRank === 5);
  var logLen = T.log.length;
  TN.undoRound(T, R);
  check('되돌리면 로그가 하나 줄고 다음 대진이 지워진다', T.log.length === logLen - 1 && T.bracket.rounds.length === 1);
  R = prep(T);
  out = TN.finishRound(T, R, 500);
  check('재도전에서 이기면 통과하고 4강 대진이 생긴다', out.advanced === true && T.bracket.rounds[1] && T.bracket.rounds[1].length === 2);
  TN.advance(T);
  var cm = TN.currentMatch(T);
  check('4강에 플레이어가 있다', !!cm && !!cm.opponent);

  // (e) 둘 다 기록이 없으면 재경기 (상태는 그대로)
  T = newT(11); R = prep(T); TN.finishRound(T, R, 500); TN.advance(T);
  R = prep(T);
  R.oppSet.best = 0; R.oppSet.balls.forEach(function (b) { b.valid = false; });
  logLen = T.log.length;
  out = TN.finishRound(T, R, 0);
  check('둘 다 무기록이면 재경기', out.rematch === true && out.advanced === false && T.log.length === logLen && T.bracket.rounds.length === 1);

  // (f) 동률이면 플레이어 승
  T = newT(12); R = prep(T); TN.finishRound(T, R, 500); TN.advance(T);
  R = prep(T);
  out = TN.finishRound(T, R, R.oppSet.best);
  check('동률이면 플레이어 승', out.advanced === true);

  check('본선 진출 인원은 8명으로 고정 (8강 대진)', TN.ADVANCE === 8 && C.cpu.length >= TN.ADVANCE - 1);

  // (g) 무작위로 많이 돌려도 예외·이상 값이 없다
  var bad = '', n = 0;
  try {
    for (var seed = 100; seed < 220; seed++) {
      T = newT(seed);
      var rr = KLD.px.rng(seed * 7 + 1), alive = true, cont = 1;
      while (alive) {
        R = prep(T);
        var best = rr() < 0.15 ? 0 : (330 + rr() * 140) * YD;
        out = TN.finishRound(T, R, best);
        n++;
        if (out.rematch) continue;
        if (!(out.type === 'field' ? out.rank >= 1 : true)) bad = 'rank';
        if (out.advanced) { if (out.champion) break; TN.advance(T); }
        else if (cont > 0) { cont--; TN.undoRound(T, R); }
        else alive = false;
        if (T.roundIndex >= C.rounds.length) { bad = 'roundIndex overflow'; break; }
      }
    }
  } catch (err) { bad = String(err && err.stack || err); }
  check('무작위 대회 120판 (' + n + ' 라운드) 무사 통과', bad === '', bad);
})();

// ── 6. 저장 ─────────────────────────────────────────────
(function () {
  store = {};
  var d = ST.load();
  check('기본 설정', d.settings.unit === 'yd' && d.settings.lang === 'ko' && d.ranking.length === 0);
  var a = ST.addRanking('가나다', 350, 2), b = ST.addRanking('<b>x</b>  ', 380, 4), c = ST.addRanking('', 300, 0);
  // rank 는 넣는 순간의 순위다
  check('기록은 거리순', ST.get().ranking[0].m === 380 && a.rank === 1 && b.rank === 1 && c.rank === 3);
  check('이름 정리 (꺾쇠 제거, 빈 이름은 PLAYER)', ST.get().ranking[0].name === 'bx/b' && ST.get().ranking[2].name === 'PLAYER');
  ST.renameEntry(a.ts, '새이름이아주길어요길다');
  check('이름 바꾸기 (8자 제한)', ST.get().ranking.filter(function (r) { return r.name === '새이름이아주길어'; }).length >= 1);
  // 이름 길이는 보이는 글자 수로 센다 (이모지·피부색·국기가 중간에서 잘리지 않는다)
  var thumb = '\ud83d\udc4d\ud83c\udffd', flag = '\ud83c\uddf0\ud83c\uddf7';
  var nm = ST.cleanName(thumb + thumb + flag + '가나다라마바사아');
  check('이름 8자는 보이는 글자 기준', nm === thumb + thumb + flag + '가나다라마' || !(typeof Intl !== 'undefined' && Intl.Segmenter), JSON.stringify(nm));
  check('풀어 쓴 한글(NFD)은 합쳐서 센다', ST.cleanName('\u1112\u1161\u11ab\u1100\u1173\u11af') === '한글');
  for (var i = 0; i < 40; i++) ST.addRanking('p' + i, 200 + i, 0);
  check('목록은 20개까지', ST.get().ranking.length === 20);
  // 한 판은 한 줄: 같은 ts 로 다시 넣으면 그 줄을 고쳐 쓴다
  ST.clearRanking();
  var r1 = ST.upsertRun(0, '한판', 350 * YD, 0);
  var r2 = ST.upsertRun(r1.ts, '한판', 380 * YD, 1);
  var r3 = ST.upsertRun(r1.ts, '한판', 360 * YD, 0);          // 더 나쁜 값으로는 내려가지 않는다
  var row = ST.get().ranking[0];
  check('같은 판은 한 줄로 갱신된다', ST.get().ranking.length === 1 && r2.ts === r1.ts && r3.ts === r1.ts && near(row.m, 380 * YD, 0.01) && row.stage === 1);
  var r4 = ST.upsertRun(0, '다음판', 400 * YD, 2);
  check('다른 판은 새 줄 + 순위 반환', ST.get().ranking.length === 2 && r4.ts !== r1.ts && r4.rank === 1 && ST.upsertRun(r1.ts, '한판', 381 * YD, 1).rank === 2);
  var ids = {};
  for (i = 0; i < 10; i++) ids[ST.upsertRun(0, 'q' + i, 100 + i, 0).ts] = 1;
  check('줄마다 식별자가 다르다 (같은 밀리초에 넣어도)', Object.keys(ids).length === 10);
  ST.get().best = 500; ST.save();
  // 다시 불러와도 유지
  var again = ST.load();
  check('저장한 값이 다시 읽힌다', again.best === 500 && again.ranking.length === 12);
  // 손상된 데이터
  store['kld-longdrive-v1'] = '{"settings":{"unit":"parsec","lang":5,"sound":"yes"},"best":"NaN","ranking":[{"name":7},null,{"name":"ok","m":123}],"offsets":{"touch":9999}}';
  d = ST.load();
  check('손상된 저장 데이터는 걸러진다', d.settings.unit === 'yd' && d.settings.lang === 'ko' && d.settings.sound === true && d.best === 0 && d.ranking.length === 1 && d.offsets === null);
  store['kld-longdrive-v1'] = '{not json';
  check('깨진 JSON 도 기본값으로', ST.load().best === 0);
  // 저장소가 예외를 던져도 게임은 계속된다
  globalThis.localStorage.setItem = function () { throw new Error('quota'); };
  check('저장 실패는 false 를 돌려줄 뿐 예외를 내지 않는다', ST.save() === false);
})();

console.log((fail ? 'FAILED' : 'OK') + '  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
