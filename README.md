# Mushu — Mapa de emergencia de Cali

Mapa colaborativo para centralizar, punto por punto, **qué se necesita, qué hay
y cuánta gente está en cada lugar** después del terremoto en Cali.

El problema que ataca no es la falta de ayuda: es la desinformación. Sin un lugar
común donde mirar, la ayuda se duplica en unos puntos y no llega a otros, se
piden volquetas donde ya sobran y falta agua donde nadie sabe que falta.

Cualquiera puede reportar sin registrarse. Nada se toma por cierto sólo porque
alguien lo dijo: cada dato lo confirman o lo desmienten otras personas, y todo
reporte pierde valor con el tiempo, de modo que el mapa muestra la situación de
ahora y no la de hace doce horas.

---

## Cómo decide el mapa qué mostrar

Es la parte que importa entender antes de tocar el código. Dos reglas:

**Sólo cuenta el último reporte de cada dispositivo.** Reportar veinte veces pesa
exactamente igual que reportar una vez. El puntaje mide cuánta gente coincide, no
cuánto insiste una sola persona.

**Todo reporte pierde la mitad de su valor cada pocas horas** (10 h para
necesidades, 4 h para disponibilidad). Una necesidad que nadie vuelve a confirmar
se apaga sola, sin que nadie tenga que ir a borrarla.

De ahí salen los tres niveles que ve el usuario:

| Puntaje | Nivel | Cuándo pasa |
|---|---|---|
| ≥ 2.0 | **Muy requerido** | Dos o más personas lo confirmaron hace poco |
| ≥ 0.6 | **Poco requerido** | Una persona, o varias pero hace rato |
| resto | **No requerido** | Nadie lo pide, o ya reportaron que llegó |

En la práctica: tres confirmaciones sostienen una necesidad como crítica unas
seis horas; un reporte solitario se apaga en unas siete; y dos personas diciendo
"ya llegó" cancelan tres confirmaciones viejas.

La calibración es deliberadamente generosa con las necesidades. En una
emergencia, **no** mostrar una necesidad real cuesta mucho más que mostrar una ya
resuelta: lo segundo lo corrige cualquiera con un toque, lo primero no lo
corrige nadie.

Los conteos de personas y las cantidades usan **mediana, nunca suma**: sumar
multiplicaría a la misma persona desaparecida por cada quien que la reporta, y un
solo troll escribiendo 500 no mueve una mediana.

La presencia caduca a los **90 minutos sin señal de vida**, porque casi nadie
toca "ya me fui" y sin caducidad el mapa de calor sólo crecería.

---

## Puesta en marcha

### 1. Supabase

Crea un proyecto en [supabase.com](https://supabase.com) (el plan gratuito
alcanza para empezar). En **SQL Editor**, ejecuta en orden los archivos de
`supabase/migrations/`:

```
0001_esquema.sql
0002_vistas.sql
0003_rls.sql
0004_rpc.sql
0005_semilla.sql
```

Comprueba que quedó bien:

```sql
select * from v_global;
```

En **Settings → API** copia la URL del proyecto y la `anon key`.

### 2. Variables de entorno

```bash
cp .env.example .env.local
```

Llena `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

### 3. Arrancar

```bash
npm install
npm run dev
```

### 4. Cargar puntos reales — no te saltes esto

Las migraciones siembran **sólo catálogos**. A propósito no incluyen albergues ni
centros de acopio de ejemplo: mandar gente a una dirección inventada durante una
emergencia real hace daño.

Pero un mapa vacío es un mapa muerto. Antes de difundir el enlace, carga diez o
veinte ubicaciones que hayas verificado, marcadas como oficiales para que salgan
con escudo azul y no puedan ser desmentidas por votación:

```sql
insert into puntos (nombre, tipo, lat, lng, barrio, origen, creado_por, client_id)
values ('Albergue Fulanito', 'albergue', 3.4520, -76.5290, 'San Fernando',
        'oficial', gen_random_uuid(), gen_random_uuid());
```

### 5. Desplegar

Importa el repositorio en Vercel y define las dos variables de entorno. No hace
falta nada más.

---

## Cómo está armado

```
src/
  app/page.tsx           pantalla única: mapa + hojas inferiores
  components/
    Mapa.tsx             Leaflet, marcadores y capa de calor
    HojaPunto.tsx        detalle del punto: qué falta / qué hay / personas
    CrearPunto.tsx       marcar un lugar nuevo
    BarraGlobal.tsx      cifras de toda la ciudad
  lib/
    datos.ts             TODA la lectura
    reportes.ts          TODA la escritura
    supabase.ts          cliente, con el id de dispositivo en la cabecera
