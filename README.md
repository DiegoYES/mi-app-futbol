# Data Fut — análisis estadístico de fútbol

![Data Fut](public/brand-social-banner.png)

Plataforma web full stack para explorar datos históricos de fútbol, comparar equipos y evaluar mercados deportivos con muestras y probabilidades explícitas. El producto incluye autenticación, seguimiento personal, suscripciones, sincronización de datos y operación automatizada en producción.

> Proyecto independiente con fines informativos. No es una casa de apuestas ni garantiza resultados.
> Código fuente visible para evaluación profesional y fines de portafolio. No se concede permiso para copiar, redistribuir o utilizar comercialmente el proyecto.

## Qué demuestra este proyecto

- Aplicación web completa con Node.js, Express y JavaScript nativo en el cliente.
- Modelado de partidos, equipos, jugadores y estadísticas en MongoDB.
- Caché, rate limiting y coordinación entre procesos mediante Redis.
- JWT en cookies seguras, roles, Helmet, validación de origen y límites de uso.
- Suscripciones con Mercado Pago y validación de webhooks.
- Ingesta reanudable, control de cuota, circuit breaker y auditorías de datos.
- Pruebas unitarias, de integración, de interfaz y smoke tests.
- Nginx, systemd, staging, rollback, monitoreo y respaldos automatizados.

## Arquitectura

```text
Navegador
   │
Nginx ──► Express ──► MongoDB
              │
              ├────► Redis (caché, límites y coordinación)
              ├────► API-Football (datos deportivos)
              └────► Mercado Pago (suscripciones y webhooks)
```

## Tecnologías

`Node.js` · `Express 5` · `MongoDB/Mongoose` · `Redis` · `JWT` · `Playwright` · `Node Test Runner` · `Nginx` · `systemd` · `Mercado Pago`

## Puesta en marcha

1. Instala Node.js 20 o posterior y una instancia de MongoDB.
2. Ejecuta `npm install`.
3. Copia `.env.example` a `.env` y configura MongoDB, API-Football y JWT.
4. Arranca la aplicación con `npm start`.
5. Abre `http://localhost:3000/login.html`.

Las credenciales reales deben permanecer únicamente en `.env`; este archivo está excluido de Git. Los valores de `.env.example` son plantillas.

Comandos de comprobación:

```bash
npm test
npm run check
npm run audit:data
npm run sync:stats
npm run sync:halves
npm run sync:events
```

La lista de seguridad, variables, alertas y plantilla de VM está en
[`docs/PRODUCCION.md`](docs/PRODUCCION.md).

## Staging y despliegue

Cada versión se valida en un entorno de staging aislado antes de llegar a
producción. Producción corre bajo systemd con releases inmutables; staging usa
dos procesos PM2 balanceados en los puertos 3100/3101. Ambos entornos conservan
directorios, puertos, bases y secretos separados. El flujo completo
(instalación, semillas sintéticas, smoke test, promoción y rollback) está en
[`docs/STAGING.md`](docs/STAGING.md):

```bash
deploy/deploy-staging.sh <sha>      # instala un commit concreto en staging
deploy/smoke-staging.sh             # valida y registra el commit
deploy/promote-production.sh <sha>  # promueve sólo un commit validado
deploy/rollback-production.sh       # vuelve a un commit registrado
```

## Datos y sincronización

La sincronización se controla desde `.env`:

```dotenv
FOOTBALL_SEASON=2026
SYNC_LEAGUES=262,253,71,39,140,61,135,78
```

`FOOTBALL_SEASON` usa el año con el que API-Football identifica la temporada.
El año `2025` representa la campaña 2025-26 en Europa y el calendario 2025 en
México, Estados Unidos y Brasil; `2026` representa 2026-27 en Europa y el
calendario 2026 en América. `SYNC_LEAGUES` acepta IDs separados por comas.

Flujo recomendado para una temporada:

```bash
FOOTBALL_SEASON=2026 SYNC_LEAGUES=262,253,71,39,140,61,135,78 npm run sync:seasons
FOOTBALL_SEASON=2026 SYNC_LEAGUES=262,253,71,39,140,61,135,78 npm run sync:fixtures
FOOTBALL_SEASON=2026 SYNC_LEAGUES=262,253,71,39,140,61,135,78 npm run sync:plan
FOOTBALL_SEASON=2026 SYNC_LEAGUES=262,253,71,39,140,61,135,78 npm run sync:details
npm run audit:data
```

`sync:fixtures` consume dos llamadas por liga (equipos y fixtures), hace upsert y
preserva el detalle avanzado existente. `sync:details` consulta hasta 20 partidos
finalizados por llamada y guarda estadísticas, eventos, alineaciones y jugadores.
Todos los comandos son reanudables. La interfaz exige liga y temporada en cada
lado del comparador, por lo que no mezcla campañas silenciosamente.
`ANALYSIS_MIN_SEASON=2025` mantiene 2022-24 fuera de picks y comparación de forma,
pero conserva ese archivo para H2H, perfiles de jugadores y tablas históricas.

## Cobertura al 26 de agosto de 2026

- Base total: 198,559 partidos de 116 competiciones, 4,432 equipos y
  4,298,097 actuaciones de jugador.
- Ocho ligas prioritarias (Liga MX, MLS, Brasileirão, Premier League, LaLiga,
  Ligue 1, Serie A y Bundesliga) con temporadas API 2021-2025 completas y la
  temporada vigente al día mediante el cron horario.
- Pirámides completas de Inglaterra, Francia y Alemania hasta tercera/cuarta
  división; segundas divisiones de España, Italia, Portugal, Países Bajos,
  Bélgica y Turquía entre otras.
