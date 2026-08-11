# infoCaliEmergencia — Mapa de emergencia de Cali

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
0006_rls_catalogos.sql
0007_moderacion.sql
```

Luego **comprueba que quedó bien** — no lo des por hecho. Pega
`supabase/verificar.sql`: revisa tabla por tabla que todo exista, que RLS esté
activo en las diez tablas y que `anon` no tenga ningún permiso de más. Devuelve
una fila por comprobación; cualquier ✗ hay que resolverlo antes de seguir.

Y para confirmar que la lógica de consenso se comporta sobre *tu* base, pega
`supabase/prueba_logica.sql`. Crea datos de mentira, comprueba once cosas
—umbrales, decaimiento, mediana frente a valores extremos, idempotencia— y borra
todo lo que creó. Es seguro correrlo en producción.

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

### 5. Dar de alta a los moderadores

El panel vive en `/moderacion` y no está enlazado desde ningún sitio. Entra con
correo y contraseña, y no hay registro: las cuentas se crean a mano.

En **Authentication → Users → Add user** crea una cuenta por persona (marca
*Auto Confirm User*). Luego, en el SQL Editor, dale permiso a cada una:

```sql
insert into moderadores (id, nombre)
select id, 'Nombre de la persona' from auth.users where email = 'correo@ejemplo.com';
```

Para revocar a alguien, `update moderadores set activo = false where …`. Es
preferible a borrar la fila: la bitácora sigue pudiendo decir quién hizo qué.

Ten a las tres o cinco personas listas **antes** de difundir el enlace, no
después. La moderación es un cuello de botella humano y no se improvisa con el
mapa ya lleno de gente.

### 6. Desplegar

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
    Denunciar.tsx        avisar de contenido falso u ofensivo
    mod/                 el panel de moderación
  app/moderacion/        pantalla del panel (sin enlazar, con noindex)
  lib/
    datos.ts             TODA la lectura
    reportes.ts          TODA la escritura
    supabase.ts          cliente, con el id de dispositivo en la cabecera
    moderacion.ts        lectura y escritura del panel
    supabaseModeracion.ts  cliente aparte, con sesión de Supabase Auth
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

La moderación necesita **tres** identidades de dispositivo para llegar al umbral.
Con un punto de prueba:

1. Denunciarlo desde los tres: al tercero desaparece del mapa.
2. Entrar a `/moderacion` y aprobarlo: **vuelve** a aparecer.
3. Denunciarlo desde un cuarto dispositivo: tiene que **seguir** visible. Si
   desaparece, la migración 0007 no está aplicada y moderar no sirve de nada.
4. Bloquear el dispositivo marcando "ocultar también todo lo que publicó", y
   comprobar que sus puntos se van y que reportar desde él ahora responde
   "Este dispositivo fue bloqueado…".
5. Mirar la bitácora: deben estar las tres acciones, con nombre y motivo.

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

### Moderación

Cualquiera puede denunciar un lugar desde su hoja de detalle, sin registrarse.
Tres denuncias de dispositivos distintos lo ocultan solas, y a partir de ahí
decide una persona en `/moderacion`.

Lo importante de ese panel no es la lista, es **quién gana cuando el
automatismo y una persona no coinciden**. Gana la persona, siempre:

- Lo que un moderador aprueba **no vuelve a caer** por más denuncias que reciba.
  Sin esa regla, tres cuentas coordinadas deshacen cada decisión indefinidamente
  y moderar se vuelve achicar agua con un balde agujereado.
- Lo que un moderador oculta **no se destapa** porque su autor lo vuelva a
  reportar dentro de la misma hora.
- Un punto marcado como oficial **no se oculta por votación**, sólo a mano.

Nada se borra nunca: ocultar y bloquear son reversibles, y cada acción queda en
una bitácora con quién, qué, cuándo y por qué. Antes de bloquear a alguien se
puede ver todo lo que publicó y también **cuántas denuncias emitió** — quien
dispara diez en media hora está intentando tumbar información buena, y eso
también es abuso.

Las denuncias siguen sin poder leerse desde el mapa, a propósito: si alguien
pudiera contar cuántas lleva una fila, sabría cuántas le faltan para tumbarla.

## Lo que falta

- **Gestión de puntos desde el panel.** Cerrar un albergue que ya no opera,
  marcar duplicados y promover un punto a oficial siguen siendo `UPDATE` a mano
  en el SQL Editor.
- **Denunciar reportes sueltos.** El servidor ya acepta denuncias sobre
  necesidades, disponibilidad y conteos; la interfaz sólo deja denunciar el
  lugar entero.
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
