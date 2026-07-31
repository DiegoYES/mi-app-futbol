require('dotenv').config({ quiet: true });
const axios = require('axios');
const https = require('https');
const mongoose = require('mongoose');
const Partido = require('../models/partido');
const config = require('../config/leagues');
const { instalarControlCuotaAxios } = require('../services/apiQuota');

const PROFUNDIDAD = process.argv.includes('--profundidad');

const cliente = axios.create({
  baseURL: 'https://v3.football.api-sports.io',
  httpsAgent: new https.Agent({ family: 4 }),
  timeout: 30000
});
instalarControlCuotaAxios(cliente);

function coberturaTemporada(liga, temporada) {
  return (liga.seasons || []).find(item => Number(item.year) === temporada)?.coverage || null;
}

function tieneEstadisticas(cobertura) {
  return Boolean(cobertura?.fixtures?.statistics_fixtures);
}

async function medirMercado(liga, temporada) {
  const { data } = await cliente.get('/odds', { params: { league: liga.id, season: temporada } });
  const eventos = data.response || [];
  const casas = new Set();
  const mercados = new Map();
  let selecciones = 0;
  for (const evento of eventos) {
    for (const casa of evento.bookmakers || []) {
      casas.add(casa.name);
      for (const mercado of casa.bets || []) {
        const valores = mercado.values?.length || 0;
        selecciones += valores;
        mercados.set(mercado.name, (mercados.get(mercado.name) || 0) + valores);
      }
    }
  }
  return {
    ...liga,
    muestra: {
      eventos: eventos.length,
      pagina_actual: data.paging?.current || 1,
      paginas_disponibles: data.paging?.total || 0,
      casas: casas.size,
      nombres_casas: [...casas].sort(),
      mercados: mercados.size,
      selecciones,
      principales_mercados: [...mercados.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([nombre, total]) => ({ nombre, total }))
    }
  };
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('Falta MONGODB_URI.');
  const temporada = Number(process.env.FOOTBALL_SEASON || new Date().getUTCFullYear());
  await mongoose.connect(process.env.MONGODB_URI);
  try {
    const [{ data }, cargadas] = await Promise.all([
      cliente.get('/leagues'),
      Partido.aggregate([
        { $group: {
          _id: '$liga.id',
          temporadas: { $addToSet: '$liga.temporada' },
          partidos: { $sum: 1 },
          con_estadisticas: { $sum: { $cond: ['$estadisticas_completas', 1, 0] } }
        } }
      ])
    ]);
    const porId = new Map(cargadas.map(item => [Number(item._id), item]));
    const ligas = (data.response || []).map(liga => {
      const id = Number(liga.league?.id);
      const cobertura = coberturaTemporada(liga, temporada);
      const local = porId.get(id);
      return {
        id,
        nombre: liga.league?.name || String(id),
        tipo: liga.league?.type || null,
        pais: liga.country?.name || null,
        temporada,
        cuotas: Boolean(cobertura?.odds),
        estadisticas: tieneEstadisticas(cobertura),
        eventos: Boolean(cobertura?.fixtures?.events),
        alineaciones: Boolean(cobertura?.fixtures?.lineups),
        predicciones: Boolean(cobertura?.predictions),
        configurada: Boolean(config.ligas[id]),
        cargada: Boolean(local),
        temporadas_cargadas: local?.temporadas?.sort((a, b) => b - a) || [],
        partidos_cargados: local?.partidos || 0,
        partidos_con_estadisticas: local?.con_estadisticas || 0
      };
    });
    let candidatas = ligas
      .filter(item => item.cuotas && item.estadisticas && !item.configurada)
      .sort((a, b) => a.pais.localeCompare(b.pais) || a.nombre.localeCompare(b.nombre));
    if (PROFUNDIDAD) {
      const medidas = [];
      for (const liga of candidatas) medidas.push(await medirMercado(liga, temporada));
      candidatas = medidas.sort((a, b) =>
        b.muestra.casas - a.muestra.casas ||
        b.muestra.mercados - a.muestra.mercados ||
        b.muestra.eventos - a.muestra.eventos
      );
    }
    const configuradasSinDatos = Object.keys(config.ligas).map(Number)
      .filter(id => !porId.has(id))
      .map(id => ({ id, ...config.ligas[id] }));
    console.log(JSON.stringify({
      generado_en: new Date().toISOString(),
      temporada,
      profundidad_mercado: PROFUNDIDAD,
      resumen: {
        ligas_api: ligas.length,
        con_cuotas_y_estadisticas: ligas.filter(item => item.cuotas && item.estadisticas).length,
        candidatas_no_configuradas: candidatas.length,
        configuradas_sin_datos: configuradasSinDatos.length
      },
      candidatas,
      configuradas_sin_datos: configuradasSinDatos
    }, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(error => {
  console.error(`❌ No se pudieron descubrir ligas: ${error.message}`);
  process.exitCode = 1;
});
