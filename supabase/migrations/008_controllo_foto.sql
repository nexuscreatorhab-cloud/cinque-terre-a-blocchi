-- 🧱 Cinque Terre a Blocchi: registro dei controlli foto fatti dall'AI.
-- La foto non viene conservata: resta solo l'esito, per il limite giornaliero e per Lapo.
create table public.foto_controlli (
  id bigint generated always as identity primary key,
  utente uuid not null references public.profili(id) on delete cascade,
  borgo text not null,
  edificio int not null,
  quando timestamptz not null default now(),
  esito text not null check (esito in ('ok','ko','parziale','errore')),
  motivo text check (length(motivo) <= 300)
);
create index foto_controlli_utente_quando on public.foto_controlli (utente, quando);
alter table public.foto_controlli enable row level security;
revoke all on public.foto_controlli from anon, authenticated;
grant select on public.foto_controlli to authenticated;
create policy "vedo i miei controlli, l'admin tutti" on public.foto_controlli for select to authenticated
  using (utente = (select auth.uid()) or (select public.is_admin()));
