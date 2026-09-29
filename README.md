This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## TRACK3D Coaching V1.2

The fitness coach now uses a server-side, safety-first coaching layer with deterministic exercise progression, 14-day context, on-demand historical retrieval, persistent Coach memory, structured temporary actions, and explicit approval for permanent programme changes.

Before enabling it in a deployed environment:

1. Review and apply `supabase/migrations/202609290001_track3d_coaching_v12.sql` to a non-production Supabase branch first.
2. Configure `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `ANTHROPIC_API_KEY` on the server. The existing `NEXT_PUBLIC_SUPABASE_*` variables remain supported.
3. Run `npm test`, `npm run lint`, and `npm run build`.

Legacy `workout_logs` writes remain authoritative and continue if the additive migration is not installed. Normalized V1.2 session/set writes fail softly until it is available. The migration is intentionally additive and does not backfill legacy workout JSON; write a backfill only after validating representative production rows.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.js`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
