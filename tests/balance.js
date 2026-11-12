/*
 * KLD LONG DRIVE - 난이도 밸런스 시뮬레이션 (의존성 없는 Node 스크립트, Node 18 이상)
 *
 *   node tests/balance.js            전체 표 (가상 대회 900개, 통과율 오차 ±1~2%p, 10코어에서 3~4분). 난이도 값을 고친 뒤에는 이걸로 확인한다
 *   node tests/balance.js --quick    빠른 점검 (가상 대회 96개, 10코어에서 10초쯤). 오차는 ±3~6%p 라서 크게 어긋난 것만 잡는다
 *   옵션: --worlds N (가상 대회 수) · --seed N · --threads N (0 = 워커 없이 한 줄로) · --no-calib (입력 지연 자동 보정 끄기)
 *         --no-personas (요령을 아는 플레이어 참고 행을 빼고 세 봇만: 절반 시간)
 *   종료 코드: 목표 범위를 5%p 넘게 벗어난 칸이 있으면 1, 없으면 0 (두 모드 공통)
 *
 * 무엇을 하는가
 *   사람 대신 치는 봇 세 명(novice / casual / skilled)으로 대회를 수없이 돌려, 라운드별 통과율이 목표 범위에 드는지 본다.
 *   js/config.js 의 cpu 배열(과 라운드별 windowScale · gust)을 고친 뒤에는 이 스크립트로 다시 확인한다.
 *
 * 게임과 같은 부분
 *   - CPU 쪽은 전부 게임 코드다. 예선 필드와 상대 세트는 KLD.tournament.prepareRound, 순위·대진·승패는 finishRound,
 *     재도전은 undoRound, 공 하나하나는 KLD.shot.buildLaunch + KLD.physics.simulate.
 *   - 플레이어만 봇이다(playSet). js/game.js 의 startPower · lockPower · doImpact · finishShot · nextBall · endSet 과
 *     update() 의 시계 코드를 옮긴 것이므로, 그쪽 규칙을 바꾸면 여기도 같이 고쳐야 한다.
 *
 * 추정 방법 (공 하나의 물리 계산이 0.45ms 쯤 걸려서, 대회를 통째로 수만 번 돌리는 대신 이렇게 한다)
 *   - 가상 대회 하나 = 예선 필드 하나. 같은 필드를 세 봇이 함께 쓴다 (CPU 기록은 플레이어가 치기 전에 확정되므로 같다).
 *   - 각 라운드를 M번씩 시도해 본다. 한 번 시도하고 undoRound 로 되돌리는 것은 게임의 CONTINUE 와 같은 경로다.
 *     통과한 시도 하나를 골라 다음 라운드로 가고, 그 계보의 가중치에 (통과 수 ÷ M)을 곱한다.
 *     → 라운드 통과율 = Σ(가중치 × 통과 비율) ÷ Σ가중치,  우승 확률 = 가중치의 평균. 약한 봇도 결승 표본이 마르지 않는다.
 *   - CONTINUE 1회: 실패한 시도 하나에서 같은 라운드를 다시 치는 가지를 따로 따라간다(가지는 가중치 비례로 하나만 남긴다).
 *   - 난수는 전부 KLD.px.rng 시드에서 나오고 가상 대회 단위로 갈라 쓰므로, 워커 수와 상관없이 같은 결과가 나온다.
 */
'use strict';

var path = require('path');
var os = require('os');
var WT = require('worker_threads');

globalThis.KLD = {};
['config', 'i18n', 'px', 'physics', 'shot', 'tournament'].forEach(function (m) {
  require(path.join(__dirname, '..', 'js', m + '.js'));
});
var KLD = globalThis.KLD;
var S = KLD.shot, TN = KLD.tournament, PX = KLD.px;
var YD = S.YD;

// ---------------------------------------------------------------------------
// 조정하는 값: 봇 프로필 · 목표 범위 · 실행 규모
// ---------------------------------------------------------------------------
/*
 * sigmaMs / biasMs : 임팩트 탭 오차(ms). 양수 = 늦음(슬라이스)
 * powerSdMs / power: 파워 탭 오차(ms)와 노리는 파워
 * aimSd            : 조준 오차(도). null = 조준하지 않는다
 * trajSkill        : 바람에 맞는 탄도(맞바람이면 저 · 순풍이면 고 — KLD.tournament.pickTraj, CPU 와 같은 기준)를 고를 확률. 아니면 중탄도
 * red              : 레드존. power = 노리는 파워, lastBalls = 넘어야 할 기록에 못 미친 채 맞는 마지막 n구에서 쓴다,
 *                    afterValid = 유효 기록이 생긴 뒤에도 뒤지고 있으면 바로 쓴다. null = 일부러는 안 쓴다
 * waits            : 어드레스를 마친 순간 순풍 돌풍이 "이미 예고돼 있으면" 다 올라올 때까지 기다리는 횟수(세트당).
 *                    예고가 4초 앞까지만 보이므로 한 번에 5초 넘게 기다리는 일은 없다 (세트당 한 번쯤 일어난다)
 * addressSec       : 공마다 어드레스에서 보내는 시간
 * patient          : 요령을 아는 사람. 돌풍 라운드의 매치에서 넘어야 할 기록에 못 미친 동안, 순풍 돌풍이 예고될 때까지 어드레스에서
 *                    기다렸다가(남은 공을 칠 시간이 남는 한) 다 올라오면 친다. red: true 면 그 공은 레드존으로 친다.
 *                    라운드 안내의 팁("돌풍 예고를 보세요", "순풍 돌풍을 기다렸다가 띄워 치세요")대로 하는 플레이어다.
 */
