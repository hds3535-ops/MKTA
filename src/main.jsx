import React,{useEffect,useMemo,useState}from"react";
import{createRoot}from"react-dom/client";
import{supabase,supabaseConfigStatus}from"./lib/supabase";
import"./styles.css";

const EVENT_ID="66666666-6666-4666-8666-666666666666";
const CLUB_IDS={
  OCTC:"11111111-1111-4111-8111-111111111111",
  MKTC:"22222222-2222-4222-8222-222222222222",
  VKTC:"33333333-3333-4333-8333-333333333333",
  WKTC:"44444444-4444-4444-8444-444444444444"
};

function timeText(v){return String(v||"").slice(0,5)}
function statusText(v){return v==="live"?"진행중":v==="completed"?"종료":"준비중"}
function deltaText(v){const n=Number(v||0);return `${n>=0?"+":""}${n}`}
function ClubBadges({clubs=[]}){return <span className="clubChips">{clubs.map(c=><em key={c} className={`clubChip ${String(c).toLowerCase()}`}>{c}</em>)}</span>}
function byStanding(a,b){
  if(Number(b.points)!==Number(a.points))return Number(b.points)-Number(a.points);
  if(Number(b.games_for)!==Number(a.games_for))return Number(b.games_for)-Number(a.games_for);
  return Number(b.wins)-Number(a.wins);
}

