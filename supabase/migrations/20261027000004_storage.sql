-- hardest: private bucket for uploaded assignment files.
-- Objects live at <uploader uuid>/<source_document uuid>/<sanitized filename>; the path must match a
-- source_documents row registered (via register_source_document) by the same user.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('source-documents', 'source-documents', false, 20971520, array[
  'application/pdf', 'text/plain', 'text/markdown', 'text/x-tex', 'application/x-tex', 'application/x-latex',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/octet-stream'
])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "upload own registered documents" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'source-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.source_documents d
                 where d.storage_path = name and d.uploader_id = auth.uid() and d.processing_status <> 'published')
  );

create policy "read permitted documents" on storage.objects for select
  using (
    bucket_id = 'source-documents'
    and exists (select 1 from public.source_documents d
                 where d.storage_path = name
                   and (d.uploader_id = auth.uid() or d.visibility = 'public' or public.is_moderator()))
  );

create policy "delete own documents" on storage.objects for delete to authenticated
  using (bucket_id = 'source-documents' and (storage.foldername(name))[1] = auth.uid()::text);