var BOTS = [
  { name: 'novice', sigmaMs: 55, biasMs: 20, powerSdMs: 60, power: 0.95, aimSd: null, trajSkill: 0,
    red: null, waits: 0, addressSec: 4.0 },
  { name: 'casual', sigmaMs: 40, biasMs: 10, powerSdMs: 45, power: 0.97, aimSd: 0.75, trajSkill: 0.7,
    red: { power: 1.04, lastBalls: 2, afterValid: false }, waits: 2, addressSec: 3.5 },
  { name: 'skilled', sigmaMs: 22, biasMs: 0, powerSdMs: 30, power: 0.98, aimSd: 0.25, trajSkill: 1,
    red: { power: 1.05, lastBalls: 2, afterValid: true }, waits: 4, addressSec: 3.0 }
];
// 참고 행: 위 세 봇에 "순풍 돌풍을 기다린다"는 요령만 더한 플레이어. 목표 범위가 없어서 통과/실패 판정에는 들지 않는다.
// (위 세 봇의 숫자는 이 행들이 있든 없든 같다. 봇마다 난수 줄기가 따로다.)
var PERSONAS = [
  { name: 'novice+gust', base: 'novice', patient: { red: false } },
  { name: 'casual+gust', base: 'casual', patient: { red: true } },
  { name: 'skilled+gust', base: 'skilled', patient: { red: true } }
];
var N_STANDARD = BOTS.length;
PERSONAS.forEach(function (p) {
  var base = BOTS.filter(function (b) { return b.name === p.base; })[0], bot = {};
  Object.keys(base).forEach(function (k) { bot[k] = base[k]; });
  bot.name = p.name; bot.patient = p.patient;
  BOTS.push(bot);
});

// 라운드별 통과율 목표 범위(%). 그 라운드에 올라온 판 가운데 CONTINUE 없이 통과하는 비율.
var TARGETS = {
  novice:  { qual: [80, 90],  qf: [38, 50], sf: [22, 35], final: [10, 20] },
  casual:  { qual: [92, 98],  qf: [62, 75], sf: [42, 55], final: [28, 40] },
  skilled: { qual: [99, 100], qf: [85, 93], sf: [68, 80], final: [52, 65] }
};
var TOLERANCE = 5;            // 목표 범위를 이만큼(%p) 넘게 벗어나면 실패로 본다
var VALID_BAND = [35, 60];    // CPU 공 하나가 기록으로 인정되는 비율(%)의 허용 범위 (실제 장타 선수도 절반은 못 넣는다). 보스는 예외

// worlds = 가상 대회 수, attempts = 라운드별 시도 횟수 M, contAttempts = CONTINUE 가지의 시도 횟수,
// scout = CPU 15명을 매치 라운드 조건에서 따로 쳐 보는 가상 대회 수 (CPU 표의 8강·준결승·결승 칸)
var MODES = {
  full:  { worlds: 900, attempts: [8, 8, 8, 12], contAttempts: 2, scout: 60 },
  quick: { worlds: 96,  attempts: [8, 8, 8, 12], contAttempts: 1, scout: 8, personas: false }   // 빠른 점검은 목표 범위가 있는 세 봇만
};

// 봇 공통의 사람다운 시간 (초)
var HURRY_SEC = 1.0;          // 시계가 모자랄 때 줄일 수 있는 최소 어드레스 시간
var WAIT_MARGIN_SEC = 0.15;   // 돌풍이 다 올라온 것을 보고 스윙을 시작하기까지
var CANCEL_SEC = 0.4;         // 파워 탭이 취소된 뒤 다시 스윙을 시작하기까지
var SWING_SEC = 2.2;          // 스윙 한 번(파워 상승 + 톱 + 다운스윙)의 대략적인 길이. 기다릴 여유를 따질 때만 쓴다

var RUN = { calib: true };    // 실행 옵션 (워커마다 한 번 정해진다)

// ---------------------------------------------------------------------------
// 유틸
// ---------------------------------------------------------------------------
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }
function lpad(s, n) { s = String(s); while (s.length < n) s = ' ' + s; return s; }

// 정수 두 개를 섞어 32비트 시드를 만든다 (시드끼리 겹치지 않게)
function mix(a, b) {
  var h = (a ^ Math.imul((b + 0x9E3779B9) | 0, 0x85EBCA6B)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45D9F3B) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45D9F3B) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

// 1야드 간격 가중 히스토그램 (평균과 분위수용)
var HIST_BINS = 700;
function newHist() { return { n: 0, sum: 0, bins: new Float64Array(HIST_BINS) }; }
function histAdd(h, yd, w) {
  h.bins[clamp(Math.round(yd), 0, HIST_BINS - 1)] += w;
  h.n += w; h.sum += w * yd;
}
function histQ(h, q) {
  var goal = q * h.n, acc = 0;
  for (var i = 0; i < HIST_BINS; i++) { acc += h.bins[i]; if (acc >= goal && acc > 0) return i; }
  return NaN;
}

// 누적값 합치기: 숫자는 더하고, 배열은 칸마다 더하고, 객체는 안으로 들어간다
function mergeInto(dst, src) {
  Object.keys(src).forEach(function (k) {
    var v = src[k], i;
    if (typeof v === 'number') dst[k] = (dst[k] || 0) + v;
    else if (ArrayBuffer.isView(v)) {
      if (!dst[k]) dst[k] = new Float64Array(v.length);
      for (i = 0; i < v.length; i++) dst[k][i] += v[i];
    } else {
      if (!dst[k]) dst[k] = {};
      mergeInto(dst[k], v);
    }
  });
  return dst;
}

