/*
 * KLD LONG DRIVE — 문자열 (한국어 / English)
 * 화면에 나오는 문장은 이 파일에 있다. {name} 은 치환 자리.
 * (GO! · PERFECT! · TIME UP · WALK-OFF! · OB 같은 영문 게임 용어와 HUD 낱말은 두 언어 공통이라 코드(game.js · render.js · ui.js)에 있다.)
 * 캔버스에 그려지는 문구(hint·coach·toast·res·mon)는 화면 폭이 좁으니 짧게 유지한다.
 */
(function (root) {
  'use strict';
  var KLD = root.KLD = root.KLD || {};

  var STR = {
    ko: {
      // 라운드
      'round.qual': '예선', 'round.qf': '8강', 'round.sf': '준결승', 'round.final': '결승', 'round.practice': '연습', 'round.warmup': '몸풀기',
      'round.n': 'ROUND {n}',
      // HUD
      'hud.shots': '타수',
      'wind.calm': '무풍', 'wind.tail': '순풍', 'wind.head': '맞바람', 'wind.cross': '옆바람',
      'wind.gustIn': '{s}초 뒤 돌풍', 'wind.gustNow': '돌풍!',
      'deck.aim': '조준', 'deck.traj': '탄도',
      'traj.low': '저', 'traj.mid': '중', 'traj.high': '고',
      'target.opp': '상대', 'target.cut': '컷', 'target.pb': '내 기록',
      // 안내
      'hint.tap': '탭해서 스윙 시작!', 'hint.power': '노란 구간에서 탭!', 'hint.impact': '흰 선에서 탭!',
      'hint.ff': '누르고 있으면 빨리감기', 'hint.next': '탭: 다음 공', 'hint.retry': '너무 약해요. 다시!',
      'coach.1': '첫 번째 탭: 스윙 시작', 'coach.1s': '화면 아무 곳이나 누르세요', 'coach.again': '한 번 더! 이번엔 실전 속도',
      'coach.2': '두 번째 탭: 파워!', 'coach.2s': '게이지가 노란 구간에 오면',
      'coach.3': '세 번째 탭: 임팩트!', 'coach.3s': '커서가 흰 선에 오면',
      'coach.late': '{ms}ms 늦었어요', 'coach.early': '{ms}ms 빨랐어요', 'coach.missSub': '흰 선에 올 때 눌러 보세요',
      // 결과
      'res.in': '그리드 인!', 'res.best': '최고 기록 갱신!', 'res.pass': '컷 통과권!', 'res.walkoff': '상대 기록 돌파!',
      'res.ob': '그리드 밖', 'res.obDist': '비공인 {v}', 'res.pb': '개인 최고 기록!',
      'res.ahead': '{who} 넘김', 'res.behind': '{who}까지',
      'mon.ball': '볼 스피드', 'mon.club': '헤드 · 스매시', 'mon.launch': '발사각 · 스핀', 'mon.carry': '캐리 + 런', 'mon.side': '좌우 편차',
      'toast.safe': '마지막 공! 판정을 넓혀 드립니다', 'toast.aimLeft': '옆바람! ◀ 쪽으로 조준 (1m/s = 2칸)', 'toast.aimRight': '옆바람! ▶ 쪽으로 조준 (1m/s = 2칸)', 'toast.club': '{v} CLUB 입성!', 'toast.time30': '{s}초 남았습니다! 공 {n}개',
      // 타이틀
      'title.start': '대회 시작', 'title.hint': '탭 세 번이면 한 방', 'title.practice': '연습', 'title.ranking': '내 기록',
      'title.howto': '조작법', 'title.settings': '설정', 'title.soundOn': '소리 켜짐', 'title.soundOff': '소리 꺼짐',
      'title.best': '내 최고 기록 {v}', 'title.noBest': '{balls}구 안에 {club}야드?',
      // 조작법
      'howto.title': '조작법',
      'howto.1': '탭 세 번으로 칩니다. 첫 탭은 스윙 시작 — 파워 게이지가 올라갑니다.',
      'howto.2': '둘째 탭은 파워 결정. 노란 구간(90~100%)이 풀스윙입니다.',
      'howto.3': '셋째 탭은 임팩트. 커서가 흰 선(스위트스팟)에 올 때 탭! 빠르면 훅, 늦으면 슬라이스.',
      'howto.4': '공이 그리드(흰 선 안)에 멈춰야 기록 인정. {balls}구 중 가장 긴 공으로 겨룹니다.',
      'howto.5': '레드존(100% 초과)은 8강부터, 세트당 {over}번. 더 멀리 가지만 스위트스팟이 좁아집니다.',
      'howto.6': '바람을 읽으세요. ◀▶ 조준(8강부터), 탄도 저·중·고(준결승부터), 그리고 돌풍 예고.',
      'howto.keys': 'PC: Space 스윙 · ←→ 조준 · ↑↓ 탄도 · M 소리 · Esc 일시정지',
      'howto.ok': '알겠어요',
      // 설정
      'set.title': '설정', 'set.unit': '거리 단위', 'set.lang': '언어', 'set.sound': '소리', 'set.music': '음악', 'set.vibrate': '진동',
      'set.on': '켜짐', 'set.off': '꺼짐', 'set.yd': '야드', 'set.m': '미터', 'set.ko': '한국어', 'set.en': 'English',
      'set.resetRank': '기록 지우기', 'set.resetAsk': '한 번 더 누르면 지웁니다',
      'common.close': '닫기',
      // 라운드 시작
      'intro.go': '티샷!',
      'intro.qual': '{n}명 중 상위 {k}명이 본선에 오릅니다',
      'intro.match': '1:1 매치 — 상대 기록을 넘기면 승리',
      'intro.rule': '{balls}구 · {time} · 그리드 폭 {w}',
      'intro.vs': 'VS',
      'intro.tape': '헤드 스피드 {mph} MPH · 예선 {seed}위 {v}',
      'intro.oppFirst': '상대가 먼저 쳤습니다',
      'intro.ntb': '넘어야 할 기록',
      'intro.cut': '컷 라인 ({k}위 기록)',
      'intro.windLabel': '바람',
      'intro.wind.qual': '약한 순풍', 'intro.wind.qf': '옆바람', 'intro.wind.sf': '맞바람 + 돌풍', 'intro.wind.final': '강한 순풍 + 돌풍',
      'intro.tip.qual': '공이 그리드 안에 멈춰야 기록 인정',
      'intro.tip.qf': 'NEW 조준 ◀▶ · 레드존 {over}회 (100%를 넘겨 탭)',
      'intro.tip.sf': 'NEW 탄도 저·중·고 · 돌풍 예고를 보세요',
      'intro.tip.final': '순풍 돌풍을 기다렸다가 띄워 치세요',
      // 예선 결과
      'field.title': '예선 결과', 'field.pass': '예선 통과!', 'field.fail': '예선 탈락', 'field.cutline': '— 컷 라인 —',
      'field.you': '나', 'field.norec': '기록 없음', 'field.rank': '{rank}위',
      // 매치 결과
      'match.title': '{round} 결과', 'match.win': '승리!', 'match.lose': '패배', 'match.rematch': '둘 다 기록 없음 — 재경기!',
      'match.others': '다른 경기', 'match.me': '나',
      'next.round': '다음: {round}', 'next.result': '결과 보기', 'next.rematch': '재경기',
      'walk.desc': '상대 기록을 넘겼습니다. 남은 공은 필요 없습니다!', 'walk.end': '다음으로', 'walk.more': '남은 {n}구로 기록 도전',
      // 최종 결과
      'final.champion': '우승!', 'final.second': '준우승', 'final.semi': '4강 진출', 'final.quarter': '8강 진출', 'final.qualOut': '예선 {rank}위',
      'final.championSub': 'KLD 장타왕 등극', 'final.best': '최장 기록', 'final.pb': '개인 최고 기록 갱신!',
      'final.club': '{v} CLUB', 'final.rank': '이 기기 기록 {rank}위',
      'final.name': '이름', 'final.namePh': '선택, {n}자까지',
      'final.share': '기록 공유', 'final.continue': '{round} 다시 도전 ({n}회 남음)', 'final.retry': '처음부터', 'final.title': '타이틀로', 'final.norec': '유효 기록 없음',
      // 내 기록
      'rank.title': '내 기록 (이 기기)', 'rank.empty': '아직 기록이 없습니다', 'rank.stage.0': '예선', 'rank.stage.1': '8강', 'rank.stage.2': '4강', 'rank.stage.3': '준우승', 'rank.stage.4': '우승',
      // 일시정지
      'pause.title': '일시정지', 'pause.resume': '계속하기', 'pause.restart': '처음부터', 'pause.quit': '타이틀로', 'pause.practiceQuit': '그만하기',
      // 공유
      'share.title': '기록 카드', 'share.do': '이미지로 공유', 'share.save': '이미지 저장', 'share.copy': '링크 복사',
      'share.tip': '카드를 꾹 눌러 저장하거나 스크린샷을 찍으세요',
      'share.copied': '복사했습니다. 단톡방에 붙여넣기!', 'share.saved': '저장이 시작되지 않으면 카드를 꾹 눌러 저장하세요', 'share.fail': '이 브라우저에서는 안 됩니다. 카드를 꾹 눌러 저장하세요',
      'share.text': '{event}에서 {v} 날렸다! ({rank}) 너도 도전해 봐',
      'share.textNo': '{event} 도전 중! 너도 도전해 봐',
      'card.best': '최장 기록', 'card.ball': '볼 스피드', 'card.carry': '캐리', 'card.player': '선수', 'card.dare': '이 기록, 넘길 수 있어?'
    },
    en: {
      'round.qual': 'QUALIFIER', 'round.qf': 'QUARTERS', 'round.sf': 'SEMIS', 'round.final': 'FINAL', 'round.practice': 'PRACTICE', 'round.warmup': 'WARM-UP',
      'round.n': 'ROUND {n}',
      'hud.shots': 'SHOTS',
      'wind.calm': 'CALM', 'wind.tail': 'TAIL', 'wind.head': 'HEAD', 'wind.cross': 'CROSS',
      'wind.gustIn': 'GUST IN {s}S', 'wind.gustNow': 'GUST!',
      'deck.aim': 'AIM', 'deck.traj': 'LOFT',
      'traj.low': 'LOW', 'traj.mid': 'MID', 'traj.high': 'HIGH',
      'target.opp': 'RIVAL', 'target.cut': 'CUT', 'target.pb': 'MY PB',
      'hint.tap': 'TAP TO SWING!', 'hint.power': 'TAP IN THE YELLOW!', 'hint.impact': 'TAP ON THE WHITE LINE!',
      'hint.ff': 'HOLD TO FAST-FORWARD', 'hint.next': 'TAP: NEXT BALL', 'hint.retry': 'TOO SOFT. AGAIN!',
      'coach.1': 'TAP 1: START THE SWING', 'coach.1s': 'Tap anywhere', 'coach.again': 'Once more, at real speed',
      'coach.2': 'TAP 2: POWER!', 'coach.2s': 'When the gauge is yellow',
      'coach.3': 'TAP 3: IMPACT!', 'coach.3s': 'On the white line',
      'coach.late': '{ms}ms late', 'coach.early': '{ms}ms early', 'coach.missSub': 'Tap on the white line',
      'res.in': 'IN THE GRID!', 'res.best': 'NEW BEST!', 'res.pass': 'INSIDE THE CUT!', 'res.walkoff': 'WALK-OFF!',
      'res.ob': 'OUT', 'res.obDist': 'UNOFFICIAL {v}', 'res.pb': 'PERSONAL BEST!',
      'res.ahead': 'PAST {who}', 'res.behind': 'TO {who}',
      'mon.ball': 'BALL SPEED', 'mon.club': 'CLUB · SMASH', 'mon.launch': 'LAUNCH · SPIN', 'mon.carry': 'CARRY + ROLL', 'mon.side': 'OFFLINE',
      'toast.safe': 'LAST BALL! WIDER SWEET SPOT', 'toast.aimLeft': 'CROSSWIND! AIM LEFT (1M/S = 2 CLICKS)', 'toast.aimRight': 'CROSSWIND! AIM RIGHT (1M/S = 2 CLICKS)', 'toast.club': 'WELCOME TO THE {v} CLUB!', 'toast.time30': '{s} SECONDS LEFT! {n} BALLS',
      'title.start': 'START', 'title.hint': 'THREE TAPS. ONE BOMB.', 'title.practice': 'PRACTICE', 'title.ranking': 'RECORDS',
      'title.howto': 'HOW TO', 'title.settings': 'SETTINGS', 'title.soundOn': 'SOUND ON', 'title.soundOff': 'SOUND OFF',
      'title.best': 'MY BEST {v}', 'title.noBest': '{club} YARDS IN {balls} BALLS?',
      'howto.title': 'HOW TO PLAY',
      'howto.1': 'Three taps per shot. Tap one starts the swing and the power gauge rises.',
      'howto.2': 'Tap two sets your power. The yellow zone (90-100%) is a full swing.',
      'howto.3': 'Tap three is impact. Tap when the cursor reaches the white line. Early hooks, late slices.',
      'howto.4': 'The ball must stop inside the grid (white lines) to count. Longest of {balls} balls wins.',
      'howto.5': 'The red zone (over 100%) opens in the quarter-final, {over} times per set. More distance, narrower sweet spot.',
      'howto.6': 'Read the wind. Aim with the arrows (from the quarter-final), pick a low, mid or high loft (from the semi-final), and watch the gust forecast.',
      'howto.keys': 'PC: Space swing · ←→ aim · ↑↓ loft · M sound · Esc pause',
      'howto.ok': 'GOT IT',
      'set.title': 'SETTINGS', 'set.unit': 'UNITS', 'set.lang': 'LANGUAGE', 'set.sound': 'SOUND', 'set.music': 'MUSIC', 'set.vibrate': 'VIBRATION',
      'set.on': 'ON', 'set.off': 'OFF', 'set.yd': 'YARDS', 'set.m': 'METRES', 'set.ko': '한국어', 'set.en': 'English',
      'set.resetRank': 'CLEAR RECORDS', 'set.resetAsk': 'Press again to clear',
      'common.close': 'CLOSE',
      'intro.go': 'TEE OFF!',
      'intro.qual': 'Top {k} of {n} advance',
      'intro.match': 'Head to head - beat the number to win',
      'intro.rule': '{balls} balls · {time} · {w} grid',
      'intro.vs': 'VS',
      'intro.tape': 'Club speed {mph} MPH · Seed {seed}, {v}',
      'intro.oppFirst': 'Your rival hit first',
      'intro.ntb': 'NUMBER TO BEAT',
      'intro.cut': 'CUT LINE ({k}TH PLACE)',
      'intro.windLabel': 'WIND',
      'intro.wind.qual': 'Light tailwind', 'intro.wind.qf': 'Crosswind', 'intro.wind.sf': 'Headwind with gusts', 'intro.wind.final': 'Strong tailwind with gusts',
      'intro.tip.qual': 'The ball must stop inside the grid to count',
      'intro.tip.qf': 'NEW: aim with the arrows · red zone x{over} (tap past 100%)',
      'intro.tip.sf': 'NEW: low, mid or high loft · watch the gust forecast',
      'intro.tip.final': 'Wait for a tail gust and launch it high',
      'field.title': 'QUALIFIER RESULTS', 'field.pass': 'YOU QUALIFIED!', 'field.fail': 'ELIMINATED', 'field.cutline': '- CUT LINE -',
      'field.you': 'YOU', 'field.norec': 'NO RECORD', 'field.rank': '#{rank}',
      'match.title': '{round} RESULT', 'match.win': 'YOU WIN!', 'match.lose': 'YOU LOSE', 'match.rematch': 'No valid ball from either side - rematch!',
      'match.others': 'OTHER MATCHES', 'match.me': 'YOU',
      'next.round': 'NEXT: {round}', 'next.result': 'SEE RESULT', 'next.rematch': 'REMATCH',
      'walk.desc': 'You beat the number. No more balls needed!', 'walk.end': 'CONTINUE', 'walk.more': 'HIT {n} MORE FOR THE RECORD',
      'final.champion': 'CHAMPION!', 'final.second': 'RUNNER-UP', 'final.semi': 'SEMI-FINALIST', 'final.quarter': 'QUARTER-FINALIST', 'final.qualOut': 'QUALIFIER #{rank}',
      'final.championSub': 'KLD LONG DRIVE CHAMPION', 'final.best': 'LONGEST DRIVE', 'final.pb': 'NEW PERSONAL BEST!',
      'final.club': '{v} CLUB', 'final.rank': '#{rank} on this device',
      'final.name': 'NAME', 'final.namePh': 'Optional, max {n}',
      'final.share': 'SHARE', 'final.continue': 'RETRY THE {round} ({n} LEFT)', 'final.retry': 'START OVER', 'final.title': 'TITLE', 'final.norec': 'NO VALID BALL',
      'rank.title': 'MY RECORDS (THIS DEVICE)', 'rank.empty': 'No records yet', 'rank.stage.0': 'QUAL', 'rank.stage.1': 'QF', 'rank.stage.2': 'SF', 'rank.stage.3': '2ND', 'rank.stage.4': 'CHAMP',
      'pause.title': 'PAUSED', 'pause.resume': 'RESUME', 'pause.restart': 'START OVER', 'pause.quit': 'TITLE', 'pause.practiceQuit': 'QUIT',
      'share.title': 'SCORE CARD', 'share.do': 'SHARE IMAGE', 'share.save': 'SAVE IMAGE', 'share.copy': 'COPY LINK',
      'share.tip': 'Long-press the card to save it, or take a screenshot',
      'share.copied': 'Copied. Paste it in your chat!', 'share.saved': 'If the download does not start, long-press the card to save it', 'share.fail': 'Not supported here. Long-press the card to save it',
      'share.text': 'I drove it {v} at the {event}! ({rank}) Can you beat me?',
      'share.textNo': 'Taking on the {event}! Can you beat me?',
      'card.best': 'LONGEST DRIVE', 'card.ball': 'BALL SPEED', 'card.carry': 'CARRY', 'card.player': 'PLAYER', 'card.dare': 'CAN YOU BEAT THIS?'
    }
  };

  var lang = 'ko';

  function t(key, vars) {
    var s = STR[lang][key];
    if (s == null) s = STR.ko[key];
    if (s == null) return key;
    if (vars) {
      s = s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; });
    }
    return s;
  }

  var api = {
    t: t,
    lang: function () { return lang; },
    setLang: function (l) { lang = (l === 'en') ? 'en' : 'ko'; },
    has: function (key) { return STR.ko[key] != null; },
    _strings: STR
  };
  KLD.i18n = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
