import React,{useEffect,useMemo,useState} from 'react';
import {supabase} from './lib/supabase';

const STAGES=[['group','조별리그'],['r16','16강'],['qf','8강'],['sf','4강'],['final','결승'],['third','3·4위전']];
const STAGE_LABEL=Object.fromEntries(STAGES);
const letters=n=>Array.from({length:n},(_,i)=>String.fromCharCode(65+i));
const STAGES_FOR=n=>STAGES.filter(([stage])=>stage==='group'||stage==='final'||(stage==='third'&&n>=4)||(stage==='r16'&&n>=16)||(stage==='qf'&&n>=8)||(stage==='sf'&&n>=4));
const PLAYOFF_LABEL=n=>Number(n)===2?'결승':`${n}강`;
const empty={is_admin:false,events:[],divisions:[],entrants:[],pairs:[],matches:[],changes:[]};
function eventStatus(status){return status==='completed'?'종료':status==='live'?'진행중':'준비중'}
function standingsFor(groupPairs,matches){
 const obj=Object.fromEntries(groupPairs.map(p=>[p.id,{...p,played:0,wins:0,losses:0,for:0,against:0}]));
 for(const m of matches){
  if(m.winner==null||!obj[m.pair_a_id]||!obj[m.pair_b_id])continue;
  const a=obj[m.pair_a_id],b=obj[m.pair_b_id];
  a.played++;b.played++;
  a.for+=Number(m.score_a);a.against+=Number(m.score_b);
  b.for+=Number(m.score_b);b.against+=Number(m.score_a);
  if(m.winner==='A'){a.wins++;b.losses++}else{b.wins++;a.losses++}
 }
 return Object.values(obj).sort((a,b)=>b.wins-a.wins||(b.for-b.against)-(a.for-a.against)||b.for-a.for);
}
function OpenScoreRow({match,pairLabel,onAct,disable}){
 const[a,setA]=useState(match.score_a??'');const[b,setB]=useState(match.score_b??'');
 useEffect(()=>{setA(match.score_a??'');setB(match.score_b??'')},[match.score_a,match.score_b]);
 const finalized=match.rating_applied;
 return <div className="openScoreRow">
  <div><b>{STAGE_LABEL[match.stage]}{match.group_code?` · ${match.group_code}조`:''}</b><small>경기 #{match.match_order}{match.court_no?` · 코트 ${match.court_no}`:''}</small></div>
  <strong>{pairLabel(match.pair_a_id)}</strong>
  <div className="openScoreInputs"><input type="number" min="0" value={a} disabled={finalized||disable} onChange={e=>setA(e.target.value)}/><span>:</span><input type="number" min="0" value={b} disabled={finalized||disable} onChange={e=>setB(e.target.value)}/></div>
  <strong>{pairLabel(match.pair_b_id)}</strong>
  <div className="openScoreActions">{finalized?<span className="openOK">AKTR 반영 ✓</span>:<>
    <button disabled={disable} onClick={()=>onAct('score_set',{match_id:match.id,score_a:a,score_b:b})}>점수 저장</button>
    {match.winner&&<button disabled={disable} onClick={()=>onAct('score_set',{match_id:match.id,score_a:null,score_b:null})}>초기화</button>}
    {match.winner&&<button className="primary" disabled={disable} onClick={()=>{
      if(window.confirm('이 경기의 결과를 연합회 회원 AKTR에 실제 반영합니다.\n취소할 수 없고, 과거 날짜로 되돌려 계산하지 않습니다. 계속할까요?'))onAct('match_finalize',{match_id:match.id});
    }}>AKTR 확정</button>}
    <button className="danger" disabled={disable} onClick={()=>{if(window.confirm('이 경기를 삭제할까요?'))onAct('match_remove',{match_id:match.id})}}>삭제</button>
  </>}</div>
 </div>
}

