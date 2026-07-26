// contarPartidos.js
require('dotenv').config();
const mongoose = require('mongoose');
const Partido = require('./models/partido');  // o Partido, según el nombre real

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const resultados = await Partido.aggregate([
    {
      $group: {
        _id: '$liga.id',
        liga: { $first: '$liga.nombre' },
        total: { $sum: 1 }
      }
    },
    { $sort: { total: -1 } }
  ]);

  console.table(resultados.map(r => ({
    ID_Liga: r._id,
    Liga: r.liga,
    Partidos: r.total
  })));

  await mongoose.disconnect();
}).catch(err => console.error(err));