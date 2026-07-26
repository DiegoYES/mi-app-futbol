require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios');
const https = require('https');
const Partido = require('../models/partido');
const config = require('../config/leagues');
const { instalarControlCuotaAxios } = require('../services/apiQuota');
instalarControlCuotaAxios(axios);

console.log('🔑 API Key cargada:', process.env.API_FOOTBALL_KEY ? 'Sí' : 'No');
console.log('🗄️ Mongo configurado:', process.env.MONGODB_URI ? 'Sí' : 'No');

const PETICIONES_MAXIMAS = Number.isInteger(Number(process.env.SYNC_MAX_REQUESTS))
  && Number(process.env.SYNC_MAX_REQUESTS) > 0
  ? Number(process.env.SYNC_MAX_REQUESTS)
  : Infinity;
const RETARDO = Number(process.env.SYNC_DELAY_MS) >= 0
  ? Number(process.env.SYNC_DELAY_MS)
  : 500;
const TEMPORADA = Number(process.env.FOOTBALL_SEASON || config.seasonDefault);
const REINTENTAR_HUECOS = /^(1|true|yes|si|sí)$/i.test(String(process.env.SYNC_RETRY_GAPS || ''));
let peticionesRealizadas = 0;
let detener = false;

const httpsAgent = new https.Agent({ family: 4 });