const blankTeamPlayer=()=>({kind:'member',member_id:'',guest_name:'',entrant_id:''});
function OpenPairPlayerInput({index,value,other,roster,entrants,assignedIds,search,onSearch,onChange,disabled}){
 const available=roster.filter(p=>
  !entrants.some(e=>e.member_id===p.id&&assignedIds.has(e.id)) &&
  !(other.kind==='member'&&other.member_id===p.id) &&
  String(p.name||'').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
 ).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'ko'));
 const unpaired=entrants.filter(e=>!assignedIds.has(e.id)&&
  !(other.kind==='existing'&&other.entrant_id===e.id));
 return <div className="openPairPlayerPanel">
  <div className="openPairPlayerHead"><strong>선수 {index+1}</strong><span>복식 파트너 고정</span></div>
  <label>선수 유형
   <select disabled={disabled} value={value.kind} onChange={e=>{onChange(blankTeamPlayer().kind===e.target.value?blankTeamPlayer():{...blankTeamPlayer(),kind:e.target.value});onSearch('')}}>
    <option value="member">연합회 AKTR 회원</option><option value="guest">비회원 (이름 입력)</option>
    {unpaired.length>0&&<option value="existing">이미 등록된 미배정 선수</option>}
   </select>
  </label>
  {value.kind==='member'?<>
   <label>이름 검색<input type="search" autoComplete="off" placeholder="회원 이름 검색" value={search} disabled={disabled} onChange={e=>{onSearch(e.target.value);onChange({...value,member_id:''})}}/></label>
   <label>연합회원 선택 <small>{available.length}명</small>
    <select value={value.member_id} disabled={disabled||available.length===0} required onChange={e=>onChange({...value,member_id:e.target.value})}>
     <option value="">{available.length?'회원 선택':'일치하는 회원 없음'}</option>
     {available.map(p=><option key={p.id} value={p.id}>{p.name} · AKTR {p.rating}</option>)}
    </select>
   </label>
  </>:value.kind==='guest'?<label>비회원 이름<input required maxLength="100" placeholder="참가 선수 이름" value={value.guest_name} disabled={disabled} onChange={e=>onChange({...value,guest_name:e.target.value})}/></label>
  :<label>기존 미배정 선수 선택<select required value={value.entrant_id} disabled={disabled} onChange={e=>onChange({...value,entrant_id:e.target.value})}>
   <option value="">선택</option>{unpaired.map(e=><option key={e.id} value={e.id}>{e.display_name} · {e.member_id?'연합회원':'비회원'}</option>)}
  </select></label>}
 </div>;
}

