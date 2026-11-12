/*
 * KLD LONG DRIVE - 골프공 탄도 시뮬레이션 (js/physics.js)
 *
 * 좌표: x = 전방(m), y = 위(m), z = 타깃을 바라본 골퍼 기준 오른쪽(m). 지면은 y = 0.
 * 단위: 내부는 전부 SI. 공은 (0, 0.03, 0) 에서 출발한다.
 * DOM / Math.random 을 쓰지 않는 결정적 계산 모듈 (브라우저 <script> 와 Node require 겸용).
 *
 * 사용법
 *   var r = KLD.physics.simulate(
 *     { ballSpeed: 98.3, launchAngle: 12, azimuth: 0, backspin: 2200, sidespin: 0 },   // m/s, deg, deg, rpm, rpm
 *     { windX: 2, windZ: -1 });                                                        // 생략한 값은 defaultEnv()
 *   r.carry / r.total / r.finalZ / r.inGrid / r.events ...
 *   var p = KLD.physics.positionAt(r, t);    // { x, y, z, phase: 'air' | 'ground' | 'rest' }
 *
 * 모델
 *  - 비행: 3차원 질점 + 중력 + 항력 + 마그누스 양력. 전부 공기 상대 속도(v - wind) 기준, RK4 고정 스텝(1/240 s).
 *    env.windProfile 을 주면 높이 y 에서의 바람 = (windX, windZ) * clamp(base + y / scale, min, max).
 *  - 공력 계수: 스핀 비 S = |omega| r / |v_rel| 의 포화형 함수 (Bearman & Harvey 풍동 곡선 꼴).
 *      Cd = max(cdMin, cd0 + cd1 S / (S + sd)),  Cl = cl1 S / (S + sl)
 *    계수는 TrackMan 투어 평균(PGA·LPGA 드라이버, 6번 아이언)과 장타(220 mph) 기준에 맞춰 보정했다.
 *    검증: S 0.085~0.284 구간은 공개된 현대 골프공 자료(Acushnet 특허 US 7,156,757 Table 1 중앙값)와 Cd +-9%, Cl +-2% 안에서 맞는다.
 *    한계: S < 0.085 (볼 스피드 200 mph 이상의 발사 직후)는 자료가 없는 외삽 구간이고, 220 mph 캐리 기준(385~405 yd)을 맞추려고
 *          항력을 풍동값(약 0.21)보다 낮게 잡았다 (S = 0.05 에서 Cd 0.169, 하한 0.16). 이 구간은 스핀이 적을수록 캐리가 꽤 늘어난다.
 *          무회전 공도 Cd = cdMin 이라 실제보다 덜 감속한다 (게임 샷은 1600 rpm 이상이라 해당 없음).
 *  - 스핀: 축은 월드 좌표에 고정, 크기는 시상수 25 s 로 지수 감쇠.
 *  - 지면: 첫 착지 -> 바운드 -> 구름 -> 정지. 러프(|z| > gridHalfWidth)는 덜 튀고 훨씬 빨리 멈춘다.
 *    착지 후에는 수평 진행 방향을 유지한다 (사이드스핀 킥 없음).
 */
