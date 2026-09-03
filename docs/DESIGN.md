# DESIGN.md — IP 통합 영업 대시보드 디자인 시스템

이 프로젝트는 빌드 없이 `index.html` 하나를 S3에 복사해 배포한다. 그래서 디자인 시스템은
**FLO 토큰 CSS를 `index.html` `<style>` 안에 인라인**하는 방식으로 적용되어 있고,
원본은 `design-system/` 폴더에 둔다(출처: Dreamus 스킬 허브 `dreamus-tools-ui`).

| 파일 | 역할 |
|---|---|
| `design-system/flo-theme-tokens.css` | FLO 시맨틱 컬러 72종(`--flo-surface-*`, `--flo-text-*`, `--flo-border*`, `--flo-semantic-*`, `--flo-component-specific-*`), spacing, radius, shadcn 브릿지. 라이트 `:root`, 다크 `[data-theme="dark"]`. |
| `design-system/flo-typography.css` | Pretendard 로드 방법 안내, `--font-size-*`/`--font-line-height-*`/`--font-weight-*`, `.flo-h50`~`.flo-caption2-strong` 유틸 클래스. |
| `design-system/fonts/PretendardVariable-subset.woff2` | 자체 호스팅용 Pretendard 서브셋(wght 400-700, 완성형 한글 전체 + 라틴/기호, 약 1.1MB). `build-subset.sh`로 재생성. |

토큰을 갱신하려면 `dreamus-tools-ui` 스킬의 `tokens/`를 `design-system/`으로 다시 복사한 뒤,
`index.html`의 `/* === FLO design tokens === */` 블록을 같은 내용으로 교체한다.
인라인할 때 `@media (prefers-color-scheme: dark)` 블록은 제외한다(카테고리 색이 다크 대응이 안 됨).
`<html data-theme="light">`로 고정한다.

### 폰트 로딩: 자체 호스팅(self-host)

사내망에서 CDN(jsdelivr)이 막힐 수 있어, Pretendard는 `dreamus-tools-ui` 스킬 기본값인
CDN `@import` 대신 **서브셋 woff2를 base64로 `index.html`에 직접 인라인**한다.

- 커버리지: `wght` 400~700(FLO가 쓰는 regular/medium/semibold/bold), 완성형 한글
  11,172자 전부(회사명·아티스트명 등 자유 입력 필드에 어떤 한글이 와도 폴백 없이 렌더),
  라틴 기본 문자셋 + 자주 쓰는 문장부호(`…` `→` `₩` 등).
- 용량: 원본 variable 폰트(전체 weight, 다국어) 약 2.0MB → 서브셋 후 약 1.1MB(base64 약 1.5MB).
  `index.html` 전체 크기는 약 2.1MB(HTML+CSS+JS 자체는 약 630KB).
- 재생성: `design-system/fonts/build-subset.sh` 실행 → `PretendardVariable-subset.woff2`와
  `.b64.txt` 생성 → 스크립트 안내대로 `index.html`의 `@font-face` `src`를 교체.
- 트레이드오프: CDN `@import`(약 630KB, 폰트는 브라우저가 별도 캐시)보다 `index.html`
  자체는 커지지만, 외부 요청이 전혀 없어 사내망 차단·CDN 장애와 무관하게 항상 렌더된다.
  네트워크가 안정적인 환경으로 옮기면 `flo-typography.css` 주석의 CDN `@import`로 되돌려도 된다.

## 1. 컬러 전략: Restrained

