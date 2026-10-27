-- hardest: triggers, aggregation, and RPCs.
-- Security model: catalog/content tables have NO client write policies. All content writes go through the
-- SECURITY DEFINER functions below, which check auth.uid(), roles, rate limits, and validate input.
-- Ratings are the exception: users write their own rows directly (RLS), and a trigger maintains aggregates.

-- ───────────────────────── auth helpers ─────────────────────────
create or replace function public.is_moderator() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('moderator', 'admin'))
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
$$;

create or replace function private.require_user() returns uuid
language plpgsql stable as $$
declare uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Sign in to contribute.' using errcode = '28000', hint = 'auth_required';
  end if;
  return uid;
end $$;

create or replace function private.require_moderator() returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare uid uuid := private.require_user();
begin
  if not public.is_moderator() then
    raise exception 'Moderator permission required.' using errcode = '42501', hint = 'forbidden';
  end if;
  return uid;
end $$;

-- Sliding-window write throttle, keyed on the calling user.
create or replace function private.check_rate(p_action text, p_max int, p_window interval) returns void
language plpgsql security definer set search_path = private, pg_temp as $$
declare uid uuid := auth.uid(); n int;
begin
  if uid is null then return; end if; -- service role / migrations / seeds
  select count(*) into n from private.rate_limit_events
   where user_id = uid and action = p_action and created_at > now() - p_window;
  if n >= p_max then
    raise exception 'You are doing that too often. Please wait a few minutes and try again.'
      using errcode = 'P0001', hint = 'rate_limited';
  end if;
  insert into private.rate_limit_events (user_id, action) values (uid, p_action);
  -- opportunistic cleanup of this user's stale events
  delete from private.rate_limit_events where user_id = uid and created_at < now() - interval '2 days';
end $$;

create or replace function private.touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create trigger assignments_touch before update on public.assignments
  for each row execute function private.touch_updated_at();
create trigger problems_touch before update on public.problems
  for each row execute function private.touch_updated_at();

-- ───────────────────────── profiles ─────────────────────────
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (new.id,
          nullif(left(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''), 60), ''),
          nullif(left(coalesce(new.raw_user_meta_data ->> 'avatar_url', ''), 500), ''))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- Users may edit their own display fields but never their role.
create or replace function private.guard_profile() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and (new.role is distinct from old.role or new.is_demo is distinct from old.is_demo)
     and not public.is_admin() then
    raise exception 'Only admins can change roles.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles
  for each row execute function private.guard_profile();

-- ───────────────────────── slugs ─────────────────────────
-- Returns p_base, or p_base-2, p_base-3… — the first slug not used in the given scope.
create or replace function private.free_slug(p_table text, p_scope_col text, p_scope uuid, p_base text, p_exclude uuid default null)
returns text language plpgsql as $$
declare candidate text := p_base; i int := 1; taken boolean;
begin
  loop
    execute format('select exists (select 1 from public.%I where %I = $1 and slug = $2 and id is distinct from $3)', p_table, p_scope_col)
      into taken using p_scope, candidate, p_exclude;
    exit when not taken;
    i := i + 1;
    candidate := p_base || '-' || i;
  end loop;
  return candidate;
end $$;

create or replace function public.assignment_base_slug(p_title text, p_type public.assignment_type, p_number numeric)
returns text language sql immutable as $$
  select case
    when p_number is not null and p_type <> 'other' then
      (case p_type when 'problem_set' then 'pset' when 'homework' then 'hw' when 'reading_response' then 'response'
                   else p_type::text end)
      || '-' || public.slugify(trim(trailing '.' from trim(trailing '0' from p_number::numeric(6, 2)::text)))
    else public.slugify(p_title) end
$$;

-- '2' → 'p2'; '3' + child 'b' → 'p3b'; 'Essay Prompt A' → 'essay-prompt-a'; 'ii' under 'p3' → 'p3-ii'
create or replace function public.problem_base_slug(p_label text, p_parent_slug text)
returns text language sql immutable as $$
  select case
    when p_parent_slug is null then
      case when lower(trim(p_label)) ~ '^[0-9]+[a-z]?$' then 'p' || lower(trim(p_label)) else public.slugify(p_label) end
    when lower(trim(p_label)) ~ '^[a-z]$' and p_parent_slug ~ '[0-9]$' then p_parent_slug || lower(trim(p_label))
    else p_parent_slug || '-' || public.slugify(p_label) end
$$;

-- ───────────────────────── rating aggregation ─────────────────────────
create or replace function private.refresh_problem_stats(p uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare ep int;
begin
  -- Serialize recomputation per problem so concurrent votes can't leave a stale aggregate.
  -- (READ COMMITTED: the aggregate below takes a fresh snapshot after the lock is acquired.)
  perform pg_advisory_xact_lock(hashtextextended('problem_stats:' || p::text, 0));
  select rating_epoch into ep from public.problems where id = p;
  if ep is null then return; end if;

  insert into public.problem_stats as s
    (problem_id, rating_count, mean, median, stddev, histogram, time_count, median_time_minutes, completion, updated_at)
  select p,
         count(*),
         round(avg(difficulty)::numeric, 3),
         percentile_cont(0.5) within group (order by difficulty),
         round(stddev_samp(difficulty)::numeric, 3),
         array[count(*) filter (where difficulty = 1), count(*) filter (where difficulty = 2),
               count(*) filter (where difficulty = 3), count(*) filter (where difficulty = 4),
               count(*) filter (where difficulty = 5), count(*) filter (where difficulty = 6),
               count(*) filter (where difficulty = 7), count(*) filter (where difficulty = 8),
               count(*) filter (where difficulty = 9), count(*) filter (where difficulty = 10)]::int[],
         count(time_minutes),
         percentile_cont(0.5) within group (order by time_minutes),
         jsonb_build_object(
           'solved_independently', count(*) filter (where completion_status = 'solved_independently'),
           'solved_with_help', count(*) filter (where completion_status = 'solved_with_help'),
           'attempted_not_solved', count(*) filter (where completion_status = 'attempted_not_solved'),
           'not_attempted', count(*) filter (where completion_status = 'not_attempted')),
         now()
    from public.ratings r
   where r.problem_id = p and r.epoch = ep
  on conflict (problem_id) do update set
    rating_count = excluded.rating_count, mean = excluded.mean, median = excluded.median, stddev = excluded.stddev,
    histogram = excluded.histogram, time_count = excluded.time_count,
    median_time_minutes = excluded.median_time_minutes, completion = excluded.completion, updated_at = now();
end $$;

create or replace function private.ratings_before_write() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare prob record; merging boolean := coalesce(current_setting('hardest.merging', true), '') = 'on';
begin
  if tg_op = 'UPDATE' and (new.user_id <> old.user_id or new.problem_id <> old.problem_id) and not merging then
    raise exception 'Ratings cannot be moved.' using errcode = '42501';
  end if;
  select p.id, p.rating_epoch, p.merged_into, p.status,
         exists (select 1 from public.problems c where c.parent_problem_id = p.id and c.merged_into is null) as has_children
    into prob from public.problems p where p.id = new.problem_id;
  if not merging then
    if prob.merged_into is not null then
      raise exception 'This problem was merged into another problem.' using errcode = 'P0001', hint = 'problem_merged';
    end if;
    if prob.status = 'hidden' then
      raise exception 'This problem is not available.' using errcode = 'P0001';
    end if;
    if prob.has_children then
      raise exception 'Rate the individual parts of this problem.' using errcode = 'P0001', hint = 'rate_parts';
    end if;
    perform private.check_rate('rating', 200, interval '10 minutes');
  end if;
  new.epoch := prob.rating_epoch;
  new.updated_at := now();
  return new;
end $$;

create trigger ratings_before_write before insert or update on public.ratings
  for each row execute function private.ratings_before_write();

create or replace function private.ratings_after_write() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then perform private.refresh_problem_stats(new.problem_id); end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.problem_id <> new.problem_id) then
    perform private.refresh_problem_stats(old.problem_id);
  end if;
  return null;
