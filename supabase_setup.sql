-- 블로그봇 회원·권한 스키마 (Supabase SQL 편집기에 붙여넣고 실행)
-- 등급: admin(관리자, 무제한) / level1(원장, 월 한도) · 상태: pending(승인 대기) / approved(승인) / blocked(차단)

create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text,
  role          text not null default 'level1',   -- 'admin' | 'level1'
  status        text not null default 'pending',   -- 'pending' | 'approved' | 'blocked'
  monthly_limit int  not null default 10,           -- level1 월 초안 생성 한도 (admin은 무시)
  usage_count   int  not null default 0,            -- 이번 달 사용량
  usage_month   text default '',                    -- 'YYYY-MM'
  created_at    timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- 본인 프로필은 본인이 읽기 가능 (관리자 작업은 서버가 service_role로 처리하므로 RLS 우회)
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select using (auth.uid() = id);

-- 회원가입 시 프로필 자동 생성 (기본: 원장·승인대기)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 초안 저장 (배포 시 서버 파일은 초기화되므로 초안은 여기에 보관 · 원장별 개인 소유)
create table if not exists public.drafts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,                 -- 파일명 대체 (YYYY-MM-DD_키워드.md)
  content    text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

alter table public.drafts enable row level security;

-- 본인 초안만 읽고/쓰기 (서버는 service_role로 처리하므로 RLS 우회, 이 정책은 안전장치)
drop policy if exists "own drafts" on public.drafts;
create policy "own drafts" on public.drafts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ▼▼ 관리자 지정: 우진님 계정으로 회원가입한 뒤, 이 한 줄을 실행하세요 ▼▼
-- update public.profiles set role='admin', status='approved' where email='kwjin4039@gmail.com';