// ---------------------------------------------------------------------------
// 플레이어 봇의 한 세트 (js/game.js 의 스윙·시계·완충 규칙을 그대로 따른다)
//   st = { shift, errs } : 라운드를 넘어 이어지는 입력 지연 보정 상태
//   반환: { best(m, 없으면 0), reason: 'done' | 'walkoff' | 'timeup', balls, overUsed, overAcc, waits, ... }
// ---------------------------------------------------------------------------
function playSet(bot, st, R, rand) {
  var cfg = KLD.config, C = cfg.gauge, A = cfg.assist, rules = cfg.rules, SH = cfg.shot, GUST = S.GUST;
  var gauss = PX.gauss;
  var rc = R.cfg, wind = R.wind, target = R.target, isMatch = R.type === 'match';
  var unlock = rc.unlock || {};
  var nBalls = rules.ballsPerSet;
  var sweepMs = C.sweepSec * 1000, sweetMs = C.sweetPos * sweepMs;
  var set = {
    ballIndex: 0, timeLeft: rules.setTimeSec, elapsed: 0, clockStarted: false, best: 0, missStreak: 0,
    over: unlock.over ? C.overCharges : 0,                // newSet()
    reason: 'done', balls: 0, overUsed: 0, overAcc: 0, waits: 0, waitSec: 0
  };
  var waitsLeft = bot.waits;

  // 어드레스·스윙 중에 시간이 흐른다. 시계는 첫 스윙을 시작한 뒤부터 간다(바람은 그 전에도 흐른다).
  function spend(sec) {
    set.elapsed += sec;
    if (set.clockStarted) set.timeLeft = Math.max(0, set.timeLeft - sec);
  }

  for (;;) {
    // ── 어드레스 ──
    var addr = bot.addressSec;
    if (set.clockStarted && set.timeLeft < addr + 0.3) addr = Math.max(HURRY_SEC, set.timeLeft - 0.3);   // 시간이 모자라면 서두른다
    spend(addr);
    if (set.clockStarted && set.timeLeft <= 0) { set.reason = 'timeup'; break; }      // 어드레스에서 0초: 남은 공은 사라진다

    // 요령을 아는 플레이어(patient): 넘어야 할 기록에 못 미친 동안, 순풍 돌풍이 예고될 때까지 서서 기다렸다가 다 올라오면 친다.
    // 화면에 보이는 것(4초 앞까지의 예고)만 보고 정한다. 시계가 가고 있으면 남은 공을 평소 속도로 칠 시간은 남긴다.
    var inGust = false;
    if (bot.patient && wind.cfg.gust && isMatch && !(set.best > target)) {
      var perBall = bot.addressSec + SWING_SEC + rules.flightClockCostSec, waited = 0;
      var canWait = function (sec) {
        return waited + sec <= 120 && (!set.clockStarted || set.timeLeft - sec >= (nBalls - set.ballIndex) * perBall);
      };
      for (;;) {
        var gp = wind.at(set.elapsed).gust;
        if (gp && gp.dx > 0) {
          var needP = gp.phase === 'incoming' ? gp.eta + GUST.rise : Math.max(0, gp.remain - GUST.hold);
          if (needP <= 0) inGust = true;                                         // 이미 다 올라와 있다
          else if (canWait(needP + WAIT_MARGIN_SEC)) { spend(needP + WAIT_MARGIN_SEC); waited += needP + WAIT_MARGIN_SEC; inGust = true; }
          break;
        }
        if (!canWait(0.25 + GUST.forecast + GUST.rise + WAIT_MARGIN_SEC)) break;   // 더 기다리면 남은 공을 못 친다
        spend(0.25); waited += 0.25;
      }
      if (waited > 0) { set.waits++; set.waitSec += waited; }
    }

    // 예고된 순풍 돌풍이 있으면 다 올라올 때까지 기다린다 (시계는 계속 간다)
    if (waitsLeft > 0 && wind.cfg.gust && !inGust) {
      var g = wind.at(set.elapsed).gust;
      if (g && g.dx > 0) {
        var need = g.phase === 'incoming' ? g.eta + GUST.rise : Math.max(0, g.remain - GUST.hold);
        var ballsLeft = nBalls - set.ballIndex;
        var afford = !set.clockStarted ||
          set.timeLeft - need - WAIT_MARGIN_SEC >= ballsLeft * (bot.addressSec + SWING_SEC + rules.flightClockCostSec);
        if (need > 0 && afford) {
          waitsLeft--; set.waits++; set.waitSec += need + WAIT_MARGIN_SEC;
          spend(need + WAIT_MARGIN_SEC);
        }
      }
    }

    // ── 스윙: startPower → lockPower ──
    var w, safe, scale, maxP, aim, traj, wantRed, tap, c, timedOut = false;
    for (;;) {
      w = wind.at(set.elapsed);                           // WIND LOCK: 스윙을 시작한 순간의 바람
      safe = set.best <= 0 && set.ballIndex === nBalls - 1;                       // isSafeSwing()
      scale = (rc.windowScale || 1) * Math.min(A.max, 1 + A.perMiss * set.missStreak) * (safe ? A.lastBallWindow : 1);
      maxP = (unlock.over && set.over > 0) ? C.overMax : 1;
      set.clockStarted = true;

      // 조준·탄도·파워는 어드레스에서 정한다 (열려 있는 라운드에서만)
      aim = 0;
      if (unlock.aim && bot.aimSd != null) {
        aim = S.idealAim(w.z) + bot.aimSd * gauss(rand);
        aim = clamp(Math.round(aim / SH.aimStep) * SH.aimStep, -SH.aimMax, SH.aimMax);
      }
      traj = 'mid';
      if (unlock.traj && bot.trajSkill > 0) {
        var right = TN.pickTraj(w.x, rc);                 // CPU 와 같은 기준
        traj = rand() < bot.trajSkill ? right : 'mid';
      }
      wantRed = false;
      if (bot.red && maxP > 1 && !(set.best > target)) {  // 넘어야 할 기록에 아직 못 미쳤을 때만
        wantRed = set.ballIndex >= nBalls - bot.red.lastBalls || (bot.red.afterValid && set.best > 0);
        if (bot.patient && bot.patient.red && inGust) wantRed = true;            // 기다린 돌풍에는 레드존으로
      }

      // 파워 탭: 노리는 파워에 닿는 시각 + 오차. 커서는 꼭대기에서 되돌아 내려온다.
      tap = Math.max(C.lockout.powerSec, S.timeToPower(wantRed ? bot.red.power : bot.power) + bot.powerSdMs / 1000 * gauss(rand));
      c = S.powerCursor(tap, maxP);
      if (!c.done && c.p >= C.cancelBelow) break;
      spend(tap + CANCEL_SEC);                            // 너무 낮으면 취소: 공은 그대로, 시간만 쓴다
      if (set.timeLeft <= 0) { timedOut = true; break; }
    }
    if (timedOut) { set.reason = 'timeup'; break; }

    var p = c.p;
    if (p > 1.0005) { set.over--; set.overUsed++; if (!wantRed) set.overAcc++; }  // 레드존 1회 사용 (넘겨 버려도 쓴 것이다)

    // ── 임팩트 탭: doImpact ──
    var dt = bot.biasMs + bot.sigmaMs * gauss(rand) - st.shift;                   // 게임이 재는 오차(ms)
    var u = C.sweetPos + dt / sweepMs;
    // 커서가 바 끝(u = 1)을 지나도록 못 누르면 자동 미스. 너무 이른 탭(더블탭 잠금 구간)은 무시되어 역시 미스가 된다.
    var auto = dt >= sweepMs - sweetMs || u < C.lockout.impactU;
    var e;
    if (auto) e = C.missE;
    else {
      e = S.impactError(u, p, scale);
      if (Math.abs(Math.round(dt)) < 120) st.errs.push(Math.round(dt));          // 입력 지연 자동 보정용 표본
    }
    var built = S.buildLaunch({ power: p, e: e, aim: aim, traj: traj, spinScale: safe ? A.lastBallSpin : 1 }, rand);
    var res = KLD.physics.simulate(built.launch, S.env(w));

    // 시계: 게이지가 도는 동안 흐르고, 임팩트 때 비행 시간 몫을 깎는다
    spend(tap + C.topPauseSec + (auto ? C.sweepSec : (sweetMs + dt) / 1000));
    set.timeLeft = Math.max(0, set.timeLeft - rules.flightClockCostSec);

    // ── finishShot → nextBall ──
    set.balls++;
    var valid = !!res.inGrid, total = res.total, prevBest = set.best;
    set.missStreak = (valid && built.quality !== 'miss') ? 0 : set.missStreak + 1;   // 그리드 안에 남은 탑볼·뽕샷도 실패로 센다
    if (valid && total > set.best) set.best = total;
    // 넘어야 할 기록을 처음 넘긴 공. 상대가 기록이 없으면(0) 유효타 하나로 충분하다.
    var walkoff = isMatch && valid && total > target && !(prevBest > target);
    set.ballIndex++;
    var left = nBalls - set.ballIndex;
    if (left <= 0 || set.timeLeft <= 0) { set.reason = (left <= 0 || walkoff) ? 'done' : 'timeup'; break; }
    if (walkoff) { set.reason = 'walkoff'; break; }       // 워크오프: 남은 공은 치지 않는다
  }
  return set;
}

