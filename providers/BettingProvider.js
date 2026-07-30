class BettingProvider {
  constructor(nombre) { this.nombre = nombre; }
  async getEvents() { throw new Error('getEvents() no implementado'); }
  async getMarkets() { throw new Error('getMarkets() no implementado'); }
  async refreshMarkets() { throw new Error('refreshMarkets() no implementado'); }
}

module.exports = BettingProvider;
