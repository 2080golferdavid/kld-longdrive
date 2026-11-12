# KLD 로고 — 게임 연결 안내

공식 로고 PNG 두 장을 받아 8비트 화면용 픽셀 로고로 변환해 두었다.
게임 쪽에서는 `KLD.logo` API만 쓰면 된다. (이 문서와 아래 "로고 쪽 파일"은 로고 작업 세션이 관리한다.)

> 2차 수정(독립 검토 반영)에서 바뀐 점은 맨 아래 **9. 변경 이력**에 모아 두었다. 함수 이름·인자·스프라이트 크기는 그대로다.

## 1. 원본에서 확인된 사실

- **KLD = KOREA LONG DRIVE** (로고 하단 문구).
- 두 파일은 모양이 완전히 같고 색만 다르다. 크기 1719×592, 배경 투명.

| 원본 | 정리한 사본 | 글자 채움 | 글자 테두리 | 스우시·공 | 쓰는 곳 |
|---|---|---|---|---|---|
| `IMG_9229.PNG` | `assets/logo/kld-logo-light.png` | `#FEFEFE` | `#727171` | `#E60012` | 어두운 배경 |
| `IMG_9230.PNG` | `assets/logo/kld-logo-dark.png` | `#000000` | `#9FA0A0` | `#E60012` | 밝은 배경 |

- 브랜드 빨강은 **`#E60012`** (`KLD.logo.colors().red`).
- 원본의 공 안쪽은 뚫려 있다(투명). 픽셀 버전에서는 골프공으로 읽히도록 **흰색으로 채우고 빨간 딤플 점**을 찍었다.
  **사용자가 이 모양으로 확정했다(2026-11-11). 원본과 다르다는 이유로 기본값을 바꾸지 말 것.**
  특정 자리에서만 원본처럼 뚫으려면 `variant: { w: '' }` (밝은 배경이면 `{ base: 'dark', w: '' }`).

## 2. 로고 쪽 파일 (게임 쪽에서 수정하지 말 것)

| 파일 | 내용 |
|---|---|
| `assets/logo/kld-logo-light.png`, `kld-logo-dark.png` | 원본 사본 (고해상도) |
| `assets/logo/pixel-preview.png` | 모든 픽셀 스프라이트를 3배로 모은 확인용 시트 |
| `assets/favicon-32.png` | 파비콘 (로고를 줄인 게 아니라 같은 모티프를 32px에 맞춰 따로 찍은 것) |
| `assets/icon-180.png`, `assets/icon-512.png` | 홈 화면 아이콘 (남색 바탕 + 픽셀 로고) |
| `assets/og-image.png` | 링크 미리보기 1200×630 (밤하늘 + 픽셀 로고 + 그리드) |
| `tools/build-logo.js` | 원본 PNG → 픽셀 로고 생성기 (Node 내장 모듈만 사용) |
| `tools/logo-sprites.json` | 만들 크기 목록. `mark32`는 여기에 손으로 찍은 도트가 들어 있다 |
| `tools/logo-preview.html` | 미리보기·자가 점검 페이지 (더블클릭으로 열림) |
| `js/logo-data.js` | **자동 생성** 데이터 (11KB, gzip 3KB). 직접 고치지 않는다 |
| `js/logo.js` | 런타임 API `KLD.logo` |
| `tests/logo.test.js` | `node tests/logo.test.js` (120개 검사, `--quiet`를 붙이면 실패만 표시) |

## 3. 스프라이트 목록

`mark` = KLD 글자 + 스우시 + 공. `full` = 그 아래에 KOREA LONG DRIVE 줄까지.
모든 크기는 **게임 내부 픽셀 1배 기준**이고 배경은 투명이다. 같은 폭의 `mark`와 `full`은 윗부분이 픽셀 단위로 같다.

