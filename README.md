# hardest

Crowdsourced difficulty ratings for individual homework problems, shown as heatmaps.
Students rate each problem from 1 to 10. Each course semester gets a grid with assignments as rows and problems as columns, so the hardest problems stand out.

Live at **https://michael-han.com/hardest/**. It is Harvard-only for now and the first example is Math 55a, Fall 2026. Until a Supabase project is connected, the live site runs in **demo mode**:
- every rating, user and most problem text is synthetic and labeled as such;
- changes are saved only in your browser.

```
University → Course → Offering (semester) → Assignment → Problem → Part
/harvard/math-55a/fall-2026/pset-4/p2
```

## What's in it

- **Heatmap** (`src/components/heatmap`):
  - Metrics: mean, median, median time and rating count, on a muted green→red scale.
  - Unrated cells are hatched, never colored as easy. Cells with few ratings are marked.
  - Sorts: chronological, hardest, most rated. Toggles: numbers, counts, only rated, expand parts.
  - Tooltips, full keyboard navigation (arrows, Enter, j/k, Esc), and all state kept in the URL.
  - PNG export, plus analytics and semester-comparison views.
- **Problem panel**:
  - Shows the statement (Markdown + KaTeX), the average with a 95% band, median, distribution, time and completion.
  - Your rating, with optional time spent and status.
  - Suggest an edit, report, revision history, and adding a missing statement.
  - Docks beside the heatmap on desktop and opens as a sheet on mobile.
- **Ratings**:
  - One per user per problem. Edits are optimistic.
  - A rating picked while signed out is kept and saved after sign-in.
  - Quick-rate mode: press 1–9 or 0 for 10, and it advances automatically.
  - Individual ratings are never shown to anyone, and there are no leaderboards.
- **Upload wizard** (`src/pages/upload`), steps:
  1. Choose the course, semester and assignment.
  2. Add the source: upload a PDF, TeX, Markdown, text or DOCX file; paste text; or type labels only.
  3. A deterministic parser splits it into problems and parts.
  4. Review in a side-by-side editor (merge, split, indent, reorder).
  5. A duplicate check runs.
  6. Choose what to publish and confirm you have the right to share it.

  Nothing is published automatically, and scanned PDFs are detected and flagged.
- **Moderation**:
  - A queue of proposed edits and reports.
  - Every statement change is versioned and can be reverted.
  - Duplicate problems and assignments can be merged, keeping their ratings, and old URLs redirect.
  - Content can be hidden or removed, and user roles can be changed.
- **Auth**:
  - Passwordless: an email magic link or a 6-digit code. Google is optional.
  - Rate limits apply to ratings, uploads, proposals and reports.

## Run it locally

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173/hardest/. With no `.env.local`, the app runs fully in demo mode: an in-browser API with a synthetic dataset that persists to `localStorage`. "Reset demo data" is on the My courses page once you're signed in to the sandbox. To force the sandbox even when a backend is configured, add `?demo=1`; `?demo=0` turns it off again.

### With a real backend (Supabase)

1. Create a Supabase project. Then apply the migrations (`supabase db push` with the CLI linked, or run `supabase/migrations/*.sql` in order in the SQL editor) and load the real catalog with `supabase/seed.sql`.
2. Optionally load the synthetic data with `supabase/seed-demo.sql`. Remove it later with `supabase/remove-demo.sql`. Real data is untouched either way.
3. In **Auth → URL configuration**, set the Site URL to `https://michael-han.com/hardest` and add the redirect URLs `https://michael-han.com/hardest/**` and `http://localhost:5173/hardest/**`.
4. In **Auth → Email templates → Magic link**, include `{{ .Token }}` so the email carries the 6-digit code as well as the link.
5. Set up custom SMTP: the built-in sender only allows a few emails per hour.
6. Optional: enable Google under Auth → Providers and set `VITE_ENABLE_GOOGLE_AUTH=true`.
7. Copy `.env.example` to `.env.local` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from Settings → API. The anon key is public by design, and row-level security (RLS) protects the data.
8. Make yourself an admin with this SQL:

   ```sql
   update public.profiles set role = 'admin' where id = (select id from auth.users where email = 'you@…');
   ```

### Environment variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | build | Supabase project URL. If empty, the app runs in demo mode. |
| `VITE_SUPABASE_ANON_KEY` | build | Public anon key. If empty, the app runs in demo mode. |
| `VITE_SITE_URL` | build | Public origin used in magic-link redirects. Defaults to the current origin + `/hardest`. |
| `VITE_ENABLE_GOOGLE_AUTH` | build | `true` shows "Continue with Google". |
| `DATABASE_URL` | scripts only | An existing empty Postgres for `npm run test:db`. If unset, a throwaway local cluster is used. |

No secret ever reaches the browser. All writes go through `SECURITY DEFINER` RPCs that check `auth.uid()`, roles and rate limits.

## Tests

```bash
npm test
```

```bash
npm run test:db
```

```bash
npm run test:e2e
```

```bash
npm run lint && npm run typecheck && npm run build
```

- `npm test` runs the unit tests: parser, stats, color scale, search parsing, heatmap model, extraction helpers and the demo API.
- `npm run test:db` runs migrations, constraints, triggers, RPCs and RLS against a real local Postgres. It needs `initdb`/`pg_ctl` on PATH.
- `npm run test:e2e` runs Playwright against a production build in demo mode. It is real UI, but not a real backend.

The DB suite runs against plain Postgres with a small shim for Supabase's `auth` and `storage` schemas (`tests/db/supabase-shim.sql`). It does not exercise Supabase Auth, Storage or PostgREST themselves.

## Deploy

```bash
npm run deploy
```

`deploy.sh` does four things:
1. Builds the app with `base: '/hardest/'`.
2. Syncs `dist/` into `/hardest` of the `michaellhan/michaellhan.github.io` checkout (`~/.cache/michaellhan.github.io`, or `$SITE_REPO`).
3. Inserts or refreshes a small snippet in the site's `404.html` so deep links like `/hardest/harvard/math-55a/fall-2026/pset-4/p2` work on GitHub Pages.
4. Commits and pushes the site repo.

Build-time variables come from `.env.production.local` (git-ignored) or the shell.

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): data model, aggregation math, access model, parser, and the demo backend.
- About page in the app (`/about`): methodology, privacy and content policy as users see them.

## Known limitations

- **Not yet run against a real Supabase project.** The SQL is tested on local Postgres (18) with an auth/storage shim. Storage policies and the email and OAuth flows have not been exercised end to end.
- The live site is in demo mode until Supabase credentials are added and it is redeployed.
- **No OCR.** Scanned or image-only PDFs are detected; the user then pastes text or enters labels manually.
- **No AI-assisted parsing.** The parser is deterministic (numbering patterns, LaTeX `enumerate`/`\section`, Markdown headings).
- Gaps in the moderation tools:
  - Merging doesn't auto-resolve open reports on the merged problem.
  - The queue doesn't show the offering for each item.
  - There's no "my contributions" page yet.
- Any signed-in user can add a course or semester through `/contribute` (30 catalog additions per day). New universities wait for moderator approval, but new courses and semesters go live immediately (moderators can hide them). There is no CAPTCHA.
