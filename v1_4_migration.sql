-- MKTA V1.4
-- 1) MKTA admin access is restricted to exactly two accounts:
--    - owner: entjq87@mail.com
--    - second admin: clemens@jsme.com.au
--    Other club admins / system admins do NOT inherit MKTA admin access.
-- 2) Includes combined player match history RPC:
--    OCTC + MKTC + VKTC + WKTC + MKTA official events.
--
-- IMPORTANT:
-- Run this migration BEFORE deploying the V1.4 frontend.

begin;

-- -------------------------------------------------------------------
-- MKTA ADMIN SECURITY (FIXED 2 ACCOUNTS)
-- -------------------------------------------------------------------
create or replace function public.mkta_is_admin()
returns boolean
language sql
security definer
set search_path=public,auth
stable
as $$
  select exists(
    select 1
    from auth.users u
    where u.id=auth.uid()
      and lower(coalesce(u.email,'')) in ('entjq87@mail.com','clemens@jsme.com.au')
  );
$$;

revoke all on function public.mkta_is_admin() from public, anon;
grant execute on function public.mkta_is_admin() to authenticated;

create or replace function public.mkta_admin_access()
returns jsonb
language plpgsql
security definer
set search_path=public,auth
stable
as $$
declare
  v_email text;
  v_owner boolean:=false;
  v_second boolean:=false;
begin
  select lower(coalesce(email,'')) into v_email
  from auth.users
  where id=auth.uid();

  v_owner:=coalesce(v_email,'')='entjq87@mail.com';
  v_second:=coalesce(v_email,'')='clemens@jsme.com.au';

  return jsonb_build_object(
    'allowed',v_owner or v_second,
    'owner',v_owner,
    'role',case when v_owner then 'owner' when v_second then 'admin' else null end,
    'email',v_email
  );
end;
$$;

revoke all on function public.mkta_admin_access() from public, anon;
grant execute on function public.mkta_admin_access() to authenticated;

create or replace function public.mkta_admin_list()
returns jsonb
language plpgsql
security definer
set search_path=public,auth
stable
as $$
begin
  if not public.mkta_is_admin() then
    raise exception 'MKTA admin required';
  end if;

  return jsonb_build_object(
    'owner_email','entjq87@mail.com',
    'second_email','clemens@jsme.com.au'
  );
end;
$$;

revoke all on function public.mkta_admin_list() from public, anon;
grant execute on function public.mkta_admin_list() to authenticated;

