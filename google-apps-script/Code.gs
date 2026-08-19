const SHEET_NAME='IP사업부문 영업 현황';
const COLS={date:1, div:2, client:3, artist:4, mdate:5, cp:6, status:7, log:8, followup:9, id:10};

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
  const v=sheet.getRange(row,1,1,10).getValues()[0];
  return { id:String(v[9]||''), div:String(v[1]||''), client:String(v[2]||''), artist:String(v[3]||''), mdateISO:dateCellToISO_(v[4]), cp:String(v[5]||''), status:String(v[6]||''), log:String(v[7]||''), followup:String(v[8]||''), weekISO:dateCellToISO_(v[0]) };
}
function findRowById_(sheet,id){
  const last=sheet.getLastRow();
  if(last<2) return -1;
  const ids=sheet.getRange(2,COLS.id,last-1,1).getValues();
  for(let i=0;i<ids.length;i++){ if(String(ids[i][0]).trim()===String(id)) return i+2; }
  return -1;
}
function listMeetings_(){
  return withLock_(()=>{
    const sheet=getSheet_();
    const last=sheet.getLastRow();
    if(last<2) return [];
    const values=sheet.getRange(2,1,last-1,10).getValues();
    const out=[];
    values.forEach((v,i)=>{
      const row=i+2;
      let id=String(v[9]||'').trim();
      if(!id){ id=Utilities.getUuid(); sheet.getRange(row,COLS.id).setValue(id); }
      out.push({ id, div:String(v[1]||''), client:String(v[2]||''), artist:String(v[3]||''), mdateISO:dateCellToISO_(v[4]), cp:String(v[5]||''), status:String(v[6]||''), log:String(v[7]||''), followup:String(v[8]||''), weekISO:dateCellToISO_(v[0]) });
    });
    return out;
  });
}
function createMeeting_(data){
  const sheet=getSheet_();
  const id=Utilities.getUuid();
  const mdate=toDateObj_(data.mdateISO);
  sheet.appendRow(['', data.div||'', data.client||'', data.artist||'', mdate||'', data.cp||'', data.status||'', data.log||'', data.followup||'', id]);
  return rowToMeeting_(sheet, findRowById_(sheet, id));
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
  if(has('followup')) sheet.getRange(row,COLS.followup).setValue(data.followup||'');
  if(has('mdateISO') && data.mdateISO){
    sheet.getRange(row,COLS.mdate).setValue(toDateObj_(data.mdateISO)||'');
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