function App(){
  const[event,setEvent]=useState(null);
  const[teams,setTeams]=useState([]);
  const[teamClubs,setTeamClubs]=useState([]);
  const[divisions,setDivisions]=useState([]);
  const[matches,setMatches]=useState([]);
  const[players,setPlayers]=useState([]);
  const[roster,setRoster]=useState([]);
  const[rankingRoster,setRankingRoster]=useState([]);
  const[hiddenRankingIds,setHiddenRankingIds]=useState([]);
  const[rankingAdminSearch,setRankingAdminSearch]=useState("");
  const[standings,setStandings]=useState([]);
  const[divisionStandings,setDivisionStandings]=useState([]);
  const[ratingChanges,setRatingChanges]=useState([]);
  const[tab,setTabState]=useState(()=>{
    const hash=String(window.location.hash||"").replace(/^#/,"");
    return ["home","ranking","schedule","standings","teams","scores","admin","profile"].includes(hash)?hash:"home";
  });
  const[round,setRound]=useState(1);
  const[divisionFilter,setDivisionFilter]=useState("ALL");
  const[user,setUser]=useState(null);
  const[authReady,setAuthReady]=useState(false);
  const[admin,setAdmin]=useState(false);
  const[adminAccess,setAdminAccess]=useState(null);
  const[adminPasswordForm,setAdminPasswordForm]=useState({current:"",next:"",confirm:""});
  const[adminPasswordBusy,setAdminPasswordBusy]=useState(false);
  const[adminPasswordError,setAdminPasswordError]=useState("");
  const[loginOpen,setLoginOpen]=useState(false);
  const[loginBusy,setLoginBusy]=useState(false);
  const[loginError,setLoginError]=useState("");
  const[loginForm,setLoginForm]=useState({email:"",password:""});
  const[scoreInputs,setScoreInputs]=useState({});
  const[flash,setFlash]=useState("");
  const[busy,setBusy]=useState(false);
  const[profileMemberId,setProfileMemberId]=useState(null);
  const[playerHistory,setPlayerHistory]=useState([]);
  const[profileBusy,setProfileBusy]=useState(false);
  const[profileFilter,setProfileFilter]=useState("ALL");

  function setTab(nextTab,{replace=false,state={}}={}){
    const safeTab=["home","ranking","schedule","standings","teams","scores","admin","profile"].includes(nextTab)?nextTab:"home";
    setTabState(safeTab);

    const url=safeTab==="home"
      ? `${window.location.pathname}${window.location.search}`
      : `${window.location.pathname}${window.location.search}#${safeTab}`;

    const payload={mkta:true,tab:safeTab,...state};

    if(replace)window.history.replaceState(payload,"",url);
    else window.history.pushState(payload,"",url);
  }

  useEffect(()=>{
    const initialHash=String(window.location.hash||"").replace(/^#/,"");
    const initialTab=["home","ranking","schedule","standings","teams","scores","admin","profile"].includes(initialHash)?initialHash:"home";
    window.history.replaceState({mkta:true,tab:initialTab},"",window.location.href);

    const onPopState=(event)=>{
      const hash=String(window.location.hash||"").replace(/^#/,"");
      const nextTab=event.state?.mkta&&event.state?.tab
        ?event.state.tab
        :(["home","ranking","schedule","standings","teams","scores","admin","profile"].includes(hash)?hash:"home");

      setTabState(nextTab);

      if(nextTab==="profile"&&event.state?.memberId){
        setProfileMemberId(event.state.memberId);
        setProfileFilter("ALL");
        if(supabase){
          setProfileBusy(true);
          supabase.rpc("mkta_player_match_history",{p_member_id:event.state.memberId}).then(({data,error})=>{
            if(error){
              console.error("통합 경기전적 불러오기 실패",error);
              setPlayerHistory([]);
            }else{
              setPlayerHistory(data||[]);
            }
            setProfileBusy(false);
          });
        }
      }else{
        setProfileMemberId(null);
        setPlayerHistory([]);
      }
    };

    window.addEventListener("popstate",onPopState);
    return()=>window.removeEventListener("popstate",onPopState);
  },[]);

  useEffect(()=>{
    if(!supabase){setAuthReady(true);return}
    supabase.auth.getSession().then(({data})=>{
      setUser(data?.session?.user||null);
      setAuthReady(true);
    });
    const{sub}=supabase.auth.onAuthStateChange((_event,session)=>setUser(session?.user||null));
    return()=>sub?.subscription?.unsubscribe?.();
  },[]);

  useEffect(()=>{
    if(!supabase||!authReady)return;
    if(!user){setAdmin(false);return}
    supabase.rpc("mkta_admin_access").then(({data,error})=>{
      if(error){console.error(error);setAdmin(false);setAdminAccess(null);return}
      setAdmin(!!data?.allowed);
      setAdminAccess(data||null);
      if(data?.allowed)loadRankingVisibilityAdmin();
    });
  },[authReady,user?.id]);

  useEffect(()=>{loadAll();loadRoster();loadIntegratedRanking()},[]);

  const teamMap=useMemo(()=>Object.fromEntries(teams.map(x=>[x.id,x])),[teams]);
  const divisionMap=useMemo(()=>Object.fromEntries(divisions.map(x=>[x.id,x])),[divisions]);
  const playerMap=useMemo(()=>Object.fromEntries(roster.map(x=>[x.id,x])),[roster]);
  const matchPlayers=useMemo(()=>{
    const out={};
    for(const p of players){
      out[p.match_id]??={A:{},B:{}};
      out[p.match_id][p.side][p.slot]=p.member_id;
    }
    return out;
  },[players]);

  const sourceClubs=useMemo(()=>{
    const out={};
    for(const x of teamClubs){
      out[x.event_team_id]??=[];
      out[x.event_team_id].push(x.club_id);
    }
    return out;
  },[teamClubs]);

  async function loadAll(){
    if(!supabase)return;
    setBusy(true);
    const[
      {data:e,error:eErr},
      {data:t,error:tErr},
      {data:tc,error:tcErr},
      {data:d,error:dErr},
      {data:m,error:mErr},
      {data:p,error:pErr},
      {data:s,error:sErr},
      {data:ds,error:dsErr},
      {data:rc,error:rcErr}
    ]=await Promise.all([
      supabase.from("mkta_events").select("*").eq("id",EVENT_ID).maybeSingle(),
      supabase.from("mkta_event_teams").select("*").eq("event_id",EVENT_ID).order("display_order"),
      supabase.from("mkta_event_team_clubs").select("*"),
      supabase.from("mkta_divisions").select("*").eq("event_id",EVENT_ID).order("display_order"),
      supabase.from("mkta_matches").select("*").eq("event_id",EVENT_ID).order("round_no").order("court_no"),
      supabase.from("mkta_match_players").select("*"),
      supabase.from("mkta_standings").select("*").eq("event_id",EVENT_ID),
      supabase.from("mkta_division_standings").select("*").eq("event_id",EVENT_ID),
      supabase.from("mkta_rating_changes").select("*").order("created_at",{ascending:false})
    ]);
    const err=eErr||tErr||tcErr||dErr||mErr||pErr||sErr||dsErr||rcErr;
    if(err)console.error(err);
    setEvent(e||null);setTeams(t||[]);setTeamClubs(tc||[]);setDivisions(d||[]);
    setMatches(m||[]);setPlayers(p||[]);setStandings(s||[]);setDivisionStandings(ds||[]);
    setRatingChanges(rc||[]);
    setScoreInputs(Object.fromEntries((m||[]).map(x=>[x.id,{a:x.score_a??"",b:x.score_b??""}])));
    setBusy(false);
  }

  async function loadRoster(){
    const{data,error}=await supabase
      .from("club_roster_directory")
      .select("*")
      .in("club_id",Object.values(CLUB_IDS))
      .eq("active",true)
      .order("rating",{ascending:false});
    if(error){console.error(error);return}
    const clubNames={[CLUB_IDS.OCTC]:"OCTC",[CLUB_IDS.MKTC]:"MKTC",[CLUB_IDS.VKTC]:"VKTC",[CLUB_IDS.WKTC]:"WKTC"};
    const byId={};
    for(const r of data||[]){
      if(!byId[r.id])byId[r.id]={...r,clubs:[]};
      byId[r.id].clubs.push(clubNames[r.club_id]||"");
      if(Number(r.rating)>Number(byId[r.id].rating))byId[r.id].rating=r.rating;
    }
    setRoster(Object.values(byId).sort((a,b)=>Number(b.rating||0)-Number(a.rating||0)||String(a.name||"").localeCompare(String(b.name||""))));
  }


  async function loadIntegratedRanking(){
    if(!supabase)return;
    const{data,error}=await supabase.rpc("mkta_integrated_ranking");
    if(error){
      console.error("통합 랭킹 불러오기 실패",error);
      setRankingRoster([]);
      return;
    }
    setRankingRoster((data||[]).map(x=>({
      id:x.id,
      name:x.name,
      rating:x.rating,
      clubs:Array.isArray(x.clubs)?x.clubs:[]
    })));
  }

  async function loadRankingVisibilityAdmin(){
    if(!supabase)return;
    const{data,error}=await supabase.rpc("mkta_ranking_hidden_ids");
    if(error){
      console.error("통합랭킹 숨김 목록 불러오기 실패",error);
      setHiddenRankingIds([]);
      return;
    }
    setHiddenRankingIds(Array.isArray(data)?data:[]);
  }

  async function setRankingHidden(memberId,hidden){
    if(!admin)return;
    const{error}=await supabase.rpc("mkta_set_ranking_hidden",{
      p_member_id:memberId,
      p_hidden:hidden
    });
    if(error){
      alert("통합랭킹 표시 설정 실패: "+error.message);
      return;
    }
    await Promise.all([loadIntegratedRanking(),loadRankingVisibilityAdmin()]);
    showFlash(hidden?"통합랭킹에서 숨겼습니다.":"통합랭킹에 다시 표시했습니다.");
  }

  async function openPlayerProfile(memberId){
    setProfileMemberId(memberId);
    setProfileFilter("ALL");
    setTab("profile",{state:{memberId,fromTab:tab}});
    if(!supabase)return;
    setProfileBusy(true);
    const{data,error}=await supabase.rpc("mkta_player_match_history",{p_member_id:memberId});
    if(error){
      console.error("통합 경기전적 불러오기 실패",error);
      setPlayerHistory([]);
      setProfileBusy(false);
      return;
    }
    setPlayerHistory(data||[]);
    setProfileBusy(false);
    window.scrollTo({top:0,left:0,behavior:"auto"});
  }

  async function signIn(e){
    e.preventDefault();if(loginBusy)return;
    setLoginBusy(true);setLoginError("");
    if(!supabase){
      setLoginBusy(false);
      setLoginError(`Supabase 환경변수 감지 실패 · URL: ${supabaseConfigStatus.hasUrl?"감지됨":"없음"} · KEY: ${supabaseConfigStatus.hasKey?"감지됨":"없음"}`);
      return;
    }
    const{data,error}=await supabase.auth.signInWithPassword({email:loginForm.email.trim(),password:loginForm.password});
    if(error){setLoginError("로그인 실패: 이메일 또는 비밀번호를 확인하세요.");setLoginBusy(false);return}
    const{data:access,error:aErr}=await supabase.rpc("mkta_admin_access");
    if(aErr||!access?.allowed){
      await supabase.auth.signOut();
      setLoginError("이 계정에는 MKTA 관리자 권한이 없습니다.");
      setLoginBusy(false);return;
    }
    setUser(data?.user||data?.session?.user||null);
    setAdmin(true);setAdminAccess(access||null);setLoginOpen(false);setLoginBusy(false);setLoginForm({email:"",password:""});
    loadRoster();loadRankingVisibilityAdmin();showFlash("MKTA 관리자 모드로 전환되었습니다.");
  }

  async function signOut(){
    await supabase?.auth.signOut();setAdmin(false);setAdminAccess(null);setUser(null);showFlash("로그아웃했습니다.");
  }

  async function changeAdminPassword(e){
    e.preventDefault();
    if(!supabase||!user?.email||!admin)return;
    if(String(user.email).toLowerCase()!=="clemens@jsme.com.au")return;

    const current=adminPasswordForm.current;
    const next=adminPasswordForm.next;
    const confirm=adminPasswordForm.confirm;

    setAdminPasswordError("");

    if(!current||!next||!confirm){
      setAdminPasswordError("현재 비밀번호와 새 비밀번호를 모두 입력해주세요.");
      return;
    }
    if(next.length<8){
      setAdminPasswordError("새 비밀번호는 8자 이상으로 설정해주세요.");
      return;
    }
    if(next!==confirm){
      setAdminPasswordError("새 비밀번호 확인이 일치하지 않습니다.");
      return;
    }
    if(current===next){
      setAdminPasswordError("현재 비밀번호와 다른 새 비밀번호를 입력해주세요.");
      return;
    }

    setAdminPasswordBusy(true);
    try{
      const{error:verifyError}=await supabase.auth.signInWithPassword({
        email:user.email,
        password:current
      });
      if(verifyError){
        setAdminPasswordError("현재 비밀번호가 맞지 않습니다.");
        return;
      }

      const{error:updateError}=await supabase.auth.updateUser({password:next});
      if(updateError)throw updateError;

      setAdminPasswordForm({current:"",next:"",confirm:""});
      await supabase.auth.signOut();
      setUser(null);
      setAdmin(false);
      setAdminAccess(null);
      setTab("home",{replace:true});
      setLoginOpen(true);
      showFlash("관리자 비밀번호가 변경되었습니다. 새 비밀번호로 다시 로그인해주세요.");
    }catch(err){
      setAdminPasswordError("비밀번호 변경 실패: "+(err?.message||"알 수 없는 오류"));
    }finally{
      setAdminPasswordBusy(false);
    }
  }

  async function setPlayer(matchId,side,slot,memberId){
    if(!admin)return;
    const{error}=await supabase.rpc("mkta_set_match_player",{
      p_match_id:matchId,p_side:side,p_slot:slot,p_member_id:memberId||null
    });
    if(error){alert("선수 배정 실패: "+error.message);return}
    await loadAll();
  }

  async function saveScore(match){
    const v=scoreInputs[match.id]||{};
    const a=Number(v.a),b=Number(v.b);
    if(!Number.isInteger(a)||!Number.isInteger(b)||a<0||b<0||a===b){
      alert("동점이 아닌 정상 점수를 입력해주세요.");return;
    }
    const{error}=await supabase.rpc("mkta_save_match_score",{p_match_id:match.id,p_score_a:a,p_score_b:b});
    if(error){alert("점수 저장 실패: "+error.message);return}
    await loadAll();showFlash("점수를 저장했습니다. AKTR은 아직 반영되지 않았습니다.");
  }

  async function clearScore(match){
    const{error}=await supabase.rpc("mkta_clear_match_score",{p_match_id:match.id});
    if(error){alert("점수 초기화 실패: "+error.message);return}
    await loadAll();
  }

  async function finalizeAktr(match){
    if(!confirm("이 경기 결과를 확정하고 AKTR에 반영할까요?\n확정 후에는 V1에서 점수를 수정할 수 없습니다."))return;
    const{error}=await supabase.rpc("mkta_finalize_match_aktr",{p_match_id:match.id});
    if(error){alert("AKTR 확정 실패: "+error.message);return}
    await Promise.all([loadAll(),loadRoster()]);showFlash("MKTA 공식경기 AKTR 반영이 완료되었습니다.");
  }

  async function changeMultiplier(v){
    const{error}=await supabase.rpc("mkta_set_multiplier",{p_event_id:EVENT_ID,p_multiplier:Number(v)});
    if(error){alert("배율 변경 실패: "+error.message);return}
    await loadAll();
  }

  async function startEvent(){
    if(!confirm(`대회를 시작할까요?\nAKTR 배율 ${event?.rating_multiplier}×와 대진표가 잠깁니다.`))return;
    const{error}=await supabase.rpc("mkta_start_event",{p_event_id:EVENT_ID});
    if(error){alert("대회 시작 실패: "+error.message);return}
    await loadAll();showFlash("대회를 시작했습니다.");
  }

  async function completeEvent(){
    if(!confirm("모든 경기를 종료 처리하고 대회를 마감할까요?"))return;
    const{error}=await supabase.rpc("mkta_complete_event",{p_event_id:EVENT_ID});
    if(error){alert("대회 종료 실패: "+error.message);return}
    await loadAll();showFlash("대회를 종료했습니다.");
  }

  async function saveEventMeta(e){
    e.preventDefault();
    const fd=new FormData(e.currentTarget);
    const{error}=await supabase.from("mkta_events").update({
      event_date:fd.get("event_date")||null,
      venue:String(fd.get("venue")||"").trim()||null,
      updated_at:new Date().toISOString()
    }).eq("id",EVENT_ID);
    if(error){alert("대회 정보 저장 실패: "+error.message);return}
    await loadAll();showFlash("대회 정보를 저장했습니다.");
  }

  function eligiblePlayers(teamId){
    const clubIds=sourceClubs[teamId]||[];
    return roster.filter(p=>p.clubs.some(c=>{
      const id={OCTC:CLUB_IDS.OCTC,MKTC:CLUB_IDS.MKTC,VKTC:CLUB_IDS.VKTC,WKTC:CLUB_IDS.WKTC}[c];
      return clubIds.includes(id);
    }));
  }

  const rounds=[...new Set(matches.map(x=>x.round_no))].sort((a,b)=>a-b);
  const filteredMatches=matches.filter(m=>(divisionFilter==="ALL"||m.division_id===divisionFilter)&&m.round_no===round);
  const overallRows=teams.map(t=>({team:t,...(standings.find(s=>s.event_team_id===t.id)||{played:0,wins:0,losses:0,points:0,games_for:0,games_against:0})})).sort(byStanding);
  const finalCount=matches.filter(x=>x.rating_applied).length;
  const scoredCount=matches.filter(x=>x.score_a!=null&&x.score_b!=null).length;

  return <div className="app">
    <header className="topbar">
      <button className="brand" onClick={()=>setTab("home")}>
        <img className="brandLogo" src="/mkta-logo.png" alt="MKTA logo" />
        <span><b>Melbourne Korean Tennis Association</b><small>OFFICIAL TOURNAMENT SYSTEM</small></span>
      </button>
      <nav>
        {[["home","홈"],["ranking","통합 랭킹"],["schedule","대진표"],["standings","실시간 순위"],["teams","팀 · 선수"],["scores","경기 입력"]].map(x=>
          <button key={x[0]} className={tab===x[0]?"active":""} onClick={()=>setTab(x[0])}>{x[1]}</button>
        )}
        {admin&&<button className={tab==="admin"?"active":""} onClick={()=>setTab("admin")}>관리자</button>}
      </nav>
      <div className="auth">
        {admin?<><span>ADMIN</span><button onClick={signOut}>로그아웃</button></>:<button onClick={()=>setLoginOpen(true)}>관리자 로그인</button>}
      </div>
    </header>

    <main>
      {flash&&<div className="flash">{flash}</div>}
      {!supabase&&<div className="envWarn">Supabase 연결 필요 · URL {supabaseConfigStatus.hasUrl?"✓":"✕"} · KEY {supabaseConfigStatus.hasKey?"✓":"✕"}</div>}

      {tab==="home"&&<>
        <section className="hero">
          <div>
            <span className="eyebrow">MKTA OFFICIAL EVENT</span>
            <h1>{event?.name||"MKTA 클럽대항전"}</h1>
            <p>OCTC · MKTC · VKTC · WKTC의 공용 선수 DB와 AKTR을 연결해 클럽대항전을 실시간으로 운영합니다.</p>
            <div className="heroMeta">
              <span>{event?.event_date||"날짜 미정"}</span>
              <span>{event?.venue||"장소 미정"}</span>
              <span className={`status ${event?.status||"draft"}`}>{statusText(event?.status)}</span>
              <span>AKTR ×{Number(event?.rating_multiplier||1).toFixed(2)}</span>
            </div>
          </div>
          <div className="heroScore">
            <strong>{finalCount}</strong><span>/ {matches.length}</span>
            <small>AKTR 확정 경기</small>
            <div className="progress"><i style={{width:`${matches.length?finalCount/matches.length*100:0}%`}}/></div>
          </div>
        </section>

        <section className="grid3">
          {overallRows.map((r,i)=><article className="teamCard" key={r.team.id} style={{"--team":r.team.color}}>
            <div className="rank">{i+1}</div>
            <h3>{r.team.short_name}</h3>
            <strong>{r.points}점</strong>
            <p>{r.wins}승 {r.losses}패 · 총 득점 {r.games_for}</p>
          </article>)}
        </section>

        <section className="panel">
          <div className="panelHead"><div><span>LIVE BOARD</span><h2>대회 진행 현황</h2></div><button onClick={()=>setTab("schedule")}>전체 대진표 →</button></div>
          <div className="kpis">
            <div><b>{scoredCount}</b><span>점수 입력</span></div>
            <div><b>{finalCount}</b><span>AKTR 확정</span></div>
            <div><b>{81-finalCount}</b><span>남은 경기</span></div>
            <div><b>{Number(event?.rating_multiplier||1).toFixed(2)}×</b><span>공식경기 배율</span></div>
          </div>
        </section>
      </>}

      {tab==="ranking"&&<section className="panel">
        <div className="panelHead">
          <div><span>MKTA AKTR RANKING</span><h2>4개 클럽 통합 랭킹</h2></div>
          <small>OCTC · MKTC · VKTC · WKTC 활성 회원을 글로벌 선수 ID 기준으로 한 번만 표시합니다.</small>
        </div>

        <div className="rankingHero">
          <div>
            <b>{rankingRoster.length}</b>
            <span>통합 선수</span>
          </div>
          <p>같은 선수가 여러 클럽에 등록되어 있어도 한 명으로 합쳐지고, 관리자가 숨김 처리한 선수는 제외한 뒤 현재 공용 AKTR 기준으로 순위가 정해집니다.</p>
        </div>

        {roster.length===0?<div className="empty">등록된 통합 랭킹 선수를 불러오는 중이거나 아직 표시할 선수가 없습니다.</div>:<>
          <div className="rankingPodium">
            {rankingRoster.slice(0,3).map((p,i)=><article key={p.id} className={`podium rank${i+1}`}>
              <span>{i===0?"1st":i===1?"2nd":"3rd"}</span>
              <button className="rankingPlayerName podiumName" onClick={()=>openPlayerProfile(p.id)}>{p.name}</button>
              <strong>AKTR {p.rating}</strong>
              <small><ClubBadges clubs={p.clubs}/></small>
            </article>)}
          </div>

          <div className="integratedRankingTable">
            <div className="integratedRankHead">
              <span>순위</span><span>선수</span><span>소속 클럽</span><span>AKTR</span>
            </div>
            {rankingRoster.map((p,i)=><div className="integratedRankRow" key={p.id}>
              <b>{i+1}</b>
              <button className="rankingPlayerName" onClick={()=>openPlayerProfile(p.id)}>{p.name}</button>
              <ClubBadges clubs={p.clubs}/>
              <span className="aktrValue">{p.rating}</span>
            </div>)}
          </div>
        </>}
      </section>}

      {tab==="profile"&&(()=>{
        const member=roster.find(p=>p.id===profileMemberId)||null;
        const visibleHistory=playerHistory.filter(x=>profileFilter==="ALL"||(profileFilter==="CLUB"&&x.source_type==="club")||(profileFilter==="MKTA"&&x.source_type==="mkta"));
        const completed=playerHistory.filter(x=>x.won===true||x.won===false);
        const wins=completed.filter(x=>x.won===true).length;
        const losses=completed.filter(x=>x.won===false).length;
        const rate=completed.length?Math.round(wins/completed.length*100):0;
        return <div className="profilePage">
          <button className="profileBack" onClick={()=>{
            if(window.history.state?.mkta&&window.history.length>1)window.history.back();
            else setTab("ranking",{replace:true});
          }}>← 통합 랭킹으로</button>

          {!member?<section className="panel"><div className="empty">회원 정보를 찾을 수 없습니다.</div></section>:<>
            <section className="playerProfileHero panel">
              <div className="playerProfileIdentity">
                <span className="profileAvatar">{String(member.name||"?").slice(0,1)}</span>
                <div>
                  <span className="eyebrow">MKTA PLAYER PROFILE</span>
                  <h1>{member.name}</h1>
                  <ClubBadges clubs={member.clubs}/>
                </div>
              </div>
              <div className="playerProfileAktr"><small>현재 AKTR</small><strong>{member.rating}</strong></div>
            </section>

            <section className="profileStatGrid">
              <div><small>전체 공식 경기</small><b>{completed.length}</b></div>
              <div><small>승</small><b>{wins}</b></div>
              <div><small>패</small><b>{losses}</b></div>
              <div><small>승률</small><b>{rate}%</b></div>
            </section>

            <section className="panel">
              <div className="panelHead profileRecordHead">
                <div>
                  <span>COMPLETE RECORD</span>
                  <h2>통합 경기 전적</h2>
                  <small>OCTC · MKTC · VKTC · WKTC 클럽 경기와 MKTA 공식경기를 한 번에 표시합니다.</small>
                </div>
                <div className="profileFilters">
                  <button className={profileFilter==="ALL"?"active":""} onClick={()=>setProfileFilter("ALL")}>전체</button>
                  <button className={profileFilter==="CLUB"?"active":""} onClick={()=>setProfileFilter("CLUB")}>4개 클럽</button>
                  <button className={profileFilter==="MKTA"?"active":""} onClick={()=>setProfileFilter("MKTA")}>MKTA</button>
                </div>
              </div>

              {profileBusy?<div className="empty">경기 전적을 불러오는 중입니다.</div>:
              !visibleHistory.length?<div className="empty">표시할 경기 전적이 없습니다.</div>:
              <div className="globalMatchHistory">
                {visibleHistory.map((m,idx)=>{
                  const opponentIds=[m.opponent_1_id,m.opponent_2_id].filter(Boolean);
                  const opponentNames=[
                    {id:m.opponent_1_id,name:m.opponent_1_name},
                    {id:m.opponent_2_id,name:m.opponent_2_name}
                  ].filter(x=>x.id&&x.name);
                  const partnerClickable=m.partner_id&&roster.some(p=>p.id===m.partner_id);
                  return <article className="globalMatchRow" key={`${m.source_type}-${m.match_id}-${idx}`}>
                    <div className={m.won===true?"historyWL win":m.won===false?"historyWL loss":"historyWL pending"}>
                      {m.won===true?"W":m.won===false?"L":"-"}
                    </div>
                    <div className="historySource">
                      {m.source_type==="mkta"
                        ?<span className="sourceBadge mkta">MKTA</span>
                        :<span className={`sourceBadge ${String(m.source_name||"").toLowerCase()}`}>{m.source_name}</span>}
                      <small>{m.played_date||""}{m.played_time?` · ${String(m.played_time).slice(0,5)}`:""}</small>
                    </div>
                    <div className="historyMain">
                      <b>{m.competition||"공식 경기"}</b>
                      {m.source_type==="mkta"&&m.team_for&&m.team_against&&
                        <span className="eventTeamLine">{m.team_for} vs {m.team_against}</span>}
                      <span className="historyPeople">
                        {m.match_format==="singles"
                          ?<strong>단식</strong>
                          :<>
                            <span>파트너 </span>
                            {m.partner_name
                              ?partnerClickable
                                ?<button onClick={()=>openPlayerProfile(m.partner_id)}>{m.partner_name}</button>
                                :<strong>{m.partner_name}</strong>
                              :<strong>-</strong>}
                          </>
                        }
                        <em> · vs </em>
                        {opponentNames.map((opp,oi)=><React.Fragment key={opp.id}>
                          {roster.some(p=>p.id===opp.id)
                            ?<button onClick={()=>openPlayerProfile(opp.id)}>{opp.name}</button>
                            :<strong>{opp.name}</strong>}
                          {oi<opponentNames.length-1&&<span> + </span>}
                        </React.Fragment>)}
                      </span>
                    </div>
                    <div className="historyResult">
                      <strong>{m.score_for!=null&&m.score_against!=null?`${m.score_for} - ${m.score_against}`:"-"}</strong>
                      <span className={Number(m.aktr_delta||0)>=0?"delta plus":"delta minus"}>
                        {m.aktr_delta==null?"AKTR -":`${Number(m.aktr_delta)>=0?"+":""}${m.aktr_delta} AKTR`}
                      </span>
                    </div>
                  </article>
                })}
              </div>}
            </section>
          </>}
        </div>
      })()}

      {tab==="schedule"&&<section className="panel">
        <div className="panelHead"><div><span>DRAW</span><h2>클럽대항전 대진표</h2></div></div>
        <div className="filters">
          <div className="roundTabs">{rounds.map(r=><button className={round===r?"active":""} key={r} onClick={()=>setRound(r)}>R{r}<small>{timeText(matches.find(m=>m.round_no===r)?.scheduled_time)}</small></button>)}</div>
          <select value={divisionFilter} onChange={e=>setDivisionFilter(e.target.value)}>
            <option value="ALL">금 · 은 · 동 전체</option>
            {divisions.map(d=><option value={d.id} key={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div className="matchGrid">
          {filteredMatches.map(m=><MatchCard key={m.id} match={m} teamMap={teamMap} divisionMap={divisionMap} matchPlayers={matchPlayers} playerMap={playerMap}/>)}
        </div>
      </section>}

      {tab==="standings"&&<>
        <section className="panel">
          <div className="panelHead"><div><span>STANDINGS</span><h2>전체 팀 순위</h2></div><small>승점 우선 · 동률 시 총 득점 우선</small></div>
          <Standings rows={overallRows}/>
        </section>
        <div className="divisionBoards">
          {divisions.map(d=>{
            const rows=teams.map(t=>({team:t,...(divisionStandings.find(s=>s.division_id===d.id&&s.event_team_id===t.id)||{played:0,wins:0,losses:0,points:0,games_for:0,games_against:0})})).sort(byStanding);
            return <section className="panel" key={d.id}><div className="panelHead"><h2>{d.name}</h2></div><Standings rows={rows}/></section>
          })}
        </div>
      </>}

      {tab==="teams"&&<section className="panel">
        <div className="panelHead"><div><span>TEAMS</span><h2>참가 팀 · 선수</h2></div><small>{admin?"관리자는 경기별 실제 출전 선수를 지정할 수 있습니다.":"선수 배정은 관리자 화면에서 진행됩니다."}</small></div>
        <div className="teamOverview">
          {teams.map(t=><article key={t.id} style={{"--team":t.color}}>
            <h3>{t.short_name}</h3><p>{t.name}</p>
            <span>{(sourceClubs[t.id]||[]).map(id=>id===CLUB_IDS.OCTC?"OCTC":id===CLUB_IDS.MKTC?"MKTC":id===CLUB_IDS.VKTC?"VKTC":"WKTC").join(" + ")}</span>
          </article>)}
        </div>
        {admin&&<LineupEditor matches={matches} divisions={divisions} teamMap={teamMap} matchPlayers={matchPlayers} playerMap={playerMap} eligiblePlayers={eligiblePlayers} setPlayer={setPlayer}/>}
      </section>}

      {tab==="scores"&&<section className="panel">
        <div className="panelHead"><div><span>MATCH CONTROL</span><h2>경기 점수 입력</h2></div><small>점수 저장 후 AKTR 확정을 별도로 눌러야 포인트가 반영됩니다.</small></div>
        {!admin?<div className="empty">관리자 로그인 후 점수를 입력할 수 있습니다.</div>:
        <div className="scoreList">
          {matches.map(m=><ScoreRow key={m.id} match={m} teamMap={teamMap} divisionMap={divisionMap} matchPlayers={matchPlayers} playerMap={playerMap} scoreInputs={scoreInputs} setScoreInputs={setScoreInputs} saveScore={saveScore} clearScore={clearScore} finalizeAktr={finalizeAktr} event={event}/>)}
        </div>}
      </section>}

      {tab==="admin"&&admin&&<>
        <section className="panel adminPanel">
          <div className="panelHead"><div><span>EVENT CONTROL</span><h2>대회 관리자</h2></div></div>
          <div className="adminGrid">
            <form onSubmit={saveEventMeta}>
              <h3>대회 정보</h3>
              <label>날짜<input name="event_date" type="date" defaultValue={event?.event_date||""}/></label>
              <label>장소<input name="venue" defaultValue={event?.venue||""} placeholder="경기장 / 주소"/></label>
              <button className="primary">정보 저장</button>
            </form>
            <div>
              <h3>AKTR 공식경기 배율</h3>
              <select value={Number(event?.rating_multiplier||1.5)} disabled={event?.status!=="draft"} onChange={e=>changeMultiplier(e.target.value)}>
                {[1,1.25,1.5,2].map(x=><option key={x} value={x}>{x.toFixed(2)}×</option>)}
              </select>
              <p>기존 AKTR 공식은 그대로 계산하고 최종 변화량에만 이 배율을 적용합니다.</p>
            </div>
            <div>
              <h3>대회 상태</h3>
              <strong>{statusText(event?.status)}</strong>
              {event?.status==="draft"&&<button className="primary" onClick={startEvent}>대회 시작 · 배율 잠금</button>}
              {event?.status==="live"&&<button className="danger" onClick={completeEvent}>대회 종료</button>}
            </div>
          </div>
        </section>
        {String(user?.email||"").toLowerCase()==="clemens@jsme.com.au"&&
        <section className="panel adminPasswordPanel">
          <div className="panelHead">
            <div><span>ACCOUNT</span><h2>관리자 비밀번호 변경</h2></div>
            <small>clemens@jsme.com.au</small>
          </div>

          <form className="adminPasswordForm" onSubmit={changeAdminPassword}>
            <label>현재 비밀번호
              <input
                type="password"
                autoComplete="current-password"
                value={adminPasswordForm.current}
                onChange={e=>setAdminPasswordForm({...adminPasswordForm,current:e.target.value})}
                placeholder="현재 비밀번호"
              />
            </label>
            <label>새 비밀번호
              <input
                type="password"
                autoComplete="new-password"
                value={adminPasswordForm.next}
                onChange={e=>setAdminPasswordForm({...adminPasswordForm,next:e.target.value})}
                placeholder="8자 이상"
              />
            </label>
            <label>새 비밀번호 확인
              <input
                type="password"
                autoComplete="new-password"
                value={adminPasswordForm.confirm}
                onChange={e=>setAdminPasswordForm({...adminPasswordForm,confirm:e.target.value})}
                placeholder="새 비밀번호 다시 입력"
              />
            </label>

            {adminPasswordError&&<div className="adminPasswordError">{adminPasswordError}</div>}

            <div className="adminPasswordActions">
              <p>변경이 완료되면 자동으로 로그아웃됩니다. 이후에는 새 비밀번호로 다시 로그인하면 됩니다.</p>
              <button className="primary" disabled={adminPasswordBusy}>
                {adminPasswordBusy?"변경 중...":"비밀번호 변경"}
              </button>
            </div>
          </form>
        </section>}

        <section className="panel">
          <div className="panelHead">
            <div><span>RANKING VISIBILITY</span><h2>통합랭킹 표시 관리</h2></div>
            <small>공식 경기 여부와 상관없이 원하는 선수를 통합랭킹에서 직접 숨기거나 다시 표시할 수 있습니다.</small>
          </div>

          <div className="rankingVisibilityToolbar">
            <input
              type="search"
              value={rankingAdminSearch}
              onChange={e=>setRankingAdminSearch(e.target.value)}
              placeholder="회원 이름 검색"
            />
            <span>숨김 {hiddenRankingIds.length}명</span>
          </div>

          <div className="rankingVisibilityList">
            {roster
              .filter(p=>!rankingAdminSearch.trim()||String(p.name||"").toLowerCase().includes(rankingAdminSearch.trim().toLowerCase()))
              .map(p=>{
                const hidden=hiddenRankingIds.includes(p.id);
                return <div className={`rankingVisibilityRow ${hidden?"hidden":""}`} key={p.id}>
                  <div>
                    <button className="rankingVisibilityName" onClick={()=>openPlayerProfile(p.id)}>{p.name}</button>
                    <ClubBadges clubs={p.clubs}/>
                  </div>
                  <strong>AKTR {p.rating}</strong>
                  <span className={hidden?"visibilityState off":"visibilityState on"}>
                    {hidden?"랭킹 숨김":"랭킹 표시"}
                  </span>
                  <button
                    className={hidden?"visibilityAction show":"visibilityAction hide"}
                    onClick={()=>setRankingHidden(p.id,!hidden)}
                  >
                    {hidden?"다시 표시":"숨기기"}
                  </button>
                </div>
              })}
          </div>
        </section>

        <section className="panel">
          <div className="panelHead"><div><span>AKTR LOG</span><h2>MKTA AKTR 변동 기록</h2></div></div>
          <div className="ratingTable">
            {ratingChanges.length===0?<div className="empty">아직 AKTR 확정 경기가 없습니다.</div>:ratingChanges.slice(0,100).map(x=><div key={x.id}>
              <b>{playerMap[x.member_id]?.name||x.member_id.slice(0,8)}</b>
              <span>기본 {deltaText(x.base_delta)} × {Number(x.multiplier).toFixed(2)}</span>
              <strong>{deltaText(x.final_delta)}</strong>
              <em>{x.rating_before} → {x.rating_after}</em>
            </div>)}
          </div>
        </section>
      </>}
    </main>

    {loginOpen&&<div className="modalBg" onMouseDown={e=>{if(e.target===e.currentTarget)setLoginOpen(false)}}>
      <form className="loginModal" onSubmit={signIn}>
        <button type="button" className="close" onClick={()=>setLoginOpen(false)}>×</button>
        <span>MKTA ADMIN</span><h2>관리자 로그인</h2>
        <p>등록된 MKTA 관리자 계정으로 로그인하세요.</p>
        <input type="email" placeholder="Email" value={loginForm.email} onChange={e=>setLoginForm({...loginForm,email:e.target.value})} required/>
        <input type="password" placeholder="Password" value={loginForm.password} onChange={e=>setLoginForm({...loginForm,password:e.target.value})} required/>
        {loginError&&<div className="loginError">{loginError}</div>}
        <button className="primary" disabled={loginBusy}>{loginBusy?"로그인 중...":"로그인"}</button>
      </form>
    </div>}
  </div>
}

function MatchCard({match,teamMap,divisionMap,matchPlayers,playerMap}){
  const ps=matchPlayers[match.id]||{A:{},B:{}};
  const names=side=>[ps[side]?.[1],ps[side]?.[2]].filter(Boolean).map(id=>playerMap[id]?.name||"선수").join(" · ");
  return <article className={`matchCard ${match.status}`}>
    <header><span>{divisionMap[match.division_id]?.name}</span><b>Court {match.court_no}</b><em>{timeText(match.scheduled_time)}</em></header>
    <div className="side"><strong>{teamMap[match.team_a_id]?.short_name} {match.team_a_label}</strong><small>{names("A")||"선수 미배정"}</small>{match.score_a!=null&&<b>{match.score_a}</b>}</div>
    <i>VS</i>
    <div className="side"><strong>{teamMap[match.team_b_id]?.short_name} {match.team_b_label}</strong><small>{names("B")||"선수 미배정"}</small>{match.score_b!=null&&<b>{match.score_b}</b>}</div>
    {match.rating_applied&&<footer>AKTR 확정 ✓</footer>}
  </article>
}

function Standings({rows}){
  return <div className="standings">
    <div className="standingHead"><span>순위</span><span>팀</span><span>승</span><span>패</span><span>승점</span><span>총 득점</span><span>총 실점</span></div>
    {rows.map((r,i)=><div className="standingRow" key={r.team.id}>
      <b>{i+1}</b><strong style={{"--team":r.team.color}}>{r.team.short_name}</strong><span>{r.wins}</span><span>{r.losses}</span><em>{r.points}</em><span>{r.games_for}</span><span>{r.games_against}</span>
    </div>)}
  </div>
}

function LineupEditor({matches,divisions,teamMap,matchPlayers,playerMap,eligiblePlayers,setPlayer}){
  const[round,setRound]=useState(1);
  const rounds=[...new Set(matches.map(x=>x.round_no))].sort((a,b)=>a-b);
  const rows=matches.filter(x=>x.round_no===round);
  return <div className="lineupEditor">
    <div className="roundTabs">{rounds.map(r=><button className={round===r?"active":""} key={r} onClick={()=>setRound(r)}>R{r}</button>)}</div>
    {divisions.map(d=><div className="lineupDivision" key={d.id}>
      <h3>{d.name}</h3>
      {rows.filter(x=>x.division_id===d.id).map(m=><div className="lineupMatch" key={m.id}>
        <span>Court {m.court_no}</span>
        {["A","B"].map(side=>{
          const tid=side==="A"?m.team_a_id:m.team_b_id;
          const label=side==="A"?m.team_a_label:m.team_b_label;
          const current=matchPlayers[m.id]?.[side]||{};
          const opts=eligiblePlayers(tid);
          return <div className="lineupSide" key={side}>
            <b>{teamMap[tid]?.short_name} {label}</b>
            {[1,2].map(slot=><select key={slot} value={current[slot]||""} disabled={m.status!=="scheduled"} onChange={e=>setPlayer(m.id,side,slot,e.target.value)}>
              <option value="">선수 {slot} 선택</option>
              {opts.map(p=><option value={p.id} key={p.id}>{p.name} · AKTR {p.rating} · {p.clubs.join("/")}</option>)}
            </select>)}
          </div>
        })}
      </div>)}
    </div>)}
  </div>
}

function ScoreRow({match,teamMap,divisionMap,matchPlayers,playerMap,scoreInputs,setScoreInputs,saveScore,clearScore,finalizeAktr,event}){
  const ps=matchPlayers[match.id]||{A:{},B:{}};
  const names=side=>[ps[side]?.[1],ps[side]?.[2]].filter(Boolean).map(id=>playerMap[id]?.name||"선수").join(" · ");
  const v=scoreInputs[match.id]||{a:"",b:""};
  const ready=ps.A?.[1]&&ps.A?.[2]&&ps.B?.[1]&&ps.B?.[2];
  return <article className={`scoreRow ${match.status}`}>
    <div className="scoreMeta"><b>R{match.round_no} · Court {match.court_no}</b><span>{timeText(match.scheduled_time)} · {divisionMap[match.division_id]?.name}</span></div>
    <div className="scoreTeam"><strong>{teamMap[match.team_a_id]?.short_name} {match.team_a_label}</strong><small>{names("A")||"선수 미배정"}</small></div>
    <input type="number" min="0" value={v.a} disabled={match.rating_applied} onChange={e=>setScoreInputs(s=>({...s,[match.id]:{...v,a:e.target.value}}))}/>
    <span className="scoreDash">:</span>
    <input type="number" min="0" value={v.b} disabled={match.rating_applied} onChange={e=>setScoreInputs(s=>({...s,[match.id]:{...v,b:e.target.value}}))}/>
    <div className="scoreTeam right"><strong>{teamMap[match.team_b_id]?.short_name} {match.team_b_label}</strong><small>{names("B")||"선수 미배정"}</small></div>
    <div className="scoreActions">
      {!match.rating_applied&&<button disabled={!ready} onClick={()=>saveScore(match)}>점수 저장</button>}
      {match.status==="scored"&&!match.rating_applied&&<button className="muted" onClick={()=>clearScore(match)}>점수 초기화</button>}
      {match.status==="scored"&&!match.rating_applied&&<button className="primary" disabled={event?.status!=="live"} onClick={()=>finalizeAktr(match)}>AKTR 확정</button>}
      {match.rating_applied&&<span className="done">AKTR 반영 완료 ✓</span>}
    </div>
  </article>
}

createRoot(document.getElementById("root")).render(<App/>);
