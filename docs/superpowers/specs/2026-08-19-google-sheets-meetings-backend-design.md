# 미팅 데이터 백엔드를 Google Sheets로 전환 — 설계

## 배경

`index.html`은 nginx가 서빙하는 단일 정적 파일이며 백엔드 서버가 없다. 현재
미팅(`meetings`)·거래처(`clients`) 데이터는 앱 부팅 시 하드코딩된 `SEED_M`
배열로 시드되고, 이후 사용자의 모든 조회/수정은 브라우저 `localStorage`
(`dreamus_ip_v7` 키)에 JSON blob 하나로 저장된다. 즉 브라우저·기기별로
데이터가 독립적이고, 여러 사람이 같은 데이터를 공유하지 못한다.

실제 미팅 현황은 이미 사내 Google Sheet
(`[IP부문] 영업용 대시보드_data`, 탭 `IP사업부문 영업 현황`)에서 여러 사람이
직접 수기로 관리하고 있다. 이 시트를 앱의 실제 데이터 소스로 삼아, 앱에서
GET/CREATE/UPDATE/DELETE가 모두 그 시트에 반영되도록 한다.

배포 환경: Jenkins가 Docker(nginx)로 빌드해 사내망 IP(`10.1.22.179`)에만
올린다. 인터넷에 노출되지 않는 내부 도구다.

## 범위

- **포함**: `meetings` 데이터를 Google Sheets 기반으로 전환 (GET/CREATE/UPDATE/DELETE).
- **제외**: `clients` 데이터는 이번 범위 밖. 해당 데이터에 매핑되는 시트 탭이
  없으므로 기존처럼 로컬 시드(`seedClients()`)를 그대로 유지한다.
- **제외**: `MDS 파트너 리스트` 탭은 주민등록번호·사업자등록번호 등 민감
  개인정보를 담고 있어 이번 연동 대상에서 완전히 배제한다. Apps Script는 이
  탭에 접근하는 코드를 포함하지 않는다.

## 아키텍처

```
브라우저(index.html)  ──fetch(JSON, method:POST)──▶  Google Apps Script 웹앱  ──▶  Google Sheet
                                                     (Execute as: 소유자 / Access: Anyone,
                                                      IP사업부문 영업 현황 탭만 접근)
```

정적 사이트에는 백엔드가 없으므로, Google Apps Script를 시트 소유자 권한으로
실행되는 웹앱으로 배포해 프록시로 쓴다. 사용자는 로그인 없이 앱을 쓰고, 실제
시트 읽기/쓰기는 Apps Script가 소유자 권한으로 대신 수행한다.

## 시트 컬럼 매핑

`IP사업부문 영업 현황` 탭, 현재 컬럼 A~I:

| 컬럼 | 헤더 | 앱 필드 |
|---|---|---|
| A | 날짜 | (미사용 — `week`는 클라이언트가 `mdateISO`로부터 계산) |
| B | 사업부 | `div` |
| C | 기획사 | `client` |
| D | 아티스트 | `artist` |
| E | 미팅 일시 | `mdateISO` (표시용 `mdate`는 클라이언트가 포맷 변환) |
| F | C.P | `cp` (담당자 — 신규 필드, UI에 없어도 라운드트립 시 보존) |
| G | 컨택상황 | `status` |
| H | 주요 미팅내역 | `log` |
| I | 후속계획 | `followup` |
| J *(신규 추가)* | id | `id` |

> **정정 이력**: 최초 설계에서는 I열을 빈 컬럼으로 착각해 `id`를 I열에
> 배치하고, "시트에 `followup` 대응 컬럼이 없다"고 잘못 기술했었다. 실제로는
> I열이 이미 "후속계획"(=`followup`) 컬럼으로 쓰이고 있었다. Task 1 구현 후
> 첫 `list` 스모크 테스트에서 이 사실이 드러났고(빈 후속계획 셀 52건에
> self-healing 로직이 실수로 UUID를 써넣음 — 사용자가 수동으로 원상복구,
> 기존 텍스트가 있던 35건은 self-healing이 건드리지 않아 데이터 손실 없음),
> `id`를 J열(진짜 빈 컬럼)로 옮기고 `followup`을 I열에 정식 매핑하도록
> 바로잡았다. 이 표는 정정된 최종 매핑이다.

## ID 전략

- 시트 맨 뒤에 새 컬럼 `J: id`를 추가한다. 기존 A~I 컬럼 순서/서식은 건드리지
  않아 수기로 편집하는 다른 사용자에게 영향이 없다.
- **Self-healing 백필**: `GET action=list` 처리 중 `id`가 빈 행을 만나면
  서버가 그 자리에서 고유 id를 생성해 셀에 써넣고 응답에도 포함한다. 별도
  일회성 마이그레이션 스크립트 실행이 필요 없다.
- 신규 행은 `create` 액션 처리 시 Apps Script가 고유 id(`Utilities.getUuid()`
  기반)를 생성해 부여한다.
- id는 행 번호가 아니라 별도 값이므로, 사람이 시트에서 정렬/필터링해도
  update/delete 대상이 깨지지 않는다.

## API 계약

Apps Script 웹앱은 `doGet`/`doPost` 두 진입점만 제공하므로, 모든 변경은
POST로 보내고 `action` 필드로 의미를 구분한다.