| 키 | 종류 | 폭×높이 | 글자 테두리 | 비고 |
|---|---|---|---|---|
| `mark32` | mark | 32×11 | 없음 | 손으로 찍은 도트. 이보다 작게는 못 쓴다 |
| `mark48` | mark | 48×13 | 없음 | |
| `mark56` | mark | 56×15 | 없음 | 62×24 백드롭에 맞는 크기 |
| `mark64` | mark | 64×18 | 없음 | |
| `mark96` | mark | 96×26 | 안쪽 1px 회색 | 여기부터 공에 딤플 점이 보인다 |
| `mark128` | mark | 128×34 | 안쪽 1px 회색 | |
| `mark160` | mark | 160×42 | 안쪽 1px 회색 | |
| `mark200` | mark | 200×52 | 안쪽 1px 회색 | |
| `full160` | full | 160×54 | 안쪽 1px 회색 | 부제가 읽히는 최소 크기 |
| `full200` | full | 200×68 | 안쪽 1px 회색 | |
| `full240` | full | 240×82 | 안쪽 1px 회색 | |

## 4. API

스크립트는 `logo-data.js` → `logo.js` 순서로 넣는다. `px.js`·`text.js`에 의존하지 않는다.

```html
<script src="js/logo-data.js"></script>
<script src="js/logo.js"></script>
```

```js
KLD.logo.available()                       // 데이터가 로드됐는가
KLD.logo.keys(kind?)                       // 키 목록 (폭 오름차순). kind: 'mark' | 'full'
KLD.logo.info(key)                         // { key, kind, w, h } | null
KLD.logo.pick(kind, maxW, maxH?)           // 들어가는 가장 큰 키 | null. 'full'이 안 들어가면 'mark'에서 고른다
KLD.logo.draw(g, key, x, y, opts)          // 그린 영역 { x, y, w, h, key } | null
KLD.logo.drawFit(g, kind, x, y, maxW, opts)// pick + draw. opts.maxH 로 높이도 제한
KLD.logo.canvas(key, variant, outline?)    // 캐시된 1배 캔버스 (수정 금지) | null
KLD.logo.dataURL(key, variant, scale?, outline?)  // DOM <img>용 PNG data URL | ''
KLD.logo.colors()                          // { red, light: { r, f, e, w }, dark: { r, f, e, w } } 의 사본
```

`opts`:

| 옵션 | 값 | 설명 |
|---|---|---|
| `variant` | `'light'` (기본) / `'dark'` / 객체 | 흰 글자 / 검은 글자 / 직접 지정 (아래 "팔레트") |
| `scale` | 정수 (기본 1) | 확대 배율. 숫자가 아니거나 1보다 작으면 1 |
| `align` | `'left'` (기본) / `'center'` / `'right'` | x 기준 |
| `valign` | `'top'` (기본) / `'middle'` / `'bottom'` | y 기준 |
| `alpha` | 0~1 | 투명도 (페이드용). 범위를 벗어나면 잘라낸다: 음수·NaN은 그리지 않고, 1 초과는 1 |
| `outline` | 색 | 로고 전체 윤곽 바깥에 1px 테두리. 잔디·관중처럼 복잡한 배경에 직접 올릴 때 |
| `maxH` | 픽셀 | `drawFit` 전용 높이 제한 |

### 팔레트 (variant 객체)

`{ base, r, f, e, w }` — r 빨강(스우시·공 테두리·딤플), f 글자 채움, e 글자 테두리, w 공 안쪽.

- **적지 않은 칸은 `base`(기본 `'light'`) 팔레트에서 물려받는다.** `{ w: '' }`는 "light 그대로, 공 안쪽만 비움"이다.
- 값이 `''` · `null` · `'transparent'`인 칸은 **그리지 않는다.**
- 색은 `#rgb` / `#rrggbb`와 CSS 색 이름·`rgb()`를 받는다. 반투명 색은 불투명으로 그리고(콘솔에 한 번 경고), 알 수 없는 색은 그 칸을 그리지 않는다(역시 한 번 경고). 흐리게 하려면 `alpha` 옵션을 쓴다.
- 모르는 이름(`'red'` 등)을 `variant`로 주면 `'light'`로 그린다.
- `colors()`가 돌려주는 것은 사본이라 고쳐도 로고에는 영향이 없다. 바꾼 팔레트는 `variant`로 넘긴다.

