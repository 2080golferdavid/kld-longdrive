# KLD LONG DRIVE

탭 세 번으로 치는 8비트 장타 대회. KLD(한국장타협회, Korea Long Drive) 홍보·이벤트용 웹 게임입니다.
프레임워크·빌드 없이 HTML/CSS/JS 정적 파일만으로 동작합니다(코드 약 360KB, 외부에서 받아 오는 것은 한글 픽셀 폰트 하나뿐).

## 실행

- **바로 해 보기**: `index.html`을 브라우저로 엽니다(더블클릭). 플레이는 그대로 되고, 공유할 주소만 없습니다.
- **로컬 서버로 열기** (공유 기능까지 확인할 때):

```bash
python3 -m http.server 8080
```

  그리고 브라우저에서 `http://localhost:8080` 을 엽니다.
- **배포**: `index.html`, `css/`, `js/`, `assets/` 네 가지만 아무 정적 호스팅(https)에 올리면 됩니다.
  (`docs/`, `tests/`, `tools/`와 폴더 맨 위의 로고 원본 `IMG_*.PNG`는 게임 실행에 필요 없습니다.)

## 조작

| | 모바일 | PC |
|---|---|---|
| 탭 ① 스윙 시작 → 탭 ② 파워 → 탭 ③ 임팩트 | 화면 탭 | Space · Enter · 클릭 |
| 조준 (8강부터) | ◀ ▶ | ← → |
| 탄도 저·중·고 (준결승부터) | 탄도 버튼 | ↑ ↓ |
| 비행 빨리감기 | 누르고 있기 | 누르고 있기 |
| 소리 / 일시정지 | 오른쪽 위 버튼 (일시정지는 뒤로가기로도) | M / Esc |

- 파워 게이지: 노란 구간(90~100%)이 풀스윙, 레드존(100% 초과)은 8강부터 세트당 2번.
- 임팩트 게이지: 커서가 흰 선(스위트스팟)에 올 때 탭. 빠르면 훅, 늦으면 슬라이스.
- 공이 그리드(흰 선 안)에 멈춰야 기록 인정. 6구 중 가장 긴 공으로 겨룹니다.
- 대회: 예선(16명 중 8위 안) → 8강 → 준결승 → 결승. 매치에서는 상대가 먼저 친 기록을 넘기는 순간 승리(워크오프).
- 난이도 감: 처음 하는 사람은 예선은 대개 통과하고 8강에서 절반쯤 떨어집니다. 우승은 꽤 익숙해져야 나옵니다(보스 "킹콩 장"이 결승에서 470야드 안팎을 칩니다).
  준결승·결승은 **순풍 돌풍이 예고될 때까지 기다렸다가** 치면 훨씬 쉬워집니다(`docs/DESIGN.md` 4.4의 표).

## 배포 전에 바꿀 것

1. **`js/config.js` → `brand`**
   - `shareUrl`: 게임을 올린 실제 주소. 기록 카드와 공유 문구에 들어갑니다.
   - `cta.url`: 결과 화면 맨 아래 링크 버튼(지금은 "KLD 인스타그램 보기")이 열 주소. 비워 두면 버튼이 안 나옵니다.
   - `sponsors`: 그리드 옆 광고판 문구(영문 대문자·숫자). `'LOGO'`는 KLD 로고 간판.
   - `hashtags`, `eventName`, `tagline`.
2. **`index.html` 머리말의 `og:` 태그**: 카카오톡·인스타그램 링크 미리보기는 자바스크립트를 실행하지 않으므로 여기를 직접 고칩니다.
   `og:image`와 `og:url`은 `https://…`로 시작하는 절대 주소여야 합니다. 미리보기 이미지는 `assets/og-image.png`(1200×630).
3. **성과 측정이 필요하면** `KLD.config.track = function (event, props) { … }`에 분석 도구를 연결합니다.
   호출되는 이벤트: `load`, `start`, `first_swing`, `warmup_done`, `set_end`, `share_click`, `continue`, `retry`, `run_end`, `cta_click`, `practice`.

규칙(공 수, 세트 시간, 그리드 폭), 게이지 판정 창, 라운드별 바람, CPU 선수 능력도 전부 `js/config.js`에 있습니다.
대회 구조는 고정입니다: 라운드는 예선 1개 + 매치 3개, CPU 선수는 7명 이상(본선이 8강 대진). 맞지 않으면 게임이 시작할 때 화면에 설정 오류를 보여 줍니다.
문구는 `js/i18n.js`(한국어/영어).

## 폴더 구조