end $$;

create trigger ratings_after_write after insert or update or delete on public.ratings
  for each row execute function private.ratings_after_write();

-- ───────────────────────── reads ─────────────────────────
-- Resolve a URL path to ids, following renamed slugs (slug_aliases) and merged records.
create or replace function public.resolve_path(
  p_university text, p_course text, p_offering text default null, p_assignment text default null, p_problem text default null
) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  u public.universities; c public.courses; o public.course_offerings; a public.assignments; p public.problems;
  redirected boolean := false; target uuid;
begin
  select * into u from public.universities where slug = lower(p_university);
  if not found then return null; end if;

  select * into c from public.courses where university_id = u.id and slug = lower(p_course);
  if not found then
    select entity_id into target from public.slug_aliases where entity_type = 'course' and scope_id = u.id and old_slug = lower(p_course);
    select * into c from public.courses where id = target;
    if not found then return jsonb_build_object('university', to_jsonb(u), 'course', null); end if;
    redirected := true;
  end if;

  if p_offering is not null then
    select * into o from public.course_offerings where course_id = c.id and slug = lower(p_offering);
    if not found then
      select entity_id into target from public.slug_aliases where entity_type = 'offering' and scope_id = c.id and old_slug = lower(p_offering);
      select * into o from public.course_offerings where id = target;
      if found then redirected := true; end if;
    end if;
  end if;

  if o.id is not null and p_assignment is not null then
    select * into a from public.assignments where course_offering_id = o.id and slug = lower(p_assignment);
    if not found then
      select entity_id into target from public.slug_aliases where entity_type = 'assignment' and scope_id = o.id and old_slug = lower(p_assignment);
      select * into a from public.assignments where id = target;
      if found then redirected := true; end if;
    end if;
    while a.merged_into is not null loop
      select * into a from public.assignments where id = a.merged_into; redirected := true;
    end loop;
  end if;

  if a.id is not null and p_problem is not null then
    select * into p from public.problems where assignment_id = a.id and slug = lower(p_problem);
    if not found then
      select entity_id into target from public.slug_aliases where entity_type = 'problem' and scope_id = a.id and old_slug = lower(p_problem);
      select * into p from public.problems where id = target;
      if found then redirected := true; end if;
    end if;
    while p.merged_into is not null loop
      select * into p from public.problems where id = p.merged_into; redirected := true;
    end loop;
    if p.id is not null and p.assignment_id <> a.id then
      select * into a from public.assignments where id = p.assignment_id;
    end if;
  end if;

  return jsonb_build_object(
    'university', to_jsonb(u),
    'course', to_jsonb(c),
    'offerings', coalesce((select jsonb_agg(to_jsonb(x) order by x.year desc, x.term, x.section)
                             from public.course_offerings x where x.course_id = c.id and x.status <> 'hidden'), '[]'::jsonb),
    'offering', case when o.id is null then null else to_jsonb(o) end,
    'assignment', case when a.id is null then null else jsonb_build_object('id', a.id, 'slug', a.slug) end,
    'problem', case when p.id is null then null else jsonb_build_object('id', p.id, 'slug', p.slug) end,
    'redirected', redirected
  );
end $$;

-- Everything the heatmap needs for one offering, in one round trip, without individual ratings.
create or replace function public.get_offering_overview(p_offering uuid) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select jsonb_build_object('assignments', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'title', a.title, 'slug', a.slug, 'assignment_type', a.assignment_type,
      'assignment_number', a.assignment_number, 'display_order', a.display_order, 'due_date', a.due_date,
      'description', a.description, 'is_demo', a.is_demo, 'status', a.status, 'created_at', a.created_at,
      'source_document_id', a.source_document_id,
      'problems', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', p.id, 'parent_problem_id', p.parent_problem_id, 'label', p.label, 'slug', p.slug,
          'display_order', p.display_order, 'title', p.title,
          'has_statement', coalesce(p.statement_markdown, '') <> '',
          'stats', case when s.problem_id is null or s.rating_count = 0 then null else jsonb_build_object(
            'rating_count', s.rating_count, 'mean', s.mean, 'median', s.median, 'stddev', s.stddev,
            'histogram', s.histogram, 'time_count', s.time_count, 'median_time_minutes', s.median_time_minutes,
            'completion', s.completion) end
        ) order by p.display_order, p.created_at)
        from public.problems p left join public.problem_stats s on s.problem_id = p.id
        where p.assignment_id = a.id and p.merged_into is null and p.status <> 'hidden'), '[]'::jsonb)
    ) order by a.display_order, a.assignment_number nulls last, a.created_at)
    from public.assignments a
    where a.course_offering_id = p_offering and a.merged_into is null and a.status <> 'hidden'), '[]'::jsonb))
$$;

-- Counts for the problem detail view. SECURITY DEFINER because problem_revisions and edit_proposals are not
-- readable by regular users under RLS (an invoker count would always be 0); only the counts are exposed.
create or replace function public.problem_activity_counts(p_problem uuid, out revision_count int, out pending_proposals int)
language sql stable security definer set search_path = public, pg_temp as $$
  select (select count(*)::int from public.problem_revisions r where r.problem_id = p_problem),
         (select count(*)::int from public.edit_proposals e where e.problem_id = p_problem and e.status = 'pending')
$$;

create or replace function public.get_problem_detail(p_problem uuid) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'problem', jsonb_build_object(
      'id', p.id, 'assignment_id', p.assignment_id, 'parent_problem_id', p.parent_problem_id, 'label', p.label,
      'slug', p.slug, 'title', p.title, 'statement_markdown', p.statement_markdown, 'statement_source', p.statement_source,
      'source_page_start', p.source_page_start, 'source_page_end', p.source_page_end, 'source_location', p.source_location,
      'extraction_status', p.extraction_status, 'rating_epoch', p.rating_epoch, 'updated_at', p.updated_at),
    'parent_label', (select pp.label from public.problems pp where pp.id = p.parent_problem_id),
    'stats', (select to_jsonb(s) - 'problem_id' from public.problem_stats s where s.problem_id = p.id and s.rating_count > 0),
    'source_document', (select jsonb_build_object('id', d.id, 'filename', d.filename, 'file_type', d.file_type,
                                                  'storage_path', d.storage_path, 'visibility', d.visibility, 'page_count', d.page_count)
                          from public.source_documents d
                          join public.assignments a2 on a2.source_document_id = d.id
                         where a2.id = p.assignment_id),
    'revision_count', c.revision_count,
    'pending_proposals', c.pending_proposals
  )
  from public.problems p cross join lateral public.problem_activity_counts(p.id) c where p.id = p_problem
$$;

