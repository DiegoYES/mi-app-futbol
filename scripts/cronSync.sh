#!/usr/bin/env bash
# =============================================================================
# cronSync.sh — Sincronización automática programada
#
# Uso recomendado desde crontab (una vez por hora):
#   7 * * * * /var/www/mi-app-futbol/scripts/cronSync.sh hourly >> /var/log/mi-app-futbol-sync.log 2>&1
#
# Horario del sistema (CST, UTC-6):
#   batch1: 00:10 → cierre de los partidos americanos de la noche
#   batch2: 06:00 → recoger partidos nocturnos y preparar el día
#   batch3: 18:00 → inicia el nuevo día UTC/cuota y recoge detalles con jugadores
# =============================================================================
set -u
BATCH="${1:-hourly}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"

# Cargar entorno si no viene de systemd/PM2
if [ -f "$APP_DIR/.env" ]; then
  set -a; source "$APP_DIR/.env"; set +a
fi

# Una sola instancia puede ejecutar cada batch. El lease vive en MongoDB, por
# lo que también evita duplicados si mañana hay más de una VM.
if [ "${SYNC_LOCK_HELD:-0}" != "1" ]; then
  exec node scripts/ejecutarConBloqueo.js "cron:$BATCH" -- "$APP_DIR/scripts/cronSync.sh" "$BATCH"
fi

# El plan Pro permite 300/min y 5/s. El interceptor central serializa a 4/s;
# esta pausa adicional mantiene los lotes secuenciales cerca de 3.3/s.
export SYNC_DELAY_MS="${SYNC_DELAY_MS:-300}"

# Los batches heredados conservan su tope; el modo horario define uno menor abajo.
if [ "$BATCH" != "hourly" ]; then
  export SYNC_MAX_REQUESTS="${SYNC_MAX_REQUESTS:-2400}"
fi

# Todas las competiciones configuradas. La carga de detalles es idempotente y
# solo consulta partidos finalizados que todavía no tengan detalle completo.
ALL_LEAGUES="$(node -e "const c=require('./config/leagues');process.stdout.write(Object.keys(c.ligas).join(','))")"

TS="$(date -u +'%Y-%m-%d %H:%M:%S UTC')"
echo ""
echo "========================================================="
echo "  CRON $BATCH — $TS"
echo "========================================================="

# ------------------------------------------------------------------
# HOURLY: actualización operativa, sin cargas históricas
#   - Refresca marcadores/estados del día
#   - Completa estadísticas totales y 1T/2T
#   - Trae eventos, alineaciones y estadísticas individuales de jugadores
# ------------------------------------------------------------------
if [ "$BATCH" = "hourly" ]; then
  # Tope voluntario por proceso. El control central conserva además el margen
  # diario configurado en API_FOOTBALL_DAILY_LIMIT.
  export SYNC_MAX_REQUESTS="${SYNC_MAX_REQUESTS:-250}"

  # El cron real del servidor sólo invoca este modo al minuto 7 de cada hora.
  # Una vez al día recuperamos partidos que ya salieron de la ventana normal
  # de ayer/hoy/mañana. El propio script aplica además límites y cooldown.
  if [ "$(date -u +%H)" = "06" ]; then
    echo ""
    echo "▸ Reparar estados atrasados de los últimos 7 días (máximo 15 llamadas)"
    node scripts/repararDetalles.js \
      --dias=7 \
      --horas-gracia=3 \
      --max-partidos=300 \
      --max-llamadas=15 \
      --execute \
      --allow-prod \
      --confirm-production=REPARAR_ESTADOS_PRODUCCION
  fi

  echo ""
  echo "▸ Actualizar ayer/hoy/mañana UTC para todas las ligas cargadas: marcadores, estadísticas y 1T/2T"
  node scripts/syncCalendario.js

  echo ""
  echo "▸ Completar eventos, alineaciones y jugadores pendientes"
  SYNC_RETRY_GAPS=true SYNC_RECENT_DAYS=3 SYNC_ALL_LOADED_LEAGUES=true FOOTBALL_SEASON=2026 \
    node scripts/completarDetallesLote.js

