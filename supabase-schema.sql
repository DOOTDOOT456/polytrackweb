-- PolyTrack leaderboard schema for Supabase.
-- Run this once in the Supabase Dashboard -> SQL Editor.

create table if not exists recordings (
  id bigint generated always as identity primary key,
  version text not null,
  track_id text not null,
  user_token text not null,
  token_hash text not null,
  name text not null,
  car_colors text not null,
  frames int not null,
  recording text not null,
  verified_state int not null default 0,
  created_at bigint not null default (extract(epoch from now()) * 1000)::bigint
);
create index if not exists idx_rank on recordings (version, track_id, frames, id);
create index if not exists idx_token on recordings (token_hash);

create table if not exists users (
  user_token text primary key,
  token_hash text not null,
  name text not null,
  car_colors text not null
);

alter table recordings enable row level security;
alter table users enable row level security;

create policy "public read recordings" on recordings for select using (true);
create policy "public insert recordings" on recordings for insert with check (true);
create policy "public read users" on users for select using (true);
create policy "public insert users" on users for insert with check (true);
create policy "public update users" on users for update using (true);
