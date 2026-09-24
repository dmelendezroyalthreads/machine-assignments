# Machine Assignments

Real-time assignment board for team leaders coordinating machine workload across three shifts.

## First version

- Add, edit, and delete machine assignments.
- Category dropdown options: `P2S`, `Events`, `Rush/MST`, `FIFO`, `Special Project`.
- Category detail field is limited to 20 characters.
- Operator name is free form.
- Quantity is limited to 0 through 360 units.
- Supabase Realtime updates every connected browser after inserts, edits, and deletes.
- A database-enforced team PIN protects the live board.
- Access lasts 12 hours per device and can be ended with the Lock button.
- Without Supabase environment variables, the app runs in local demo mode.

## Supabase setup

1. Enable anonymous sign-ins under Authentication settings.
2. Open the Supabase SQL editor for the project you want to use.
3. Run `supabase_schema.sql`.
4. Copy the project URL and publishable key into `.env`:

```bash
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key_here
```

Legacy anon keys also work:

```bash
VITE_SUPABASE_ANON_KEY=your_anon_key_here
```

Anonymous users cannot read or change assignments until the correct PIN creates a 12-hour access session. The PIN itself is stored only as a bcrypt hash.

## Local commands

```bash
pnpm install --frozen-lockfile
pnpm run dev
pnpm run build
```

## Render setup

Use this as a static site on Render.

- Build command: `pnpm install --frozen-lockfile && pnpm run build`
- Publish directory: `dist`
- Environment variables:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_PUBLISHABLE_KEY`

The included `render.yaml` can be used for blueprint deployment.
