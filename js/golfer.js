/*
 * KLD LONG DRIVE — 절차적 픽셀 골퍼
 * 스프라이트 시트 대신 관절 각도로 자세를 계산해 픽셀로 찍는다.
 * 구도: 선수가 카메라를 마주 보고 서서 화면 오른쪽으로 친다.
 *
 * 스윙 각도 규약 (화면 좌표, y는 아래로 +):
 *   theta = 어깨 축에서 손까지의 방향. 0° = 정아래, 음수 = 화면 왼쪽(백스윙), 양수 = 오른쪽(팔로스루)
 *   phi   = 손에서 클럽 헤드까지의 방향. 같은 규약.
 *   방향 벡터 = (sin a, cos a)
 */
(function (root) {
  'use strict';
  var KLD = root.KLD = root.KLD || {};

  var BUF_W = 112, BUF_H = 86, OX = 50, OY = 76;   // 버퍼 안에서 발 중심의 위치
  var BALL_DX = 9, BALL_DY = -3;                    // 발 중심 기준 공 위치
  var D2R = Math.PI / 180;

  // 팔·클럽 각도 키프레임
  var BACK_T = [[0, 6], [0.25, -35], [0.5, -80], [0.75, -120], [1, -152]];
  var BACK_P = [[0, 20], [0.25, -48], [0.5, -150], [0.75, -228], [1, -288]];
  var IMP_T = 8, IMP_P = 20;
  var FOL_T = [[0, 8], [0.2, 48], [0.45, 95], [0.7, 128], [1, 146]];
  var FOL_P = [[0, 20], [0.2, 95], [0.45, 180], [0.7, 248], [1, 292]];

  // 몸통 자세 키: [hipX, hipY, shX, shY, shHalf, headX, headY, kneeLX, kneeLY, kneeRX, kneeRY, footRX, heelR, face]
  var BODY_ADDRESS = [0, -19, -1, -32, 6, -1, -39.5, 6.5, -9.5, -6.5, -9.5, -8, 0, 0];
  var BODY_TOP     = [-1.5, -19, -3, -32, 3.2, -2, -39.5, 4, -9.5, -7, -10, -8, 0, -0.3];
  var BODY_IMPACT  = [3, -19.5, 0.5, -31.5, 5.5, -1.5, -39, 7.5, -10, -3, -9, -8, 1.5, 0];
  var BODY_FINISH  = [5.5, -20.5, 5.5, -33.5, 3, 6, -41, 8, -10.5, 1.5, -8.5, -5, 3, 1];
  var BODY_SAD     = [0, -18.5, 0, -30.5, 5.5, 0.5, -36.5, 6, -9, -6, -9, -8, 0, 0];
  var BODY_CHEER   = [1, -20, 1, -33.5, 5.5, 1.5, -41.5, 6.5, -10, -5.5, -10, -8, 0, 0.4];

  function lerpBody(a, b, t) {
    var o = new Array(a.length);
    for (var i = 0; i < a.length; i++) o[i] = a[i] + (b[i] - a[i]) * t;
    return o;
  }

  /*
   * state: {
   *   phase: 'address' | 'backswing' | 'downswing' | 'follow' | 'cheer' | 'sad',
   *   b: 백스윙 진행(0~1, 1 = 풀 오버스윙), d: 다운스윙 진행(0~1, 1 = 임팩트), f: 팔로스루 진행(0~1),
   *   time: 초 (대기 동작용)
   * }
   */
  function pose(s) {
    var px = KLD.px;
    var kf = px.keyframe, smooth = px.smooth, lerp = px.lerp;
    var t = s.time || 0;
    var theta, phi, body, snap = 0, club = true, raise = 0;

    if (s.phase === 'backswing') {
      theta = kf(BACK_T, s.b); phi = kf(BACK_P, s.b);
      body = lerpBody(BODY_ADDRESS, BODY_TOP, smooth(s.b));
    } else if (s.phase === 'downswing') {
      var topT = kf(BACK_T, s.b), topP = kf(BACK_P, s.b);
      var d = px.clamp(s.d, 0, 1);
      theta = lerp(topT, IMP_T, Math.pow(d, 1.35));
      // 손목 래그: 클럽은 팔보다 늦게 풀린다
      var rel = lerp(topP - topT, IMP_P - IMP_T, d * d * d);
      phi = theta + rel;
      body = lerpBody(lerpBody(BODY_ADDRESS, BODY_TOP, smooth(s.b)), BODY_IMPACT, smooth(d));
      snap = smooth((d - 0.82) / 0.18);
    } else if (s.phase === 'follow') {
      var f = px.clamp(s.f, 0, 1);
      theta = kf(FOL_T, f); phi = kf(FOL_P, f);
      body = lerpBody(BODY_IMPACT, BODY_FINISH, smooth(f));
      snap = 1 - smooth(f / 0.07);
      if (f >= 1) {                                   // 피니시에서 살짝 흔들리며 공을 바라본다
        theta += Math.sin(t * 1.6) * 1.2;
        body[6] += Math.sin(t * 1.6) * 0.3;
      }
    } else if (s.phase === 'cheer') {
      theta = 4; phi = 6;
      body = BODY_CHEER.slice();
      var hop = Math.abs(Math.sin(t * 7)) * 2;
      body[1] -= hop; body[3] -= hop; body[6] -= hop;
      raise = 1;
    } else if (s.phase === 'sad') {
      theta = 2; phi = 4;
      body = BODY_SAD.slice();
      body[6] += Math.sin(t * 1.3) * 0.3;
    } else {                                          // address: 왜글
      theta = 6 + Math.sin(t * 2.3) * 1.4;
      phi = 20 + Math.sin(t * 2.3 + 0.7) * 5;
      body = BODY_ADDRESS.slice();
      var bob = Math.sin(t * 1.9) * 0.45;
      body[1] += bob; body[3] += bob * 0.6; body[6] += bob * 0.6;
    }

    var hipX = body[0], hipY = body[1], shX = body[2], shY = body[3], shHalf = body[4];
    var pivotX = shX, pivotY = shY + 1;
    // 백스윙 톱과 피니시에서는 팔이 접힌다
    var fold = smooth((Math.abs(theta) - 95) / 55);
    var armL = 13 - 2.2 * fold;
    var hx = pivotX + armL * Math.sin(theta * D2R);
    var hy = pivotY + armL * Math.cos(theta * D2R);
    // 어드레스·임팩트 부근에서는 클럽이 카메라 쪽으로 누워 짧게 보인다
    var lc = 18 + 9 * smooth((Math.abs(theta) - 14) / 55);
    var cx = hx + lc * Math.sin(phi * D2R);
    var cy = hy + lc * Math.cos(phi * D2R);
    if (snap > 0) {                                   // 임팩트 순간에는 헤드를 공 위치에 정확히 맞춘다
      cx = lerp(cx, BALL_DX - 1.5, snap);
      cy = lerp(cy, BALL_DY + 1.5, snap);
    }
    if (s.phase === 'address') { cy = Math.min(cy, -1); }

    return {
      hip: [hipX, hipY], sh: [shX, shY], shHalf: shHalf, hipHalf: 4,
      head: [body[5], body[6]],
      kneeL: [body[7], body[8]], kneeR: [body[9], body[10]],
      footL: [8, 0], footR: [body[11], 0], heelR: body[12], face: body[13],
      hands: [hx, hy], clubEnd: [cx, cy], theta: theta, phi: phi,
      club: club, raise: raise,
      clubBehind: (s.phase === 'backswing' && theta < -100) ||
                  (s.phase === 'downswing' && theta < -100) ||
                  (s.phase === 'follow' && s.f > 0.55)
    };
  }

  var DEFAULT_COLORS = {
    skin: '#f2b88f', skinShade: '#d99a70',
    cap: '#e8303a', capDark: '#b01f2a',
    shirt: '#ffffff', shirtShade: '#d5dbe8', stripe: '#e8303a',
    pants: '#24336b', pantsShade: '#1a264f',
    shoe: '#f4f4f4', glove: '#ffffff',
    shaft: '#cfd3dc', head: '#23242e', headAccent: '#ffd23f',
    belt: '#141c33', eye: '#141c33', outline: '#141c33'
  };

  var buf = null, sil = null;

  function ensureBuffers() {
    if (buf) return;
    buf = KLD.px.makeCanvas(BUF_W, BUF_H);
    sil = KLD.px.makeCanvas(BUF_W, BUF_H);
  }

  function drawClub(g, P, C) {
    var px = KLD.px;
    var hx = OX + P.hands[0], hy = OY + P.hands[1];
    var cx = OX + P.clubEnd[0], cy = OY + P.clubEnd[1];
    px.line(g, hx, hy, cx, cy, C.shaft, 1);
    // 드라이버 헤드: 3x3 덩어리 + 강조 픽셀
    px.rect(g, Math.round(cx) - 1, Math.round(cy) - 1, 3, 3, C.head);
    px.rect(g, Math.round(cx), Math.round(cy) - 1, 1, 1, C.headAccent);
  }

  // 버퍼에 골퍼를 그린다 (윤곽선 없는 평면 색)
  function paint(g, P, C) {
    var px = KLD.px;
    g.clearRect(0, 0, BUF_W, BUF_H);
    function X(v) { return OX + v; }
    function Y(v) { return OY + v; }

    if (P.club && P.clubBehind) drawClub(g, P, C);

    // 다리 (뒤쪽 다리 먼저)
    var hipR = [P.hip[0] - P.hipHalf + 1, P.hip[1] + 2], hipL = [P.hip[0] + P.hipHalf - 1, P.hip[1] + 2];
    var ankleR = [P.footR[0], -1 - P.heelR], ankleL = [P.footL[0] - 1, -1];
    px.line(g, X(hipR[0]), Y(hipR[1]), X(P.kneeR[0]), Y(P.kneeR[1]), C.pantsShade, 4);
    px.line(g, X(P.kneeR[0]), Y(P.kneeR[1]), X(ankleR[0]), Y(ankleR[1]), C.pantsShade, 3);
    px.line(g, X(hipL[0]), Y(hipL[1]), X(P.kneeL[0]), Y(P.kneeL[1]), C.pants, 4);
    px.line(g, X(P.kneeL[0]), Y(P.kneeL[1]), X(ankleL[0]), Y(ankleL[1]), C.pants, 3);
    // 신발
    px.rect(g, X(P.footR[0]) - 2, Y(-1 - P.heelR * 0.4), 5, 2, C.shoe);
    px.rect(g, X(P.footL[0]) - 2, Y(-1), 5, 2, C.shoe);

    // 몸통
    var shL = P.sh[0] + P.shHalf, shR = P.sh[0] - P.shHalf;
    px.poly(g, [
      [X(shR - 1), Y(P.sh[1])], [X(shL + 1), Y(P.sh[1])],
      [X(P.hip[0] + P.hipHalf + 1), Y(P.hip[1])], [X(P.hip[0] - P.hipHalf - 1), Y(P.hip[1])]
    ], C.shirt);
    // 셔츠 줄무늬 (가슴 높이)
    var sy = P.sh[1] + 4, k = 4 / Math.max(1, P.hip[1] - P.sh[1]);
    var sxa = px.lerp(shR - 1, P.hip[0] - P.hipHalf - 1, k), sxb = px.lerp(shL + 1, P.hip[0] + P.hipHalf + 1, k);
    px.rect(g, X(sxa), Y(sy), Math.round(sxb - sxa) + 1, 2, C.stripe);
    // 골반·벨트
    px.rect(g, X(P.hip[0] - P.hipHalf - 1), Y(P.hip[1]), P.hipHalf * 2 + 3, 4, C.pants);
    px.rect(g, X(P.hip[0] - P.hipHalf - 1), Y(P.hip[1]), P.hipHalf * 2 + 3, 1, C.belt);

    // 뒤쪽 팔 (트레일 암)
    var hx = P.hands[0], hy = P.hands[1];
    if (!P.raise) {
      px.line(g, X(shR), Y(P.sh[1] + 1), X(hx), Y(hy), C.skinShade, 3);
      px.line(g, X(shR), Y(P.sh[1] + 1), X(px.lerp(shR, hx, 0.38)), Y(px.lerp(P.sh[1] + 1, hy, 0.38)), C.shirtShade, 3);
    } else {
      px.line(g, X(shR), Y(P.sh[1] + 1), X(shR - 2), Y(P.sh[1] + 12), C.skinShade, 3);
      px.line(g, X(shR), Y(P.sh[1] + 1), X(shR - 1), Y(P.sh[1] + 5), C.shirtShade, 3);
    }

    // 목·머리
    px.rect(g, X(P.head[0]) - 1, Y(P.head[1] + 3), 3, 3, C.skinShade);
    var hdx = X(P.head[0]), hdy = Y(P.head[1]);
    px.disc(g, hdx, hdy, 4, C.skin);
    // 모자: 머리 위쪽 절반 + 챙
    g.fillStyle = C.cap;
    g.fillRect(Math.round(hdx) - 2, Math.round(hdy) - 5, 5, 1);
    g.fillRect(Math.round(hdx) - 3, Math.round(hdy) - 4, 7, 1);
    g.fillRect(Math.round(hdx) - 4, Math.round(hdy) - 3, 9, 2);
    // 챙: 정면이면 이마를 가로지르고, 고개를 돌리면 그쪽으로 튀어나온다
    px.rect(g, Math.round(hdx) - 4 + Math.round(P.face * 2), Math.round(hdy) - 1, 9 + Math.round(Math.abs(P.face)), 1, C.capDark);
    // 눈
    var ex = Math.round(P.face * 2);
    g.fillStyle = C.eye;
    if (P.face < 0.7) g.fillRect(Math.round(hdx) - 2 + ex, Math.round(hdy) + 1, 1, 2);
    g.fillRect(Math.round(hdx) + 1 + ex, Math.round(hdy) + 1, 1, 2);

    // 앞쪽 팔 (리드 암)
    if (!P.raise) {
      px.line(g, X(shL), Y(P.sh[1] + 1), X(hx), Y(hy), C.skin, 3);
      px.line(g, X(shL), Y(P.sh[1] + 1), X(px.lerp(shL, hx, 0.38)), Y(px.lerp(P.sh[1] + 1, hy, 0.38)), C.shirt, 3);
      px.rect(g, X(hx) - 1, Y(hy) - 1, 3, 3, C.glove);
    } else {
      // 환호: 주먹을 번쩍
      px.line(g, X(shL), Y(P.sh[1] + 1), X(shL + 4), Y(P.sh[1] - 11), C.skin, 3);
      px.line(g, X(shL), Y(P.sh[1] + 1), X(shL + 2), Y(P.sh[1] - 4), C.shirt, 3);
      px.rect(g, X(shL + 4) - 1, Y(P.sh[1] - 12) - 1, 3, 3, C.glove);
    }

    if (P.club && !P.clubBehind) {
      if (P.raise) {
        // 환호 중에는 클럽을 옆에 세워 든다
        var bx = X(shR - 2), by = Y(P.sh[1] + 12);
        px.line(g, bx, by, bx - 3, by + 17, C.shaft, 1);
        px.rect(g, bx - 4, by + 16, 3, 3, C.head);
      } else drawClub(g, P, C);
    }
  }

  /*
   * draw(g, x, y, state, colors)
   * (x, y) = 화면에서 발 중심(지면)의 위치. 윤곽선을 둘러 그린다.
   */
  function draw(g, x, y, state, colors) {
    ensureBuffers();
    var C = colors || DEFAULT_COLORS;
    var P = pose(state);
    var bg = buf.getContext('2d');
    paint(bg, P, C);
    var sg = sil.getContext('2d');
    sg.globalCompositeOperation = 'source-over';
    sg.clearRect(0, 0, BUF_W, BUF_H);
    sg.drawImage(buf, 0, 0);
    sg.globalCompositeOperation = 'source-in';
    sg.fillStyle = C.outline;
    sg.fillRect(0, 0, BUF_W, BUF_H);
    sg.globalCompositeOperation = 'source-over';
    var dx = Math.round(x) - OX, dy = Math.round(y) - OY;
    g.drawImage(sil, dx - 1, dy);
    g.drawImage(sil, dx + 1, dy);
    g.drawImage(sil, dx, dy - 1);
    g.drawImage(sil, dx, dy + 1);
    g.drawImage(buf, dx, dy);
    return P;
  }

  var api = {
    BALL_DX: BALL_DX, BALL_DY: BALL_DY,
    pose: pose, draw: draw, DEFAULT_COLORS: DEFAULT_COLORS,
    palette: function (over) {
      var o = {}, k;
      for (k in DEFAULT_COLORS) o[k] = DEFAULT_COLORS[k];
      for (k in (over || {})) o[k] = over[k];
      return o;
    }
  };
  KLD.golfer = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
