const test = require('node:test');
const assert = require('node:assert/strict');
const calendarioRouter = require('../routes/calendario');
const { resolverLigaPrincipal } = calendarioRouter;

test('resolverLigaPrincipal: resuelve correctamente la liga doméstica frente a torneos continentales', () => {
  // AEK Athens FC: tiene Conference (848), Europa (3), Champions (2) y Super League 1 (197)
  const aek = {
    api_id: 575,
    nombre: 'AEK Athens FC',
    liga: 197,
    ligas: [848, 3, 2, 197]
  };
  assert.equal(resolverLigaPrincipal(aek), 197);

  // Lask Linz: tiene Europa (3), Conference (848), Bundesliga Austria (218), 2. Liga (219), Champions (2)
  const lask = {
    api_id: 1026,
    nombre: 'Lask Linz',
    liga: 848,
    ligas: [3, 848, 218, 219, 2]
  };
  assert.equal(resolverLigaPrincipal(lask), 218);

  // Real Madrid: tiene La Liga (140), Copa del Rey (143), Champions (2), Club World Cup (15)
  const realMadrid = {
    api_id: 541,
    nombre: 'Real Madrid',
    liga: 15,
    ligas: [140, 143, 2, 15]
  };
  assert.equal(resolverLigaPrincipal(realMadrid), 140);
});

test('resolverLigaPrincipal: prioriza la liga de mayor jerarquía cuando hay varias domésticas', () => {
  // Equipo con primera y segunda división en su historial
  const equipo = {
    api_id: 9999,
    nombre: 'Equipo Ejemplo',
    liga: 141,
    ligas: [141, 140] // 140: La Liga (prioridad 3), 141: La Liga 2 (prioridad 30)
  };
  assert.equal(resolverLigaPrincipal(equipo), 140);
});

test('resolverLigaPrincipal: maneja equipos nulos o sin ligas principales', () => {
  assert.equal(resolverLigaPrincipal(null), null);
  assert.equal(resolverLigaPrincipal({ api_id: 1, ligas: [] }), null);
  // Solo torneos que no son liga_principal
  assert.equal(resolverLigaPrincipal({ api_id: 1, ligas: [2, 3, 848] }), null);
});
