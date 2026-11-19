-- Runs the reminder sender every minute. Run once, after deploying the `push` function (README, step 4).
-- Replace YOUR-PROJECT-REF and YOUR-CRON-SECRET first. The secret must match the function's CRON_SECRET.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('home-base-reminders') where exists (select 1 from cron.job where jobname = 'home-base-reminders');
select cron.schedule(
  'home-base-reminders',
  '* * * * *',
  $$ select net.http_post(
       url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/push',
       headers := '{"x-cron-secret": "YOUR-CRON-SECRET"}'::jsonb
     ) $$
);
