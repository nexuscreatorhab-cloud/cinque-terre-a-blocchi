-- Cancellazione completa dell'account con un tasto: profilo, proposte, note e targhette spariscono a cascata.
create or replace function public.cancella_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Non sei collegato'; end if;
  delete from auth.users where id = auth.uid();
end $$;
revoke execute on function public.cancella_account() from public, anon;
grant execute on function public.cancella_account() to authenticated;
