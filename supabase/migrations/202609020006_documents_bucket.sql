-- Private bucket for order documents (agreements, purchase order files, evidence).
-- Only the backend service role reads and writes it; the trade service checks
-- that the caller is a party to the order before serving a file.

insert into storage.buckets (id, name, public, file_size_limit)
values ('payproof-documents', 'payproof-documents', false, 8388608)
on conflict (id) do nothing;

drop policy if exists "service role manages order documents" on storage.objects;
create policy "service role manages order documents" on storage.objects
for all to service_role
using (bucket_id = 'payproof-documents')
with check (bucket_id = 'payproof-documents');
