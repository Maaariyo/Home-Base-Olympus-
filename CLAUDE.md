# Rules for AI coding sessions

- Read SPEC.md before changing behaviour. Build only what it specifies.
- This is Next.js 16 with static export (`output: "export"`): no API routes, no server actions, no dynamic routes without `generateStaticParams`. Check `node_modules/next/dist/docs/` before using a Next.js API from memory.
- Every data access goes through the `Repo` interface (`lib/repo/types.ts`) and must work in both demo (LocalRepo) and Supabase mode.
- Updates pass the row as last loaded (`update(table, seen, patch)`) so a stale save is refused. Never send `updated_at` from the client; the database sets it.
- Keep `lib/attendance.ts`, `lib/sessions.ts` and `lib/reminders.ts` pure, with integer maths for attendance. Every test in `lib/logic.test.ts` must pass.
- Class sessions are derived from slots, never stored. Only marks are saved.
- Schema changes go in `supabase/schema.sql` and must be safe to re-run.
- Before committing: `npm test`, `npm run lint`, `npm run build`.
- Ask before adding a dependency.
