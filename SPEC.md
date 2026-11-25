# Home Base (Olympus): web platform spec

Formerly "Campus Planner".

Supersedes the Android build spec of 18 Nov 2026. Same features, delivered as a hosted website instead of a native app.

## What changed from the Android spec

| Android spec | Web platform | Why |
| --- | --- | --- |
| Kotlin, Compose, Room, Hilt | Next.js static export, Tailwind, Supabase | One codebase for phone and desktop; hostable on any static host; same stack as Wanderlist |
| v1 offline-only, v2 sync | Online, server is the source of truth | Removes the sync engine, the riskiest code in the old plan |
| AlarmManager exact alarms | Web push from a Supabase Edge Function, run each minute by pg_cron | A website cannot schedule alarms on the phone |
| JSON backup for a lost phone | Data lives in Postgres; JSON export/import kept | Moves demo data into an account |
| Play Store / APK distribution | A URL; "Add to Home Screen" installs it | No store review, no 2027 developer-verification gate |

## The review flags, resolved

| # | Flag | Resolution | Where |
| --- | --- | --- | --- |
| 1 | `USE_EXACT_ALARM` crashes on Android 12/12L | Gone: no Android build. Reminders are web push | `supabase/functions/push`, `public/sw.js` |
| 2 | Unconditional push lets an older edit overwrite a newer one (test 18 fails) | Every update is conditional on the `updated_at` the device loaded. A stale save is refused, the latest version reloads, and the user is told. Deletes always win. Verified in Postgres for tests 18 and 19 | `lib/repo/supabase.ts`, `schema.sql` trigger |
| 3 | Mid-semester opening balance double counts | Term has a **Tracking from** date. Sessions before it are never listed or counted; the opening balance covers them | `lib/sessions.ts`, test "fix 3" |
| 4 | "Attend the next 2" is wrong when a lab counts 2 | Advice is in sessions; subjects with labs say "(a lab counts as 2)" | `lib/attendance.ts`, test 9 |
| 5 | Quiet-hours shift could push a reminder past its deadline | If the shift would land at or after the due/start time, it fires at its original time. SKIP still drops it | `lib/reminders.ts`, test "fix 5" |
| 6 | Repeating range end was ambiguous | The due/start time itself is excluded | test 13 |
| 7 | Old slot's future sessions survive a timetable change | Sessions are not stored. They are derived from slots on demand; only marks are saved. An ended slot stops producing dates; past marks keep counting | `lib/sessions.ts`, test "fix 7" |
| 8 | Battery-settings intent needs a restricted permission | Gone with the Android build. Web equivalent: push permission is asked only when the user taps **Turn on** | `app/page.tsx`, `lib/push.ts` |
| 9 | Diagram placeholders in the exported Markdown | Not carried over | this file |
| 10 | Found while building: "Exactly at 75%: no skips left" also showed at 80% (8 of 10), where zero skips is right but "exactly" is false | "Exactly at" only when attendance equals the target; otherwise "No skips left: one absence takes you below 75%" | `lib/attendance.ts`, test "fix 10" |

## Also in this version

- **Dark mode** follows the device setting. Attendance band colours stay fixed so green, amber and red always mean the same thing.
- **Skip one date of a repeating event**: open the event from that date and tap "Skip this date".
- **Links in task and event notes** open in a new tab.
- **CI**: every push runs the tests, the typecheck and the build (`.github/workflows/ci.yml`).

## Accounts

- **Sign-ups can be closed** in Supabase (Allow new users to sign up: off). A refused sign-up shows "New sign-ups are closed on this site."
- **Password reset**: "Forgot password?" calls Supabase's reset email; the link returns to the site, which shows "Set a new password" (new password typed twice) before anything else. An expired or used link shows a plain message on the sign-in screen. The reset screen never reveals whether an account exists.

## What if I skip?

