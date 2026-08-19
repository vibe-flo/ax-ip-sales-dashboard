# Google Sheets 기반 미팅 데이터 연동 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `index.html`의 미팅(`meetings`) 데이터를 로컬 `localStorage` 대신 실제 사내 Google Sheet(`IP사업부문 영업 현황` 탭)에서 GET/CREATE/UPDATE/DELETE 하도록 전환한다.

**Architecture:** 정적 사이트에 백엔드가 없으므로 Google Apps Script를 시트 소유자 권한으로 실행되는 웹앱(GET=list, POST=action 필드로 create/update/delete)으로 배포해 프록시로 쓴다. 브라우저는 부팅 시 비동기로 시트에서 미팅 목록을 가져오고, 이후 모든 미팅 CRUD는 즉시 API를 호출한다. `clients` 데이터는 이번 범위 밖이며 기존처럼 로컬에 남는다.

**Tech Stack:** 순수 HTML/CSS/JS (빌드 도구 없음, 단일 `index.html` 파일), Google Apps Script (`ContentService`, `SpreadsheetApp`, `LockService`, `PropertiesService`).

**Spec:** `docs/superpowers/specs/2026-08-19-google-sheets-meetings-backend-design.md`

## Global Constraints

- 배포 환경은 사내망 전용(`10.1.22.179`) — 인터넷에 노출되지 않는다.
- 단일 정적 `index.html` 파일 구조를 유지한다 — 빌드 도구/프레임워크를 새로 들이지 않는다.
- 이번 연동 대상은 `meetings`뿐이다. `clients`와 `MDS 파트너 리스트`(민감 개인정보 포함)는 절대 건드리지 않는다.
- Apps Script 웹앱은 `doGet`(조회)과 `doPost`(생성/수정/삭제, `action` 필드로 구분) 두 진입점만 쓴다.
- `update`는 전달된 필드만 부분 업데이트한다 — 앱이 모르는 컬럼(예: C.P)은 절대 덮어쓰지 않는다.
- 시트가 미팅 데이터의 유일한 원본이다 — `localStorage`에 미팅 데이터를 캐시하지 않는다.
- 모든 요청은 공유 비밀값(`token`)을 실어 보내고, Apps Script는 스크립트 속성(`API_TOKEN`)과 비교해 불일치 시 거부한다.

---

## Task 1: Apps Script 프록시 작성 및 배포

**Files:**
- Create: `google-apps-script/Code.gs` (버전 관리용 원본 — 실제 실행은 script.google.com 에디터에 붙여넣어 배포)

**Interfaces:**
- Produces: 배포된 웹앱 URL(`https://script.google.com/macros/s/.../exec` 형태)과 `API_TOKEN` 값 — Task 2에서 `SHEETS_API_URL`/`SHEETS_API_TOKEN`으로 사용.
- API 계약: `GET ?action=list&token=` → `{ok, meetings:[{id,div,client,artist,mdateISO,cp,status,log}]}`; `POST {token,action:'create'|'update'|'delete', id?, data?}` → `{ok, meeting?}` 또는 `{ok:false, error}`.

- [ ] **Step 1: `google-apps-script/Code.gs` 작성**

