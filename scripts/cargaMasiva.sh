#!/usr/bin/env bash
# Orquestador de carga masiva. Corre en secuencia y se detiene solo cuando
# la cuota diaria se agota (cada script respeta el contador global en MongoDB).
set -u
cd "$(dirname "$0")/.."

export SYNC_DELAY_MS="${SYNC_DELAY_MS:-900}"

log() { echo -e "\n========== $1 =========="; }

# 1) Rellenar estadísticas de lo YA descargado (máximo valor por petición)
log "1/7 Completar estadísticas Champions (2) y Championship (40) existentes"
SYNC_LEAGUES=2,40 node scripts/completarEstadisticas.js

# 2) Segundas divisiones temporada 2025 (la más reciente cerrada)
log "2/7 Segundas divisiones 2025 (Championship, La Liga 2, Serie B, Ligue 2, 2.Bundesliga)"
FOOTBALL_SEASON=2025 SYNC_LEAGUES=40,141,136,62,79 node scripts/syncDatabase.js

# 3) Segundas divisiones temporada 2024
log "3/7 Segundas divisiones 2024"
FOOTBALL_SEASON=2024 SYNC_LEAGUES=40,141,136,62,79 node scripts/syncDatabase.js

# 4) Segundas divisiones temporada 2023
log "4/7 Segundas divisiones 2023"
FOOTBALL_SEASON=2023 SYNC_LEAGUES=40,141,136,62,79 node scripts/syncDatabase.js

# 5) Competiciones europeas secundarias 2024
log "5/7 Europa League y Conference League 2024"
FOOTBALL_SEASON=2024 SYNC_LEAGUES=3,848 node scripts/syncDatabase.js

# 6) Segundas divisiones temporada 2022
log "6/7 Segundas divisiones 2022"
FOOTBALL_SEASON=2022 SYNC_LEAGUES=40,141,136,62,79 node scripts/syncDatabase.js

# 7) Copas nacionales 2024
log "7/7 FA Cup y Copa del Rey 2024"
FOOTBALL_SEASON=2024 SYNC_LEAGUES=45,143 node scripts/syncDatabase.js

log "CARGA MASIVA FINALIZADA"
node scripts/estadoCuota.js 2>/dev/null | grep -v injected