틴트된 중립색 + accent 1개(`--flo-semantic-accent` #3F3FFF). accent는 primary 버튼, 활성 탭,
포커스 링, 진행 바에만 쓴다. 장식에 쓰지 않는다.

### 앱 변수 → FLO 토큰 alias

`index.html`의 기존 변수 이름은 유지하고 값만 FLO 토큰을 가리킨다. 새 스타일을 쓸 때는
**아래 alias 또는 `--flo-*`만** 사용하고 hex를 직접 쓰지 않는다.

| 앱 변수 | FLO 토큰 | 용도 |
|---|---|---|
| `--bg` | `--flo-surface-minimal` | 페이지 배경 (카드와 대비 유지) |
| `--card` | `--flo-surface-background` | 카드·모달 표면 |
| `--card-2` | `--flo-surface-primary` | 입력·통계 박스·보조 표면 |
| `--border` | `--flo-border` | 기본 테두리 |
| `--rule`, `--rule-soft` | `--flo-border-subtle` | 행 구분선 |
| `--surf-hover` | `--flo-surface-secondary` | 버튼·칩·탭 hover 배경 |
| `--accent-soft` | `--flo-surface-alt` | 행 hover, 선택 배경 틴트 |
| `--ink` / `--ink-2` / `--hint` | `--flo-text-primary` / `-secondary` / `-tertiary` | 텍스트 위계 3단 |
| `--accent`, `--fill` | `--flo-semantic-accent` | primary·활성·진행 |
| `--accent-pressed` | `--flo-component-specific-button-surface-accent-pressed` | primary 버튼 hover/pressed |
| `--on-accent` | `--flo-static-always-static-white` | accent 위 텍스트 |
| `--ring` | accent 18% 투명 | 포커스 링 |
| `--red-fg` / `--red-bg` | `--flo-semantic-error` / 8% 틴트 | 삭제·오류 |
| `--dbx-fg` / `--dbx-bg` | `--flo-semantic-error` / 12% 틴트 | 만료 배지 |
| `--track` | `--flo-surface-quaternary` | 진행 바 트랙 |
| `--overlay` | `--flo-overlay-50` | 모달 배경 |
| `--toast-bg` | `--flo-component-specific-toast-background` | 토스트 |

### 카테고리 팔레트 (FLO 토큰 외)

사업부·컨택상황·사업자형태·D-day 배지에 쓰는 `--green/--blue/--sand/--slate/--gray/--violet/--teal/--amber/--sky`(각 `-bg`/`-fg`), `--alert-*`, `--db-*`는
FLO 시맨틱 토큰에 대응(warning/success/카테고리색)이 없어 **앱 로컬 팔레트로 격리**해 둔다.
새 카테고리 색이 필요하면 이 그룹에 `-bg`(저채도 틴트)+`-fg`(가독 대비 4.5:1 이상) 쌍으로 추가한다. semantic accent를 카테고리 색으로 쓰지 않는다.

## 2. 타이포그래피

Pretendard 단일 패밀리. FLO 스케일 중 내부 툴 기본은 **body2(14/20)**.

| 용도 | 크기/행간/굵기 | 클래스 |
|---|---|---|
| 카드 제목, 모달 제목 | 18/24/600 | `.ctitle`, `.modal-head b` (= `flo-h400`) |
| 본문, 버튼, 탭, 입력 | 14/20/400·600 | 기본 |
| 라벨, 메타, 캡션, 배지 | 12/18/500·600 | `.field label`, `.pill` (= `flo-caption1`) |
| 표 셀(밀도 우선) | 13px 유지 | `tbody td` |
| 최대 굵기 | 700 | 800 사용 금지 |

모바일에서 **입력 요소의 font-size는 반드시 16px 이상**이다. iOS Safari는 16px 미만 입력에 포커스하면 화면을 확대한다. `maximum-scale`로 줌을 막는 것은 접근성 위반이므로 금지.

## 3. 간격·모서리

- spacing: `--flo-spacing-{4,8,16,20,24,32}` 사용. 컴포넌트 안쪽 패딩은 4의 배수.
- radius 3단계만: 컨트롤 `--flo-radius-8`, 카드·모달 `--flo-radius-16`, 칩·pill `--flo-radius-circle`.

## 4. 컴포넌트 규격

모바일은 `@media (max-width:640px)`. 터치 타겟은 iOS HIG 기준 **44×44pt 이상**.

| 컴포넌트 | 데스크톱 | 모바일 |
|---|---|---|
| `.btn` | 높이 36, 좌우 14, 13px semibold, radius 8 | 최소 높이 44, 좌우 16, 14px |
| `.btn.mini` | 높이 28, 12px | 최소 높이 36 |
| `.btn.primary` | accent 배경, hover는 `--accent-pressed` | 동일 |
| `.icon-btn` | 28×28, 아이콘 16 | 44×44, 아이콘 20 |
| `.chip`, `.fchip` | 높이 30, 12px, circle | 최소 높이 40, 14px |
| `.tab`, `.subtab`, `.parrow` | 높이 36 | 최소 높이 44 |
| `input`, `select`, `textarea` | 높이 36, 14px, radius 8, `--card-2` 배경 | 최소 높이 44, **16px** |
| `select` | `appearance:none` + 커스텀 chevron, 우측 패딩 36 | 동일 |
| `input[type=date]` | `appearance:none; min-width:0; width:100%` | 동일 |
| `input[type=checkbox]` | 16×16, `accent-color: var(--accent)` | 20×20, 행 최소 높이 44 |
| `.field` | `min-width:0`, 라벨 12px `--ink-2` | 동일 |
| `.two` | `repeat(2, minmax(0,1fr))` 2열 | 2열 유지 |
| `.modal` | radius 16, 최대 폭 480 | 높이 `100dvh` 안에 고정, 본문 내부 스크롤, 저장 바 sticky + safe-area |
| `.pill` | 높이 22, 12px, circle | 동일 |
| `.toast` | `--toast-bg`, radius 8 | 하단 safe-area 반영 |

### 상태

모든 인터랙티브 요소는 default / hover / focus-visible / active / disabled 상태를 가진다.
- 포커스는 `:focus-visible`로만 표시한다(마우스 클릭에는 링 없음). 링: `0 0 0 3px var(--ring)` + accent 테두리.
- hover 배경은 `--surf-hover`, 테두리색은 바꾸지 않는다.
- 터치 환경(`hover:none`)에서는 hover에 의존하는 액션(`.acts`)을 항상 노출한다.

### 모션

`--ease: cubic-bezier(.22,1,.36,1)`, 150ms. `background-color`, `border-color`, `color`, `box-shadow`만 전환한다. `transition: all` 금지. `prefers-reduced-motion`이면 모션 없음.

## 5. 모바일 안정성 체크리스트

- [ ] 입력 font-size 16px 이상 (iOS 줌 방지)
- [ ] `select`/`date`에 `appearance:none`, 그리드 열은 `minmax(0,1fr)` (네이티브 컨트롤 최소폭 오버플로 방지)
- [ ] 터치 타겟 44×44
- [ ] `touch-action: manipulation`, `-webkit-tap-highlight-color: transparent`
- [ ] 모달 `overscroll-behavior: contain`, `100dvh`, `env(safe-area-inset-*)`
- [ ] sticky 탭바 `top`은 헤더 실측 높이(`--bar-h`)를 따른다
- [ ] `<meta name="theme-color">` = `--bg`