```js
const SHEET_NAME='IP사업부문 영업 현황';
const COLS={date:1, div:2, client:3, artist:4, mdate:5, cp:6, status:7, log:8, id:9};

function getSheet_(){
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
}
function getToken_(){
  return PropertiesService.getScriptProperties().getProperty('API_TOKEN');
}
function checkToken_(token){
  const expected=getToken_();
  return !!expected && token===expected;
}
function jsonOut_(obj){
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function withLock_(fn){
  const lock=LockService.getScriptLock();
  lock.waitLock(10000);
  try{ return fn(); } finally { lock.releaseLock(); }
}
function toDateObj_(iso){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(iso||'')) return null;
  return new Date(iso+'T00:00:00');
}
function computeWeekDate_(iso){
  const d=toDateObj_(iso);
  if(!d) return null;
  const off=(d.getDay()+6)%7;
  const w=new Date(d);
  w.setDate(w.getDate()-off);
  return w;
}
function dateCellToISO_(v){
  if(v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const s=String(v||'').trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if(/^\d{4}\.\d{2}\.\d{2}$/.test(s)) return s.replace(/\./g,'-');
  return '';
}
function rowToMeeting_(sheet,row){
  const v=sheet.getRange(row,1,1,9).getValues()[0];
  return { id:String(v[8]||''), div:String(v[1]||''), client:String(v[2]||''), artist:String(v[3]||''), mdateISO:dateCellToISO_(v[4]), cp:String(v[5]||''), status:String(v[6]||''), log:String(v[7]||'') };
}
function findRowById_(sheet,id){
  const last=sheet.getLastRow();
  if(last<2) return -1;
  const ids=sheet.getRange(2,COLS.id,last-1,1).getValues();
  for(let i=0;i<ids.length;i++){ if(String(ids[i][0]).trim()===String(id)) return i+2; }
  return -1;
}
function listMeetings_(){
  const sheet=getSheet_();
  const last=sheet.getLastRow();
  if(last<2) return [];
  const values=sheet.getRange(2,1,last-1,9).getValues();
  const out=[];
  values.forEach((v,i)=>{
    const row=i+2;
    let id=String(v[8]||'').trim();
    if(!id){ id=Utilities.getUuid(); sheet.getRange(row,COLS.id).setValue(id); }
    out.push({ id, div:String(v[1]||''), client:String(v[2]||''), artist:String(v[3]||''), mdateISO:dateCellToISO_(v[4]), cp:String(v[5]||''), status:String(v[6]||''), log:String(v[7]||'') });
  });
  return out;
}
function createMeeting_(data){
  const sheet=getSheet_();
  const id=Utilities.getUuid();
  const mdate=toDateObj_(data.mdateISO);
  const week=computeWeekDate_(data.mdateISO);
  sheet.appendRow([week||'', data.div||'', data.client||'', data.artist||'', mdate||'', data.cp||'', data.status||'', data.log||'', id]);
  return rowToMeeting_(sheet, sheet.getLastRow());
}
function updateMeeting_(id,data){
  const sheet=getSheet_();
  const row=findRowById_(sheet,id);
  if(row<0) return null;
  const has=k=>Object.prototype.hasOwnProperty.call(data,k);
  if(has('div')) sheet.getRange(row,COLS.div).setValue(data.div||'');
  if(has('client')) sheet.getRange(row,COLS.client).setValue(data.client||'');
  if(has('artist')) sheet.getRange(row,COLS.artist).setValue(data.artist||'');
  if(has('status')) sheet.getRange(row,COLS.status).setValue(data.status||'');
  if(has('log')) sheet.getRange(row,COLS.log).setValue(data.log||'');
  if(has('mdateISO')){
    sheet.getRange(row,COLS.mdate).setValue(toDateObj_(data.mdateISO)||'');
    sheet.getRange(row,COLS.date).setValue(computeWeekDate_(data.mdateISO)||'');
  }
  return rowToMeeting_(sheet,row);
}
function deleteMeeting_(id){
  const sheet=getSheet_();
  const row=findRowById_(sheet,id);
  if(row<0) return false;
  sheet.deleteRow(row);
  return true;
}
function doGet(e){
  const token=e.parameter.token;
  if(!checkToken_(token)) return jsonOut_({ok:false,error:'unauthorized'});
  if(e.parameter.action==='list'){
    try{ return jsonOut_({ok:true, meetings:listMeetings_()}); }
    catch(err){ return jsonOut_({ok:false, error:String(err)}); }
  }
  return jsonOut_({ok:false, error:'unknown_action'});
}
function doPost(e){
  let body;
  try{ body=JSON.parse(e.postData.contents); }catch(err){ return jsonOut_({ok:false,error:'bad_json'}); }
  if(!checkToken_(body.token)) return jsonOut_({ok:false,error:'unauthorized'});
  try{
    if(body.action==='create') return jsonOut_({ok:true, meeting:withLock_(()=>createMeeting_(body.data||{}))});
    if(body.action==='update'){
      const m=withLock_(()=>updateMeeting_(body.id, body.data||{}));
      if(!m) return jsonOut_({ok:false,error:'not_found'});
      return jsonOut_({ok:true, meeting:m});
    }
    if(body.action==='delete'){
      const ok=withLock_(()=>deleteMeeting_(body.id));
      if(!ok) return jsonOut_({ok:false,error:'not_found'});
      return jsonOut_({ok:true});
    }
    return jsonOut_({ok:false,error:'unknown_action'});
  }catch(err){
    return jsonOut_({ok:false,error:String(err)});
  }
}
```

- [ ] **Step 2: [사용자 액션] 컨테이너 바인딩 스크립트 생성**

시트(`[IP부문] 영업용 대시보드_data`)를 열고 `확장 프로그램 > Apps Script`를 클릭한다. 새 프로젝트가 열리면 기본 `Code.gs` 내용을 전부 지우고 Step 1의 코드를 붙여넣는다. `SpreadsheetApp.getActiveSpreadsheet()`가 이 시트를 바로 가리키므로 별도 스프레드시트 ID 설정은 필요 없다.

- [ ] **Step 3: [사용자 액션] 공유 토큰 설정**

Apps Script 에디터 좌측 톱니바퀴(프로젝트 설정) → 스크립트 속성 → 속성 추가:
- 키: `API_TOKEN`
- 값: 32자 이상의 임의의 무작위 문자열 (예: `openssl rand -hex 32`로 생성)

이 값을 기록해 둔다 — Task 2에서 `index.html`에 그대로 넣는다.

- [ ] **Step 4: [사용자 액션] 웹 앱으로 배포**

`배포 > 새 배포` → 유형에서 톱니바퀴 클릭 후 `웹 앱` 선택:
- 다음으로 실행: 나
- 액세스 권한이 있는 사용자: 전체

`배포`를 클릭하면 처음엔 권한 승인 화면이 뜬다 — 본인 Google 계정으로 "허용"을 눌러야 한다(이 동의 단계는 계정 소유자만 할 수 있어 대신 진행할 수 없다). 배포가 끝나면 나오는 **웹 앱 URL**을 기록해 둔다 — Task 2에서 사용한다.

- [ ] **Step 5: curl로 계약 검증**

