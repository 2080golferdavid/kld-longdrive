/*
 * KLD LONG DRIVE — 게임 본체 (상태 기계 · 입력 · 메인 루프)
 *
 * 한 공의 흐름 (탭 세 번):
 *   address ─탭①→ power(게이지 상승) ─탭②→ top(잠깐 멈춤) → downswing ─탭③→ hitstop
 *   → flight(비행·바운드·런) → result → 다음 공 또는 세트 종료
 */
(function (root) {
  'use strict';
  var KLD = root.KLD = root.KLD || {};
  var P = KLD.px, T = KLD.text, R = KLD.render, S = KLD.shot, TN = KLD.tournament, ST = KLD.storage;
  var YD = 0.9144;
  var THEME_ORDER = ['day', 'sunset', 'night', 'morning'];

  function t(k, v) { return KLD.i18n.t(k, v); }
  var vclock = null;          // 테스트용 가상 시계(초). null 이면 실제 시간.
  function now() { return vclock != null ? vclock : performance.now() / 1000; }
  function cfg() { return KLD.config; }
  function rules() { return KLD.config.rules; }
  function settings() { return ST.get().settings; }
  function track(ev, props) { try { if (cfg().track) cfg().track(ev, props || {}); } catch (e) { /* 분석 훅 오류는 무시 */ } }

  // ── 상태 ────────────────────────────────────────────────
  var G = {
    time: 0, mode: 'attract', theme: 'day', phase: 'idle', paused: false,
    showDeck: false, showHud: false, showTitle: true,
    cam: { x: 0 }, camTarget: 0, wind: { x: 0, z: 0, gust: null }, windLocked: false,
    golfer: { phase: 'address', b: 0, d: 0, f: 0, time: 0 },
    ball: { visible: true, onTee: true, x: 0, y: 0.03, z: 0, trail: [], mapPath: [] },
    gauge: { phase: null, cursor: 0, power: null, window: null, tapU: null, verdict: null },
    unlock: { aim: false, traj: false, over: false },
    aim: 0, traj: 'mid',
    set: null, roundLabel: '', targetInfo: null, markers: [],
    live: { visible: false }, banner: null, monitor: { visible: false }, toast: null, hint: '', coach: null,
    stamp: null, speedPop: null, clockPop: null, particles: [], fx: [], shake: null, flash: null, fade: 0,
    crowd: 0, unit: 'yd', muted: false, pressed: {}, mapMax: 500 * YD, reduceMotion: false,
    shot: null
  };
  var run = null;             // 진행 중인 대회/연습/워밍업
  var sw = null;              // 진행 중인 스윙(게이지) 정보
  var demo = { t: 0, shots: 0 };
  var timers = [];            // 지연 실행 [{ t, fn }]
  var toastQueue = [];
  var trans = null;           // 화면 전환(페이드)
  var hitstop = 0, resultT = 0, followT0 = 0, followF0 = 0, lastTick = 99, confetti = false;
  var lastFrame = 0, lockUntil = 0, lastInputAt = 0, holding = false, needTimer = 0;
  var aimRepeat = null, resizeTimer = null, pendingResize = false, firstSwingTracked = false;
  var holds = {}, holdCount = 0, aimId = null;   // 누르고 있는 포인터들(id → true)과 조준 버튼을 누른 포인터
  var pauseOpen = false, runOver = false;
  var offsets = null;         // 입력 지연 보정 (ms)

  // ── 오디오·진동 도우미 (모듈이 없어도 조용히 넘어간다) ─────────
  function quiet() { return G.mode === 'attract'; }
  function sfx(name, params) { if (!quiet() && KLD.audio && KLD.audio.sfx) KLD.audio.sfx(name, params); }
  function tone(v) { if (KLD.audio && KLD.audio.gaugeTone) KLD.audio.gaugeTone(quiet() ? null : v); }
  var wantedMusic = null;
  function setMusic(name) {
    wantedMusic = name;
    if (KLD.audio && KLD.audio.music) KLD.audio.music(settings().music ? name : null);
  }
  function unlockAudio() {
    if (KLD.audio && KLD.audio.unlock) {
      KLD.audio.unlock();
      KLD.audio.setMuted(G.muted);
    }
  }
  function vibrate(pattern) {
    if (quiet() || !settings().vibrate) return;
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* 미지원 */ }
  }

  // ── 공통 도우미 ──────────────────────────────────────────
  function teeCamX() { return -(R.V.W * 0.32) / R.PPM; }
  function after(sec, fn) { timers.push({ t: sec, fn: fn }); }
  function toast(text, color, dur) { toastQueue.push({ text: text, color: color, dur: dur || 2.2 }); }
  function distText(m, dec) { return R.distNum(m, G.unit, dec) + ' ' + R.unitLabel(G.unit); }
  function lockInput(sec) { lockUntil = Math.max(lockUntil, now() + sec); }
  function closeUi() { KLD.ui.hide(); lockInput(0.4); }
  function roundCfg() { return run && run.rc ? run.rc : cfg().practiceRound; }

  function newSet() {
    var rc = roundCfg();
    return {
      ballIndex: 0, balls: [], timeLeft: rules().setTimeSec, elapsed: 0, clockStarted: false,
      best: 0, bestIdx: -1, bestShot: null, count: 0, missStreak: 0,
      over: (rc.unlock && rc.unlock.over) ? cfg().gauge.overCharges : 0
    };
  }

  function resetBall() {
    G.ball = { visible: true, onTee: true, x: 0, y: 0.03, z: 0, trail: [], mapPath: [] };
  }

  function resetGauge() {
    var rc = roundCfg();
    G.gauge = {
      phase: null, cursor: 0, prevCursor: null, power: null, window: null, tapU: null, verdict: null,
      overShown: !!(rc.unlock && rc.unlock.over), overLeft: G.set ? G.set.over : 0, need: null, mph: 0
    };
  }

  function transition(fn, dur) {
    trans = { t: 0, dur: dur || 0.16, fn: fn, done: false };
  }

  // 판정 창 배율: 라운드 보정 × 연속 실패 완충 × 마지막 공 세이프 스윙
  function windowScale() {
    var rc = roundCfg(), A = cfg().assist;
    var s = rc.windowScale || 1;
    if (G.mode === 'attract') return s;
    s *= Math.min(A.max, 1 + A.perMiss * (G.set ? G.set.missStreak : 0));
    if (isSafeSwing()) s *= A.lastBallWindow;
    return s;
  }
  // 유효 기록 없이 마지막 공을 맞으면 '먼저 하나 살리자'
  function isSafeSwing() {
    return G.mode === 'tournament' && G.set && G.set.best <= 0 && G.set.ballIndex === rules().ballsPerSet - 1;
  }

  // ── 타깃(넘어야 할 기록)과 마커 ────────────────────────────
  function currentTarget() {
    if (!run || !G.set) return { x: 0, label: '' };
    if (G.mode === 'practice') return { x: ST.get().best, label: t('target.pb') };
    if (G.mode !== 'tournament' || !run.R) return { x: 0, label: '' };
    return { x: run.R.target, label: t(run.R.type === 'match' ? 'target.opp' : 'target.cut') };
  }
  function updateMarkers() {
    var list = [], tg = currentTarget();
    if (tg.x > 0) list.push({ x: tg.x, label: tg.label, color: R.COL.target, font: 'kos', shape: 'tri' });
    if (G.set && G.set.best > 0) list.push({ x: G.set.best, label: 'BEST', color: R.COL.best });
    G.markers = list;
    G.targetInfo = tg.label ? { label: tg.label, value: tg.x > 0 ? R.distNum(tg.x, G.unit) : '---' } : null;
    var far = Math.max(tg.x || 0, G.set ? G.set.best : 0);
    G.mapMax = (far > 470 * YD) ? 600 * YD : 500 * YD;
  }

  // 넘어야 할 기록에 필요한 최소 파워 (정타 기준). 이미 넘었거나 타깃이 없으면 null.
  function computeNeed() {
    var tg = currentTarget();
    if (!(tg.x > 0) || (G.set.best > tg.x) || !KLD.physics) return null;
    var C = cfg().gauge;
    var range = (G.unlock.over && G.set.over > 0) ? C.overMax : 1;
    var w = G.wind;
    function half() { return 0.5; }
    function totalAt(p) {
      var b = S.buildLaunch({ power: p, e: 0, aim: G.aim, traj: G.traj }, half);
      return KLD.physics.simulate(b.launch, S.env(w)).total;
    }
    if (totalAt(range) <= tg.x) return 9;
    var lo = 0.6, hi = range;
    if (totalAt(lo) > tg.x) return lo;
    for (var i = 0; i < 7; i++) {
      var mid = (lo + hi) / 2;
      if (totalAt(mid) > tg.x) hi = mid; else lo = mid;
    }
    return hi;
  }

  // 정타(풀파워)로 쳤을 때 공이 멈출 자리 — 미니맵에 표시해 조준과 탄도 선택을 돕는다
  function computePredict() {
    if (!KLD.physics || quiet()) return null;
    function half() { return 0.5; }
    var b = S.buildLaunch({ power: 1, e: 0, aim: G.aim, traj: G.traj }, half);
    var r = KLD.physics.simulate(b.launch, S.env(G.wind));
    return { x: r.total, z: r.finalZ, inGrid: !!r.inGrid };
  }

  // 이 판의 기록을 저장한다 (세트가 끝날 때마다, 그리고 도중에 그만둘 때).
  // 한 판은 기록 목록에 한 줄만 차지하고, 더 좋은 기록이 나오면 그 줄을 고쳐 쓴다.
  function persistRun(stage, won) {
    if (!run || !run.T) return;
    var d = ST.get();
    if (!run.counted) { run.counted = true; d.plays++; }
    if (won && !run.winCounted) { run.winCounted = true; d.wins++; }
    if (run.bestOverall > d.best) { d.best = run.bestOverall; run.pb = true; }
    if (stage > d.bestStage) d.bestStage = stage;
    if (run.bestOverall > 0) {
      var r = ST.upsertRun(run.entryTs, d.lastName || '', run.bestOverall, stage);
      run.entryTs = r.ts; run.rank = r.rank;
    }
    ST.save();
  }

  function busyPhase() {
    return G.phase === 'power' || G.phase === 'top' || G.phase === 'downswing' || G.phase === 'hitstop' || G.phase === 'flight';
  }

  // ── 화면 전환: 타이틀 / 워밍업 / 대회 / 연습 ─────────────────
  function resetCommon(mode) {
    // 대회를 도중에 그만두더라도 그때까지의 기록은 남긴다
    if (run && run.T && G.mode === 'tournament' && !run.finished) persistRun(run.T.roundIndex, false);
    // 아직 실행되지 않은 화면 전환은 버린다 (이전 모드의 콜백이 새 모드에서 터지지 않게)
    if (trans && !trans.done) { trans = null; G.fade = 0; }
    pauseOpen = false; runOver = false;
    G.mode = mode; G.paused = false; confetti = false;
    timers = []; toastQueue = []; G.toast = null; G.banner = null; G.fx = []; G.coach = null;
    G.speedPop = null; G.clockPop = null; G.stamp = null; G.windLocked = false; G.windClock = 0;
    tone(null);
  }

  function applyRound(rc) {
    run.rc = rc;
    G.theme = rc.theme;
    G.unlock = { aim: !!rc.unlock.aim, traj: !!rc.unlock.traj, over: !!rc.unlock.over };
    G.set = newSet(); G.aim = 0; G.traj = 'mid';
    G.showTitle = false; G.showDeck = true; G.showHud = true;
    G.live.visible = false; G.monitor.visible = false; G.hint = '';
  }

  function goTitle(fromBoot) {
    KLD.ui.hide();
    resetCommon('attract');
    // 게임을 시작할 때 쌓아 둔 뒤로가기 가드 항목을 되돌린다 (타이틀에서 뒤로가기가 헛돌지 않게)
    if (fromBoot !== true) {
      try { if (root.history.state && root.history.state.kld) root.history.back(); } catch (e) { /* 무시 */ }
    }
    G.showTitle = true; G.showDeck = false; G.showHud = false;
    run = { rc: { windowScale: 1, unlock: {}, theme: 'day' } };
    G.unlock = { aim: false, traj: false, over: false };
    G.theme = 'day'; G.set = newSet(); G.aim = 0; G.traj = 'mid';
    demo = { t: 0, shots: 0, wind: S.createWind({ wind: { baseX: 1.5, baseZ: 0.2 }, gust: null }) };
    toAddress(true);
    setMusic('title');
    KLD.ui.showTitle();
  }

  // 뒤로가기 한 번을 받아낼 히스토리 항목 (이미 있으면 또 쌓지 않는다)
  function pushGuard() {
    try {
      if (!(root.history.state && root.history.state.kld)) root.history.pushState({ kld: 1 }, '');
    } catch (e) { /* file:// 등에서는 무시 */ }
  }

  function startGame() {
    unlockAudio();
    track('start', { returning: !!ST.get().seenHowto });
    pushGuard();
    if (!ST.get().seenHowto) startWarmup(); else startTournament();
  }

  // 첫 방문자용 워밍업 2구: 설명서 대신 직접 쳐 보며 탭 세 번을 익힌다
  function startWarmup() {
    KLD.ui.hide();
    resetCommon('warmup');
    run = { warmup: true, bestOverall: 0, bestShot: null };
    run.wind = S.createWind(cfg().warmupRound);
    applyRound(cfg().warmupRound);
    G.roundLabel = t('round.warmup');
    setMusic('play');
    lockInput(0.4);
    toAddress(true);
  }

  function startTournament() {
    KLD.ui.hide();
    unlockAudio();
    resetCommon('tournament');
    run = {
      T: TN.create((Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0),
      bestOverall: 0, bestShot: null, continues: rules().continues, club: false, errs: { touch: [], mouse: [], key: [] }
    };
    beginRound();
  }

  function beginRound() {
    G.paused = false; pauseOpen = false;
    var rc = TN.roundConfig(run.T);
    run.wind = S.createWind(rc);
    run.R = TN.prepareRound(run.T, run.wind);
    applyRound(rc);
    G.roundLabel = t('round.' + rc.id);
    G.banner = null;
    G.phase = 'intro';
    G.golfer = { phase: 'address', b: 0, d: 0, f: 0, time: G.time };
    resetBall(); resetGauge();
    G.cam.x = G.camTarget = teeCamX();
    G.wind = run.wind.at(0); G.windLocked = false;
    updateMarkers();
    setMusic('play');
    KLD.ui.showRoundIntro(introData(rc), function () {
      closeUi();
      startSet();
    });
  }

  function introData(rc) {
    var d = {
      index: run.T.roundIndex, id: rc.id, label: t('round.' + rc.id), type: rc.type, unit: G.unit,
      rule: t('intro.rule', {
        balls: rules().ballsPerSet,
        time: R.clockText(rules().setTimeSec),
        w: G.unit === 'm' ? Math.round(rules().gridWidthYd * YD) + 'm' : rules().gridWidthYd + 'yd'
      }),
      windText: t('intro.wind.' + rc.id),
      tip: t('intro.tip.' + rc.id, { over: cfg().gauge.overCharges }),
      advance: TN.ADVANCE
    };
    if (rc.type === 'field') {
      d.desc = t('intro.qual', { n: run.T.roster.length + 1, k: TN.ADVANCE });
      d.target = run.R.target;
    } else {
      d.desc = t('intro.match');
      d.opponent = TN.nameOf(run.R.opponent);
      d.oppSpeed = run.R.opponent.speed;
      d.oppQual = run.R.oppQual;
      d.oppSeed = run.R.oppSeed;
      d.oppBalls = run.R.oppSet.balls;
      d.target = run.R.target;
    }
    return d;
  }

  function startSet() {
    G.banner = { text: 'GO!', color: R.COL.gold, t: 0.8, blink: true };
    sfx('countdown', { final: true });
    toAddress(true);
    // 옆바람이 센 라운드에서는 조준 요령을 한 번 알려 준다
    if (G.unlock.aim && Math.abs(G.wind.z) >= 1.5) toast(t(G.wind.z > 0 ? 'toast.aimLeft' : 'toast.aimRight'), R.COL.gold, 3.2);
  }

  function startPractice() {
    KLD.ui.hide();
    unlockAudio();
    resetCommon('practice');
    run = { practice: true, bestOverall: 0, bestShot: null };
    run.wind = S.createWind(cfg().practiceRound);
    applyRound(cfg().practiceRound);
    G.roundLabel = t('round.practice');
    G.windClock = 0;
    setMusic('play');
    lockInput(0.4);
    track('practice');
    toAddress(true);
  }

  // ── 어드레스 ─────────────────────────────────────────────
  function toAddress(snap) {
    if (pendingResize) { pendingResize = false; doResize(); }
    G.phase = 'address';
    G.golfer = { phase: 'address', b: 0, d: 0, f: 0, time: G.time };
    resetBall();
    if (G.mode === 'practice' && G.set) G.set.over = cfg().gauge.overCharges;
    resetGauge();
    G.live.visible = false; G.monitor.visible = false; G.windLocked = false;
    if (G.banner && !(G.banner.t > 0 && G.banner.t < 2)) G.banner = null;
    G.camTarget = teeCamX();
    if (snap) G.cam.x = G.camTarget;
    G.shot = null; sw = null; holding = false; needTimer = 0; G.predict = null;
    demo.t = 0;
    lockInput(cfg().gauge.lockout.addressSec);
    updateMarkers();
    setPrompt();
    if (isSafeSwing()) toast(t('toast.safe'), R.COL.gold, 2.6);
  }

  // 단계별 안내 문구 (워밍업은 큰 안내판, 그 외에는 깜빡이는 한 줄)
  function setPrompt() {
    G.coach = null; G.hint = '';
    if (quiet()) return;
    if (G.mode === 'warmup') {
      var first = G.set.ballIndex === 0;
      if (G.phase === 'address') G.coach = { text: t('coach.1'), sub: t(first ? 'coach.1s' : 'coach.again') };
      else if (G.phase === 'power') G.coach = { text: t('coach.2'), sub: t('coach.2s') };
      else if (G.phase === 'top' || G.phase === 'downswing') G.coach = { text: t('coach.3'), sub: t('coach.3s') };
      return;
    }
    if (G.phase === 'address') G.hint = t('hint.tap');
    else if (G.phase === 'power') G.hint = t('hint.power');
    else if (G.phase === 'top' || G.phase === 'downswing') G.hint = t('hint.impact');
  }

  // ── 스윙: 파워 → 톱 → 다운스윙 → 임팩트 ─────────────────────
  // 워밍업 첫 공은 게이지를 천천히 돌린다
  function gaugeSlow() { return (G.mode === 'warmup' && G.set.ballIndex === 0) ? 0.7 : 1; }

  function startPower(ts, kind) {
    if (G.mode === 'tournament' && G.set.timeLeft <= 0) return;
    var C = cfg().gauge;
    sw = {
      t0: ts, kind: kind || 'touch', slow: gaugeSlow(), scale: windowScale(),
      maxP: (G.unlock.over && G.set.over > 0) ? C.overMax : 1,
      wind: { x: G.wind.x, z: G.wind.z },                 // 결심한 순간의 바람으로 고정 (WIND LOCK)
      spinScale: isSafeSwing() ? cfg().assist.lastBallSpin : 1
    };
    G.windLocked = true;
    G.wind = { x: sw.wind.x, z: sw.wind.z, gust: null };
    if (G.set) G.set.clockStarted = true;
    G.phase = 'power';
    G.gauge.phase = 'power'; G.gauge.cursor = 0; G.gauge.power = null; G.gauge.tapU = null; G.gauge.verdict = null;
    setPrompt();
    sfx('gaugeStart');
    if (!firstSwingTracked && !quiet()) { firstSwingTracked = true; track('first_swing', { mode: G.mode }); }
  }

  function cancelSwing(retryHint) {
    tone(null);
    // 레드존으로 확정한 스윙이 취소되면 횟수를 돌려준다
    if (sw && sw.over && G.set) G.set.over = Math.min(cfg().gauge.overCharges, G.set.over + 1);
    sw = null;
    G.phase = 'address';
    G.windLocked = false;
    G.golfer = { phase: 'address', b: 0, d: 0, f: 0, time: G.time };
    resetGauge();
    setPrompt();
    if (retryHint && !quiet() && G.mode !== 'warmup') G.hint = t('hint.retry');
    lockInput(0.2);
  }

  function lockPower(ts) {
    var C = cfg().gauge;
    if (ts - sw.t0 < C.lockout.powerSec / sw.slow) return;          // 시작 탭의 손가락 바운스 무시
    var c = S.powerCursor((ts - sw.t0) * sw.slow, sw.maxP);
    if (c.done) { cancelSwing(false); return; }
    if (c.p < C.cancelBelow) { cancelSwing(true); sfx('uiBack'); return; }   // 너무 낮으면 취소 (공 소모 없음)
    var p = c.p;
    sw.p = p; sw.tLock = ts; sw.sweep = C.sweepSec / sw.slow; sw.top = C.topPauseSec / sw.slow;
    sw.win = S.windowHalf(p, sw.scale);
    if (p > 1.0005 && G.set) { G.set.over = Math.max(0, G.set.over - 1); sw.over = true; }
    G.gauge.power = p; G.gauge.phase = 'impact'; G.gauge.cursor = 0; G.gauge.prevCursor = null; G.gauge.window = sw.win;
    G.gauge.mph = S.clubSpeedMph(p); G.gauge.overLeft = G.set ? G.set.over : 0; G.gauge.need = null;
    G.phase = 'top';
    setPrompt();
    tone(null);
    sfx('powerSet', { power: Math.min(1, p) });
    if (sw.over) { toast('REDLINE!  ×' + G.set.over, R.COL.over, 1.4); vibrate([0, 20, 30, 20]); }
    else vibrate(15);
  }

  function doImpact(ts) {
    var C = cfg().gauge;
    var auto = (ts == null);
    var u = auto ? 1 : P.clamp((ts - sw.tSweep) / sw.sweep, 0, 1);
    var forced = sw.forceE != null;                                 // debug.shoot 가 오차를 직접 지정한 경우
    if (!auto && !forced && u < C.lockout.impactU) return;          // 파워 탭의 더블탭 무시
    var e = forced ? sw.forceE : (auto ? C.missE : S.impactError(u, sw.p, sw.scale));
    var p = sw.p;
    var warm1 = G.mode === 'warmup' && G.set.ballIndex === 0;
    if (warm1) { e = P.clamp(e, -0.45, 0.45); p = Math.max(p, 0.88); }   // 첫 공은 반드시 성공시킨다
    tone(null);
    var built = S.buildLaunch({ power: p, e: e, aim: G.aim, traj: G.traj, spinScale: sw.spinScale });
    var res = KLD.physics.simulate(built.launch, S.env(sw.wind));
    G.shot = { built: built, res: res, wind: sw.wind, t: 0, evIdx: 0, lastTrail: 0, prevY: 0, pastApex: false };

    // 판정 글자
    var q = built.quality, ms = Math.round((u - C.sweetPos) * sw.sweep * 1000);      // 실제로 빠르거나 늦은 시간
    var word, color;
    if (built.kind === 'top') { word = 'TOP!'; color = R.COL.bad; }
    else if (built.kind === 'sky') { word = 'SKY!'; color = R.COL.bad; }
    else if (q === 'perfect') { word = 'PERFECT!'; color = '#ffffff'; }
    else if (q === 'great') { word = e < 0 ? 'DRAW!' : 'FADE!'; color = R.COL.great; }
    else if (q === 'good') { word = e < 0 ? 'HOOK' : 'SLICE'; color = R.COL.good; }
    else { word = e < 0 ? 'BIG HOOK' : 'BIG SLICE'; color = R.COL.bad; }
    if (sw.over && q === 'perfect') { word = 'KLD SMASH!!'; color = R.COL.gold; }
    var gradeWord = q === 'perfect' ? 'PERFECT' : (q === 'great' ? 'GREAT' : (q === 'good' ? 'GOOD' : 'MISS'));
    G.gauge.phase = null; G.gauge.tapU = u;
    G.gauge.verdict = { text: gradeWord + (auto ? '' : ' ' + (ms > 0 ? '+' : '') + ms + 'MS'), color: color };
    G.stamp = { text: word, color: color, t: 1.1, dur: 1.1 };
    G.speedPop = { mph: built.ballSpeedMph, t: 1.25, dur: 1.25, color: q === 'perfect' ? R.COL.gold : '#ffffff' };
    sw.ms = ms; sw.auto = auto;

    // 시계: 공이 나는 시간 몫을 깎는다
    if (G.mode === 'tournament') {
      var cost = rules().flightClockCostSec;
      if (cost > 0) {
        G.set.timeLeft = Math.max(0, G.set.timeLeft - cost);
        G.clockPop = { text: '-' + cost, t: 1.0, dur: 1.0 };
      }
      if (!auto && Math.abs(ms) < 120 && run.errs[sw.kind]) run.errs[sw.kind].push(ms);
    }

    // 타격 연출: 등급이 높을수록 길고 세게
    var strong = q === 'perfect' ? 1 : (q === 'great' ? 0.55 : (q === 'good' ? 0.3 : 0));
    hitstop = q === 'perfect' ? 0.133 : (q === 'great' ? 0.083 : (q === 'good' ? 0.05 : 0.02));
    if (strong > 0) G.shake = { t: 0.1 + 0.14 * strong, dur: 0.1 + 0.14 * strong, mag: 1 + 3 * strong * Math.min(1, p) };
    if (q === 'perfect') G.flash = { t: 0.1, dur: 0.1, color: '#ffffff', alpha: 0.5 };
    sfx('impact', { quality: q, power: Math.min(1, p) });
    vibrate(q === 'perfect' ? [0, 30, 100, 80] : (q === 'great' ? 30 : (q === 'good' ? 15 : [0, 60, 50, 60])));
    spawnDust(0, 0, 5, ['#74c450', '#3c8f58', '#ffe9c2']);
    followF0 = (u > C.sweetPos) ? (u - C.sweetPos) / (1 - C.sweetPos) * 0.2 : 0;
    G.golfer = { phase: 'follow', b: Math.min(1, sw.p / C.overMax), d: 1, f: followF0, time: G.time };
    G.phase = 'hitstop';
    G.hint = ''; G.coach = null;
  }

  // ── 비행 ────────────────────────────────────────────────
  function startFlight() {
    G.phase = 'flight';
    G.ball.onTee = false;
    followT0 = G.time;
    G.shot.t = 0;
    G.shot.started = now();
    G.slow = false;
    G.crowd = 0.25;
    // 기록 경신 가능성이 없는 공은 정점 이후 빨리 넘긴다
    var res = G.shot.res, tg = currentTarget(), margin = cfg().pacing.dullMarginYd * YD;
    var ref = Math.max(G.set.best || 0, tg.x || 0);
    G.shot.dull = !quiet() && G.mode !== 'warmup' && (!res.inGrid || (ref > 0 && res.total < ref - margin));
    if (G.shot.built.quality === 'perfect' && !quiet()) after(0.3, function () { sfx('crowdCheer', { intensity: 0.5 }); G.crowd = 0.7; });
  }

  function updateFlight(dt) {
    var sh = G.shot, res = sh.res, PH = KLD.physics, PC = cfg().pacing;
    var tg = currentTarget();
    var refX = Math.max(tg.x || 0, G.set.best || 0);
    var gridHalf = rules().gridWidthYd * YD / 2;
    var near = refX > 0 && Math.abs(res.total - refX) < PC.nearMarginYd * YD && Math.abs(res.finalZ) <= gridHalf + 3;
    // 재생 속도: 기본 1.5배 / 지루한 공은 정점 이후 3배 / 누르고 있으면 4배 / 기록 근처에서 멈출 때는 슬로모션
    var scale = PC.flightSpeed;
    if (sh.dull && sh.pastApex) scale = PC.dullSpeed;
    var canHold = (now() - sh.started) > cfg().gauge.lockout.flightSec;
    if (holding && canHold) scale = PC.holdSpeed;
    G.slow = near && sh.onGround && (res.total - G.ball.x) < 9;
    if (G.slow) scale = PC.slowSpeed;
    if (quiet()) scale = 1.4;
    sh.t += dt * scale;
    var pos = PH.positionAt(res, sh.t);
    var b = G.ball;
    b.x = pos.x; b.y = Math.max(0, pos.y); b.z = pos.z;
    if (b.y < sh.prevY - 0.01) sh.pastApex = true;
    sh.prevY = b.y;
    sh.onGround = pos.phase !== 'air';

    // 궤적 점
    if (pos.phase === 'air' && sh.t - sh.lastTrail > 0.035) {
      sh.lastTrail = sh.t;
      b.trail.push({ x: b.x, y: b.y, z: b.z });
      if (b.trail.length > 46) b.trail.shift();
    } else if (pos.phase !== 'air' && b.trail.length) {
      b.trail.shift();
    }
    var mp = b.mapPath, lastP = mp[mp.length - 1];
    if (!lastP || Math.abs(b.x - lastP.x) > 7) mp.push({ x: b.x, z: b.z });

    // 착지·바운드 이벤트
    while (sh.evIdx < res.events.length && res.events[sh.evIdx].t <= sh.t) {
      var ev = res.events[sh.evIdx++];
      var inten = P.clamp((ev.speed || 0) / 35, 0.1, 1);
      if (ev.type === 'land') {
        sfx('land', { intensity: inten });
        spawnDust(ev.x, ev.z, 8, ['#ffe9c2', '#74c450', '#ffffff']);
        vibrate(12);
      } else if (ev.type === 'bounce') {
        sfx('bounce', { intensity: inten });
        if (inten > 0.2) spawnDust(ev.x, ev.z, 3, ['#74c450', '#ffe9c2']);
      }
    }

    // 실시간 거리
    var ahead = tg.x > 0 && b.x > tg.x;
    G.live = {
      visible: true, dist: Math.max(0, b.x),
      tag: pos.phase === 'air' ? 'CARRY' : 'RUN', color: ahead ? R.COL.gold : '#ffffff'
    };
    // 50야드 표지판을 지날 때마다 한 번씩
    var fifty = Math.floor(b.x / (50 * YD));
    if (fifty !== sh.lastFifty) { sh.lastFifty = fifty; if (fifty > 0 && pos.phase === 'air') sfx('distTick', { step: fifty }); }

    G.camTarget = Math.max(teeCamX(), b.x - (R.V.W * 0.45) / R.PPM);
    if (!quiet() && G.mode !== 'warmup' && canHold && !G.slow && sh.t > 1.5) G.hint = t('hint.ff'); else if (G.mode !== 'warmup') G.hint = '';

    if (sh.t >= res.duration) finishShot();
  }

  function finishShot() {
    var sh = G.shot, res = sh.res, built = sh.built, set = G.set;
    var valid = !!res.inGrid, total = res.total;
    var tg = currentTarget();
    var prevBest = set.best;
    var tourney = G.mode === 'tournament';
    var rec = {
      total: total, z: res.finalZ, valid: valid, carry: res.carry, roll: res.roll, quality: built.quality,
      ballSpeedMph: built.ballSpeedMph, clubSpeedMph: built.clubSpeedMph, smash: built.smash,
      launchAngle: built.launch.launchAngle, backspin: built.launch.backspin, apex: res.apex
    };
    if (tourney) set.balls[set.ballIndex] = rec;
    else {
      set.balls.push(rec);
      if (set.balls.length > 12) { set.balls.shift(); set.bestIdx--; }
    }
    set.count++;
    set.missStreak = (valid && built.quality !== 'miss') ? 0 : set.missStreak + 1;   // 살아남은 탑볼·뽕샷도 실패로 센다
    var isBest = valid && total > set.best;
    if (isBest) {
      set.best = total;
      set.bestIdx = tourney ? set.ballIndex : set.balls.length - 1;
      set.bestShot = rec;
    }
    var isMatch = tourney && run.R && run.R.type === 'match';
    // 넘어야 할 기록을 처음 넘긴 공. 매치에서 상대가 기록이 없으면(0) 유효타 하나로 충분하다.
    var beat = valid && total > tg.x && !(prevBest > tg.x) && (tg.x > 0 || isMatch);
    var pb = false;
    if (G.mode === 'practice' && valid && total > ST.get().best) { pb = true; ST.get().best = total; ST.save(); }
    if (run && isBest && total > run.bestOverall) { run.bestOverall = total; run.bestShot = rec; }
    var walkoff = isMatch && beat;
    var club = !quiet() && valid && total >= rules().clubLineYd * YD && run && !run.club;
    if (club) run.club = true;

    G.ball.x = total; G.ball.z = res.finalZ; G.ball.y = 0;
    G.live = { visible: false };
    G.slow = false; tone(null);

    // 배너
    var side = (res.finalZ < 0 ? 'L ' : 'R ') + R.distNum(Math.abs(res.finalZ), G.unit);
    if (valid) {
      // 상대가 기록이 없을 때의 워크오프는 "넘겼다"가 아니라 "넣었다"가 맞다
      var subKey = walkoff ? (tg.x > 0 ? 'res.walkoff' : 'res.in') : (pb ? 'res.pb' : (beat ? 'res.pass' : (isBest ? 'res.best' : 'res.in')));
      var sub2 = '';
      if (tg.x > 0 && tourney) {
        var diff = total - tg.x;
        sub2 = (diff >= 0 ? '+' : '-') + R.distNum(Math.abs(diff), G.unit) + ' ' + R.unitLabel(G.unit) + '  ' + t(diff >= 0 ? 'res.ahead' : 'res.behind', { who: tg.label });
      }
      G.banner = {
        text: distText(total), color: isBest ? R.COL.gold : '#ffffff', t: 99,
        sub: t(subKey), subColor: (beat || pb) ? R.COL.target : (isBest ? R.COL.gold : R.COL.ok),
        sub2: sub2, sub2Color: '#ffffff', blink: false
      };
    } else {
      G.banner = { text: 'OB', color: R.COL.bad, t: 99, sub: t('res.ob') + '  ' + side + ' ' + R.unitLabel(G.unit), subColor: '#ffd0cb', sub2: t('res.obDist', { v: distText(total) }) };
    }

    // 런치 모니터
    G.monitor = {
      visible: !quiet(),
      rows: [
        { label: t('mon.ball'), value: built.ballSpeedMph.toFixed(1) + ' MPH' },
        { label: t('mon.club'), value: built.clubSpeedMph.toFixed(0) + 'MPH ' + built.smash.toFixed(2), minor: true },
        { label: t('mon.launch'), value: built.launch.launchAngle.toFixed(1) + '° ' + Math.round(built.launch.backspin) + 'RPM', minor: true },
        { label: t('mon.carry'), value: distText(res.carry) + ' + ' + R.distNum(Math.max(0, res.roll), G.unit, 0) },
        { label: t('mon.side'), value: side + ' ' + R.unitLabel(G.unit), color: valid ? R.COL.ok : R.COL.bad }
      ]
    };

    // 소리·관중·선수 반응
    if (valid) {
      sfx('inGrid');
      if (beat || pb || club) { sfx('record'); fireworks(walkoff ? 7 : 4); G.flash = { t: 0.2, dur: 0.2, color: R.COL.gold, alpha: 0.3 }; }
      else if (isBest) sfx('newBest');
      sfx('crowdCheer', { intensity: (beat || pb) ? 1 : (isBest ? 0.7 : 0.4) });
      G.crowd = (beat || pb) ? 1 : (isBest ? 0.8 : 0.45);
      if (isBest) G.golfer = { phase: 'cheer', time: G.time };
      vibrate(beat ? [0, 40, 40, 40, 40, 200] : 15);
      if (club) toast(t('toast.club', { v: rules().clubLineYd }), R.COL.gold, 3);
    } else {
      sfx('ob'); sfx('crowdAww');
      G.crowd = 0;
      G.golfer = { phase: 'sad', time: G.time };
      G.flash = { t: 0.25, dur: 0.25, color: '#ff5a4d', border: true };
      vibrate([0, 60, 50, 60]);
    }
    if (quiet()) G.banner = null;                            // 타이틀 뒤 데모에서는 결과 글자를 띄우지 않는다 (로고와 겹친다)
    updateMarkers();
    G.phase = 'result';
    resultT = 0;
    sh.walkoff = walkoff;
    G.hint = ''; G.coach = null;
    if (G.mode === 'warmup') {
      // 워밍업: 얼마나 빠르고 늦었는지 바로 알려 준다
      G.monitor.visible = false;
      if (sw && !sw.auto) G.banner.sub2 = t(sw.ms > 0 ? 'coach.late' : 'coach.early', { ms: Math.abs(sw.ms) });
      if (!valid) G.banner.sub2 = t('coach.missSub');
    }
  }

  function nextBall() {
    if (G.phase !== 'result') return;
    var sh = G.shot;
    G.phase = 'wait';
    G.set.ballIndex++;
    if (G.mode === 'attract') {
      demo.shots++;
      transition(function () {
        if (G.set.ballIndex >= rules().ballsPerSet) G.set = newSet();
        G.theme = THEME_ORDER[demo.shots % THEME_ORDER.length];
        toAddress(true);
      });
      return;
    }
    if (G.mode === 'warmup') {
      if (G.set.ballIndex >= 2) {
        ST.get().seenHowto = true; ST.save();
        track('warmup_done');
        transition(startTournament);
      } else transition(function () { toAddress(true); });
      return;
    }
    var left = rules().ballsPerSet - G.set.ballIndex;
    var over = G.mode === 'tournament' && (left <= 0 || G.set.timeLeft <= 0);
    if (G.mode === 'tournament' && sh && sh.walkoff && !over && !run.walked) {
      // 워크오프: 상대 기록을 넘겼다. 남은 공을 더 칠지 고른다.
      run.walked = true;
      KLD.ui.showWalkoff({ left: left, best: distText(G.set.best) }, {
        onEnd: function () { closeUi(); endSet('walkoff'); },
        onMore: function () { closeUi(); transition(function () { toAddress(true); }); }
      });
      return;
    }
    if (over) { endSet((left <= 0 || (sh && sh.walkoff)) ? 'done' : 'timeup'); return; }
    transition(function () { toAddress(true); });
  }

  // ── 세트·라운드 종료 ─────────────────────────────────────
  function endSet(reason) {
    G.phase = 'setEnd';
    tone(null);
    G.hint = ''; G.windLocked = false;
    if (reason === 'timeup') {
      G.banner = { text: 'TIME UP', color: R.COL.bad, t: 99, blink: true };
      G.monitor.visible = false;
      sfx('timeUp');
    }
    run.walked = false;
    calibrateOffsets();
    var out = TN.finishRound(run.T, run.R, G.set.best);
    persistRun(stageOf(out), !!out.champion);
    track('set_end', { round: out.roundId, advanced: !!out.advanced, best: Math.round(G.set.best / YD) });
    after(reason === 'timeup' ? 1.6 : 0.45, function () { showRoundResult(out); });
  }

  // 임팩트 오차가 한쪽으로 쏠려 있으면 입력 지연 보정값을 조금 옮긴다 (라운드 사이에만)
  function calibrateOffsets() {
    var C = cfg().gauge, changed = false;
    ['touch', 'mouse', 'key'].forEach(function (k) {
      var a = run.errs[k];
      if (!a || a.length < 4) return;
      var s = a.slice().sort(function (x, y) { return x - y; });
      var med = s[Math.floor(s.length / 2)];
      if (Math.abs(med) >= 12) {
        offsets[k] = P.clamp(offsets[k] + C.offsetAdaptRate * med, 0, C.offsetMaxMs);
        changed = true;
      }
      run.errs[k] = [];
    });
    if (changed) { ST.get().offsets = offsets; ST.save(); }
  }

  function stageOf(out) {
    // 랭킹용 단계: 0 예선 탈락, 1 8강, 2 4강, 3 준우승, 4 우승
    if (out.champion) return 4;
    return out.advanced ? out.roundIndex + 1 : out.roundIndex;
  }

  function cardData(extra) {
    var d = {
      name: ST.get().lastName || '', best: run.bestOverall, unit: G.unit, shot: run.bestShot, theme: G.theme,
      bestText: run.bestOverall > 0 ? distText(run.bestOverall) : t('final.norec'),
      club: !!run.club, clubYd: rules().clubLineYd
    };
    for (var k in extra) d[k] = extra[k];
    return d;
  }

  function showRoundResult(out) {
    var roundLabel = t('round.' + out.roundId);
    var nextCfg = cfg().rounds[out.roundIndex + 1];
    function next() {
      closeUi();
      if (out.rematch) { transition(beginRound); return; }
      if (out.champion) { finishRun(true, out); return; }
      if (out.advanced) { TN.advance(run.T); transition(beginRound); return; }
      finishRun(false, out);
    }
    var nextLabel = out.rematch ? t('next.rematch')
      : (out.advanced && !out.champion && nextCfg ? t('next.round', { round: t('round.' + nextCfg.id) }) : t('next.result'));
    var share = (G.set.best > 0) ? function () {
      track('share_click', { at: out.roundId });
      KLD.share.open(cardData({ title: roundLabel + (out.type === 'field' ? ' ' + t('field.rank', { rank: out.rank }) : ''), won: false, stage: stageOf(out) }));
    } : null;
    setMusic('result');
    if (out.type === 'field') {
      sfx(out.advanced ? 'roundWin' : 'roundLose');
      KLD.ui.showFieldResult({ out: out, unit: G.unit, nextLabel: nextLabel, advance: TN.ADVANCE, onShare: share }, next);
    } else {
      if (!out.rematch) sfx(out.advanced ? 'roundWin' : 'roundLose');
      var others = [];
      var matches = run.T.bracket.rounds[out.roundIndex - 1] || [];
      for (var i = 0; i < matches.length; i++) {
        var m = matches[i];
        if (m.a.isPlayer || m.b.isPlayer || !m.winner) continue;
        others.push({ a: m.a.name, b: m.b.name, aBest: m.aBest, bBest: m.bBest, aWin: m.winner === m.a });
      }
      KLD.ui.showMatchResult({ out: out, roundLabel: roundLabel, unit: G.unit, nextLabel: nextLabel, others: others, onShare: share }, next);
    }
  }

  function finishRun(won, out) {
    var stage = stageOf(out);
    var best = run.bestOverall;
    persistRun(stage, won);
    run.finished = true; runOver = true;
    var titleKey = won ? 'final.champion' : (['final.qualOut', 'final.quarter', 'final.semi', 'final.second'][stage] || 'final.second');
    var title = t(titleKey, { rank: out.finalRank || out.rank || '' });
    var canContinue = !won && run.continues > 0;
    var data = {
      won: won, stage: stage, title: title, sub: won ? t('final.championSub') : '',
      best: best, bestText: best > 0 ? distText(best) : t('final.norec'), pb: !!run.pb && best > 0,
      shot: run.bestShot, unit: G.unit, lastName: ST.get().lastName, rank: run.rank || 0,
      club: !!run.club, clubYd: rules().clubLineYd,
      continueLabel: canContinue ? t('final.continue', { round: t('round.' + out.roundId), n: run.continues }) : ''
    };
    // 재도전(CONTINUE) 뒤에 다시 끝난 판은 continued: true 로 구분한다 (집계에서 한 판을 두 번 세지 않도록)
    track('run_end', { won: won, stage: stage, best: Math.round(best / YD), continued: run.continues < rules().continues });
    if (won) {
      setMusic('champion'); sfx('champion');
      confetti = true; fireworks(8);
      G.golfer = { phase: 'cheer', time: G.time };
      G.crowd = 1;
    } else {
      setMusic('result');
    }
    G.banner = null; G.monitor.visible = false;
    KLD.ui.showFinal(data, {
      onName: function (name) { if (run.entryTs) ST.renameEntry(run.entryTs, name); else { ST.get().lastName = ST.cleanName(name); ST.save(); } },
      onShare: function () { track('share_click', { at: 'final' }); KLD.share.open(cardData({ title: title, won: won, stage: stage, pb: data.pb })); },
      onContinue: function () {
        run.continues--; run.finished = false; runOver = false;
        TN.undoRound(run.T, run.R);
        track('continue', { round: out.roundId });
        closeUi();
        confetti = false;
        transition(beginRound);
      },
      onRetry: function () { track('retry'); startTournament(); },
      onTitle: goTitle
    });
  }

  // ── 이펙트 ──────────────────────────────────────────────
  function spawnDust(x, z, n, colors) {
    for (var i = 0; i < n; i++) {
      G.particles.push({
        x: x, y: 0.2, z: z,
        vx: (Math.random() - 0.3) * 9, vy: 3 + Math.random() * 6, vz: (Math.random() - 0.5) * 6,
        life: 0.35 + Math.random() * 0.4, color: colors[i % colors.length], size: Math.random() < 0.3 ? 2 : 1
      });
    }
  }

  function fireworks(count) {
    var L = R.layout(G.showDeck), cols = [R.COL.gold, '#ff8f85', R.COL.target, R.COL.ok, '#ffffff', '#ff8fb0'];
    for (var k = 0; k < count; k++) {
      (function (k) {
        after(k * 0.22, function () {
          var cx = L.world.x + 20 + Math.random() * (L.world.w - 40);
          var cy = L.world.y + 34 + Math.random() * Math.max(10, L.skyH * 0.5);
          var col = cols[Math.floor(Math.random() * cols.length)];
          for (var i = 0; i < 22; i++) {
            var a = i / 22 * Math.PI * 2, sp = 26 + Math.random() * 30;
            G.fx.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 46, life: 0.6 + Math.random() * 0.5, color: (i % 3) ? col : '#ffffff', size: (i % 4) ? 1 : 2 });
          }
          sfx('bounce', { intensity: 0.5 });
        });
      })(k);
    }
  }

  function updateFx(dt) {
    var i, p;
    for (i = G.particles.length - 1; i >= 0; i--) {
      p = G.particles[i];
      p.vy -= 22 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0) { p.y = 0; p.vy *= -0.3; p.vx *= 0.5; }
      p.life -= dt;
      if (p.life <= 0) G.particles.splice(i, 1);
    }
    if (confetti && G.fx.length < 220) {
      var cols = [R.COL.gold, '#ff8f85', R.COL.target, R.COL.ok, '#ffffff', '#ff8fb0'];
      for (i = 0; i < 2; i++) {
        G.fx.push({ x: Math.random() * R.V.W, y: -2, vx: (Math.random() - 0.5) * 16, vy: 18 + Math.random() * 26, g: 6, life: 4, color: cols[Math.floor(Math.random() * cols.length)], size: Math.random() < 0.4 ? 2 : 1 });
      }
    }
    for (i = G.fx.length - 1; i >= 0; i--) {
      p = G.fx[i];
      p.vy += (p.g || 0) * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0 || p.y > R.V.H + 4) G.fx.splice(i, 1);
    }
    if (G.shake) { G.shake.t -= dt; if (G.shake.t <= 0) G.shake = null; }
    if (G.flash) { G.flash.t -= dt; if (G.flash.t <= 0) G.flash = null; }
    if (G.stamp) { G.stamp.t -= dt; if (G.stamp.t <= 0) G.stamp = null; }
    if (G.speedPop) { G.speedPop.t -= dt; if (G.speedPop.t <= 0) G.speedPop = null; }
    if (G.clockPop) { G.clockPop.t -= dt; if (G.clockPop.t <= 0) G.clockPop = null; }
    if (G.banner && G.banner.t < 90) { G.banner.t -= dt; if (G.banner.t <= 0) G.banner = null; }
    if (G.toast) { G.toast.t -= dt; if (G.toast.t <= 0) G.toast = null; }
    if (!G.toast && toastQueue.length) {
      var q = toastQueue.shift();
      G.toast = { text: q.text, color: q.color, t: q.dur, dur: q.dur };
    }
    G.crowd = Math.max(0, G.crowd - dt * 0.35);
  }

  // ── 데모(타이틀 뒤에서 혼자 치는 선수) ──────────────────────
  function updateDemo(dt) {
    demo.t += dt;
    var C = cfg().gauge, tn = now();
    if (G.phase === 'address' && demo.t > 1.8) {
      demo.p = 0.93 + Math.random() * 0.07;
      demo.e = (Math.random() - 0.5) * 0.7;
      lockUntil = 0;
      startPower(tn, 'mouse');
      demo.lockAt = tn + S.timeToPower(demo.p);
    } else if (G.phase === 'power' && tn >= demo.lockAt) {
      lockPower(tn);
    } else if (G.phase === 'downswing') {
      var u = (tn - sw.tSweep) / sw.sweep;
      if (u >= C.sweetPos + demo.e * sw.win) doImpact(tn);
    } else if (G.phase === 'result' && resultT > 1.6) {
      nextBall();
    }
  }

  // ── 업데이트 ─────────────────────────────────────────────
  function update(dt) {
    var tn = now();
    G.time += dt;

    // 미뤄 둔 화면 크기 변경은 스윙·비행이 끝나는 대로(또는 오버레이가 뜨면) 반영한다
    if (pendingResize && (KLD.ui.isOpen() || G.paused || !busyPhase())) { pendingResize = false; doResize(); }

    // 화면 전환(페이드). 일시정지 중에는 멈춘다 (전환 콜백이 일시정지 메뉴를 덮어쓰지 않게).
    if (trans && !G.paused) {
      trans.t += dt;
      if (!trans.done && trans.t >= trans.dur) { trans.done = true; if (trans.fn) trans.fn(); }
      G.fade = trans.t < trans.dur ? trans.t / trans.dur : 1 - (trans.t - trans.dur) / trans.dur;
      if (trans.t >= trans.dur * 2) { trans = null; G.fade = 0; }
    }

    updateFx(dt);
    if (G.paused) return;

    // 지연 실행
    for (var i = timers.length - 1; i >= 0; i--) {
      timers[i].t -= dt;
      if (timers[i].t <= 0) { var fn = timers[i].fn; timers.splice(i, 1); fn(); }
    }

    if (G.mode === 'attract') updateDemo(dt);

    // 시계와 바람
    var swinging = (G.phase === 'power' || G.phase === 'top' || G.phase === 'downswing');
    var uiOpen = KLD.ui.isOpen();
    if (run && run.wind && !uiOpen) {
      if (G.mode === 'tournament') {
        if ((G.phase === 'address' || swinging) && G.set.clockStarted) {
          G.set.elapsed += dt;
          G.set.timeLeft = Math.max(0, G.set.timeLeft - dt);
          var sec = Math.ceil(G.set.timeLeft);
          if (sec <= 10 && sec !== lastTick && sec > 0) { lastTick = sec; sfx('tick'); }
          if (sec > 10) lastTick = 99;
          if (sec <= 30 && sec > 10 && !G.set.warned30) {
            G.set.warned30 = true;
            sfx('countdown', { final: false });
            toast(t('toast.time30', { s: sec, n: rules().ballsPerSet - G.set.ballIndex }), '#ffd0cb');
          }
          if (G.set.timeLeft <= 0 && G.phase === 'address') { endSet('timeup'); }
        } else if (G.phase === 'address') {
          G.set.elapsed += dt;                               // 첫 탭 전에는 시계는 멈춰 있고 바람만 흐른다
        }
        if (!G.windLocked && (G.phase === 'address' || G.phase === 'intro')) G.wind = run.wind.at(G.set.elapsed);
      } else {
        if (G.phase === 'address') G.windClock = (G.windClock || 0) + dt;
        if (!G.windLocked && G.phase === 'address') G.wind = run.wind.at(G.windClock || 0);
      }
    } else if (G.mode === 'attract' && demo.wind) {
      if (!G.windLocked && G.phase === 'address') G.wind = demo.wind.at(G.time);
    }

    // NEED 라인: 어드레스에서 0.5초마다 다시 계산
    if (G.phase === 'address' && G.mode === 'tournament' && !uiOpen) {
      needTimer -= dt;
      if (needTimer <= 0) { needTimer = 0.5; G.gauge.need = computeNeed(); G.predict = computePredict(); }
    } else if (G.phase === 'address' && G.mode === 'practice' && !uiOpen) {
      needTimer -= dt;
      if (needTimer <= 0) { needTimer = 0.5; G.predict = computePredict(); }
    }

    // 스윙 단계
    var C = cfg().gauge;
    if (G.phase === 'power') {
      var c = S.powerCursor((tn - sw.t0) * sw.slow, sw.maxP);
      if (c.done) cancelSwing(false);
      else {
        G.gauge.cursor = c.p;
        G.gauge.window = S.windowHalf(c.p, sw.scale);      // 파워 구간이 바뀌면 스위트스팟이 '철컥' 좁아진다
        G.gauge.mph = S.clubSpeedMph(c.p);
        G.golfer = { phase: 'backswing', b: Math.min(1, c.p / C.overMax), d: 0, f: 0, time: G.time };
        tone(Math.min(1, c.p / C.overMax));
      }
    } else if (G.phase === 'top') {
      G.golfer = { phase: 'backswing', b: Math.min(1, sw.p / C.overMax + 0.03 * P.clamp((tn - sw.tLock) / sw.top, 0, 1)), d: 0, f: 0, time: G.time };
      if (tn - sw.tLock >= sw.top) {
        sw.tSweep = sw.tLock + sw.top;
        G.phase = 'downswing';
        sfx('swing', { power: Math.min(1, sw.p) });          // 휘두르는 소리는 다운스윙 시작에 맞춘다
      }
    }
    if (G.phase === 'downswing') {
      var u = (tn - sw.tSweep) / sw.sweep;
      // 탭은 지연 보정만큼 이전 시각으로 판정되므로, 그만큼 더 기다린 뒤에야 '안 눌렀다'고 본다
      var grace = ((offsets && offsets[sw.kind]) || 0) / 1000 / sw.sweep;
      if (u >= 1 + grace) doImpact(null);
      else {
        u = Math.min(1, u);
        G.gauge.prevCursor = G.gauge.cursor;
        G.gauge.cursor = u;
        var bb = Math.min(1, sw.p / C.overMax);
        if (u <= C.sweetPos) G.golfer = { phase: 'downswing', b: bb, d: u / C.sweetPos, f: 0, time: G.time };
        else G.golfer = { phase: 'follow', b: bb, d: 1, f: (u - C.sweetPos) / (1 - C.sweetPos) * 0.2, time: G.time };
        tone(0.25 + 0.75 * u);
      }
    } else if (G.phase === 'hitstop') {
      hitstop -= dt;
      if (hitstop <= 0) startFlight();
    } else if (G.phase === 'flight') {
      updateFlight(dt);
    } else if (G.phase === 'result') {
      resultT += dt;
      if (!quiet() && G.mode !== 'warmup') G.hint = resultT > 0.9 ? t('hint.next') : '';
      var hold = G.mode === 'warmup' ? 5 : cfg().pacing.resultHoldSec;
      if (G.mode !== 'attract' && resultT > hold && !uiOpen) nextBall();
    }

    // 선수 애니메이션
    if (G.golfer.phase === 'follow' && (G.phase === 'flight' || G.phase === 'result' || G.phase === 'setEnd' || G.phase === 'wait')) {
      var k = P.clamp((G.time - followT0) / 0.5, 0, 1);
      G.golfer.f = followF0 + (1 - followF0) * (1 - Math.pow(1 - k, 2.4));
    }
    G.golfer.time = G.time;

    // 카메라
    var kcam = 1 - Math.exp(-dt * (G.phase === 'flight' ? 12 : 8));
    G.cam.x += (G.camTarget - G.cam.x) * kcam;
  }

  // ── 입력 ────────────────────────────────────────────────
  // 판정에 쓰는 탭 시각: 이벤트 시각에서 화면·터치 지연 보정값을 뺀다
  function evTime(e, kind) {
    var off = (offsets && offsets[kind] ? offsets[kind] : 0) / 1000;
    if (vclock != null) return vclock - off;                 // 가상 시계 테스트
    var ts = e && e.timeStamp, pn = performance.now();
    if (!(ts > 0) || ts > pn + 5 || pn - ts > 250) ts = pn;       // 일부 브라우저는 다른 시간축을 쓴다
    return ts / 1000 - off;
  }

  function action(ts, kind) {
    if (G.paused || trans || G.mode === 'attract') return;
    var tn = now();
    if (tn < lockUntil) return;
    switch (G.phase) {
      case 'address': startPower(ts, kind); break;
      case 'power': lockPower(ts); break;
      case 'downswing': doImpact(ts); break;
      case 'result': if (resultT > 0.55) nextBall(); break;
      default: break;                                        // top·hitstop·flight 중 탭은 무시 (비행은 누르고 있으면 빨리감기)
    }
  }

  function adjustAim(dir) {
    if (G.phase !== 'address' || G.mode === 'attract' || !G.unlock.aim) return;
    var Sx = cfg().shot;
    var v = P.clamp(Math.round((G.aim + dir * Sx.aimStep) / Sx.aimStep) * Sx.aimStep, -Sx.aimMax, Sx.aimMax);
    if (v !== G.aim) { G.aim = v; sfx('uiMove'); needTimer = 0; }
  }

  function cycleTraj(dir) {
    if (G.phase !== 'address' || G.mode === 'attract' || !G.unlock.traj) return;
    var order = ['low', 'mid', 'high'], i = order.indexOf(G.traj);
    if (dir === 0) i = (i + 1) % 3; else i = P.clamp(i + dir, 0, 2);
    if (order[i] !== G.traj) { G.traj = order[i]; sfx('uiMove'); needTimer = 0; }
  }

  function toggleMute() {
    G.muted = !G.muted;
    ST.setSetting('sound', !G.muted);
    if (KLD.audio) KLD.audio.setMuted(G.muted);
  }

  function resumeGame() { pauseOpen = false; closeUi(); G.paused = false; }

  // manual = 사용자가 직접 누른 일시정지(키·버튼·뒤로가기). 화면이 가려져서 멈추는 경우는 false.
  function pause(manual) {
    if (G.paused || G.mode === 'attract' || KLD.ui.isOpen()) return;
    // 파워를 확정한 뒤에는 직접 누른 일시정지로 스윙을 무를 수 없다 (공짜 다시 치기 방지)
    if (manual && (G.phase === 'top' || G.phase === 'downswing')) return;
    if (G.phase === 'power' || G.phase === 'top' || G.phase === 'downswing') cancelSwing(false);   // 공은 소모하지 않는다
    G.paused = true; releasePointer(null); pauseOpen = true;   // 누르고 있던 것(빨리감기·조준 반복)을 모두 놓은 것으로 친다
    tone(null);
    KLD.ui.showPause({ practice: G.mode !== 'tournament' }, {
      onResume: resumeGame,
      onRestart: function () { pauseOpen = false; G.paused = false; if (G.mode === 'practice') startPractice(); else startTournament(); },
      onQuit: function () { pauseOpen = false; G.paused = false; goTitle(); }
    });
  }

  function stopAimRepeat() { if (aimRepeat) { clearInterval(aimRepeat); clearTimeout(aimRepeat); aimRepeat = null; } }

  function onPointerDown(e) {
    if (KLD.ui.isOpen()) return;
    if (e.cancelable) e.preventDefault();
    var pn = performance.now();
    if (pn - lastInputAt < 60) return;                            // 중복 입력 무시
    lastInputAt = pn;
    var kind = (e.pointerType === 'mouse') ? 'mouse' : 'touch';
    var p = R.toInternal(e.clientX, e.clientY);
    var b = R.hit(p.x, p.y, G);
    var pid = (e.pointerId != null) ? e.pointerId : 'p';
    var primary = e.isPrimary !== false;                          // 첫 손가락(또는 마우스)
    // 새 첫 손가락이 닿았다는 것은 다른 손가락이 모두 떨어졌다는 뜻이다 → 놓친 pointerup 이 있었더라도 여기서 정리한다
    if (primary) { stopAimRepeat(); aimId = null; G.pressed.aimL = false; G.pressed.aimR = false; }
    var gaugePhase = (G.phase === 'power' || G.phase === 'top' || G.phase === 'downswing');
    // 스윙 중에는 화면 전체가 탭 영역 (작은 버튼을 잘못 눌러 공을 잃지 않게)
    if (!gaugePhase) {
      if (b === 'pause') { pause(true); return; }
      if (b === 'mute') { toggleMute(); return; }
      if (G.phase === 'address' && (b === 'aimL' || b === 'aimR' || b === 'traj')) {
        G.pressed[b] = true;
        if (b === 'traj') cycleTraj(0);
        else {
          var dir = b === 'aimL' ? -1 : 1;
          aimId = pid;
          adjustAim(dir);
          stopAimRepeat();
          aimRepeat = setTimeout(function () {
            aimRepeat = setInterval(function () { adjustAim(dir); }, 110);
          }, 330);
        }
        return;
      }
    }
    holdStart(pid, primary);
    if (G.showDeck) G.pressed.swing = true;
    action(evTime(e, kind), kind);
  }

  // 누르고 있기(빨리감기)는 화면에 닿아 있는 손가락을 하나하나 센다.
  // 두 엄지를 번갈아 쓰거나 두 번째 손가락이 잠깐 닿았다 떨어져도, 처음 손가락이 그대로면 끊기지 않는다.
  function holdStart(id, primary) {
    if (primary) { holds = {}; holdCount = 0; }
    if (!holds[id]) { holds[id] = true; holdCount++; }
    holding = true;
  }
  function holdEnd(id) {                                     // id 가 없으면 전부 뗀 것으로 본다
    if (id == null) { holds = {}; holdCount = 0; }
    else if (holds[id]) { delete holds[id]; holdCount--; }
    if (holdCount <= 0) { holdCount = 0; holding = false; G.pressed.swing = false; }
  }

  function releasePointer(e) {
    var pid = (e && e.pointerId != null) ? e.pointerId : null;
    G.pressed.traj = false;                                  // 탄도 버튼은 눌렀다 떼는 버튼
    holdEnd(pid);
    if (pid == null || pid === aimId) {                      // 조준 반복은 그 버튼을 누른 손가락이 떨어질 때만 멈춘다
      stopAimRepeat(); aimId = null;
      G.pressed.aimL = false; G.pressed.aimR = false;
    }
  }

  function onPointerUp(e) {
    releasePointer(e);
    unlockAudio();                                           // iOS는 손을 뗄 때의 이벤트만 오디오 잠금 해제로 인정한다
  }

  function onPointerCancel(e) {
    releasePointer(e);
  }

  function onKeyDown(e) {
    if (e.defaultPrevented || KLD.ui.isOpen()) return;       // 오버레이가 이미 처리한 키(Esc 등)는 건드리지 않는다
    var code = e.code || e.key;
    if (code === 'Space' || code === ' ' || code === 'Enter') {
      e.preventDefault();
      if (e.repeat) return;
      unlockAudio();
      holdStart('key', false);
      action(evTime(e, 'key'), 'key');
    } else if (code === 'ArrowLeft') { e.preventDefault(); adjustAim(-1); }
    else if (code === 'ArrowRight') { e.preventDefault(); adjustAim(1); }
    else if (code === 'ArrowUp') { e.preventDefault(); if (!e.repeat) cycleTraj(1); }
    else if (code === 'ArrowDown') { e.preventDefault(); if (!e.repeat) cycleTraj(-1); }
    else if (code === 'KeyM' || code === 'm') { if (!e.repeat) toggleMute(); }
    else if (code === 'Escape' || code === 'KeyP') { if (!e.repeat) pause(true); }
  }
  function onKeyUp(e) {
    var code = e.code || e.key;
    if (code === 'Space' || code === ' ' || code === 'Enter') holdEnd('key');
  }

  function doResize() {
    R.resize();
    KLD.ui.layout(R.V);
    // 공이 아직 티에 있으면 카메라를 티로 되돌리고, 날아가는 공·멈춘 공은 새 화면 폭에 맞춰 다시 잡는다
    if (!G.ball || G.ball.onTee) G.camTarget = teeCamX();
    else G.camTarget = Math.max(teeCamX(), G.ball.x - (R.V.W * 0.45) / R.PPM);
    G.cam.x = G.camTarget;
  }
  function onResize() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      resizeTimer = null;
      // 스윙·비행 중에는 판을 흔들지 않고 어드레스로 돌아올 때 반영한다
      var busy = !KLD.ui.isOpen() && !G.paused && busyPhase();
      if (busy && G.mode !== 'attract') pendingResize = true; else doResize();
    }, 150);
  }

  function onHidden() {
    if (vclock != null) return;                              // 가상 시계 테스트 중에는 자동 일시정지를 끈다
    // 탭을 닫거나 다른 앱으로 넘어가면 돌아오지 않을 수 있으니, 지금까지의 기록을 남겨 둔다
    if (run && run.T && G.mode === 'tournament' && !run.finished) persistRun(run.T.roundIndex, false);
    if (G.mode !== 'attract') pause(false);
    else if (G.phase === 'power' || G.phase === 'top' || G.phase === 'downswing') cancelSwing(false);
    tone(null);
    if (KLD.audio && KLD.audio.suspend) KLD.audio.suspend();
  }

  function bindInput(canvas) {
    if (root.PointerEvent) {
      canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
      root.addEventListener('pointerup', onPointerUp);
      root.addEventListener('pointercancel', onPointerCancel);
    } else {
      canvas.addEventListener('touchstart', function (e) {
        var tch = e.changedTouches[0];
        onPointerDown({ clientX: tch.clientX, clientY: tch.clientY, timeStamp: e.timeStamp, pointerType: 'touch', pointerId: tch.identifier, isPrimary: e.touches.length <= 1, cancelable: true, preventDefault: function () { e.preventDefault(); } });
      }, { passive: false });
      canvas.addEventListener('mousedown', function (e) {
        onPointerDown({ clientX: e.clientX, clientY: e.clientY, timeStamp: e.timeStamp, pointerType: 'mouse', pointerId: 'mouse', cancelable: true, preventDefault: function () { e.preventDefault(); } });
      });
      root.addEventListener('touchend', function (e) {
        for (var i = 0; i < e.changedTouches.length; i++) onPointerUp({ pointerId: e.changedTouches[i].identifier });
      });
      root.addEventListener('touchcancel', function () { onPointerCancel(null); });
      root.addEventListener('mouseup', function () { onPointerUp({ pointerId: 'mouse' }); });
    }
    root.addEventListener('keydown', onKeyDown);
    root.addEventListener('keyup', onKeyUp);
    root.addEventListener('resize', onResize);
    root.addEventListener('orientationchange', onResize);
    if (root.visualViewport) root.visualViewport.addEventListener('resize', onResize);
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
    // PC 트랙패드 핀치(ctrl+휠) 확대를 막는다
    root.addEventListener('wheel', function (e) { if (e.ctrlKey && e.cancelable) e.preventDefault(); }, { passive: false });
    // 뒤로가기 캐시에서 복원된 경우
    root.addEventListener('pageshow', function (e) {
      if (e && e.persisted) { lastFrame = now(); if (KLD.audio && KLD.audio.resume) KLD.audio.resume(); onResize(); }
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) onHidden();
      else {
        if (KLD.audio && KLD.audio.resume) KLD.audio.resume();
        lastFrame = now();
      }
    });
    root.addEventListener('pagehide', onHidden);
    // 뒤로가기: 대회 중이면 바로 나가지 않고 일시정지 메뉴를 연다
    root.addEventListener('popstate', function () {
      if (G.mode === 'attract') return;
      if (runOver) { goTitle(); return; }                    // 끝난 판의 결과 화면에서는 타이틀로
      pushGuard();
      if (pauseOpen && G.paused) resumeGame();               // 일시정지 메뉴에서는 닫기
      else if (!KLD.ui.isOpen()) pause(true);
    });
  }

  // ── 메인 루프 ────────────────────────────────────────────
  function loop() {
    var tn = now();
    var dt = Math.min(0.05, Math.max(0, tn - lastFrame));
    lastFrame = tn;
    try {
      if (vclock == null) update(dt);                        // 가상 시계 모드에서는 debug.step 이 진행시킨다
      R.frame(G);
    } catch (err) {
      if (root.console) console.error(err);
    }
    root.requestAnimationFrame(loop);
  }

  // ── 설정 변경 (UI에서 호출) ────────────────────────────────
  function applySettings() {
    var s = settings();
    KLD.i18n.setLang(s.lang);
    G.unit = s.unit;
    G.muted = !s.sound;
    if (KLD.audio) {
      KLD.audio.setMuted(G.muted);
      if (KLD.audio.music) KLD.audio.music(s.music ? wantedMusic : null);
    }
    if (G.mode === 'tournament' && run && run.R) G.roundLabel = t('round.' + run.R.cfg.id);
    else if (G.mode === 'practice') G.roundLabel = t('round.practice');
    else if (G.mode === 'warmup') G.roundLabel = t('round.warmup');
    if (G.set) updateMarkers();
    setPrompt();
  }

  function boot() {
    var canvas = document.getElementById('game');
    ST.load();
    var s = settings();
    KLD.i18n.setLang(s.lang);
    G.unit = s.unit; G.muted = !s.sound;
    var def = cfg().gauge.inputOffsetMs, saved = ST.get().offsets || {};
    offsets = {
      touch: isFinite(saved.touch) ? saved.touch : def.touch,
      mouse: isFinite(saved.mouse) ? saved.mouse : def.mouse,
      key: isFinite(saved.key) ? saved.key : def.key
    };
    try { G.reduceMotion = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { G.reduceMotion = false; }
    R.init(canvas);
    KLD.ui.init(document.getElementById('ui'), {
      onStart: startGame,
      onPractice: function () { unlockAudio(); pushGuard(); startPractice(); },
      onSettingsChanged: applySettings,
      onToggleMute: function () { toggleMute(); return G.muted; },
      isMuted: function () { return G.muted; },
      onInteract: unlockAudio
    });
    KLD.ui.layout(R.V);
    // 설정 실수는 시작 버튼을 누른 뒤가 아니라 여기서 바로, 화면에 보이게 드러낸다 (휴대폰에서는 콘솔을 볼 수 없다)
    var cfgError = TN.checkConfig();
    if (cfgError) {
      var box = document.getElementById('ui');
      box.classList.add('open');
      box.textContent = 'js/config.js 설정 오류 — ' + cfgError;
      box.style.padding = '16px';
      throw new Error(cfgError);
    }
    bindInput(canvas);
    if (KLD.audio) KLD.audio.setMuted(G.muted);
    goTitle(true);
    T.init(2500).then(function () { KLD.ui.refresh(); });
    track('load');
    lastFrame = now();
    root.requestAnimationFrame(loop);
  }

  var api = {
    G: G, boot: boot, goTitle: goTitle, startTournament: startTournament, startPractice: startPractice,
    startWarmup: startWarmup, applySettings: applySettings,
    // 브라우저 콘솔에서 쓰는 테스트 훅
    debug: {
      state: function () { return { mode: G.mode, phase: G.phase, set: G.set, run: run, sw: sw, offsets: offsets }; },
      run: function () { return run; },
      // 원하는 파워·오차로 한 번 친다 (어드레스 상태에서)
      shoot: function (p, e) {
        if (G.phase !== 'address') return false;
        var C = cfg().gauge, tn = now();
        lockUntil = 0;
        startPower(tn, 'mouse');
        if (!sw) return false;                               // 시계가 0 이면 스윙이 시작되지 않는다
        sw.p = p; sw.tLock = tn; sw.sweep = C.sweepSec; sw.top = C.topPauseSec; sw.win = S.windowHalf(p, sw.scale);
        if (p > 1.0005) { G.set.over = Math.max(0, G.set.over - 1); sw.over = true; }
        sw.forceE = e;                                       // 커서 위치와 무관하게 이 오차를 그대로 적용
        sw.tSweep = tn - P.clamp(C.sweetPos + e * sw.win, 0, 1) * sw.sweep;
        G.gauge.power = p; G.gauge.window = sw.win;
        G.phase = 'downswing';
        doImpact(tn);
        return true;
      },
      // 가상 시계: 화면이 가려져 프레임이 안 돌 때도 정해진 시간만큼 정확히 진행시킨다
      virtual: function (on) { vclock = on ? performance.now() / 1000 : null; lastFrame = now(); return vclock; },
      step: function (dt, n) {
        if (vclock == null) vclock = performance.now() / 1000;
        for (var i = 0; i < (n || 1); i++) { vclock += dt; update(dt); }
        R.frame(G);
        return G.phase;
      },
      // 가상 시계에서 phase 가 바뀔 때까지(또는 maxSec) 진행
      runUntil: function (phase, maxSec) {
        var tEnd = (maxSec || 30), acc = 0;
        if (vclock == null) vclock = performance.now() / 1000;
        while (G.phase !== phase && acc < tEnd) { vclock += 1 / 60; update(1 / 60); acc += 1 / 60; }
        R.frame(G);
        return { phase: G.phase, sec: acc };
      },
      // 앞 라운드를 이긴 것으로 치고 원하는 라운드로 건너뛴다 (1 = 8강, 2 = 준결승, 3 = 결승)
      jump: function (ri) {
        startTournament();
        for (var i = 0; i < ri; i++) {
          TN.finishRound(run.T, run.R, 460);
          TN.advance(run.T);
          run.wind = S.createWind(TN.roundConfig(run.T));
          run.R = TN.prepareRound(run.T, run.wind);
        }
        beginRound();
        return run.T.roundIndex;
      },
      hold: function (v) { if (v) holdStart('debug', false); else holdEnd('debug'); },
      next: function () { resultT = 9; nextBall(); },
      setTime: function (v) { if (G.set) G.set.timeLeft = v; },
      action: function () { lockUntil = 0; action(now(), 'mouse'); },
      unlockInput: function () { lockUntil = 0; }
    }
  };
  KLD.game = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
