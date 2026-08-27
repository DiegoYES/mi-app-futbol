const express = require('express');
const EnlaceSocial = require('../models/EnlaceSocial');
const { errorServidor } = require('../middleware/security');
const router = express.Router();

const INICIALES = [
  { nombre: 'Instagram', url: 'https://www.instagram.com/data_fut26/', icono: 'instagram', activo: true, orden: 10 },
  { nombre: 'X', url: 'https://x.com/DataFut26', icono: 'x', activo: true, orden: 20 }
];

async function asegurarIniciales() {
  if (await EnlaceSocial.exists({})) return;
  try { await EnlaceSocial.insertMany(INICIALES, { ordered: false }); } catch (error) {
    if (error.code !== 11000) throw error;
  }
}

router.get('/', async (_req, res) => {
  try {
    await asegurarIniciales();
    const enlaces = await EnlaceSocial.find({ activo: true }).select('nombre url icono orden').sort({ orden: 1, creado_en: 1 }).lean();
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ enlaces });
  } catch (error) { errorServidor(res, error); }
});

module.exports = router;