(function (root) {
  'use strict';
  var KLD = root.KLD = root.KLD || {};

  // ---------------------------------------------------------------------------
  // 상수
  // ---------------------------------------------------------------------------
  var G = 9.81;                         // 중력 가속도 (m/s^2)
  var BALL_MASS = 0.04593;              // 공 질량 (kg)
  var BALL_RADIUS = 0.021335;           // 공 반지름 (m)
  var AIR_DENSITY = 1.225;              // 해수면 표준 공기 밀도 (kg/m^3)
  var YD_PER_M = 1 / 0.9144;            // 1 m = 1.09361 yd
  var MPH_PER_MS = 3600 / 1609.344;     // 1 m/s = 2.23694 mph
  var SAMPLE_DT = 1 / 120;              // 궤적 샘플 간격 (s)

  var TEE_HEIGHT = 0.03;                // 출발 높이 (m)
  var MAX_TIME = 40;                    // 시뮬레이션 시간 상한 (s)
  var MAX_SAMPLES = Math.round(MAX_TIME / SAMPLE_DT) + 1;
  var BALL_AREA = Math.PI * BALL_RADIUS * BALL_RADIUS;
  var DEG = Math.PI / 180;
  var RPM_TO_RAD = Math.PI / 30;

  // 입력 안전 범위 (이 밖의 값은 잘라 낸다)
  var MAX_BALL_SPEED = 150;             // m/s
  var MAX_SPIN = 20000;                 // rpm
  var MAX_WIND = 50;                    // m/s
  var MAX_WIND_SCALE = 5;               // 높이별 바람 배율 상한
  var MAX_AIR_DENSITY = 5;              // kg/m^3
  var MAX_TILT = 25 * DEG;              // 착지 자국 기울기 상한
  var MAX_BOUNCES = 60;                 // 바운드 횟수 상한 (넘으면 강제로 구름 전환)
  var MIN_BOUNCE_FLOOR = 0.05;          // minBounce 하한 (끝없는 잔바운드 방지, m/s)
  var TOP_FADE_DEG = 2;                 // 발사각이 이보다 낮으면 스핀을 줄인다 (0도 이하는 스핀 0 = 탑볼)

  var PHASE_AIR = 0, PHASE_BOUNCE = 1, PHASE_ROLL = 2, PHASE_REST = 3;

  // 샘플 기록용 작업 버퍼 (호출마다 필요한 길이만 복사해서 돌려준다)
  var scratch = new Float32Array(3 * MAX_SAMPLES);

  // ---------------------------------------------------------------------------
  // 유틸
  // ---------------------------------------------------------------------------
  function num(v, fallback) {
    return (typeof v === 'number' && isFinite(v)) ? v : fallback;
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  // dst 에 있는 키만, 유한한 숫자일 때만 덮어쓴다
  function mergeNumbers(dst, src) {
    if (!src || typeof src !== 'object') return;
    for (var k in dst) {
      if (Object.prototype.hasOwnProperty.call(dst, k) && typeof src[k] === 'number' && isFinite(src[k])) {
        dst[k] = src[k];
      }
    }
  }

  function mphToMs(v) { return v / MPH_PER_MS; }
  function msToMph(v) { return v * MPH_PER_MS; }
  function mToYd(v) { return v * YD_PER_M; }
  function ydToM(v) { return v / YD_PER_M; }

  // ---------------------------------------------------------------------------
  // 환경 기본값
  // ---------------------------------------------------------------------------
  function defaultEnv() {
    return {
      windX: 0,                 // m/s, + = 순풍 (공기가 +x 로 이동)
      windZ: 0,                 // m/s, + = 공기가 +z 로 이동 (공을 오른쪽으로 민다)
      windProfile: null,        // 높이별 바람 배율 { base, scale, min, max }. null 이면 높이와 무관하게 일정
      airDensity: AIR_DENSITY,  // kg/m^3
      gridHalfWidth: 27.432,    // m (30 yd). |z| 가 이 값 이하면 페어웨이(그리드), 넘으면 러프
      fairway: {
        restitution: 0.50,      // 약한 충돌의 반발계수
        restitutionMin: 0.24,   // 강한 충돌의 반발계수 (하한)
        restitutionSpeed: 8.0,  // 반발계수가 줄어드는 속도 척도 (m/s)
        tangentialLoss: 0.32,   // 바운드마다 잃는 접선(수평) 속도 비율의 상한 (공이 지면을 물 때)
        impactFriction: 0.50,   // 충돌 중 미끄럼 마찰계수 (얕고 약한 바운드의 손실을 제한)
        spinGrip: 0.29,         // 첫 착지에서 백스핀이 전진 속도를 깎는 정도 (r * omega 대비 비율)
        tilt: 0.30,             // 착지 충격으로 패이는 접촉면 기울기 (deg per m/s)
        rollFriction: 0.35,     // 구름 마찰계수
        minBounce: 1.0,         // 리바운드 수직 속도가 이보다 작으면 구름으로 전환 (m/s)
        stopSpeed: 0.1          // 이 속도 아래면 정지 (m/s)
      },
      rough: {
        restitution: 0.30,
        restitutionMin: 0.10,
        restitutionSpeed: 8.0,
        tangentialLoss: 0.60,
        impactFriction: 1.00,
        spinGrip: 0.29,
        tilt: 0.30,
        rollFriction: 1.00,
        minBounce: 1.0,
        stopSpeed: 0.1
      },
      // 공력 계수 (보정값): Cd = max(cdMin, cd0 + cd1 S / (S + sd)), Cl = cl1 S / (S + sl)
      aero: {
        cd0: 0.090,
        cd1: 0.415,
        sd: 0.213,
        cdMin: 0.16,            // 저스핀 영역 항력 하한
        cl1: 0.554,
        sl: 0.241,
        spinDecay: 25,          // 스핀 감쇠 시상수 (s)
        groundCd: 0.35          // 첫 착지 이후(바운드·구름) 항력계수
      },
      substeps: 2               // 샘플 간격당 적분 스텝 수 (2 -> 1/240 s, 2~16)
    };
  }

  function sanitizeSurface(s) {
    s.restitution = clamp(s.restitution, 0, 0.95);
    s.restitutionMin = clamp(s.restitutionMin, 0, 0.95);
    s.restitutionSpeed = Math.max(s.restitutionSpeed, 0.1);
    s.tangentialLoss = clamp(s.tangentialLoss, 0, 1);
    s.impactFriction = Math.max(s.impactFriction, 0);
    s.spinGrip = clamp(s.spinGrip, 0, 1);
    s.tilt = clamp(s.tilt, 0, 5);
    s.rollFriction = Math.max(s.rollFriction, 0);
    s.minBounce = Math.max(s.minBounce, MIN_BOUNCE_FLOOR);
    s.stopSpeed = Math.max(s.stopSpeed, 0.001);
  }

  // 높이별 바람 배율: k(y) = clamp(base + y / scale, min, max). 쓸 수 없는 값이면 null (일정한 바람)
  function resolveWindProfile(p) {
    if (!p || typeof p !== 'object') return null;
    var scale = num(p.scale, 0);
    var lo = clamp(num(p.min, 0), 0, MAX_WIND_SCALE);
    var hi = clamp(num(p.max, MAX_WIND_SCALE), lo, MAX_WIND_SCALE);
    return {
      base: clamp(num(p.base, 1), -MAX_WIND_SCALE, MAX_WIND_SCALE),
      scale: scale > 1e-6 ? scale : 0,   // 0 = 높이에 따른 변화 없음
      min: lo,
      max: hi
    };
  }

  // 받은 env 를 기본값 위에 덮어 새 객체로 만든다 (원본은 건드리지 않는다)
  function resolveEnv(env) {
    var e = defaultEnv();
    if (env && typeof env === 'object') {
      e.windX = num(env.windX, e.windX);
      e.windZ = num(env.windZ, e.windZ);
      e.airDensity = num(env.airDensity, e.airDensity);
      e.gridHalfWidth = num(env.gridHalfWidth, e.gridHalfWidth);
      e.substeps = num(env.substeps, e.substeps);
      e.windProfile = resolveWindProfile(env.windProfile);
      mergeNumbers(e.fairway, env.fairway);
      mergeNumbers(e.rough, env.rough);
      mergeNumbers(e.aero, env.aero);
    }
    e.windX = clamp(e.windX, -MAX_WIND, MAX_WIND);
    e.windZ = clamp(e.windZ, -MAX_WIND, MAX_WIND);
    e.airDensity = clamp(e.airDensity, 0, MAX_AIR_DENSITY);
    e.substeps = clamp(Math.round(e.substeps), 2, 16);
    sanitizeSurface(e.fairway);
    sanitizeSurface(e.rough);
    var a = e.aero;
    a.cd0 = clamp(a.cd0, 0, 2);
    a.cd1 = clamp(a.cd1, 0, 2);
    a.cdMin = clamp(a.cdMin, 0, 2);
    a.cl1 = clamp(a.cl1, 0, 2);
    a.sd = Math.max(a.sd, 1e-4);
    a.sl = Math.max(a.sl, 1e-4);
    a.spinDecay = Math.max(a.spinDecay, 0.1);
    a.groundCd = clamp(a.groundCd, 0, 2);
    return e;
  }

  // 공이 티에서 움직이지 않은 경우의 결과
  function teeResult() {
    return {
      samples: new Float32Array([0, TEE_HEIGHT, 0, 0, TEE_HEIGHT, 0]),
      sampleDt: SAMPLE_DT,
      count: 2,
      duration: SAMPLE_DT,
      carry: 0,
      carryZ: 0,
      flightTime: 0,
      apex: TEE_HEIGHT,
      apexX: 0,
      landingAngle: 0,
      landingSpeed: 0,
      total: 0,
      finalZ: 0,
      roll: 0,
      inGrid: false,
      events: [{ type: 'rest', t: SAMPLE_DT, x: 0, z: 0, speed: 0 }]
    };
  }

  // ---------------------------------------------------------------------------
  // 시뮬레이션
  // ---------------------------------------------------------------------------
  function simulate(launch, env) {
    var E = resolveEnv(env);
    var L = (launch && typeof launch === 'object') ? launch : {};

    var speed0 = clamp(num(L.ballSpeed, 0), 0, MAX_BALL_SPEED);
    if (!(speed0 > 0)) return teeResult();

    var elevDeg = clamp(num(L.launchAngle, 0), -90, 90);
    var elev = elevDeg * DEG;
    var azim = num(L.azimuth, 0) * DEG;
    // 탑볼: 발사각이 0도 이하면 스핀(양력) 없이 바로 떨어져 튀고 구른다. 0~2도 구간은 선형으로 잇는다
    var spinScale = clamp(elevDeg / TOP_FADE_DEG, 0, 1) * RPM_TO_RAD;
    var backspin = clamp(num(L.backspin, 0), -MAX_SPIN, MAX_SPIN) * spinScale;
    var sidespin = clamp(num(L.sidespin, 0), -MAX_SPIN, MAX_SPIN) * spinScale;

    var cosAz = Math.cos(azim), sinAz = Math.sin(azim), cosEl = Math.cos(elev);

    // --- 상태 ---
    var x = 0, y = TEE_HEIGHT, z = 0;
    var vx = speed0 * cosEl * cosAz, vy = speed0 * Math.sin(elev), vz = speed0 * cosEl * sinAz;
    var t = 0;
    var phase = PHASE_AIR;
    var landed = false;                   // 첫 착지 여부
    var bounces = 0;
    var dirX = cosAz, dirZ = sinAz;       // 지면에서의 진행 방향 (수평 단위 벡터)
    var rollSpeed = 0;

    // 스핀 벡터 omega = backspin * r + sidespin * (0, -1, 0),  r = (-sin az, 0, cos az)
    // 축(ux, uy, uz)은 월드 좌표에 고정하고 크기(spin)만 지수 감쇠시킨다
    var ox = -sinAz * backspin, oy = -sidespin, oz = cosAz * backspin;
    var spin = Math.sqrt(ox * ox + oy * oy + oz * oz);
    var ux = 0, uy = 0, uz = 0;
    if (spin > 0) { ux = ox / spin; uy = oy / spin; uz = oz / spin; }

    // --- 환경 ---
    var windX = E.windX, windZ = E.windZ;
    var WP = E.windProfile;
    var wpOn = !!WP;
    var wpBase = wpOn ? WP.base : 1, wpSlope = (wpOn && WP.scale > 0) ? 1 / WP.scale : 0;
    var wpMin = wpOn ? WP.min : 1, wpMax = wpOn ? WP.max : 1;
    var gridHalf = E.gridHalfWidth;
    var fairway = E.fairway, rough = E.rough;
    var A = E.aero;
    var cd0 = A.cd0, cd1 = A.cd1, sd = A.sd, cdMin = A.cdMin, cl1 = A.cl1, sl = A.sl;
    var groundCd = A.groundCd;
    var tau = A.spinDecay;
    var kAero = 0.5 * E.airDensity * BALL_AREA / BALL_MASS;
    var kRoll = kAero * groundCd;         // 구름 중 공기 저항 계수
    var substeps = E.substeps;
    var H = SAMPLE_DT / substeps;         // 적분 스텝
    var decayHalfH = Math.exp(-0.5 * H / tau);

    // --- 결과 누적 ---
    var events = [];
    var carry = 0, carryZ = 0, flightTime = 0, landingAngle = 0, landingSpeed = 0;
    var apex = y, apexX = x;

    // accel() 의 출력
    var accX = 0, accY = 0, accZ = 0;

    // 높이 py, 속도 (pvx, pvy, pvz), 스핀 크기 w(rad/s) 일 때의 가속도
    function accel(py, pvx, pvy, pvz, w) {
      var wx = windX, wz = windZ;
      if (wpOn) {
        var wk = wpBase + py * wpSlope;               // 높이별 바람 배율
        if (wk < wpMin) wk = wpMin; else if (wk > wpMax) wk = wpMax;
        wx *= wk; wz *= wk;
      }
      var rx = pvx - wx, ry = pvy, rz = pvz - wz;         // 공기 상대 속도
      var sp2 = rx * rx + ry * ry + rz * rz;
      if (sp2 < 1e-12) { accX = 0; accY = -G; accZ = 0; return; }
      var sp = Math.sqrt(sp2);
      var cd, cl = 0;
      if (landed) {
        cd = groundCd;                    // 착지 이후: 항력만
      } else {
        var S = w * BALL_RADIUS / sp;     // 스핀 비
        cd = cd0 + cd1 * S / (S + sd);
        if (cd < cdMin) cd = cdMin;
        cl = cl1 * S / (S + sl);
      }
      var q = kAero * sp;
      accX = -q * cd * rx;
      accY = -G - q * cd * ry;
      accZ = -q * cd * rz;
      if (cl > 0) {
        // 마그누스: 방향 = normalize(omega x v_rel), 크기 = 0.5 rho A Cl |v_rel|^2
        var cx = uy * rz - uz * ry, cy = uz * rx - ux * rz, cz = ux * ry - uy * rx;
        var cn2 = cx * cx + cy * cy + cz * cz;
        if (cn2 > 1e-12 * sp2) {
          var f = q * cl * sp / Math.sqrt(cn2);
          accX += f * cx; accY += f * cy; accZ += f * cz;
        }
      }
    }

    // RK4 한 스텝 (비행·바운드 공용)
    function flightStep(dt) {
      var half = 0.5 * dt;
      var dh = (dt === H) ? decayHalfH : Math.exp(-half / tau);
      var wMid = spin * dh, wEnd = wMid * dh;
      accel(y, vx, vy, vz, spin);
      var k1x = accX, k1y = accY, k1z = accZ;
      accel(y + half * vy, vx + half * k1x, vy + half * k1y, vz + half * k1z, wMid);
      var k2x = accX, k2y = accY, k2z = accZ;
      accel(y + half * (vy + half * k1y), vx + half * k2x, vy + half * k2y, vz + half * k2z, wMid);
      var k3x = accX, k3y = accY, k3z = accZ;
      accel(y + dt * (vy + half * k2y), vx + dt * k3x, vy + dt * k3y, vz + dt * k3z, wEnd);
      var c = dt * dt / 6, d6 = dt / 6;
      x += dt * vx + c * (k1x + k2x + k3x);
      y += dt * vy + c * (k1y + k2y + k3y);
      z += dt * vz + c * (k1z + k2z + k3z);
      vx += d6 * (k1x + 2 * k2x + 2 * k3x + accX);
      vy += d6 * (k1y + 2 * k2y + 2 * k3y + accY);
      vz += d6 * (k1z + 2 * k2z + 2 * k3z + accZ);
      spin = wEnd;
      t += dt;
    }

    // 스텝 [0, dt] 안에서 y 가 0 을 지나는 시각 (2차 보간)
    function contactTime(y0, vy0, y1, dt) {
      var tc = -1;
      var c = (y1 - y0 - vy0 * dt) / (dt * dt);
      if (Math.abs(c) > 1e-12) {
        var disc = vy0 * vy0 - 4 * c * y0;
        if (disc >= 0) {
          var sq = Math.sqrt(disc);
          var r1 = (-vy0 - sq) / (2 * c), r2 = (-vy0 + sq) / (2 * c);
          var lo = r1 < r2 ? r1 : r2, hi = r1 < r2 ? r2 : r1;
          if (lo > 1e-9 && lo <= dt) tc = lo;
          else if (hi > 1e-9 && hi <= dt) tc = hi;
        }
      }
      if (!(tc > 0)) tc = dt * y0 / (y0 - y1);   // 선형 보간으로 대체
      if (!(tc > 1e-9)) tc = 1e-9;
      if (tc > dt) tc = dt;
      return tc;
    }

    function surfaceAt(pz) {
      return Math.abs(pz) > gridHalf ? rough : fairway;
    }

    // 지면 접촉: 반발 + 접선 손실. 리바운드가 작으면 구름으로 전환한다
    function onContact() {
      var vn = -vy;                                   // 수직 충돌 속도
      if (vn < 0) vn = 0;
      var vt = Math.sqrt(vx * vx + vz * vz);          // 수평 속도
      var sp = Math.sqrt(vn * vn + vt * vt);
      var S = surfaceAt(z);
      if (vt > 1e-9) { dirX = vx / vt; dirZ = vz / vt; }

      var grip = 0;
      if (!landed) {
        landed = true;
        carry = x; carryZ = z; flightTime = t;
        landingSpeed = sp;
        landingAngle = Math.atan2(vn, vt) / DEG;
        events.push({ type: 'land', t: t, x: x, z: z, speed: sp });
        // 진행 방향 기준 백스핀 성분 omega . (-dirZ, 0, dirX) 이 전진 속도를 깎는다
        grip = S.spinGrip * BALL_RADIUS * spin * (uz * dirX - ux * dirZ);
        spin = 0;                                     // 이후로는 양력 없음
      } else {
        events.push({ type: 'bounce', t: t, x: x, z: z, speed: sp });
      }
      bounces++;

      // 착지 충격으로 접촉면이 공이 날아온 쪽으로 기운다 (Penner 의 런 모델을 단순화)
      var tilt = sp > 1e-9 ? S.tilt * DEG * vn * vt / sp : 0;
      if (tilt > MAX_TILT) tilt = MAX_TILT;
      var ct = Math.cos(tilt), st = Math.sin(tilt);
      var vnT = vn * ct + vt * st;                    // 기운 면 기준 수직 성분
      var vtT = vt * ct - vn * st;                    // 기운 면 기준 접선 성분
      if (vtT < 0) vtT = 0;

      // 반발계수: 충돌이 셀수록 작아진다
      var e = S.restitutionMin + (S.restitution - S.restitutionMin) * Math.exp(-vnT / S.restitutionSpeed);
      if (e > 0.95) e = 0.95;
      var vnOut = e * vnT;

      // 접선 손실: '물고 구르는' 한도(비율)와 미끄럼 마찰 임펄스 한도 중 작은 쪽
      var loss = S.tangentialLoss * vtT;
      var slip = S.impactFriction * (1 + e) * vnT;
      if (slip < loss) loss = slip;
      var vtOut = vtT - loss - grip;
      if (vtOut < 0) vtOut = 0;
      if (vtOut > vtT) vtOut = vtT;

      // 월드 좌표로 되돌린다. 수평 진행 방향은 유지 (사이드스핀 킥 없음)
      var hOut = vtOut * ct - vnOut * st;
      if (hOut < 0) hOut = 0;
      var upOut = vtOut * st + vnOut * ct;

      y = 0;
      if (upOut < S.minBounce || bounces >= MAX_BOUNCES) {
        // 구름 전환. 생략되는 잔바운드들이 잃었을 속도를 한 번에 뺀다 (전환 지점에서 결과가 튀지 않게)
        hOut -= S.impactFriction * (1 + e) * upOut / (1 - e);
        if (hOut < 0) hOut = 0;
        phase = PHASE_ROLL;
        rollSpeed = hOut;
        vx = dirX * hOut; vy = 0; vz = dirZ * hOut;
        events.push({ type: 'roll', t: t, x: x, z: z, speed: hOut });
      } else {
        phase = PHASE_BOUNCE;
        vx = dirX * hOut; vy = upOut; vz = dirZ * hOut;
      }
    }

    // 구름: 마찰 + 공기 저항으로 감속
    function rollStep(dt) {
      var S = surfaceAt(z);
      var a = S.rollFriction * G + kRoll * rollSpeed * rollSpeed;
      var vNew = rollSpeed - a * dt;
      var d;
      if (vNew > S.stopSpeed) {
        d = 0.5 * (rollSpeed + vNew) * dt;
        rollSpeed = vNew;
      } else {
        // 이번 스텝 안에서 멈춘다
        d = (vNew <= 0 && a > 0) ? 0.5 * rollSpeed * rollSpeed / a : 0.5 * (rollSpeed + vNew) * dt;
        rollSpeed = 0;
        phase = PHASE_REST;
      }
      x += dirX * d;
      z += dirZ * d;
      vx = dirX * rollSpeed; vz = dirZ * rollSpeed;
      t += dt;
    }

    // 고정 스텝 h 만큼 진행. 지면 접촉이 끼면 스텝을 쪼개 처리한다
    function advance(h) {
      var rem = h;
      var contacts = 0;
      while (rem > 1e-10 && phase !== PHASE_REST) {
        if (phase === PHASE_ROLL) { rollStep(rem); return; }
        var sx = x, sy = y, sz = z, svx = vx, svy = vy, svz = vz, sspin = spin, st = t;
        flightStep(rem);
        if (y >= 0) {
          if (!landed && y > apex) { apex = y; apexX = x; }
          return;
        }
        // 지면을 지났다: 접촉 시각까지만 다시 적분한다
        var tc = contactTime(sy, svy, y, rem);
        x = sx; y = sy; z = sz; vx = svx; vy = svy; vz = svz; spin = sspin; t = st;
        flightStep(tc);
        rem -= tc;
        onContact();
        if (++contacts > 4 && phase === PHASE_BOUNCE) {
          // 한 스텝 안에서 계속 튀는 경우: 구름으로 정리
          phase = PHASE_ROLL;
          rollSpeed = Math.sqrt(vx * vx + vz * vz);
          vy = 0;
          events.push({ type: 'roll', t: t, x: x, z: z, speed: rollSpeed });
        }
      }
    }

    // 시간 상한에 걸리면 그 자리에 세운다 (비현실적인 튜닝 값에서만 일어난다)
    function forceRest() {
      if (!landed) {
        var vn = vy < 0 ? -vy : 0;
        var vt = Math.sqrt(vx * vx + vz * vz);
        landed = true;
        carry = x; carryZ = z; flightTime = t;
        landingSpeed = Math.sqrt(vn * vn + vt * vt);
        landingAngle = Math.atan2(vn, vt) / DEG;
        events.push({ type: 'land', t: t, x: x, z: z, speed: landingSpeed });
      }
      y = 0; vx = 0; vy = 0; vz = 0; rollSpeed = 0;
      phase = PHASE_REST;
    }

    // --- 메인 루프: 샘플 간격마다 위치를 기록한다 ---
    var buf = scratch;
    buf[0] = x; buf[1] = y; buf[2] = z;
    var n = 1;
    for (;;) {
      for (var i = 0; i < substeps && phase !== PHASE_REST; i++) advance(H);
      if (phase !== PHASE_REST && n >= MAX_SAMPLES - 1) forceRest();
      var k = 3 * n;
      buf[k] = x; buf[k + 1] = y; buf[k + 2] = z;
      n++;
      if (phase === PHASE_REST) break;
    }

    var count = n;
    var samples = buf.slice(0, 3 * count);
    var last = 3 * (count - 1);
    var total = samples[last], finalZ = samples[last + 2];   // 마지막 샘플과 정확히 같은 값
    var duration = (count - 1) * SAMPLE_DT;
    events.push({ type: 'rest', t: duration, x: total, z: finalZ, speed: 0 });

    return {
      samples: samples,                 // Float32Array [x0, y0, z0, x1, y1, z1, ...]
      sampleDt: SAMPLE_DT,
      count: count,
      duration: duration,               // 정지까지 걸린 시간 = 마지막 샘플의 시각 (s)
      carry: carry,                     // 첫 착지 지점 x (m)
      carryZ: carryZ,
      flightTime: flightTime,
      apex: apex,                       // 첫 착지 전 최고 높이 (m)
      apexX: apexX,
      landingAngle: landingAngle,       // 첫 착지 때 수평 아래 각도 (deg, 양수)
      landingSpeed: landingSpeed,
      total: total,                     // 최종 정지 x (m) = 기록 거리
      finalZ: finalZ,
      roll: total - carry,
      inGrid: Math.abs(finalZ) <= gridHalf && total > 0,
      events: events                    // [{ type: 'land' | 'bounce' | 'roll' | 'rest', t, x, z, speed }]
    };
  }

  // ---------------------------------------------------------------------------
  // 재생용 위치 보간 (샘플 사이는 선형)
  // ---------------------------------------------------------------------------
  function positionAt(result, t) {
    var s = result.samples, n = result.count, dt = result.sampleDt;
    var last = 3 * (n - 1);
    if (t >= result.duration) {
      return { x: s[last], y: s[last + 1], z: s[last + 2], phase: 'rest' };
    }
    if (!(t > 0)) t = 0;                  // 음수·NaN 은 출발 시각으로
    var phase = t < result.flightTime ? 'air' : 'ground';
    var f = t / dt;
    var i = Math.floor(f);
    if (i > n - 2) i = n - 2;
    var a = f - i;
    if (a > 1) a = 1;
    var k = 3 * i;
    return {
      x: s[k] + (s[k + 3] - s[k]) * a,
      y: s[k + 1] + (s[k + 4] - s[k + 1]) * a,
      z: s[k + 2] + (s[k + 5] - s[k + 2]) * a,
      phase: phase
    };
  }

  // ---------------------------------------------------------------------------
  // 공개 API
  // ---------------------------------------------------------------------------
  var api = {
    CONST: {
      G: G,
      BALL_MASS: BALL_MASS,
      BALL_RADIUS: BALL_RADIUS,
      AIR_DENSITY: AIR_DENSITY,
      YD_PER_M: YD_PER_M,
      MPH_PER_MS: MPH_PER_MS,
      SAMPLE_DT: SAMPLE_DT,
      TEE_HEIGHT: TEE_HEIGHT,
      MAX_TIME: MAX_TIME
    },
    defaultEnv: defaultEnv,
    simulate: simulate,
    positionAt: positionAt,
    mphToMs: mphToMs,
    msToMph: msToMph,
    mToYd: mToYd,
    ydToM: ydToM
  };

  KLD.physics = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
