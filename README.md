# Machine Assignments

Real-time assignment board for team leaders coordinating machine workload across three shifts.

## First version

- Add, edit, and delete machine assignments.
- Category dropdown options: `P2S`, `Events`, `Rush/MST`, `FIFO`, `Special Project`, `Tour Player`.
- Category detail field is limited to 20 characters.
- Operator name is free form.
- Quantity is limited to 0 through 360 units.
- Import order lists from Excel, CSV, or TSV files. The app identifies supported
  PMStats and LogistiView exports by their column headers, not their filenames.
- Filter imported orders by source location, preview the detected pick tickets,
  and select the orders that belong on a machine before importing.
- Target Durham machines 1 through 15 either by machine number or by the
  LogistiView location in a full export.
- Update one machine or all matched Durham machines in a single import. An
  all-machine import is transactional and enforces the 360-unit limit for each
  machine separately.
- Replace a machine's active list with a fresh file or merge additional orders
  into its current list. Replace always requires explicit confirmation, and
  completed orders remain available in history.
- Expand a machine row to review imported order details and mark individual
  orders complete or reopen them. The machine quantity is recalculated from its
  open imported orders.
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

## Order import workflow

1. Choose **Import orders** and select the destination machine.
2. Choose **Replace active list** for a new authoritative list, or **Merge with
   active list** to add orders without removing existing open orders.
3. Select an `.xlsx`, `.xls`, `.csv`, or `.tsv` file.
4. If the file contains multiple machine locations, choose the appropriate
   source location. The app tries to match location suffixes to the machine
   number automatically.
5. Review and select the detected pick tickets, keeping the active total at or
   below 360 units, then import.
6. Expand the machine row to mark orders complete or reopen them.
