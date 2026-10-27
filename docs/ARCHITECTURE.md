# Architecture

A static React single-page app (Vite, served from `/hardest/` on GitHub Pages) talking to Supabase: Postgres, Auth and Storage. All application logic that must be trusted lives in Postgres. The browser holds no secrets.

```
src/
  App.tsx, main.tsx           routes (react-router, basename /hardest), providers
  lib/api/                    Api interface (types.ts) + two implementations:
    supabase.ts                 real backend: RPC calls + Storage
    demo.ts                     in-browser sandbox on synthetic data (localStorage)
  lib/stats.ts                aggregation math shared by UI, demo backend and optimistic updates
  lib/scale.ts                OKLCH color scales (difficulty / time / count)
  lib/parser/                 deterministic assignment parser + review-editor operations
  lib/extract.ts              PDF (pdf.js, lazy), DOCX (mammoth, lazy), text extraction
  lib/pdfMath.ts              PDF glyph runs → Markdown with LaTeX math, from TeX font names and positions
  components/heatmap/         model.ts (pure) + Heatmap.tsx (grid, tooltip, keyboard) + PNG export
  components/problem/         ProblemPanel, RatingControl, Distribution, edit/report dialogs
  pages/                      Home, University, Course (heatmap/analytics/compare), Upload, Contribute, Me, Moderation, About
supabase/migrations/          schema → functions (RPCs) → RLS → storage
supabase/seed.sql             real Harvard catalog (no ratings)
supabase/seed-demo.sql        synthetic demo data (generated; every row flagged is_demo)
supabase/remove-demo.sql      removes exactly the demo rows
```

## Data model

- `universities` → `courses` → `course_offerings` (term + year + optional section) → `assignments` → `problems`.
- `problems.parent_problem_id` makes parts. Parts are one level deep.
- Each of these levels has a URL slug that is unique among its siblings. Renames and merges leave rows in `slug_aliases`, or set `merged_into`, so old links keep resolving (`resolve_path`).
- `ratings`: one row per (user, problem), enforced by a unique key.
  - Fields: `difficulty` 1–10, optional `time_minutes` and `completion_status`, and the `epoch` the rating was made in.
- `problem_stats`: aggregates for each problem, kept current by a trigger on `ratings`.
  - Fields: count, mean, median, sample SD, 10-bucket histogram, time median and count, completion counts.
  - The trigger takes a per-problem advisory lock, so concurrent votes can't race.
- `problems.rating_epoch`: a moderator bumps it when a statement changes materially. Older ratings are kept but stop counting, and the user sees "your rating is from an earlier version".
- `problem_revisions`: every statement change is versioned and can be reverted. `edit_proposals` and `moderation_reports` feed the queue, and `moderation_actions` is the audit log.
- `source_documents`: uploaded files with their SHA-256 checksum, which feeds duplicate detection. Files live in the private `source-documents` bucket under `<uid>/…`. Public visibility is a separate opt-in.

## Access model

- RLS is enabled on every table.
- Anonymous and signed-in users can read active catalog content and `problem_stats`.
- `ratings` can be read only by their owner. No policy exposes another user's rating, and no endpoint returns per-user data for other users.
- Every write goes through a `SECURITY DEFINER` RPC, for example `rate_problem`, `publish_assignment`, `propose_edit`, `merge_problems` or `moderation_queue`. Each RPC:
  - calls `private.require_user()` or `require_moderator()`;
  - validates its input;
  - checks the sliding-window limits in `private.check_rate` (per user and per action);
  - raises errors with a `hint`, such as `auth_required`, `forbidden`, `rate_limited` or `duplicate_assignment`, which the UI maps to messages.
- Roles: `user`, `moderator`, `admin`. Only admins change roles.

## Aggregation

Implemented in `src/lib/stats.ts`, and mirrored in SQL for per-problem stats.