```bash
export URL="<Step 4에서 얻은 웹 앱 URL>"
export TOKEN="<Step 3에서 설정한 API_TOKEN 값>"

# 1) 목록 조회 — 기존 행들의 id가 자동으로 채워지는지 확인
curl -s "$URL?action=list&token=$TOKEN" | head -c 500

# 2) 생성
curl -s -X POST "$URL" -H "Content-Type: text/plain;charset=utf-8" \
  -d "{\"token\":\"$TOKEN\",\"action\":\"create\",\"data\":{\"div\":\"팬덤사업부\",\"client\":\"__SMOKE_TEST__\",\"artist\":\"\",\"mdateISO\":\"2026-08-20\",\"status\":\"미팅\",\"log\":\"스모크 테스트\"}}"
# 응답의 meeting.id 를 기록해 둔다 (예: ID_ABOVE)

# 3) 수정 (log만 부분 업데이트 — 다른 필드는 그대로인지 확인)
curl -s -X POST "$URL" -H "Content-Type: text/plain;charset=utf-8" \
  -d "{\"token\":\"$TOKEN\",\"action\":\"update\",\"id\":\"ID_ABOVE\",\"data\":{\"log\":\"수정됨\"}}"

# 4) 삭제
curl -s -X POST "$URL" -H "Content-Type: text/plain;charset=utf-8" \
  -d "{\"token\":\"$TOKEN\",\"action\":\"delete\",\"id\":\"ID_ABOVE\"}"
```

Expected: (1) `{"ok":true,"meetings":[...]}` 이고 시트를 열어보면 비어있던 `id` 컬럼(I열)이 채워져 있음. (2) `{"ok":true,"meeting":{"id":"...","client":"__SMOKE_TEST__",...}}` 이고 시트에 새 행이 보임. (3) 시트의 `log`만 "수정됨"으로 바뀌고 다른 컬럼은 그대로. (4) `{"ok":true}` 이고 시트에서 해당 행이 사라짐.

- [ ] **Step 6: 커밋**

```bash
git add google-apps-script/Code.gs
git commit -m "$(cat <<'EOF'
feat: add Apps Script proxy for meetings sheet CRUD

Provides GET (list) and POST (create/update/delete via action field)
endpoints backed by the IP사업부문 영업 현황 sheet tab. Deployed
manually to script.google.com; not run from this repo.
EOF
)"
```

---

## Task 2: `index.html`에 API 설정 상수 및 헬퍼 함수 추가

**Files:**
- Modify: `index.html` (현재 기준 16678번째 줄 부근, `const acts=...` 바로 다음, `let state=load();` 바로 앞 — 이후 태스크가 이 줄 순서를 바꾸므로 실제 줄 번호는 달라질 수 있다. 아래 `old_string`으로 정확한 위치를 찾는다.)

**Interfaces:**
- Consumes: 없음 (Task 1에서 얻은 웹 앱 URL과 토큰 값만 사용)
- Produces: `apiList(): Promise<Array<{id,div,client,artist,mdateISO,cp,status,log}>>`, `apiCreate(data): Promise<{ok,meeting}>`, `apiUpdate(id,data): Promise<{ok,meeting}>`, `apiDelete(id): Promise<{ok}>` — 모두 실패 시 `Error(message)`로 reject.

- [ ] **Step 1: 설정 상수와 API 헬퍼 삽입**

`index.html`에서 아래 `old_string`을 찾는다 (정확히 이 두 줄이 연속으로 나온다):

```js
  const acts=(t,id)=>`<div class="acts"><button class="icon-btn del" data-act="del-${t}" data-id="${id}" aria-label="삭제">${delIco}</button></div>`;

  let state=load();
```

다음으로 교체한다 (`SHEETS_API_URL`/`SHEETS_API_TOKEN`은 **Task 1에서 실제로 얻은 값**을 채워 넣는다 — 아래는 형식 예시일 뿐 그대로 두면 안 된다):

```js
  const acts=(t,id)=>`<div class="acts"><button class="icon-btn del" data-act="del-${t}" data-id="${id}" aria-label="삭제">${delIco}</button></div>`;

  const SHEETS_API_URL='https://script.google.com/macros/s/AKfycb.../exec';
  const SHEETS_API_TOKEN='<Task 1 Step 3에서 설정한 API_TOKEN 값>';
  async function apiList(){
    const res=await fetch(`${SHEETS_API_URL}?action=list&token=${encodeURIComponent(SHEETS_API_TOKEN)}`);
    const j=await res.json();
    if(!j.ok) throw new Error(j.error||'list_failed');
    return j.meetings;
  }
  async function apiPost(body){
    const res=await fetch(SHEETS_API_URL, { method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body:JSON.stringify(Object.assign({token:SHEETS_API_TOKEN}, body)) });
    const j=await res.json();
    if(!j.ok) throw new Error(j.error||'request_failed');
    return j;
  }
  const apiCreate=data=>apiPost({action:'create',data});
  const apiUpdate=(id,data)=>apiPost({action:'update',id,data});
  const apiDelete=id=>apiPost({action:'delete',id});

  let state=load();
```

(`Content-Type: text/plain;charset=utf-8`를 쓰는 이유: Apps Script 웹앱은 브라우저의 CORS preflight(OPTIONS) 요청을 처리하지 않으므로, `application/json`을 쓰면 preflight가 발생해 요청이 막힌다. `text/plain`으로 보내면 "simple request"로 취급돼 preflight 없이 바로 전송되고, 서버는 `e.postData.contents`를 그냥 `JSON.parse`하면 된다.)

- [ ] **Step 2: 문법 확인**

브라우저에서 `index.html`을 열고(로컬 서버 예: `python3 -m http.server 8000` 후 `http://localhost:8000/index.html`) 개발자 도구 콘솔에 에러가 없는지, `typeof apiList==='function'`이 `true`인지 확인한다. (`SHEETS_API_URL`이 아직 실제 값이면 이 시점에는 이후 태스크 전이라 실제 네트워크 호출은 하지 않는다 — Task 8에서 종합 검증한다.)

