// verPartido.js
require('dotenv').config();
const mongoose = require('mongoose');
const Partido = require('./models/partido');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const p = await Partido.findOne({ 'liga.id': 39, estado: 'FT' }).lean();
  console.log(JSON.stringify(p, null, 2));
  await mongoose.disconnect();
});