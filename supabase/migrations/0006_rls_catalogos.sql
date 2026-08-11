-- infoCaliEmergencia — 0006: RLS en los catálogos.
--
-- `tipos_punto` y `recursos` se habían quedado sin row level security. No es una
-- fuga de datos —son catálogos públicos y a `anon` sólo se le dio SELECT— pero
-- dejar una tabla del esquema `public` sin RLS en Supabase sí tiene dos costos
-- reales: el Security Advisor del panel lo marca como error, y la postura de
-- seguridad queda implícita en un GRANT en vez de escrita en una política, que
-- es justo el tipo de cosa que se rompe sin que nadie se dé cuenta al añadir un
-- permiso más adelante.
--
-- La política filtra además por `activo`, así que retirar un recurso del
-- catálogo basta con marcarlo inactivo: deja de ser visible sin borrar historia.
--
-- Es idempotente: se puede correr sobre una base ya desplegada.

alter table tipos_punto enable row level security;
alter table recursos    enable row level security;

drop policy if exists p_tipos_select on tipos_punto;
create policy p_tipos_select on tipos_punto
  for select to anon
  using (activo);

drop policy if exists p_recursos_select on recursos;
create policy p_recursos_select on recursos
  for select to anon
  using (activo);
