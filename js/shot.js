/*
 * KLD LONG DRIVE — 샷 모델
 * 게이지 입력(파워, 임팩트 오차)을 발사 조건으로 바꾸고, 바람을 만든다. DOM 무관(Node에서 테스트 가능).
 *
 * 파워 구간:  SAFE (90% 미만) / FULL (90~100%) / OVER (100~108%, 레드존)
 * 임팩트 오차 e = (탭 시각 − 스위트스팟 시각) ÷ 그 구간의 판정 창(ms).  음수 = 빠름(훅), 양수 = 늦음(슬라이스)
 */
(function (root) {
  'use strict';
  var KLD = root.KLD = root.KLD || {};

  function cfg() { return KLD.config; }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  var MPH_TO_MS = 0.44704;
  var YD = 0.9144;

  // ── 파워 ────────────────────────────────────────────────
  function zoneOf(p) {
    var g = cfg().gauge;
    if (p > 1.0005) return 'over';
    if (p >= g.fullFrom) return 'full';
    return 'safe';
  }

  // 파워 → 헤드 스피드(mph). vmax 를 주면 그 선수의 최고 스피드 기준.
  function clubSpeedMph(p, vmax) {
    var S = cfg().shot, g = cfg().gauge;
    vmax = vmax || cfg().player.clubSpeedMaxMph;
    p = clamp(p, 0, g.overMax);
    if (p > 1) return vmax * (1 + g.overSpeedPerUnit * (p - 1));
    return vmax * (S.speedFloor + (1 - S.speedFloor) * Math.pow(p, S.speedCurve));
  }

  /*
   * 파워 게이지 커서: 경과 시간(초) → { p, done, rising }
   * 처음 잠깐만 가속하고 이후 등속으로 0 ↔ maxP 를 왕복한다. maxP = 1 또는 레드존이 열려 있으면 1.08.
   */
  function cursorDistance(t) {
    var g = cfg().gauge, ease = g.powerEaseSec, rate = g.powerRate;
    t = Math.max(0, t);
    return t < ease ? rate * t * t / (2 * ease) : rate * (t - ease / 2);
  }
  function powerCursor(t, maxP) {
    var g = cfg().gauge;
    maxP = maxP || 1;
    var d = cursorDistance(t), span = 2 * maxP;
    if (d >= g.powerCycles * span) return { p: 0, done: true, rising: false };
    var pos = d % span;
    var rising = pos <= maxP;
    return { p: rising ? pos : span - pos, done: false, rising: rising };
  }
  // 첫 상승에서 파워 p 에 도달하는 시각(초) — 데모·봇용
  function timeToPower(p) {
    var g = cfg().gauge, ease = g.powerEaseSec, rate = g.powerRate;
    var knee = rate * ease / 2;
    return p < knee ? Math.sqrt(2 * ease * p / rate) : p / rate + ease / 2;
  }

  // ── 임팩트 판정 ──────────────────────────────────────────
  // e = 1 에 해당하는 시간(ms). scale = 라운드 보정 × 연속 실패 완충
  function windowMs(p, scale) {
    return cfg().gauge.windowMs[zoneOf(p)] * (scale || 1);
  }
  // 같은 값을 임팩트 바 길이 대비 비율로
  function windowHalf(p, scale) {
    return windowMs(p, scale) / 1000 / cfg().gauge.sweepSec;
  }
  function impactError(u, p, scale) {
    return (u - cfg().gauge.sweetPos) / windowHalf(p, scale);
  }
  function judge(e) {
    var g = cfg().gauge, a = Math.abs(e);
    if (a <= g.perfect) return 'perfect';
    if (a <= g.great) return 'great';
    if (a <= g.good) return 'good';
    return 'miss';
  }

  /*
   * 게이지 결과 → 발사 조건
   * input: { power, e, aim(도), traj: 'low'|'mid'|'high', vmax(선수 최고 헤드 스피드), spinScale(사이드스핀 배율) }
   */
  function buildLaunch(input, rand) {
    var S = cfg().shot;
    var gauss = KLD.px.gauss;
    rand = rand || Math.random;
    var p = clamp(input.power, 0, cfg().gauge.overMax);
    var e = clamp(input.e, -1.5, 1.5);
    var a = Math.abs(e);
    var quality = judge(e);
    var tr = S.traj[input.traj] || S.traj.mid;
    var noiseK = quality === 'perfect' ? 0 : (quality === 'great' ? 0.5 : 1);

    var club = clubSpeedMph(p, input.vmax);
    var loss = e < 0 ? S.smashLossEarly : S.smashLossLate;
    var smash = S.smashMax - loss * Math.pow(Math.min(a, 1), 1.5);
    if (a > 1) smash = lerp(smash, S.smashFloor, Math.min(1, (a - 1) / 0.5));
    if (quality === 'perfect') smash *= S.perfectBonus;
    var dirE = quality === 'perfect' ? e * S.perfectDirScale : e;
    if (e < 0) dirE *= (S.earlyDirScale == null ? 1 : S.earlyDirScale);

    var ballMph = club * smash * (1 + S.noise.speed * noiseK * gauss(rand));
    var launchAngle = tr.launch + S.launchPerE * e + S.noise.launch * noiseK * gauss(rand);
    var backspin = Math.max(S.spinFloor, tr.spin + S.spinPerE * e + S.noise.spin * noiseK * gauss(rand));
    var azimuth = (input.aim || 0) + S.azimuthPerE * dirE + S.noise.azimuth * noiseK * gauss(rand);
    var sidespin = S.sidespinPerE * dirE * (input.spinScale == null ? 1 : input.spinScale);
    var kind = 'normal';

    // 심한 미스: 빠르면 탑볼(쪼로), 늦으면 뽕샷(스카이볼)
    if (e <= -1.3) {
      kind = 'top';
      ballMph *= 0.62; launchAngle = 3 + 1.5 * rand(); backspin = 3800;
    } else if (e >= 1.3) {
      kind = 'sky';
      ballMph *= 0.7; launchAngle = 27 + 4 * rand(); backspin = 5200;
    }

    return {
      launch: {
        ballSpeed: ballMph * MPH_TO_MS,
        launchAngle: launchAngle,
        azimuth: azimuth,
        backspin: backspin,
        sidespin: sidespin
      },
      power: p, e: e, quality: quality, kind: kind, zone: zoneOf(p),
      clubSpeedMph: club, ballSpeedMph: ballMph, smash: ballMph / club
    };
  }

  // 물리 엔진에 넘길 환경
  function env(w) {
    return {
      windX: w.x, windZ: w.z,
      gridHalfWidth: cfg().rules.gridWidthYd * YD / 2,
      windProfile: cfg().windProfile
    };
  }

  /*
   * 바람: 기본값 + 잔물결 + 예고되는 돌풍
   * at(t) → { x, z, gust }   x: +순풍 m/s, z: +오른쪽으로 부는 바람 m/s
   *   gust = null | { phase: 'incoming', eta, dx, dz } | { phase: 'active', remain, dx, dz }
   */
  var GUST = { forecast: 4.0, rise: 0.8, hold: 3.0, fade: 1.2 };
  function createWind(rc, rand) {
    rand = rand || Math.random;
    var base = rc.wind, g = rc.gust;
    function osc(n) {
      var o = [];
      for (var i = 0; i < n; i++) o.push({ T: (i === 0 ? 9 : 3.3) + 4 * rand(), ph: rand() * 6.283, a: i === 0 ? 0.6 : 0.4 });
      return o;
    }
    var ox = osc(2), oz = osc(2);
    function wobble(o, t) {
      var s = 0;
      for (var i = 0; i < o.length; i++) s += o[i].a * Math.sin(6.283185 * t / o[i].T + o[i].ph);
      return s * 0.3;
    }
    var events = [], nextT = 5 + 4 * rand();
    function ensure(t) {
      if (!g) return;
      while (nextT < t + 30) {
        var sign = rand() < (g.favor == null ? 0.5 : g.favor) ? 1 : -1;
        events.push({
          t0: nextT,
          dx: sign * g.ax * (0.7 + 0.3 * rand()),
          dz: (rand() < 0.5 ? -1 : 1) * (g.az || 0) * (0.4 + 0.6 * rand())
        });
        nextT += 8 + 6 * rand();
      }
    }
    function envelope(dt) {
      if (dt < 0) return 0;
      if (dt < GUST.rise) return dt / GUST.rise;
      if (dt < GUST.rise + GUST.hold) return 1;
      if (dt < GUST.rise + GUST.hold + GUST.fade) return 1 - (dt - GUST.rise - GUST.hold) / GUST.fade;
      return 0;
    }
    return {
      cfg: rc,
      at: function (t) {
        ensure(t);
        var x = base.baseX + wobble(ox, t), z = base.baseZ + wobble(oz, t), info = null;
        for (var i = 0; i < events.length; i++) {
          var ev = events[i], dt = t - ev.t0;
          if (dt > GUST.rise + GUST.hold + GUST.fade) continue;
          if (dt < -GUST.forecast) break;
          var k = envelope(dt);
          x += ev.dx * k; z += ev.dz * k;
          // 잦아드는 돌풍은 안내 없이 넘어가고 다음 돌풍의 예고를 살핀다 (예고가 늦게 뜨지 않게)
          if (dt < 0) { info = { phase: 'incoming', eta: -dt, dx: ev.dx, dz: ev.dz }; break; }
          if (dt < GUST.rise + GUST.hold) { info = { phase: 'active', remain: GUST.rise + GUST.hold - dt, dx: ev.dx, dz: ev.dz }; break; }
        }
        return { x: x, z: z, gust: info };
      }
    };
  }

  // 옆바람을 상쇄하는 조준각(도) 근삿값 — CPU와 힌트용
  function idealAim(windZ) {
    var S = cfg().shot;
    var a = -windZ * S.aimPerWind;
    a = Math.round(a / S.aimStep) * S.aimStep;
    return clamp(a, -S.aimMax, S.aimMax);
  }

  var api = {
    MPH_TO_MS: MPH_TO_MS, YD: YD, GUST: GUST,
    zoneOf: zoneOf, clubSpeedMph: clubSpeedMph, powerCursor: powerCursor, timeToPower: timeToPower,
    windowMs: windowMs, windowHalf: windowHalf, impactError: impactError, judge: judge,
    buildLaunch: buildLaunch, env: env, createWind: createWind, idealAim: idealAim
  };
  KLD.shot = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
