-- hardest: core schema
-- University → Course → Course offering → Assignment → Problem (→ subproblem)
-- UUIDs are identity; slugs are canonical, human-readable, unique within their parent, and may change
-- (old slugs are kept in slug_aliases so links keep working).

create extension if not exists pg_trgm with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;

-- ───────────────────────── enums ─────────────────────────
create type public.term as enum ('fall', 'spring', 'summer', 'winter', 'january', 'full_year');
create type public.assignment_type as enum (
  'problem_set', 'homework', 'lab', 'essay', 'project', 'reading_response', 'quiz', 'exam', 'other'
);
create type public.statement_source as enum ('none', 'manual', 'pdf', 'latex', 'markdown', 'text', 'docx', 'ai_assisted');
create type public.extraction_status as enum ('none', 'auto', 'reviewed', 'needs_review', 'failed');
create type public.completion_status as enum (
  'solved_independently', 'solved_with_help', 'attempted_not_solved', 'not_attempted'
);
create type public.processing_status as enum ('uploaded', 'parsed', 'needs_review', 'published', 'failed');
create type public.document_visibility as enum ('private', 'public');
create type public.content_status as enum ('pending', 'active', 'hidden');
create type public.app_role as enum ('user', 'moderator', 'admin');
create type public.report_kind as enum ('incorrect_statement', 'duplicate', 'incorrect_parsing', 'content_concern', 'other');
create type public.report_status as enum ('open', 'resolved', 'dismissed');
create type public.proposal_status as enum ('pending', 'approved', 'rejected');

-- ───────────────────────── helpers ─────────────────────────
-- "MATH 55A", "math55a", "Math-55a" → "math55a"
create or replace function public.normalize_code(t text) returns text
language sql immutable parallel safe as $$
  select lower(regexp_replace(coalesce(t, ''), '[^a-zA-Z0-9]+', '', 'g'))
$$;

-- "Problem Set 4!" → "problem-set-4"
create or replace function public.slugify(t text) returns text
language sql immutable parallel safe as $$
  select coalesce(nullif(trim(both '-' from regexp_replace(lower(coalesce(t, '')), '[^a-z0-9]+', '-', 'g')), ''), 'item')
$$;

-- "Problem Set 4", "problem set #4" → "problem set 4" (used for duplicate detection)
create or replace function public.normalize_title(t text) returns text
language sql immutable parallel safe as $$
  select trim(regexp_replace(lower(coalesce(t, '')), '[^a-z0-9]+', ' ', 'g'))
$$;

-- ───────────────────────── identity ─────────────────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 60),
  avatar_url text check (char_length(avatar_url) <= 500),
  show_name boolean not null default false, -- contributions are anonymous unless the user opts in
  role public.app_role not null default 'user',
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

-- ───────────────────────── catalog ─────────────────────────
create table public.universities (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  short_name text check (char_length(short_name) <= 40),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  domain text check (domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  status public.content_status not null default 'pending',
  is_demo boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index universities_name_key on public.universities (lower(name));

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities (id) on delete cascade,
  code text not null check (char_length(code) between 1 and 40),
  code_normalized text generated always as (public.normalize_code(code)) stored,
  name text not null check (char_length(name) between 1 and 160),
  description text check (char_length(description) <= 2000),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  department text check (char_length(department) <= 80),
  status public.content_status not null default 'active',
  is_demo boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (university_id, slug),
  unique (university_id, code_normalized)
);
create index courses_code_trgm on public.courses using gin (code_normalized extensions.gin_trgm_ops);
create index courses_name_trgm on public.courses using gin (lower(name) extensions.gin_trgm_ops);

create table public.course_offerings (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  year int not null check (year between 1900 and 2200), -- calendar year the term starts in
  term public.term not null,
  -- Fall 2026 and Spring 2027 both belong to academic year 2026-27; summer belongs to the year it ends.
  academic_year text generated always as (
    case when term in ('fall', 'full_year') then year::text || '-' || lpad(((year + 1) % 100)::text, 2, '0')
         else (year - 1)::text || '-' || lpad((year % 100)::text, 2, '0') end
  ) stored,
  section text not null default '' check (char_length(section) <= 40),
  instructor text check (char_length(instructor) <= 120),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  status public.content_status not null default 'active',
  is_demo boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (course_id, slug),
  unique (course_id, year, term, section)
);

-- ───────────────────────── documents ─────────────────────────
create table public.source_documents (
  id uuid primary key default gen_random_uuid(),
  course_offering_id uuid not null references public.course_offerings (id) on delete cascade,
  assignment_id uuid, -- FK added after assignments exists
  uploader_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  filename text not null check (char_length(filename) between 1 and 200),
  storage_path text unique check (storage_path !~ '\.\.' and char_length(storage_path) <= 400),
  file_type text not null check (file_type in ('pdf', 'tex', 'markdown', 'text', 'docx', 'pasted')),
  size_bytes int not null default 0 check (size_bytes between 0 and 20971520),
  checksum text check (checksum ~ '^[0-9a-f]{64}$'),
  page_count int check (page_count between 0 and 500),
  visibility public.document_visibility not null default 'private',
  processing_status public.processing_status not null default 'uploaded',
  uploaded_at timestamptz not null default now()
);
create index source_documents_offering_idx on public.source_documents (course_offering_id);
create index source_documents_checksum_idx on public.source_documents (checksum) where checksum is not null;

-- ───────────────────────── assignments & problems ─────────────────────────
create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  course_offering_id uuid not null references public.course_offerings (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  title_normalized text generated always as (public.normalize_title(title)) stored,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  assignment_type public.assignment_type not null default 'problem_set',
  assignment_number numeric(6, 2),
  display_order int not null default 0,
  due_date date,
  description text check (char_length(description) <= 4000),
  source_document_id uuid references public.source_documents (id) on delete set null,
  status public.content_status not null default 'active',
  merged_into uuid references public.assignments (id) on delete set null,
  is_demo boolean not null default false,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_offering_id, slug)
);
create index assignments_offering_idx on public.assignments (course_offering_id, display_order);
create index assignments_title_trgm on public.assignments using gin (title_normalized extensions.gin_trgm_ops);