- Bloque femenil: Liga MX Femenil, Women's Super League, Serie A Women,
  Première Ligue, Frauen-Bundesliga, Liga F, Brasileirão Femenino, A-League
  Women, NWSL, Damallsvenskan y UEFA Champions League Women (2017-2026).
- Selecciones y copas: Mundial 2026, Euro 2024, Copa América 2024, Libertadores,
  Sudamericana, Concachampions, Leagues Cup y Mundial de Clubes 2025.
- Torneos incorporados el 26 de agosto de 2026: FIFA Club World Cup 2025 y
  CONCACAF Gold Cup 2025 con estadísticas, eventos y jugadores al 100 %;
  Copa América Femenina 2025 con marcadores y eventos, sin estadísticas
  avanzadas porque el proveedor no las ofrece para ese torneo.

La interfaz representa estadísticas avanzadas ausentes con `—`; nunca las
convierte en cero. Las ligas sin partidos guardados aparecen deshabilitadas.
El endpoint `/leagues` del proveedor declara por temporada qué cobertura
entrega (`coverage.fixtures.statistics_fixtures`); conviene consultarlo antes
de planear una sincronización.

## Mantenimiento

Los índices requeridos por las consultas se declaran en los modelos y pueden
crearse de forma no destructiva con:

```bash
npm run db:indexes
```

La auditoría es de solo lectura. No imprime la URI de MongoDB ni otras credenciales.

## Cuota Pro y orden de trabajo

Todos los clientes de API-Football reservan su consulta en un contador diario
compartido. El límite de respaldo es 7,500 y el margen predeterminado es 0 para
aprovechar todo el cupo confirmado; puedes reservar llamadas manuales con
`API_FOOTBALL_QUOTA_MARGIN`. Dos scripts ejecutados el mismo día no pueden gastar
la misma cuota dos veces. El panel de administración muestra el consumo del día.

El límite configurado es únicamente un respaldo inicial: después de cada
respuesta el cliente sincroniza el límite diario y las consultas restantes desde
los encabezados oficiales. Así, una asignación real distinta de 7,500 no queda
recortada artificialmente. Un 429 por minuto no se marca como día agotado.

Las keys adicionales (`API_FOOTBALL_KEY_2` o `API_FOOTBALL_KEYS`) no suman
cuotas. Solo se usan como respaldo de autenticación al activar
`API_FOOTBALL_ALLOW_KEY_FAILOVER=true`, y deben pertenecer a un uso autorizado
del mismo proyecto o equipo. Nunca se rota de key para evadir un límite diario.

Para cada refresco se recomienda este orden:

1. `npm run sync:plan` para contar faltantes sin gastar API.
2. `npm run quota:sync` para leer el cupo real mediante `/status`.
3. `npm run sync:details` para traer hasta 20 partidos por llamada, incluyendo
   estadísticas completas, eventos, alineaciones y rendimientos de jugadores.
4. Validar picks y cobertura; `npm run sync:halves` usa `half=true` y obtiene
   primer y segundo tiempo juntos en una llamada adicional por partido.

Cada comando reanuda únicamente documentos pendientes y se detiene al agotar el
cupo. `SYNC_MAX_REQUESTS=3` limita voluntariamente una corrida a tres llamadas y
`SYNC_LEAGUES=262` aísla Liga MX. Con la lista prioritaria completa se recorren
las ocho competiciones objetivo de una temporada. Los huecos que el proveedor ya
devolvió vacíos no se consultan repetidamente; para un reintento explícito usa
`SYNC_RETRY_GAPS=true` junto con un `SYNC_MAX_REQUESTS` pequeño.
`SYNC_RETRY_AFTER_HOURS` controla la espera mínima desde la consulta anterior
(4 horas por defecto). El cron nocturno reintenta durante 14 días los huecos de
las ocho ligas prioritarias, con una espera de 24 horas para proteger la cuota.

## Funciones analíticas

- Picks históricos de goles, resultado, córners, tarjetas amarillas/rojas, tiros,
  tiros a puerta, faltas y fueras de juego. Incluyen líneas Over/Under totales y
  por equipo, suavizado, muestra y número de fuentes disponibles.
- Seguimiento personal: solo permite guardar antes del inicio, liquida el mercado
  contra el partido final y calcula efectividad y puntuación Brier.
- Boletas personales de hasta 20 selecciones: permiten combinar mercados del
  mismo cruce o de partidos distintos, vuelven a validar cada porcentaje en el
  servidor y generan una lista copiable para buscarla manualmente en la casa.
- Los mercados avanzados excluyen partidos sin `estadisticas_completas`; nunca
  cuentan un dato ausente como cero y no se recomiendan con menos de 5 muestras
  de ambos equipos.
- Perfiles de árbitros derivados de fixtures, goles, tarjetas y faltas.
- Calendario y detalle de partidos preparado para fixtures futuros.
- Directorio y perfiles de jugadores por competición y temporada.
- H2H multitemporada y trayectoria histórica de equipos con posición, puntos,
  récord y diferencia de goles reconstruidos por campaña.

## Marcas, imágenes y responsabilidad

El pie de todas las páginas enlaza a `/legal.html`. El producto se identifica
como independiente y no afiliado; nombres y recursos gráficos se presentan con
fines descriptivos. Los términos de API-SPORTS advierten que algunos logos o
imágenes pueden requerir autorización adicional de sus titulares, por lo que el
aviso no sustituye una revisión de licencias antes de comercializar el servicio.