- [ ] **Step 3: 커밋**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
feat: add Apps Script API config and fetch helpers

Adds SHEETS_API_URL/SHEETS_API_TOKEN plus apiList/apiCreate/apiUpdate/
apiDelete promise-based wrappers around the Apps Script proxy.
EOF
)"
```

---

## Task 3: 부팅 시퀀스를 서버 비동기 로드로 전환

**Files:**
- Modify: `index.html` (`function load(){...}` / `function save(){...}` 블록, `let state=load();` 줄, `function render(){...}` 줄, IIFE 맨 끝 `render(); })();` 부분)

**Interfaces:**
- Consumes: Task 2의 `apiList()`
- Produces: `loadLocal(): {clients, week, baseDate}`, `normalizeMeeting(m): meeting`, `loadMeetingsFromServer(): Promise<void>` (완료 시 `state.meetings`/`state.meetingsStatus`/`state.meetingsError`를 채우고 `render()` 호출), `ensureApiBanner()`, `renderApiBanner()`. `render()`가 `renderApiBanner()`를 제일 먼저 호출하도록 바뀜.

- [ ] **Step 1: `load()`/`save()`를 `loadLocal()`/`save()`로 교체**

아래 `old_string`을 찾는다:

```js
  function load(){ try{ const s=localStorage.getItem(LS); if(s){ const st=JSON.parse(s); const artmap={'소속사 F':'유주','소속사 D':'채원','소속사 A':'윤슬'}; (st.clients||[]).forEach(c=>{ if(SMAP[c.stage]) c.stage=SMAP[c.stage]; if(c.entity==='해외') c.entity='법인'; if(!c.artist&&artmap[c.name]) c.artist=artmap[c.name]; }); (st.meetings||[]).forEach(m=>{ if(SMAP[m.status]) m.status=SMAP[m.status]; if(m.div==='360사업팀') m.div='IP전략팀'; m.week=weekOf(m.week)||m.week; }); st.week=weekOf(st.week)||st.week; return st; } }catch(e){} return seedState(); }
  function save(){ try{ localStorage.setItem(LS,JSON.stringify(state)); }catch(e){} }
```

다음으로 교체한다:

```js
  function loadLocal(){
    try{
      const s=localStorage.getItem(LS);
      if(s){
        const st=JSON.parse(s);
        const artmap={'소속사 F':'유주','소속사 D':'채원','소속사 A':'윤슬'};
        (st.clients||[]).forEach(c=>{ if(SMAP[c.stage]) c.stage=SMAP[c.stage]; if(c.entity==='해외') c.entity='법인'; if(!c.artist&&artmap[c.name]) c.artist=artmap[c.name]; });
        return { clients: st.clients||seedClients(), week: weekOf(st.week)||st.week||'', baseDate: st.baseDate||new Date().toISOString().slice(0,10) };
      }
    }catch(e){}
    return { clients: seedClients(), week: '', baseDate: new Date().toISOString().slice(0,10) };
  }
  function save(){ try{ localStorage.setItem(LS,JSON.stringify({clients:state.clients, week:state.week, baseDate:state.baseDate})); }catch(e){} }
  function normalizeMeeting(m){
    const o=Object.assign({},m);
    o.org='드림어스';
    if(SMAP[o.status]) o.status=SMAP[o.status];
    if(o.div==='360사업팀') o.div='IP전략팀';
    o.mdate=o.mdateISO?ymd2(o.mdateISO):(o.mdate||'미정');
    o.week=weekOf(o.mdateISO)||weekOf(o.week)||'';
    return o;
  }
  function ensureApiBanner(){
    let el=document.getElementById('apiBanner');
    if(!el){ el=document.createElement('div'); el.id='apiBanner'; el.style.cssText='position:sticky;top:0;z-index:50;padding:10px 16px;font-size:14px;text-align:center;display:none;'; document.body.insertBefore(el, document.body.firstChild); }
    return el;
  }
  function renderApiBanner(){
    const el=ensureApiBanner();
    if(state.meetingsStatus==='loading'){
      el.style.display='block'; el.style.background='#eef2ff'; el.style.color='#3730a3';
      el.textContent='미팅 데이터를 불러오는 중...';
    } else if(state.meetingsStatus==='error'){
      el.style.display='block'; el.style.background='#fee2e2'; el.style.color='#991b1b';
      el.innerHTML=`미팅 데이터를 불러오지 못했어요 (${esc(state.meetingsError||'')}) <button type="button" id="apiRetry" style="margin-left:8px;text-decoration:underline;background:none;border:none;color:inherit;cursor:pointer">다시 시도</button>`;
      const rb=document.getElementById('apiRetry'); if(rb) rb.addEventListener('click', loadMeetingsFromServer);
    } else {
      el.style.display='none';
    }
  }
  async function loadMeetingsFromServer(){
    state.meetingsStatus='loading'; state.meetingsError=''; render();
    try{
      const list=await apiList();
      state.meetings=list.map(normalizeMeeting);
      const wl=weeks();
      if(!state.week||!wl.includes(state.week)) state.week=wl.length?wl[wl.length-1]:'';
      state.meetingsStatus='ready';
    }catch(err){
      state.meetingsStatus='error'; state.meetingsError=String(err&&err.message||err);
    }
    render();
  }
```

- [ ] **Step 2: 부팅 시 `state` 초기화 변경**

`old_string`:

```js
  let state=load();
```

`new_string`:

```js
  let state=loadLocal();
  state.meetings=[]; state.meetingsStatus='loading'; state.meetingsError='';