create or replace function public.my_ratings(p_offering uuid)
returns table (problem_id uuid, difficulty smallint, time_minutes int, completion_status public.completion_status, stale boolean, updated_at timestamptz)
language sql stable security invoker set search_path = public, pg_temp as $$
  select r.problem_id, r.difficulty, r.time_minutes, r.completion_status, r.epoch <> p.rating_epoch, r.updated_at
    from public.ratings r
    join public.problems p on p.id = r.problem_id
    join public.assignments a on a.id = p.assignment_id
   where r.user_id = auth.uid() and a.course_offering_id = p_offering
$$;

-- Offerings the current user has rated in, for "My courses".
create or replace function public.my_rated_offerings()
returns table (offering_id uuid, rated int, last_rated_at timestamptz)
language sql stable security invoker set search_path = public, pg_temp as $$
  select a.course_offering_id, count(*)::int, max(r.updated_at)
    from public.ratings r join public.problems p on p.id = r.problem_id join public.assignments a on a.id = p.assignment_id
   where r.user_id = auth.uid()
   group by a.course_offering_id
$$;

-- Course search. Matches normalized course codes ("math55a", "55a"), names (trigram), and university names.
create or replace function public.search_courses(q text, p_university uuid default null, p_limit int default 20)
returns table (course_id uuid, university_id uuid, university_slug text, university_name text, university_short_name text,
               code text, name text, slug text, description text, offerings jsonb, score real)
language sql stable security invoker set search_path = public, extensions, pg_temp as $$
  with i as (select public.normalize_code(q) as qn, lower(trim(coalesce(q, ''))) as ql),
  scored as (
    select c.*, u.slug as u_slug, u.name as u_name, u.short_name as u_short,
      greatest(
        case when i.qn = '' then 0.3
             when c.code_normalized = i.qn then 1.0
             when c.code_normalized like i.qn || '%' then 0.92
             when length(i.qn) >= 2 and c.code_normalized like '%' || i.qn || '%' then 0.8
             else 0 end,
        similarity(c.code_normalized, i.qn) * 0.8,
        case when length(i.ql) >= 3 then word_similarity(i.ql, lower(c.name)) * 0.85 else 0 end,
        case when length(i.ql) >= 4 then word_similarity(i.ql, lower(coalesce(c.description, ''))) * 0.5 else 0 end,
        case when length(i.ql) >= 3 and (lower(u.name) like '%' || i.ql || '%' or lower(coalesce(u.short_name, '')) = i.ql) then 0.6 else 0 end
      )::real as score
    from public.courses c join public.universities u on u.id = c.university_id cross join i
    where c.status = 'active' and u.status = 'active' and (p_university is null or u.id = p_university)
  )
  select s.id, s.university_id, s.u_slug, s.u_name, s.u_short, s.code, s.name, s.slug, s.description,
    coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'slug', o.slug, 'term', o.term, 'year', o.year,
                                                  'section', o.section, 'instructor', o.instructor)
                               order by o.year desc, o.term)
                from public.course_offerings o where o.course_id = s.id and o.status = 'active'), '[]'::jsonb),
    s.score
  from scored s
  where s.score >= 0.3
  order by s.score desc, s.code
  limit least(greatest(p_limit, 1), 50)
$$;

-- Full-text search over published problem statements.
create or replace function public.search_problems(q text, p_offering uuid default null, p_limit int default 20)
returns table (problem_id uuid, label text, parent_label text, problem_slug text, assignment_title text, assignment_slug text,
               offering_slug text, course_code text, course_slug text, university_slug text, snippet text, rank real)
language sql stable security invoker set search_path = public, pg_temp as $$
  with query as (select websearch_to_tsquery('english', q) as tsq)
  select p.id, p.label, pp.label, p.slug, a.title, a.slug, o.slug, c.code, c.slug, u.slug,
         ts_headline('english', coalesce(p.statement_markdown, ''), query.tsq,
                     'StartSel=«, StopSel=», MaxWords=24, MinWords=8, ShortWord=2, MaxFragments=1'),
         ts_rank(p.search_tsv, query.tsq)
    from public.problems p
    left join public.problems pp on pp.id = p.parent_problem_id
    join public.assignments a on a.id = p.assignment_id
    join public.course_offerings o on o.id = a.course_offering_id
    join public.courses c on c.id = o.course_id
    join public.universities u on u.id = c.university_id
    cross join query
   where p.search_tsv @@ query.tsq and p.merged_into is null and p.status = 'active' and a.status = 'active'
     and (p_offering is null or o.id = p_offering)
   order by 12 desc
   limit least(greatest(p_limit, 1), 50)
$$;

-- Offerings with the most activity, for the home page.
create or replace function public.featured_offerings(p_limit int default 6)
returns table (offering_id uuid, offering_slug text, term public.term, year int, section text, course_code text, course_name text,
               course_slug text, university_slug text, university_name text, assignment_count int, problem_count int,
               rating_count int, is_demo boolean)
language sql stable security invoker set search_path = public, pg_temp as $$
  select o.id, o.slug, o.term, o.year, o.section, c.code, c.name, c.slug, u.slug, coalesce(u.short_name, u.name),
         (select count(*) from public.assignments a where a.course_offering_id = o.id and a.merged_into is null and a.status = 'active')::int,
         (select count(*) from public.problems p join public.assignments a on a.id = p.assignment_id
           where a.course_offering_id = o.id and p.merged_into is null and p.status = 'active' and a.status = 'active')::int as problems,
         coalesce((select sum(s.rating_count) from public.problem_stats s join public.problems p on p.id = s.problem_id
                     join public.assignments a on a.id = p.assignment_id where a.course_offering_id = o.id), 0)::int as votes,
         o.is_demo
    from public.course_offerings o join public.courses c on c.id = o.course_id join public.universities u on u.id = c.university_id
   where o.status = 'active' and c.status = 'active' and u.status = 'active'
   order by votes desc, problems desc, o.year desc
   limit least(greatest(p_limit, 1), 24)
$$;

