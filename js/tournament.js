/*
 * KLD LONG DRIVE — 대회 진행
 * 예선(16명 중 8명 통과) → 8강 → 준결승 → 결승.
 * 실제 장타 대회처럼 상대(CPU)가 6구 세트를 먼저 다 치고, 그 최고 기록이 "넘어야 할 기록"이 된다.
 * CPU도 플레이어와 같은 샷 모델·물리로 치며, 결과는 라운드 시작 때 확정된다(플레이어를 보고 바꾸지 않는다).
 * 플레이어와 다른 점: 선수마다 최고 헤드 스피드가 다르다 / 탑볼·뽕샷은 기록으로 치지 않는다 / 레드존이 없다(파워 100% 상한) /
 *   판정 창 배율과 완충이 없다(항상 ×1.0) / 시계가 없고, 공마다 후보 시각 몇 개 중 순풍이 가장 센 때를 골라 친다.
 * DOM 무관 (Node에서 밸런스 시뮬레이션 가능).
 */
(function (root) {
  'use strict';
  var KLD = root.KLD = root.KLD || {};

  function cfg() { return KLD.config; }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // 본선은 8강 대진(1-8, 4-5, 3-6, 2-7)으로 고정이다. 예선 통과 인원은 설정으로 바꿀 수 없다.
  var ADVANCE = 8;

  // 설정이 대회를 치를 수 있는 모양인지 본다. 문제가 있으면 설명 문자열, 없으면 ''.
  function checkConfig() {
    var c = cfg();
    if (!c.cpu || c.cpu.length < ADVANCE - 1) return 'config.cpu: CPU 선수는 ' + (ADVANCE - 1) + '명 이상이어야 합니다 (본선이 8강 대진이라서)';
    var bad = !c.rounds || c.rounds.length !== 4;
    for (var i = 0; !bad && i < 4; i++) {
      var r = c.rounds[i];
      if (!r || r.type !== (i === 0 ? 'field' : 'match') || !r.unlock || !r.wind) bad = true;
    }
    if (bad) return 'config.rounds: 예선(field) 1개와 매치(match) 3개(8강·준결승·결승) 순서여야 하고, 라운드마다 wind 와 unlock 이 있어야 합니다';
    return '';
  }

  function create(seed) {
    var rand = KLD.px.rng(seed || 1);
    var err = checkConfig();
    if (err) throw new Error(err);
    return {
      seed: seed, rand: rand,
      roundIndex: 0,
      roster: cfg().cpu.slice(),
      bracket: null,          // 예선 후 생성
      standings: null,        // 예선 최종 순위
      log: []                 // 라운드별 결과
    };
  }

  function roundConfig(T) { return cfg().rounds[T.roundIndex]; }

  // CPU가 바람을 보고 탄도를 고른다 (순풍엔 띄우고 맞바람엔 깐다)
  // 무풍에서는 세 탄도의 거리가 같게 맞춰져 있으므로, 맞바람이면 저탄도 · 순풍이면 고탄도가 가장 멀리 간다.
  // tests/balance.js 의 봇도 "바람에 맞는 탄도"를 이 함수로 정한다 (한쪽만 고치면 준결승 난이도가 5%p 넘게 움직인다).
  function pickTraj(windX, rc) {
    if (rc && rc.unlock && !rc.unlock.traj) return 'mid';
    if (windX < 0) return 'low';
    if (windX >= 0.2) return 'high';
    return 'mid';
  }

  // CPU 한 명의 한 세트를 시뮬레이션한다
  function simulateCpuSet(cpu, wind, rand, timeOffset) {
    var S = KLD.shot, PH = KLD.physics, gauss = KLD.px.gauss;
    var n = cfg().rules.ballsPerSet, rc = wind.cfg;
    var balls = [];
    for (var i = 0; i < n; i++) {
      // 바람을 잘 읽는 선수일수록 좋은 바람(순풍 돌풍)을 골라 친다: 후보 시각 몇 개 중 순풍이 가장 센 때
      var w = null, tries = 1 + Math.round((cpu.read || 0) * 2);
      for (var k = 0; k < tries; k++) {
        var cand = wind.at((timeOffset || 0) + i * 13.7 + rand() * 12);
        if (!w || cand.x > w.x) w = cand;
      }
      var p = clamp(cpu.power + cpu.powerSd * gauss(rand), 0.6, 1);
      var e = cpu.timingMs * gauss(rand) / S.windowMs(p, 1);            // 임팩트 타이밍 오차
      var aim = 0;
      if (!rc || !rc.unlock || rc.unlock.aim) {
        aim = S.idealAim(w.z * cpu.read) + (1 - cpu.read) * 1.2 * gauss(rand);
        aim = Math.round(aim / cfg().shot.aimStep) * cfg().shot.aimStep;
      }
      var built = S.buildLaunch({ power: p, e: e, aim: aim, traj: pickTraj(w.x, rc), vmax: cpu.speed }, rand);
      var res = PH.simulate(built.launch, S.env(w));
      // CPU 의 크게 빗맞은 공(탑볼·뽕샷)은 기록으로 치지 않는다. 실제 장타 대회에서 실수는 대개 그리드 밖으로 나가는 공이고,
      // 그래야 "여섯 개 중 절반쯤만 들어간다"는 종목의 모습이 나온다. (플레이어의 탑볼은 그리드 안에 멈추면 그대로 인정된다.)
      var valid = !!res.inGrid && built.kind === 'normal';
      balls.push({ total: res.total, z: res.finalZ, valid: valid, quality: built.quality, kind: built.kind, ballSpeedMph: built.ballSpeedMph });
    }
    return { cpu: cpu, balls: balls, best: bestAfter(balls, n), hits: balls.filter(function (b) { return b.valid; }).length };
  }

  // 처음 k구까지의 유효 최고 기록 (없으면 0)
  function bestAfter(balls, k) {
    var best = 0;
    for (var i = 0; i < Math.min(k, balls.length); i++) {
      if (balls[i].valid && balls[i].total > best) best = balls[i].total;
    }
    return best;
  }

  function nameOf(cpu) {
    var lang = KLD.i18n ? KLD.i18n.lang() : 'ko';
    return cpu.name[lang] || cpu.name.ko;
  }

  /*
   * 라운드 준비. 반환값 R:
   *   type 'field' : cpuSets = 15명 전원, target = 컷 라인(CPU 중 통과 인원 번째 기록)
   *   type 'match' : opponent, oppSet, target = 상대 최고 기록 (NUMBER TO BEAT)
   */
  function prepareRound(T, wind) {
    var c = roundConfig(T);
    var R = { cfg: c, type: c.type, index: T.roundIndex, wind: wind, target: 0 };
    var i;
    if (c.type === 'field') {
      R.cpuSets = [];
      for (i = 0; i < T.roster.length; i++) {
        R.cpuSets.push(simulateCpuSet(T.roster[i], wind, T.rand, i * 31.3));
      }
      var bests = R.cpuSets.map(function (s) { return s.best; }).sort(function (a, b) { return b - a; });
      R.target = bests[ADVANCE - 1] || 0;
    } else {
      var m = currentMatch(T);
      R.opponent = m.opponent;
      R.oppSeed = m.oppSeed;
      R.playerSeed = m.playerSeed;
      R.oppQual = m.oppQual;
      // 상대의 6구는 한 번뿐이다. 전부 놓치면 "기록 없음"이고, 플레이어는 공 하나만 살려도 이긴다 (실제 대회에서도 나오는 장면).
      R.oppSet = simulateCpuSet(m.opponent, wind, T.rand, 5.5);
      R.target = R.oppSet.best;
    }
    return R;
  }

  // 예선 순위 (CPU 최종 기록 + 플레이어 현재 기록)
  function fieldStanding(R, playerBest) {
    var entries = [], i;
    for (i = 0; i < R.cpuSets.length; i++) {
      var s = R.cpuSets[i];
      entries.push({ id: s.cpu.id, name: nameOf(s.cpu), best: s.best, isPlayer: false, cpu: s.cpu });
    }
    entries.push({ id: 'player', name: null, best: playerBest || 0, isPlayer: true });
    entries.sort(function (a, b) {
      if (b.best !== a.best) return b.best - a.best;
      return (b.isPlayer ? 1 : 0) - (a.isPlayer ? 1 : 0);          // 동률이면 플레이어 우선
    });
    var rank = 0;
    for (i = 0; i < entries.length; i++) {
      entries[i].rank = i + 1;
      if (entries[i].isPlayer) rank = i + 1;
    }
    return { entries: entries, rank: rank, cut: R.target };
  }

  // 8강 대진: 1-8, 4-5, 3-6, 2-7
  function buildBracket(T, entries) {
    var seeds = entries.slice(0, ADVANCE).map(function (e, i) {
      return { seed: i + 1, id: e.id, name: e.name, isPlayer: e.isPlayer, cpu: e.cpu || null, qual: e.best };
    });
    var order = [[0, 7], [3, 4], [2, 5], [1, 6]];
    T.bracket = {
      seeds: seeds,
      rounds: [order.map(function (p) { return { a: seeds[p[0]], b: seeds[p[1]], winner: null, aBest: 0, bBest: 0 }; })]
    };
  }

  // 현재 라운드에서 플레이어가 속한 경기
  function currentMatch(T) {
    var ri = T.roundIndex - 1;                       // 대진 라운드 번호 (0 = 8강)
    var matches = T.bracket.rounds[ri];
    for (var i = 0; i < matches.length; i++) {
      var m = matches[i];
      if (m.a.isPlayer) return { match: m, opponent: m.b.cpu, oppSeed: m.b.seed, oppQual: m.b.qual, playerSeed: m.a.seed, index: i };
      if (m.b.isPlayer) return { match: m, opponent: m.a.cpu, oppSeed: m.a.seed, oppQual: m.a.qual, playerSeed: m.b.seed, index: i };
    }
    return null;
  }

  // 같은 라운드의 다른 경기(CPU끼리)를 치르고 다음 라운드 대진을 만든다
  function resolveOthers(T, R) {
    var ri = T.roundIndex - 1;
    var matches = T.bracket.rounds[ri];
    for (var i = 0; i < matches.length; i++) {
      var m = matches[i];
      if (m.winner) continue;
      var sa = simulateCpuSet(m.a.cpu, R.wind, T.rand, 100 + i * 17);
      var sb = simulateCpuSet(m.b.cpu, R.wind, T.rand, 200 + i * 19);
      // 둘 다 기록이 없으면 플레이어의 매치와 똑같이 재경기를 치른다
      for (var re = 1; re <= 8 && !(sa.best > 0) && !(sb.best > 0); re++) {
        sa = simulateCpuSet(m.a.cpu, R.wind, T.rand, 100 + i * 17 + re * 41);
        sb = simulateCpuSet(m.b.cpu, R.wind, T.rand, 200 + i * 19 + re * 43);
      }
      m.aBest = sa.best; m.bBest = sb.best;
      m.winner = (sb.best > sa.best) ? m.b : m.a;      // 동률이면 대진표 위쪽 선수
    }
    if (matches.length > 1) {
      var next = [];
      for (i = 0; i < matches.length; i += 2) {
        next.push({ a: matches[i].winner, b: matches[i + 1].winner, winner: null, aBest: 0, bBest: 0 });
      }
      T.bracket.rounds[ri + 1] = next;
    }
  }

  /*
   * 라운드 종료. playerBest = 플레이어의 유효 최고 기록(m, 없으면 0)
   * 반환: { type, advanced, rematch, champion, ... }
   */
  function finishRound(T, R, playerBest) {
    var out = { type: R.type, roundIndex: T.roundIndex, roundId: R.cfg.id, playerBest: playerBest };
    if (R.type === 'field') {
      var st = fieldStanding(R, playerBest);
      out.entries = st.entries;
      out.rank = st.rank;
      out.cut = st.cut;
      out.advanced = playerBest > 0 && st.rank <= ADVANCE;
      out.finalRank = st.rank;
      if (out.advanced) { T.standings = st.entries; buildBracket(T, st.entries); }
    } else {
      var cm = currentMatch(T);
      var oppBest = R.oppSet.best;
      out.opponent = R.opponent;
      out.opponentName = nameOf(R.opponent);
      out.oppBest = oppBest;
      out.oppBalls = R.oppSet.balls;
      if (!(playerBest > 0) && !(oppBest > 0)) {
        out.rematch = true;                           // 둘 다 기록 없음 → 재경기
        out.advanced = false;
        return out;
      }
      out.advanced = playerBest > 0 && playerBest >= oppBest;   // 동률이면 플레이어 승
      var m = cm.match;
      var playerIsA = m.a.isPlayer;
      m.aBest = playerIsA ? playerBest : oppBest;
      m.bBest = playerIsA ? oppBest : playerBest;
      m.winner = out.advanced ? (playerIsA ? m.a : m.b) : (playerIsA ? m.b : m.a);
      resolveOthers(T, R);
      var last = cfg().rounds.length - 1;
      out.champion = out.advanced && T.roundIndex === last;
      // 최종 순위(탈락 시): 8강 5위, 4강 3위, 결승 2위
      if (!out.advanced) out.finalRank = [0, 5, 3, 2][T.roundIndex] || 2;
      else if (out.champion) out.finalRank = 1;
    }
    T.log.push(out);
    return out;
  }

  // 재도전(CONTINUE): 방금 진 라운드의 결과를 되돌린다
  function undoRound(T, R) {
    T.log.pop();
    if (R.type === 'match') {
      var ri = T.roundIndex - 1;
      var matches = T.bracket.rounds[ri];
      for (var i = 0; i < matches.length; i++) {
        if (matches[i].a.isPlayer || matches[i].b.isPlayer) { matches[i].winner = null; matches[i].aBest = 0; matches[i].bBest = 0; }
      }
      T.bracket.rounds.length = ri + 1;               // 다음 라운드 대진은 다시 만든다
    }
  }

  function advance(T) { T.roundIndex++; }

  var api = {
    ADVANCE: ADVANCE, checkConfig: checkConfig, pickTraj: pickTraj,
    create: create, roundConfig: roundConfig, prepareRound: prepareRound,
    simulateCpuSet: simulateCpuSet, bestAfter: bestAfter, fieldStanding: fieldStanding,
    finishRound: finishRound, undoRound: undoRound, advance: advance, currentMatch: currentMatch, nameOf: nameOf
  };
  KLD.tournament = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