## 5. 용도별 추천

| 용도 | 호출 | 결과 |
|---|---|---|
| **타이틀** (내부 폭 W = 200~480) | `drawFit(g, 'full', W/2, y, W - 16, { align: 'center', maxH, variant: th.dark ? 'light' : 'dark' })` | W 200~215 → `full160`, 216~255 → `full200`, 256 이상 → `full240`. 높이(`maxH`)가 모자라면 더 작은 `full`, 그것도 안 들어가면 `mark`로 내려간다. 돌려받은 `key`가 `full`로 시작하지 않으면 부제를 글자로 따로 그린다 |
| **티 뒤 백드롭** (62×24 판) | `drawFit(g, 'mark', cx, cy, 60, { maxH: 16, align: 'center', valign: 'middle', variant: 'light' })` | `mark56` (56×15). 남색 계열 판 위에 `light` |
| **광고판** | `draw(g, 'mark48', cx, cy, { align: 'center', valign: 'middle', variant })` | 판 안쪽이 최소 50×15 (`mark48`), 58×17 (`mark56`), 66×20 (`mark64`), 34×13 (`mark32`) |
| **기록 공유 카드** (216×270) | `var r = drawFit(g, 'full', 108, 8, 200, { align: 'center', variant: th.dark ? 'light' : 'dark' })` | `full200`이면 y 8~75를 차지한다. **그 아래 요소는 `r.y + r.h`를 기준으로 배치**하고(로고 높이는 68 또는 54), 해·달 같은 장식이 x 8~207 / y 8~75와 겹치지 않게 한다. 카드는 저해상도로 그린 뒤 통째로 정수배 확대 |
| **HUD 구석 표식** | `draw(g, 'mark32', x, y, { outline: '#141c33' })` | 32×11 + 테두리 |
| **DOM 화면** (메뉴·결과) | `var key = KLD.logo.pick('full', 내부 픽셀로 잰 가용 폭); img.src = KLD.logo.dataURL(key, variant);` + CSS `width: calc(var(--u) * <info(key).w>); height: auto; image-rendering: pixelated` | `--u`는 내부 1픽셀의 CSS px 크기(`V.cssScale`, `ui.js`가 설정)다. 기기 배율 `V.sDev`가 아니다. 화면 크기가 바뀌면 `key`를 다시 고른다 |

DOM에서 `dataURL(key, variant, scale)`의 `scale`은 `V.cssScale`이 정수일 때만 쓸모가 있다(보통은 1로 두고 CSS로 키운다).
`outline`을 준 이미지는 사방 1px씩 커지므로 CSS 폭은 `(w + 2) × var(--u)`다.

배경별 팔레트:

- 밤·노을 하늘, 남색 판 → `'light'`
- 아침·한낮 하늘, 흰 판 → `'dark'`
- **빨간 판** → `{ r: '#ffffff', f: '#ffffff', e: '#ffffff', w: '#e60012' }` (전부 흰색, 공만 빨강)
- 잔디·관중 위 → `'light'` + `outline: '#141c33'`
- 우승 화면용 금색 예시 → `{ r: '#ffd23f', f: '#fff6c0', e: '#b8860b', w: '#ffffff' }` (브랜드 색을 바꾸는 것이므로 쓸지는 선택)

`index.html` 머리말에 넣을 태그:

```html
<link rel="icon" type="image/png" href="assets/favicon-32.png">
<link rel="apple-touch-icon" href="assets/icon-180.png">
<meta property="og:image" content="assets/og-image.png">   <!-- 배포 시에는 절대 주소로 -->
<meta name="theme-color" content="#141c33">
```

## 6. 알아 둘 제약

