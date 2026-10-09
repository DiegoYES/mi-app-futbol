const test = require('node:test');
const assert = require('node:assert/strict');
const { probabilidadEmpirica } = require('../../services/betting/probability');
const { cuotaDecimal, probabilidadImplicita, sinVig, valorEsperado } = require('../../services/betting/odds');

test('over y under en línea .5 usan umbrales diferentes por línea', () => {
  const datos = [0, 1, 2, 3, 4];
  assert.equal(probabilidadEmpirica(datos, 'OVER', 1.5, 0, 0).probabilidad, 3 / 5);
  assert.equal(probabilidadEmpirica(datos, 'OVER', 3.5, 0, 0).probabilidad, 1 / 5);
  assert.equal(probabilidadEmpirica(datos, 'UNDER', 2.5, 0, 0).probabilidad, 3 / 5);
});

test('línea entera separa el push de victorias y decisiones', () => {
  const calculo = probabilidadEmpirica([2, 3, 3, 4, 5], 'OVER', 3, 0, 0);
  assert.equal(calculo.victorias, 2); assert.equal(calculo.pushes, 2);
  assert.equal(calculo.probabilidad, 2 / 3); assert.equal(calculo.push, 2 / 5);
});

test('excluye datos ausentes e inválidos sin perder ceros reales', () => {
  const datos = [null, undefined, '', '   ', false, true, [], {}, NaN, Infinity, 'sin dato', 0, '0', ' 4 ', 5];
  const calculo = probabilidadEmpirica(datos, 'UNDER', 2.5, 0, 0);
  assert.equal(calculo.muestra, 4);
  assert.equal(calculo.victorias, 2);
  assert.equal(calculo.probabilidad, 0.5);
  assert.equal(probabilidadEmpirica([null, null, null, null, null], 'UNDER', 2.5), null);
});

test('una línea ausente o inválida no se interpreta como cero', () => {
  for (const linea of [null, undefined, '', ' ', false, [], {}, NaN, Infinity]) {
    assert.equal(probabilidadEmpirica([0, 1, 2], 'OVER', linea), null);
  }
  const calculo = probabilidadEmpirica([0, '0', 1], 'OVER', 0, 0, 0);
  assert.equal(calculo.pushes, 2);
  assert.equal(calculo.probabilidad, 1);
  assert.deepEqual(probabilidadEmpirica([0, 1], 'OVER', '0'), probabilidadEmpirica([0, 1], 'OVER', 0));
});

test('cuotas, implícita, vig y valor esperado', () => {
  assert.equal(cuotaDecimal('+120'), 2.2); assert.equal(cuotaDecimal('-200'), 1.5);
  assert.equal(probabilidadImplicita(2), 0.5); assert.equal(sinVig(1.9, 1.9).a, 0.5);
  assert.ok(Math.abs(valorEsperado(0.62, 1.85) - 0.147) < 1e-12);
});
