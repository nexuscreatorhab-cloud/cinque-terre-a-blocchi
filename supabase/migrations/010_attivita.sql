-- Attività reali dei borghi (alloggi, locali, negozi, barche, servizi) da OpenStreetMap.
-- Schede "non reclamate": solo nome e tipo, niente telefono, sito o indirizzo.
-- Quando un'attività paga e reclama la scheda, cambia stato.
create table public.attivita (
  id uuid primary key default gen_random_uuid(),
  osm_id text unique,                         -- es. node/123: per aggiornare senza doppioni
  nome text not null,
  categoria text not null check (categoria in ('alloggio','ristorazione','negozio','barca','tour','servizio')),
  sottotipo text,                             -- tag OSM originale, es. amenity=restaurant
  borgo text not null references public.borghi,
  edificio int,                               -- posizione 1-based in dati/<borgo>.json (null = in strada o non trovato)
  lat double precision not null,
  lon double precision not null,
  fonte text not null default '© OpenStreetMap contributors (ODbL)',
  aggiornato date not null default current_date,
  stato text not null default 'non_reclamata' check (stato in ('non_reclamata','reclamata','nascosta')),
  foreign key (borgo, edificio) references public.edifici
);
create index attivita_casa on public.attivita (borgo, edificio);

alter table public.attivita enable row level security;
create policy attivita_lettura on public.attivita for select to anon, authenticated using (stato <> 'nascosta');
grant select on public.attivita to anon, authenticated;
