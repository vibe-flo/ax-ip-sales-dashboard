# ax-ip-sales-dashboard
[AX] Vibe Portal 프로젝트: IP영업 현황 대시보드

## 배포

`main` 브랜치 push → GitHub Actions(S3 AutoSync)가 `index.html`을 `s3://flo-vibe/prod/ax-ip-sales-dashboard/`로 동기화 → `https://vibe.music-flo.com/ax-ip-sales-dashboard`로 서빙(nginx 게이트웨이).

## 접근 제어

Google Sign-In(SSO)으로 로그인한 뒤, 로그인한 이메일이 `google-apps-script/Code.gs`의 `ALLOWED_EMAILS` 화이트리스트에 있어야 데이터를 볼 수 있다. 검증은 백엔드(Apps Script)가 매 API 호출마다 Google ID 토큰을 확인하는 방식이라, 정적 파일 자체는 공개 URL이어도 데이터는 허용된 사용자만 조회 가능하다. 인원 변경은 `Code.gs`의 `ALLOWED_EMAILS` 목록만 수정하면 된다.