// 세트가 끝날 때의 입력 지연 자동 보정 (game.js calibrateOffsets): 오차의 중앙값이 쏠려 있으면 절반만큼 옮긴다.
// 봇은 대회마다 기본 보정값(터치)에서 시작한다 → 봇의 biasMs 는 첫 판 기준이고, 라운드를 넘기며 조금씩 줄어든다.
function calibrate(st) {
  var C = KLD.config.gauge, a = st.errs;
  if (a.length < 4) return;
  var s = a.slice().sort(function (x, y) { return x - y; });
  var med = s[Math.floor(s.length / 2)];
  if (Math.abs(med) >= 12) {
    var off0 = C.inputOffsetMs.touch;
    st.shift = clamp(off0 + st.shift + C.offsetAdaptRate * med, 0, C.offsetMaxMs) - off0;
  }
  st.errs = [];
}

// ---------------------------------------------------------------------------
// 누적 통계
// ---------------------------------------------------------------------------
function newRoundRec() {
  return {
    sb: 0, sa: 0, sbb: 0, sab: 0, saa: 0,       // 계보별 (가중치 b, 가중치 × 통과 비율 a) 의 합과 제곱합
    w: 0, noValid: 0, timeUp: 0, over: 0, overAcc: 0, waits: 0, waitSec: 0, balls: 0, zeroTarget: 0,      // 시도 가중치의 합과 가중 합계
    cpuBalls: 0, cpuValid: 0,
    best: newHist(), target: newHist(), opp: {}
  };
}
function newAcc() {
  var acc = { worlds: 0, cut: newHist(), cpu: {}, bots: {} };
  KLD.config.rounds.forEach(function (rc) { acc.cpu[rc.id] = {}; });
  BOTS.forEach(function (bot) {
    var b = acc.bots[bot.name] = { rounds: {}, champ0: { s: 0, ss: 0 }, champ1: { s: 0, ss: 0 } };
    KLD.config.rounds.forEach(function (rc) { b.rounds[rc.id] = newRoundRec(); });
  });
  return acc;
}

// 한 번의 시도를 기록한다 (wt = 계보 가중치 ÷ 시도 횟수)
function record(rec, wt, R, set, out) {
  rec.w += wt;
  rec.balls += wt * set.balls;
  rec.over += wt * set.overUsed; rec.overAcc += wt * set.overAcc;
  rec.waits += wt * set.waits; rec.waitSec += wt * set.waitSec;
  if (set.reason === 'timeup') rec.timeUp += wt;
  if (set.best > 0) histAdd(rec.best, set.best / YD, wt); else rec.noValid += wt;
  if (R.target > 0) histAdd(rec.target, R.target / YD, wt); else rec.zeroTarget += wt;    // 상대가 기록이 없는 판은 평균에서 빼고 따로 센다
  if (R.type === 'match') {
    rec.cpuBalls += wt * R.oppSet.balls.length; rec.cpuValid += wt * R.oppSet.hits;
    var o = rec.opp[R.opponent.id] || (rec.opp[R.opponent.id] = { w: 0, p: 0 });
    o.w += wt; if (out.advanced) o.p += wt;
  } else {
    for (var i = 0; i < R.cpuSets.length; i++) { rec.cpuBalls += wt * R.cpuSets[i].balls.length; rec.cpuValid += wt * R.cpuSets[i].hits; }
  }
}