-- -------------------------------------------------------------------
-- GLOBAL PLAYER MATCH HISTORY
-- -------------------------------------------------------------------
create or replace function public.mkta_player_match_history(p_member_id uuid)
returns table(
  source_type text,
  source_name text,
  match_id uuid,
  played_date date,
  played_time time without time zone,
  competition text,
  match_type text,
  match_format text,
  team_for text,
  team_against text,
  partner_id uuid,
  partner_name text,
  opponent_1_id uuid,
  opponent_1_name text,
  opponent_2_id uuid,
  opponent_2_name text,
  score_for integer,
  score_against integer,
  won boolean,
  aktr_delta integer,
  aktr_before integer,
  aktr_after integer
)
language sql
security definer
set search_path=public
stable
as $$
with club_rows as(
  select
    'club'::text as source_type,
    case m.club_id
      when '11111111-1111-4111-8111-111111111111'::uuid then 'OCTC'
      when '22222222-2222-4222-8222-222222222222'::uuid then 'MKTC'
      when '33333333-3333-4333-8333-333333333333'::uuid then 'VKTC'
      when '44444444-4444-4444-8444-444444444444'::uuid then 'WKTC'
      else coalesce(c.short_name,c.name,'CLUB')
    end::text as source_name,
    m.id as match_id,
    s.session_date as played_date,
    s.start_time::time as played_time,
    (
      case m.club_id
        when '11111111-1111-4111-8111-111111111111'::uuid then 'OCTC'
        when '22222222-2222-4222-8222-222222222222'::uuid then 'MKTC'
        when '33333333-3333-4333-8333-333333333333'::uuid then 'VKTC'
        when '44444444-4444-4444-8444-444444444444'::uuid then 'WKTC'
        else coalesce(c.short_name,c.name,'CLUB')
      end
      || case when coalesce(s.match_type,'friendly')='season' then ' 시즌경기' else ' 클럽경기' end
    )::text as competition,
    coalesce(s.match_type,'friendly')::text as match_type,
    coalesce(m.match_format,'doubles')::text as match_format,
    case m.club_id
      when '11111111-1111-4111-8111-111111111111'::uuid then 'OCTC'
      when '22222222-2222-4222-8222-222222222222'::uuid then 'MKTC'
      when '33333333-3333-4333-8333-333333333333'::uuid then 'VKTC'
      when '44444444-4444-4444-8444-444444444444'::uuid then 'WKTC'
      else coalesce(c.short_name,c.name,'CLUB')
    end::text as team_for,
    null::text as team_against,
    partner.id as partner_id,
    partner.name::text as partner_name,
    opp1.id as opponent_1_id,
    opp1.name::text as opponent_1_name,
    opp2.id as opponent_2_id,
    opp2.name::text as opponent_2_name,
    (case
      when p_member_id in (m.team_a_member_1,m.team_a_member_2) then m.score_a
      else m.score_b
    end)::integer as score_for,
    (case
      when p_member_id in (m.team_a_member_1,m.team_a_member_2) then m.score_b
      else m.score_a
    end)::integer as score_against,
    (case
      when p_member_id in (m.team_a_member_1,m.team_a_member_2) then m.winner='A'
      else m.winner='B'
    end)::boolean as won,
    oe.delta::integer as aktr_delta,
    oe.rating_before::integer as aktr_before,
    oe.rating_after::integer as aktr_after
  from public.matches m
  join public.sessions s on s.id=m.session_id
  left join public.clubs c on c.id=m.club_id
  left join public.members partner
    on partner.id=case
      when p_member_id=m.team_a_member_1 then m.team_a_member_2
      when p_member_id=m.team_a_member_2 then m.team_a_member_1
      when p_member_id=m.team_b_member_1 then m.team_b_member_2
      when p_member_id=m.team_b_member_2 then m.team_b_member_1
      else null
    end
  left join public.members opp1
    on opp1.id=case
      when p_member_id in (m.team_a_member_1,m.team_a_member_2) then m.team_b_member_1
      else m.team_a_member_1
    end
  left join public.members opp2
    on opp2.id=case
      when p_member_id in (m.team_a_member_1,m.team_a_member_2) then m.team_b_member_2
      else m.team_a_member_2
    end
  left join lateral(
    select e.delta,e.rating_before,e.rating_after
    from public.otr_events e
    where e.match_id=m.id
      and e.member_id=p_member_id
      and e.event_type='match'
    order by e.created_at desc,e.id desc
    limit 1
  ) oe on true
  where m.club_id in(
    '11111111-1111-4111-8111-111111111111'::uuid,
    '22222222-2222-4222-8222-222222222222'::uuid,
    '33333333-3333-4333-8333-333333333333'::uuid,
    '44444444-4444-4444-8444-444444444444'::uuid
  )
    and p_member_id in(
      m.team_a_member_1,m.team_a_member_2,
      m.team_b_member_1,m.team_b_member_2
    )
    and m.winner in('A','B')
    and m.score_a is not null
    and m.score_b is not null
),
mkta_rows as(
  select
    'mkta'::text as source_type,
    'MKTA'::text as source_name,
    m.id as match_id,
    ev.event_date as played_date,
    m.scheduled_time::time as played_time,
    (ev.name||' · '||d.name)::text as competition,
    'mkta'::text as match_type,
    'doubles'::text as match_format,
    own_team.short_name::text as team_for,
    opp_team.short_name::text as team_against,
    partner.member_id as partner_id,
    partner.name::text as partner_name,
    opp1.member_id as opponent_1_id,
    opp1.name::text as opponent_1_name,
    opp2.member_id as opponent_2_id,
    opp2.name::text as opponent_2_name,
    (case when self.side='A' then m.score_a else m.score_b end)::integer as score_for,
    (case when self.side='A' then m.score_b else m.score_a end)::integer as score_against,
    (case when self.side='A' then m.winner='A' else m.winner='B' end)::boolean as won,
    rc.final_delta::integer as aktr_delta,
    rc.rating_before::integer as aktr_before,
    rc.rating_after::integer as aktr_after
  from public.mkta_match_players self
  join public.mkta_matches m on m.id=self.match_id
  join public.mkta_events ev on ev.id=m.event_id
  join public.mkta_divisions d on d.id=m.division_id
  join public.mkta_event_teams own_team
    on own_team.id=case when self.side='A' then m.team_a_id else m.team_b_id end
  join public.mkta_event_teams opp_team
    on opp_team.id=case when self.side='A' then m.team_b_id else m.team_a_id end
  left join lateral(
    select mp.member_id,mem.name
    from public.mkta_match_players mp
    join public.members mem on mem.id=mp.member_id
    where mp.match_id=m.id
      and mp.side=self.side
      and mp.member_id<>self.member_id
    order by mp.slot
    limit 1
  ) partner on true
  left join lateral(
    select mp.member_id,mem.name
    from public.mkta_match_players mp
    join public.members mem on mem.id=mp.member_id
    where mp.match_id=m.id
      and mp.side<>self.side
    order by mp.slot
    limit 1
  ) opp1 on true
  left join lateral(
    select mp.member_id,mem.name
    from public.mkta_match_players mp
    join public.members mem on mem.id=mp.member_id
    where mp.match_id=m.id
      and mp.side<>self.side
    order by mp.slot
    offset 1
    limit 1
  ) opp2 on true
  left join public.mkta_rating_changes rc
    on rc.match_id=m.id
   and rc.member_id=self.member_id
  where self.member_id=p_member_id
    and m.winner in('A','B')
    and m.score_a is not null
    and m.score_b is not null
)
select *
from(
  select * from club_rows
  union all
  select * from mkta_rows
) all_rows
order by
  played_date desc nulls last,
  played_time desc nulls last,
  match_id desc;
$$;

revoke all on function public.mkta_player_match_history(uuid) from public;
grant execute on function public.mkta_player_match_history(uuid) to anon, authenticated;

commit;
