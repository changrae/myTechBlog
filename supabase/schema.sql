-- devlog Supabase schema
-- Supabase 대시보드 → SQL Editor에 전체를 붙여 넣고 Run 하세요. 여러 번 실행해도 안전합니다.
--
-- 권한 모델
--   읽기: 누구나(로그인 없이) 모든 글을 읽을 수 있습니다.
--   쓰기: 로그인한 사용자는 자기 글만 작성·수정·삭제할 수 있습니다.
--   자동 게시(github-trending): GitHub Actions가 service_role 키로만 넣습니다(RLS 우회).

-- ---------------------------------------------------------------------------
-- profiles: 화면에 표시할 사용자 이름. auth.users 생성 시 트리거로 자동 생성됩니다.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    username text not null unique
        check (username ~ '^[A-Za-z0-9_.-]{3,30}$'),
    created_at timestamptz not null default now()
);

-- 대소문자만 다른 중복 이름을 막습니다.
create unique index if not exists profiles_username_lower_idx
    on public.profiles (lower(username));

alter table public.profiles enable row level security;

drop policy if exists "profiles are readable by everyone" on public.profiles;
create policy "profiles are readable by everyone"
    on public.profiles for select
    to anon, authenticated
    using (true);
-- insert/update/delete 정책이 없으므로 클라이언트는 profiles를 바꿀 수 없습니다(트리거만 생성).

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.profiles (id, username)
    values (new.id, new.raw_user_meta_data ->> 'username');
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- posts
-- ---------------------------------------------------------------------------
create table if not exists public.posts (
    id text primary key default ('post-' || gen_random_uuid()::text)
        check (id ~ '^[A-Za-z0-9_.-]{1,200}$'),
    title text not null check (char_length(btrim(title)) between 1 and 200),
    content text not null check (char_length(content) between 1 and 100000),
    author_name text not null default '익명' check (char_length(author_name) between 1 and 50),
    author_id uuid default auth.uid() references auth.users (id) on delete set null,
    source text not null default 'user' check (source in ('user', 'github-trending')),
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz
);

create index if not exists posts_created_at_idx on public.posts (created_at desc);
create index if not exists posts_author_id_idx on public.posts (author_id);

alter table public.posts enable row level security;

drop policy if exists "posts are readable by everyone" on public.posts;
create policy "posts are readable by everyone"
    on public.posts for select
    to anon, authenticated
    using (true);

drop policy if exists "users insert their own posts" on public.posts;
create policy "users insert their own posts"
    on public.posts for insert
    to authenticated
    with check (author_id = (select auth.uid()) and source = 'user');

drop policy if exists "users update their own posts" on public.posts;
create policy "users update their own posts"
    on public.posts for update
    to authenticated
    using (author_id = (select auth.uid()) and source = 'user')
    with check (author_id = (select auth.uid()) and source = 'user');

drop policy if exists "users delete their own posts" on public.posts;
create policy "users delete their own posts"
    on public.posts for delete
    to authenticated
    using (author_id = (select auth.uid()) and source = 'user');

-- 클라이언트가 보내는 값과 무관하게 작성자·시각을 서버에서 고정합니다.
create or replace function public.posts_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if tg_op = 'INSERT' then
        -- service_role(자동 게시)은 created_at을 지정할 수 있고, 일반 사용자는 이전 글 가져오기에 한해
        -- 과거 시각을 쓸 수 있지만 미래 시각은 쓸 수 없습니다.
        if new.created_at is null or new.created_at > now() then
            new.created_at := now();
        end if;
        new.updated_at := null;
    else
        new.id := old.id;
        new.author_id := old.author_id;
        new.source := old.source;
        new.created_at := old.created_at;
        new.updated_at := now();
    end if;
    return new;
end;
$$;

drop trigger if exists posts_guard on public.posts;
create trigger posts_guard
    before insert or update on public.posts
    for each row execute function public.posts_guard();

-- anon/authenticated 역할에 필요한 권한만 부여합니다(RLS가 행 단위로 다시 제한).
revoke all on public.posts from anon, authenticated;
grant select on public.posts to anon, authenticated;
grant insert (title, content, author_name, created_at) on public.posts to authenticated;
grant update (title, content, author_name) on public.posts to authenticated;
grant delete on public.posts to authenticated;

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to anon, authenticated;

-- API(PostgREST)가 새 테이블을 바로 인식하도록 스키마 캐시를 새로 고칩니다.
notify pgrst, 'reload schema';