// CPU 한 명의 한 세트를 표에 더한다
function addCpuSet(table, s) {
  var t = table[s.cpu.id] || (table[s.cpu.id] = { sets: 0, balls: 0, valid: 0, noRec: 0, bestSum: 0, bestN: 0, top: 0 });
  t.sets++; t.balls += s.balls.length; t.valid += s.hits;
  if (s.best > 0) { t.bestSum += s.best; t.bestN++; } else t.noRec++;
  return t;
}

// ---------------------------------------------------------------------------
// 가상 대회 하나
// ---------------------------------------------------------------------------
// 대회 상태를 통째로 복사한다 (난수 함수만 새 시드로). 대진표 안의 객체 공유 관계는 structuredClone 이 지켜 준다.
function cloneTournament(T, seed) {
  var plain = {};
  Object.keys(T).forEach(function (k) { if (typeof T[k] !== 'function') plain[k] = T[k]; });
  var copy = structuredClone(plain);
  copy.rand = PX.rng(seed);
  return copy;
}

// 예선 필드(CPU 15명의 세트)는 가상 대회마다 한 번만 만들어 세 봇이 함께 쓴다. i = 0 첫 시도, 1 = CONTINUE 재도전용.
function makeWorld(seed) {
  var rc0 = KLD.config.rounds[0], T0 = TN.create(mix(seed, 1)), fields = [];
  return {
    seed: seed,
    field: function (i) {
      while (fields.length <= i) {
        fields.push(TN.prepareRound(T0, S.createWind(rc0, PX.rng(mix(seed, 10 + fields.length)))));
      }
      return fields[i];
    }
  };
}

/*
 * 계보 L = { T, st, w } 에서 라운드 k 를 M번 시도한다.
 * 매번 finishRound 로 결과를 내고 undoRound 로 되돌리므로 (게임의 CONTINUE 와 같은 경로) 시도들은 서로 독립이다.
 * 반환: rate = 통과 비율, pass / fail = 처음으로 통과 / 실패한 시도 뒤의 상태 { T, st }
 */
function tryRound(world, bot, L, k, M, seed, fieldIdx, rec) {
  var T = L.T, rc = KLD.config.rounds[k];
  var pass = null, fail = null, passes = 0;
  for (var a = 0; a < M; a++) {
    var rand = PX.rng(mix(seed, a));
    var st = { shift: L.st.shift, errs: L.st.errs.slice() };
    var R, set, out, rematches = 0;
    for (;;) {
      // beginRound: 매치는 새 바람에서 상대가 먼저 6구를 친다. 예선 필드는 가상 대회에 하나.
      R = rc.type === 'field' ? world.field(fieldIdx)
        : TN.prepareRound(T, S.createWind(rc, PX.rng(mix(seed, 1000 + a * 10 + rematches))));
      set = playSet(bot, st, R, rand);
      if (RUN.calib) calibrate(st);                       // endSet
      out = TN.finishRound(T, R, set.best);
      if (!out.rematch) break;
      rematches++;                                        // 둘 다 기록 없음 → 재경기
    }
    if (rec) record(rec, L.w / M, R, set, out);
    if (out.advanced) {
      passes++;
      if (!pass) {
        pass = { T: cloneTournament(T, mix(seed, 7001)), st: st };
        if (!out.champion) TN.advance(pass.T);
      }
    }
    TN.undoRound(T, R);
    if (!out.advanced && !fail) fail = { T: cloneTournament(T, mix(seed, 7002)), st: st };
  }
  return { rate: passes / M, pass: pass, fail: fail };
}

// 봇 한 명이 가상 대회 하나를 치른다
function runBot(world, bot, bi, opts, acc) {
  var rounds = KLD.config.rounds, B = acc.bots[bot.name];
  var seed = mix(world.seed, 100 + bi);
  var pick = PX.rng(mix(seed, 9));
  var U = { T: TN.create(mix(seed, 7)), st: { shift: 0, errs: [] }, w: 1 };     // CONTINUE 를 아직 안 쓴 계보
  var C = null;                                                                  // CONTINUE 를 써 버린 계보
  for (var k = 0; k < rounds.length && (U || C); k++) {
    var M = opts.attempts[Math.min(k, opts.attempts.length - 1)], cands = [];
    if (U) {
      var rec = B.rounds[rounds[k].id];
      var r = tryRound(world, bot, U, k, M, mix(seed, 10000 + k), 0, rec);
      var a = U.w * r.rate;
      rec.sb += U.w; rec.sa += a; rec.sbb += U.w * U.w; rec.sab += a * U.w; rec.saa += a * a;
      if (r.fail && opts.contAttempts > 0) {
        // CONTINUE: 방금 진 라운드를 다시 친다
        var q = tryRound(world, bot, r.fail, k, opts.contAttempts, mix(seed, 20000 + k), 1, null);
        if (q.pass) cands.push({ T: q.pass.T, st: q.pass.st, w: U.w * (1 - r.rate) * q.rate });
      }
      U = r.pass ? { T: r.pass.T, st: r.pass.st, w: a } : null;
    }
    if (C) {
      var c = tryRound(world, bot, C, k, opts.contAttempts, mix(seed, 30000 + k), 0, null);
      if (c.pass) cands.push({ T: c.pass.T, st: c.pass.st, w: C.w * c.rate });
    }
    C = null;
    if (cands.length === 1) C = cands[0];
    else if (cands.length === 2) {                        // 가중치 비례로 하나만 남기고 가중치는 합친다
      var tot = cands[0].w + cands[1].w, keep = cands[pick() * tot < cands[0].w ? 0 : 1];
      C = { T: keep.T, st: keep.st, w: tot };
    }
  }
  var c0 = U ? U.w : 0, c1 = c0 + (C ? C.w : 0);
  B.champ0.s += c0; B.champ0.ss += c0 * c0;
  B.champ1.s += c1; B.champ1.ss += c1 * c1;
}