export default function OpenTournaments({admin,roster=[]}){
 const[state,setState]=useState(empty),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const[eventId,setEventId]=useState('77777777-7777-4777-8777-777777777777');
 const[divId,setDivId]=useState(''),[section,setSection]=useState('draw');
 const[teamForm,setTeamForm]=useState({group_code:'A',team_no:1,players:[blankTeamPlayer(),blankTeamPlayer()]});
 const[playerSearches,setPlayerSearches]=useState(['','']);
 const[editingPairId,setEditingPairId]=useState('');
 const[editPairForm,setEditPairForm]=useState({group_code:'A',team_no:1});
 const[matchForm,setMatchForm]=useState({stage:'group',group_code:'A',pair_a_id:'',pair_b_id:'',court_no:'',match_order:1});
 const[editEvent,setEditEvent]=useState(false),[createEvent,setCreateEvent]=useState(false);
 async function reload(){
  if(!supabase){setLoading(false);setError('Supabase 설정을 확인해 주세요.');return}
  const {data,error:dbError}=await supabase.rpc('mkta_open_state');
  if(dbError){setError('MKTA 대회 기능 DB 준비 필요: migration.sql을 먼저 적용하세요. ('+dbError.message+')');setLoading(false);return}
  setError('');setState({...empty,...(data||{})});setLoading(false);
 }
 useEffect(()=>{reload()},[admin]);
 const events=state.events||[],event=events.find(x=>x.id===eventId)||events[0],activeEventId=event?.id||'';
 const divisions=(state.divisions||[]).filter(d=>d.event_id===activeEventId);
 const division=divisions.find(d=>d.id===divId)||divisions[0];
 const entrants=(state.entrants||[]).filter(e=>e.division_id===division?.id);
 const pairs=(state.pairs||[]).filter(p=>p.division_id===division?.id);
 const matches=(state.matches||[]).filter(m=>m.division_id===division?.id);
 const entrantMap=useMemo(()=>Object.fromEntries((state.entrants||[]).map(e=>[e.id,e])),[state.entrants]);
 const pairMap=useMemo(()=>Object.fromEntries((state.pairs||[]).map(p=>[p.id,p])),[state.pairs]);
 const pairName=id=>{
  const p=pairMap[id];return p?[entrantMap[p.entrant_a_id]?.display_name,entrantMap[p.entrant_b_id]?.display_name].filter(Boolean).join(' / '):'미지정';
 };
 const pairLabel=id=>{const p=pairMap[id];return p?`${p.group_code}조 ${p.team_no??'?'}팀 · ${pairName(id)}`:'미지정';};
 const assignedIds=new Set(pairs.flatMap(p=>[p.entrant_a_id,p.entrant_b_id]));
 const unpairedEntrants=entrants.filter(e=>!assignedIds.has(e.id));
 const nextTeamNo=code=>Math.max(0,...pairs.filter(p=>p.group_code===code).map(p=>Number(p.team_no)||0))+1;
 const allMatches=(state.matches||[]).filter(m=>divisions.some(d=>d.id===m.division_id));
 const overallScored=allMatches.filter(m=>m.winner).length;
 const overallFinal=allMatches.filter(m=>m.rating_applied).length;
 async function act(action,data){
  if(busy)return;
  setBusy(true);setError('');
  const {data:resp,error:e}=await supabase.rpc('mkta_open_mutate',{p_action:action,p_data:data});
  if(e){setError(e.message);window.alert('저장 실패: '+e.message)}
  else {await reload();if(action==='freeze_seeds')window.alert(`비회원 임시 AKTR 확정: ${resp?.guest_seed}점`)}
  setBusy(false);return !e;
 }
 const adminMode=admin&&state.is_admin;
 const groupNames=letters(division?.group_count||1);
 const stages=STAGES_FOR(division?.playoff_start||8);
 const groupPairs=code=>pairs.filter(p=>p.group_code===code).sort((a,b)=>(Number(a.team_no)||999)-(Number(b.team_no)||999));
 const matchGroups=code=>matches.filter(m=>m.stage==='group'&&m.group_code===code);
 const groupStanding=code=>standingsFor(groupPairs(code),matchGroups(code));
 const bracketMatches=matches.filter(m=>m.stage!=='group').sort((a,b)=>STAGES.findIndex(t=>t[0]===a.stage)-STAGES.findIndex(t=>t[0]===b.stage)||a.match_order-b.match_order);
 const divisionCounts=d=>({
  entrants:(state.entrants||[]).filter(e=>e.division_id===d.id).length,
  pairs:(state.pairs||[]).filter(p=>p.division_id===d.id).length,
  matches:(state.matches||[]).filter(m=>m.division_id===d.id).length,
  applied:(state.matches||[]).filter(m=>m.division_id===d.id&&m.rating_applied).length
 });
 async function removeDivision(d){
  if(!adminMode||busy)return;
  const counts=divisionCounts(d);
  if(counts.entrants||counts.pairs||counts.matches){
   const detail=`참가자 ${counts.entrants}명, 복식 팀 ${counts.pairs}팀, 경기 ${counts.matches}개`;
   window.alert(`'${d.name}' 부서를 삭제할 수 없습니다.\n현재 등록된 데이터: ${detail}\n\n경기 → 복식 팀 → 참가자 순서로 먼저 정리해 주세요.${counts.applied?'\nAKTR 확정 경기가 있어 관련 경기 기록은 삭제할 수 없습니다.':''}`);
   return;
  }
  if(!window.confirm(`'${event.name}' 대회의 '${d.name}' 부서를 삭제할까요?\n\n삭제한 부서는 되돌릴 수 없습니다.`))return;
  setBusy(true);setError('');
  try{
   const {error:dbError}=await supabase.rpc('mkta_open_division_remove',{p_division_id:d.id});
   if(dbError)throw dbError;
   setDivId(current=>current===d.id?'':current);
   setSection('draw');
   setTeamForm({group_code:'A',team_no:1,players:[blankTeamPlayer(),blankTeamPlayer()]});
   setMatchForm({stage:'group',group_code:'A',pair_a_id:'',pair_b_id:'',court_no:'',match_order:1});
   await reload();
  }catch(err){
   const message=err?.message||'부서 삭제 중 오류가 발생했습니다.';
   setError(message);window.alert('부서 삭제 실패: '+message);
  }finally{setBusy(false)}
 }
 function updateTeamPlayer(index,next){
  setTeamForm(prev=>({...prev,players:prev.players.map((p,i)=>index===i?next:p)}));
 }
 async function rpcPair(name,payload){
  if(busy)return false;
  setBusy(true);setError('');
  try{
   const {error:e}=await supabase.rpc(name,payload);
   if(e)throw e;
   await reload();return true;
  }catch(e){setError(e.message);window.alert('저장 실패: '+e.message);return false}
  finally{setBusy(false)}
 }
 async function registerTeam(e){
  e.preventDefault();
  const players=teamForm.players.map(p=>p.kind==='member'?{kind:'member',member_id:p.member_id}:
   p.kind==='existing'?{kind:'existing',entrant_id:p.entrant_id}:{kind:'guest',guest_name:p.guest_name.trim()});
  if(players.some(p=>Object.values(p).some(v=>!v))){window.alert('두 선수의 정보를 모두 선택하거나 입력하세요.');return}
  if(players[0].kind==='member'&&players[1].kind==='member'&&players[0].member_id===players[1].member_id){window.alert('같은 선수를 두 번 등록할 수 없습니다.');return}
  const number=Number(teamForm.team_no);
  if(!Number.isInteger(number)||number<1||number>999){window.alert('팀 번호는 1~999 사이여야 합니다.');return}
  const ok=await rpcPair('mkta_open_pair_register',{
   p_division_id:division.id,p_group_code:teamForm.group_code,p_team_no:number,p_players:players
  });
  if(ok){setTeamForm(v=>({...v,team_no:number+1,players:[blankTeamPlayer(),blankTeamPlayer()]}));setPlayerSearches(['',''])}
 }
 async function savePairLabel(e){
  e.preventDefault();
  if(!editingPairId)return;
  const ok=await rpcPair('mkta_open_pair_relabel',{p_pair_id:editingPairId,p_group_code:editPairForm.group_code,p_team_no:Number(editPairForm.team_no)});
  if(ok)setEditingPairId('');
 }
 async function submitForm(e,action,payload){e.preventDefault();return act(action,payload)}
 return <div className="openTournamentRoot">
  <section className="openEventHero">
   <div><span>MKTA · TOURNAMENTS</span><h1>연합회 공식 대회</h1><p>클럽대항전뿐 아니라 모든 참가자가 출전하는 복식대회를 운영하고 기록합니다.</p></div>
   <div className="openEventSelector"><label>대회 선택<select value={activeEventId} onChange={e=>{setEventId(e.target.value);setDivId('');setSection('draw');setPlayerSearches(['','']);setTeamForm({group_code:'A',team_no:1,players:[blankTeamPlayer(),blankTeamPlayer()]})}}>{events.map(ev=><option key={ev.id} value={ev.id}>{ev.name}</option>)}</select></label>{adminMode&&<button onClick={()=>setCreateEvent(v=>!v)}>새 대회</button>}</div>
  </section>
  {error&&<div className="openError">{error}</div>}
  {loading?<section className="panel">대회 정보를 불러오는 중...</section>:<>
  {createEvent&&adminMode&&<form className="panel openInlineForm" onSubmit={e=>{const f=new FormData(e.currentTarget);submitForm(e,'event_upsert',{name:f.get('name'),event_date:f.get('event_date'),venue:f.get('venue'),rating_multiplier:1}).then(ok=>ok&&setCreateEvent(false))}}>
   <h3>새 대회 만들기</h3><input name="name" placeholder="대회명" required/><input name="event_date" type="date"/><input name="venue" placeholder="장소"/><button className="primary" disabled={busy}>생성</button>
  </form>}
  {!event?<section className="panel">공개된 대회가 없습니다.</section>:<>
   <section className="panel openEventSummary">
    <div><span className="openEyebrow">OFFICIAL DOUBLES TOURNAMENT</span><h2>{event.name}</h2><p>{event.event_date||'대회 날짜 미등록'} · {event.venue||'장소 미등록'} · {eventStatus(event.status)} · AKTR ×{Number(event.rating_multiplier).toFixed(2)}</p></div>
    <div className="openEventCounts"><div><strong>{divisions.length}</strong><small>출전 부서</small></div><div><strong>{allMatches.length}</strong><small>전체 경기</small></div><div><strong>{overallScored}</strong><small>결과 입력</small></div><div><strong>{overallFinal}</strong><small>AKTR 확정</small></div></div>
   </section>
   {adminMode&&<section className="panel openAdminBar">
    <div><b>관리자 · 대회 설정</b><p>기존 클럽대항전과 별개로 운영합니다. 실제 AKTR 반영은 경기마다 별도 확정합니다.</p></div>
    <div className="openBarActions">
     <button onClick={()=>setEditEvent(v=>!v)}>{editEvent?'설정 닫기':'대회 정보 수정'}</button>
     <button onClick={()=>act('event_publish',{event_id:event.id,published:!event.published})}>{event.published?'대회 비공개':'대회 공개'}</button>
     <select aria-label="대회 상태" value={event.status} onChange={e=>act('event_status',{event_id:event.id,status:e.target.value})}><option value="draft">준비중</option><option value="live">진행중 (AKTR 확정 가능)</option><option value="completed">종료</option></select>
    </div>
    {editEvent&&<form className="openInlineForm" onSubmit={e=>{const f=new FormData(e.currentTarget);submitForm(e,'event_upsert',{id:event.id,name:f.get('name'),event_date:f.get('event_date'),venue:f.get('venue'),rating_multiplier:Number(f.get('rating_multiplier'))}).then(ok=>ok&&setEditEvent(false))}}>
     <label>대회명<input name="name" defaultValue={event.name} required/></label><label>날짜<input name="event_date" type="date" defaultValue={event.event_date||''}/></label><label>장소<input name="venue" defaultValue={event.venue||''}/></label><label>AKTR 배율<input name="rating_multiplier" type="number" min="1" max="2" step="0.25" defaultValue={event.rating_multiplier}/></label><button className="primary" disabled={busy}>저장</button>
    </form>}
   </section>}
   {adminMode&&<section className="panel"><div className="panelHead"><h2>부서 관리</h2><small>대회마다 여러 부서를 자유롭게 등록할 수 있습니다.</small></div>
    <div className="openDivisionManageList">{divisions.map(d=><div className="openDivisionManageItem" key={d.id}><span className="openDivisionPill">{d.name}</span><button type="button" className="openDivisionRemove" disabled={busy} aria-label={`${d.name} 부서 삭제`} title="등록된 참가자·팀·경기가 없는 부서만 삭제할 수 있습니다." onClick={()=>removeDivision(d)}>삭제</button></div>)}</div>
    <form className="openInlineForm" onSubmit={e=>{const f=new FormData(e.currentTarget);submitForm(e,'division_add',{event_id:event.id,name:f.get('name'),code:f.get('code'),display_order:divisions.length+1})}}><input name="name" required placeholder="새 부서명"/><input name="code" required placeholder="부서 코드(예: mixed)"/><button className="primary" disabled={busy}>부서 추가</button></form>
   </section>}
   <div className="openDivisionTabs">{divisions.map(d=><button key={d.id} className={d.id===division?.id?'active':''} onClick={()=>{setDivId(d.id);setSection('draw');setPlayerSearches(['','']);setTeamForm({group_code:'A',team_no:1,players:[blankTeamPlayer(),blankTeamPlayer()]});setMatchForm({stage:'group',group_code:'A',pair_a_id:'',pair_b_id:'',court_no:'',match_order:1})}}>{d.name}</button>)}</div>
   {division&&<>
    <section className="panel openDivisionInfo">
     <div><span className="openEyebrow">{division.name}</span><h2>{division.group_count}개 조 · 본선 {PLAYOFF_LABEL(division.playoff_start)}부터</h2><p>참가 {entrants.length}명 / 복식 {pairs.length}팀 · {division.seed_locked?`비회원 임시 AKTR ${division.guest_seed}점 확정`:'비회원 임시 AKTR 확정 전'}</p></div>
     <div className="openSubtabs">{[['draw','조별리그·순위'],['bracket','본선 대진'],['people','참가 선수·팀'],...(adminMode?[['manage','대회 입력']]:[])].map(([id,name])=><button className={section===id?'active':''} onClick={()=>setSection(id)} key={id}>{name}</button>)}</div>
    </section>
    {section==='draw'&&<div className="openGroupGrid">{groupNames.map(g=>{
     const rows=groupStanding(g),gMatches=matchGroups(g);
     return <section className="panel" key={g}><div className="panelHead"><h2>{g}조</h2><small>승수 → 득실차 → 득점 순</small></div>
      {rows.length?<div className="openStandings"><div className="openStandingRow head"><span>#</span><span>복식 팀</span><span>경기</span><span>승</span><span>패</span><span>득실차</span></div>{rows.map((r,i)=><div className="openStandingRow" key={r.id}><b>{i+1}</b><strong>{pairLabel(r.id)}</strong><span>{r.played}</span><span>{r.wins}</span><span>{r.losses}</span><span>{r.for-r.against>=0?'+':''}{r.for-r.against}</span></div>)}</div>:<p className="openEmpty">아직 이 조에 등록된 복식 팀이 없습니다.</p>}
      <div className="openMatchesMini">{gMatches.length===0?<small>경기 일정 미등록</small>:gMatches.map(m=><div key={m.id}><span>{pairLabel(m.pair_a_id)}</span><b>{m.score_a==null?'vs':`${m.score_a} : ${m.score_b}`}</b><span>{pairLabel(m.pair_b_id)}</span>{m.rating_applied&&<em>AKTR ✓</em>}</div>)}</div>
     </section>})}</div>}
    {section==='bracket'&&<section className="panel"><div className="panelHead"><div><h2>{division.name} 본선</h2><small>{PLAYOFF_LABEL(division.playoff_start)}부터 시작 · 기록된 경기만 표시</small></div></div>
     <div className="openBracketColumns">{stages.filter(([id])=>id!=='group').map(([key,label])=><div key={key} className="openBracketColumn"><h3>{label}</h3>{bracketMatches.filter(m=>m.stage===key).length===0?<div className="openEmpty">경기 미등록</div>:bracketMatches.filter(m=>m.stage===key).map(m=><article key={m.id}><small>Match {m.match_order}</small><div className={m.winner==='A'?'winner':''}>{pairLabel(m.pair_a_id)} <b>{m.score_a??'–'}</b></div><div className={m.winner==='B'?'winner':''}>{pairLabel(m.pair_b_id)} <b>{m.score_b??'–'}</b></div>{m.rating_applied&&<small>AKTR 반영 ✓</small>}</article>)}</div>)}</div>
    </section>}
    {section==='people'&&<section className="panel"><div className="panelHead"><h2>{division.name} 출전 선수 · 복식 팀</h2></div>
     <div className="openTeamsGrid">{groupNames.map(g=><div key={g}><h3>{g}조</h3>{groupPairs(g).length===0?<p className="openEmpty">등록된 팀 없음</p>:groupPairs(g).map(p=><article className="openPairCard" key={p.id}><strong>{pairLabel(p.id)}</strong><small>{[p.entrant_a_id,p.entrant_b_id].map(id=>{const e=entrantMap[id];return e?.member_id?`연합회원 AKTR ${e?.seed_rating??'미확정'}`:`비회원 임시 AKTR ${e?.seed_rating??'미확정'}`}).join(' · ')}</small></article>)}</div>)}</div>
    </section>}
    {section==='manage'&&adminMode&&<>
     <section className="panel"><div className="panelHead"><h2>① 부서 운영 설정</h2><small>각 부서별 독립 설정</small></div>
      <form className="openInlineForm" key={division.id} onSubmit={e=>{const f=new FormData(e.currentTarget);submitForm(e,'division_config',{division_id:division.id,group_count:Number(f.get('group_count')),playoff_start:Number(f.get('playoff_start'))})}}><label>조 개수<select name="group_count" defaultValue={division.group_count}>{Array.from({length:8},(_,i)=>i+1).map(n=><option value={n} key={n}>{letters(n).join(' · ')}조 ({n}개)</option>)}</select></label><label>본선 시작<select name="playoff_start" defaultValue={division.playoff_start}>{[16,8,4,2].map(n=><option key={n} value={n}>{PLAYOFF_LABEL(n)}</option>)}</select></label><button className="primary" disabled={busy}>부서 설정 저장</button></form>
     </section>
     <section className="panel"><div className="panelHead"><h2>② 복식팀 참가자 등록 · 조 및 팀 번호</h2><small>한 팀에 선수 2명 등록 · 조별리그부터 본선까지 파트너 고정</small></div>
      <form className="openPairRegistration" onSubmit={registerTeam}>
       <div className="openPairPlacement">
        <label>조 선택
         <select value={groupNames.includes(teamForm.group_code)?teamForm.group_code:'A'} disabled={division.seed_locked||busy} onChange={e=>setTeamForm(v=>({...v,group_code:e.target.value,team_no:nextTeamNo(e.target.value)}))}>
          {groupNames.map(g=><option key={g} value={g}>{g}조</option>)}
         </select>
        </label>
        <label>팀 번호<input type="number" min="1" max="999" required disabled={division.seed_locked||busy} value={teamForm.team_no} onChange={e=>setTeamForm(v=>({...v,team_no:e.target.value}))}/></label>
        <strong>{groupNames.includes(teamForm.group_code)?teamForm.group_code:'A'}조 {teamForm.team_no||'?'}팀</strong>
       </div>
       <div className="openPairRegistrationPlayers">
        {teamForm.players.map((player,index)=><OpenPairPlayerInput key={index} index={index} value={player} other={teamForm.players[1-index]} roster={roster} entrants={entrants} assignedIds={assignedIds} search={playerSearches[index]} disabled={division.seed_locked||busy} onSearch={value=>setPlayerSearches(prev=>prev.map((v,i)=>i===index?value:v))} onChange={value=>updateTeamPlayer(index,value)}/>)}
       </div>
       <div className="openPairRegisterActions"><p>같은 부서의 한 선수는 한 복식팀에만 속할 수 있습니다. 팀을 등록하면 파트너가 고정되며 본선에서도 그대로 사용됩니다. 조별리그 대진은 별도로 직접 등록합니다.</p><button className="primary" disabled={division.seed_locked||busy}>복식팀 등록</button></div>
      </form>
      <div className="openSeedControl"><p>비회원의 임시 AKTR은 <strong>이 부서 출전 연합회원의 현재 AKTR 평균</strong>으로 계산됩니다. 참가팀 구성이 확정된 뒤 잠그세요. 확정 후에는 선수·팀을 추가하거나 조/팀 번호를 수정할 수 없습니다.</p><button className="primary" disabled={division.seed_locked||busy||!entrants.some(e=>e.member_id)} onClick={()=>{if(window.confirm('이 부서 참가 명단을 확정하면 팀을 더 추가할 수 없습니다. 모든 복식팀을 등록했나요?'))act('freeze_seeds',{division_id:division.id})}}>{division.seed_locked?`비회원 임시 AKTR ${division.guest_seed}점 확정됨`:'비회원 임시 AKTR 확정'}</button></div>
     </section>
     <section className="panel"><div className="panelHead"><h2>③ 등록된 복식팀 · 고정 파트너 확인</h2><small>팀별 배정 변경은 경기 등록 전만 가능 · 선수 조합은 변경되지 않음</small></div>
      <div className="openEntrantList">{pairs.slice().sort((a,b)=>a.group_code.localeCompare(b.group_code)||(Number(a.team_no)||999)-(Number(b.team_no)||999)).map(p=><div key={p.id} className="openTeamEntryRow">
       <span><strong>{pairLabel(p.id)}</strong><small>파트너 고정 · {matches.some(m=>m.pair_a_id===p.id||m.pair_b_id===p.id)?'경기 등록됨':'경기 등록 전'}</small></span>
       <div className="openTeamEntryActions">
        <button disabled={busy||division.seed_locked||matches.some(m=>m.pair_a_id===p.id||m.pair_b_id===p.id)} onClick={()=>{setEditingPairId(p.id);setEditPairForm({group_code:p.group_code,team_no:p.team_no??nextTeamNo(p.group_code)})}}>조·번호 수정</button>
        <button disabled={busy||division.seed_locked} onClick={()=>{if(window.confirm(`${pairLabel(p.id)} 팀을 해체할까요? 경기 기록이 있으면 삭제되지 않습니다. 등록 선수는 남아 재배정할 수 있습니다.`))act('pair_remove',{pair_id:p.id})}}>팀 삭제</button>
       </div>
       {editingPairId===p.id&&<form className="openTeamEditForm" onSubmit={savePairLabel}>
        <label>조<select value={editPairForm.group_code} onChange={e=>setEditPairForm(v=>({...v,group_code:e.target.value,team_no:nextTeamNo(e.target.value)}))}>{groupNames.map(g=><option key={g} value={g}>{g}조</option>)}</select></label>
        <label>팀 번호<input type="number" min="1" max="999" required value={editPairForm.team_no} onChange={e=>setEditPairForm(v=>({...v,team_no:e.target.value}))}/></label>
        <button className="primary" disabled={busy||division.seed_locked}>저장</button><button type="button" onClick={()=>setEditingPairId('')}>취소</button>
       </form>}
      </div>)}</div>
      {unpairedEntrants.length>0&&<div className="openUnpairedPanel"><h3>아직 팀에 배정되지 않은 선수 ({unpairedEntrants.length}명)</h3><p>등록 창의 선수 유형에서 ‘이미 등록된 미배정 선수’를 선택해 복식팀에 넣을 수 있습니다. 필요 없으면 여기서 삭제하세요.</p>
       <div className="openEntrantList">{unpairedEntrants.map(e=><div key={e.id}><span><strong>{e.display_name}</strong><small>{e.member_id?'연합회원':'비회원'}</small></span><button disabled={busy||division.seed_locked} onClick={()=>{if(window.confirm('미배정 선수를 삭제할까요?'))act('entrant_remove',{entrant_id:e.id})}}>삭제</button></div>)}</div>
      </div>}
     </section>
     <section className="panel"><div className="panelHead"><h2>④ 조별리그 · 본선 경기 등록</h2><small>{Number(division.playoff_start)===2?'조별리그 종료 후 결승 1경기만 수동 등록':'본선은 설정한 단계부터 수동 등록'}</small></div>
      <form className="openInlineForm" onSubmit={e=>{e.preventDefault();act('match_add',{division_id:division.id,...matchForm,court_no:matchForm.court_no||null,match_order:Number(matchForm.match_order)}).then(ok=>ok&&setMatchForm({...matchForm,pair_a_id:'',pair_b_id:''}))}}>
       <label>구분<select value={matchForm.stage} onChange={e=>setMatchForm({...matchForm,stage:e.target.value,pair_a_id:'',pair_b_id:''})}>{stages.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
       {matchForm.stage==='group'&&<label>조<select value={matchForm.group_code} onChange={e=>setMatchForm({...matchForm,group_code:e.target.value,pair_a_id:'',pair_b_id:''})}>{groupNames.map(g=><option key={g} value={g}>{g}조</option>)}</select></label>}
       {['pair_a_id','pair_b_id'].map((field,i)=><label key={field}>팀 {i+1}<select value={matchForm[field]} required onChange={e=>setMatchForm({...matchForm,[field]:e.target.value})}><option value="">선택</option>{pairs.filter(p=>matchForm.stage!=='group'||p.group_code===matchForm.group_code).map(p=><option value={p.id} key={p.id}>{pairLabel(p.id)}</option>)}</select></label>)}
       <label>경기 번호<input type="number" min="1" value={matchForm.match_order} onChange={e=>setMatchForm({...matchForm,match_order:e.target.value})}/></label>
       <label>코트(선택)<input type="number" min="1" value={matchForm.court_no} onChange={e=>setMatchForm({...matchForm,court_no:e.target.value})}/></label>
       <button className="primary" disabled={busy}>경기 추가</button>
      </form>
     </section>
     <section className="panel"><div className="panelHead"><h2>⑤ 스코어 및 AKTR 확정</h2><small>과거 경기 결과 입력 순서에 따라 현재 AKTR이 달라질 수 있습니다</small></div>
      {matches.length===0?<p className="openEmpty">등록된 경기가 없습니다.</p>:matches.slice().sort((a,b)=>STAGES.findIndex(s=>s[0]===a.stage)-STAGES.findIndex(s=>s[0]===b.stage)||a.match_order-b.match_order).map(m=><OpenScoreRow key={m.id} match={m} pairLabel={pairLabel} onAct={act} disable={busy}/>)}
     </section>
    </>}
   </>}
  </>}
  </>}
 </div>;
}
