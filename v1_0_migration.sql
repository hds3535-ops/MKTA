-- MKTA V1.0
-- Federation tournament layer for OCTC / MKTC / VKTC / WKTC.
-- The first event is seeded from the uploaded club-championship workbook.
-- Existing club memberships and the existing AKTR formula are NOT changed.
-- AKTR multiplier is applied only to the final delta for MKTA official matches.

begin;

-- Technical source id used only so global AKTR history can remember that
-- an adjustment came from MKTA. It is NOT a fifth member club.
insert into public.clubs(id,code,site_key,name,short_name,active)
values(
  '55555555-5555-4555-8555-555555555555',
  'MKTA',
  'mkta',
  'Melbourne Korean Tennis Association',
  'MKTA',
  false
)
on conflict(id) do update
set code=excluded.code,
    site_key=excluded.site_key,
    name=excluded.name,
    short_name=excluded.short_name,
    active=false,
    updated_at=now();

create table if not exists public.mkta_admins(
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'admin' check(role in ('owner','admin')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function public.mkta_is_admin()
returns boolean
language sql
security definer
set search_path=public
stable
as $$
  select
    public.is_system_admin()
    or exists(
      select 1 from public.mkta_admins a
      where a.user_id=auth.uid() and a.active=true
    );
$$;

grant execute on function public.mkta_is_admin() to anon,authenticated;

create or replace function public.mkta_admin_access()
returns jsonb
language sql
security definer
set search_path=public
stable
as $$
  select jsonb_build_object(
    'allowed',public.mkta_is_admin(),
    'system_admin',public.is_system_admin(),
    'role',coalesce(
      (select role from public.mkta_admins where user_id=auth.uid() and active=true limit 1),
      case when public.is_system_admin() then 'system_owner' else null end
    )
  );
$$;

grant execute on function public.mkta_admin_access() to authenticated;

create table if not exists public.mkta_events(
  id uuid primary key default gen_random_uuid(),
  name text not null,
  event_date date,
  venue text,
  status text not null default 'draft' check(status in ('draft','live','completed')),
  rating_multiplier numeric(4,2) not null default 1.50 check(rating_multiplier between 1.00 and 2.00),
  rating_locked boolean not null default false,
  schedule_locked boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.mkta_event_teams(
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.mkta_events(id) on delete cascade,
  code text not null,
  name text not null,
  short_name text not null,
  display_order integer not null default 0,
  color text,
  unique(event_id,code)
);

create table if not exists public.mkta_event_team_clubs(
  event_team_id uuid not null references public.mkta_event_teams(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  primary key(event_team_id,club_id)
);

create table if not exists public.mkta_divisions(
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.mkta_events(id) on delete cascade,
  code text not null,
  name text not null,
  display_order integer not null,
  unique(event_id,code)
);

create table if not exists public.mkta_matches(
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.mkta_events(id) on delete cascade,
  division_id uuid not null references public.mkta_divisions(id) on delete cascade,
  round_no integer not null check(round_no>0),
  scheduled_time time not null,
  court_no integer not null check(court_no>0),
  team_a_id uuid not null references public.mkta_event_teams(id),
  team_a_label text not null check(team_a_label in ('A','B','C')),
  team_b_id uuid not null references public.mkta_event_teams(id),
  team_b_label text not null check(team_b_label in ('A','B','C')),
  score_a integer,
  score_b integer,
  winner text check(winner in ('A','B')),
  status text not null default 'scheduled' check(status in ('scheduled','scored','final')),
  rating_applied boolean not null default false,
  rating_applied_at timestamptz,
  created_at timestamptz not null default now(),
  unique(event_id,round_no,court_no),
  check(team_a_id<>team_b_id)
);

create table if not exists public.mkta_match_players(
  match_id uuid not null references public.mkta_matches(id) on delete cascade,
  side text not null check(side in ('A','B')),
  slot integer not null check(slot in (1,2)),
  member_id uuid not null references public.members(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key(match_id,side,slot),
  unique(match_id,member_id)
);

create table if not exists public.mkta_rating_changes(
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.mkta_matches(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete restrict,
  side text not null check(side in ('A','B')),
  won boolean not null,
  rating_before integer not null,
  base_delta integer not null,
  multiplier numeric(4,2) not null,
  final_delta integer not null,
  rating_after integer not null,
  created_at timestamptz not null default now(),
  unique(match_id,member_id)
);

-- Compatibility metadata on the global AKTR timeline.
alter table public.otr_events add column if not exists source_type text;
alter table public.otr_events add column if not exists source_ref uuid;

create index if not exists otr_events_source_idx
on public.otr_events(source_type,source_ref);

-- Public standings: uploaded workbook rule = 승점 우선, 동률이면 총 득점 우선.
create or replace view public.mkta_standings as
with rows as(
  select
    m.event_id,
    m.team_a_id as event_team_id,
    m.score_a as games_for,
    m.score_b as games_against,
    (m.winner='A') as won
  from public.mkta_matches m
  where m.score_a is not null and m.score_b is not null
  union all
  select
    m.event_id,
    m.team_b_id,
    m.score_b,
    m.score_a,
    (m.winner='B')
  from public.mkta_matches m
  where m.score_a is not null and m.score_b is not null
)
select
  event_id,
  event_team_id,
  count(*)::integer as played,
  count(*) filter(where won)::integer as wins,
  count(*) filter(where not won)::integer as losses,
  (count(*) filter(where won)*3)::integer as points,
  coalesce(sum(games_for),0)::integer as games_for,
  coalesce(sum(games_against),0)::integer as games_against
from rows
group by event_id,event_team_id;

create or replace view public.mkta_division_standings as
with rows as(
  select
    m.event_id,m.division_id,m.team_a_id as event_team_id,
    m.score_a as games_for,m.score_b as games_against,(m.winner='A') as won
  from public.mkta_matches m
  where m.score_a is not null and m.score_b is not null
  union all
  select
    m.event_id,m.division_id,m.team_b_id,
    m.score_b,m.score_a,(m.winner='B')
  from public.mkta_matches m
  where m.score_a is not null and m.score_b is not null
)
select
  event_id,division_id,event_team_id,
  count(*)::integer as played,
  count(*) filter(where won)::integer as wins,
  count(*) filter(where not won)::integer as losses,
  (count(*) filter(where won)*3)::integer as points,
  coalesce(sum(games_for),0)::integer as games_for,
  coalesce(sum(games_against),0)::integer as games_against
from rows
group by event_id,division_id,event_team_id;

grant select on public.mkta_standings,public.mkta_division_standings to anon,authenticated;

-- Admin mutation helpers.
create or replace function public.mkta_set_match_player(
  p_match_id uuid,
  p_side text,
  p_slot integer,
  p_member_id uuid
)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare
  m public.mkta_matches%rowtype;
  target_team uuid;
begin
  if not public.mkta_is_admin() then raise exception 'MKTA admin required'; end if;
  if p_side not in ('A','B') or p_slot not in (1,2) then raise exception 'invalid slot'; end if;

  select * into m from public.mkta_matches where id=p_match_id for update;
  if m.id is null then raise exception 'match not found'; end if;
  if m.rating_applied then raise exception 'AKTR already finalized'; end if;
  if m.status<>'scheduled' then raise exception 'clear the saved score before changing players'; end if;

  if p_member_id is null then
    delete from public.mkta_match_players
    where match_id=p_match_id and side=p_side and slot=p_slot;
    return true;
  end if;

  target_team:=case when p_side='A' then m.team_a_id else m.team_b_id end;

  if not exists(
    select 1
    from public.mkta_event_team_clubs tc
    join public.club_roster cr
      on cr.club_id=tc.club_id
     and cr.member_id=p_member_id
     and cr.active=true
    where tc.event_team_id=target_team
  ) then
    raise exception 'player does not belong to this event team';
  end if;

  insert into public.mkta_match_players(match_id,side,slot,member_id)
  values(p_match_id,p_side,p_slot,p_member_id)
  on conflict(match_id,side,slot)
  do update set member_id=excluded.member_id;

  return true;
end;
$$;

grant execute on function public.mkta_set_match_player(uuid,text,integer,uuid) to authenticated;

create or replace function public.mkta_save_match_score(
  p_match_id uuid,
  p_score_a integer,
  p_score_b integer
)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare
  m public.mkta_matches%rowtype;
begin
  if not public.mkta_is_admin() then raise exception 'MKTA admin required'; end if;
  if p_score_a<0 or p_score_b<0 or p_score_a=p_score_b then raise exception 'invalid score'; end if;

  select * into m from public.mkta_matches where id=p_match_id for update;
  if m.id is null then raise exception 'match not found'; end if;
  if m.rating_applied then raise exception 'AKTR already finalized'; end if;

  update public.mkta_matches
  set score_a=p_score_a,
      score_b=p_score_b,
      winner=case when p_score_a>p_score_b then 'A' else 'B' end,
      status='scored'
  where id=p_match_id;

  return true;
end;
$$;

grant execute on function public.mkta_save_match_score(uuid,integer,integer) to authenticated;

create or replace function public.mkta_clear_match_score(p_match_id uuid)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
begin
  if not public.mkta_is_admin() then raise exception 'MKTA admin required'; end if;
  if exists(select 1 from public.mkta_matches where id=p_match_id and rating_applied=true) then
    raise exception 'AKTR already finalized';
  end if;

  update public.mkta_matches
  set score_a=null,score_b=null,winner=null,status='scheduled'
  where id=p_match_id;

  return true;
end;
$$;

grant execute on function public.mkta_clear_match_score(uuid) to authenticated;

create or replace function public.mkta_set_multiplier(
  p_event_id uuid,
  p_multiplier numeric
)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
begin
  if not public.mkta_is_admin() then raise exception 'MKTA admin required'; end if;
  if p_multiplier<1 or p_multiplier>2 then raise exception 'multiplier must be between 1.0 and 2.0'; end if;

  update public.mkta_events
  set rating_multiplier=p_multiplier,updated_at=now()
  where id=p_event_id and status='draft' and rating_locked=false;

  if not found then raise exception 'event multiplier is locked'; end if;
  return true;
end;
$$;

grant execute on function public.mkta_set_multiplier(uuid,numeric) to authenticated;

create or replace function public.mkta_start_event(p_event_id uuid)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
begin
  if not public.mkta_is_admin() then raise exception 'MKTA admin required'; end if;

  update public.mkta_events
  set status='live',
      rating_locked=true,
      schedule_locked=true,
      updated_at=now()
  where id=p_event_id and status='draft';

  if not found then raise exception 'event is not in draft status'; end if;
  return true;
end;
$$;

grant execute on function public.mkta_start_event(uuid) to authenticated;

create or replace function public.mkta_complete_event(p_event_id uuid)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
begin
  if not public.mkta_is_admin() then raise exception 'MKTA admin required'; end if;

  if exists(
    select 1 from public.mkta_matches
    where event_id=p_event_id and rating_applied=false
  ) then
    raise exception 'all matches must have finalized AKTR first';
  end if;

  update public.mkta_events
  set status='completed',updated_at=now()
  where id=p_event_id and status='live';

  if not found then raise exception 'event is not live'; end if;
  return true;
end;
$$;

grant execute on function public.mkta_complete_event(uuid) to authenticated;

create or replace function public.mkta_finalize_match_aktr(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  m public.mkta_matches%rowtype;
  ev public.mkta_events%rowtype;
  a_ids uuid[];
  b_ids uuid[];
  ids uuid[];
  before_ratings integer[]:=array[]::integer[];
  games_counts integer[]:=array[]::integer[];
  base_deltas integer[]:=array[]::integer[];
  final_deltas integer[]:=array[]::integer[];
  wins_flags boolean[]:=array[]::boolean[];
  i integer;
  n integer;
  before_r integer;
  games_played integer;
  oppavg numeric;
  k numeric;
  share numeric;
  exp numeric;
  base_d integer;
  final_d integer;
  won boolean;
begin
  if not public.mkta_is_admin() then raise exception 'MKTA admin required'; end if;

  select * into m from public.mkta_matches where id=p_match_id for update;
  if m.id is null then raise exception 'match not found'; end if;
  if m.rating_applied then raise exception 'AKTR already finalized'; end if;
  if m.score_a is null or m.score_b is null or m.winner is null then raise exception 'save score first'; end if;

  select * into ev from public.mkta_events where id=m.event_id for update;
  if ev.status<>'live' then raise exception 'event must be live'; end if;

  select array_agg(member_id order by slot) into a_ids
  from public.mkta_match_players where match_id=p_match_id and side='A';
  select array_agg(member_id order by slot) into b_ids
  from public.mkta_match_players where match_id=p_match_id and side='B';

  if coalesce(array_length(a_ids,1),0)<>2 or coalesce(array_length(b_ids,1),0)<>2 then
    raise exception 'both doubles teams need two players';
  end if;

  ids:=a_ids||b_ids;
  n:=4;

  for i in 1..n loop
    select rating,wins+losses
    into before_r,games_played
    from public.members
    where id=ids[i];

    if before_r is null then raise exception 'member not found'; end if;
    before_ratings:=before_ratings||before_r;
    games_counts:=games_counts||games_played;
  end loop;

  -- SAME AKTR FORMULA AS THE FOUR CLUB SITES.
  -- Only the final delta is multiplied by the MKTA event multiplier.
  for i in 1..n loop
    before_r:=before_ratings[i];
    games_played:=games_counts[i];

    if ids[i]=any(a_ids) then
      select avg(before_ratings[jj]) into oppavg
      from generate_subscripts(ids,1) as g(jj)
      where ids[jj]=any(b_ids);
      share:=m.score_a::numeric/(m.score_a+m.score_b);
      won:=m.score_a>m.score_b;
    else
      select avg(before_ratings[jj]) into oppavg
      from generate_subscripts(ids,1) as g(jj)
      where ids[jj]=any(a_ids);
      share:=m.score_b::numeric/(m.score_a+m.score_b);
      won:=m.score_b>m.score_a;
    end if;

    k:=case
      when games_played<=5 then 40
      when games_played<=15 then 34
      when games_played<=30 then 28
      else 24
    end;

    exp:=1/(1+power(10,(oppavg-before_r)/400.0));
    base_d:=round(k*1.25*(share-exp));
    final_d:=round(base_d*ev.rating_multiplier);

    base_deltas:=base_deltas||base_d;
    final_deltas:=final_deltas||final_d;
    wins_flags:=wins_flags||won;
  end loop;

  for i in 1..n loop
    update public.members
    set rating=before_ratings[i]+final_deltas[i],
        wins=wins+case when wins_flags[i] then 1 else 0 end,
        losses=losses+case when wins_flags[i] then 0 else 1 end
    where id=ids[i];

    insert into public.mkta_rating_changes(
      match_id,member_id,side,won,rating_before,base_delta,multiplier,final_delta,rating_after
    ) values(
      p_match_id,
      ids[i],
      case when ids[i]=any(a_ids) then 'A' else 'B' end,
      wins_flags[i],
      before_ratings[i],
      base_deltas[i],
      ev.rating_multiplier,
      final_deltas[i],
      before_ratings[i]+final_deltas[i]
    );

    -- Keep the existing four club AKTR timeline compatible.
    -- event_type remains 'manual' so existing club sites can display the change
    -- without changing their current code. source_type/source_ref identify it
    -- as an MKTA official match.
    insert into public.otr_events(
      club_id,member_id,match_id,event_type,
      rating_before,rating_after,delta,note,source_type,source_ref
    ) values(
      '55555555-5555-4555-8555-555555555555',
      ids[i],
      null,
      'manual',
      before_ratings[i],
      before_ratings[i]+final_deltas[i],
      final_deltas[i],
      'MKTA 공식경기 · 기본 '||
        case when base_deltas[i]>=0 then '+' else '' end||base_deltas[i]||
        ' ×'||trim(to_char(ev.rating_multiplier,'FM9.00'))||
        ' = '||case when final_deltas[i]>=0 then '+' else '' end||final_deltas[i]||
        ' · '||m.score_a||'-'||m.score_b,
      'mkta_match',
      p_match_id
    );
  end loop;

  update public.mkta_matches
  set status='final',
      rating_applied=true,
      rating_applied_at=now()
  where id=p_match_id;

  return jsonb_build_object(
    'ok',true,
    'multiplier',ev.rating_multiplier,
    'match_id',p_match_id
  );
end;
$$;

grant execute on function public.mkta_finalize_match_aktr(uuid) to authenticated;

-- RLS ----------------------------------------------------------------
alter table public.mkta_admins enable row level security;
revoke all on public.mkta_admins from anon;
grant select,insert,update,delete on public.mkta_admins to authenticated;
drop policy if exists mkta_admins_system_read on public.mkta_admins;
drop policy if exists mkta_admins_system_write on public.mkta_admins;
create policy mkta_admins_system_read on public.mkta_admins
for select to authenticated using(public.is_system_admin() or user_id=auth.uid());
create policy mkta_admins_system_write on public.mkta_admins
for all to authenticated using(public.is_system_admin()) with check(public.is_system_admin());

do $$
declare
  t text;
begin
  foreach t in array array[
    'mkta_events','mkta_event_teams','mkta_event_team_clubs',
    'mkta_divisions','mkta_matches','mkta_match_players','mkta_rating_changes'
  ]
  loop
    execute format('alter table public.%I enable row level security',t);
    execute format('grant select on public.%I to anon,authenticated',t);
    execute format('grant insert,update,delete on public.%I to authenticated',t);

    execute format('drop policy if exists %I on public.%I',t||'_public_read',t);
    execute format('drop policy if exists %I on public.%I',t||'_admin_insert',t);
    execute format('drop policy if exists %I on public.%I',t||'_admin_update',t);
    execute format('drop policy if exists %I on public.%I',t||'_admin_delete',t);

    execute format(
      'create policy %I on public.%I for select to anon,authenticated using(true)',
      t||'_public_read',t
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check(public.mkta_is_admin())',
      t||'_admin_insert',t
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using(public.mkta_is_admin()) with check(public.mkta_is_admin())',
      t||'_admin_update',t
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using(public.mkta_is_admin())',
      t||'_admin_delete',t
    );
  end loop;
end $$;

-- Seed first MKTA event ------------------------------------------------
insert into public.mkta_events(
  id,name,event_date,venue,status,rating_multiplier,rating_locked,schedule_locked
)
values(
  '66666666-6666-4666-8666-666666666666',
  '2026 MKTA 클럽대항전',
  null,
  null,
  'draft',
  1.50,
  false,
  false
)
on conflict(id) do nothing;

insert into public.mkta_event_teams(id,event_id,code,name,short_name,display_order,color)
values
('77777777-7777-4777-8777-777777777771','66666666-6666-4666-8666-666666666666','COMBINED','OCTC + MKTC 연합팀','OCTC+MKTC',1,'#2F6FA3'),
('77777777-7777-4777-8777-777777777772','66666666-6666-4666-8666-666666666666','VKTC','Victoria Korean Tennis Club','VKTC',2,'#69B9E6'),
('77777777-7777-4777-8777-777777777773','66666666-6666-4666-8666-666666666666','WKTC','Wellington Korean Tennis Club','WKTC',3,'#B75F18')
on conflict(event_id,code) do update
set name=excluded.name,short_name=excluded.short_name,display_order=excluded.display_order,color=excluded.color;

insert into public.mkta_event_team_clubs(event_team_id,club_id)
values
('77777777-7777-4777-8777-777777777771','11111111-1111-4111-8111-111111111111'),
('77777777-7777-4777-8777-777777777771','22222222-2222-4222-8222-222222222222'),
('77777777-7777-4777-8777-777777777772','33333333-3333-4333-8333-333333333333'),
('77777777-7777-4777-8777-777777777773','44444444-4444-4444-8444-444444444444')
on conflict do nothing;

insert into public.mkta_divisions(id,event_id,code,name,display_order)
values
('88888888-8888-4888-8888-888888888881','66666666-6666-4666-8666-666666666666','GOLD','금배부',1),
('88888888-8888-4888-8888-888888888882','66666666-6666-4666-8666-666666666666','SILVER','은배부',2),
('88888888-8888-4888-8888-888888888883','66666666-6666-4666-8666-666666666666','BRONZE','동배부',3)
on conflict(event_id,code) do update
set name=excluded.name,display_order=excluded.display_order;

with schedule(round_no,scheduled_time,division_code,court_no,team_a_code,team_a_label,team_b_code,team_b_label) as(
  values
  (1,'09:00'::time,'GOLD',1,'COMBINED','C','WKTC','C'),
(1,'09:00'::time,'GOLD',2,'WKTC','B','VKTC','B'),
(1,'09:00'::time,'GOLD',3,'VKTC','C','COMBINED','B'),
(1,'09:00'::time,'SILVER',4,'COMBINED','C','WKTC','C'),
(1,'09:00'::time,'SILVER',5,'WKTC','B','VKTC','B'),
(1,'09:00'::time,'SILVER',6,'VKTC','C','COMBINED','B'),
(1,'09:00'::time,'BRONZE',7,'COMBINED','C','WKTC','C'),
(1,'09:00'::time,'BRONZE',8,'WKTC','B','VKTC','B'),
(1,'09:00'::time,'BRONZE',9,'VKTC','C','COMBINED','B'),
(2,'09:45'::time,'GOLD',1,'COMBINED','C','WKTC','A'),
(2,'09:45'::time,'GOLD',2,'WKTC','C','VKTC','A'),
(2,'09:45'::time,'GOLD',3,'VKTC','C','COMBINED','A'),
(2,'09:45'::time,'SILVER',4,'COMBINED','C','WKTC','A'),
(2,'09:45'::time,'SILVER',5,'WKTC','C','VKTC','A'),
(2,'09:45'::time,'SILVER',6,'VKTC','C','COMBINED','A'),
(2,'09:45'::time,'BRONZE',7,'COMBINED','C','WKTC','A'),
(2,'09:45'::time,'BRONZE',8,'WKTC','C','VKTC','A'),
(2,'09:45'::time,'BRONZE',9,'VKTC','C','COMBINED','A'),
(3,'10:30'::time,'GOLD',1,'COMBINED','A','WKTC','B'),
(3,'10:30'::time,'GOLD',2,'WKTC','A','VKTC','B'),
(3,'10:30'::time,'GOLD',3,'VKTC','A','COMBINED','B'),
(3,'10:30'::time,'SILVER',4,'COMBINED','A','WKTC','B'),
(3,'10:30'::time,'SILVER',5,'WKTC','A','VKTC','B'),
(3,'10:30'::time,'SILVER',6,'VKTC','A','COMBINED','B'),
(3,'10:30'::time,'BRONZE',7,'COMBINED','A','WKTC','B'),
(3,'10:30'::time,'BRONZE',8,'WKTC','A','VKTC','B'),
(3,'10:30'::time,'BRONZE',9,'VKTC','A','COMBINED','B'),
(4,'11:15'::time,'GOLD',1,'COMBINED','B','WKTC','C'),
(4,'11:15'::time,'GOLD',2,'WKTC','B','VKTC','C'),
(4,'11:15'::time,'GOLD',3,'VKTC','B','COMBINED','C'),
(4,'11:15'::time,'SILVER',4,'COMBINED','B','WKTC','C'),
(4,'11:15'::time,'SILVER',5,'WKTC','B','VKTC','C'),
(4,'11:15'::time,'SILVER',6,'VKTC','B','COMBINED','C'),
(4,'11:15'::time,'BRONZE',7,'COMBINED','B','WKTC','C'),
(4,'11:15'::time,'BRONZE',8,'WKTC','B','VKTC','C'),
(4,'11:15'::time,'BRONZE',9,'VKTC','B','COMBINED','C'),
(5,'12:00'::time,'GOLD',1,'COMBINED','A','WKTC','C'),
(5,'12:00'::time,'GOLD',2,'WKTC','A','VKTC','C'),
(5,'12:00'::time,'GOLD',3,'VKTC','A','COMBINED','C'),
(5,'12:00'::time,'SILVER',4,'COMBINED','A','WKTC','C'),
(5,'12:00'::time,'SILVER',5,'WKTC','A','VKTC','C'),
(5,'12:00'::time,'SILVER',6,'VKTC','A','COMBINED','C'),
(5,'12:00'::time,'BRONZE',7,'COMBINED','A','WKTC','C'),
(5,'12:00'::time,'BRONZE',8,'WKTC','A','VKTC','C'),
(5,'12:00'::time,'BRONZE',9,'VKTC','A','COMBINED','C'),
(6,'12:45'::time,'GOLD',1,'COMBINED','A','WKTC','A'),
(6,'12:45'::time,'GOLD',2,'WKTC','A','VKTC','B'),
(6,'12:45'::time,'GOLD',3,'VKTC','B','COMBINED','B'),
(6,'12:45'::time,'SILVER',4,'COMBINED','A','WKTC','A'),
(6,'12:45'::time,'SILVER',5,'WKTC','A','VKTC','B'),
(6,'12:45'::time,'SILVER',6,'VKTC','B','COMBINED','B'),
(6,'12:45'::time,'BRONZE',7,'COMBINED','A','WKTC','A'),
(6,'12:45'::time,'BRONZE',8,'WKTC','A','VKTC','B'),
(6,'12:45'::time,'BRONZE',9,'VKTC','B','COMBINED','B'),
(7,'13:30'::time,'GOLD',1,'COMBINED','B','WKTC','C'),
(7,'13:30'::time,'GOLD',2,'WKTC','C','VKTC','C'),
(7,'13:30'::time,'GOLD',3,'VKTC','C','COMBINED','C'),
(7,'13:30'::time,'SILVER',4,'COMBINED','B','WKTC','C'),
(7,'13:30'::time,'SILVER',5,'WKTC','C','VKTC','C'),
(7,'13:30'::time,'SILVER',6,'VKTC','C','COMBINED','C'),
(7,'13:30'::time,'BRONZE',7,'COMBINED','B','WKTC','C'),
(7,'13:30'::time,'BRONZE',8,'WKTC','C','VKTC','C'),
(7,'13:30'::time,'BRONZE',9,'VKTC','C','COMBINED','C'),
(8,'14:15'::time,'GOLD',1,'COMBINED','C','WKTC','A'),
(8,'14:15'::time,'GOLD',2,'WKTC','C','VKTC','C'),
(8,'14:15'::time,'GOLD',3,'VKTC','A','COMBINED','A'),
(8,'14:15'::time,'SILVER',4,'COMBINED','C','WKTC','A'),
(8,'14:15'::time,'SILVER',5,'WKTC','C','VKTC','C'),
(8,'14:15'::time,'SILVER',6,'VKTC','A','COMBINED','A'),
(8,'14:15'::time,'BRONZE',7,'COMBINED','C','WKTC','A'),
(8,'14:15'::time,'BRONZE',8,'WKTC','C','VKTC','C'),
(8,'14:15'::time,'BRONZE',9,'VKTC','A','COMBINED','A'),
(9,'15:00'::time,'GOLD',1,'COMBINED','B','WKTC','B'),
(9,'15:00'::time,'GOLD',2,'WKTC','A','VKTC','A'),
(9,'15:00'::time,'GOLD',3,'VKTC','B','COMBINED','A'),
(9,'15:00'::time,'SILVER',4,'COMBINED','B','WKTC','B'),
(9,'15:00'::time,'SILVER',5,'WKTC','A','VKTC','A'),
(9,'15:00'::time,'SILVER',6,'VKTC','B','COMBINED','A'),
(9,'15:00'::time,'BRONZE',7,'COMBINED','B','WKTC','A'),
(9,'15:00'::time,'BRONZE',8,'WKTC','B','VKTC','A'),
(9,'15:00'::time,'BRONZE',9,'VKTC','B','COMBINED','A')
)
insert into public.mkta_matches(
  event_id,division_id,round_no,scheduled_time,court_no,
  team_a_id,team_a_label,team_b_id,team_b_label
)
select
  '66666666-6666-4666-8666-666666666666',
  d.id,
  s.round_no,
  s.scheduled_time,
  s.court_no,
  ta.id,
  s.team_a_label,
  tb.id,
  s.team_b_label
from schedule s
join public.mkta_divisions d
  on d.event_id='66666666-6666-4666-8666-666666666666'
 and d.code=s.division_code
join public.mkta_event_teams ta
  on ta.event_id='66666666-6666-4666-8666-666666666666'
 and ta.code=s.team_a_code
join public.mkta_event_teams tb
  on tb.event_id='66666666-6666-4666-8666-666666666666'
 and tb.code=s.team_b_code
on conflict(event_id,round_no,court_no) do update
set division_id=excluded.division_id,
    scheduled_time=excluded.scheduled_time,
    team_a_id=excluded.team_a_id,
    team_a_label=excluded.team_a_label,
    team_b_id=excluded.team_b_id,
    team_b_label=excluded.team_b_label;

commit;