- **Problem**: mean, median (`percentile_cont(0.5)`), sample SD, and SE = SD/√n. The panel shows a mean ± 1.96·SE band. Fewer than 3 ratings counts as a *low sample*: the cell gets a corner mark and the panel shows a warning.
- **Problem with parts**: its value is the mean of its rated parts' means. Its count is the total number of ratings across parts.
- **Assignment**: the mean of its problems' values. Unrated problems are excluded rather than counted as 0. Workload is the sum of the problems' median times, shown only if at least half the problems have time data.
- **Hardest ranking**: a Bayesian average, `(n·mean + m·μ) / (n + m)` with `m = 5`, where μ is the semester's pooled mean. One 10/10 vote can't outrank thirty 9s.
- **Optimistic updates**: `applyVoteToStats` adjusts the histogram exactly, so count, mean, median and SD are correct before the server responds.

## Heatmap

`components/heatmap/model.ts` is pure and unit-tested.
- It turns an `OfferingOverview` plus the viewer's own ratings into rows and cells for the chosen metric, sort and toggles.
- Cell states: `value`, `unrated` (hatched, never colored), `no-data` (e.g. time not reported), and absent (an empty slot after an assignment's last problem).
- The difficulty scale is defined in OKLCH. Its lightness decreases steadily, so the order survives grayscale and color-vision deficiency. Text color is chosen per swatch for WCAG AA contrast, and a unit test checks this.
- Time and count use different hues, so they can't be mistaken for difficulty.

## Parser

`lib/parser` is deterministic and has no network calls.
1. Normalize the extracted text.
2. Detect the format: TeX (`enumerate`/`\item`, `\section`, `\begin{problem}`), Markdown headings, or numbering patterns in plain text such as `1.`, `Problem 3`, `(a)`, `(ii)`.
3. Build a problem → part tree, with a confidence and warnings for each node.
4. Guess metadata: title, number, due date.
5. Assess PDF quality: average characters per page flags a scanned or image-only document.

PDF math (`lib/pdfMath.ts`): pdf.js reports each run of glyphs with its font's PostScript name, its position and its size. When a document uses TeX math fonts, the extractor rebuilds LaTeX instead of flat text.
- The font gives a glyph's meaning: CMMI is math italic, CMSY symbols (capitals become `\mathcal`), MSBM `\mathbb`, EUFM `\mathfrak`, CMEX big operators and delimiters (mapped by character code), LINE10 arrowheads.
- Lines are rebuilt from baselines. Smaller glyphs that sit raised or lowered become scripts of the glyph before them; touching scripts move as a group.
- CMEX glyphs and the cmsy radical hang from their top edge, so they are moved onto the formula's axis first.
- Digits, `=`, brackets and operator names (`log`, `Aut`) beside math glyphs join the formula.
- Consecutive math-only lines closer together than lines of text form one display. Glyphs above and below its main line pair up into `\frac`. Script groups under or over ∑/∏/lim become their limits.
- The parser is told (`texMath`) not to escape `$` in such pages.

The review editor's operations (merge, split at cursor, indent/outdent, add, move, delete) are pure functions in `editor.ts`. They are validated by `validateDrafts` before publishing.

Duplicate detection runs in two places:
- the client uses checksum, label-sequence and text similarity (`similarity.ts`);
- `find_assignment_duplicates` re-checks on the server, and `publish_assignment` refuses an exact duplicate unless `force_distinct` is set.

## Demo backend

`lib/api/demo.ts` implements the same `Api` interface against a synthetic dataset generated deterministically by `lib/demo/`: 60 fake users, illustrative problems and about 3.5k ratings.
- It is used when the Supabase environment variables are missing, or when the visitor adds `?demo=1`.
- Changes persist to `localStorage` (`hardest:demo:v1`).
- The UI shows a banner, and every demo assignment carries a "Demo data" badge.
- `scripts/gen-demo-sql.ts` emits the same dataset as SQL (`seed-demo.sql`), so a real deployment can show the demo, then remove it cleanly with `remove-demo.sql`.

## Testing layers

| Layer | Runs on | Covers |
| --- | --- | --- |
| `src/lib/parser/__tests__` | vitest (node) | parsing of TeX/Markdown/text, labels, metadata, editor operations, similarity |
| `tests/unit` | vitest (node) | stats, color scale + contrast, search parsing, heatmap model, extraction helpers, demo API |
| `tests/db` | vitest + local Postgres | constraints, triggers/aggregates, epochs, RPCs, RLS isolation, merges, moderation, demo seed/removal |
| `e2e` | Playwright, prod build, demo mode | browse → rate → aggregate, URL state, keyboard, upload → publish, duplicate detection, mobile sheet |
