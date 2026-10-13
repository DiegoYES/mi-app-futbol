# 📋 Guía de carga de datos

> Los scripts son **idempotentes**: si se paran por cuota, al día siguiente continúan donde quedaron. Nunca duplican datos.

**Reset de cuota: 6:00 PM México todos los días**

## Carga verificada — 9 de octubre de 2026

Plan Pro activo: 7,500 consultas diarias. Se actualizaron las competiciones
configuradas con temporadas disponibles en el proveedor para 2025, 2026 y 2027.
La temporada API 2027 disponible en esta carga corresponde a Japón.

- 2,085 partidos añadidos: 678 de 2025, 1,113 de 2026 y 294 de 2027.
- 10,313 partidos consultados por ID para completar detalle o revalidar cobertura.
- 868 partidos adicionales con estadísticas de equipo y 1,698 con rendimientos
  individuales de jugadores.
- Ningún partido finalizado quedó con `detalle_completo != true` en estas
  temporadas. Esta marca significa detalle consultado, no cobertura garantizada:
  algunos proveedores no entregan estadísticas o jugadores.
- 5,442 consultas de primer/segundo tiempo: 5,316 completos y 126 sin cobertura,
  registrados como consultados para no repetirlos automáticamente.
- Sin pendientes de primera consulta de tiempos en 2026/2027. Quedan **6,351
  partidos de 2025** con estadísticas de equipo pero sin primera consulta de tiempos.
- Carga detenida por presupuesto voluntario, con 1,050 consultas locales restantes
  antes del reset UTC. Bloqueos liberados y caché de partidos invalidada.

Para continuar únicamente los tiempos pendientes de 2025, revisar primero la
cuota renovada y ejecutar el script existente bajo bloqueo, ajustando el tope
para conservar al menos 1,000 consultas para la operación automática:

```bash
npm run quota:sync
SYNC_DELAY_MS=300 SYNC_MAX_REQUESTS=6000 FOOTBALL_SEASON=2025 \
  SYNC_LEAGUES="$(node -e "process.stdout.write(Object.keys(require('./config/leagues').ligas).join(','))")" \
  node scripts/ejecutarConBloqueo.js cron:hourly -- node scripts/completarEstadisticasTiempos.js
```

No usar `SYNC_RETRY_GAPS=true` para esta continuación: también volvería a consultar
partidos cuyo proveedor ya respondió sin cobertura. Evitar solapar la carga con
otros batches; el bloqueo mostrado impide la concurrencia con el cron horario.

## ⏰ Pendiente de hoy — 30 de julio de 2026, 6:00 PM México

Revisar la cuota renovada y ejecutar el lote que completa estadísticas, eventos,
alineaciones y **rendimientos de jugadores**:

```bash
npm run quota:sync
npm run sync:plan
bash scripts/cronSync.sh batch3
```

La página de jugadores depende del bloque `players` obtenido por
`npm run sync:details` (incluido en `batch3`). Una competición puede tener
partidos y estadísticas de equipo pero seguir sin rendimientos individuales si
este lote no se ha ejecutado. `npm run sync:plan` permite revisar los faltantes
antes de consumir cuota.

> 💡 Usa `SYNC_DELAY_MS=300` (seguro para plan PRO, ~200/min). Los partidos de copas sin estadísticas (ej. rondas tempranas de FA Cup) ahora se marcan automáticamente y **no se reintentan**, así no se desperdicia cuota.

---

## ✅ Estado actual (ya cargado)

- **28,600+ partidos con estadísticas** de 32,000+ totales.
- Ligas TOP (2022–2025), segundas divisiones europeas, Champions/Europa/Conference.
- Sudamérica: Argentina, Perú, Chile, Paraguay, Bolivia → **2023, 2024, 2025** con stats.
- Asia/África (Japón, China, Noruega, Egipto) 2024–2025 con stats.
- Copas (FA Cup, Copa del Rey, Libertadores, Sudamericana) 2024 completas.

## 🔜 Pendiente para próximos resets

- **Sudamérica 2022** (128, 242, 265, 239, 130) + Bolivia 2023 quedó a medias (64 part.).
- Copas temporadas 2022/2023/2025 (3, 848, 143, 45).
- Asia/África 2022/2023 (98, 169, 103, 233).

Comandos abajo en cada PASO.

---

## PASO 0 — Hacer esto UNA sola vez (activar cron diario)

```bash
sudo service cron start
crontab -e
```
Pega esta línea y guarda:
```
10 0 * * *  /home/diego/mi-app-futbol/scripts/cronSync.sh batch1 >> /tmp/futbol-batch1.log 2>&1
```

> ⚠️ En WSL hay que correr `sudo service cron start` cada vez que reinicias la computadora.

---

## PASO 1 — Hoy 6 PM (segundas divisiones pendientes)

```bash
cd ~/mi-app-futbol
```
```bash
SYNC_DELAY_MS=900 SYNC_LEAGUES=136,62,79 FOOTBALL_SEASON=2024 node scripts/completarEstadisticas.js
```
```bash
SYNC_DELAY_MS=900 SYNC_LEAGUES=40,141,136,62,79 FOOTBALL_SEASON=2023 node scripts/syncDatabase.js
```
```bash
SYNC_DELAY_MS=900 SYNC_LEAGUES=40,141,136,62,79 FOOTBALL_SEASON=2023 node scripts/completarEstadisticas.js
```
```bash
SYNC_DELAY_MS=900 SYNC_LEAGUES=40,141,136,62,79 FOOTBALL_SEASON=2022 node scripts/syncDatabase.js
```
```bash
SYNC_DELAY_MS=900 SYNC_LEAGUES=40,141,136,62,79 FOOTBALL_SEASON=2022 node scripts/completarEstadisticas.js
```