```

- [ ] **Step 3: `render()`가 배너를 먼저 그리도록 변경**

`old_string`:

```js
  function render(){ renderChips(); renderWeek(); renderStatus(); renderCoverage(); if(!calMonth) calMonth=(state.week||'2026-07').slice(0,7); renderCal(); save(); }
```

`new_string`:

```js
  function render(){ renderApiBanner(); renderChips(); renderWeek(); renderStatus(); renderCoverage(); if(!calMonth) calMonth=(state.week||'2026-07').slice(0,7); renderCal(); save(); }
```

- [ ] **Step 4: 부팅 마지막에 서버 로드 트리거**

`old_string` (파일 맨 끝부분, `})();` 바로 앞):

```js
  render();
})();
```

`new_string`:

```js
  render();
  loadMeetingsFromServer();
})();
```

- [ ] **Step 5: 브라우저에서 확인**

`index.html`을 로컬 서버로 열고(Task 2 Step 2와 동일한 방법), `SHEETS_API_URL`이 아직 Task 1의 실제 값이 아니라면 이 단계에서는 상단에 "미팅 데이터를 불러오지 못했어요" 에러 배너가 뜨는 것이 정상이다(네트워크 요청이 실패하므로). 콘솔에 문법 오류가 없는지, 배너의 "다시 시도" 버튼을 눌렀을 때 다시 로딩 상태로 바뀌는지 확인한다. 페이지 자체는 깨지지 않고(미팅 없음 상태로) 렌더링되어야 한다.

- [ ] **Step 6: 커밋**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
feat: load meetings asynchronously from Sheets API on boot

Replaces the synchronous localStorage load for meetings with an
async fetch against the Apps Script proxy, with a loading/error
banner. localStorage now only persists clients/week/baseDate.
EOF
)"
```

---

## Task 4: 미팅 생성/수정 폼을 API 연동으로 전환

**Files:**
- Modify: `index.html` (`function mForm(m){...}` 및 바로 위 `function syncDivField(){...}`, `document.addEventListener('change', ...)` 중 `orgsel` 절, `mf` 폼 submit 핸들러)

**Interfaces:**
- Consumes: Task 2의 `apiCreate`/`apiUpdate`, Task 3의 `normalizeMeeting`/`loadMeetingsFromServer`
- Produces: (없음 — UI 이벤트 핸들러 변경)

- [ ] **Step 1: 미팅 폼에서 주체(org) 선택 제거**

`old_string`:

```js
  function syncDivField(){ var os=document.getElementById('orgsel'); if(!os) return; var dream=os.value==='드림어스', df=document.getElementById('divfield'), or=document.getElementById('orgrow'); if(df) df.style.display=dream?'':'none'; if(or) or.classList.toggle('solo',!dream); }
  function mForm(m){ m=m||{id:'',week:state.week,org:(ORGS.includes(orgFilter)?orgFilter:'드림어스'),div:'팬덤사업부',client:'',artist:'',mdate:'',status:'미팅',log:'',followup:''};
    openModal(m.id?'미팅 수정':'미팅 추가',`<form id="mf" data-id="${m.id}">
      <input type="hidden" name="week" value="${esc(m.week)}">
      <div class="two"><div class="field"><label>미팅일시</label><input type="date" name="mdate" value="${esc(m.mdateISO||'')}"${(!m.mdateISO&&m.mdate)?' disabled':''}></div>
      <div class="field"><label>컨택상황</label><select name="status">${opts(MSTATUS,m.status)}</select></div></div>
      <div class="field"><label class="check"><input type="checkbox" name="tbd" ${(!m.mdateISO&&m.mdate)?'checked':''}> 일정 미정 (날짜는 나중에)</label></div>
      <div class="two" id="orgrow"><div class="field"><label>주체</label><select name="org" id="orgsel">${opts(ORGS,m.org)}</select></div>
      <div class="field" id="divfield"><label>사업부</label><select name="div">${opts(DIVS,m.div)}</select></div></div>
      <div class="two"><div class="field"><label>기획사</label><input type="text" name="client" value="${esc(m.client)}" placeholder="예) SM엔터테인먼트" required></div>
      <div class="field"><label>아티스트</label><input type="text" name="artist" value="${esc(m.artist)}" placeholder="예) 온유 / ALL"></div></div>
      <div class="field"><label>주요 미팅 내역</label><textarea name="log">${esc(m.log)}</textarea></div>
      <div class="field"><label>후속계획</label><textarea name="followup">${esc(m.followup)}</textarea></div>
      <div class="modal-foot">${m.id?`<button type="button" class="btn" data-act="del-m" data-id="${m.id}" style="margin-right:auto">삭제</button>`:''}<button type="button" class="btn" data-act="close">취소</button><button type="submit" class="btn primary">저장</button></div></form>`); syncDivField(); }
```

`new_string`:

```js
  function mForm(m){ m=m||{id:'',week:state.week,org:'드림어스',div:'팬덤사업부',client:'',artist:'',mdate:'',status:'미팅',log:'',followup:''};
    openModal(m.id?'미팅 수정':'미팅 추가',`<form id="mf" data-id="${m.id}">
      <input type="hidden" name="week" value="${esc(m.week)}">
      <div class="two"><div class="field"><label>미팅일시</label><input type="date" name="mdate" value="${esc(m.mdateISO||'')}"${(!m.mdateISO&&m.mdate)?' disabled':''}></div>
      <div class="field"><label>컨택상황</label><select name="status">${opts(MSTATUS,m.status)}</select></div></div>
      <div class="field"><label class="check"><input type="checkbox" name="tbd" ${(!m.mdateISO&&m.mdate)?'checked':''}> 일정 미정 (날짜는 나중에)</label></div>
      <div class="field"><label>사업부</label><select name="div">${opts(DIVS,m.div)}</select></div>
      <div class="two"><div class="field"><label>기획사</label><input type="text" name="client" value="${esc(m.client)}" placeholder="예) SM엔터테인먼트" required></div>
      <div class="field"><label>아티스트</label><input type="text" name="artist" value="${esc(m.artist)}" placeholder="예) 온유 / ALL"></div></div>
      <div class="field"><label>주요 미팅 내역</label><textarea name="log">${esc(m.log)}</textarea></div>
      <div class="field"><label>후속계획</label><textarea name="followup">${esc(m.followup)}</textarea></div>
      <div class="modal-foot">${m.id?`<button type="button" class="btn" data-act="del-m" data-id="${m.id}" style="margin-right:auto">삭제</button>`:''}<button type="button" class="btn" data-act="close">취소</button><button type="submit" class="btn primary">저장</button></div></form>`); }
```

(사내 시트가 드림어스 전용이라 주체 선택 UI를 없애고 항상 `'드림어스'`로 고정한다 — 사용자 승인된 결정.)

- [ ] **Step 2: 이제 존재하지 않는 `orgsel` change 리스너 정리**

`old_string`:

```js
  document.addEventListener('change',e=>{ if(e.target.id==='orgsel') syncDivField(); if(e.target.name==='tbd'){ const di=e.target.form&&e.target.form.mdate; if(di){ di.disabled=e.target.checked; if(e.target.checked) di.value=''; } } });
```

`new_string`:

```js
  document.addEventListener('change',e=>{ if(e.target.name==='tbd'){ const di=e.target.form&&e.target.form.mdate; if(di){ di.disabled=e.target.checked; if(e.target.checked) di.value=''; } } });
```

- [ ] **Step 3: `mf` submit 핸들러를 API 호출로 교체**

`old_string`:

```js
    if(e.target.id==='mf'){ e.preventDefault(); const f=e.target,id=f.dataset.id,o={id:id||uid()}; ['week','org','div','client','artist','status','log','followup'].forEach(k=>o[k]=f[k].value.trim()); if(o.org!=='드림어스') o.div='';
      const tbd=f.tbd&&f.tbd.checked, dv=(f.mdate.value||'').trim();
      if(tbd||!dv){ o.mdateISO=''; o.mdate='미정'; } else { o.mdateISO=dv; o.mdate=ymd2(dv); }
      o.week=weekOf(o.mdateISO)||weekOf(o.week)||weekOf(new Date().toISOString().slice(0,10));
      const i=state.meetings.findIndex(x=>x.id===id); if(i>=0) state.meetings[i]=o; else state.meetings.push(o); if(o.week) state.week=o.week; closeModal(); render(); showToast('저장되었습니다'); }
```

`new_string`:

```js
    if(e.target.id==='mf'){
      e.preventDefault();
      const f=e.target, id=f.dataset.id;
      const o={ id, org:'드림어스' };
      ['div','client','artist','status','log','followup'].forEach(k=>o[k]=f[k].value.trim());
      const tbd=f.tbd&&f.tbd.checked, dv=(f.mdate.value||'').trim();
      if(tbd||!dv){ o.mdateISO=''; o.mdate='미정'; } else { o.mdateISO=dv; o.mdate=ymd2(dv); }
      o.week=weekOf(o.mdateISO)||weekOf(f.week.value.trim())||weekOf(new Date().toISOString().slice(0,10));
      const payload={ div:o.div, client:o.client, artist:o.artist, mdateISO:o.mdateISO, status:o.status, log:o.log };
      const btn=f.querySelector('button[type=submit]'); if(btn){ btn.disabled=true; btn.textContent='저장 중...'; }
      const req=id?apiUpdate(id,payload):apiCreate(payload);
      req.then(res=>{
        const saved=normalizeMeeting(Object.assign({}, res.meeting, {followup:o.followup}));
        const i=state.meetings.findIndex(x=>x.id===saved.id);
        if(i>=0) state.meetings[i]=saved; else state.meetings.push(saved);
        if(saved.week) state.week=saved.week;
        closeModal(); render(); showToast('저장되었습니다');
      }).catch(err=>{
        if(btn){ btn.disabled=false; btn.textContent='저장'; }
        showToast('저장 실패: '+(err&&err.message||err));
        if(err&&err.message==='not_found'){ closeModal(); loadMeetingsFromServer(); }
      });
    }
```

(`followup`은 사양대로 시트에 보내지 않는다 — 저장 직후 화면에는 남아 보이지만, 새로고침해서 서버에서 다시 불러오면 사라진다. 이는 승인된 동작이다.)

- [ ] **Step 4: 브라우저에서 확인 (Task 1의 실제 URL/토큰이 채워진 상태 기준)**

앱에서 "+ 미팅 추가"로 새 미팅을 저장 → 저장 중 버튼이 "저장 중..."으로 바뀌었다가 모달이 닫히고 토스트가 뜨는지 확인. 구글 시트를 새로고침해 새 행이 추가되고 `id` 컬럼(I열)이 채워졌는지 확인. 기존 미팅을 수정해 시트의 다른 컬럼(예: C.P를 시트에서 직접 입력해 둔 값)이 그대로 남아있는지 확인.

