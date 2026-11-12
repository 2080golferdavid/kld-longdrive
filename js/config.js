/*
 * KLD LONG DRIVE — 설정
 * 브랜드·규칙·난이도 숫자는 이 파일에서 바꾼다.
 * (여기 없는 것: 돌풍 시간표와 탑볼·뽕샷 수치는 js/shot.js, 히트스톱·몸풀기 보정은 js/game.js)
 */
(function (root) {
  'use strict';
  var KLD = root.KLD = root.KLD || {};

  KLD.config = {
    version: '0.3.0',          // 정보용 (코드에서 읽지 않는다)

    // ── 온라인 랭킹 (Supabase) ──────────────────────────────
    // key 는 공개용(publishable) 키라 코드에 있어도 된다. 서버는 ld_* 함수만 열려 있다. url 을 비우면 온라인 기능이 꺼진다.
    online: {
      url: 'https://erjpksongpivpxadqxll.supabase.co/rest/v1',
      key: 'sb_publishable_em4kaVn87xCA0ncU8tVcIA_Mz3foO-r'
    },

    // ── 브랜드 ─────────────────────────────────────────────
    brand: {
      name: 'KLD',                              // 픽셀 로고 데이터(js/logo-data.js)가 없을 때 쓰는 글자
      subtitle: 'KOREA LONG DRIVE',
      eventName: { ko: 'KLD 장타 챔피언십', en: 'KLD LONG DRIVE CHAMPIONSHIP' },
      tagline: { ko: '8비트 장타 챌린지', en: '8-BIT LONG DRIVE CHALLENGE' },
      // 그리드 옆 광고판 문구 (영문 대문자·숫자). 'LOGO' 는 KLD 로고 간판.
      sponsors: ['LOGO', 'KOREA LONG DRIVE', 'GO LONG', 'LOGO', 'FULL SEND', '400 CLUB'],
      // 공유할 때 붙는 주소. 비워 두면 현재 페이지 주소를 쓴다. (배포 후 실제 주소로 채우는 것을 권장)
      shareUrl: 'https://kld-longdrive.vercel.app',
      hashtags: ['KLD', '코리아롱드라이브', '장타', '장타왕'],
      // 결과 화면에서 KLD로 나가는 버튼. url 을 비워 두면 버튼이 나오지 않는다.
      cta: { label: { ko: 'KLD 인스타그램 보기', en: 'KLD ON INSTAGRAM' }, url: 'https://www.instagram.com/korea_longdrive/' },
      colors: { primary: '#e60012', dark: '#141c33' }   // primary: 광고판·백드롭·카드의 띠, dark: 간판 바탕
    },

    // 성과 측정 훅: track('first_swing', {...}) 식으로 불린다. 분석 도구를 붙일 때 이 함수를 바꾼다.
    track: function (/* event, props */) {},

    // ── 대회 규칙 ───────────────────────────────────────────
    rules: {
      ballsPerSet: 6,
      setTimeSec: 150,          // 표시되는 세트 시간. 어드레스·게이지 중에 흐른다.
      flightClockCostSec: 10,   // 공이 나는 시간 몫으로 임팩트마다 깎는 시간
      gridWidthYd: 60,          // 그리드 전체 폭
      // (예선 인원은 아래 cpu 명단 + 플레이어, 본선 인원은 8강 대진에 묶인 고정값 8 이다 — js/tournament.js 의 ADVANCE)
      clubLineYd: 400,          // 금색 라인 ("400 CLUB")
      continues: 1              // 탈락했을 때 같은 라운드 재도전 횟수
    },

    defaults: { unit: 'yd', lang: 'ko', sound: true, music: true, vibrate: true },

    // ── 플레이어 능력 ───────────────────────────────────────
    player: {
      clubSpeedMaxMph: 147      // 파워 100%일 때 헤드 스피드
    },

    // ── 게이지 ─────────────────────────────────────────────
    gauge: {
      powerEaseSec: 0.25,       // 처음에만 살짝 가속
      powerRate: 1.0,           // 이후 등속 (초당 100%)
      powerCycles: 2,           // 이만큼 왕복하면 어드레스로 복귀
      cancelBelow: 0.30,        // 이보다 낮은 파워에서 탭하면 취소 (공 소모 없음)
      fullFrom: 0.90,           // 여기부터 FULL 구간
      overMax: 1.08,            // 레드존 끝
      overCharges: 2,           // 세트당 레드존 사용 횟수
      overSpeedPerUnit: 0.5,    // 100% 초과분 1.0 당 헤드 스피드 증가율 (108% → +4%)
      topPauseSec: 0.29,        // 파워 확정 후 다운스윙 시작까지
      sweepSec: 0.75,           // 임팩트 커서 통과 시간 (고정 템포)
      sweetPos: 0.78,           // 임팩트 바에서 스위트스팟 위치
      windowMs: { safe: 150, full: 100, over: 60 },   // 오차 e = 1 에 해당하는 시간(ms)
      perfect: 0.25,
      great: 0.5,
      good: 0.8,
      missE: 1.5,               // 끝까지 안 눌렀을 때의 오차
      // 입력 잠금 (사고 방지)
      lockout: { powerSec: 0.25, impactU: 0.25, flightSec: 0.6, addressSec: 0.35 },
      // 화면·터치 지연 보정 기본값 (ms). 플레이 기록으로 조금씩 자동 보정된다.
      inputOffsetMs: { touch: 45, mouse: 25, key: 25 },
      offsetAdaptRate: 0.5, offsetMaxMs: 120
    },

    // ── 샷 모델 (게이지 결과 → 발사 조건) ────────────────────
    shot: {
      speedFloor: 0.60,         // 파워 0일 때의 스피드 비율
      speedCurve: 1.5,
      smashMax: 1.488,          // × perfectBonus = 1.50 (드라이버 한계)
      smashLossEarly: 0.08,     // |e| = 1 에서 잃는 스매시 (빠른 쪽: 닫힌 페이스)
      smashLossLate: 0.12,      // (늦은 쪽: 열린 페이스)
      smashFloor: 1.30,
      perfectBonus: 1.008,
      perfectDirScale: 0.5,     // PERFECT일 때 방향 오차를 이만큼으로 줄인다
      earlyDirScale: 0.88,      // 빠른 쪽(드로우)은 더 굴러서 옆으로 많이 가므로 방향 오차를 조금 줄여 좌우 균형을 맞춘다
      traj: {
        low:  { launch: 8.0,  spin: 2050, loft: 4 },
        mid:  { launch: 12.5, spin: 2300, loft: 6 },
        high: { launch: 16.0, spin: 2300, loft: 8 }
      },
      launchPerE: 0.8,          // 늦으면 뜨고 빠르면 깔린다
      spinPerE: 300,            // 늦으면 스핀이 늘고 빠르면 준다
      spinFloor: 1600,
      azimuthPerE: 1.2,         // 출발 방향 (도)
      sidespinPerE: 300,        // rpm
      noise: { launch: 0.3, spin: 60, azimuth: 0.2, speed: 0.003 },   // PERFECT 0배, GREAT 0.5배, 그 외 1배
      aimStep: 0.5,             // 조준 한 칸 (도)
      aimMax: 8,
      aimPerWind: 1.15          // 옆바람 1 m/s 를 상쇄하는 조준각(도) 근삿값 (약 2칸)
    },

    // 높이에 따른 바람 배율: 표시 풍속 × clamp(base + y / scale, min, max)
    windProfile: { base: 0.5, scale: 50, min: 0.5, max: 2.0 },

    // 연속 실패 완충
    assist: { perMiss: 0.12, max: 1.48, lastBallWindow: 1.5, lastBallSpin: 0.6 },

    // 재생 속도
    pacing: { flightSpeed: 1.5, dullSpeed: 3.0, holdSpeed: 4.0, slowSpeed: 0.4, resultHoldSec: 2.6, dullMarginYd: 15, nearMarginYd: 8 },

    // ── 라운드 ─────────────────────────────────────────────
    // wind: base = 기본 바람(m/s, x: +순풍 / z: +오른쪽으로 부는 바람)
    // gust: 예고되는 돌풍. ax·az = 세기 범위, favor = 순풍 쪽일 확률
    // (돌풍 값과 windowScale 도 난이도에 영향을 준다. 고친 뒤에는 node tests/balance.js 로 확인할 것)
    // unlock: 그 라운드부터 쓸 수 있는 것, windowScale: 판정 창 배율(초반 라운드는 후하다)
    rounds: [
      { id: 'qual',  type: 'field', theme: 'morning', windowScale: 1.25,
        wind: { baseX: 2.0, baseZ: 0.2 }, gust: null,
        unlock: { aim: false, traj: false, over: false } },
      { id: 'qf',    type: 'match', theme: 'day', windowScale: 1.1,
        wind: { baseX: 0.4, baseZ: 2.5 }, gust: null,
        unlock: { aim: true, traj: false, over: true } },
      { id: 'sf',    type: 'match', theme: 'sunset', windowScale: 1.0,
        wind: { baseX: -3.0, baseZ: -0.6 }, gust: { ax: 2.0, az: 0.5, favor: 0.65 },
        unlock: { aim: true, traj: true, over: true } },
      { id: 'final', type: 'match', theme: 'night', windowScale: 1.0,
        wind: { baseX: 3.0, baseZ: 0.0 }, gust: { ax: 3.0, az: 1.0, favor: 0.5 },
        unlock: { aim: true, traj: true, over: true } }
    ],
    practiceRound: { id: 'practice', type: 'practice', theme: 'day', windowScale: 1.0,
      wind: { baseX: 1.0, baseZ: 1.0 }, gust: { ax: 2.0, az: 1.5, favor: 0.5 },
      unlock: { aim: true, traj: true, over: true } },
    warmupRound: { id: 'warmup', type: 'warmup', theme: 'morning', windowScale: 1.5,
      wind: { baseX: 1.0, baseZ: 0.0 }, gust: null,
      unlock: { aim: false, traj: false, over: false } },

    // ── CPU 선수 ───────────────────────────────────────────
    // speed: 최고 헤드 스피드(mph), power: 평균 파워(100% 상한 — CPU 는 레드존을 쓰지 않는다), powerSd: 파워의 흔들림,
    // timingMs: 임팩트 타이밍 표준편차, read: 바람 읽는 능력(0~1)
    //   read 는 계단식이다: 0.25 미만이면 바람 후보 시각 1개, 0.25~0.74 는 2개, 0.75 이상은 3개 중 순풍이 가장 센 때에 친다.
    //   같은 계단 안에서는 조준 정확도만 달라진다(옆바람이 부는 8강에서만 조금 영향).
    // (값은 tests/balance.js 의 봇 시뮬레이션으로 맞춘다. 고친 뒤에는 옵션 없이 전체 표를 돌려 확인할 것)
    // 구성: 보스(king) 한 명만 꾸준하고(timingMs 75), 나머지는 실제 장타 선수처럼 "크게 치지만 절반은 못 넣는다"(timingMs 178~212).
    //       CPU 의 탑볼·뽕샷은 기록으로 치지 않는다(OB 처리). 순서는 강한 선수부터.
    cpu: [
      { id: 'king',    name: { ko: '킹콩 장',     en: 'KINGKONG J' }, speed: 150, power: 0.99,  powerSd: 0.01,  timingMs: 75,  read: 0.95, boss: true },
      { id: 'missile', name: { ko: '미사일 최',   en: 'MISSILE C' },  speed: 149, power: 0.99,  powerSd: 0.015, timingMs: 200, read: 0.7 },
      { id: 'bear',    name: { ko: '불곰 박',     en: 'BEAR P' },     speed: 149, power: 0.99,  powerSd: 0.02,  timingMs: 206, read: 0.7 },
      { id: 'tornado', name: { ko: '토네이도 윤', en: 'TORNADO Y' },  speed: 148, power: 0.99,  powerSd: 0.02,  timingMs: 212, read: 0.7 },
      { id: 'cannon',  name: { ko: '캐논 정',     en: 'CANNON J' },   speed: 148, power: 1.0,   powerSd: 0.02,  timingMs: 178, read: 0.65 },
      { id: 'rocket',  name: { ko: '로켓 한',     en: 'ROCKET H' },   speed: 147, power: 1.0,   powerSd: 0.025, timingMs: 178, read: 0.6 },
      { id: 'titan',   name: { ko: '타이탄 오',   en: 'TITAN O' },    speed: 147, power: 1.0,   powerSd: 0.025, timingMs: 178, read: 0.6 },
      { id: 'bolt',    name: { ko: '번개 서',     en: 'BOLT S' },     speed: 146, power: 1.0,   powerSd: 0.03,  timingMs: 178, read: 0.55 },
      { id: 'iron',    name: { ko: '철완 조',     en: 'IRONARM J' },  speed: 144, power: 1.0,   powerSd: 0.03,  timingMs: 178, read: 0.5 },
      { id: 'storm',   name: { ko: '폭풍 임',     en: 'STORM L' },    speed: 141, power: 0.96,  powerSd: 0.03,  timingMs: 180, read: 0.45 },
      { id: 'hulk',    name: { ko: '괴력 신',     en: 'HULK S' },     speed: 140, power: 0.955, powerSd: 0.03,  timingMs: 182, read: 0.4 },
      { id: 'dragon',  name: { ko: '드래곤 권',   en: 'DRAGON K' },   speed: 138, power: 0.955, powerSd: 0.035, timingMs: 184, read: 0.4 },
      { id: 'bang',    name: { ko: '빅뱅 황',     en: 'BIGBANG H' },  speed: 137, power: 0.95,  powerSd: 0.035, timingMs: 186, read: 0.35 },
      { id: 'turbo',   name: { ko: '터보 안',     en: 'TURBO A' },    speed: 135, power: 0.95,  powerSd: 0.04,  timingMs: 188, read: 0.35 },
      { id: 'hammer',  name: { ko: '해머 송',     en: 'HAMMER S' },   speed: 134, power: 0.945, powerSd: 0.04,  timingMs: 190, read: 0.3 }
    ]
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = KLD.config;
})(typeof globalThis !== 'undefined' ? globalThis : this);
