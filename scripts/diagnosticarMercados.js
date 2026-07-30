require('dotenv').config();
const mongoose = require('mongoose');
const MercadoCasa = require('../models/MercadoCasa');
const ActualizacionMercados = require('../models/ActualizacionMercados');

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('Falta MONGODB_URI.');
  await mongoose.connect(process.env.MONGODB_URI);
  const ahora = new Date();
  const [ultima, vigentes, categorias, problemas] = await Promise.all([
    ActualizacionMercados.findOne({ proveedor: 'playdoit' }).sort({ iniciada_en: -1 }).lean(),
    MercadoCasa.countDocuments({ proveedor: 'playdoit', expira_en: { $gt: ahora } }),
    MercadoCasa.aggregate([{ $match: { proveedor: 'playdoit', expira_en: { $gt: ahora } } }, { $group: { _id: '$categoria', total: { $sum: 1 } } }, { $sort: { total: -1 } }]),
    MercadoCasa.aggregate([{ $match: { proveedor: 'playdoit', problemas: { $ne: [] } } }, { $unwind: '$problemas' }, { $group: { _id: '$problemas', total: { $sum: 1 } } }, { $sort: { total: -1 } }, { $limit: 20 }])
  ]);
  console.log(JSON.stringify({ ultima_actualizacion: ultima, selecciones_vigentes: vigentes, categorias, problemas_normalizacion: problemas }, null, 2));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