function simulateWorld(index, opts, acc) {
  var rounds = KLD.config.rounds, cpus = KLD.config.cpu;
  var world = makeWorld(mix(opts.seed, index));
  var i, k;

  // 예선 필드 통계: 컷 라인, CPU별 그리드 적중률·최고 기록·8위 안에 든 횟수
  var f0 = world.field(0);
  histAdd(acc.cut, f0.target / YD, 1);
  for (i = 0; i < f0.cpuSets.length; i++) {
    var t = addCpuSet(acc.cpu[rounds[0].id], f0.cpuSets[i]);
    if (f0.cpuSets[i].best > 0 && f0.cpuSets[i].best >= f0.target) t.top++;
  }
  // 매치 라운드 조건에서 CPU 15명을 따로 쳐 본다 (상대로 만났을 때와 같은 호출)
  if (index < opts.scout) {
    for (k = 1; k < rounds.length; k++) {
      if (rounds[k].type !== 'match') continue;
      var rand = PX.rng(mix(world.seed, 300 + k));
      var wind = S.createWind(rounds[k], PX.rng(mix(world.seed, 400 + k)));
      for (i = 0; i < cpus.length; i++) addCpuSet(acc.cpu[rounds[k].id], TN.simulateCpuSet(cpus[i], wind, rand, 5.5));
    }
  }
  for (i = 0; i < BOTS.length; i++) runBot(world, BOTS[i], i, opts, acc);
  acc.worlds++;
}

function simulateChunk(from, to, opts) {
  var acc = newAcc();
  for (var i = from; i < to; i++) simulateWorld(i, opts, acc);
  return acc;
}

// 설정 덮어쓰기 (튜닝 스크립트용): { cpu: [...], rounds: [{ windowScale, gust }, ...] }
function applyOptions(opts) {
  RUN.calib = opts.calib !== false;
  if (opts.personas === false) BOTS.length = N_STANDARD;      // 참고 행 없이
  var ov = opts.override;
  if (!ov) return;
  if (ov.cpu) KLD.config.cpu = ov.cpu;
  if (ov.rounds) {
    ov.rounds.forEach(function (r, i) {
      if (r) Object.keys(r).forEach(function (k) { KLD.config.rounds[i][k] = r[k]; });
    });
  }
}

// ---------------------------------------------------------------------------
// 실행: 가상 대회를 묶음으로 나눠 워커에 돌린다. 묶음 순서대로 합치므로 워커 수와 상관없이 결과가 같다.
// ---------------------------------------------------------------------------
var CHUNK = 2;

function run(opts) {
  applyOptions(opts);                                         // 주 스레드에도 적용한다 (표에 찍히는 CPU 값이 실제로 돌린 값과 같도록)
  var chunks = [], i;
  for (i = 0; i < opts.worlds; i += CHUNK) chunks.push([i, Math.min(opts.worlds, i + CHUNK)]);
  var threads = Math.min(opts.threads, chunks.length);
  function finish(results) {
    var acc = newAcc();
    results.forEach(function (r) { mergeInto(acc, r); });
    return acc;
  }
  if (threads <= 1) {
    return Promise.resolve(finish(chunks.map(function (c) { return simulateChunk(c[0], c[1], opts); })));
  }
  return new Promise(function (resolve, reject) {
    var results = new Array(chunks.length), next = 0, done = 0, workers = [];
    function feed(worker) {
      if (next < chunks.length) { var c = next++; worker.postMessage({ chunk: c, from: chunks[c][0], to: chunks[c][1] }); }
    }
    function stop() { workers.forEach(function (w) { w.terminate(); }); }
    for (i = 0; i < threads; i++) {
      (function () {
        var worker = new WT.Worker(__filename, { workerData: { kldBalance: true, opts: opts } });
        worker.on('message', function (m) {
          results[m.chunk] = m.acc;
          if (++done === chunks.length) { stop(); resolve(finish(results)); } else feed(worker);
        });
        worker.on('error', function (err) { stop(); reject(err); });
        workers.push(worker);
        feed(worker);
      })();
    }
  });
}

// ---------------------------------------------------------------------------
// 요약과 출력
// ---------------------------------------------------------------------------
// 가중 비율과 표준오차 (비율 추정량의 선형화)
function ratioOf(rec, n) {
  if (!(rec.sb > 0)) return { rate: NaN, se: NaN };
  var r = rec.sa / rec.sb;
  var v = Math.max(0, rec.saa - 2 * r * rec.sab + r * r * rec.sbb);
  return { rate: r, se: n > 1 ? Math.sqrt(v * n / (n - 1)) / rec.sb : NaN };
}
function meanOf(x, n) {
  var m = x.s / n;
  return { rate: m, se: n > 1 ? Math.sqrt(Math.max(0, x.ss / n - m * m) / (n - 1)) : NaN };
}

function summarize(acc) {
  var n = acc.worlds, rounds = KLD.config.rounds, out = { worlds: n, bots: {}, cpu: [], cut: acc.cut, misses: [] };
  BOTS.forEach(function (bot) {
    var B = acc.bots[bot.name], sb = out.bots[bot.name] = { rounds: [] };
    rounds.forEach(function (rc) {
      var rec = B.rounds[rc.id], r = ratioOf(rec, n), band = (TARGETS[bot.name] || {})[rc.id] || null;
      var pct = r.rate * 100, miss = band ? Math.max(0, band[0] - pct, pct - band[1]) : 0;
      var row = {
        id: rc.id, type: rc.type, rate: r.rate, se: r.se, reach: rec.sb / n, band: band, miss: miss, rec: rec,
        noValid: rec.noValid / rec.w, timeUp: rec.timeUp / rec.w, over: rec.over / rec.w, overAcc: rec.overAcc / rec.w,
        waits: rec.waits / rec.w, waitSec: rec.waitSec / rec.w, balls: rec.balls / rec.w, cpuValid: rec.cpuValid / rec.cpuBalls,
        zeroTarget: rec.zeroTarget / rec.w
      };
      if (!(miss <= TOLERANCE)) out.misses.push({ bot: bot.name, round: rc.id, pct: pct, band: band });
      sb.rounds.push(row);
    });
    sb.champ0 = meanOf(B.champ0, n);
    sb.champ1 = meanOf(B.champ1, n);
  });
  KLD.config.cpu.forEach(function (cpu) {
    var row = { cpu: cpu, rounds: {} };
    rounds.forEach(function (rc, k) {
      var t = acc.cpu[rc.id][cpu.id];
      if (k > 0 && t) out.scout = t.sets;
      row.rounds[rc.id] = t ? { valid: t.valid / t.balls, balls: t.balls, noRec: t.noRec / t.sets, best: t.bestN ? t.bestSum / t.bestN / YD : NaN, top: t.top / t.sets } : null;
    });
    out.cpu.push(row);
  });
  return out;
}