- `GET ?action=list&token=...`
  → `{ ok:true, meetings:[{id, div, client, artist, mdateISO, cp, status, log, followup}, ...] }`
- `POST { action:"create", token, data:{div, client, artist, mdateISO, cp, status, log, followup} }`
  → 새 행을 시트 맨 아래 추가, 생성된 `id` 포함해 반환
- `POST { action:"update", token, id, data:{...변경할 필드만...} }`
  → id로 행 검색 후 **전달된 필드만 부분 업데이트**. 예: `log`만 보내면 다른
  컬럼(`C.P` 등 앱이 모르는 값 포함)은 그대로 둔다 — 다른 사람이 시트에 직접
  입력한 값을 앱이 덮어써서 날리지 않기 위함.
- `POST { action:"delete", token, id }`
  → id로 행 검색 후 해당 행을 하드 삭제 (`deleteRow`). 되돌리기는 Sheets
  버전 기록(수정 내역)에 의존한다 — 앱 자체에는 undo가 없다.

모든 요청에 공유 비밀값 `token`을 포함하며, Apps Script 스크립트 속성
(Script Properties)에 저장된 값과 비교해 불일치 시 `401`을 반환한다.
사내망 전용 배포라 강한 접근 통제라기보다 "실수/오호출 방지용" 최소
방어선이다. 클라이언트에는 `index.html` 상단 설정 상수로 URL과 토큰을
박아둔다.

응답은 항상 `{ ok: boolean, ... }` 형태의 JSON이며, 실패 시
`{ ok:false, error: "메시지" }`를 반환한다.

## 클라이언트(`index.html`) 변경

- 부팅 시 `localStorage`에서 즉시 동기 로드하던 `load()`를, Apps Script
  `action=list` 비동기 fetch로 교체. 로딩 인디케이터 표시, 실패 시 에러
  배너(재시도 버튼) 표시하고 빈 상태로 두지 않는다.
- 현재 UI가 `state.meetings` 배열을 직접 mutate하고 `save()`
  (`localStorage.setItem`)를 호출하는 지점들을, 각각 해당 CRUD 액션의 POST
  호출로 교체:
  - 미팅 추가 → `action:"create"`, 응답의 id를 포함해 로컬 배열에 반영
  - 미팅 수정 → `action:"update"`
  - 미팅 삭제 → `action:"delete"`
  - 성공 시 서버 응답으로 해당 항목만 갱신, 실패 시 에러 배너 + 변경 롤백
    (낙관적 업데이트를 하더라도 실패하면 원상복구)
- `state.clients`, `state.week`, `state.baseDate`는 기존 로직 유지
  (`week`는 여전히 클라이언트에서 `meetings`로부터 계산).
- 기존 "초기화" 버튼(`localStorage.removeItem(LS)` 후 `seedState()`로
  되돌리는 로직, `dataset.armed` 처리부)은 제거한다. `meetings`가 이제 시트가
  원본이라 로컬 초기화라는 개념 자체가 더 이상 의미가 없고, 남겨두면
  "시트 데이터도 초기화되는 것 아니냐"는 오해를 살 수 있다.

## 에러 처리

- 네트워크 실패/타임아웃 시 기존 화면 데이터는 유지하고 에러 배너만 표시,
  자동 재시도는 하지 않고 수동 재시도 버튼을 제공한다.
- `token` 불일치 등 서버측 거부(`ok:false`)도 동일하게 에러 배너로 노출한다.
- 동시 편집 충돌(다른 사람이 같은 행을 그 사이 수정/삭제) 은 별도 락 없이
  **마지막 쓰기가 이긴다(last-write-wins)**. delete 대상 id가 이미 없으면
  update/delete는 `ok:false, error:"not_found"`를 반환하고 클라이언트는 목록을
  다시 불러와 최신 상태로 맞춘다.

## 배포 절차

1. (제가 작성) Apps Script 코드를 `script.google.com`에서 해당 시트에 연결된
   프로젝트로 붙여넣는다.
2. **배포(웹앱 생성)와 권한 승인("허용" 클릭)은 사용자가 직접 진행**한다 —
   스크립트가 시트에 대한 접근 권한을 요청하는 동의 단계라 계정 소유자 본인의
   승인이 필요하다.
3. 배포된 웹앱 URL을 `index.html`의 설정 상수에 반영한다.
4. curl로 `list`/`create`/`update`/`delete` 스모크 테스트를 먼저 돌려 계약을
   검증한 뒤, 브라우저에서 실제 CRUD 시나리오를 수동 확인한다.

## 테스트 전략

프로젝트에 테스트 프레임워크가 없는 단일 HTML 정적 앱이므로:

- Apps Script 배포 직후 curl 기반 스모크 테스트(4개 액션 각각 성공/실패
  케이스)로 API 계약을 검증.
- 브라우저에서 실제 앱을 통해: 목록 로드 → 생성 → 수정 → 삭제 → 새로고침 후
  반영 확인의 전체 CRUD 흐름을 수동 확인.
- 기존 데이터(수기로 입력된 행들)에 대해 `id` self-healing 백필이 첫 GET
  호출에서 정상적으로 채워지는지 확인.
