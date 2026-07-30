const fs = require('node:fs/promises');
const BettingProvider = require('./BettingProvider');
const { esRespuestaCandidata, extraerSelecciones, sanitizar } = require('../services/betting/playdoitParser');

class PlaydoitProvider extends BettingProvider {
  constructor(opciones = {}) {
    super('playdoit');
    this.baseUrl = opciones.baseUrl || process.env.PLAYDOIT_BASE_URL || 'https://www.playdoit.mx/betting-games';
    this.headless = opciones.headless ?? process.env.PLAYDOIT_HEADLESS !== 'false';
    this.timeout = Number(opciones.timeout || process.env.PLAYDOIT_TIMEOUT_MS || 30000);
    this.espera = Number(opciones.espera || process.env.PLAYDOIT_INSPECTION_MS || (this.headless ? 12000 : 90000));
    this.captureFile = opciones.captureFile || process.env.PLAYDOIT_CAPTURE_FILE || '';
    this.maxRetries = Math.max(0, Number(opciones.maxRetries ?? process.env.PLAYDOIT_MAX_RETRIES ?? 2));
    this.onCapture = opciones.onCapture;
  }

  async desdeArchivo() {
    const contenido = JSON.parse(await fs.readFile(this.captureFile, 'utf8'));
    const respuestas = Array.isArray(contenido) ? contenido : contenido.responses || [];
    return respuestas.flatMap(item => extraerSelecciones(item.body ?? item, item.metadata || {}));
  }

  async capturarUnaVez() {
    const { chromium } = require('playwright');
    const problemas = []; const selecciones = []; const respuestas = []; const pendientes = [];
    let browser;
    try {
      browser = await chromium.launch({ headless: this.headless });
      const context = await browser.newContext({ locale: 'es-MX' });
      const page = await context.newPage();
      page.on('response', response => {
        const pendiente = (async () => {
        const contentType = response.headers()['content-type'] || '';
        if (!esRespuestaCandidata(response.url(), contentType)) return;
        try {
          const body = await response.json();
          const url = new URL(response.url());
          const metadata = { sourceUrl: `${url.origin}${url.pathname}` };
          respuestas.push({ metadata, body: sanitizar(body) });
          selecciones.push(...extraerSelecciones(body, metadata));
        } catch { /* respuestas no JSON se omiten */ }
        })();
        pendientes.push(pendiente);
      });
      await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: this.timeout });
      await page.waitForTimeout(this.espera);
      await Promise.allSettled(pendientes);
      const texto = await page.locator('body').innerText().catch(() => '');
      if (/captcha|verifica que eres humano|checking your browser|access denied/i.test(texto)) problemas.push({ fase: 'navigation', mensaje: 'AUTOMATION_BLOCKED' });
      if (!selecciones.length) problemas.push({ fase: 'parsing', mensaje: 'NO_RECOGNIZED_MARKETS; usa modo visible o markets:inspect' });
      const resultado = { estrategia: 'network_capture', selecciones, respuestas, problemas, urlFinal: page.url() };
      await this.onCapture?.(resultado);
      return resultado;
    } catch (error) {
      const mensaje = /shared libraries|libnspr4/i.test(error.message) ? 'BROWSER_DEPENDENCIES_MISSING' : error.message;
      return { estrategia: 'network_capture', selecciones: [], respuestas: [], problemas: [{ fase: 'browser', mensaje }] };
    } finally { await browser?.close().catch(() => {}); }
  }

  async refreshMarkets() {
    if (this.captureFile) return { estrategia: 'captura_archivo', selecciones: await this.desdeArchivo(), problemas: [] };
    let ultimo;
    for (let intento = 0; intento <= this.maxRetries; intento += 1) {
      ultimo = await this.capturarUnaVez();
      if (ultimo.selecciones.length || ultimo.problemas.some(item => ['AUTOMATION_BLOCKED', 'BROWSER_DEPENDENCIES_MISSING'].includes(item.mensaje))) return ultimo;
      if (intento < this.maxRetries) await new Promise(resolve => setTimeout(resolve, 750 * (2 ** intento)));
    }
    return ultimo;
  }

  async getEvents() { const data = await this.refreshMarkets(); return data.selecciones; }
  async getMarkets() { return this.getEvents(); }
}

module.exports = PlaydoitProvider;