# ------------------------------------------------------------------
# BATCH 1 (00:10 CST): cierre nocturno
#   - Completar stats de partidos finalizados sin estadísticas
#   - Sincronizar fixtures futuros de ligas top (el calendario puede cambiar)
#   - Cargar segundas divisiones pendientes si quedan peticiones
# ------------------------------------------------------------------
elif [ "$BATCH" = "batch1" ]; then
  echo ""
  echo "▸ Reparar estados atrasados de los últimos 7 días (máximo 15 llamadas)"
  node scripts/repararDetalles.js \
    --dias=7 \
    --horas-gracia=3 \
    --max-partidos=300 \
    --max-llamadas=15 \
    --execute \
    --allow-prod \
    --confirm-production=REPARAR_ESTADOS_PRODUCCION

  echo ""
  echo "▸ Calendario de ayer/hoy UTC (cubre el día completo de América)"
  node scripts/syncCalendario.js

  echo ""
  echo "▸ Completar detalles pendientes (todas las ligas, temporada 2026)"
  FOOTBALL_SEASON=2026 SYNC_LEAGUES="$ALL_LEAGUES" \
    node scripts/completarDetallesLote.js

  echo ""
  echo "▸ Sincronizar fixtures futuros — ligas top"
  SYNC_LEAGUES=2,3,39,40,41,42,43,44,61,62,63,64,78,79,80,82,88,89,94,95,99,104,106,107,113,114,119,120,135,136,139,140,141,142,144,145,164,172,179,180,183,184,185,188,190,197,203,204,207,208,210,218,219,235,236,244,271,283,286,288,292,293,301,305,307,308,318,333,345,357,383,525,549,848 \
    node scripts/syncDatabase.js

# ------------------------------------------------------------------
# BATCH 2 (06:00 CST): actualización matutina
#   - Completar stats de lo que acabó hoy en Europa
#   - Sincronizar ligas americanas (sus fixtures del día se confirman aquí)
# ------------------------------------------------------------------
elif [ "$BATCH" = "batch2" ]; then
  echo ""
  echo "▸ Actualizar calendario antes de completar detalles"
  node scripts/syncCalendario.js

  echo ""
  echo "▸ Completar detalles pendientes (todas las ligas, temporada 2026)"
  FOOTBALL_SEASON=2026 SYNC_LEAGUES="$ALL_LEAGUES" \
    node scripts/completarDetallesLote.js

  echo ""
  echo "▸ Sincronizar fixtures — ligas americanas y Brasileirão (temporadas 2025 y 2026)"
  FOOTBALL_SEASON=2026 SYNC_LEAGUES=11,13,71,72,73,74,75,98,103,128,129,130,134,169,233,239,240,242,250,252,253,254,256,262,263,265,268,281,344,479,673 \
    node scripts/syncDatabase.js
  FOOTBALL_SEASON=2025 SYNC_LEAGUES=253,263 \
    node scripts/syncDatabase.js

# ------------------------------------------------------------------
# BATCH 3 (18:00 CST, 00:00 UTC): actualización tras renovar la cuota diaria
#   - Completar stats de partidos americanos que acabaron esta noche
#   - Segundas divisiones pendientes de carga histórica
#   - Carga masiva progresiva (si queda cuota disponible)
# ------------------------------------------------------------------
elif [ "$BATCH" = "batch3" ]; then
  echo ""
  echo "▸ Actualizar calendario antes de completar detalles"
  node scripts/syncCalendario.js

  echo ""
  echo "▸ Completar detalles pendientes (todas las ligas, temporada 2026)"
  FOOTBALL_SEASON=2026 SYNC_LEAGUES="$ALL_LEAGUES" \
    node scripts/completarDetallesLote.js

  echo ""
  echo "▸ Carga progresiva de datos históricos (segundas divisiones y copas)"
  # Temporadas en orden de prioridad — el script es idempotente y para cuando
  # se agota la cuota; mañana continúa desde donde quedó
  for SEASON in 2024 2023 2022; do
    FOOTBALL_SEASON=$SEASON \
    SYNC_LEAGUES=40,141,136,62,79,3,848 \
      node scripts/syncDatabase.js
  done

else
  echo "❌ Batch desconocido: $BATCH (usa hourly, batch1, batch2 o batch3)"
  exit 1
fi

echo ""
echo "▸ Estado final de cuota:"
node scripts/estadoCuota.js 2>/dev/null | grep -E '"usadas"|"restantes"|"agotada"' | tr -d ' '

echo ""
echo "✅ Cron $BATCH finalizado — $(date -u +'%Y-%m-%d %H:%M:%S UTC')"