Reached from Attendance. Pick a period (this week, next 2 weeks, rest of term), then tick classes or whole days you plan to miss. Every other class in the period counts as attended. Each subject shows its percentage now and after, with the band colour. The summary names only subjects the skips push below target; subjects below target even with full attendance get a separate note. Nothing is saved. Maths: `project()` in `lib/attendance.ts`.

## Architecture

- **Pages** (`app/`): Today, Calendar, Tasks, Attendance, Timetable, Settings. All client-rendered; `next build` emits static HTML/JS to `out/`.
- **Data** (`lib/repo/`): one `Repo` interface, two implementations. `LocalRepo` is demo mode (localStorage, seeded sample term). `SupabaseRepo` is hosted mode. The site picks Supabase when `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set at build time.
- **Logic** (`lib/attendance.ts`, `lib/sessions.ts`, `lib/reminders.ts`): pure functions with no React or network, covered by `npm test`.
- **Reminders**: after every change the browser recomputes the next 30 days of reminders and replaces the user's unsent rows in `notifications`. pg_cron calls the `push` function every minute; it sends due rows to every device the user turned on, then marks them sent. Notification buttons call the same function with the notification's id.
- **Privacy**: Row Level Security on every table; a user reads and writes only rows where `user_id = auth.uid()`. The Edge Function uses the service role and acts only on the row named by an unguessable notification id.

## Data model

All tables carry `id`, `user_id`, `created_at`, `updated_at` (set by a trigger). Dates are `YYYY-MM-DD`, times `HH:MM` local, instants UTC.

| Table | Key fields | Rules |
| --- | --- | --- |
| terms | name, start_date, end_date, track_from, holidays (jsonb) | Active term = latest start date. track_from inside the term |
| subjects | term_id, name, code, color, target_pct, opening_held, opening_attended | attended ≤ held; target 50–95 or null for the default |
| slots | subject_id, day (1 = Mon), start_time, end_time, room, kind, weight, effective_from, effective_to | Editing from a later date ends the slot and starts a new one |
| marks | subject_id, slot_id (null = extra class), date, times, weight, status | One mark per slot per date |
| tasks | title (≤ 120), notes, due_at, assignees text[], reminders jsonb, done_at | Assignees are typed names; autocomplete from earlier tasks |
| events | title, category, start_at, end_at, all_day, location, repeat, repeat_until, skip_dates, reminders | end after start; monthly repeats skip months without that day; skip_dates removes single occurrences |
| settings | data (jsonb) | One row per user |
| push_subscriptions | endpoint, p256dh, auth | One per device |
| notifications | key, fire_at, kind, owner_id, title, body, url, payload, source, sent_at | Unique per user and key; sent rows purged after 14 days |

A reminder is `{ before: minutes, every?: minutes }`: "at time" is `before: 0`; a repeating range fires from `before` every `every` minutes until the due time, which is excluded.

## Attendance maths

Unchanged from the Android spec and verified against a brute-force count for every target from 50 to 95:

- H = opening held + Present + Absent (+ Duty leave if it counts); A = opening attended + Present (+ Duty leave). Weights apply. Cancelled and unmarked never count.
- Below target: N = ⌈(tH − 100A) / (100 − t)⌉. At or above: S = ⌊(100A − tH) / t⌋. Integer maths only.
- If N exceeds the weighted sessions left this term: "Not reachable this term; best possible X%".
- Bands: Safe (green) at or above target; At risk (amber, optional) above the floor; Below target (red); No classes yet (grey). The label always repeats the band in words.

## Acceptance tests

| # | Status |
| --- | --- |
| 1–11 attendance | Automated (`npm test`) |
| 12–14 reminder timing | Automated (`npm test`) |
| 15 phone restarted | Not applicable: reminders are sent by the server, not scheduled on the phone |
| 16 class prompt marks attendance | Edge Function action `PRESENT` / `ABSENT`. Needs a live project to test end to end |
| 17 offline | Replaced: demo mode works offline; hosted mode needs a connection |
| 18–19 two devices | Verified against the schema in Postgres (stale save refused, delete wins) |

## More features

- **Weekly digest**: Sunday 7 pm push with the coming week's deadlines, events and classes, and subjects below target (Settings, on by default). The text reflects the data when it was last planned (every change and visit).
- **Grades**: in each subject's panel, assessed components (weight, out of, score). Shows marks so far and the average needed on the rest to reach the target final mark set in Settings (default 70%). Raw marks, not a relative grade.
- **Timetable import and export**: paste cells from Excel or Google Sheets, or pick a CSV (Day, Start, End, Subject; optional Code, Room, Type). Missing subjects are created; classes already in the timetable are skipped. "Share as CSV" writes the same layout for a classmate. Cells that look like spreadsheet formulas are neutralised on export.
- **Calendar feed**: Settings gives a private iCalendar link (Edge Function `calendar`) for Google or Apple Calendar: weekly class series without holidays and cancelled classes, extra classes, open deadlines with alerts, events with their repeats and skipped dates. The link can be reset.
- **Offline viewing**: the service worker stores every page; signed-in data falls back to the copy saved at the last load, with an "Offline" banner. Saves explain they need a connection. Sign-out deletes the copy.
- **Safe to skip?**: each upcoming class on Today says whether missing it keeps that subject at or above target.
- **Send a test**: Settings queues a test notification to check reminders reach the device.

## Security model

- **Row Level Security** on every table: an account reads and writes only its own rows.
- **Same-owner references**: composite foreign keys make every subject, class, mark and grade belong to the same account as its parent. RLS does not cover foreign-key checks, so without these an account could attach rows to another's classes.
- **Reminder queue**: accounts may only add, read and delete their own planned reminders, never edit them or mark them sent. Inserts must be in the future, are capped at 3000 unsent per account, and `sent_at` is always cleared. Push endpoints must be HTTPS and on a known push service; sends run in parallel with a 10 s limit; stale rows are purged rather than sent.
- **Functions without login** (`push`, `calendar`): the sender needs the cron secret; notification buttons need the notification's unguessable id and POST; the calendar needs the feed token. Every service-role query is pinned to the owner.
- **Sign-in links**: the client does not read sessions from the address bar except from a password-reset link, and removes tokens from the address bar. Link errors show fixed wording. A reset request answers the same whether or not the account exists. The signed-in email is shown in the sidebar and Settings.
- **Sign-out** removes this device's push subscription and the offline copy.
- **Backup import**: every row is checked, damaged ones are dropped (and counted), ids are regenerated with links kept, and new rows are saved before old ones are removed.
- **Browser security headers** (`vercel.json`, and `public/_headers` for Netlify and Cloudflare Pages, kept identical by a unit test): a Content-Security-Policy limiting scripts, styles, fonts and workers to the site itself and network calls to the site and `*.supabase.co`, no framing by other sites, `nosniff`, a referrer policy and a permissions policy. Browser tests run under these headers.
- **Supply chain**: Dependabot opens weekly update pull requests (npm, GitHub Actions); CI runs with a read-only token and fails on high or critical `npm audit` findings in shipped dependencies.
- **Accessibility**: an axe-core audit (WCAG 2.2 AA) of every screen in light and dark mode reports no violations. Sheets take keyboard focus, keep Tab inside and return focus on close.

## Browser tests

`e2e/` holds 26 click-through tests: every page in light and dark mode, tasks with Undo, marking, timetable and its import, settings, skipped event dates, note links, the what-if planner, grades, offline use, keyboard focus, backup import with damaged entries, and the account screens against a mocked Supabase (sign-in, closed sign-ups, password reset, forged and broken links, offline banner, calendar link, sign-out cleanup). They run with `npm run test:e2e` once the `playwright` dev dependency is approved and added; CI will then run them on every push.

## Out of scope

Offline editing in hosted mode, sharing tasks with other accounts, Google sign-in (email + password only), changing the time of a single occurrence (skip it and add a one-off event instead), native apps.