```
index.html          진입점 (og 태그, 스크립트 로드 순서)
css/style.css       DOM 오버레이(메뉴·결과·공유) 스타일
js/config.js        브랜드·규칙·난이도 숫자
js/i18n.js          문자열 (ko / en)
js/storage.js       저장 (localStorage)
js/px.js            픽셀 그리기 도구, 수학 유틸
js/text.js          픽셀 텍스트 (내장 5x7 폰트 + 웹폰트 글리프 캐시)
js/logo-data.js     픽셀 로고 데이터 (tools/build-logo.js 가 생성)
js/logo.js          로고 그리기 (docs/LOGO.md)
js/physics.js       탄도 시뮬레이션
js/shot.js          게이지 입력 → 발사 조건, 바람
js/tournament.js    라운드·CPU 선수·대진
js/audio.js         칩튠 효과음·음악 (WebAudio)
js/golfer.js        절차적 픽셀 골퍼
js/render.js        월드·HUD·게이지·미니맵 렌더러
js/ui.js            DOM 오버레이
js/share.js         기록 카드·공유
js/game.js          상태 기계·입력·메인 루프
assets/             파비콘, 홈 화면 아이콘, 링크 미리보기 이미지, 로고 원본
docs/DESIGN.md      설계서
docs/LOGO.md        로고 모듈 안내
docs/screenshots/   화면 갈무리 (타이틀 · 결승 · 기록 카드 · 우승)
tests/              Node 테스트
tools/              로고 생성기
```

## 테스트

Node만 있으면 됩니다(의존성 없음).

```bash
node tests/physics.test.js
```

```bash
node tests/audio.smoke.js
```

```bash
node tests/logo.test.js
```

```bash
node tests/shot.test.js
```

```bash
node tests/balance.js --quick
```

- `physics.test.js`: 탄도 보정(투어 평균·장타 기준값), 부호 규약, 극단 입력.
- `shot.test.js`: 게이지·샷 모델·바람·대회 진행의 불변식.
- `balance.js`: 플레이어 봇(초보·보통·숙련, 그리고 돌풍을 기다리는 참고 행 셋)으로 대회를 수천 번 돌려 라운드별 통과율을 냅니다.
  `--quick`은 약 10초짜리 대강 점검이고(오차 ±3~6%p), **CPU 능력·돌풍·판정 창을 바꾼 뒤에는 옵션 없이 전체 표(3~4분)로 확인**합니다.
  목표 범위와 현재 값은 `docs/DESIGN.md` 4.4에 있습니다.

브라우저에서는 콘솔의 `KLD.game.debug`로 상태를 조작할 수 있습니다.

```js
KLD.game.debug.jump(3)        // 결승으로 건너뛰기 (1 = 8강, 2 = 준결승). 라운드 안내가 뜨면 '티샷!'을 누른다
KLD.game.debug.shoot(1.0, 0)  // 파워 100%, 오차 0 으로 한 번 치기 (공 앞에 선 상태에서만 동작, 아니면 false)
KLD.game.debug.virtual(true)  // 가상 시계 (step / runUntil 로 프레임 단위 진행)
```

## 알아 둘 것

- **폰트**: 한글 픽셀 폰트 Galmuri(SIL OFL 1.1, © Lee Minseo)를 jsDelivr CDN에서 불러옵니다(두 굵기 합쳐 약 0.9MB).
  폰트는 화면을 막지 않고 뒤에서 불러오므로, CDN이 느리거나 막혀 있어도 게임은 시스템 글꼴로 바로 시작하고 폰트가 도착하면 바뀝니다.
  오프라인 행사장이나 로딩 속도가 중요하면 쓰는 글자만 담아 직접 호스팅하는 것을 권합니다.
- **소리**: 아이폰은 무음 스위치가 켜져 있으면 웹 오디오가 나지 않습니다(기기 동작). 게임은 소리 없이도 할 수 있게 되어 있습니다.
- **기록 저장**: 이 기기의 브라우저(localStorage)에만 저장됩니다. 온라인 랭킹은 없습니다. 대회 기록은 세트가 끝날 때마다 저장되고, 한 판이 "내 기록"에서 한 줄을 차지합니다.
- **CPU 선수 이름**은 전부 가상입니다. 실제 선수 이름을 쓰려면 본인 동의가 필요합니다.
- 범위 밖으로 남겨 둔 것: 온라인 랭킹, 도전 링크, 카카오톡 SDK 공유, 행사 부스 모드, 이어하기 저장(`docs/DESIGN.md` 11장).
