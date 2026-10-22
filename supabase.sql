-- AgitChess starter schema
-- Supabase Dashboard > SQL Editor > New query > paste and Run.
-- Enable Anonymous Sign-Ins first: Authentication > Sign In / Providers (or Auth settings) > Anonymous Sign-Ins.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null check (username ~ '^[a-z0-9_]{3,24}$'),
  role text not null default 'player' check (role in ('player','admin')),
  is_banned boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  created_at timestamptz not null default now(),
  check (sender_id <> receiver_id),
  unique(sender_id,receiver_id)
);
create table if not exists public.friendships (
  user1_id uuid not null references public.profiles(id) on delete cascade,
  user2_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user1_id,user2_id),
  check(user1_id <> user2_id)
);
create table if not exists public.game_rooms (
  id uuid primary key default gen_random_uuid(),
  invite_code text unique not null default encode(gen_random_bytes(8),'hex'),
  white_player uuid references public.profiles(id) on delete set null,
  black_player uuid references public.profiles(id) on delete set null,
  status text not null default 'waiting' check(status in ('waiting','playing','finished')),
  created_at timestamptz not null default now()
);
create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'upcoming' check(status in ('upcoming','live','finished')),
  starts_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.tournament_players (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key(tournament_id,player_id)
);

alter table public.profiles enable row level security;
alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;
alter table public.game_rooms enable row level security;
alter table public.tournaments enable row level security;
alter table public.tournament_players enable row level security;

-- Profiles: public username lookup, but a user can create/update only their own username.
drop policy if exists "profiles are searchable" on public.profiles;
create policy "profiles are searchable" on public.profiles for select to authenticated using (true);
drop policy if exists "insert own profile" on public.profiles;
create policy "insert own profile" on public.profiles for insert to authenticated with check (id = auth.uid());
drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Prevent a profile owner from changing role or ban status themselves.
create or replace function public.guard_profile_privileges()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  if auth.uid() is not null and old.id = auth.uid() then
    if new.role is distinct from old.role or new.is_banned is distinct from old.is_banned then
      raise exception 'You cannot change role or ban status';
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists guard_profile_privileges on public.profiles;
create trigger guard_profile_privileges before update on public.profiles
for each row execute function public.guard_profile_privileges();

-- Atomic first-claim rule: first account that successfully claims username "agitchess"
-- becomes admin, if no admin exists yet. This is the requested behavior, but it means
-- the first claimant must be you; do not publish the site until you claim it.
create or replace function public.bootstrap_agitchess_admin()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  if lower(new.username) = 'agitchess' then
    perform pg_advisory_xact_lock(73190422);
    if not exists(select 1 from public.profiles where role='admin' and id<>new.id) then
      new.role := 'admin';
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists bootstrap_agitchess_admin on public.profiles;
create trigger bootstrap_agitchess_admin before insert on public.profiles
for each row execute function public.bootstrap_agitchess_admin();

-- Friend requests: sender may create their own; either involved user can read.
drop policy if exists "read involved friend requests" on public.friend_requests;
create policy "read involved friend requests" on public.friend_requests for select to authenticated
using (sender_id=auth.uid() or receiver_id=auth.uid());
drop policy if exists "send own friend request" on public.friend_requests;
create policy "send own friend request" on public.friend_requests for insert to authenticated
with check(sender_id=auth.uid() and sender_id<>receiver_id);
drop policy if exists "receiver can respond" on public.friend_requests;
create policy "receiver can respond" on public.friend_requests for update to authenticated
using(receiver_id=auth.uid()) with check(receiver_id=auth.uid() and status in ('accepted','rejected'));

create or replace function public.accept_friend_request(request_id uuid)
returns void language plpgsql security definer set search_path=public
as $$
declare r public.friend_requests%rowtype; a uuid; b uuid;
begin
 select * into r from public.friend_requests where id=request_id and receiver_id=auth.uid() and status='pending' for update;
 if not found then raise exception 'Request not found'; end if;
 update public.friend_requests set status='accepted' where id=request_id;
 a := least(r.sender_id,r.receiver_id); b := greatest(r.sender_id,r.receiver_id);
 insert into public.friendships(user1_id,user2_id) values(a,b) on conflict do nothing;
end; $$;
grant execute on function public.accept_friend_request(uuid) to authenticated;

drop policy if exists "read own friendships" on public.friendships;
create policy "read own friendships" on public.friendships for select to authenticated
using(user1_id=auth.uid() or user2_id=auth.uid());

-- Rooms: participants can see rooms; signed-in user can create their own room.
drop policy if exists "read rooms" on public.game_rooms;
create policy "read rooms" on public.game_rooms for select to authenticated
using(white_player=auth.uid() or black_player=auth.uid());
drop policy if exists "create own room" on public.game_rooms;
create policy "create own room" on public.game_rooms for insert to authenticated
with check(white_player=auth.uid());

-- Tournaments are readable; users can register only themselves.
drop policy if exists "read tournaments" on public.tournaments;
create policy "read tournaments" on public.tournaments for select to authenticated using(true);
drop policy if exists "read tournament players" on public.tournament_players;
create policy "read tournament players" on public.tournament_players for select to authenticated using(true);
drop policy if exists "join tournament as self" on public.tournament_players;
create policy "join tournament as self" on public.tournament_players for insert to authenticated
with check(player_id=auth.uid());
-- Admin-only user listing and ban RPCs.
create or replace function public.admin_list_profiles()
returns table(id uuid, username text, role text, is_banned boolean, created_at timestamptz)
language plpgsql security definer set search_path=public
as $$
begin
 if not exists(select 1 from public.profiles where profiles.id=auth.uid() and profiles.role='admin' and not profiles.is_banned) then
   raise exception 'Admin only';
 end if;
 return query select p.id,p.username,p.role,p.is_banned,p.created_at from public.profiles p order by p.created_at;
end; $$;
create or replace function public.admin_set_ban(target_user uuid, ban_value boolean)
returns void language plpgsql security definer set search_path=public
as $$
begin
 if not exists(select 1 from public.profiles where profiles.id=auth.uid() and profiles.role='admin' and not profiles.is_banned) then
   raise exception 'Admin only';
 end if;
 if target_user=auth.uid() then raise exception 'Cannot ban yourself'; end if;
 update public.profiles set is_banned=ban_value where id=target_user;
end; $$;
grant execute on function public.admin_list_profiles() to authenticated;
grant execute on function public.admin_set_ban(uuid,boolean) to authenticated;

-- For this starter, the browser app needs to list all public usernames for lookup.
-- Anonymous sign-ins use the authenticated database role after sign-in.
