# Compliance: still to do

The privacy and safety work merged in October 2026 (pull request 15) covers the main UK GDPR points for health data:
- explicit consent at sign-up, asked once of existing users, and withdrawable;
- access and portability (Download my data);
- erasure (Delete my account);
- a Privacy Notice with a cookies section;
- calorie minimums.

There are no analytics or tracking cookies, so no cookie banner is needed. See "Privacy and account controls" in `README.md`.

These items still need the owner. None of this is legal advice.

1. **Legal name (or company) and contact email on the Privacy Notice.** UK GDPR requires both. Add them to `CONTROLLER` in `app/privacy/page.js`. The notice then shows the email under "Who we are" and "Your rights".
2. **ICO data protection fee.** Pay it on the ICO website, unless exempt.
3. **Data processing agreements** with Supabase, Vercel and Anthropic. Each offers one. Accept or sign them, and note which region the Supabase project is in.
4. **DPIA (data protection impact assessment).** It's expected for health data, especially with AI coaching. The ICO has a template.
5. **Supabase backups kept 30 days or less.** The Privacy Notice promises that copies of a deleted account in backups are gone within 30 days. Check the plan's backup and point-in-time recovery settings.
6. **Age (parked: a junior version with limited features may come later).** The Terms and the Privacy Notice say TRACK3D is for people aged 18 or over, but the profile accepts ages 13 and up (`profileProblem` in `lib/profile.js`).
7. **Legal review.** Have a UK data-protection solicitor review it before the app grows.

## Security settings for the owner (before launch)

These are outside the code, so they need doing in each service's dashboard.

1. **Run `supabase/migrations/202610070001_lock_down_tables.sql`** in Supabase → SQL Editor. It switches on row level security for the tables that were made in the dashboard (morning check-ins, nutrition and workout logs and others), limits each to its owner, and only allows images up to 15 MB in the photo bucket. The last query it runs lists every table: each should show `rls_on = true` and a policy mentioning `auth.uid()`.
2. **Check `chat_rate_check` exists** (migration `202610050004_chat_rate_limit.sql`). Without it the AI request limit falls back to a tighter per-server limit that can't count across servers.
3. **Anthropic spend limit.** In the Anthropic Console, set a monthly spend limit for the workspace the API key belongs to, so a bug or abuse can't run up an unlimited bill.
4. **Supabase Auth → Passwords:** set the minimum length to 8 (the app asks for 8, but the server default is 6) and turn on leaked-password protection.
5. **Supabase Auth → Sessions:** consider a session time limit (for example 7 days), to match the app's 7-day sign-in window on the server too.
