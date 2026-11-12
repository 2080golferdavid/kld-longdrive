/*
 * KLD LONG DRIVE — 기록 카드와 공유
 * 저해상도 캔버스(216x270)에 픽셀 카드를 그린 뒤 5배로 키워 1080x1350 PNG를 만든다.
 *
 * 공유 사다리 (되는 것만 버튼으로 보인다):
 *   1) 이미지 파일 공유 (Web Share, 주로 iOS 사파리·안드로이드 크롬)
 *   2) 링크 공유 / 링크 복사
 *   3) 카드를 길게 눌러 저장하거나 스크린샷 — 인앱 브라우저에서도 항상 되는 길
 * 파일은 화면을 열 때 미리 만들어 둔다. 탭 핸들러 안에서 비동기로 만들면 iOS가 공유를 거부한다.
 */
(function (root) {
  'use strict';
  var KLD = root.KLD = root.KLD || {};

  var CW = 216, CH = 270, SCALE = 5;

  function t(k, v) { return KLD.i18n.t(k, v); }

  function shareUrl() {
    var u = KLD.config.brand.shareUrl;
    if (u) return u;
    try {
      if (root.location.protocol === 'file:') return '';
      return root.location.origin + root.location.pathname;
    } catch (e) { return ''; }
  }

  function shareText(d) {
    var brand = KLD.config.brand, lang = KLD.i18n.lang();
    var event = brand.eventName[lang] || brand.eventName.ko;
    var s = d.best > 0 ? t('share.text', { event: event, v: d.bestText, rank: d.title }) : t('share.textNo', { event: event });
    var tags = (brand.hashtags || []).map(function (h) { return '#' + h; }).join(' ');
    return s + (tags ? '\n' + tags : '');
  }

  // 저해상도 카드 그리기. 채팅방 썸네일이 정사각형으로 잘라도 남도록 핵심 정보는 가운데에 둔다.
  function drawCard(d) {
    var P = KLD.px, T = KLD.text, R = KLD.render, brand = KLD.config.brand;
    var c = P.makeCanvas(CW, CH), g = c.getContext('2d');
    var th = (R.THEMES[d.theme] || R.THEMES.day);
    var ink = '#141c33';
    var i, y = 0, cx = Math.round(CW / 2);
    // 하늘
    var parts = [0.3, 0.25, 0.25, 0.2], skyH = 204;
    for (i = 0; i < 4; i++) {
      var bh = i === 3 ? skyH - y : Math.round(skyH * parts[i]);
      P.rect(g, 0, y, CW, bh, th.sky[i]);
      if (i > 0) { P.dither(g, 0, y - 2, CW, 2, th.sky[i], 0); P.dither(g, 0, y, CW, 2, th.sky[i - 1], 1); }
      y += bh;
    }
    if (th.stars) {
      var r = P.rng(3);
      for (i = 0; i < 90; i++) P.rect(g, Math.floor(r() * CW), Math.floor(r() * 150), 1, 1, r() < 0.3 ? '#ffffff' : '#9fb0e8');
    }
    // 산
    g.fillStyle = th.mtnNear;
    for (var x = 0; x < CW; x++) {
      var hh = Math.round(14 + 9 * Math.sin(x / 23) + 5 * Math.sin(x / 9 + 1.3));
      g.fillRect(x, skyH - hh, 1, hh);
    }
    // 지면
    P.rect(g, 0, skyH, CW, CH - skyH, th.roughFar);
    P.rect(g, 0, skyH + 9, CW, 1, th.line);
    for (i = 0; i < 16; i++) P.rect(g, i * 14, skyH + 10, 14, 30, (i & 1) ? th.fairB : th.fairA);
    P.rect(g, 0, skyH + 40, CW, 1, th.line);
    P.rect(g, 0, skyH + 41, CW, CH - skyH - 41, th.roughNear);

    // 로고
    var logoBottom = 60, drawn = null;
    if (KLD.logo && KLD.logo.available && KLD.logo.available()) {
      drawn = KLD.logo.drawFit(g, 'full', cx, 8, 200, { align: 'center', variant: th.dark ? 'light' : 'dark' });
    }
    if (drawn) logoBottom = drawn.y + drawn.h;
    else {
      T.drawBig(g, brand.name, cx, 10, 5, ['#ffffff'], ink, 'rgba(7,10,28,0.5)', 'center');
      T.draw(g, brand.subtitle, cx, 51, { color: '#ffffff', outline: ink, align: 'center' });
    }

    // 결과 패널
    var px = 12, py = logoBottom + 6, pw = CW - 24, ph = 112;
    P.panel(g, px, py, pw, ph, '#141c33', '#070a1c');
    P.rect(g, px + 2, py + 2, pw - 4, 1, brand.colors.primary);
    P.rect(g, px + 2, py + ph - 3, pw - 4, 1, brand.colors.primary);
    // 제목은 두 배 크기로 쓰되, 패널보다 넓으면(영어 'QUARTER-FINALIST' 등) 한 배로 줄인다
    var tsc = T.measure(d.title, { font: 'ko', scale: 2 }) > pw - 8 ? 1 : 2;
    T.draw(g, d.title, cx, py + (tsc === 2 ? 7 : 13), { font: 'ko', scale: tsc, color: d.won ? '#ffd23f' : '#ffffff', align: 'center' });
    T.draw(g, t('card.best'), cx, py + 35, { font: 'kos', color: '#aab4d0', align: 'center' });
    if (d.best > 0) {
      var num = R.distNum(d.best, d.unit), unit = R.unitLabel(d.unit);
      var sc = 4, nw = T.measure(num, { scale: sc }), uw = T.measure(unit, { scale: 2 });
      var nx = cx - Math.round((nw + 4 + uw) / 2);
      T.draw(g, num, nx, py + 47, { scale: sc, color: '#ffd23f', shadow: '#7a4a00' });
      T.draw(g, unit, nx + nw + 4, py + 47 + 14, { scale: 2, color: '#ffd23f' });
      // 보조 단위
      var other = d.unit === 'm' ? 'yd' : 'm';
      T.draw(g, R.distNum(d.best, other) + ' ' + R.unitLabel(other), cx, py + 79, { color: '#aab4d0', align: 'center' });
      if (d.shot) {
        var line = t('card.ball') + ' ' + d.shot.ballSpeedMph.toFixed(0) + 'MPH · ' + t('card.carry') + ' ' + R.distNum(d.shot.carry, d.unit, 0) + unit;
        T.draw(g, line, cx, py + 89, { font: 'kos', color: '#7ee6f7', align: 'center' });
      }
    } else {
      T.draw(g, t('final.norec'), cx, py + 58, { font: 'ko', color: '#ff9a8a', align: 'center' });
    }
    if (d.name) {
      // 이름 줄은 가운데에 두되, 긴 이름은 왼쪽 아래 선수 그림(들어 올린 클럽)에 닿지 않게 오른쪽으로 민다
      var nameLine = t('card.player') + ' ' + d.name, nlw = T.measure(nameLine, { font: 'kos' });
      var nlx = Math.max(cx - Math.round(nlw / 2), Math.min(56, px + pw - 6 - nlw));
      T.draw(g, nameLine, nlx, py + 100, { font: 'kos', color: '#ffffff' });
    }
    // 400 CLUB 배지
    if (d.club) {
      var btxt = d.clubYd + ' CLUB', bw = T.measure(btxt) + 8;
      P.panel(g, px + pw - bw - 3, py - 5, bw, 12, '#ffd23f', ink);
      T.draw(g, btxt, px + pw - bw + 1, py - 3, { color: ink });
    }

    // 선수
    P.ellipse(g, 38, skyH + 27, 13, 2, th.shadow);
    KLD.golfer.draw(g, 38, skyH + 26, d.won ? { phase: 'cheer', time: 0.2 } : { phase: 'follow', f: 1, b: 1, d: 1, time: 0 });

    // 날짜·도전 문구·주소
    var now = new Date();
    var date = now.getFullYear() + '.' + ('0' + (now.getMonth() + 1)).slice(-2) + '.' + ('0' + now.getDate()).slice(-2);
    T.draw(g, date, CW - 8, skyH + 14, { color: '#ffffff', outline: ink, align: 'right' });
    T.draw(g, t('card.dare'), CW - 8, skyH + 24, { font: 'ko', color: '#ffd23f', outline: ink, align: 'right' });
    var url = shareUrl().replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (url && url.length <= 34) T.draw(g, url.toUpperCase(), cx, CH - 13, { color: '#ffffff', outline: ink, align: 'center' });
    else {
      var tags = (brand.hashtags || []).slice(0, 3).map(function (h) { return '#' + h; }).join(' ');
      T.draw(g, tags, cx, CH - 15, { font: 'kos', color: '#ffffff', outline: ink, align: 'center' });
    }
    return c;
  }

  function buildCard(d) {
    var small = drawCard(d);
    var big = KLD.px.makeCanvas(CW * SCALE, CH * SCALE);
    var g = big.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(small, 0, 0, CW * SCALE, CH * SCALE);
    return big;
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }
  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return !!ok;
    } catch (e) { return false; }
  }

  function eventTitle() {
    var ev = KLD.config.brand.eventName;
    return ev[KLD.i18n.lang()] || ev.ko;
  }

  // 공유 화면을 띄운다
  function open(d) {
    var UI = KLD.ui, el = UI.el, add = UI.add;
    var canvas, dataUrl = '';
    try { canvas = buildCard(d); dataUrl = canvas.toDataURL('image/png'); } catch (e) { dataUrl = ''; }
    var text = shareText(d), url = shareUrl();
    var copyPayload = text + (url ? '\n' + url : '');
    var file = null, blobRef = null, objUrl = '';
    // 카카오톡·네이버·인스타그램 같은 앱 안 브라우저에서는 a[download] 가 동작하지 않는다 → 저장 버튼을 빼고 길게 누르기를 안내한다
    var ua = (root.navigator && navigator.userAgent) || '';
    var inApp = /KAKAOTALK|NAVER\(inapp|DaumApps|BAND\/|Instagram|FBAN|FBAV|FB_IAB|Line\/|; wv\)/i.test(ua) ||
      (/iPhone|iPad|iPod/.test(ua) && !/Safari\//.test(ua));     // iOS 의 앱 안 웹뷰는 UA 에 Safari/ 가 없다
    function releaseUrl() { if (objUrl) { try { URL.revokeObjectURL(objUrl); } catch (e) { /* 무시 */ } objUrl = ''; } }

    var m = UI.modal('share');
    var img = el('img', 'card');
    img.alt = t('share.title');
    if (dataUrl) img.src = dataUrl;
    var status = el('div', 'status dim small', t('share.tip'));
    function say(msg) { status.textContent = msg; status.classList.remove('dim'); }

    var row = el('div', 'btn-row');
    // 1) 이미지 파일 공유 — 파일이 준비되고, 이 브라우저가 파일 공유를 지원할 때만 버튼을 붙인다
    var fileBtn = UI.btn(t('share.do'), 'primary', function () {
      if (!file) return;
      try {
        navigator.share({ files: [file], title: eventTitle() }).catch(function (err) {
          if (!err || err.name !== 'AbortError') say(t('share.fail'));
        });
      } catch (e) { say(t('share.fail')); }
    });
    fileBtn.setAttribute('data-focus', '1');

    if (canvas && canvas.toBlob) {
      canvas.toBlob(function (blob) {
        blobRef = blob;
        try {
          if (blob && typeof File !== 'undefined') file = new File([blob], 'kld-longdrive.png', { type: 'image/png' });
        } catch (e) { file = null; }
        var ok = false;
        try { ok = !!(file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })); } catch (e2) { ok = false; }
        if (ok && m.wrap.parentNode) m.panel.insertBefore(fileBtn, row);
      }, 'image/png');
    }

    // 2) 링크 공유 (파일 공유가 안 되는 브라우저) 또는 링크 복사
    var copy = UI.btn(t('share.copy'), '', function () {
      if (navigator.share && url && !file) {
        try {
          navigator.share({ title: eventTitle(), text: text, url: url }).catch(function (err) {
            if (err && err.name === 'AbortError') return;
            copyText(copyPayload).then(function (ok) { say(ok ? t('share.copied') : t('share.fail')); });
          });
          return;
        } catch (e) { /* 아래 복사로 넘어간다 */ }
      }
      copyText(copyPayload).then(function (ok) { say(ok ? t('share.copied') : t('share.fail')); });
    });
    var save = UI.btn(t('share.save'), '', function () {
      try {
        var a = document.createElement('a');
        a.download = 'kld-longdrive.png';
        releaseUrl();
        if (blobRef) objUrl = URL.createObjectURL(blobRef);
        a.href = objUrl || dataUrl;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // 실제로 저장됐는지는 알 수 없으므로 단정하지 않는다. (iOS 는 확인 창을 띄운 뒤에야 파일을 읽으니 주소는 닫을 때 해제한다.)
        say(t('share.saved'));
      } catch (e) { say(t('share.fail')); }
    });
    var close = UI.btn(t('common.close'), 'ghost', function () { releaseUrl(); UI.pop(m.wrap); });
    close.setAttribute('data-cancel', '1');

    add(row, inApp ? null : save, copy);
    add(m.panel, el('h2', null, t('share.title')), img, row, status, close);
    UI.push(m.wrap);
  }

  var api = { open: open, buildCard: buildCard, drawCard: drawCard, shareText: shareText, shareUrl: shareUrl };
  KLD.share = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
