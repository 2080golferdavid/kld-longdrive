/*
 * KLD LONG DRIVE — DOM 오버레이 (타이틀 · 조작법 · 설정 · 라운드 안내 · 결과 · 기록 · 일시정지)
 * 플레이 화면은 캔버스가 그리고, 글이 많은 화면만 DOM으로 얹는다.
 * 크기는 전부 CSS 변수 --u (내부 1픽셀의 CSS px 크기) 기준이라 캔버스 픽셀과 격자가 맞는다.
 */
(function (root) {
  'use strict';
  var KLD = root.KLD = root.KLD || {};

  var rootEl = null, handlers = {}, current = null;
  var revealTimers = [];
  // 오버레이가 뜬 뒤에 그 위에서 눌림이 시작됐는지. 캔버스를 누른 손가락 밑에 오버레이가 뜨면, 손을 뗄 때의 클릭이
  // 방금 나타난 버튼에 꽂힐 수 있다(안드로이드 크롬). 그런 클릭은 버튼을 누른 것으로 치지 않는다.
  var pressedHere = false;

  function t(k, v) { return KLD.i18n.t(k, v); }
  function sfx(name, p) { if (KLD.audio && KLD.audio.sfx) KLD.audio.sfx(name, p); }
  function settings() { return KLD.storage.get().settings; }
  var YD = 0.9144;
  function dist(m, unit, dec) {
    var v = unit === 'm' ? m : m / YD;
    return v.toFixed(dec == null ? 1 : dec);
  }
  function unitName(unit) { return unit === 'm' ? 'm' : 'yd'; }
  function distU(m, unit, dec) { return dist(m, unit, dec) + ' ' + unitName(unit); }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function add(parent) {
    for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]);
    return parent;
  }
  function btn(label, cls, onClick) {
    var b = el('button', 'btn' + (cls ? ' ' + cls : ''), label);
    b.type = 'button';
    b.addEventListener('click', function (ev) {
      // 포인터로 생긴 클릭(detail > 0)인데 눌림이 이 오버레이 위에서 시작되지 않았다면 무시한다. 키보드·코드로 누른 것은 detail 이 0.
      if (ev && ev.detail > 0 && !pressedHere) return;
      if (handlers.onInteract) handlers.onInteract();
      sfx(cls && cls.indexOf('ghost') >= 0 ? 'uiBack' : 'uiSelect');
      onClick(ev, b);
    });
    return b;
  }

  // ── 레이어 관리 ──────────────────────────────────────────
  function init(elm, h) {
    rootEl = elm;
    handlers = h || {};
    // 포커스가 패널 밖(배경·캔버스·body)에 있어도 키가 먹도록 문서 전체에서 받는다
    document.addEventListener('keydown', onKey);
    ['pointerdown', 'touchstart', 'mousedown'].forEach(function (type) {
      rootEl.addEventListener(type, function () { pressedHere = true; }, true);
    });
    // 오버레이 위에서의 스크롤·확대 제스처가 페이지로 새지 않게 한다 (스크롤 영역은 예외)
    rootEl.addEventListener('touchmove', function (e) {
      var n = e.target;
      while (n && n !== rootEl) { if (n.classList && n.classList.contains('scroll')) return; n = n.parentNode; }
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
  }

  function layout(V) {
    if (!rootEl) return;
    var s = rootEl.style;
    s.left = V.left + 'px'; s.top = V.top + 'px';
    s.width = (V.W * V.cssScale) + 'px'; s.height = (V.H * V.cssScale) + 'px';
    s.setProperty('--u', V.cssScale + 'px');
    var portrait = V.H > V.W * 1.15;
    rootEl.classList.toggle('portrait', portrait);
    rootEl.classList.toggle('landscape', !portrait);
  }

  function clearTimers() {
    for (var i = 0; i < revealTimers.length; i++) clearTimeout(revealTimers[i]);
    revealTimers = [];
  }
  function clear() { clearTimers(); while (rootEl.firstChild) rootEl.removeChild(rootEl.firstChild); }

  function show(node, fn, args) {
    pressedHere = false;
    clear();
    rootEl.appendChild(node);
    rootEl.classList.add('open');
    current = fn ? { fn: fn, args: args || [] } : null;
    focusFirst(node);
  }

  // 현재 화면 위에 한 겹 더 (공유 카드 등)
  function push(node) {
    pressedHere = false;
    rootEl.appendChild(node);
    rootEl.classList.add('open');
    focusFirst(node);
  }
  function pop(node) {
    if (node && node.parentNode === rootEl) rootEl.removeChild(node);
    if (!rootEl.firstChild) rootEl.classList.remove('open');
    else focusFirst(rootEl.lastChild);
  }

  function hide() {
    if (!rootEl) return;
    clear();
    rootEl.classList.remove('open');
    current = null;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  function isOpen() { return !!(rootEl && rootEl.firstChild); }

  // 언어·폰트가 바뀌면 현재 화면을 다시 그린다 (위에 겹친 화면이 있으면 건드리지 않는다)
  function refresh() {
    if (current && current.fn && rootEl.children.length <= 1) current.fn.apply(null, current.args);
  }

  function focusEl(f) {
    if (f && f.focus) { try { f.focus({ preventScroll: true }); } catch (e) { f.focus(); } }
  }
  function focusFirst(node) {
    focusEl(node.querySelector('[data-focus]') || node.querySelector('button'));
  }

  // 키보드: 방향키로 버튼 사이 이동(본문이 넘치면 위·아래는 먼저 스크롤), Enter·Space 로 누르기, Esc 로 닫기
  function onKey(e) {
    var layer = rootEl && rootEl.lastChild;
    if (!layer) return;
    var key = e.key;
    if (key === 'Escape' || key === 'Esc') {
      var c = layer.querySelector('[data-cancel]');
      // 여기서 처리한 키는 게임 쪽 단축키(Esc = 일시정지)로 넘어가지 않게 막는다
      if (c) { e.preventDefault(); e.stopPropagation(); c.click(); }
      return;
    }
    var act = (key === 'Enter' || key === ' ' || key === 'Spacebar');
    var target = e.target;
    if (target && target.tagName === 'INPUT') {
      if (key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
        // 이름 입력을 마치면 기본 버튼(공유)으로 넘어간다. 포커스가 body 로 떨어지면 키보드로 이어 갈 수 없다.
        e.preventDefault();
        var nextBtn = layer.querySelector('[data-focus]');
        if (nextBtn) focusEl(nextBtn); else target.blur();
        return;
      }
      if (key !== 'ArrowUp' && key !== 'ArrowDown') return;      // 글자 입력과 좌우 커서 이동은 그대로 둔다
    }
    // 누르고 있던 키의 자동 반복으로, 방금 뜬 화면의 버튼이 눌려 버리지 않게 한다
    if (act && e.repeat) { e.preventDefault(); return; }
    var dir = (key === 'ArrowDown' || key === 'ArrowRight') ? 1 : ((key === 'ArrowUp' || key === 'ArrowLeft') ? -1 : 0);
    var active = document.activeElement;
    var inside = !!(active && active !== document.body && layer.contains(active));
    if (!inside) {
      // 배경을 눌러 포커스가 패널 밖으로 나간 경우: 기본 버튼으로 되돌리고, Enter·Space 면 바로 누른다
      if (!act && !dir) return;
      var f = layer.querySelector('[data-focus]') || layer.querySelector('button:not(:disabled)');
      if (!f) return;
      e.preventDefault();
      focusEl(f);
      if (act) f.click();
      return;
    }
    if (!dir) return;
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      // 본문이 넘쳐 있으면 위·아래 키는 먼저 본문을 스크롤한다
      var sc = layer.querySelector('.scroll');
      if (sc && sc.scrollHeight > sc.clientHeight + 1) {
        var before = sc.scrollTop;
        sc.scrollTop = before + dir * Math.max(24, Math.round(sc.clientHeight * 0.4));
        if (sc.scrollTop !== before) { e.preventDefault(); return; }
      }
    }
    var list = Array.prototype.slice.call(layer.querySelectorAll('button:not(:disabled), input'));
    if (list.length < 2) return;
    var i = list.indexOf(active);
    i = i < 0 ? 0 : (i + dir + list.length) % list.length;
    e.preventDefault();
    focusEl(list[i]);
    sfx('uiMove');
  }

  function modal(cls) {
    var wrap = el('div', 'layer modal');
    var panel = el('div', 'panel' + (cls ? ' ' + cls : ''));
    wrap.appendChild(panel);
    return { wrap: wrap, panel: panel };
  }

  // 타이틀 오른쪽 위의 언어 버튼 (한국어 | EN). 설정 메뉴를 열지 않아도 바로 바꿀 수 있다.
  function langSwitch() {
    var box = el('div', 'lang-switch');
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', 'Language');
    var cur = settings().lang;
    [['ko', '한국어'], ['en', 'EN']].forEach(function (L) {
      var b = btn(L[1], 'small' + (cur === L[0] ? ' on' : ''), function () {
        if (cur === L[0]) return;
        KLD.storage.setSetting('lang', L[0]);
        if (handlers.onSettingsChanged) handlers.onSettingsChanged();
        showTitle();
      });
      b.setAttribute('aria-pressed', cur === L[0] ? 'true' : 'false');
      b.setAttribute('lang', L[0]);
      box.appendChild(b);
    });
    return box;
  }

  // ── 타이틀 ──────────────────────────────────────────────
  function showTitle() {
    var wrap = el('div', 'layer title');
    var menu = el('div', 'title-menu');
    var start = btn(t('title.start'), 'primary big', function () { handlers.onStart(); });
    start.setAttribute('data-focus', '1');
    var grid = el('div', 'title-grid');
    var muted = handlers.isMuted ? handlers.isMuted() : false;
    var mute = btn(t(muted ? 'title.soundOff' : 'title.soundOn'), 'small', function (ev, b) {
      var m = handlers.onToggleMute ? handlers.onToggleMute() : false;
      b.textContent = t(m ? 'title.soundOff' : 'title.soundOn');
    });
    add(grid,
      btn(t('title.practice'), 'small', function () { handlers.onPractice(); }),
      btn(t('title.ranking'), 'small', function () { showRanking(showTitle); }),
      btn(t('title.howto'), 'small', function () { showHowto(showTitle); }),
      btn(t('title.settings'), 'small', function () { showSettings(showTitle); }),
      mute
    );
    var best = KLD.storage.get().best;
    var rules = KLD.config.rules;
    var foot = el('div', 'title-foot', best > 0 ? t('title.best', { v: distU(best, settings().unit) })
      : t('title.noBest', { balls: rules.ballsPerSet, club: rules.clubLineYd }));
    add(menu, el('div', 'title-hint', t('title.hint')), start, grid, foot);
    wrap.appendChild(menu);
    wrap.appendChild(langSwitch());
    show(wrap, showTitle);
  }

  // ── 조작법 ──────────────────────────────────────────────
  function showHowto(onClose) {
    var m = modal('howto');
    add(m.panel, el('h2', null, t('howto.title')));
    var body = el('div', 'scroll');
    var list = el('ol', 'howto-list');
    var vars = { balls: KLD.config.rules.ballsPerSet, over: KLD.config.gauge.overCharges };
    for (var i = 1; i <= 6; i++) list.appendChild(el('li', null, t('howto.' + i, vars)));
    add(body, list, el('p', 'dim small', t('howto.keys')));
    var ok = btn(t('howto.ok'), 'primary', function () { if (onClose) onClose(); else hide(); });
    ok.setAttribute('data-focus', '1'); ok.setAttribute('data-cancel', '1');
    add(m.panel, body, ok);
    show(m.wrap, showHowto, [onClose]);
  }

  // ── 설정 ────────────────────────────────────────────────
  function showSettings(onClose, focusIdx) {
    var s = settings();
    var m = modal('settings');
    add(m.panel, el('h2', null, t('set.title')));
    var body = el('div', 'scroll');
    var toggles = [];
    function row(labelKey, valueText, onToggle) {
      var idx = toggles.length;
      var r = el('div', 'set-row');
      var b = btn(valueText, 'small', function () {
        onToggle();
        if (handlers.onSettingsChanged) handlers.onSettingsChanged();
        showSettings(onClose, idx);                  // 다시 그린 뒤 방금 누른 항목에 포커스를 돌려준다
      });
      toggles.push(b);
      add(r, el('span', 'set-label', t(labelKey)), b);
      body.appendChild(r);
    }
    row('set.unit', t(s.unit === 'm' ? 'set.m' : 'set.yd'), function () { KLD.storage.setSetting('unit', s.unit === 'm' ? 'yd' : 'm'); });
    row('set.lang', t(s.lang === 'en' ? 'set.en' : 'set.ko'), function () { KLD.storage.setSetting('lang', s.lang === 'en' ? 'ko' : 'en'); });
    row('set.sound', t(s.sound ? 'set.on' : 'set.off'), function () { KLD.storage.setSetting('sound', !s.sound); });
    row('set.music', t(s.music ? 'set.on' : 'set.off'), function () { KLD.storage.setSetting('music', !s.music); });
    row('set.vibrate', t(s.vibrate ? 'set.on' : 'set.off'), function () { KLD.storage.setSetting('vibrate', !s.vibrate); });
    var close = btn(t('common.close'), 'primary', function () { if (onClose) onClose(); else hide(); });
    close.setAttribute('data-cancel', '1'); close.setAttribute('data-focus', '1');
    add(m.panel, body, close);
    show(m.wrap, showSettings, [onClose]);
    if (focusIdx != null && toggles[focusIdx]) focusEl(toggles[focusIdx]);
  }

  // ── 랭킹 탭 (이 기기 / 전체) ──────────────────────────────
  function rankTabs(active, onClose) {
    var row = el('div', 'btn-row rank-tabs');
    [['mine', 'rank.tabMine', showRanking], ['world', 'rank.tabWorld', showWorldRanking]].forEach(function (T) {
      var b = btn(t(T[1]), 'small' + (active === T[0] ? ' on' : ''), function () { if (active !== T[0]) T[2](onClose); });
      b.setAttribute('aria-pressed', active === T[0] ? 'true' : 'false');
      row.appendChild(b);
    });
    return row;
  }

  // 실시간 최장타 랭킹: 서버의 상위 기록 + 내 최고 기록이 전체에서 몇 위(상위 몇 %)인지
  function showWorldRanking(onClose) {
    var m = modal('ranking');
    add(m.panel, el('h2', null, t('rank.worldTitle')), rankTabs('world', onClose));
    var body = el('div', 'scroll');
    var status = el('p', 'dim center', t('world.loading'));
    body.appendChild(status);
    var close = btn(t('common.close'), 'primary', function () { if (onClose) onClose(); else hide(); });
    close.setAttribute('data-cancel', '1'); close.setAttribute('data-focus', '1');
    add(m.panel, body, add(el('div', 'btn-row'), close));
    show(m.wrap, showWorldRanking, [onClose]);

    var on = KLD.online, d = KLD.storage.get(), unit = settings().unit;
    function fail() {
      status.textContent = t('world.fail');
      add(body, btn(t('world.retry'), 'small', function () { showWorldRanking(onClose); }));
    }
    if (!on || !on.enabled()) { fail(); return; }
    Promise.all([on.top(30), d.best > 0 ? on.standing(d.best) : Promise.resolve(null)]).then(function (res) {
      if (!body.parentNode) return;                      // 그 사이 다른 화면으로 넘어갔다
      var list = res[0], me = res[1];
      if (!list) { fail(); return; }
      body.removeChild(status);
      if (d.best > 0 && me) {
        var p = on.pct(me.rank, me.total);
        add(body, el('div', 'verdict good', t('world.me', { v: distU(d.best, unit), rank: me.rank, total: me.total }) + (p ? ' ' + t('world.top', { pct: p }) : '')));
      } else if (!(d.best > 0)) {
        add(body, el('p', 'dim small center', t('world.noBest')));
      }
      if (!list.length) { add(body, el('p', 'dim center', t('world.empty'))); return; }
      var tbl = el('div', 'rank-list');
      var myName = d.lastName || 'PLAYER', marked = false;
      list.forEach(function (r, i) {
        var isMe = !marked && d.best > 0 && r.name === myName && Math.abs(r.meters - d.best) < 0.02;
        if (isMe) marked = true;
        var row = el('div', 'rank-row' + (i === 0 ? ' top' : '') + (isMe ? ' me' : ''));
        add(row,
          el('span', 'c-rank', String(r.rank)),
          el('span', 'c-name', r.name),
          el('span', 'c-stage', t('rank.stage.' + Math.max(0, Math.min(4, r.stage | 0)))),
          el('span', 'c-dist', distU(r.meters, unit)));
        tbl.appendChild(row);
      });
      body.appendChild(tbl);
    });
  }

  // ── 내 기록 ─────────────────────────────────────────────
  function showRanking(onClose) {
    var m = modal('ranking');
    add(m.panel, el('h2', null, t('rank.title')), rankTabs('mine', onClose));
    var body = el('div', 'scroll');
    var list = KLD.storage.get().ranking.slice();          // 저장된 줄 전부 (결과 화면이 알려 주는 순위와 같은 목록)
    var unit = settings().unit;
    if (!list.length) body.appendChild(el('p', 'dim center', t('rank.empty')));
    else {
      var tbl = el('div', 'rank-list');
      for (var i = 0; i < list.length; i++) {
        var r = list[i];
        var row = el('div', 'rank-row' + (i === 0 ? ' top' : ''));
        add(row,
          el('span', 'c-rank', String(i + 1)),
          el('span', 'c-name', r.name),
          el('span', 'c-stage', t('rank.stage.' + Math.max(0, Math.min(4, r.stage | 0)))),
          el('span', 'c-dist', distU(r.m, unit)));
        tbl.appendChild(row);
      }
      body.appendChild(tbl);
    }
    var foot = el('div', 'btn-row');
    // 두 번 눌러야 지워진다. 연타(더블탭)로는 지워지지 않게 사이를 두고, 몇 초 안 누르면 원래대로 돌아간다.
    var armed = false, armedAt = 0;
    var reset = btn(t('set.resetRank'), 'ghost small', function (ev, b) {
      if (!armed) {
        armed = true; armedAt = Date.now();
        b.textContent = t('set.resetAsk');
        revealTimers.push(setTimeout(function () { armed = false; b.textContent = t('set.resetRank'); }, 4000));
        return;
      }
      if (Date.now() - armedAt < 700) return;
      KLD.storage.clearRanking();
      showRanking(onClose);
    });
    var close = btn(t('common.close'), 'primary', function () { if (onClose) onClose(); else hide(); });
    close.setAttribute('data-cancel', '1'); close.setAttribute('data-focus', '1');
    // 지울 것이 있으면 버튼을 보인다 (연습 모드에서만 세운 최고 기록은 목록에 없어도 지울 수 있어야 한다)
    add(foot, (list.length || KLD.storage.get().best > 0) ? reset : null, close);
    add(m.panel, body, foot);
    show(m.wrap, showRanking, [onClose]);
  }

  // ── 라운드 안내 ──────────────────────────────────────────
  // 본문은 스크롤 영역에 넣고 '티샷!' 버튼은 그 밖에 둔다 (화면이 낮아도 버튼이 잘리지 않게).
  // 가로형에서는 머리(라운드·상대)와 본론(상대 6구·넘어야 할 기록)을 좌우로 나란히 놓는다.
  function showRoundIntro(d, onGo) {
    var m = modal('intro');
    var unit = d.unit;
    var body = el('div', 'scroll intro-body');
    var head = el('div', 'intro-head'), main = el('div', 'intro-main');
    add(head,
      el('div', 'kicker', t('round.n', { n: d.index + 1 })),
      el('h1', null, d.label),
      el('p', 'center', d.desc));
    var go = btn(t('intro.go'), 'primary big', function () { onGo(); });
    go.setAttribute('data-focus', '1');
    var reveal = null;
    if (d.opponent) {
      // 상대 소개 + 상대가 먼저 친 6구
      var vs = el('div', 'vs-box');
      add(vs, el('span', 'vs-tag', t('intro.vs')), el('span', 'vs-name', d.opponent));
      add(head, vs,
        el('p', 'dim small center tape', t('intro.tape', { mph: d.oppSpeed, seed: d.oppSeed, v: distU(d.oppQual, unit, 0) })));
      var strip = el('div', 'ball-strip');
      var chips = [];
      for (var i = 0; i < d.oppBalls.length; i++) {
        var b = d.oppBalls[i];
        var chip = el('span', 'chip' + (b.valid ? '' : ' ob') + (b.valid && b.total === d.target ? ' best' : ''), b.valid ? dist(b.total, unit, 0) : 'OB');
        chips.push(chip);
        strip.appendChild(chip);
      }
      var ntb = el('div', 'ntb');
      // 상대가 유효 기록을 못 냈으면 공 하나만 살려도 이긴다
      add(ntb, el('div', 'ntb-label', t('intro.ntb')), el('div', 'ntb-value', d.target > 0 ? distU(d.target, unit) : t('field.norec')));
      add(main, el('div', 'dim small center', t('intro.oppFirst')), strip, ntb);
      // 한 구씩 공개 (show() 가 이전 타이머를 지우므로 화면을 띄운 뒤에 건다)
      reveal = function () {
        chips.forEach(function (c, k) {
          revealTimers.push(setTimeout(function () {
            c.classList.add('on');
            sfx(d.oppBalls[k].valid ? 'uiMove' : 'uiBack');
          }, 350 + k * 330));
        });
        revealTimers.push(setTimeout(function () { ntb.classList.add('on'); sfx('uiSelect'); }, 350 + chips.length * 330 + 150));
      };
    } else if (d.target > 0) {
      var cut = el('div', 'ntb on');
      add(cut, el('div', 'ntb-label', t('intro.cut', { k: d.advance })), el('div', 'ntb-value', distU(d.target, unit)));
      add(main, cut);
    }
    var info = el('div', 'info-box');
    add(info, el('div', null, d.rule), el('div', null, t('intro.windLabel') + ': ' + d.windText));
    if (d.tip) info.appendChild(el('div', 'tip', d.tip));
    add(body, head, main.firstChild ? main : null, info);
    add(m.panel, body, go);
    show(m.wrap, showRoundIntro, [d, onGo]);
    if (reveal) reveal();
  }

  // ── 예선 결과 ────────────────────────────────────────────
  function showFieldResult(d, onNext) {
    var out = d.out, unit = d.unit;
    var m = modal('field');
    add(m.panel,
      el('h2', null, t('field.title')),
      el('div', 'verdict ' + (out.advanced ? 'good' : 'bad'), t(out.advanced ? 'field.pass' : 'field.fail') + '  ' + t('field.rank', { rank: out.rank })));
    var body = el('div', 'scroll');
    var tbl = el('div', 'rank-list field-list');
    for (var i = 0; i < out.entries.length; i++) {
      var e = out.entries[i];
      if (i === d.advance) tbl.appendChild(el('div', 'cutline', t('field.cutline')));
      var row = el('div', 'rank-row' + (e.isPlayer ? ' me' : '') + (i < d.advance ? '' : ' out'));
      add(row,
        el('span', 'c-rank', String(e.rank)),
        el('span', 'c-name', e.isPlayer ? t('field.you') : e.name),
        el('span', 'c-dist', e.best > 0 ? dist(e.best, unit) : '—'));
      tbl.appendChild(row);
    }
    body.appendChild(tbl);
    var next = btn(d.nextLabel, 'primary', function () { onNext(); });
    next.setAttribute('data-focus', '1');
    var foot = el('div', 'btn-row');
    add(foot, d.onShare ? btn(t('final.share'), '', function () { d.onShare(); }) : null, next);
    add(m.panel, body, foot);
    show(m.wrap, showFieldResult, [d, onNext]);
    var me = tbl.querySelector('.me');
    if (me && me.scrollIntoView) { try { me.scrollIntoView({ block: 'center' }); } catch (err) { /* 구형 브라우저 */ } }
  }

  // ── 매치 결과 ────────────────────────────────────────────
  function showMatchResult(d, onNext) {
    var out = d.out, unit = d.unit;
    var m = modal('match');
    add(m.panel, el('h2', null, t('match.title', { round: d.roundLabel })));
    var duel = el('div', 'duel');
    function side(name, best, win) {
      var s = el('div', 'duel-side' + (win ? ' win' : ''));
      add(s, el('div', 'duel-name', name), el('div', 'duel-dist', best > 0 ? dist(best, unit) : '—'),
        el('div', 'duel-unit', best > 0 ? unitName(unit) : t('field.norec')));
      return s;
    }
    add(duel, side(t('match.me'), out.playerBest, out.advanced), el('div', 'duel-vs', t('intro.vs')), side(out.opponentName, out.oppBest, !out.advanced && !out.rematch));
    add(m.panel, duel);
    if (out.rematch) add(m.panel, el('div', 'verdict warn', t('match.rematch')));
    else add(m.panel, el('div', 'verdict ' + (out.advanced ? 'good' : 'bad'), t(out.advanced ? 'match.win' : 'match.lose')));
    if (d.others && d.others.length) {
      var box = el('div', 'others scroll');
      box.appendChild(el('div', 'dim small', t('match.others')));
      for (var i = 0; i < d.others.length; i++) {
        var o = d.others[i];
        var row = el('div', 'other-row');
        add(row,
          el('span', o.aWin ? 'w' : 'l', o.a + ' ' + (o.aBest > 0 ? dist(o.aBest, unit, 0) : '—')),
          el('span', 'dim', ':'),
          el('span', o.aWin ? 'l' : 'w', (o.bBest > 0 ? dist(o.bBest, unit, 0) : '—') + ' ' + o.b));
        box.appendChild(row);
      }
      add(m.panel, box);
    }
    var next = btn(d.nextLabel, 'primary', function () { onNext(); });
    next.setAttribute('data-focus', '1');
    var foot = el('div', 'btn-row');
    add(foot, (d.onShare && !out.rematch) ? btn(t('final.share'), '', function () { d.onShare(); }) : null, next);
    add(m.panel, foot);
    show(m.wrap, showMatchResult, [d, onNext]);
  }

  // ── 워크오프: 상대 기록을 넘겼다 ────────────────────────────
  function showWalkoff(d, h) {
    var m = modal('walkoff');
    add(m.panel,
      el('h1', 'gold', 'WALK-OFF!'),
      el('p', 'center', t('walk.desc')),
      el('div', 'bigdist', d.best));
    var end = btn(t('walk.end'), 'primary', function () { h.onEnd(); });
    end.setAttribute('data-focus', '1');
    add(m.panel, end, btn(t('walk.more', { n: d.left }), '', function () { h.onMore(); }));
    show(m.wrap, showWalkoff, [d, h]);
  }

  // ── 최종 결과 ────────────────────────────────────────────
  function showFinal(d, h) {
    var m = modal('final' + (d.won ? ' champion' : ''));
    var body = el('div', 'scroll final-body');
    add(body, el('h1', d.won ? 'gold' : null, d.title));
    if (d.sub) add(body, el('p', 'center gold', d.sub));
    add(body, el('div', 'kicker', t('final.best')), el('div', 'bigdist', d.bestText));
    if (d.club) add(body, el('div', 'badge', t('final.club', { v: d.clubYd })));
    if (d.pb) add(body, el('div', 'verdict good', t('final.pb')));
    if (d.rank > 0) add(body, el('div', 'dim small center', t('final.rank', { rank: d.rank })));
    if (d.world && d.best > 0) {
      // 전체 순위는 서버 응답을 기다렸다가 채운다 (못 받으면 조용히 지운다)
      var worldEl = el('div', 'world-rank', t('world.loading'));
      add(body, worldEl);
      d.world.then(function (r) {
        if (!worldEl.parentNode) return;
        if (!r) { worldEl.parentNode.removeChild(worldEl); return; }
        var p = KLD.online.pct(r.rank, r.total);
        worldEl.textContent = t('final.world', { rank: r.rank, total: r.total }) + (p ? ' · ' + t('final.worldTop', { pct: p }) : '');
      });
    }
    if (d.best > 0) {
      // 이름은 선택 사항: 기록 카드와 내 기록 목록에 표시된다
      var row = el('div', 'name-row');
      var nameInput = el('input', 'name-input');
      nameInput.type = 'text';
      nameInput.placeholder = t('final.namePh', { n: KLD.storage.NAME_MAX });
      nameInput.value = d._name != null ? d._name : (d.lastName || '');
      nameInput.setAttribute('autocomplete', 'off');
      nameInput.setAttribute('autocapitalize', 'off');
      nameInput.setAttribute('spellcheck', 'false');
      nameInput.setAttribute('aria-label', t('final.name'));
      /*
       * 이름은 "보이는 글자 8자"까지. 이모지는 한 글자가 여러 칸(UTF-16)을 차지하므로 고정 maxLength 로는 셀 수 없다.
       * 그래서 8자가 찼으면 maxLength 를 지금 길이로 줄여 브라우저가 더 받지 않게 하고(커서가 튀거나 뒷글자가 사라지지 않는다),
       * 덜 찼으면 넉넉히 열어 둔다. 붙여넣기처럼 한 번에 넘친 경우만 잘라 낸다.
       */
      function syncLimit() {
        var n = KLD.text.units(nameInput.value).length, max = KLD.storage.NAME_MAX;
        nameInput.maxLength = n >= max ? Math.max(1, nameInput.value.length) : nameInput.value.length + (max - n) * 12;
      }
      function trimName(force) {
        var over = KLD.text.units(nameInput.value.trim()).length > KLD.storage.NAME_MAX;
        if (force || over) {
          var clean = KLD.storage.cleanName(nameInput.value);
          if (nameInput.value !== clean) {
            var pos = force ? -1 : nameInput.selectionStart;
            nameInput.value = clean;
            if (pos >= 0) { try { pos = Math.min(pos, clean.length); nameInput.setSelectionRange(pos, pos); } catch (e) { /* 무시 */ } }
          }
        }
        d._name = nameInput.value;
        syncLimit();
      }
      // 한글 조합 중에는 값을 건드리지 않는다 (제한만 다시 맞춘다)
      nameInput.addEventListener('input', function (ev) { if (ev && ev.isComposing) { d._name = nameInput.value; syncLimit(); } else trimName(false); });
      nameInput.addEventListener('change', function () { trimName(true); h.onName(nameInput.value); });
      nameInput.addEventListener('blur', function () { trimName(true); h.onName(nameInput.value); try { root.scrollTo(0, 0); } catch (e) { /* 무시 */ } });
      syncLimit();
      add(row, el('span', 'set-label', t('final.name')), nameInput);
      add(body, row);
    }
    var share = btn(t('final.share'), 'primary', function () { h.onShare(); });
    share.setAttribute('data-focus', '1');
    add(m.panel, body, share);
    if (d.continueLabel) add(m.panel, btn(d.continueLabel, 'accent', function () { h.onContinue(); }));
    var foot = el('div', 'btn-row');
    add(foot, btn(t('final.retry'), '', function () { h.onRetry(); }), btn(t('final.title'), 'ghost', function () { h.onTitle(); }));
    add(m.panel, foot);
    var cta = KLD.config.brand.cta;
    if (cta && cta.url) {
      add(m.panel, btn(cta.label[KLD.i18n.lang()] || cta.label.ko, 'link', function () {
        if (KLD.config.track) { try { KLD.config.track('cta_click', {}); } catch (e) { /* 무시 */ } }
        try { root.open(cta.url, '_blank', 'noopener'); } catch (e) { root.location.href = cta.url; }
      }));
    }
    show(m.wrap, showFinal, [d, h]);
  }

  // ── 일시정지 ─────────────────────────────────────────────
  function showPause(opts, h) {
    var m = modal('pause');
    add(m.panel, el('h2', null, t('pause.title')));
    var resume = btn(t('pause.resume'), 'primary', function () { h.onResume(); });
    resume.setAttribute('data-focus', '1'); resume.setAttribute('data-cancel', '1');
    function back() { showPause(opts, h); }
    add(m.panel, resume,
      btn(t('pause.restart'), '', function () { h.onRestart(); }),
      btn(t('title.settings'), '', function () { showSettings(back); }),
      btn(t('title.howto'), '', function () { showHowto(back); }),
      btn(t(opts.practice ? 'pause.practiceQuit' : 'pause.quit'), 'ghost', function () { h.onQuit(); }));
    show(m.wrap, showPause, [opts, h]);
  }

  var api = {
    init: init, layout: layout, hide: hide, isOpen: isOpen, refresh: refresh, push: push, pop: pop,
    showTitle: showTitle, showHowto: showHowto, showSettings: showSettings, showRanking: showRanking,
    showRoundIntro: showRoundIntro, showFieldResult: showFieldResult, showMatchResult: showMatchResult,
    showWalkoff: showWalkoff, showFinal: showFinal, showPause: showPause,
    el: el, add: add, btn: btn, modal: modal, distU: distU
  };
  KLD.ui = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
