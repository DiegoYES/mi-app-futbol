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
  : 7000;
let peticionesRealizadas = 0;
let detener = false;

const httpsAgent = new https.Agent({ family: 4 });

function esperar(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function mapearTipoEvento(eventoApi) {
  const mapa = {
    'goal': 'Gol',
    'card': 'Tarjeta',
    'subst': 'Sustitución',
    'var': 'VAR',
    'offside': 'Fuera de juego',
    'corner': 'Córner'
  };
  return mapa[eventoApi.type] || eventoApi.type;
}

function obtenerRango(minuto) {
  const limiteSuperior = Math.ceil(minuto / 15) * 15;
  const limiteInferior = limiteSuperior - 14;
  return `${Math.max(0, limiteInferior)}-${limiteSuperior}`;
}

async function guardarEventosPartido(partidoBD) {
  if (detener || peticionesRealizadas >= PETICIONES_MAXIMAS) return;

  try {
    await esperar(RETARDO);
    const { data } = await axios.get('https://v3.football.api-sports.io/fixtures/events', {
      params: { fixture: partidoBD.api_id },
      httpsAgent,
      timeout: 10000
    });
    peticionesRealizadas++;

    if (!data.response || data.response.length === 0) return;

    const eventosLocal = [];
    const eventosVisitante = [];
    const statsLocal = new Map();
    const statsVisitante = new Map();

    for (const evento of data.response) {
      const minuto = evento.time?.elapsed || 0;
      const tipo = mapearTipoEvento(evento);
      let detalle = '';
      if (tipo === 'Tarjeta') {
        detalle = evento.detail?.toLowerCase().includes('yellow') ? 'Amarilla' : 'Roja';
      } else if (tipo === 'Gol') {
        detalle = evento.detail || '';
      }

      const eventoObj = { minuto, tipo_evento: tipo, detalle };
      const rango = obtenerRango(minuto);

      const esLocal = evento.team?.id === partidoBD.equipo_local.id;
      const esVisitante = evento.team?.id === partidoBD.equipo_visitante.id;

      if (esLocal) {
        eventosLocal.push(eventoObj);
        if (!statsLocal.has(rango)) {
          statsLocal.set(rango, { goles: 0, amarillas: 0, rojas: 0, corners: 0, tiros_a_puerta: 0, faltas: 0, fueras_de_juego: 0 });
        }
        const stat = statsLocal.get(rango);
        if (tipo === 'Gol') stat.goles++;
        else if (tipo === 'Tarjeta') {
          if (detalle === 'Amarilla') stat.amarillas++;
          else stat.rojas++;
        } else if (tipo === 'Córner') stat.corners++;
      } else if (esVisitante) {
        eventosVisitante.push(eventoObj);
        if (!statsVisitante.has(rango)) {
          statsVisitante.set(rango, { goles: 0, amarillas: 0, rojas: 0, corners: 0, tiros_a_puerta: 0, faltas: 0, fueras_de_juego: 0 });
        }
        const stat = statsVisitante.get(rango);
        if (tipo === 'Gol') stat.goles++;
        else if (tipo === 'Tarjeta') {
          if (detalle === 'Amarilla') stat.amarillas++;
          else stat.rojas++;
        } else if (tipo === 'Córner') stat.corners++;
      }
    }

    // Convertir los Map a arrays de objetos
    const estadisticasLocal = Array.from(statsLocal.entries()).map(([rango, vals]) => ({ rango_minutos: rango, ...vals }));
    const estadisticasVisitante = Array.from(statsVisitante.entries()).map(([rango, vals]) => ({ rango_minutos: rango, ...vals }));

    await Partido.updateOne(
      { api_id: partidoBD.api_id },
      {
        $set: {
          'equipo_local.eventos': eventosLocal,
          'equipo_local.estadisticas_por_rango': estadisticasLocal,
          'equipo_visitante.eventos': eventosVisitante,
          'equipo_visitante.estadisticas_por_rango': estadisticasVisitante,
          eventos_completos: true
        }
      }
    );

    console.log(`   ✅ Eventos guardados para partido ${partidoBD.api_id}`);
  } catch (err) {
    if (err.code === 'API_FOOTBALL_DAILY_QUOTA_EXHAUSTED') {
      console.error('   ⚠️ Cupo diario seguro agotado. Deteniendo.');
      detener = true;
    } else if (err.response?.status === 429) {
      console.error('   ⚠️ Límite de peticiones (HTTP 429). Deteniendo.');
      detener = true;
    } else {
      console.error(`   ❌ Error guardando eventos partido ${partidoBD.api_id}: ${err.message}`);
    }
  }
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Conectado a MongoDB\n');

  const ligas = (process.env.SYNC_LEAGUES || '39').split(',').map(Number).filter(Number.isInteger);
  const partidos = await Partido.find({
    'liga.id': { $in: ligas },
    'liga.temporada': Number(config.seasonDefault),
    estado: 'FT',
    estadisticas_completas: true,
    eventos_completos: { $ne: true }
  }).lean();

  console.log(`⚽ Procesando ${partidos.length} partidos de ligas ${ligas.join(', ')} (eventos)...`);

  for (const p of partidos) {
    if (detener || peticionesRealizadas >= PETICIONES_MAXIMAS) break;
    await guardarEventosPartido(p);
  }

  console.log('\n🎉 Eventos guardados (o detenido por límite).');
  await mongoose.disconnect();
}

main().catch(console.error);
