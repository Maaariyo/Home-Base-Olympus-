-- Home Base (Olympus) schema. Paste into Supabase: SQL Editor -> New query -> Run.
-- Every table is private to its owner: Row Level Security allows only rows where user_id = auth.uid().
-- Safe to re-run: tables are created only if missing; policies and triggers are replaced.

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create table if not exists public.terms (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  start_date date not null,
  end_date date not null,
  track_from date not null,
  holidays jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date),
  check (track_from between start_date and end_date)
);

create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  term_id uuid not null references public.terms on delete cascade,
  name text not null,
  code text not null default '',
  color text not null,
  target_pct int check (target_pct between 50 and 95),
  opening_held int not null default 0 check (opening_held >= 0),
  opening_attended int not null default 0 check (opening_attended between 0 and opening_held),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Assessed components of a subject (quiz, mid-term, project). Score stays null until marked.
create table if not exists public.grade_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  subject_id uuid not null references public.subjects on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  weight numeric not null check (weight > 0 and weight <= 100),
  max_score numeric not null check (max_score > 0),
  score numeric check (score >= 0 and score <= max_score),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.slots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  subject_id uuid not null references public.subjects on delete cascade,
  day int not null check (day between 1 and 7),
  start_time text not null check (start_time ~ '^\d\d:\d\d$'),
  end_time text not null check (end_time ~ '^\d\d:\d\d$' and end_time > start_time),
  room text not null default '',
  kind text not null check (kind in ('LECTURE', 'TUTORIAL', 'LAB')),
  weight int not null default 1 check (weight in (1, 2)),
  effective_from date not null,
  effective_to date check (effective_to is null or effective_to >= effective_from - 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Marks for timetable sessions (slot_id set, one per slot per date) and extra classes (slot_id null).
create table if not exists public.marks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  subject_id uuid not null references public.subjects on delete cascade,
  slot_id uuid references public.slots on delete cascade,
  date date not null,
  start_time text not null check (start_time ~ '^\d\d:\d\d$'),
  end_time text not null check (end_time ~ '^\d\d:\d\d$'),
  weight int not null default 1 check (weight in (1, 2)),
  status text not null check (status in ('UNMARKED', 'PRESENT', 'ABSENT', 'CANCELLED', 'DUTY_LEAVE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (slot_id, date)
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  notes text not null default '',
  due_at timestamptz not null,
  assignees text[] not null default '{}',
  reminders jsonb not null default '[]',
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  notes text not null default '',
  category text not null check (category in ('ACADEMIC', 'SOCIAL', 'OTHER')),
  start_at timestamptz not null,
  end_at timestamptz not null check (end_at > start_at),
  all_day boolean not null default false,
  location text not null default '',
  repeat text not null default 'NONE' check (repeat in ('NONE', 'DAILY', 'WEEKLY', 'MONTHLY')),
  repeat_until date,
  skip_dates jsonb not null default '[]',
  reminders jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.events add column if not exists skip_dates jsonb not null default '[]';

create table if not exists public.settings (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

-- Reminder queue. The browser writes planned rows; the `push` function sends due ones every minute.
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  key text not null,
  fire_at timestamptz not null,
  kind text not null,
  owner_id uuid not null,
  title text not null,
  body text not null default '',
  url text not null default '/',
  payload jsonb,
  source text not null default 'plan' check (source in ('plan', 'snooze')),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, key)
);
create index if not exists notifications_due on public.notifications (fire_at) where sent_at is null;
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in ('TASK', 'EVENT', 'CLASS', 'DIGEST'));

-- The secret address of each user's calendar feed (supabase/functions/calendar). Anyone holding the link can
-- read the feed, so Settings can replace the token, which kills the old link.
create table if not exists public.calendar_feeds (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  time_zone text not null default 'UTC',
  created_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['terms', 'subjects', 'grade_items', 'slots', 'marks', 'tasks', 'events', 'settings', 'push_subscriptions', 'notifications', 'calendar_feeds'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists own_rows on public.%I', t);
    execute format('create policy own_rows on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
  -- updated_at drives the "changed on another device" check, so the database owns it.
  foreach t in array array['terms', 'subjects', 'grade_items', 'slots', 'marks', 'tasks', 'events', 'settings'] loop
    execute format('drop trigger if exists touch on public.%I', t);
    execute format('create trigger touch before update on public.%I for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;
