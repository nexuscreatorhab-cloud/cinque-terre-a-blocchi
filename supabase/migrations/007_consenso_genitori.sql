-- 🧱 Cinque Terre a Blocchi: consenso dei genitori per chi ha meno di 14 anni
-- Solo il server (funzione consenso-genitore, service_role) legge e scrive questa tabella.

create table public.consensi_genitori (
  utente uuid primary key references public.profili(id) on delete cascade,
  email_genitore text not null check (email_genitore ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email_genitore) <= 254),
  token_hash text unique,                 -- sha256 del link di conferma (il link vero non viene salvato)
  scadenza timestamptz,                   -- il link vale 7 giorni
  invii int not null default 0,           -- antiabuso: email mandate nelle ultime 24 ore
  primo_invio timestamptz,
  confermato timestamptz,                 -- prova del consenso (art. 7.1 GDPR)
  versione_informativa text,              -- quale informativa ha letto il genitore
  revoca_hash text unique                 -- sha256 del link per ritirare il consenso
);
alter table public.consensi_genitori enable row level security;
-- nessuna regola: gli utenti non la leggono né la scrivono direttamente
revoke all on public.consensi_genitori from anon, authenticated;

-- il ragazzo (e "Scarica i miei dati") vede solo a chi è stato chiesto l'ok e quando è arrivato
create or replace function public.il_mio_consenso()
returns table (email_genitore text, confermato timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.email_genitore, c.confermato from public.consensi_genitori c where c.utente = (select auth.uid());
$$;
revoke execute on function public.il_mio_consenso() from public, anon;
grant execute on function public.il_mio_consenso() to authenticated;

-- pulizia: gli account sotto i 14 anni senza ok dopo 30 giorni vengono cancellati (dati minimi)
create extension if not exists pg_cron;
select cron.schedule('pulizia-consensi-scaduti', '17 3 * * *', $$
  delete from auth.users u using public.profili p
  where p.id = u.id and p.stato_consenso = 'in_attesa' and p.creato < now() - interval '30 days';
$$);
