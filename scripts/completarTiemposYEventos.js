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
const RETARDO = 7000;             // 7 s entre peticiones
let peticionesRealizadas = 0;
let detener = false;

const httpsAgent = new https.Agent({ family: 4 });

function esperar(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function obtenerValor(stats, tipo) {
  const stat = stats?.find(s => s.type === tipo);
  const val = stat?.value;
  if (val === null || val === undefined) return 0;
  // Si es string con '%', lo limpiamos (para posesión)
  if (typeof val === 'string') {
    const num = parseFloat(val.replace('%', '').trim());
    return isNaN(num) ? 0 : num;
  }
  return parseInt(val) || 0;
}

function obtenerRango(minuto) {
  const limiteSuperior = Math.ceil(minuto / 15) * 15;
  const limiteInferior = limiteSuperior - 14;
  return `${Math.max(0, limiteInferior)}-${limiteSuperior}`;
}

async function completarTiemposYEventos(leagueId) {
  // PARTIDOS FALTANTES: la nueva condición usa 'goles' en estadisticas_1t para no repetir los ya hechos
  const partidosFaltantes = await Partido.find({
    'liga.id': leagueId,
    'liga.temporada': Number(config.seasonDefault),
    estado: 'FT',
    estadisticas_completas: true,
    tiempos_completos: { $ne: true }
  }).lean();

  console.log(`   ⚽ Liga ${leagueId}: ${partidosFaltantes.length} partidos sin datos de tiempos/eventos.`);

  for (let p of partidosFaltantes) {
    if (detener || peticionesRealizadas >= PETICIONES_MAXIMAS) break;

    try {
      // 1T
      await esperar(RETARDO);
      const { data: data1 } = await axios.get('https://v3.football.api-sports.io/fixtures/statistics', {
        params: { fixture: p.api_id, half: '1st' },
        httpsAgent, timeout: 10000
      });
      peticionesRealizadas++;

      // 2T
      await esperar(RETARDO);
      const { data: data2 } = await axios.get('https://v3.football.api-sports.io/fixtures/statistics', {
        params: { fixture: p.api_id, half: '2nd' },
        httpsAgent, timeout: 10000
      });
      peticionesRealizadas++;

      // Events
      await esperar(RETARDO);
      const { data: dataEvents } = await axios.get('https://v3.football.api-sports.io/fixtures/events', {
        params: { fixture: p.api_id },
        httpsAgent, timeout: 10000
      });
      peticionesRealizadas++;

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
          update[`equipo_local.${halfKey}.faltas`] = obtenerValor(s, 'Fouls');
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
          update[`equipo_visitante.${halfKey}.faltas`] = obtenerValor(s, 'Fouls');
          update[`equipo_visitante.${halfKey}.tarjetas_amarillas`] = obtenerValor(s, 'Yellow Cards');
          update[`equipo_visitante.${halfKey}.tarjetas_rojas`] = obtenerValor(s, 'Red Cards');
          update[`equipo_visitante.${halfKey}.offsides`] = obtenerValor(s, 'Offsides');
          if (!update['equipo_visitante.posesion']) {
            update['equipo_visitante.posesion'] = obtenerValor(s, 'Ball Possession');
          }
        }
      }

      rellenarHalf('estadisticas_1t', data1.response);
      rellenarHalf('estadisticas_2t', data2.response);

      // Rellenar eventos y rangos
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
      update.tiempos_completos = true;
      update.eventos_completos = true;

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