function esperar(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function obtenerValor(stats, tipo, valorNulo = 0) {
  const stat = stats?.find(s => s.type === tipo);
  const val = stat?.value;
  if (val === null || val === undefined || val === '') return valorNulo;
  // Si es string con '%', lo limpiamos (para posesión)
  if (typeof val === 'string') {
    const num = parseFloat(val.replace('%', '').trim());
    return isNaN(num) ? valorNulo : num;
  }
  const num = Number(val);
  return Number.isFinite(num) ? num : valorNulo;
}

function obtenerRango(minuto) {
  const limiteSuperior = Math.ceil(minuto / 15) * 15;
  const limiteInferior = limiteSuperior - 14;
  return `${Math.max(0, limiteInferior)}-${limiteSuperior}`;
}

async function completarTiemposYEventos(leagueId) {
  // PARTIDOS FALTANTES: la nueva condición usa 'goles' en estadisticas_1t para no repetir los ya hechos
  const filtroPendientes = {
    'liga.id': leagueId,
    'liga.temporada': TEMPORADA,
    estado: { $in: ['FT', 'AET', 'PEN'] },
    estadisticas_completas: true,
    tiempos_completos: { $ne: true }
  };
  if (!REINTENTAR_HUECOS) {
    filtroPendientes.$or = [
      { tiempos_consultados_en: null },
      { tiempos_consultados_en: { $exists: false } }
    ];
  }
  const partidosFaltantes = await Partido.find(filtroPendientes).lean();

  console.log(`   ⚽ Liga ${leagueId}: ${partidosFaltantes.length} partidos sin datos de tiempos/eventos.`);

  for (let p of partidosFaltantes) {
    const llamadasNecesarias = p.eventos_completos ? 1 : 2;
    if (detener || peticionesRealizadas + llamadasNecesarias > PETICIONES_MAXIMAS) break;

    try {
      // Una sola consulta devuelve partido completo, 1T y 2T.
      await esperar(RETARDO);
      const { data: dataStats } = await axios.get('https://v3.football.api-sports.io/fixtures/statistics', {
        params: { fixture: p.api_id, half: true },
        httpsAgent, timeout: 10000
      });
      peticionesRealizadas++;

      const respuestaStats = dataStats.response || [];
      const data1 = respuestaStats.map(item => ({ team: item.team, statistics: item.statistics_1h || [] }));
      const data2 = respuestaStats.map(item => ({ team: item.team, statistics: item.statistics_2h || [] }));
      const tieneAmbosTiempos = data1.length === 2
        && data2.length === 2
        && data1.every(item => item.statistics.length)
        && data2.every(item => item.statistics.length);

      if (!tieneAmbosTiempos) {
        await Partido.updateOne({ api_id: p.api_id }, { $set: {
          tiempos_consultados_en: new Date(),
          tiempos_disponibles: false
        } });
        console.warn(`   ⚠️ Partido ${p.api_id}: el proveedor no entregó ambos tiempos.`);
        continue;
      }

      let dataEvents = { response: [] };
      if (!p.eventos_completos) {
        await esperar(RETARDO);
        ({ data: dataEvents } = await axios.get('https://v3.football.api-sports.io/fixtures/events', {
          params: { fixture: p.api_id },
          httpsAgent, timeout: 10000
        }));
        peticionesRealizadas++;
      }

      const update = {};

      // Rellenar 1T y 2T (ahora también posesión)
      function rellenarHalf(halfKey, statsArray) {
        if (!statsArray) return;
        const homeStats = statsArray.find(s => s.team.id === p.equipo_local.id);
        const awayStats = statsArray.find(s => s.team.id === p.equipo_visitante.id);

        if (homeStats) {
          const s = homeStats.statistics;
          update[`equipo_local.${halfKey}.goles`] = halfKey === 'estadisticas_1t'
            ? (p.equipo_local.goles_primer_tiempo || 0)
            : Math.max(0, (p.equipo_local.goles || 0) - (p.equipo_local.goles_primer_tiempo || 0));
          update[`equipo_local.${halfKey}.tiros_total`] = obtenerValor(s, 'Total Shots');
          update[`equipo_local.${halfKey}.tiros_puerta`] = obtenerValor(s, 'Shots on Goal');
          update[`equipo_local.${halfKey}.corners`] = obtenerValor(s, 'Corner Kicks');
          update[`equipo_local.${halfKey}.faltas`] = obtenerValor(s, 'Fouls', null);
          update[`equipo_local.${halfKey}.tarjetas_amarillas`] = obtenerValor(s, 'Yellow Cards');
          update[`equipo_local.${halfKey}.tarjetas_rojas`] = obtenerValor(s, 'Red Cards');
          update[`equipo_local.${halfKey}.offsides`] = obtenerValor(s, 'Offsides');
          // Posesión (solo la guardamos en el objeto principal, no en el half)
          if (!update['equipo_local.posesion']) {
            update['equipo_local.posesion'] = obtenerValor(s, 'Ball Possession');
          }
        }
        if (awayStats) {
          const s = awayStats.statistics;
          update[`equipo_visitante.${halfKey}.goles`] = halfKey === 'estadisticas_1t'
            ? (p.equipo_visitante.goles_primer_tiempo || 0)
            : Math.max(0, (p.equipo_visitante.goles || 0) - (p.equipo_visitante.goles_primer_tiempo || 0));
          update[`equipo_visitante.${halfKey}.tiros_total`] = obtenerValor(s, 'Total Shots');
          update[`equipo_visitante.${halfKey}.tiros_puerta`] = obtenerValor(s, 'Shots on Goal');
          update[`equipo_visitante.${halfKey}.corners`] = obtenerValor(s, 'Corner Kicks');
          update[`equipo_visitante.${halfKey}.faltas`] = obtenerValor(s, 'Fouls', null);
          update[`equipo_visitante.${halfKey}.tarjetas_amarillas`] = obtenerValor(s, 'Yellow Cards');
          update[`equipo_visitante.${halfKey}.tarjetas_rojas`] = obtenerValor(s, 'Red Cards');
          update[`equipo_visitante.${halfKey}.offsides`] = obtenerValor(s, 'Offsides');
          if (!update['equipo_visitante.posesion']) {
            update['equipo_visitante.posesion'] = obtenerValor(s, 'Ball Possession');
          }
        }
      }

      rellenarHalf('estadisticas_1t', data1);
      rellenarHalf('estadisticas_2t', data2);

      // Rellenar eventos y rangos únicamente si aún faltaban; nunca borrar
      // eventos existentes por haber omitido deliberadamente esa consulta.
      if (!p.eventos_completos) {
        const eventos = dataEvents.response || [];
        const eventosLocal = [];
        const eventosVisitante = [];
        const statsLocal = new Map();
        const statsVisitante = new Map();

        for (const evento of eventos) {
        const minuto = evento.time?.elapsed || 0;
        const tipo = (() => {
          if (evento.type === 'goal') return 'Gol';
          if (evento.type === 'card') return evento.detail?.toLowerCase().includes('yellow') ? 'Tarjeta Amarilla' : 'Tarjeta Roja';
          if (evento.type === 'subst') return 'Sustitución';
          if (evento.type === 'var') return 'VAR';
          if (evento.type === 'offside') return 'Fuera de juego';
          if (evento.type === 'corner') return 'Córner';
          return evento.type;
        })();
        const detalle = evento.detail || '';
        const eventoObj = { minuto, tipo_evento: tipo, detalle };
        const rango = obtenerRango(minuto);

        const esLocal = evento.team?.id === p.equipo_local.id;
        const esVisitante = evento.team?.id === p.equipo_visitante.id;

        if (esLocal) {
          eventosLocal.push(eventoObj);
          if (!statsLocal.has(rango)) {
            statsLocal.set(rango, { goles: 0, amarillas: 0, rojas: 0, corners: 0, tiros_a_puerta: 0, faltas: 0, fueras_de_juego: 0 });
          }
          const s = statsLocal.get(rango);
          if (tipo === 'Gol') s.goles++;
          else if (tipo === 'Tarjeta Amarilla') s.amarillas++;
          else if (tipo === 'Tarjeta Roja') s.rojas++;
          else if (tipo === 'Córner') s.corners++;
        } else if (esVisitante) {
          eventosVisitante.push(eventoObj);
          if (!statsVisitante.has(rango)) {
            statsVisitante.set(rango, { goles: 0, amarillas: 0, rojas: 0, corners: 0, tiros_a_puerta: 0, faltas: 0, fueras_de_juego: 0 });
          }
          const s = statsVisitante.get(rango);
          if (tipo === 'Gol') s.goles++;
          else if (tipo === 'Tarjeta Amarilla') s.amarillas++;
          else if (tipo === 'Tarjeta Roja') s.rojas++;
          else if (tipo === 'Córner') s.corners++;
        }
        }

        update['equipo_local.eventos'] = eventosLocal;
        update['equipo_local.estadisticas_por_rango'] = Array.from(statsLocal.entries()).map(([rango, vals]) => ({ rango_minutos: rango, ...vals }));
        update['equipo_visitante.eventos'] = eventosVisitante;
        update['equipo_visitante.estadisticas_por_rango'] = Array.from(statsVisitante.entries()).map(([rango, vals]) => ({ rango_minutos: rango, ...vals }));
        update.eventos_completos = true;
      }
      update.tiempos_completos = true;
      update.tiempos_disponibles = true;
      update.tiempos_consultados_en = new Date();

      await Partido.updateOne({ api_id: p.api_id }, { $set: update });
      console.log(`   ✅ Partido ${p.api_id} actualizado (1T/2T + eventos + posesión).`);

    } catch (err) {
      if (err.code === 'API_FOOTBALL_DAILY_QUOTA_EXHAUSTED') {
        console.error('   ⚠️ Cupo diario seguro agotado. Deteniendo.');
        detener = true;
        break;
      } else if (err.response?.status === 429) {
        console.error('   ⚠️ Límite de peticiones (HTTP 429). Deteniendo.');
        detener = true;
        break;
      } else {
        console.error(`   ❌ Error en partido ${p.api_id}: ${err.message}`);
      }
    }
  }
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Conectado a MongoDB\n');

  const ligas = (process.env.SYNC_LEAGUES || '39').split(',').map(Number).filter(Number.isInteger);
  for (let leagueId of ligas) {
    if (detener || peticionesRealizadas >= PETICIONES_MAXIMAS) break;
    console.log(`📡 Completando tiempos + eventos + posesión en ${config.ligas[leagueId]?.nombre || leagueId}...`);
    await completarTiemposYEventos(leagueId);
    if (!detener) {
      console.log('⏳ Pausa de 5 segundos...');
      await esperar(5000);
    }
  }

  console.log('\n🎉 Completado (o detenido por límite).');
  await mongoose.disconnect();
}

main().catch(console.error);
