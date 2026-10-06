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
