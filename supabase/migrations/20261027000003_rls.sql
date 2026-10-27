-- hardest: row-level security, grants, and storage.

alter table public.profiles enable row level security;
alter table public.universities enable row level security;
alter table public.courses enable row level security;
alter table public.course_offerings enable row level security;
alter table public.source_documents enable row level security;
alter table public.assignments enable row level security;
alter table public.problems enable row level security;
alter table public.ratings enable row level security;
alter table public.problem_stats enable row level security;
alter table public.problem_revisions enable row level security;
alter table public.edit_proposals enable row level security;
alter table public.moderation_reports enable row level security;
alter table public.moderation_actions enable row level security;
alter table public.slug_aliases enable row level security;
alter table public.saved_courses enable row level security;
alter table public.feedback enable row level security;

-- Public catalog: readable by everyone; pending items only by their creator; hidden items only by moderators.
-- Merged assignments/problems (status 'hidden', merged_into set) stay readable as redirect stubs, so
-- resolve_path (security invoker) can follow merged_into for every visitor; listings filter merged_into is null.
create policy "read universities" on public.universities for select
  using (status = 'active' or created_by = auth.uid() or public.is_moderator());
create policy "read courses" on public.courses for select
  using (status = 'active' or created_by = auth.uid() or public.is_moderator());
create policy "read offerings" on public.course_offerings for select
  using (status = 'active' or created_by = auth.uid() or public.is_moderator());
create policy "read assignments" on public.assignments for select
  using (status = 'active' or merged_into is not null or created_by = auth.uid() or public.is_moderator());
create policy "read problems" on public.problems for select
  using (status = 'active' or merged_into is not null or created_by = auth.uid() or public.is_moderator());
create policy "read stats" on public.problem_stats for select using (true);
create policy "read aliases" on public.slug_aliases for select using (true);

-- Ratings: private. A user can see and change only their own.
create policy "read own ratings" on public.ratings for select using (user_id = auth.uid());
create policy "insert own ratings" on public.ratings for insert with check (user_id = auth.uid());
create policy "update own ratings" on public.ratings for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "delete own ratings" on public.ratings for delete using (user_id = auth.uid());

-- Profiles: own row (and moderators). Role changes are blocked by the profiles_guard trigger.
create policy "read own profile" on public.profiles for select using (id = auth.uid() or public.is_moderator());
create policy "update own profile" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- Source documents: uploader, moderators, or explicitly public documents.
create policy "read documents" on public.source_documents for select
  using (uploader_id = auth.uid() or visibility = 'public' or public.is_moderator());
create policy "delete own unpublished documents" on public.source_documents for delete
  using (uploader_id = auth.uid() and processing_status <> 'published');

-- Contributions
create policy "read own proposals" on public.edit_proposals for select using (proposer_id = auth.uid() or public.is_moderator());
create policy "read revisions (moderators)" on public.problem_revisions for select using (public.is_moderator());
create policy "read own reports" on public.moderation_reports for select using (reporter_id = auth.uid() or public.is_moderator());
create policy "file reports" on public.moderation_reports for insert
  with check (reporter_id = auth.uid() and status = 'open' and resolved_by is null);
create policy "read moderation log" on public.moderation_actions for select using (public.is_moderator());

create policy "own saved courses" on public.saved_courses for select using (user_id = auth.uid());
create policy "save courses" on public.saved_courses for insert with check (user_id = auth.uid());
create policy "unsave courses" on public.saved_courses for delete using (user_id = auth.uid());

create policy "send feedback" on public.feedback for insert with check (user_id = auth.uid());
create policy "read feedback (moderators)" on public.feedback for select using (public.is_moderator());

-- ───────────────────────── grants ─────────────────────────
-- Defense in depth on top of RLS: clients get no direct write privileges on content tables.
revoke insert, update, delete, truncate on public.universities, public.courses, public.course_offerings, public.assignments,
  public.problems, public.problem_stats, public.problem_revisions, public.edit_proposals, public.moderation_actions,
  public.slug_aliases, public.source_documents from anon, authenticated;
grant delete on public.source_documents to authenticated;
revoke all on public.ratings, public.saved_courses, public.feedback, public.moderation_reports, public.profiles from anon;
grant select, insert, update, delete on public.ratings to authenticated;
grant select, insert, delete on public.saved_courses to authenticated;
grant insert on public.feedback to authenticated;
grant select, insert on public.moderation_reports to authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, avatar_url, show_name) on public.profiles to authenticated;

revoke all on all functions in schema private from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;

-- Write RPCs are for signed-in users only (they also check auth.uid() internally).
revoke execute on function
  public.rate_problem(uuid, int, int, public.completion_status), public.clear_rating(uuid),
  public.create_university(text, text, text), public.create_course(uuid, text, text, text, text),
  public.create_offering(uuid, int, public.term, text, text),
  public.register_source_document(uuid, text, text, int, text, int, public.document_visibility, boolean),
  public.publish_assignment(jsonb), public.add_problem(uuid, text, uuid, text, text),
  public.propose_edit(uuid, jsonb, text, boolean), public.review_proposal(uuid, boolean, text, boolean),
  public.revert_revision(uuid), public.resolve_report(uuid, public.report_status, text),
  public.set_content_status(text, uuid, public.content_status), public.set_user_role(uuid, public.app_role),
  public.merge_problems(uuid, uuid), public.merge_assignments(uuid, uuid), public.moderation_queue(),
  public.my_ratings(uuid), public.my_rated_offerings()
from public, anon;
grant execute on function
  public.rate_problem(uuid, int, int, public.completion_status), public.clear_rating(uuid),
  public.create_university(text, text, text), public.create_course(uuid, text, text, text, text),
  public.create_offering(uuid, int, public.term, text, text),
  public.register_source_document(uuid, text, text, int, text, int, public.document_visibility, boolean),
  public.publish_assignment(jsonb), public.add_problem(uuid, text, uuid, text, text),
  public.propose_edit(uuid, jsonb, text, boolean), public.review_proposal(uuid, boolean, text, boolean),
  public.revert_revision(uuid), public.resolve_report(uuid, public.report_status, text),
  public.set_content_status(text, uuid, public.content_status), public.set_user_role(uuid, public.app_role),
  public.merge_problems(uuid, uuid), public.merge_assignments(uuid, uuid), public.moderation_queue(),
  public.my_ratings(uuid), public.my_rated_offerings()
to authenticated;
