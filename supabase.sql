-- Einkauf-App: Tabelle und Sicherheitsregeln für den gemeinsamen Abgleich.
-- In Supabase: SQL Editor → New query → alles einfügen → Run.

create table if not exists public.einkauf_docs (
  hid        text        not null check (char_length(hid) >= 20),  -- geheimer Haushalts-Code
  col        text        not null check (col in ('items', 'members', 'stores', 'offers', 'categories', 'meta')),
  id         text        not null,
  data       jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (hid, col, id)
);

alter table public.einkauf_docs enable row level security;

-- Zugriff nur auf Zeilen des Haushalts, dessen Code die App im Header "x-household" mitschickt.
-- Ohne Code sieht man nichts; eine Liste aller Haushalte kann niemand abrufen.
create or replace function public.einkauf_household() returns text
language sql stable as $$
  select coalesce(current_setting('request.headers', true)::json ->> 'x-household', '')
$$;

drop policy if exists "einkauf lesen"     on public.einkauf_docs;
drop policy if exists "einkauf anlegen"   on public.einkauf_docs;
drop policy if exists "einkauf aendern"   on public.einkauf_docs;
drop policy if exists "einkauf loeschen"  on public.einkauf_docs;

create policy "einkauf lesen"    on public.einkauf_docs for select to anon, authenticated using (hid = public.einkauf_household());
create policy "einkauf anlegen"  on public.einkauf_docs for insert to anon, authenticated with check (hid = public.einkauf_household());
create policy "einkauf aendern"  on public.einkauf_docs for update to anon, authenticated using (hid = public.einkauf_household()) with check (hid = public.einkauf_household());
create policy "einkauf loeschen" on public.einkauf_docs for delete to anon, authenticated using (hid = public.einkauf_household());

-- Zugriff über die App-Schnittstelle erlauben (die Regeln oben begrenzen ihn auf den eigenen Haushalt)
grant select, insert, update, delete on public.einkauf_docs to anon, authenticated;
