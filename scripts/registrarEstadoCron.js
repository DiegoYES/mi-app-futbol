#!/usr/bin/env node
require('dotenv').config({ quiet: true });
const { registrarEstadoCron } = require('../services/cronStatus');
const estado = process.argv[2];
const batch = process.argv[3] || 'desconocido';
if (!['ejecutando', 'exitoso', 'fallido'].includes(estado)) process.exit(2);
registrarEstadoCron(estado, batch);
