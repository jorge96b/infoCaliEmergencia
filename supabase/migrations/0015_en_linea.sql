-- ---------------------------------------------------------------------------
-- Personas en línea
--
-- Cuánta gente está usando la app en este momento. Es una cifra distinta de
-- `personas_en_terreno`, que cuenta a quienes marcaron "estoy aquí" en un punto:
-- esa dice cuánta gente hay trabajando en los albergues, y esta dice cuánta
-- ciudad está mirando. En una emergencia las dos importan y no son la misma.
--
-- No hace falta ninguna tabla nueva. `dispositivos.visto_en` existe desde la
-- 0001, sólo que hasta ahora se movía únicamente cuando alguien *escribía* algo
-- —crear un punto, reportar una necesidad—, así que medía "último reporte" y no
-- "sigue ahí". Con un latido liviano desde el cliente pasa a medir lo segundo.
--
-- Por qué no Realtime, que sería lo obvio para esto: el plan gratuito de
-- Supabase corta a las 200 conexiones concurrentes y, al llegar al tope, deja
-- de emitir sin lanzar ningún error (ver la nota en `src/lib/datos.ts`). Una
-- cifra de "en línea" que se congela en silencio justo cuando entra media
-- ciudad es peor que no tenerla. Esto viaja en `v_global`, que el cliente ya
-- consulta cada 20 s, así que no agrega ni una sola petición.
-- ---------------------------------------------------------------------------

-- El latido es lo único que se agrega al tráfico: una escritura por dispositivo
-- cada cinco minutos, y sólo con la app a la vista. `fn_asegurar_dispositivo`
-- ya hace exactamente el upsert que se necesita, así que no se duplica.
create or replace function rpc_latido_dispositivo(p_dispositivo uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform fn_asegurar_dispositivo(p_dispositivo);
end $$;

grant execute on function rpc_latido_dispositivo(uuid) to anon;

-- El conteo recorre `dispositivos` filtrando por fecha. Con la ciudad entera
-- encima esa tabla es la más grande que hay, así que el índice no es opcional.
create index if not exists dispositivos_en_linea_idx
  on dispositivos (visto_en desc) where not bloqueado;

-- ---------------------------------------------------------------------------
-- `v_global` con la cifra nueva.
--
-- La ventana es de 10 minutos contra un latido de 5: así un latido perdido por
-- un túnel o un semáforo de red no borra a nadie de la cuenta. El precio es que
-- alguien que cierra la app sigue contando hasta 10 minutos, que para una cifra
-- de ambiente es el error barato — mejor pasarse que quedarse corto y sugerir
-- que la ciudad se desconectó.
--
-- La columna va al final porque `create or replace view` sólo deja agregar ahí,
-- y así los permisos de la 0003 se conservan sin volver a concederlos.
-- ---------------------------------------------------------------------------
create or replace view v_global as
select
  (select count(*)::int from puntos where estado = 'activo' and not oculto)              as puntos_activos,
  (select coalesce(sum(personas), 0)::int from v_presencia)                              as personas_en_terreno,
  (select coalesce(sum(cantidad), 0)::int from v_personas where estado = 'desaparecido') as desaparecidos,
  (select coalesce(sum(cantidad), 0)::int from v_personas where estado = 'herido')       as heridos,
  (select coalesce(sum(cantidad), 0)::int from v_personas where estado = 'rescatado')    as rescatados,
  (select count(*)::int from v_necesidades where nivel = 'muy_requerido')                as necesidades_criticas,
  (select json_agg(x) from (
     select n.recurso, n.etiqueta, n.emoji, n.categoria,
            count(*) filter (where n.nivel = 'muy_requerido')::int as puntos_criticos,
            round(sum(n.puntaje), 1)                               as puntaje_total
     from v_necesidades n
     where n.nivel <> 'no_requerido'
     group by n.recurso, n.etiqueta, n.emoji, n.categoria
     order by puntos_criticos desc, puntaje_total desc
     limit 12
   ) x)                                                                                  as top_necesidades,
  now() as generado_en,
  (select count(*)::int from dispositivos
    where not bloqueado and visto_en > now() - interval '10 minutes')                    as personas_en_linea;
