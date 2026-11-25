# Home Base (Olympus)

Tasks, calendar and attendance for one student, as a website. Works on phone and desktop, installs to the home screen, and sends reminders through web push.

- **Today**: next class, today's classes with Present / Absent / Cancelled, tasks due, events, subjects below target.
- **Tasks**: heading, notes, due time, assignees, any number of reminders. Overdue / Today / Upcoming / Done, search, filter by person, swipe to complete or delete with Undo.
- **Calendar**: month, week and day views with three layers: events, task due times and classes.
- **Attendance**: per-subject donut, "attend the next N" / "you can skip N", overall view, session history, and a **What if I skip?** planner that shows each subject's percentage before you miss a class.
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
4. Click **Connect** at the top of the project page (or **Settings → API Keys**): copy the Project URL and the **publishable** key (`sb_publishable_…`) into `.env.local`, using [`.env.example`](.env.example) as the template. Never use a secret key in the site.
5. **Close sign-ups** once your own account exists: **Authentication → Sign In / Providers** (in some dashboard versions **Authentication → Settings**), turn off **Allow new users to sign up**. Anyone else who tries sees "New sign-ups are closed on this site." Turn it back on when a classmate wants to join.

**Password reset.** "Forgot password?" on the sign-in screen emails a link that opens a "Set a new password" screen. Two Supabase limits apply to its built-in email: it delivers **only to members of your Supabase team**, and only about **2 emails an hour**. So sign up in Home Base with the same email you use for Supabase. For classmates, add a custom SMTP provider under **Authentication → Emails**. The link returns to your Site URL; for local testing, add `http://localhost:3000` under **Authentication → URL Configuration → Redirect URLs**.

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

`npm test` runs the acceptance tests in [`lib/logic.test.ts`](lib/logic.test.ts) (attendance maths, reminder timing, timetable rules).

Browser tests in [`e2e/`](e2e) click through the demo site and the sign-in, closed sign-up and password-reset screens (against a mocked Supabase). They need the `playwright` dev dependency, which is not added yet; once it is, run `npm run test:e2e`. [`SPEC.md`](SPEC.md) is the product spec; [`CLAUDE.md`](CLAUDE.md) holds the rules for AI coding sessions.

## Limits to know

- **Online first.** Pages and data need a connection; there is no offline editing. Demo mode is the only offline mode.
- **Free Supabase projects pause after 7 days with little activity.** Reminders stop until you resume the project in the dashboard. Reminders more than 6 hours late are dropped rather than sent late.
- **Notification buttons:** browsers show at most two (Present / Absent, Done / Snooze). iPhone shows none: tapping a notification opens the site.
- **Quiet hours and reminder times follow the device's time zone** at the moment you last opened the site.
- **Recurring reminders are planned 30 days ahead** and topped up each time you open the site. Open it at least once a month.
