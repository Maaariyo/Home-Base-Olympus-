# Campus Planner

Tasks, calendar and attendance for one student, as a website. Works on phone and desktop, installs to the home screen, and sends reminders through web push.

- **Today**: next class, today's classes with Present / Absent / Cancelled, tasks due, events, subjects below target.
- **Tasks**: heading, notes, due time, assignees, any number of reminders. Overdue / Today / Upcoming / Done, search, filter by person, swipe to complete or delete with Undo.
- **Calendar**: month, week and day views with three layers: events, task due times and classes.
- **Attendance**: per-subject donut, "attend the next N" / "you can skip N", overall view, session history.
- **Timetable**: term, holidays, subjects with opening balances, weekly classes, mid-term timetable changes.
- Dark mode, phone and desktop layouts, installable from the browser.

Stack: Next.js (static export), Tailwind, Supabase (Postgres, Auth, Row Level Security, Edge Functions, pg_cron). Same stack as Wanderlist.

## 1. Try it in 2 minutes (demo mode)

Needs [Node.js 20+](https://nodejs.org).

```bash
npm install
npm run dev
```

Open http://localhost:3000. With no database connected, the site runs in **demo mode**: a sample MBA term, saved only in your browser.

## 2. Connect Supabase (free plan)

1. Create a project at [supabase.com](https://supabase.com). Pick the **Mumbai (ap-south-1)** region.
2. **SQL Editor → New query**: paste all of [`supabase/schema.sql`](supabase/schema.sql) and press **Run**.
3. **Authentication → Sign In / Providers → Email**: for a personal planner, turn **Confirm email** off. Supabase's built-in email sender allows only a few emails per hour.
4. **Project Settings**: copy the Project URL and the publishable (anon) key into `.env.local`, using [`.env.example`](.env.example) as the template.

Run `npm run dev` again. You now get a sign-in screen; each account sees only its own data.

## 3. Host it

`npm run build` writes a plain static site to `out/`. Any static host works.

- **Vercel** (simplest): import the GitHub repo, add the env vars from `.env.local`, deploy.
- **Netlify / Cloudflare Pages**: build command `npm run build`, output folder `out`, same env vars.

Then in Supabase, **Authentication → URL Configuration → Site URL**: set it to your live address.

## 4. Turn on reminders (push notifications)

Reminders are sent by a Supabase Edge Function that runs every minute, so they arrive even when the site is closed.

```bash
npx web-push generate-vapid-keys
```

```bash
npx supabase login
```

```bash
npx supabase link --project-ref YOUR-PROJECT-REF
```

```bash
npx supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com CRON_SECRET=any-long-random-string
```

```bash
npx supabase functions deploy push --no-verify-jwt
```

Then:

1. Edit [`supabase/cron.sql`](supabase/cron.sql): put in your project ref and the same `CRON_SECRET`. Run it in the SQL Editor.
2. Add `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (the public key) to your host's env vars and redeploy.
3. On each phone or laptop: open the site, tap **Turn on** on the Today screen. On iPhone, first use **Share → Add to Home Screen** and open the site from the home screen icon; Safari only allows push for installed sites.

## Move demo data into your account

Demo mode: **Settings → Export JSON**. After signing in: **Settings → Import JSON**.

## Develop

```bash
npm test
```

```bash
npm run lint
```

`npm test` runs the acceptance tests in [`lib/logic.test.ts`](lib/logic.test.ts) (attendance maths, reminder timing, timetable rules). [`SPEC.md`](SPEC.md) is the product spec; [`CLAUDE.md`](CLAUDE.md) holds the rules for AI coding sessions.

## Limits to know

- **Online first.** Pages and data need a connection; there is no offline editing. Demo mode is the only offline mode.
- **Free Supabase projects pause after 7 days with little activity.** Reminders stop until you resume the project in the dashboard. Reminders more than 6 hours late are dropped rather than sent late.
- **Notification buttons:** browsers show at most two (Present / Absent, Done / Snooze). iPhone shows none: tapping a notification opens the site.
- **Quiet hours and reminder times follow the device's time zone** at the moment you last opened the site.
- **Recurring reminders are planned 30 days ahead** and topped up each time you open the site. Open it at least once a month.