alter table public.source_documents
  add constraint source_documents_assignment_fk foreign key (assignment_id) references public.assignments (id) on delete set null;

create table public.problems (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  parent_problem_id uuid references public.problems (id) on delete cascade,
  label text not null check (char_length(label) between 1 and 60),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  display_order int not null default 0,
  title text check (char_length(title) <= 200),
  statement_markdown text check (char_length(statement_markdown) <= 20000),
  statement_source public.statement_source not null default 'none',
  source_page_start int check (source_page_start > 0),
  source_page_end int check (source_page_end >= source_page_start),
  source_location text check (char_length(source_location) <= 200),
  extraction_status public.extraction_status not null default 'none',
  -- Bumped when the question materially changes; ratings from older epochs are kept but not aggregated.
  rating_epoch int not null default 1,
  status public.content_status not null default 'active',
  merged_into uuid references public.problems (id) on delete set null,
  search_tsv tsvector generated always as (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(statement_markdown, ''))
  ) stored,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, slug),
  check (parent_problem_id is distinct from id)
);
create index problems_assignment_idx on public.problems (assignment_id, display_order);
create index problems_parent_idx on public.problems (parent_problem_id) where parent_problem_id is not null;
create index problems_search_idx on public.problems using gin (search_tsv);

-- ───────────────────────── ratings ─────────────────────────
create table public.ratings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  problem_id uuid not null references public.problems (id) on delete cascade,
  difficulty smallint not null check (difficulty between 1 and 10),
  time_minutes int check (time_minutes between 1 and 6000),
  completion_status public.completion_status,
  epoch int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ratings_one_per_user unique (user_id, problem_id)
);
create index ratings_problem_idx on public.ratings (problem_id, epoch) include (difficulty, time_minutes, completion_status);

-- Aggregates, maintained by trigger. Clients can read but never write this table.
create table public.problem_stats (
  problem_id uuid primary key references public.problems (id) on delete cascade,
  rating_count int not null default 0,
  mean numeric(5, 3),
  median numeric(4, 1),
  stddev numeric(5, 3),
  histogram int[] not null default array[0,0,0,0,0,0,0,0,0,0],
  time_count int not null default 0,
  median_time_minutes numeric(7, 1),
  completion jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ───────────────────────── history, contributions, moderation ─────────────────────────
create table public.problem_revisions (
  id uuid primary key default gen_random_uuid(),
  problem_id uuid not null references public.problems (id) on delete cascade,
  editor_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('create', 'statement', 'metadata', 'revert', 'merge', 'status')),
  before jsonb,
  after jsonb,
  note text check (char_length(note) <= 1000),
  material_change boolean not null default false,
  created_at timestamptz not null default now()
);
create index problem_revisions_problem_idx on public.problem_revisions (problem_id, created_at desc);

create table public.edit_proposals (
  id uuid primary key default gen_random_uuid(),
  problem_id uuid not null references public.problems (id) on delete cascade,
  proposer_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  changes jsonb not null, -- subset of {label, title, statement_markdown}
  note text check (char_length(note) <= 1000),
  material_change boolean not null default false,
  status public.proposal_status not null default 'pending',
  reviewer_id uuid references auth.users (id) on delete set null,
  review_note text check (char_length(review_note) <= 1000),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index edit_proposals_pending_idx on public.edit_proposals (created_at) where status = 'pending';

create table public.moderation_reports (
  id uuid primary key default gen_random_uuid(),
  problem_id uuid references public.problems (id) on delete cascade,
  assignment_id uuid references public.assignments (id) on delete cascade,
  kind public.report_kind not null,
  details text check (char_length(details) <= 2000),
  duplicate_of_problem_id uuid references public.problems (id) on delete set null,
  duplicate_of_assignment_id uuid references public.assignments (id) on delete set null,
  reporter_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  status public.report_status not null default 'open',
  resolved_by uuid references auth.users (id) on delete set null,
  resolution_note text check (char_length(resolution_note) <= 1000),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  check (problem_id is not null or assignment_id is not null)
);
create index moderation_reports_open_idx on public.moderation_reports (created_at) where status = 'open';

create table public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  moderator_id uuid references auth.users (id) on delete set null,
  action text not null,
  target_type text not null,
  target_id uuid not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.slug_aliases (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('course', 'offering', 'assignment', 'problem')),
  scope_id uuid not null, -- parent id (university for courses, course for offerings, …)
  old_slug text not null,
  entity_id uuid not null,
  created_at timestamptz not null default now(),
  unique (entity_type, scope_id, old_slug)
);

create table public.saved_courses (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, course_id)
);

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid default auth.uid() references auth.users (id) on delete set null,
  message text not null check (char_length(message) between 3 and 4000),
  page text check (char_length(page) <= 300),
  created_at timestamptz not null default now()
);

-- Write throttling (internal; not exposed through the API).
create table private.rate_limit_events (
  user_id uuid not null,
  action text not null,
  created_at timestamptz not null default now()
);
create index rate_limit_events_idx on private.rate_limit_events (user_id, action, created_at desc);