supabase/migrations/     esquema, vistas, RLS y RPC
```

Que lectura y escritura pasen cada una por **un solo módulo** es deliberado:
cuando el tráfico apriete, basta con cambiar el interior de `datos.ts` para que
peguen a una ruta cacheada en el borde en vez de a Supabase, sin tocar un solo
componente.

**Se usa polling cada 20 s, no Realtime.** El plan gratuito de Supabase corta a
las 200 conexiones concurrentes y, al llegar al tope, deja de emitir cambios *sin
lanzar ningún error*: una app de emergencia que se queda callada sin avisar es
peor que una que refresca cada 20 s. Además el puntaje cambia con el paso del
tiempo aunque no entren datos nuevos, así que refrescar por reloj hace falta de
todos modos.

### Control de abuso

La `anon key` es pública por diseño, así que nada de esto es autenticación. Es
una escalera de tres peldaños que encarece el abuso en vez de pretender
impedirlo:

1. **Permisos por columna.** `anon` no tiene DELETE ni UPDATE amplio, y no puede
   escribir `creado_en`: no hay forma de antedatar un reporte para manipular el
   decaimiento.
2. **Índices únicos por hora.** Un dispositivo no puede mover el puntaje de una
   necesidad más de ±1 por hora. No es una heurística: aunque reenvíe diez mil
   inserciones, el puntaje no cambia.
3. **Límite de volumen** por trigger, más lista de bloqueo y auto-ocultamiento a
   las tres denuncias.

La defensa de fondo, sin embargo, es la agregación: medianas, decaimiento y
umbrales de consenso hacen que un reporte aislado no cambie lo que ve la gente.

### Sin señal

La app es instalable y **funciona sin conexión**. Con la señal caída se puede
abrir, ver el último estado conocido del mapa y seguir reportando; los reportes
se guardan en una bandeja de salida en IndexedDB y se envían solos cuando vuelve
la red. Una franja naranja dice cuántos hay pendientes, para que nadie reporte
dos veces creyendo que se perdió.

Lo difícil de una cola así no es guardarla, es **no duplicar al reenviarla**. El
caso que rompe estas apps es que la petición llegue al servidor pero se pierda la
respuesta, y el cliente reintente creyendo que falló. Aquí está resuelto de raíz:
cada acción lleva un `client_id` generado *antes* del primer intento de red, y
todas las funciones del servidor son idempotentes sobre él. Se puede reenviar la
cola cien veces y sigue produciendo una sola fila.

El reparto de responsabilidades entre error y cola es deliberado: si el servidor
**responde** con un error (límite de tasa, dato inválido), se le muestra a la
persona, porque encolarlo sería mentirle diciendo que se guardó. Sólo cuando **no
hay respuesta** el reporte va a la cola.

Dos cosas que a propósito **no** se encolan: crear un lugar nuevo, porque el
servidor puede devolver un punto que ya existía a menos de 40 m y la interfaz
necesita saber a dónde ir; y el latido de presencia, porque si no hubo señal lo
correcto es que la presencia caduque, no resucitarla media hora después.

El service worker (`public/sw.js`) está escrito a mano y usa caché en tiempo de
ejecución en vez de precaché, para no acoplarse al build. Guarda las teselas del
mapa, los fragmentos de Next.js —que llevan hash, así que son inmutables— y la
última respuesta de datos. Ninguna escritura pasa por él: un service worker
reintentando POSTs a ciegas sería justo la forma de duplicar reportes.

### Datos personales

`persona_reportes` guarda **sólo cifras**: ni nombres, ni teléfonos, ni fotos.
Una base pública y anónima de personas desaparecidas por nombre sería una
violación de la Ley 1581 de 2012 y un vector conocido de estafa y extorsión tras
desastres en Colombia. Para buscar a alguien en concreto, los canales son la
línea 123 y el servicio de Restablecimiento del Contacto Familiar de la Cruz
Roja Colombiana.

---

## Verificar que funciona

```bash
npm run build      # compila y verifica tipos
```

Contra la base de datos, lo que conviene comprobar a mano:

```sql
-- Dos dispositivos distintos confirmando lo mismo => muy_requerido
select nivel, puntaje from v_necesidades where recurso = 'agua';

-- Envejecer los reportes y ver que la necesidad se apaga sola
update necesidad_reportes set efectivo_en = now() - interval '12 hours';

-- La presencia caduca sin latido
update presencia set visto_en = now() - interval '2 hours';
select * from v_presencia;   -- debe quedar vacío
```

En la interfaz, con dos navegadores (uno normal y uno de incógnito, para tener
dos identidades de dispositivo): confirmar la misma necesidad en ambos y ver que
el nivel sube de "poco requerido" a "muy requerido".

El modo sin señal hay que probarlo contra un build de producción (`npm run build
&& npm start`), porque en modo desarrollo el service worker no se comporta igual.
En DevTools → Network → Offline:

1. Reportar tres cosas: cada una confirma al instante y la franja dice "Guardados
   3 reportes".
2. Recargar la página **sin restablecer la red**: la app debe volver a abrir con
   el último mapa conocido y la cola intacta.
3. Volver a poner la red: deben aparecer exactamente tres filas, ni una más.
4. Con la red ya restablecida, alternar entre pestañas varias veces seguidas para
   disparar vaciados concurrentes: deben seguir siendo tres filas.

---

## Lo que falta

- **Moderación.** Las tablas y el auto-ocultamiento a las tres denuncias ya
  funcionan; falta el panel para revisar lo ocultado y bloquear dispositivos.
- **Teselas propias.** Hoy usa las de OpenStreetMap, cuya política de uso
  **prohíbe el tráfico masivo**. Si la aplicación se difunde de verdad, hay que
  migrar a un archivo PMTiles de Cali servido desde almacenamiento propio, antes
  de que bloqueen las peticiones. Eso además habilita el mapa offline de verdad.

## Riesgos a vigilar en producción

- **Transferencia del plan gratuito de Supabase (5 GB/mes)** es el límite que más
  probablemente se alcance primero. La válvula de escape es cachear la respuesta
  del mapa en el borde; por eso toda la lectura pasa por `datos.ts`.
- **Un mapa vacío no arranca.** Carga puntos reales antes de compartir el enlace.
- **La moderación es un cuello de botella humano.** Conviene tener tres o cinco
  personas de confianza listas antes de lanzar, no después.
- **Esto no reemplaza a los canales oficiales.** La interfaz lo dice de forma
  permanente y debe seguir diciéndolo.