- [ ] **Step 5: 커밋**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
feat: wire meeting create/edit form to Sheets API

Removes the org selector (this sheet is Dreamus-only) and posts
create/update requests through apiCreate/apiUpdate with optimistic
UI rollback on failure.
EOF
)"
```

---

## Task 5: 미팅 삭제를 API 연동으로 전환

**Files:**
- Modify: `index.html` (클릭 디스패처의 `a==='del-m'` 분기)

**Interfaces:**
- Consumes: Task 2의 `apiDelete`, Task 3의 `loadMeetingsFromServer`

- [ ] **Step 1: `del-m` 핸들러를 API 호출로 교체**

`old_string`:

```js
    else if(a==='del-m'){ if(b.dataset.armed){ state.meetings=state.meetings.filter(x=>x.id!==id); closeModal(); render(); showToast('미팅을 삭제했어요'); } else { b.dataset.armed='1'; b.textContent='한 번 더 누르면 삭제'; b.classList.add('danger'); } }
```

`new_string`:

```js
    else if(a==='del-m'){ if(b.dataset.armed){ b.disabled=true; b.textContent='삭제 중...'; apiDelete(id).then(()=>{ state.meetings=state.meetings.filter(x=>x.id!==id); closeModal(); render(); showToast('미팅을 삭제했어요'); }).catch(err=>{ b.disabled=false; b.textContent='한 번 더 누르면 삭제'; showToast('삭제 실패: '+(err&&err.message||err)); if(err&&err.message==='not_found'){ closeModal(); loadMeetingsFromServer(); } }); } else { b.dataset.armed='1'; b.textContent='한 번 더 누르면 삭제'; b.classList.add('danger'); } }
```

- [ ] **Step 2: 브라우저에서 확인**

미팅 수정 모달에서 "삭제" → "한 번 더 누르면 삭제" 두 번째 클릭 → 버튼이 "삭제 중..."으로 바뀐 뒤 모달이 닫히고 토스트가 뜨는지 확인. 구글 시트를 새로고침해 해당 행이 사라졌는지 확인.

- [ ] **Step 3: 커밋**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
feat: wire meeting delete to Sheets API

del-m now calls apiDelete and only removes the local row on success;
failures re-arm the confirm button and surface a toast.
EOF
)"
```

---

## Task 6: 백업·복원 범위를 거래처로 제한 + 초기화 버튼 제거

**Files:**
- Modify: `index.html` (`function ioForm(){...}`, 클릭 디스패처의 `a==='load'`/`a==='reset'` 분기)

**Interfaces:**
- 없음 (UI 전용 변경)

- [ ] **Step 1: `ioForm()`이 거래처만 백업하도록 변경**

`old_string`:

```js
  function ioForm(){ openModal('백업 · 복원',`<div class="field"><label>현재 데이터(JSON)</label><textarea class="json" id="jbox" readonly>${esc(JSON.stringify(state,null,2))}</textarea></div>
      <div class="modal-foot" style="margin-top:12px"><button type="button" class="btn" data-act="load">붙여넣기로 복원</button><button type="button" class="btn" data-act="reset">기본값 초기화</button><button type="button" class="btn primary" data-act="copy">복사</button></div>
      <div class="hintline">데이터는 이 브라우저에 자동 저장됩니다. 백업이 필요하면 JSON을 복사해 보관하세요.</div>`); }
```

`new_string`:

```js
  function ioForm(){ const backup={clients:state.clients, week:state.week, baseDate:state.baseDate};
    openModal('백업 · 복원',`<div class="field"><label>현재 데이터(JSON, 거래처만)</label><textarea class="json" id="jbox" readonly>${esc(JSON.stringify(backup,null,2))}</textarea></div>
      <div class="modal-foot" style="margin-top:12px"><button type="button" class="btn" data-act="load">붙여넣기로 복원</button><button type="button" class="btn primary" data-act="copy">복사</button></div>
      <div class="hintline">거래처 데이터는 이 브라우저에 자동 저장됩니다. 미팅 데이터는 Google Sheet에서 직접 관리되며 이 백업에는 포함되지 않습니다.</div>`); }
```

- [ ] **Step 2: `load`/`reset` 액션 정리**

`old_string`:

```js
    else if(a==='load'){ const v=prompt('백업 JSON 붙여넣기:'); if(v){ try{ const p=JSON.parse(v); if(p.meetings&&p.clients){ state=p; closeModal(); render(); } else alert('형식 오류'); }catch(_){ alert('JSON 오류'); } } }
    else if(a==='reset'){ if(b.dataset.armed){ localStorage.removeItem(LS); state=seedState(); statFilter='won'; orgFilter='all'; calMonth=''; closeModal(); render(); showToast('기본값으로 초기화했어요'); } else { b.dataset.armed='1'; b.textContent='한 번 더 누르면 초기화'; b.classList.add('danger'); } }
```

`new_string`:

```js
    else if(a==='load'){ const v=prompt('백업 JSON 붙여넣기:'); if(v){ try{ const p=JSON.parse(v); if(p.clients){ state.clients=p.clients; if(p.week) state.week=p.week; if(p.baseDate) state.baseDate=p.baseDate; closeModal(); render(); } else alert('형식 오류'); }catch(_){ alert('JSON 오류'); } } }
```