function f1(v) { return isFinite(v) ? v.toFixed(1) : '-'; }
function f0(v) { return isFinite(v) ? v.toFixed(0) : '-'; }
function pc(v) { return isFinite(v) ? (v * 100).toFixed(1) : '-'; }
function ci(se) { return isFinite(se) ? '+-' + (1.96 * se * 100).toFixed(1) : ''; }

function botLine(bot) {
  var parts = ['impact sd ' + bot.sigmaMs + 'ms bias ' + (bot.biasMs >= 0 ? '+' : '') + bot.biasMs + 'ms',
    'power tap sd ' + bot.powerSdMs + 'ms @' + Math.round(bot.power * 100) + '%',
    bot.aimSd == null ? 'no aim' : 'aim sd ' + bot.aimSd + 'deg',
    'traj ' + Math.round(bot.trajSkill * 100) + '%',
    bot.red ? 'red zone @' + Math.round(bot.red.power * 100) + '% (last ' + bot.red.lastBalls + (bot.red.afterValid ? ' + after 1st valid' : '') + ')' : 'no red zone',
    bot.waits ? 'waits for an announced gust x' + bot.waits : 'no wait',
    'address ' + bot.addressSec + 's'];
  if (bot.patient) parts.push('PATIENT: stands until a tail gust is announced' + (bot.patient.red ? ', red zone on it' : ''));
  return parts.join(' | ');
}

