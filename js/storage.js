/*
 * KLD LONG DRIVE — 저장 (localStorage)
 * 설정, 개인 최고 기록, 이 기기의 기록 목록, 입력 지연 보정값. 거리는 전부 미터로 저장한다.
 * 저장소를 못 쓰는 환경(사파리 개인정보 보호 모드, 쿠키 차단 등)에서도 게임은 메모리로 계속 돌아간다.
 */
(function (root) {
  'use strict';
  var KLD = root.KLD = root.KLD || {};

  var KEY = 'kld-longdrive-v1';
  var RANK_MAX = 20;
  var data = null;

  function defaults() {
    var d = (KLD.config && KLD.config.defaults) || {};
    return {
      settings: {
        unit: d.unit || 'yd', lang: d.lang || 'ko',
        sound: d.sound !== false, music: d.music !== false, vibrate: d.vibrate !== false
      },
      best: 0,                // 개인 최고 기록(m)
      bestStage: -1,          // 가장 멀리 간 라운드 (4 = 우승)
      plays: 0,
      wins: 0,
      lastName: '',
      seenHowto: false,
      offsets: null,          // 입력 지연 보정 { touch, mouse, key } (ms)
      ranking: []             // [{ name, m, stage, ts }]
    };
  }

  function num(v, lo, hi) { v = +v; return (isFinite(v) && v >= lo && v <= hi) ? v : null; }

  function load() {
    var base = defaults();
    try {
      var raw = root.localStorage ? root.localStorage.getItem(KEY) : null;
      if (raw) {
        var obj = JSON.parse(raw);
        if (obj && typeof obj === 'object') {
          var k;
          for (k in base.settings) {
            if (obj.settings && typeof obj.settings[k] === typeof base.settings[k]) base.settings[k] = obj.settings[k];
          }
          if (num(obj.best, 0, 2000) != null) base.best = +obj.best;
          if (num(obj.bestStage, -1, 4) != null) base.bestStage = +obj.bestStage;
          if (num(obj.plays, 0, 1e9) != null) base.plays = +obj.plays;
          if (num(obj.wins, 0, 1e9) != null) base.wins = +obj.wins;
          if (typeof obj.lastName === 'string') base.lastName = cleanName(obj.lastName);
          base.seenHowto = !!obj.seenHowto;
          if (obj.offsets && typeof obj.offsets === 'object') {
            var o = {}, ok = true;
            ['touch', 'mouse', 'key'].forEach(function (key) {
              var v = num(obj.offsets[key], 0, 200);
              if (v == null) ok = false; else o[key] = v;
            });
            if (ok) base.offsets = o;
          }
          if (Array.isArray(obj.ranking)) {
            base.ranking = obj.ranking.filter(function (r) {
              return r && typeof r.name === 'string' && num(r.m, 0, 2000) != null;
            }).map(function (r) {
              return { name: cleanName(r.name) || 'PLAYER', m: +r.m, stage: num(r.stage, 0, 4) || 0, ts: +r.ts || 0 };
            }).slice(0, RANK_MAX);
          }
        }
      }
    } catch (e) { /* 손상된 데이터는 무시하고 기본값으로 시작 */ }
    if (base.settings.unit !== 'm') base.settings.unit = 'yd';
    if (base.settings.lang !== 'en') base.settings.lang = 'ko';
    data = base;
    return data;
  }

  function save() {
    if (!data) return false;
    try {
      if (root.localStorage) root.localStorage.setItem(KEY, JSON.stringify(data));
      return true;
    } catch (e) { return false; }
  }

  function get() { return data || load(); }

  function setSetting(key, value) {
    get().settings[key] = value;
    save();
  }

  var NAME_MAX = 8;
  // 이름 정리: 앞뒤 공백 제거, 제어문자·꺾쇠 제거, 최대 8자.
  // "8자"는 화면에 보이는 글자 수로 센다 (이모지나 풀어 쓴 한글이 중간에서 잘리지 않게).
  function cleanName(name) {
    var s = String(name == null ? '' : name).replace(/[\u0000-\u001f\u007f-\u009f<>]/g, '');
    if (s.normalize) { try { s = s.normalize('NFC'); } catch (e) { /* 그대로 둔다 */ } }
    s = s.trim();
    var parts = null;
    try {
      if (typeof Intl !== 'undefined' && Intl.Segmenter) {
        parts = [];
        var it = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)[Symbol.iterator](), step;
        while (!(step = it.next()).done) parts.push(step.value.segment);
      }
    } catch (e2) { parts = null; }
    if (!parts) parts = Array.from ? Array.from(s) : s.split('');
    var out = parts.slice(0, NAME_MAX).join('').trim();
    // 보이는 글자가 하나도 없는 이름(공백 문자·폭 없는 문자만)은 빈 이름으로 본다
    if (!/[^\s\u00ad\u034f\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u206f\u2800\u3164\ufe00-\ufe0f\ufeff\uffa0]/.test(out)) out = '';
    return out;
  }

  // 한 판(run)의 기록을 넣거나 고쳐 쓴다. 한 판은 목록에서 한 줄만 차지한다.
  // ts 가 같은 줄이 있으면 더 좋은 값으로 갱신하고, 없으면(또는 ts 를 안 주면) 새 줄을 만든다.
  // 반환값: { rank(1부터, 목록 밖이면 0), ts(이 줄의 식별자) }
  function upsertRun(ts, name, m, stage) {
    var d = get(), entry = null, i;
    if (ts) for (i = 0; i < d.ranking.length; i++) if (d.ranking[i].ts === ts) { entry = d.ranking[i]; break; }
    if (entry) {
      if (m > entry.m) entry.m = Math.round(m * 100) / 100;
      if (stage > entry.stage) entry.stage = stage;
    } else {
      var id = ts || Date.now();
      for (i = 0; i < d.ranking.length; i++) if (d.ranking[i].ts === id) { id++; i = -1; }   // 식별자는 겹치지 않게
      entry = { name: cleanName(name) || 'PLAYER', m: Math.round(m * 100) / 100, stage: stage, ts: id };
      d.ranking.push(entry);
    }
    d.ranking.sort(function (a, b) { return b.m - a.m || a.ts - b.ts; });
    var idx = d.ranking.indexOf(entry);
    d.ranking = d.ranking.slice(0, RANK_MAX);
    save();
    return { rank: idx < RANK_MAX ? idx + 1 : 0, ts: entry.ts };
  }

  // 새 기록 한 줄 추가
  function addRanking(name, m, stage) { return upsertRun(0, name, m, stage); }

  // 방금 등록한 기록의 이름을 바꾼다
  function renameEntry(ts, name) {
    var d = get(), n = cleanName(name);
    d.lastName = n;
    for (var i = 0; i < d.ranking.length; i++) {
      if (d.ranking[i].ts === ts) d.ranking[i].name = n || 'PLAYER';
    }
    save();
  }

  // 기록 지우기: 목록뿐 아니라 최고 기록과 이름까지 지운다 (행사 기기에서 다음 사람이 깨끗한 상태로 시작하도록)
  function clearRanking() {
    var d = get();
    d.ranking = [];
    d.best = 0; d.bestStage = -1; d.lastName = '';
    save();
  }

  var api = {
    load: load, save: save, get: get, setSetting: setSetting,
    addRanking: addRanking, upsertRun: upsertRun, renameEntry: renameEntry, clearRanking: clearRanking, cleanName: cleanName,
    NAME_MAX: NAME_MAX, RANK_MAX: RANK_MAX
  };
  KLD.storage = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