(`기본값 초기화` 버튼은 완전히 제거한다 — 미팅이 이제 시트가 원본이라 로컬 초기화라는 개념이 의미가 없고, 남겨두면 "시트 데이터도 초기화되는 것 아니냐"는 오해를 살 수 있다는 스펙 결정.)

- [ ] **Step 3: 브라우저에서 확인**

우측 상단 "백업·복원" 모달을 열어 JSON에 `meetings` 키가 없는지, "기본값 초기화" 버튼이 더 이상 없는지 확인. "복사" → 클립보드 내용에 `clients`/`week`/`baseDate`만 있는지 확인.

- [ ] **Step 4: 커밋**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
feat: scope local backup/restore to clients only

Meetings live in the Sheet now, so the JSON backup/restore modal no
longer touches them, and the misleading local reset button is removed.
EOF
)"
```

---

## Task 7: 죽은 코드 정리 (`SEED_M`, `seedState`)

**Files:**
- Modify: `index.html` (거대한 `const SEED_M = [...]` 리터럴 삭제, `function seedState(){...}` 삭제)

**Interfaces:**
- 없음 (순수 삭제, 다른 태스크가 이미 이 함수들을 참조하지 않음을 전제로 한다 — Task 3~6을 먼저 완료했는지 확인)

- [ ] **Step 1: `SEED_M` 배열을 스크립트로 삭제**

거대한 리터럴(약 950줄)이라 Edit 도구로 통째로 옮기지 않고 Python으로 정확히 잘라낸다:

```bash
python3 - <<'EOF'
path = "index.html"
with open(path, encoding='utf-8') as f:
    data = f.read()

start = data.index("\n  const SEED_M = [")
end_marker = "\n  const DIVS="
end = data.index(end_marker, start)
removed = data[start:end]
assert removed.count("\n") > 900, f"unexpected removal size: {removed.count(chr(10))}"

data = data[:start] + data[end:]
with open(path, 'w', encoding='utf-8') as f:
    f.write(data)
print("removed", removed.count("\n"), "lines")
EOF
```

Expected: `removed 9XX lines` 형태의 출력(정확한 줄 수는 무관, 900줄 초과면 정상).

- [ ] **Step 2: `seedState()` 함수 삭제**

`old_string`:

```js
  function seedState(){ const ms=SEED_M.map((m,i)=>{ const o=Object.assign({id:'s'+(i+1),org:'드림어스'},m); if(SMAP[o.status]) o.status=SMAP[o.status]; if(o.div==='360사업팀') o.div='IP전략팀'; o.week=weekOf(o.week)||o.week; return o; }); const wk=ms.map(m=>m.week).filter(Boolean).sort();
    return { meetings:ms, clients:seedClients(), week: wk.length?wk[wk.length-1]:'', baseDate:new Date().toISOString().slice(0,10) }; }
```

`new_string`: (빈 문자열로 삭제)

- [ ] **Step 3: 확인**

```bash
grep -c "SEED_M\|seedState" index.html
```

Expected: `0` (두 심볼 모두 더 이상 존재하지 않음). 브라우저로 열어 콘솔 에러 없이 정상 로드되는지도 확인한다.

- [ ] **Step 4: 커밋**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
chore: remove dead SEED_M seed data and seedState()

Meetings now come from the Sheets API, so the ~950-line hardcoded
seed array and its only caller are unused. Trims the bundle size.
EOF
)"
```

---

## Task 8: 종단 간 검증

**Files:** 없음 (검증만 수행)

**Interfaces:** 없음

- [ ] **Step 1: 최초 로드 확인**

로컬 서버로 `index.html`을 열고, 상단에 "불러오는 중" 배너가 잠깐 떴다가 사라지는지, 실제 구글 시트의 최신 데이터가 "주간 영업 리포트"/캘린더/타겟 공략 카드에 반영되는지 확인한다.

- [ ] **Step 2: id 백필 확인**

배포 직전까지 `id` 컬럼이 비어 있던 기존 행 하나를 시트에서 골라, 앱을 로드한 뒤 시트를 새로고침해 그 행의 I열(`id`)이 채워졌는지 확인한다.

- [ ] **Step 3: CRUD 왕복 확인**

앱에서 미팅을 하나 추가 → 시트에 반영 확인 → 같은 미팅을 앱에서 수정(예: 컨택상황 변경) → 시트에 반영 확인, 이때 시트에서 직접 입력해 둔 C.P(F열) 값이 그대로인지 확인 → 앱에서 삭제 → 시트에서 행이 사라졌는지 확인.

- [ ] **Step 4: 에러 배너 확인**

`SHEETS_API_TOKEN`을 브라우저 콘솔에서 일시적으로 틀린 값으로 바꾸고(`SHEETS_API_TOKEN` 재할당은 `const`라 안 되므로, 대신 `index.html`을 임시로 복사해 잘못된 토큰으로 열어본다) "불러오지 못했어요" 에러 배너와 "다시 시도" 버튼이 뜨는지 확인한 뒤 원래 파일로 되돌린다.

- [ ] **Step 5: 거래처(clients) 기존 동작 회귀 확인**

거래처 추가/수정/삭제가 여전히 로컬에서 정상 동작하는지, 새로고침해도 거래처 데이터가 유지되는지 확인한다(미팅과 달리 거래처는 여전히 `localStorage` 기반).

- [ ] **Step 6: 최종 커밋 여부 확인**

```bash
git status
git log --oneline -8
```

모든 태스크의 커밋이 순서대로 있는지 확인한다. 이 태스크 자체는 코드 변경이 없으므로 커밋할 것은 없다.