function report(sum, opts, elapsed) {
  var rounds = KLD.config.rounds;
  console.log('KLD LONG DRIVE balance  (' + (opts.quick ? 'quick' : 'full') + ': worlds ' + sum.worlds + ', attempts/round ' + opts.attempts.join('-') +
    ', seed ' + opts.seed + ', threads ' + opts.threads + (opts.calib === false ? ', calib off' : '') + (opts.override ? ', OVERRIDE' : '') + ', ' + elapsed.toFixed(1) + ' s)');
  console.log('pass% = 그 라운드에 올라온 판 가운데 CONTINUE 없이 통과한 비율,  +- = 95% 신뢰구간,  거리 단위 yd');

  BOTS.forEach(function (bot) {
    var sb = sum.bots[bot.name];
    console.log('\n[' + bot.name + ']  ' + botLine(bot) + (TARGETS[bot.name] ? '' : '   (참고 행: 목표 범위 없음)'));
    console.log('  round    pass%          target    verdict     reach%     cpu valid%    no-valid%  clock-out%  red/set(accid.)  waits  wait s  balls');
    sb.rounds.forEach(function (r) {
      var verdict = !r.band ? '' : (r.miss === 0 ? 'ok' : (r.miss <= TOLERANCE ? 'near ' + (r.rate * 100 < r.band[0] ? '-' : '+') + r.miss.toFixed(1) : 'MISS ' + (r.rate * 100 < r.band[0] ? '-' : '+') + r.miss.toFixed(1)));
      console.log('  ' + pad(r.id, 7) + lpad(pc(r.rate), 6) + ' ' + pad(ci(r.se), 8) + pad(r.band ? r.band[0] + '-' + r.band[1] : '', 10) + pad(verdict, 11) +
        lpad(pc(r.reach), 7) + lpad(pc(r.cpuValid), 13) + lpad(pc(r.noValid), 11) + lpad(pc(r.timeUp), 12) +
        lpad(r.over.toFixed(2) + ' (' + r.overAcc.toFixed(2) + ')', 17) + lpad(r.waits.toFixed(2), 7) + lpad(r.waitSec.toFixed(1), 8) + lpad(r.balls.toFixed(1), 7));
    });
    console.log('  champion: no CONTINUE ' + pc(sb.champ0.rate) + '% ' + ci(sb.champ0.se) + '   with 1 CONTINUE ' + pc(sb.champ1.rate) + '% ' + ci(sb.champ1.se));
    console.log('  round    player set-best (valid sets)      ' + 'cut / number to beat (opp. with a record)' + '   no-rec%   opponents faced: share% (pass%)');
    console.log('           mean    p10    p90               mean    p10    p50    p90');
    sb.rounds.forEach(function (r) {
      var rec = r.rec, b = rec.best, tg = rec.target;
      var opp = Object.keys(rec.opp).map(function (id) { return { id: id, w: rec.opp[id].w, p: rec.opp[id].p }; })
        .sort(function (x, y) { return y.w - x.w; }).slice(0, 5)
        .map(function (o) { return o.id + ' ' + f0(o.w / rec.w * 100) + ' (' + f0(o.p / o.w * 100) + ')'; }).join(', ');
      console.log('  ' + pad(r.id, 7) + lpad(f1(b.sum / b.n), 7) + lpad(f0(histQ(b, 0.1)), 7) + lpad(f0(histQ(b, 0.9)), 7) + '            ' +
        lpad(f1(tg.sum / tg.n), 7) + lpad(f0(histQ(tg, 0.1)), 7) + lpad(f0(histQ(tg, 0.5)), 7) + lpad(f0(histQ(tg, 0.9)), 7) + lpad(pc(r.zeroTarget), 13) + '     ' + opp);
    });
  });

  // CPU 표
  function cols(row, pick) {
    return rounds.map(function (rc) { var t = row.rounds[rc.id]; return lpad(t ? f0(pick(t)) : '-', 6); }).join('');
  }
  var heads = rounds.map(function (rc) { return lpad(rc.id, 6); }).join('');
  console.log('\n[CPU]  valid% = 기록으로 인정된 공 (그리드 안에 멈췄고 탑볼·뽕샷이 아닌 공, 허용 ' + VALID_BAND[0] + '-' + VALID_BAND[1] +
    '%),  norec% = 6구가 전부 무효인 세트,  best = 세트 최고 기록 평균(기록이 있는 세트),  top8% = 예선에서 CPU 15명 중 8위 안');
  console.log('  예선 컷 라인: mean ' + f1(sum.cut.sum / sum.cut.n) + '  p10 ' + f0(histQ(sum.cut, 0.1)) + '  p50 ' + f0(histQ(sum.cut, 0.5)) + '  p90 ' + f0(histQ(sum.cut, 0.9)) +
    (sum.scout ? '     (8강·준결승·결승 칸은 CPU마다 ' + sum.scout + '세트)' : ''));
  console.log('  id        mph  power  timing  read | valid%' + heads + ' | norec%' + heads + ' |   best' + heads + ' | top8%');
  var bad = [];
  sum.cpu.forEach(function (row) {
    var c = row.cpu, q = row.rounds[rounds[0].id];
    var noise = q ? 200 * Math.sqrt(q.valid * (1 - q.valid) / q.balls) : 0;      // 표본 오차(2σ, %p)를 넘게 벗어날 때만 알린다
    // 보스는 일부러 꾸준하게 둔다 (결승이 준결승보다 어렵게 하는 유일한 손잡이). 나머지만 범위를 본다.
    if (q && !c.boss && (q.valid * 100 < VALID_BAND[0] - noise || q.valid * 100 > VALID_BAND[1] + noise)) bad.push(c.id + ' ' + f0(q.valid * 100) + '%');
    console.log('  ' + pad(c.id + (c.boss ? '*' : ''), 9) + lpad(c.speed, 4) + lpad(c.power, 7) + lpad(c.timingMs, 8) + lpad(c.read, 6) + ' |       ' +
      cols(row, function (t) { return t.valid * 100; }) + ' |       ' + cols(row, function (t) { return t.noRec * 100; }) + ' |       ' +
      cols(row, function (t) { return t.best; }) + ' |' + lpad(q ? f0(q.top * 100) : '-', 6));
  });
  if (bad.length) console.log('  ! 예선 valid% 가 허용 범위 밖: ' + bad.join(', '));
  console.log('  (무효가 된 공의 대부분은 그리드 안에 멈춘 탑볼·뽕샷이다. valid% 를 움직이는 손잡이는 timingMs 뿐이다. * = 보스: 일부러 꾸준하다)');

  if (sum.misses.length) {
    console.log('\nFAILED: 목표 범위를 ' + TOLERANCE + '%p 넘게 벗어난 칸 ' + sum.misses.length + '개 - ' +
      sum.misses.map(function (m) { return m.bot + '/' + m.round + ' ' + m.pct.toFixed(1) + '% (목표 ' + m.band[0] + '-' + m.band[1] + ')'; }).join(', '));
  } else {
    console.log('\nOK: 모든 칸이 목표 범위에서 ' + TOLERANCE + '%p 안쪽' +
      (opts.quick ? '  (빠른 점검: 한 칸의 오차가 ±3~6%p 라서 경계 근처는 가려내지 못한다. 난이도 값을 고쳤으면 옵션 없이 전체 표로 확인할 것)' : ''));
  }
}

// ---------------------------------------------------------------------------
// 진입점
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  function num(name, fallback) {
    var i = argv.indexOf(name);
    return i >= 0 && isFinite(Number(argv[i + 1])) ? Number(argv[i + 1]) : fallback;
  }
  var quick = argv.indexOf('--quick') >= 0, mode = quick ? MODES.quick : MODES.full;
  var cores = os.availableParallelism ? os.availableParallelism() : os.cpus().length;
  return {
    quick: quick, worlds: num('--worlds', mode.worlds), attempts: mode.attempts, contAttempts: mode.contAttempts,
    scout: mode.scout, seed: num('--seed', 20261111), threads: num('--threads', Math.min(cores, 12)),
    calib: argv.indexOf('--no-calib') < 0,
    personas: mode.personas !== false && argv.indexOf('--no-personas') < 0
  };
}

if (!WT.isMainThread && WT.workerData && WT.workerData.kldBalance) {
  // 워커: 받은 묶음을 계산해 돌려준다
  applyOptions(WT.workerData.opts);
  WT.parentPort.on('message', function (m) {
    WT.parentPort.postMessage({ chunk: m.chunk, acc: simulateChunk(m.from, m.to, WT.workerData.opts) });
  });
} else if (WT.isMainThread && require.main === module) {
  var opts = parseArgs(process.argv.slice(2));
  var t0 = Date.now();
  run(opts).then(function (acc) {
    var sum = summarize(acc);
    report(sum, opts, (Date.now() - t0) / 1000);
    // process.exit() 대신 종료 코드만 정해 두고 자연스럽게 끝나게 한다 (워커를 정리하는 중에 강제 종료하면 드물게 멈춰 버린다)
    process.exitCode = sum.misses.length ? 1 : 0;
  }, function (err) {
    console.error(err);
    process.exitCode = 2;
  });
} else {
  // 다른 스크립트(튜닝)에서 불러 쓸 때
  module.exports = {
    BOTS: BOTS, TARGETS: TARGETS, MODES: MODES, run: run, summarize: summarize, report: report, parseArgs: parseArgs,
    playSet: playSet, simulateChunk: simulateChunk, applyOptions: applyOptions, newAcc: newAcc, mergeInto: mergeInto
  };
}
