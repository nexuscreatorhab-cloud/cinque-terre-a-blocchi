-- 🧱 Cinque Terre a Blocchi: schema del database per le proposte delle facciate
-- Regola d'oro: gli utenti scrivono solo le loro proposte; le schede ufficiali le calcola il database.

-- ---------- impostazioni ----------
create table public.impostazioni (
  chiave text primary key,
  valore numeric not null
);
insert into public.impostazioni values
  ('soglia_persone', 5),        -- persone diverse che devono dire la stessa cosa
  ('soglia_accordo', 0.7),      -- quota minima d'accordo tra chi ha proposto quel dettaglio
  ('max_proposte_giorno', 40);  -- limite antiabuso per persona

-- ---------- amministratori ----------
create table public.admin (
  user_id uuid primary key references auth.users on delete cascade
);
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admin where user_id = (select auth.uid()));
$$;

-- ---------- borghi ed edifici ----------
create table public.borghi (
  id text primary key,
  nome text not null
);
insert into public.borghi values ('manarola', 'Manarola');

create table public.edifici (
  borgo text not null references public.borghi,
  numero int not null,
  piani numeric,                -- piani attuali nel generatore (per il controllo ±1)
  primary key (borgo, numero)
);
insert into public.edifici (borgo, numero) select 'manarola', g from generate_series(1, 216) g;

-- ---------- catalogo delle scelte ammesse ----------
create table public.catalogo (
  campo text not null,
  valore text not null,
  etichetta text not null,
  ordine int not null default 0,
  primary key (campo, valore)
);
insert into public.catalogo (campo, valore, etichetta, ordine) values
  ('facciata','#E9B24A','Giallo ocra',1),('facciata','#E2794F','Arancio',2),('facciata','#C9543B','Rosso pompeiano',3),
  ('facciata','#F3C69C','Pesca',4),('facciata','#E99A8A','Rosa salmone',5),('facciata','#D8A23E','Senape',6),
  ('facciata','#B54F38','Rosso mattone',7),('facciata','#F4DE9E','Giallo paglia',8),('facciata','#A8C49A','Verde salvia',9),
  ('facciata','#E8C3BE','Rosa cipria',10),('facciata','#CF6A46','Terracotta',11),('facciata','#EFDFC6','Panna',12),
  ('facciata','#93B7C6','Azzurro',13),('facciata','#DD8E5B','Albicocca',14),('facciata','#F0B37A','Arancio chiaro',15),
  ('facciata','#FFFFFF','Bianco',16),('facciata','#BDB6A8','Grigio pietra',17),
  ('persiane_colore','verde','Verdi',1),('persiane_colore','marrone','Marroni',2),('persiane_colore','grigio','Grigie',3),
  ('persiane_colore','azzurro','Azzurre',4),('persiane_colore','nessuna','Senza persiane',5),
  ('persiane_stato','aperte','Quasi tutte aperte',1),('persiane_stato','chiuse','Quasi tutte chiuse',2),('persiane_stato','miste','Metà e metà',3),
  ('persiane_condizione','buone','In buono stato',1),('persiane_condizione','rovinate','Scolorite o rovinate',2),
  ('tetto','ardesia','Ardesia (grigio)',1),('tetto','cotto','Cotto (rosso)',2),('tetto','terrazza','Terrazza piana',3),
  ('piano_terra','niente','Niente di particolare',1),('piano_terra','portone','Portone',2),('piano_terra','negozio','Negozio o locale',3),
  ('piano_terra','garage','Magazzino o garage',4),('piano_terra','muro','Muro cieco',5),
  ('balconi','nessuno','Nessun balcone',1),('balconi','ferro','Ringhiera in ferro',2),('balconi','muratura','In muratura',3),
  ('fiori','no','Niente fiori',1),('fiori','pochi','Qualche vaso',2),('fiori','tanti','Tanti fiori',3),
  ('cornici','no','Senza cornici',1),('cornici','bianche','Cornici bianche',2),('cornici','colorate','Cornici colorate',3),
  ('panni','no','Niente panni stesi',1),('panni','si','Panni stesi',2),
  ('lampione','no','Nessun lampione',1),('lampione','si','Lampione sul muro',2);
insert into public.catalogo (campo, valore, etichetta, ordine)
  select 'piani', g::text, g || case when g = 1 then ' piano' else ' piani' end, g from generate_series(1, 9) g;

-- ---------- profili ----------
create table public.profili (
  id uuid primary key default auth.uid() references auth.users on delete cascade,
  soprannome text not null unique check (soprannome ~ '^[A-Za-z0-9_À-ÿ]{3,20}$'),
  anno_nascita int not null check (anno_nascita between 1900 and 2100),
  stato_consenso text not null default 'non_serve' check (stato_consenso in ('non_serve','in_attesa','ok')),
  livello int not null default 0,
  creato timestamptz not null default now()
);
create or replace function public.profili_prima() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.anno_nascita > extract(year from now()) - 6 then raise exception 'Anno di nascita non valido'; end if;
    new.id := auth.uid();
    new.livello := 0;
    new.creato := now();
    new.stato_consenso := case when extract(year from now()) - new.anno_nascita < 14 then 'in_attesa' else 'non_serve' end;
  end if;
  return new;
