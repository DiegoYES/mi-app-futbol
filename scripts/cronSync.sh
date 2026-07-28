#!/usr/bin/env bash
# =============================================================================
# cronSync.sh — Sincronización automática programada
#
# Uso desde crontab:
#   10 0  * * *  /home/diego/mi-app-futbol/scripts/cronSync.sh batch1 >> /tmp/futbol-batch1.log 2>&1
#   0  8  * * *  /home/diego/mi-app-futbol/scripts/cronSync.sh batch2 >> /tmp/futbol-batch2.log 2>&1
#   0  16 * * *  /home/diego/mi-app-futbol/scripts/cronSync.sh batch3 >> /tmp/futbol-batch3.log 2>&1
#
# Horario (UTC → CST -6h):
#   batch1: 00:10 UTC = 18:10 CST  → primer batch, cuota recién renovada (reset es a las 18:00 CST)
#   batch2: 08:00 UTC = 02:00 CST  → partidos americanos ya terminaron
#   batch3: 16:00 UTC = 10:00 CST  → partidos europeos matutinos terminaron, carga histórica
# =============================================================================
set -u
BATCH="${1:-batch1}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"

# Cargar entorno si no viene de systemd/PM2
if [ -f "$APP_DIR/.env" ]; then
  set -a; source "$APP_DIR/.env"; set +a
fi

# Con plan PRO (450 req/min) podemos usar 900ms entre peticiones.
# Con plan gratuito sube a 7000ms para no exceder el límite por minuto.
export SYNC_DELAY_MS="${SYNC_DELAY_MS:-900}"

# Reservar ~2400 req por batch (3 batches × 2400 = 7200 < 7450 disponibles con margen)
export SYNC_MAX_REQUESTS="${SYNC_MAX_REQUESTS:-2400}"

TS="$(date -u +'%Y-%m-%d %H:%M:%S UTC')"
echo ""
echo "========================================================="
echo "  CRON $BATCH — $TS"
echo "========================================================="

# ------------------------------------------------------------------
# BATCH 1 (06:10 UTC): Primer batch del día
#   - Completar stats de partidos finalizados sin estadísticas
#   - Sincronizar fixtures futuros de ligas top (el calendario puede cambiar)
#   - Cargar segundas divisiones pendientes si quedan peticiones
# ------------------------------------------------------------------
if [ "$BATCH" = "batch1" ]; then
  echo ""
  echo "▸ Completar estadísticas pendientes (todas las ligas)"
  SYNC_LEAGUES=2,39,140,135,78,61,71,253,262,40,141,136,62,79 \
    node scripts/completarEstadisticas.js

  echo ""
  echo "▸ Sincronizar fixtures futuros — ligas top"
  SYNC_LEAGUES=39,140,135,78,61,2,3 \
    node scripts/syncDatabase.js

  echo ""
  echo "▸ Calendario del día (partidos del día de hoy)"
  node scripts/syncCalendario.js

# ------------------------------------------------------------------
# BATCH 2 (22:00 UTC): Partidos europeos ya finalizados
#   - Completar stats de lo que acabó hoy en Europa
#   - Sincronizar ligas americanas (sus fixtures del día se confirman aquí)
# ------------------------------------------------------------------
elif [ "$BATCH" = "batch2" ]; then
  echo ""
  echo "▸ Completar estadísticas — ligas europeas de hoy"
  SYNC_LEAGUES=39,140,135,78,61,40,141,136,62,79,2,3,848,45,143 \
    node scripts/completarEstadisticas.js

  echo ""
  echo "▸ Sincronizar fixtures — ligas americanas y Brasileirão (temporadas 2025 y 2026)"
  FOOTBALL_SEASON=2026 SYNC_LEAGUES=71,262,253,263 \
    node scripts/syncDatabase.js
  FOOTBALL_SEASON=2025 SYNC_LEAGUES=253,263 \
    node scripts/syncDatabase.js

# ------------------------------------------------------------------
# BATCH 3 (03:00 UTC): Partidos americanos finalizados
#   - Completar stats de partidos americanos que acabaron esta noche
#   - Segundas divisiones pendientes de carga histórica
#   - Carga masiva progresiva (si queda cuota disponible)
# ------------------------------------------------------------------
elif [ "$BATCH" = "batch3" ]; then
  echo ""
  echo "▸ Completar estadísticas — ligas americanas (2025+2026)"
  FOOTBALL_SEASON=2026 SYNC_LEAGUES=71,262 \
    node scripts/completarEstadisticas.js
  FOOTBALL_SEASON=2025 SYNC_LEAGUES=253,263 \
    node scripts/completarEstadisticas.js

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
  echo "❌ Batch desconocido: $BATCH (usa batch1, batch2 o batch3)"
  exit 1
fi

echo ""
echo "▸ Estado final de cuota:"
node scripts/estadoCuota.js 2>/dev/null | grep -E '"usadas"|"restantes"|"agotada"' | tr -d ' '

echo ""
echo "✅ Cron $BATCH finalizado — $(date -u +'%Y-%m-%d %H:%M:%S UTC')"
