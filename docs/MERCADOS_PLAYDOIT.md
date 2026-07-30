# Mercados de Playdoit

## Qué se integró

La aplicación conserva su stack actual: Express, MongoDB/Mongoose y frontend HTML/JavaScript. Se añadió un proveedor desacoplado (`BettingProvider` / `PlaydoitProvider`), captura de respuestas JSON que recibe un navegador Playwright, normalización, historial con expiración, matching seguro, cálculo específico por línea, cuotas/EV, panel administrativo, filtros en la ficha del partido y pruebas sin acceso al sitio real.

Las predicciones originales se generan en `services/pickEngine.js`. El motor usa únicamente partidos anteriores: el equipo local aporta sus partidos previos como local y el visitante sus partidos previos como visitante. Para una línea real que no existe en el catálogo se recalcula una frecuencia empírica con suavizado beta desde esos conteos; nunca se copia el porcentaje de otra línea. Las líneas enteras separan victorias, derrotas y push. No se eligió Poisson porque el proyecto no tiene todavía una validación de dispersión que justifique esa distribución.

No se realizan apuestas, no se presionan botones de apuesta, no se leen contraseñas y no se intenta eludir captcha, autenticación o protecciones antibot.

## Instalación

```bash
npm install
npx playwright install chromium
```

En Linux, Playwright puede requerir bibliotecas del sistema:

```bash
sudo npx playwright install-deps chromium
```

Ese último comando necesita permisos del sistema. En el entorno donde se desarrolló esta integración Chromium no pudo arrancar porque faltaba `libnspr4.so`; por eso no se afirma que se haya obtenido una estructura real de Playdoit.

Configura `.env` a partir de `.env.example`. No hay API key de Playdoit ni credenciales que guardar.

## Inspección pública y modo visible asistido

Inspección automática:

```bash
npm run markets:inspect
```

Modo visible, útil si el usuario debe iniciar sesión manualmente o abrir partidos durante la ventana de captura:

```bash
npm run markets:inspect:headed
```

El usuario interactúa directamente con el navegador. El proceso escucha respuestas JSON de la sesión normal, elimina campos con nombres sensibles y escribe una captura en `var/playdoit/`, carpeta ignorada por Git. No registra cabeceras, cookies ni contraseñas. Si aparece un captcha o un bloqueo, el proceso se detiene con `AUTOMATION_BLOCKED`; no intenta evadirlo.

No se implementaron endpoints directos ni selectores DOM supuestos: el sitio público devolvió una pantalla que requiere JavaScript y, en este entorno, Chromium no llegó a ejecutarse por la dependencia del sistema indicada arriba. Una vez obtenida una captura real, el parser genérico debe validarse contra su estructura antes de afirmar cobertura. El fixture de pruebas está rotulado expresamente como simulado.

## Actualizar y diagnosticar

Con navegador en segundo plano:

```bash
npm run markets:refresh
```

Con navegador visible:

```bash
npm run markets:refresh:headed
```

También existe `POST /api/admin/mercados/actualizar`, protegido por la autenticación y rol administrativo ya existentes. El panel `/admin.html` muestra última ejecución, eventos, selecciones y problemas. Para diagnóstico local:

```bash
npm run markets:debug
```

La app nunca abre Playdoit cuando un usuario consulta un partido. Sólo lee el último lote vigente en MongoDB. `MARKET_CACHE_TTL_MINUTES` controla la vigencia y Mongo conserva el historial siete días adicionales para depurar cambios de línea.

Si se cuenta con una captura sanitizada válida, puede reprocesarse sin navegación:

```bash
PLAYDOIT_CAPTURE_FILE=var/playdoit/captura-valida.json npm run markets:refresh
```

## Interfaz y estados

La ficha de partido muestra por defecto `AVAILABLE_WITH_VALUE`. Los filtros permiten ver disponibles, sin valor y descartados. Cada selección válida enseña cuota, probabilidad del modelo, probabilidad implícita o sin vig, edge, EV y fecha de actualización.

- `AVAILABLE_WITH_VALUE`: abierta, con cuota, modelo suficiente y umbrales de edge/EV superados.
- `AVAILABLE_NO_VALUE`: existe pero no supera los umbrales.
- `MODEL_PROBABILITY_NOT_AVAILABLE`: muestra insuficiente o categoría no calculable.
- `PLAYER_NOT_MATCHED` / `AMBIGUOUS_MATCH`: el nombre no se resolvió de forma segura.
- `EVENT_NOT_MATCHED`: local, visitante y fecha no coincidieron.
- `ODDS_NOT_AVAILABLE`, `MARKET_SUSPENDED`, `MARKET_NOT_FOUND`: descarte por disponibilidad de la casa.
- `CACHE_EMPTY_OR_EXPIRED`: no hay un lote vigente.

`MIN_EDGE`, `MIN_EXPECTED_VALUE` y `MODEL_MIN_SAMPLE` son configurables. Si hay ambos lados de la misma línea se muestra probabilidad sin vig; de lo contrario se usa la implícita simple.

## Alias y otro proveedor

Los alias manuales están en `config/betting-aliases.json`, separados en `equipos`, `jugadores`, `ligas` y `mercados`. No agregues dos personas distintas al mismo alias. Una coincidencia cercana con dos candidatos se marca ambigua y no se publica.

Para otra casa, crea una clase que extienda `providers/BettingProvider.js` y devuelva selecciones con el formato normalizado usado por `MercadoCasa`. Los servicios de caché, matching, probabilidad y EV no dependen directamente de Playdoit.

## Pruebas y ejecución completa

```bash
npm run test:markets
npm test
npm run check
npm start
```

Las pruebas del scraper consumen `test/fixtures/playdoit-simulated.json`; no dependen de Playdoit ni presentan esos datos como reales.

## Limitaciones conocidas

- Falta validar el parser con una respuesta real de Playdoit cuando Chromium pueda arrancar en el equipo.
- Si Playdoit cambia su estructura JSON, el parser y los alias pueden necesitar ajuste.
- Si los mercados sólo existen en DOM, primero debe inspeccionarse el DOM real para crear localizadores robustos; deliberadamente no se inventaron selectores.
- Los props de jugador requieren datos históricos de `JugadorPartido` y coincidencia inequívoca del nombre.
- La actualización programada no se activa sola. Puede ejecutarse con cron local usando `npm run markets:refresh`; `MARKET_REFRESH_ENABLED` queda desactivado por defecto.