1. **원본 PNG를 게임 캔버스에 그리지 말 것.** `index.html`을 더블클릭(file://)으로 연 상태에서 이미지 파일을 캔버스에 그리면 캔버스가 오염되어 공유 카드의 `toBlob`/`toDataURL`이 막힌다. `KLD.logo`는 이미지 파일을 쓰지 않으므로 안전하다(미리보기 페이지에서 확인함).
2. `draw`/`drawFit`은 **그릴 수 없으면 `null`을 돌려준다**: 키가 없을 때, DOM이 없을 때(Node), 좌표가 숫자가 아닐 때, 캔버스가 그리기를 거부했을 때. 예외는 던지지 않는다. 호출부는 `null`일 때 글자 로고(`KLD.text.drawBig(g, 'KLD', …)`)로 대체하면 된다. `alpha`가 0 이하라서 안 그린 경우에는 영역을 그대로 돌려준다(배치 계산이 흔들리지 않도록).
3. 좌표는 정수로 반올림되고, 그리는 동안만 `imageSmoothingEnabled`를 끄고 `globalAlpha`를 바꾼 뒤 원래 값으로 되돌린다.
4. 게임 캔버스에서는 `scale: 1`만 쓴다. 로고만 2배로 그리면 주변과 픽셀 크기가 달라진다.
5. 글자 테두리(`e`)의 의미가 크기에 따라 다르다. 96px 이상은 **글자 몸통 안쪽 1px**이라, 회색을 없애려면 `e`를 비우지 말고 `f`와 같은 색으로 준다(비우면 글자가 1px 가늘어진다). 64px 이하는 테두리가 아예 없다.
6. `outline`은 본체 바깥으로 1px(×scale) 더 나간다. 돌려주는 영역과 정렬 기준은 본체다. 판에 올릴 때는 1px 여유를 둔다.
7. `full`은 160·200·240 폭만 있다(그보다 작으면 부제가 뭉개진다). 가장 작은 로고는 32×11이고, 그보다 작은 자리에는 비트맵 글자 "KLD"를 쓴다.
8. 캔버스는 (키, 팔레트, 테두리 색) 조합마다 한 번 만들어 캐시한다. 매 프레임 다른 색을 넘기면 캐시가 계속 늘어나므로 팔레트는 고정된 몇 가지만 쓴다.
9. 부제의 A·G는 원본 서체가 각진 모양이라 픽셀에서는 R·6과 비슷해 보인다. 문맥으로는 읽히지만, 부제를 또렷하게 보여야 하는 곳에는 `full240`을 권한다.

## 7. 로고를 바꿀 때

```bash
node tools/build-logo.js
```

```bash
node tests/logo.test.js
```

`assets/logo/kld-logo-dark.png`(검은 글자 버전)를 새 파일로 바꾼 뒤 위 두 줄을 실행한다. `js/logo-data.js`, 아이콘, 링크 미리보기 이미지, 확인용 시트가 다시 만들어진다. 생성기가 전제하는 것:

- **파일 형식**: 8비트 RGB 또는 RGBA, 인터레이스 없는 PNG. 검은 글자 버전(글자 채움이 어둡고 테두리가 회색).
- **구성**: 투명한 가로 띠로 나뉜 세 덩어리(위: 스우시·공 / 가운데: KLD / 아래: 부제)이고, 공 안쪽이 빨강으로 둘러싸여 있을 것. 위치는 원본에서 자동으로 찾으므로 **같은 디자인이면 해상도가 달라도 된다.** 구성이 다르면 생성기가 이유를 알려 주며 멈춘다.
- **색은 자동으로 따라오지 않는다.** 팔레트는 `tools/build-logo.js`의 `COLORS`에 적혀 있다. 브랜드 색이 바뀌면 거기를 고친다(빨강은 "R이 G·B보다 70 이상 큰 픽셀"로 구분한다).
- **손으로 찍은 것은 그대로 남는다**: `mark32`(`tools/logo-sprites.json`)와 파비콘(`makeFavicon`).
- 크기를 추가하려면 `tools/logo-sprites.json`에 한 줄 넣는다. 96px 미만은 `"outline": "none", "letterT": 0.6`, 그 이상은 `"outline": "inner"`가 지금 쓰는 값이다.

## 8. 확인한 것

- `node tests/logo.test.js` 120개 통과. 데이터가 원본에서 다시 만든 결과와 같은지, 모양이 온전한지(스우시 연속·공 윤곽 닫힘·글자 줄 수·D의 구멍, 폭 40~320을 3 간격으로 훑음), 런타임 API를 가짜 캔버스로 실행한 결과까지 본다. 결함을 일부러 심어 테스트가 잡는지도 확인했다.
- `tools/logo-preview.html`을 실제 브라우저(앱 내장 브라우저)에서 열어 확인: 11종 모두 그려짐, 반투명 픽셀 없음, 캔버스 저장 가능, `dataURL` 이미지 정상, 투명도·팔레트·테두리 동작 14항목 통과, 콘솔 오류 없음.
- 독립 검토(런타임 / 생성기·원본 충실도 / 문서 세 관점, 지적 사항마다 반증 시도)를 거쳐 확인된 사항을 모두 반영했다.

### 앱 내장 브라우저로 미리볼 때 주의

프로젝트가 `~/Desktop` 아래에 있어서, `.claude/launch.json`으로 띄우는 `python3 -m http.server`는
**macOS의 "데스크탑 폴더 접근" 허용 창을 기다리며 멈춘다**(프로세스는 떠 있지만 포트를 열지 못함. `getcwd`에서 대기).
사용자가 허용 창에서 승인하면 해결된다. 승인 없이 확인하려면 파일을 임시 폴더로 복사한 뒤 아래처럼 띄운다
(게임 본체의 `kld-preview` 설정이 이미 이 방식이다):

```json
{
  "name": "preview",
  "runtimeExecutable": "python3",
  "runtimeArgs": ["-I", "-c",
    "import os,sys;os.chdir(sys.argv[1]);import http.server as h;h.test(HandlerClass=h.SimpleHTTPRequestHandler,port=8791,bind='127.0.0.1')",
    "/private/tmp/<복사해 둔 폴더>"],
  "port": 8791
}
```

(`-I`는 시작할 때 현재 폴더를 읽지 않게 하고, `bind='127.0.0.1'`은 방화벽 허용 창을 피한다.)

## 9. 변경 이력

**확정 (2026-11-11)** — 공 안쪽 흰색 채움을 그대로 두기로 사용자가 결정했다. 코드·데이터·스프라이트는 바뀌지 않았다.

**2차 (독립 검토 반영)** — 함수 이름·인자·스프라이트 크기는 그대로.

- `mark48`: 글자 윗줄이 잘려 6줄이던 것을 7줄로 바로잡았다(크기는 48×13 그대로). 폭에 따라 글자 첫 행이 스우시 처리 구간에 묻히던 생성기 결함이었다.
- 큰 크기(96px 이상)의 공 밑동: 타원과 스우시 사이의 빈틈까지 빨강으로 메워 받침대처럼 보이던 것을 원본처럼 좁아지게 고쳤다.
- 팔레트 객체: **적지 않은 칸은 기본 팔레트에서 물려받는다**(전에는 그리지 않았다). `'transparent'`도 "그리지 않음"으로 받는다. 네 칸을 모두 적은 기존 호출은 결과가 같다.
- `alpha`가 음수·NaN이면 그리지 않는다(전에는 브라우저가 값을 무시해 불투명하게 번쩍였다).
- 없는 키나 `'constructor'` 같은 이름, 숫자가 아닌 좌표·배율을 넘겨도 예외 없이 `null` 또는 1배로 처리한다.
- `colors()`는 사본을 돌려준다.
- `og-image.png`: 별이 로고에 달라붙던 것을 없앴다.
- 생성기: 로고 배치를 원본에서 자동으로 찾는다(행 번호 고정 제거). 쓰지 않는 바깥 테두리 생성 옵션은 뺐다(그릴 때 `outline` 옵션으로 대신한다).