-- Contribution history for a problem. Editors are never identified, only whether it was the caller.
create or replace function public.problem_history(p_problem uuid)
returns table (id uuid, kind text, before jsonb, after jsonb, note text, material_change boolean, created_at timestamptz, is_mine boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select r.id, r.kind, r.before, r.after, r.note, r.material_change, r.created_at, r.editor_id = auth.uid()
    from public.problem_revisions r
    join public.problems p on p.id = r.problem_id
   where r.problem_id = p_problem and (p.status <> 'hidden' or public.is_moderator())
   order by r.created_at desc
   limit 100
$$;

-- ───────────────────────── ratings (invoker: RLS applies) ─────────────────────────
create or replace function public.rate_problem(
  p_problem uuid, p_difficulty int, p_time_minutes int default null, p_completion public.completion_status default null
) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Sign in to rate problems.' using errcode = '28000', hint = 'auth_required'; end if;
  insert into public.ratings (user_id, problem_id, difficulty, time_minutes, completion_status)
  values (uid, p_problem, p_difficulty, p_time_minutes, p_completion)
  on conflict (user_id, problem_id) do update
    set difficulty = excluded.difficulty, time_minutes = excluded.time_minutes, completion_status = excluded.completion_status;
  return (select to_jsonb(s) - 'problem_id' from public.problem_stats s where s.problem_id = p_problem);
end $$;

create or replace function public.clear_rating(p_problem uuid) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Sign in to rate problems.' using errcode = '28000', hint = 'auth_required'; end if;
  delete from public.ratings where user_id = uid and problem_id = p_problem;
  return (select to_jsonb(s) - 'problem_id' from public.problem_stats s where s.problem_id = p_problem and s.rating_count > 0);
end $$;

-- ───────────────────────── catalog contributions ─────────────────────────
create or replace function public.create_university(p_name text, p_short_name text default null, p_domain text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid := private.require_user(); existing public.universities; new_id uuid; s text;
begin
  perform private.check_rate('catalog', 30, interval '1 day');
  p_name := trim(regexp_replace(p_name, '\s+', ' ', 'g'));
  select * into existing from public.universities
   where lower(name) = lower(p_name) or (p_domain is not null and domain = lower(p_domain)) or similarity(lower(name), lower(p_name)) > 0.75
   order by similarity(lower(name), lower(p_name)) desc limit 1;
  if found then
    return jsonb_build_object('id', existing.id, 'slug', existing.slug, 'existing', true, 'status', existing.status);
  end if;
  s := private.free_slug_global('universities', public.slugify(coalesce(nullif(trim(p_short_name), ''), p_name)));
  insert into public.universities (name, short_name, slug, domain, status, created_by)
  values (p_name, nullif(trim(p_short_name), ''), s, nullif(lower(trim(p_domain)), ''),
          case when public.is_moderator() then 'active' else 'pending' end::public.content_status, uid)
  returning id into new_id;
  return jsonb_build_object('id', new_id, 'slug', s, 'existing', false,
                            'status', case when public.is_moderator() then 'active' else 'pending' end);
end $$;

create or replace function private.free_slug_global(p_table text, p_base text) returns text
language plpgsql as $$
declare candidate text := p_base; i int := 1; taken boolean;
begin
  loop
    execute format('select exists (select 1 from public.%I where slug = $1)', p_table) into taken using candidate;
    exit when not taken;
    i := i + 1; candidate := p_base || '-' || i;
  end loop;
  return candidate;
end $$;

create or replace function public.create_course(
  p_university uuid, p_code text, p_name text, p_description text default null, p_department text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := private.require_user(); u public.universities; existing public.courses; new_id uuid; s text;
begin
  perform private.check_rate('catalog', 30, interval '1 day');
  select * into u from public.universities where id = p_university;
  if not found or (u.status <> 'active' and u.created_by is distinct from uid and not public.is_moderator()) then
    raise exception 'University not found.' using errcode = 'P0002';
  end if;
  p_code := upper(trim(regexp_replace(p_code, '\s+', ' ', 'g')));
  p_name := trim(regexp_replace(p_name, '\s+', ' ', 'g'));
  if public.normalize_code(p_code) = '' then raise exception 'Course code is required.'; end if;
  select * into existing from public.courses where university_id = u.id and code_normalized = public.normalize_code(p_code);
  if found then
    return jsonb_build_object('id', existing.id, 'slug', existing.slug, 'existing', true);
  end if;
  s := private.free_slug('courses', 'university_id', u.id, public.slugify(p_code));
  insert into public.courses (university_id, code, name, description, department, slug, created_by)
  values (u.id, p_code, p_name, nullif(trim(p_description), ''), nullif(trim(p_department), ''), s, uid)
  returning id into new_id;
  return jsonb_build_object('id', new_id, 'slug', s, 'existing', false);
end $$;

create or replace function public.offering_slug(p_term public.term, p_year int, p_section text)
returns text language sql immutable as $$
  select replace(p_term::text, '_', '-') || '-' || p_year
         || case when coalesce(trim(p_section), '') = '' then '' else '-' || public.slugify(p_section) end
$$;

create or replace function public.create_offering(
  p_course uuid, p_year int, p_term public.term, p_section text default '', p_instructor text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := private.require_user(); c public.courses; existing public.course_offerings; new_id uuid; s text;
begin
  perform private.check_rate('catalog', 30, interval '1 day');
  select * into c from public.courses where id = p_course and (status = 'active' or created_by = uid or public.is_moderator());
  if not found then raise exception 'Course not found.' using errcode = 'P0002'; end if;
  if p_year < extract(year from now())::int - 30 or p_year > extract(year from now())::int + 2 then
    raise exception 'Choose a year between % and %.', extract(year from now())::int - 30, extract(year from now())::int + 2;
  end if;
  p_section := coalesce(trim(p_section), '');
  select * into existing from public.course_offerings where course_id = c.id and year = p_year and term = p_term and section = p_section;
  if found then
    return jsonb_build_object('id', existing.id, 'slug', existing.slug, 'existing', true);
  end if;
  s := private.free_slug('course_offerings', 'course_id', c.id, public.offering_slug(p_term, p_year, p_section));
  insert into public.course_offerings (course_id, year, term, section, instructor, slug, created_by)
  values (c.id, p_year, p_term, p_section, nullif(trim(p_instructor), ''), s, uid)
  returning id into new_id;
  return jsonb_build_object('id', new_id, 'slug', s, 'existing', false);
end $$;

-- ───────────────────────── documents ─────────────────────────
-- Registers an upload before the file is sent to Storage; the returned path is the only one the storage
-- policy will accept for this user, so clients can't choose arbitrary paths.
create or replace function public.register_source_document(
  p_offering uuid, p_filename text, p_file_type text, p_size_bytes int, p_checksum text, p_page_count int default null,
  p_visibility public.document_visibility default 'private', p_store_file boolean default true
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := private.require_user(); new_id uuid := gen_random_uuid(); safe_name text; path text;
begin
  perform private.check_rate('upload', 30, interval '1 hour');
  if not exists (select 1 from public.course_offerings where id = p_offering and (status = 'active' or created_by = uid)) then
    raise exception 'Semester not found.' using errcode = 'P0002';
  end if;
  safe_name := left(regexp_replace(regexp_replace(coalesce(p_filename, 'document'), '^.*[\\/]', ''), '[^A-Za-z0-9._-]+', '_', 'g'), 120);
  safe_name := regexp_replace(safe_name, '^\.+', '');
  if safe_name = '' then safe_name := 'document'; end if;
  path := case when p_store_file and p_file_type <> 'pasted' then uid::text || '/' || new_id::text || '/' || safe_name end;
  insert into public.source_documents (id, course_offering_id, uploader_id, filename, storage_path, file_type, size_bytes,
                                       checksum, page_count, visibility)
  values (new_id, p_offering, uid, left(coalesce(p_filename, 'document'), 200), path, p_file_type, coalesce(p_size_bytes, 0),
          lower(p_checksum), p_page_count, p_visibility);
  return jsonb_build_object('id', new_id, 'storage_path', path);
end $$;

-- ───────────────────────── duplicate detection ─────────────────────────
create or replace function public.find_assignment_duplicates(
  p_offering uuid, p_title text, p_type public.assignment_type default null, p_number numeric default null,
  p_checksum text default null, p_labels text[] default '{}', p_text_sample text default null
) returns table (assignment_id uuid, title text, slug text, offering_id uuid, offering_label text, same_offering boolean,
                 problem_count int, score real, reasons text[])
language plpgsql stable security invoker set search_path = public, extensions, pg_temp as $$
declare nt text := public.normalize_title(p_title); sample text := left(lower(coalesce(p_text_sample, '')), 4000);
begin
  return query
  with cand as (
    select a.id, a.title, a.slug, a.course_offering_id, a.assignment_type, a.assignment_number, a.title_normalized,
      (select array_agg(lower(p.label)) from public.problems p where p.assignment_id = a.id and p.parent_problem_id is null and p.merged_into is null) as labels,
      (select left(lower(string_agg(coalesce(p.statement_markdown, ''), ' ' order by p.display_order)), 4000)
         from public.problems p where p.assignment_id = a.id and p.merged_into is null) as body,
      exists (select 1 from public.source_documents d where d.assignment_id = a.id and p_checksum is not null and d.checksum = lower(p_checksum)) as same_file,
      (select count(*)::int from public.problems p where p.assignment_id = a.id and p.merged_into is null) as n
    from public.assignments a
    where a.merged_into is null and a.status <> 'hidden'
      and (a.course_offering_id = p_offering
           or (p_checksum is not null and exists (select 1 from public.source_documents d where d.assignment_id = a.id and d.checksum = lower(p_checksum))))
  ),
  scored as (
    select cand.*,
      array_remove(array[
        case when same_file then 'The same file was uploaded before' end,
        case when cand.title_normalized = nt then 'Same title'
             when similarity(cand.title_normalized, nt) >= 0.5 then 'Similar title' end,
        case when p_number is not null and cand.assignment_number = p_number and cand.assignment_type = coalesce(p_type, cand.assignment_type)
             then 'Same assignment number' end,
        case when cardinality(p_labels) > 0 and cand.labels is not null
                  and (select count(*) from unnest(p_labels) l where lower(l) = any(cand.labels)) >= greatest(2, cardinality(p_labels) / 2)
             then 'Matching problem labels' end,
        case when length(sample) > 80 and length(cand.body) > 80 and similarity(cand.body, sample) >= 0.35 then 'Similar problem text' end
      ], null) as why,
      ( case when same_file then 1.0 else 0 end
      + case when cand.title_normalized = nt then 0.9 else greatest(similarity(cand.title_normalized, nt) - 0.3, 0) end
      + case when p_number is not null and cand.assignment_number = p_number and cand.assignment_type = coalesce(p_type, cand.assignment_type) then 0.8 else 0 end
      + case when length(sample) > 80 and length(cand.body) > 80 then greatest(similarity(cand.body, sample) - 0.2, 0) else 0 end
      )::real as total
    from cand
  )
  select s.id, s.title, s.slug, s.course_offering_id,
         (select initcap(replace(o.term::text, '_', ' ')) || ' ' || o.year || coalesce(' · ' || nullif(o.section, ''), '') from public.course_offerings o where o.id = s.course_offering_id),
         s.course_offering_id = p_offering, s.n, s.total, s.why
    from scored s
   where s.total >= 0.6 or 'The same file was uploaded before' = any(s.why)
   order by s.total desc
   limit 5;
end $$;

-- ───────────────────────── publishing ─────────────────────────
-- Inserts one problem (and its children) — internal helper for publish_assignment and add_problem.
create or replace function private.insert_problem(
  p_assignment uuid, p_parent uuid, p_node jsonb, p_order int, p_publish_statement boolean, p_user uuid
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare new_id uuid; parent_slug text; s text; stmt text; src public.statement_source; child jsonb; i int := 0;
begin
  if coalesce(trim(p_node ->> 'label'), '') = '' then raise exception 'Every problem needs a label.'; end if;
  if char_length(p_node ->> 'label') > 60 then raise exception 'Problem labels must be at most 60 characters.'; end if;
  select slug into parent_slug from public.problems where id = p_parent;
  s := private.free_slug('problems', 'assignment_id', p_assignment, public.problem_base_slug(p_node ->> 'label', parent_slug));
  stmt := case when p_publish_statement then nullif(trim(p_node ->> 'statement_markdown'), '') end;
  src := case when stmt is null then 'none' else coalesce(nullif(p_node ->> 'statement_source', ''), 'manual') end::public.statement_source;
  insert into public.problems (assignment_id, parent_problem_id, label, slug, display_order, title, statement_markdown,
                               statement_source, source_page_start, source_page_end, extraction_status, created_by)
  values (p_assignment, p_parent, trim(p_node ->> 'label'), s, p_order, nullif(trim(p_node ->> 'title'), ''), stmt, src,
          nullif(p_node ->> 'source_page_start', '')::int, nullif(p_node ->> 'source_page_end', '')::int,
          case when stmt is null then 'none' when src in ('manual') then 'reviewed' else 'reviewed' end::public.extraction_status,
          p_user)
  returning id into new_id;
  insert into public.problem_revisions (problem_id, editor_id, kind, after)
  values (new_id, p_user, 'create', jsonb_build_object('label', trim(p_node ->> 'label'), 'title', nullif(trim(p_node ->> 'title'), ''),
                                                       'statement_markdown', stmt));
  if p_parent is null and jsonb_typeof(p_node -> 'children') = 'array' then
    for child in select * from jsonb_array_elements(p_node -> 'children') loop
      i := i + 1;
      perform private.insert_problem(p_assignment, new_id, child, i, p_publish_statement, p_user);
    end loop;
  end if;
  return new_id;
end $$;

-- payload: { offering_id, assignment_id?, assignment: {title, assignment_type, assignment_number, due_date, description},
--            source_document_id?, publish_statements: bool, force_distinct: bool,
--            problems: [{label, title, statement_markdown, statement_source, source_page_start, source_page_end, children: [...]}] }
create or replace function public.publish_assignment(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := private.require_user();
  off public.course_offerings; a public.assignments; meta jsonb := payload -> 'assignment';
  publish_statements boolean := coalesce((payload ->> 'publish_statements')::boolean, true);
  node jsonb; child jsonb; existing_id uuid; created int := 0; skipped text[] := '{}'; next_order int; total int; dup uuid;
  a_type public.assignment_type; a_number numeric; labels text[];
begin
  perform private.check_rate('publish', 20, interval '1 hour');
  select * into off from public.course_offerings where id = (payload ->> 'offering_id')::uuid
     and (status = 'active' or created_by = uid or public.is_moderator());
  if not found then raise exception 'Semester not found.' using errcode = 'P0002'; end if;

  if jsonb_typeof(payload -> 'problems') <> 'array' then raise exception 'No problems to publish.'; end if;
  select count(*) + coalesce(sum(jsonb_array_length(coalesce(e -> 'children', '[]'::jsonb))), 0) into total
    from jsonb_array_elements(payload -> 'problems') e;
  if total = 0 then raise exception 'Add at least one problem.'; end if;
  if total > 300 then raise exception 'An assignment can have at most 300 problems.'; end if;
  select array_agg(lower(trim(e ->> 'label'))) into labels from jsonb_array_elements(payload -> 'problems') e;
  if (select count(distinct l) from unnest(labels) l) <> cardinality(labels) then
    raise exception 'Problem labels must be unique.' using hint = 'duplicate_labels';
  end if;

  if payload ->> 'assignment_id' is not null then
    -- Adding missing problems to an existing assignment.
    select * into a from public.assignments where id = (payload ->> 'assignment_id')::uuid and course_offering_id = off.id
       and merged_into is null and status <> 'hidden';
    if not found then raise exception 'Assignment not found.' using errcode = 'P0002'; end if;
  else
    if coalesce(trim(meta ->> 'title'), '') = '' then raise exception 'Assignment title is required.'; end if;
    a_type := coalesce(nullif(meta ->> 'assignment_type', ''), 'problem_set')::public.assignment_type;
    a_number := nullif(meta ->> 'assignment_number', '')::numeric;
    if not coalesce((payload ->> 'force_distinct')::boolean, false) then
      select x.id into dup from public.assignments x
       where x.course_offering_id = off.id and x.merged_into is null and x.status <> 'hidden'
         and (x.title_normalized = public.normalize_title(meta ->> 'title')
              or (a_number is not null and x.assignment_number = a_number and x.assignment_type = a_type))
       limit 1;
      if dup is not null then
        raise exception 'This assignment may already exist.' using errcode = 'P0001', hint = 'duplicate_assignment', detail = dup::text;
      end if;
    end if;
    insert into public.assignments (course_offering_id, title, slug, assignment_type, assignment_number, display_order, due_date,
                                    description, source_document_id, created_by)
    values (off.id, trim(meta ->> 'title'),
            private.free_slug('assignments', 'course_offering_id', off.id, public.assignment_base_slug(meta ->> 'title', a_type, a_number)),
            a_type, a_number,
            coalesce(round(a_number * 100)::int,
                     (select coalesce(max(display_order), 0) + 100 from public.assignments where course_offering_id = off.id)),
            nullif(meta ->> 'due_date', '')::date, nullif(trim(meta ->> 'description'), ''),
            nullif(payload ->> 'source_document_id', '')::uuid, uid)
    returning * into a;
  end if;

  select coalesce(max(display_order), 0) into next_order from public.problems where assignment_id = a.id and parent_problem_id is null;
  for node in select * from jsonb_array_elements(payload -> 'problems') loop
    select id into existing_id from public.problems
     where assignment_id = a.id and parent_problem_id is null and merged_into is null and lower(label) = lower(trim(node ->> 'label'));
    if existing_id is null then
      next_order := next_order + 1;
      perform private.insert_problem(a.id, null, node, next_order, publish_statements, uid);
      created := created + 1 + coalesce(jsonb_array_length(node -> 'children'), 0);
    else
      skipped := skipped || (node ->> 'label');
      -- add only the missing parts of an existing problem
      if jsonb_typeof(node -> 'children') = 'array' then
        for child in select * from jsonb_array_elements(node -> 'children') loop
          if not exists (select 1 from public.problems where parent_problem_id = existing_id and lower(label) = lower(trim(child ->> 'label'))) then
            perform private.insert_problem(a.id, existing_id, child,
              (select coalesce(max(display_order), 0) + 1 from public.problems where parent_problem_id = existing_id), publish_statements, uid);
            created := created + 1;
          end if;
        end loop;
      end if;
    end if;
  end loop;

  if payload ->> 'source_document_id' is not null then
    update public.source_documents set assignment_id = a.id, processing_status = 'published'
     where id = (payload ->> 'source_document_id')::uuid and uploader_id = uid;
    update public.assignments set source_document_id = coalesce(source_document_id, (payload ->> 'source_document_id')::uuid) where id = a.id;
  end if;

  return jsonb_build_object('assignment_id', a.id, 'assignment_slug', a.slug, 'created', created, 'skipped', to_jsonb(skipped));
end $$;

create or replace function public.add_problem(
  p_assignment uuid, p_label text, p_parent uuid default null, p_title text default null, p_statement text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := private.require_user(); new_id uuid; ord int;
begin
  perform private.check_rate('publish', 20, interval '1 hour');
  if not exists (select 1 from public.assignments where id = p_assignment and merged_into is null and status <> 'hidden') then
    raise exception 'Assignment not found.' using errcode = 'P0002';
  end if;
  if p_parent is not null and not exists (select 1 from public.problems where id = p_parent and assignment_id = p_assignment and parent_problem_id is null) then
    raise exception 'Parent problem not found.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.problems where assignment_id = p_assignment and parent_problem_id is not distinct from p_parent
                                              and merged_into is null and lower(label) = lower(trim(p_label))) then
    raise exception 'A problem with that label already exists.' using hint = 'duplicate_labels';
  end if;
  select coalesce(max(display_order), 0) + 1 into ord from public.problems
   where assignment_id = p_assignment and parent_problem_id is not distinct from p_parent;
  new_id := private.insert_problem(p_assignment, p_parent,
              jsonb_build_object('label', p_label, 'title', p_title, 'statement_markdown', p_statement, 'statement_source', 'manual'),
              ord, true, uid);
  return jsonb_build_object('id', new_id, 'slug', (select slug from public.problems where id = new_id));
end $$;

-- ───────────────────────── edits & proposals ─────────────────────────
create or replace function private.apply_problem_change(
  p_problem uuid, p_changes jsonb, p_editor uuid, p_note text, p_material boolean, p_kind text
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.problems; before jsonb; after jsonb; new_label text; new_slug text; parent_slug text;
begin
  select * into p from public.problems where id = p_problem for update;
  if not found then raise exception 'Problem not found.' using errcode = 'P0002'; end if;
  before := jsonb_build_object('label', p.label, 'title', p.title, 'statement_markdown', p.statement_markdown);
  new_label := coalesce(nullif(trim(p_changes ->> 'label'), ''), p.label);
  if p_changes ? 'statement_markdown' and char_length(p_changes ->> 'statement_markdown') > 20000 then
    raise exception 'Statements must be at most 20,000 characters.';
  end if;
  if new_label <> p.label then
    if exists (select 1 from public.problems where assignment_id = p.assignment_id and parent_problem_id is not distinct from p.parent_problem_id
                                                and id <> p.id and merged_into is null and lower(label) = lower(new_label)) then
      raise exception 'A problem with that label already exists.' using hint = 'duplicate_labels';
    end if;
    select slug into parent_slug from public.problems where id = p.parent_problem_id;
    new_slug := private.free_slug('problems', 'assignment_id', p.assignment_id, public.problem_base_slug(new_label, parent_slug), p.id);
    if new_slug <> p.slug then
      insert into public.slug_aliases (entity_type, scope_id, old_slug, entity_id) values ('problem', p.assignment_id, p.slug, p.id)
      on conflict (entity_type, scope_id, old_slug) do update set entity_id = excluded.entity_id;
    end if;
  end if;
  update public.problems set
    label = new_label,
    slug = coalesce(new_slug, slug),
    title = case when p_changes ? 'title' then nullif(trim(p_changes ->> 'title'), '') else title end,
    statement_markdown = case when p_changes ? 'statement_markdown' then nullif(trim(p_changes ->> 'statement_markdown'), '') else statement_markdown end,
    statement_source = case when p_changes ? 'statement_markdown' then
                         case when nullif(trim(p_changes ->> 'statement_markdown'), '') is null then 'none'
                              when p.statement_source = 'none' then 'manual' else p.statement_source end
                       else statement_source end::public.statement_source,
    extraction_status = case when p_changes ? 'statement_markdown' then
                          case when nullif(trim(p_changes ->> 'statement_markdown'), '') is null then 'none'::public.extraction_status
                               else 'reviewed'::public.extraction_status end
                        else extraction_status end,
    rating_epoch = rating_epoch + case when p_material then 1 else 0 end
  where id = p.id
  returning jsonb_build_object('label', label, 'title', title, 'statement_markdown', statement_markdown) into after;
  insert into public.problem_revisions (problem_id, editor_id, kind, before, after, note, material_change)
  values (p.id, p_editor, p_kind, before, after, p_note, coalesce(p_material, false));
  if p_material then perform private.refresh_problem_stats(p.id); end if;
end $$;

create or replace function private.validate_changes(p_changes jsonb) returns jsonb
language plpgsql immutable as $$
declare k text;
begin
  if jsonb_typeof(p_changes) <> 'object' then raise exception 'Invalid change.'; end if;
  for k in select jsonb_object_keys(p_changes) loop
    if k not in ('label', 'title', 'statement_markdown') then raise exception 'Unsupported field: %', k; end if;
  end loop;
  if p_changes ? 'label' and coalesce(trim(p_changes ->> 'label'), '') = '' then raise exception 'Label cannot be empty.'; end if;
  return p_changes;
end $$;

-- Adding a statement where none exists applies immediately (it's recorded and revertible). Changing existing
-- content becomes a proposal for moderators, unless the caller is a moderator.
create or replace function public.propose_edit(
  p_problem uuid, p_changes jsonb, p_note text default null, p_material boolean default false
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := private.require_user(); p public.problems; new_id uuid; only_fills_statement boolean;
begin
  perform private.check_rate('proposal', 60, interval '1 hour');
  perform private.validate_changes(p_changes);
  select * into p from public.problems where id = p_problem and merged_into is null and status <> 'hidden';
  if not found then raise exception 'Problem not found.' using errcode = 'P0002'; end if;
  only_fills_statement := (select array_agg(k) from jsonb_object_keys(p_changes) k) = array['statement_markdown']
                          and coalesce(p.statement_markdown, '') = '';
  if public.is_moderator() or only_fills_statement then
    perform private.apply_problem_change(p.id, p_changes, uid, p_note, p_material and public.is_moderator(), 'statement');
    return jsonb_build_object('applied', true);
  end if;
  if exists (select 1 from public.edit_proposals where problem_id = p.id and proposer_id = uid and status = 'pending' and changes = p_changes) then
    raise exception 'You already proposed this change.' using hint = 'duplicate_proposal';
  end if;
  insert into public.edit_proposals (problem_id, proposer_id, changes, note, material_change)
  values (p.id, uid, p_changes, left(p_note, 1000), coalesce(p_material, false)) returning id into new_id;
  return jsonb_build_object('applied', false, 'proposal_id', new_id);
end $$;

create or replace function public.review_proposal(p_proposal uuid, p_approve boolean, p_note text default null, p_material boolean default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := private.require_moderator(); e public.edit_proposals;
begin
  select * into e from public.edit_proposals where id = p_proposal and status = 'pending' for update;
  if not found then raise exception 'Proposal not found or already reviewed.' using errcode = 'P0002'; end if;
  if p_approve then
    perform private.apply_problem_change(e.problem_id, e.changes, e.proposer_id,
      coalesce(e.note, '') || case when p_note is not null then ' — approved: ' || p_note else '' end,
      coalesce(p_material, e.material_change), 'statement');
  end if;
  update public.edit_proposals set status = case when p_approve then 'approved' else 'rejected' end::public.proposal_status,
         reviewer_id = uid, review_note = left(p_note, 1000), reviewed_at = now() where id = e.id;
  insert into public.moderation_actions (moderator_id, action, target_type, target_id, details)
  values (uid, case when p_approve then 'approve_proposal' else 'reject_proposal' end, 'proposal', e.id, jsonb_build_object('problem_id', e.problem_id));
end $$;

create or replace function public.revert_revision(p_revision uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := private.require_moderator(); r public.problem_revisions;
begin
  select * into r from public.problem_revisions where id = p_revision;
  if not found or r.before is null then raise exception 'Nothing to revert to.' using errcode = 'P0002'; end if;
  perform private.apply_problem_change(r.problem_id, r.before, uid, 'Reverted to version from ' || to_char(r.created_at, 'YYYY-MM-DD HH24:MI'), false, 'revert');
  insert into public.moderation_actions (moderator_id, action, target_type, target_id, details)
  values (uid, 'revert', 'problem', r.problem_id, jsonb_build_object('revision_id', r.id));
end $$;

create or replace function public.resolve_report(p_report uuid, p_status public.report_status, p_note text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := private.require_moderator();
begin
  update public.moderation_reports set status = p_status, resolved_by = uid, resolution_note = left(p_note, 1000), resolved_at = now()
   where id = p_report;
  if not found then raise exception 'Report not found.' using errcode = 'P0002'; end if;
  insert into public.moderation_actions (moderator_id, action, target_type, target_id, details)
  values (uid, 'resolve_report', 'report', p_report, jsonb_build_object('status', p_status));
end $$;

create or replace function public.set_content_status(p_type text, p_id uuid, p_status public.content_status)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := private.require_moderator();
begin
  if p_type not in ('universities', 'courses', 'course_offerings', 'assignments', 'problems') then
    raise exception 'Unsupported type.';
  end if;
  execute format('update public.%I set status = $1 where id = $2', p_type) using p_status, p_id;
  insert into public.moderation_actions (moderator_id, action, target_type, target_id, details)
  values (uid, 'set_status', p_type, p_id, jsonb_build_object('status', p_status));
end $$;

create or replace function public.set_user_role(p_user uuid, p_role public.app_role) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := private.require_user();
begin
  if not public.is_admin() then raise exception 'Admin permission required.' using errcode = '42501'; end if;
  update public.profiles set role = p_role where id = p_user;
  insert into public.moderation_actions (moderator_id, action, target_type, target_id, details)
  values (uid, 'set_role', 'profile', p_user, jsonb_build_object('role', p_role));
end $$;

-- ───────────────────────── merges (moderators only, transactional) ─────────────────────────
-- Moves every rating from source to target. If a user rated both, their most recent rating is kept and the
-- other is recorded in the moderation log, so no vote is silently lost.
create or replace function public.merge_problems(p_source uuid, p_target uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := private.require_moderator(); s public.problems; t public.problems; moved int; conflicts jsonb; child record; tchild uuid;
begin
  if p_source = p_target then raise exception 'Cannot merge a problem into itself.'; end if;
  select * into s from public.problems where id = p_source and merged_into is null for update;
  select * into t from public.problems where id = p_target and merged_into is null for update;
  if s.id is null or t.id is null then raise exception 'Both problems must exist and not already be merged.' using errcode = 'P0002'; end if;
  perform set_config('hardest.merging', 'on', true);

  -- conflicting voters: keep the newer rating on the target
  select coalesce(jsonb_agg(jsonb_build_object('user_id', rs.user_id, 'source', to_jsonb(rs) - 'user_id', 'target', to_jsonb(rt) - 'user_id')), '[]'::jsonb)
    into conflicts
    from public.ratings rs join public.ratings rt on rt.user_id = rs.user_id and rt.problem_id = t.id
   where rs.problem_id = s.id;
  update public.ratings rt set difficulty = rs.difficulty, time_minutes = rs.time_minutes, completion_status = rs.completion_status
    from public.ratings rs
   where rs.problem_id = s.id and rt.problem_id = t.id and rt.user_id = rs.user_id and rs.updated_at > rt.updated_at;
  delete from public.ratings rs using public.ratings rt
   where rs.problem_id = s.id and rt.problem_id = t.id and rt.user_id = rs.user_id;
  update public.ratings set problem_id = t.id where problem_id = s.id;
  get diagnostics moved = row_count;

  -- children: merge same-labelled parts, move the rest
  for child in select * from public.problems where parent_problem_id = s.id and merged_into is null order by display_order loop
    select id into tchild from public.problems where parent_problem_id = t.id and merged_into is null and lower(label) = lower(child.label);
    if tchild is not null then
      perform public.merge_problems(child.id, tchild);
    else
      update public.problems set parent_problem_id = t.id, assignment_id = t.assignment_id,
             slug = private.free_slug('problems', 'assignment_id', t.assignment_id, public.problem_base_slug(child.label, t.slug), child.id),
             display_order = (select coalesce(max(display_order), 0) + 1 from public.problems where parent_problem_id = t.id)
       where id = child.id;
    end if;
  end loop;

  if coalesce(t.statement_markdown, '') = '' and coalesce(s.statement_markdown, '') <> '' then
    update public.problems set statement_markdown = s.statement_markdown, statement_source = s.statement_source,
           extraction_status = s.extraction_status where id = t.id;
  end if;
  update public.problems set merged_into = t.id, status = 'hidden' where id = s.id;
  insert into public.problem_revisions (problem_id, editor_id, kind, before, after, note)
  values (t.id, uid, 'merge', jsonb_build_object('merged_problem_id', s.id, 'label', s.label), null, 'Merged duplicate problem');
  perform private.refresh_problem_stats(t.id);
  perform private.refresh_problem_stats(s.id);
  perform set_config('hardest.merging', 'off', true);
  insert into public.moderation_actions (moderator_id, action, target_type, target_id, details)
  values (uid, 'merge_problems', 'problem', t.id, jsonb_build_object('source', s.id, 'moved_ratings', moved, 'conflicts', conflicts));
  return jsonb_build_object('moved_ratings', moved, 'conflicts', jsonb_array_length(conflicts));
end $$;

create or replace function public.merge_assignments(p_source uuid, p_target uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := private.require_moderator(); s public.assignments; t public.assignments; prob record; tprob uuid;
        merged int := 0; moved int := 0; ord int;
begin
  if p_source = p_target then raise exception 'Cannot merge an assignment into itself.'; end if;
  select * into s from public.assignments where id = p_source and merged_into is null for update;
  select * into t from public.assignments where id = p_target and merged_into is null for update;
  if s.id is null or t.id is null then raise exception 'Both assignments must exist and not already be merged.' using errcode = 'P0002'; end if;
  for prob in select * from public.problems where assignment_id = s.id and parent_problem_id is null and merged_into is null order by display_order loop
    select id into tprob from public.problems where assignment_id = t.id and parent_problem_id is null and merged_into is null and lower(label) = lower(prob.label);
    if tprob is not null then
      perform public.merge_problems(prob.id, tprob); merged := merged + 1;
    else
      select coalesce(max(display_order), 0) + 1 into ord from public.problems where assignment_id = t.id and parent_problem_id is null;
      update public.problems set assignment_id = t.id, display_order = ord,
             slug = private.free_slug('problems', 'assignment_id', t.id, public.problem_base_slug(prob.label, null), prob.id)
       where id = prob.id;
      update public.problems c set assignment_id = t.id,
             slug = private.free_slug('problems', 'assignment_id', t.id,
                      public.problem_base_slug(c.label, (select slug from public.problems where id = prob.id)), c.id)
       where c.parent_problem_id = prob.id;
      moved := moved + 1;
    end if;
  end loop;
  update public.source_documents set assignment_id = t.id where assignment_id = s.id;
  update public.assignments set merged_into = t.id, status = 'hidden' where id = s.id;
  insert into public.moderation_actions (moderator_id, action, target_type, target_id, details)
  values (uid, 'merge_assignments', 'assignment', t.id, jsonb_build_object('source', s.id, 'merged_problems', merged, 'moved_problems', moved));
  return jsonb_build_object('merged_problems', merged, 'moved_problems', moved);
end $$;

-- ───────────────────────── moderation queue ─────────────────────────
create or replace function public.moderation_queue() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform private.require_moderator();
  return jsonb_build_object(
    'proposals', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id, 'problem_id', e.problem_id, 'changes', e.changes, 'note', e.note, 'material_change', e.material_change,
        'created_at', e.created_at, 'current', jsonb_build_object('label', p.label, 'title', p.title, 'statement_markdown', p.statement_markdown),
        'context', private.problem_context(p.id)) order by e.created_at)
      from public.edit_proposals e join public.problems p on p.id = e.problem_id where e.status = 'pending'), '[]'::jsonb),
    'reports', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'kind', r.kind, 'details', r.details, 'created_at', r.created_at,
        'problem_id', r.problem_id, 'assignment_id', r.assignment_id,
        'duplicate_of_problem_id', r.duplicate_of_problem_id, 'duplicate_of_assignment_id', r.duplicate_of_assignment_id,
        'context', case when r.problem_id is not null then private.problem_context(r.problem_id)
                        else private.assignment_context(r.assignment_id) end,
        'duplicate_context', case when r.duplicate_of_problem_id is not null then private.problem_context(r.duplicate_of_problem_id)
                                  when r.duplicate_of_assignment_id is not null then private.assignment_context(r.duplicate_of_assignment_id) end
      ) order by r.created_at) from public.moderation_reports r where r.status = 'open'), '[]'::jsonb),
    'universities', coalesce((select jsonb_agg(to_jsonb(u) order by u.created_at) from public.universities u where u.status = 'pending'), '[]'::jsonb),
    'recent_assignments', coalesce((select jsonb_agg(private.assignment_context(a.id) || jsonb_build_object('created_at', a.created_at) order by a.created_at desc)
      from (select * from public.assignments where created_at > now() - interval '14 days' and merged_into is null and not is_demo
            order by created_at desc limit 50) a), '[]'::jsonb),
    'recent_courses', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name, 'slug', c.slug, 'status', c.status,
        'university_slug', u.slug, 'created_at', c.created_at) order by c.created_at desc)
      from (select * from public.courses where created_at > now() - interval '14 days' and created_by is not null order by created_at desc limit 50) c
      join public.universities u on u.id = c.university_id), '[]'::jsonb)
  );
end $$;

create or replace function private.assignment_context(p_assignment uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('assignment_id', a.id, 'assignment_title', a.title, 'assignment_slug', a.slug, 'status', a.status,
                            'offering_slug', o.slug, 'course_code', c.code, 'course_slug', c.slug, 'university_slug', u.slug,
                            'problem_count', (select count(*) from public.problems p where p.assignment_id = a.id and p.merged_into is null))
    from public.assignments a join public.course_offerings o on o.id = a.course_offering_id
    join public.courses c on c.id = o.course_id join public.universities u on u.id = c.university_id
   where a.id = p_assignment
$$;

create or replace function private.problem_context(p_problem uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select private.assignment_context(p.assignment_id)
         || jsonb_build_object('problem_id', p.id, 'problem_label', p.label, 'problem_slug', p.slug,
                               'parent_label', (select label from public.problems x where x.id = p.parent_problem_id),
                               'rating_count', coalesce((select rating_count from public.problem_stats s where s.problem_id = p.id), 0))
    from public.problems p where p.id = p_problem
$$;

-- Rate-limit direct inserts that bypass RPCs.
create or replace function private.throttle_insert() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform private.check_rate(tg_argv[0], tg_argv[1]::int, tg_argv[2]::interval);
  return new;
end $$;
create trigger moderation_reports_throttle before insert on public.moderation_reports
  for each row execute function private.throttle_insert('report', '30', '1 hour');
create trigger feedback_throttle before insert on public.feedback
  for each row execute function private.throttle_insert('feedback', '10', '1 hour');
create trigger saved_courses_throttle before insert on public.saved_courses
  for each row execute function private.throttle_insert('save', '100', '1 hour');