end $$;
create trigger profili_prima before insert on public.profili for each row execute function public.profili_prima();

-- soprannomi e livelli visibili a tutti (solo questo, niente altro del profilo)
create or replace function public.soprannomi(ids uuid[])
returns table (id uuid, soprannome text, livello int)
language sql stable security definer set search_path = '' as $$
  select p.id, p.soprannome, p.livello from public.profili p where p.id = any(ids) limit 200;
$$;

-- ---------- proposte (una riga per dettaglio) ----------
create table public.proposte (
  id bigint generated always as identity primary key,
  utente uuid not null default auth.uid() references public.profili on delete cascade,
  borgo text not null,
  edificio int not null,
  campo text not null,
  valore text not null,
  foto text,                                   -- percorso nello spazio privato "foto"
  stato_foto text not null default 'nessuna' check (stato_foto in ('nessuna','in_attesa','ok','ko')),
  creato timestamptz not null default now(),
  aggiornato timestamptz not null default now(),
  foreign key (borgo, edificio) references public.edifici,
  foreign key (campo, valore) references public.catalogo,
  unique (utente, borgo, edificio, campo)
);
create index proposte_casa on public.proposte (borgo, edificio, campo);

create or replace function public.proposte_prima() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n int; lim numeric; consenso text; piani_ora numeric;
begin
  -- server (service_role) o pannello di controllo: nessun utente collegato
  if auth.uid() is null or (select auth.role()) = 'service_role' then return new; end if;
  select stato_consenso into consenso from public.profili where id = auth.uid();
  if consenso is null then raise exception 'Crea prima il tuo profilo'; end if;
  if consenso = 'in_attesa' then raise exception 'Serve prima l''ok di un genitore'; end if;
  if tg_op = 'INSERT' then
    new.utente := auth.uid();
    new.creato := now();
    select valore into lim from public.impostazioni where chiave = 'max_proposte_giorno';
    select count(*) into n from public.proposte where utente = auth.uid() and aggiornato > now() - interval '1 day';
    if n >= lim then raise exception 'Hai raggiunto il limite di proposte per oggi'; end if;
  else
    -- l'utente non puo' spostare la proposta su un'altra casa o un altro campo
    new.utente := old.utente; new.borgo := old.borgo; new.edificio := old.edificio; new.campo := old.campo; new.creato := old.creato;
  end if;
  if new.campo = 'piani' then
    select piani into piani_ora from public.edifici where borgo = new.borgo and numero = new.edificio;
    if piani_ora is not null and abs(new.valore::numeric - piani_ora) > 1 then
      raise exception 'Il numero di piani puo'' cambiare al massimo di uno';
    end if;
  end if;
  -- lo stato della foto lo decide solo il controllo sul server
  if tg_op = 'INSERT' or new.valore is distinct from old.valore or new.foto is distinct from old.foto then
    new.stato_foto := case when new.foto is null then 'nessuna' else 'in_attesa' end;
  else
    new.stato_foto := old.stato_foto;
  end if;
  if new.foto is not null and new.foto not like (auth.uid()::text || '/%') then
    raise exception 'Foto non valida';
  end if;
  new.aggiornato := now();
  return new;
end $$;
create trigger proposte_prima before insert or update on public.proposte for each row execute function public.proposte_prima();