---

## PASO 2 — Mañana 6 PM (Sudamérica)

```bash
cd ~/mi-app-futbol
```
```bash
SYNC_DELAY_MS=900 SYNC_LEAGUES=128,130,265,242,239,13,11 FOOTBALL_SEASON=2025 node scripts/syncDatabase.js
```
```bash
SYNC_DELAY_MS=900 SYNC_LEAGUES=128,130,265,242,239,13,11 FOOTBALL_SEASON=2025 node scripts/completarEstadisticas.js
```
```bash
SYNC_DELAY_MS=900 SYNC_LEAGUES=128,130,265,242,239,13,11 FOOTBALL_SEASON=2024 node scripts/syncDatabase.js
```
```bash
SYNC_DELAY_MS=900 SYNC_LEAGUES=128,130,265,242,239,13,11 FOOTBALL_SEASON=2024 node scripts/completarEstadisticas.js
```

> 128=Argentina · 130=Bolivia · 265=Chile · 242=Perú · 239=Paraguay · 13=Libertadores · 11=Sudamericana

---

## PASO 3 — Pasado mañana 6 PM (Asia + Noruega + Egipto)

```bash
cd ~/mi-app-futbol
```
```bash
SYNC_DELAY_MS=900 SYNC_LEAGUES=103,98,169,233 FOOTBALL_SEASON=2025 node scripts/syncDatabase.js
```
```bash
SYNC_DELAY_MS=900 SYNC_LEAGUES=103,98,169,233 FOOTBALL_SEASON=2025 node scripts/completarEstadisticas.js
```
```bash
SYNC_DELAY_MS=900 SYNC_LEAGUES=103,98,169,233 FOOTBALL_SEASON=2024 node scripts/syncDatabase.js
```
```bash
SYNC_DELAY_MS=900 SYNC_LEAGUES=103,98,169,233 FOOTBALL_SEASON=2024 node scripts/completarEstadisticas.js
```

> 103=Noruega · 98=Japón · 169=China · 233=Egipto

---

## PASO 4 — Miércoles 6 PM (Europa League + Copas)

```bash
cd ~/mi-app-futbol
```
```bash
SYNC_DELAY_MS=900 SYNC_LEAGUES=3,848 FOOTBALL_SEASON=2024 node scripts/syncDatabase.js
```
```bash
SYNC_DELAY_MS=900 SYNC_LEAGUES=3,848 FOOTBALL_SEASON=2024 node scripts/completarEstadisticas.js
```
```bash
SYNC_DELAY_MS=900 SYNC_LEAGUES=45,143 FOOTBALL_SEASON=2024 node scripts/syncDatabase.js
```
```bash
SYNC_DELAY_MS=900 SYNC_LEAGUES=45,143 FOOTBALL_SEASON=2024 node scripts/completarEstadisticas.js
```

> 3=Europa League · 848=Conference League · 45=FA Cup · 143=Copa del Rey

---

## Comandos de verificación rápida

```bash
# ¿Cuánta cuota me queda?
node scripts/estadoCuota.js
```
```bash
# ¿Cuántos partidos hay en BD por liga?
node -e "require('dotenv').config();const m=require('mongoose');m.connect(process.env.MONGODB_URI).then(async()=>{const P=require('./models/partido');const r=await P.aggregate([{'\$group':{_id:'\$liga.nombre',total:{'\$sum':1},conStats:{'\$sum':{'\$cond':['\$estadisticas_completas',1,0]}}}},{'\$sort':{total:-1}}]);r.forEach(x=>console.log(x._id+': '+x.total+' ('+x.conStats+' con stats)'));console.log('--- TOTAL:',await P.countDocuments());m.disconnect();})" 2>/dev/null | grep -v injected
```
```bash
# Ver log del cron
tail -30 /tmp/futbol-batch1.log
```
```bash
# Auditar ceros sospechosos: por defecto temporadas API 2025 y 2026.
# Solo lectura; informe en artifacts/. No incluye temporadas anteriores.
npm run audit:stats-zeros
npm run audit:stats-zeros -- --temporada-min=2025 --liga=262
npm run audit:stats-zeros -- --temporada-min=2026 --temporada-max=2026

# Con --incluir-pendientes suma los finalizados sin estadísticas que el cron ya
# no revisita (temporada 2025 completa y 2026 con más de 14 días).
npm run audit:stats-zeros -- --temporada-min=2025 --incluir-pendientes

# Reparar revalidando contra la API (1 llamada por cada 20 partidos). Cada
# partido queda como `completas` o `sin_cobertura_proveedor` en una sola pasada.
# Respeta una reserva de cuota para el cron horario (250/h × horas restantes del
# día UTC, mínimo 1000) y espera si un cron:* tiene el bloqueo activo. Es
# reanudable: los api_id ya revisados quedan en `auditoria_cobertura`.
node scripts/auditarCerosEstadisticas.js --execute --allow-prod \
  --confirm-production=REPARAR_CEROS_PRODUCCION \
  --temporada-min=2025 --temporada-max=2026 --incluir-pendientes --max-partidos=2000 --max-llamadas=100
```

`--temporada-min` y `--temporada-max` permiten ajustar el rango explícitamente;
sin opciones se limita a 2025-2026. La reparación conserva los ceros confirmados
por el proveedor y usa `null` únicamente cuando faltan estadísticas; no inventa
valores ni convierte todos los ceros en ausencias.
