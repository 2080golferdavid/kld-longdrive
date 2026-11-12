/*
 * KLD LONG DRIVE — 온라인 랭킹 (Supabase)
 * 기기마다 최고 기록 한 줄을 서버에 올리고, 전체 순위·상위 %를 받아 온다.
 * 서버는 함수(RPC)만 열려 있고(ld_submit_score · ld_leaderboard · ld_standing), 테이블은 직접 읽고 쓸 수 없다.
 * 네트워크가 안 되거나 설정(KLD.config.online)이 비어 있으면 모든 호출이 조용히 null 을 돌려주고 게임은 그대로 돈다.
 */
(function (root) {
  'use strict';
  var KLD = root.KLD = root.KLD || {};

  var TIMEOUT = 7000;
  var timer = null;
  var last = null;                 // 마지막 등록 응답 { rank, total, m }

  function cfg() { return KLD.config && KLD.config.online; }
  function enabled() {
    var c = cfg();
    return !!(c && c.url && c.key && root.fetch && root.Promise);
  }

  function newToken() {
    var out = '', i;
    try {
      var a = new Uint8Array(24);
      root.crypto.getRandomValues(a);
      for (i = 0; i < a.length; i++) out += ('0' + a[i].toString(16)).slice(-2);
      return out;
    } catch (e) {
      for (i = 0; i < 48; i++) out += Math.floor(Math.random() * 16).toString(16);
      return out;
    }
  }

  // 이 기기를 구분하는 비밀 값. 화면·목록에는 절대 나오지 않는다 (남의 기록을 덮어쓰지 못하게).
  function token() {
    var d = KLD.storage.get();
    if (!d.onlineToken) { d.onlineToken = newToken(); KLD.storage.save(); }
    return d.onlineToken;
  }

  // 랭킹에 보이는 이름. 이름을 안 적었으면 기기마다 고정된 번호를 붙인다 (PLR4821 — 이름은 최대 8자라서 PLAYER 대신 PLR).
  function displayName() {
    var n = KLD.storage.get().lastName;
    if (n) return n;
    var num = parseInt(token().slice(0, 8), 16) % 10000;
    return 'PLR' + ('000' + num).slice(-4);
  }

  function rpc(fn, body) {
    return new Promise(function (resolve) {
      var c = cfg(), ctl = null, to = null;
      try {
        if (root.AbortController) { ctl = new root.AbortController(); to = setTimeout(function () { ctl.abort(); }, TIMEOUT); }
        root.fetch(c.url.replace(/\/$/, '') + '/rpc/' + fn, {
          method: 'POST',
          headers: { 'apikey': c.key, 'Authorization': 'Bearer ' + c.key, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: ctl ? ctl.signal : undefined
        }).then(function (r) { return r.ok ? r.json() : null; })
          .then(function (j) { if (to) clearTimeout(to); resolve(j); })
          .catch(function () { if (to) clearTimeout(to); resolve(null); });
      } catch (e) { if (to) clearTimeout(to); resolve(null); }
    });
  }

  // 내 최고 기록을 올린다. 서버는 더 좋은 값만 남긴다. 반환: Promise<{rank,total,m}|null>
  function submit() {
    var d = KLD.storage.get();
    if (!enabled() || !(d.best > 0)) return Promise.resolve(null);
    return rpc('ld_submit_score', {
      p_token: token(), p_name: displayName(), p_m: d.best,
      p_stage: Math.max(0, d.bestStage), p_lang: KLD.i18n ? KLD.i18n.lang() : 'ko'
    }).then(function (r) { if (r && r.rank) last = r; return r && r.rank ? r : null; });
  }

  // 이름을 고치는 동안 연달아 호출되므로 잠깐 모았다가 한 번만 올린다
  function submitSoon() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () { timer = null; submit(); }, 800);
  }

  function top(n) {
    if (!enabled()) return Promise.resolve(null);
    return rpc('ld_leaderboard', { p_limit: n || 20 }).then(function (r) { return Array.isArray(r) ? r : null; });
  }

  // 이 기록(미터)이 전체에서 몇 위인지. 반환: Promise<{rank,total}|null>
  function standing(m) {
    if (!enabled()) return Promise.resolve(null);
    return rpc('ld_standing', { p_m: m }).then(function (r) { return r && r.rank ? r : null; });
  }

  // 상위 몇 %인지 (표본이 너무 적으면 0 = 표시하지 않음)
  function pct(rank, total) {
    if (!(total >= 10) || !(rank >= 1)) return 0;
    return Math.max(1, Math.min(100, Math.ceil(rank / total * 100)));
  }

  var api = { enabled: enabled, displayName: displayName, submit: submit, submitSoon: submitSoon, top: top, standing: standing, pct: pct, last: function () { return last; } };
  KLD.online = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
