# 📋 Guía de carga de datos

> Los scripts son **idempotentes**: si se paran por cuota, al día siguiente continúan donde quedaron. Nunca duplican datos.

**Reset de cuota: 6:00 PM México todos los días**

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
