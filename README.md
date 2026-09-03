# ax-ip-sales-dashboard
[AX] Vibe Portal 프로젝트: IP영업 현황 대시보드

## 배포

`main` 브랜치 push → GitHub Actions(S3 AutoSync)가 `index.html`을 `s3://flo-vibe/prod/ax-ip-sales-dashboard/`로 동기화 → `https://foundry.music-flo.com/ax-ip-sales-dashboard`로 서빙(nginx 게이트웨이). S3 버킷명(`flo-vibe`)은 게이트웨이 도메인이 `vibe.music-flo.com`에서 `foundry.music-flo.com`으로 바뀐 뒤에도 그대로다(레거시 이름).

## 접근 제어

Google Sign-In(SSO)으로 로그인한 뒤, 로그인한 이메일이 `google-apps-script/Code.gs`의 `ALLOWED_EMAILS` 화이트리스트에 있어야 데이터를 볼 수 있다. 검증은 백엔드(Apps Script)가 매 API 호출마다 Google ID 토큰을 확인하는 방식이라, 정적 파일 자체는 공개 URL이어도 데이터는 허용된 사용자만 조회 가능하다. 인원 변경은 `Code.gs`의 `ALLOWED_EMAILS` 목록만 수정하면 된다.

## 디자인 시스템

FLO 디자인 토큰(`dreamus-tools-ui` 스킬)을 `design-system/`에 두고 `index.html` `<style>`에 인라인한다. 컴포넌트 규격·토큰 매핑·모바일 체크리스트는 `docs/DESIGN.md`, 제품 컨텍스트는 `docs/PRODUCT.md` 참고. 새 스타일은 `--flo-*` 또는 alias 변수만 쓰고 hex를 직접 쓰지 않는다.
