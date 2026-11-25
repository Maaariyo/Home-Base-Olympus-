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

-- Same-owner references. Row Level Security does not apply to foreign-key checks, so without these one
-- account could attach rows to another account's term, subject or class (for example, a mark that then
-- blocks the owner from marking that class). Each child must share its parent's user_id.
do $$
declare c record;
begin
  for c in select * from (values
    ('terms', 'terms_id_user_key', 'unique (id, user_id)'),
    ('subjects', 'subjects_id_user_key', 'unique (id, user_id)'),
    ('slots', 'slots_id_user_key', 'unique (id, user_id)'),
    ('subjects', 'subjects_term_owner_fk', 'foreign key (term_id, user_id) references public.terms (id, user_id) on delete cascade'),
    ('grade_items', 'grade_items_subject_owner_fk', 'foreign key (subject_id, user_id) references public.subjects (id, user_id) on delete cascade'),
    ('slots', 'slots_subject_owner_fk', 'foreign key (subject_id, user_id) references public.subjects (id, user_id) on delete cascade'),
    ('marks', 'marks_subject_owner_fk', 'foreign key (subject_id, user_id) references public.subjects (id, user_id) on delete cascade'),
    ('marks', 'marks_slot_owner_fk', 'foreign key (slot_id, user_id) references public.slots (id, user_id) on delete cascade')
  ) as v(tbl, name, def) loop
    if not exists (select 1 from pg_constraint where conname = c.name) then
      execute format('alter table public.%I add constraint %I %s', c.tbl, c.name, c.def);
    end if;
  end loop;
end $$;

-- Reminder queue hardening. Accounts may read, add and remove their own planned reminders, but never
-- edit them or mark them sent: only the push function (service role) does that.
drop policy if exists own_rows on public.notifications;
drop policy if exists own_select on public.notifications;
drop policy if exists own_insert on public.notifications;
drop policy if exists own_delete on public.notifications;
create policy own_select on public.notifications for select to authenticated using (user_id = auth.uid());
create policy own_insert on public.notifications for insert to authenticated with check (user_id = auth.uid());
create policy own_delete on public.notifications for delete to authenticated using (user_id = auth.uid());
create index if not exists notifications_user_unsent on public.notifications (user_id) where sent_at is null;

-- A planned reminder must be unsent, not in the past, and one account cannot flood the shared queue.
create or replace function public.check_notification() returns trigger language plpgsql as $$
begin
  if current_user = 'authenticated' then
    new.sent_at := null;
    if new.fire_at < now() - interval '1 minute' then
      raise exception 'Reminder time is in the past' using errcode = 'check_violation';
    end if;
    if (select count(*) from public.notifications where user_id = new.user_id and sent_at is null) >= 3000 then
      raise exception 'Too many reminders planned' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists check_notification on public.notifications;
create trigger check_notification before insert on public.notifications for each row execute function public.check_notification();

-- Push endpoints: HTTPS on a known browser push service only (the push function checks the same list).
-- NOT VALID: checks new and changed rows without failing a re-run on rows saved before this rule.
alter table public.push_subscriptions drop constraint if exists push_subscriptions_https;
alter table public.push_subscriptions drop constraint if exists push_subscriptions_host;
alter table public.push_subscriptions add constraint push_subscriptions_host check (
  endpoint ~ '^https://(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)/'
  and char_length(endpoint) <= 1000 and char_length(p256dh) <= 200 and char_length(auth) <= 100
) not valid;

-- At most 10 devices per account.
create or replace function public.check_push_subscription() returns trigger language plpgsql as $$
begin
  if current_user = 'authenticated' and (select count(*) from public.push_subscriptions where user_id = new.user_id) >= 10 then
    raise exception 'Too many devices have reminders turned on' using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists check_push_subscription on public.push_subscriptions;
create trigger check_push_subscription before insert on public.push_subscriptions for each row execute function public.check_push_subscription();

-- Size limits, so no account can fill the shared database (the free plan turns read-only when full).
do $$
declare c record;
begin
  for c in select * from (values
    ('notifications', 'notifications_size', 'char_length(key) <= 200 and char_length(title) <= 200 and char_length(body) <= 500 and char_length(url) <= 200 and (payload is null or pg_column_size(payload) <= 2000)'),
    ('tasks', 'tasks_size', 'char_length(notes) <= 5000 and cardinality(assignees) <= 20 and pg_column_size(reminders) <= 2000'),
    ('events', 'events_size', 'char_length(notes) <= 5000 and char_length(location) <= 200 and pg_column_size(reminders) <= 2000 and pg_column_size(skip_dates) <= 8000'),
    ('terms', 'terms_size', 'char_length(name) <= 120 and pg_column_size(holidays) <= 20000'),
    ('subjects', 'subjects_size', 'char_length(name) <= 120 and char_length(code) <= 20 and char_length(color) <= 20'),
    ('slots', 'slots_size', 'char_length(room) <= 120'),
    ('settings', 'settings_size', 'pg_column_size(data) <= 20000'),
    ('calendar_feeds', 'calendar_feeds_size', 'char_length(time_zone) <= 64')
  ) as v(tbl, name, def) loop
    execute format('alter table public.%I drop constraint if exists %I', c.tbl, c.name);
    execute format('alter table public.%I add constraint %I check (%s) not valid', c.tbl, c.name, c.def);
  end loop;
end $$;

-- The sender's batches: due reminders, oldest first, at most `per_user` per account, claimed (marked sent)
-- in the same statement so two overlapping runs never send one twice. Service role only.
create or replace function public.claim_due_notifications(batch int default 100, per_user int default 10)
returns setof public.notifications language sql as $$
  with due as (
    select id, fire_at, row_number() over (partition by user_id order by fire_at) as n
    from public.notifications
    where sent_at is null and fire_at <= now() and fire_at >= now() - interval '6 hours'
  ), picked as (
    select id from due where n <= per_user order by fire_at limit batch
  )
  update public.notifications set sent_at = now()
  where id in (select id from picked) and sent_at is null
  returning *;
$$;
revoke all on function public.claim_due_notifications(int, int) from public;
do $$
begin
  -- Supabase grants new functions to its API roles by default; this one must not be callable by users.
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on function public.claim_due_notifications(int, int) from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on function public.claim_due_notifications(int, int) from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function public.claim_due_notifications(int, int) to service_role; end if;
end $$;