-- ---------- note libere (le legge solo l'admin) ----------
create table public.note (
  id bigint generated always as identity primary key,
  utente uuid not null default auth.uid() references public.profili on delete cascade,
  borgo text not null,
  edificio int not null,
  testo text not null check (char_length(testo) between 1 and 500),
  creato timestamptz not null default now(),
  foreign key (borgo, edificio) references public.edifici
);

-- ---------- schede ufficiali (calcolate) ----------
create table public.schede_ufficiali (
  borgo text not null,
  edificio int not null,
  campo text not null,
  valore text not null,
  concordi int not null,
  totale int not null,
  bloccata boolean not null default false,     -- fissata a mano dall'admin
  aggiornato timestamptz not null default now(),
  primary key (borgo, edificio, campo),
  foreign key (borgo, edificio) references public.edifici,
  foreign key (campo, valore) references public.catalogo
);

create or replace function public.ricalcola(p_borgo text, p_edificio int, p_campo text) returns void
language plpgsql security definer set search_path = '' as $$
declare s_pers numeric; s_acc numeric; tot int; best record;
begin
  if exists (select 1 from public.schede_ufficiali where borgo = p_borgo and edificio = p_edificio and campo = p_campo and bloccata) then
    return;
  end if;
  select valore into s_pers from public.impostazioni where chiave = 'soglia_persone';
  select valore into s_acc from public.impostazioni where chiave = 'soglia_accordo';
  select count(*) into tot from public.proposte where borgo = p_borgo and edificio = p_edificio and campo = p_campo;
  select valore, count(*) as n, bool_or(stato_foto = 'ok') as foto_ok into best
    from public.proposte where borgo = p_borgo and edificio = p_edificio and campo = p_campo
    group by valore order by count(*) desc limit 1;
  if best.valore is not null and best.n >= s_pers and best.n >= s_acc * tot and best.foto_ok then
    insert into public.schede_ufficiali (borgo, edificio, campo, valore, concordi, totale, aggiornato)
      values (p_borgo, p_edificio, p_campo, best.valore, best.n, tot, now())
      on conflict (borgo, edificio, campo) do update
      set valore = excluded.valore, concordi = excluded.concordi, totale = excluded.totale, aggiornato = now();
  else
    delete from public.schede_ufficiali where borgo = p_borgo and edificio = p_edificio and campo = p_campo;
  end if;
end $$;
revoke execute on function public.ricalcola(text, int, text) from public, anon, authenticated;

create or replace function public.proposte_dopo() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE','DELETE') then perform public.ricalcola(old.borgo, old.edificio, old.campo); end if;
  if tg_op in ('INSERT','UPDATE') then perform public.ricalcola(new.borgo, new.edificio, new.campo); end if;
  return null;
end $$;
create trigger proposte_dopo after insert or update or delete on public.proposte for each row execute function public.proposte_dopo();

-- ---------- targhette ----------
create table public.targhette (
  id bigint generated always as identity primary key,
  utente uuid not null references public.profili on delete cascade,
  tipo text not null,
  borgo text references public.borghi,
  edificio int,
  assegnata timestamptz not null default now()
);

-- ---------- permessi: si parte da zero e si apre solo il necessario ----------
revoke all on all tables in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.soprannomi(uuid[]) to anon, authenticated;
grant execute on function public.is_admin() to authenticated;

grant select on public.impostazioni, public.borghi, public.edifici, public.catalogo, public.schede_ufficiali, public.targhette to anon, authenticated;
grant select, insert, delete on public.profili to authenticated;
grant update (soprannome) on public.profili to authenticated;
grant select, insert, delete on public.proposte to authenticated;
grant update (valore, foto) on public.proposte to authenticated;
grant select, insert, delete on public.note to authenticated;
grant update (bloccata, valore) on public.schede_ufficiali to authenticated;   -- solo admin, vedi regole

alter table public.impostazioni enable row level security;
alter table public.admin enable row level security;
alter table public.borghi enable row level security;
alter table public.edifici enable row level security;
alter table public.catalogo enable row level security;
alter table public.profili enable row level security;
alter table public.proposte enable row level security;
alter table public.note enable row level security;
alter table public.schede_ufficiali enable row level security;
alter table public.targhette enable row level security;

create policy "lettura pubblica" on public.impostazioni for select using (true);
create policy "lettura pubblica" on public.borghi for select using (true);
create policy "lettura pubblica" on public.edifici for select using (true);
create policy "lettura pubblica" on public.catalogo for select using (true);
create policy "lettura pubblica" on public.schede_ufficiali for select using (true);
create policy "lettura pubblica" on public.targhette for select using (true);

create policy "il mio profilo" on public.profili for select to authenticated using (id = (select auth.uid()) or (select public.is_admin()));
create policy "creo il mio profilo" on public.profili for insert to authenticated with check (id = (select auth.uid()));
create policy "modifico il mio profilo" on public.profili for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "cancello il mio profilo" on public.profili for delete to authenticated using (id = (select auth.uid()));

create policy "le mie proposte" on public.proposte for select to authenticated using (utente = (select auth.uid()) or (select public.is_admin()));
create policy "creo le mie proposte" on public.proposte for insert to authenticated with check (utente = (select auth.uid()));
create policy "modifico le mie proposte" on public.proposte for update to authenticated using (utente = (select auth.uid())) with check (utente = (select auth.uid()));
create policy "cancello le mie proposte" on public.proposte for delete to authenticated using (utente = (select auth.uid()));

create policy "le mie note" on public.note for select to authenticated using (utente = (select auth.uid()) or (select public.is_admin()));
create policy "scrivo le mie note" on public.note for insert to authenticated with check (utente = (select auth.uid()));
create policy "cancello le mie note" on public.note for delete to authenticated using (utente = (select auth.uid()));

create policy "solo admin corregge" on public.schede_ufficiali for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
-- la tabella admin non ha regole: nessun utente la puo' leggere o scrivere

-- ---------- spazio privato per le foto ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('foto', 'foto', false, 3145728, array['image/jpeg','image/png','image/webp']);

create policy "carico solo nella mia cartella" on storage.objects for insert to authenticated
  with check (bucket_id = 'foto' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "cancello le mie foto" on storage.objects for delete to authenticated
  using (bucket_id = 'foto' and (storage.foldername(name))[1] = (select auth.uid())::text);
-- nessuna regola di lettura: le foto le vede solo il server
