# Ruta de producto

## Estado comprobado

- Temporada almacenada: **2024**.
- Premier League (39): 380/380 partidos finalizados; faltan detalles avanzados.
- Champions League (2): 269 partidos finalizados; 115 con estadísticas avanzadas.
- Championship (40): solo 40 partidos almacenados; no representa la campaña completa.
- El modelo actual es una frecuencia histórica suavizada, no una probabilidad calibrada.

## Fase 0 — piloto Premier League

1. Descargar una muestra de 20 partidos mediante `fixtures?ids=...`.
2. Auditar estadísticas, eventos, alineaciones y jugadores guardados.
3. Completar los 380 partidos en aproximadamente 19 llamadas totales.
4. Probar todos los mercados y las explicaciones con valores partido por partido.
5. No descargar aún estadísticas 1T/2T: costarían hasta 760 llamadas.

## Fase 1 — confianza y validación

- Backtesting cronológico por mercado: nunca usar un partido futuro para explicar uno pasado.
- Rendimiento por liga, categoría, rango de probabilidad y tamaño de muestra.
- Calibración: comprobar si los picks mostrados como 70% aciertan cerca de 70%.
- Ocultar o advertir mercados con cobertura insuficiente.
- Historial de cambios del modelo para que un pick guardado sea reproducible.

## Fase 2 — valor de apuesta

- Capturar cuota decimal del usuario o de una fuente autorizada.
- Convertirla en probabilidad implícita y comparar contra la estimación del modelo.
- Mostrar `edge`, cuota mínima aceptable y expectativa teórica.
- No multiplicar automáticamente picks correlacionados en una boleta; goles, tiros y córners
  del mismo partido suelen depender entre sí.

## Fase 3 — páginas de análisis

- Equipo: forma, local/visitante, distribuciones y tendencias por rival.
- Jugador: minutos, titularidad, tiros, tiros a puerta, goles, faltas y tarjetas.
- Árbitro: tarjetas/faltas por partido, dispersión y equipos dirigidos.
- Partido: lesiones, alineaciones probables y cambios de contexto antes del inicio.

## Fase 4 — experiencia diaria

- Portada "Partidos de hoy" con filtros de cobertura y confianza.
- Constructor de boleta desde calendario y partido, no solo desde el comparador.
- Alertas de cambio de alineación o de caída de confianza.
- Seguimiento de cuota tomada contra cuota de cierre (CLV).

## Fase 5 — producción y plan pagado

- Sincronización incremental de temporada vigente y calendario futuro.
- Cola de trabajos, reintentos con backoff y panel de salud de datos.
- HTTPS, cookies seguras, CSRF, recuperación de contraseña, verificación de correo y backups.
- Métricas de uso, límites por usuario y política clara de juego responsable.

## Próximas decisiones sugeridas

1. **Recomendada:** terminar Premier 2024 y construir backtesting/calibración.
2. Después: capturar cuotas manuales para identificar valor real, sin gastar API de odds.
3. Luego: página de jugadores usando los rendimientos que ya guardará la carga por lotes.

---

# Ruta de mejora — Frontend y datos (revisión 26 jul 2026)

## A. Estado real de la base de datos

### Ligas con cobertura completa (2022–2026)
| Liga | ID | Temporadas | Estado |
|---|---|---|---|
| Premier League | 39 | 2022–2026 | ✅ 2022–2025 con estadísticas; 2026 en curso |
| La Liga | 140 | 2022–2026 | ✅ 2022–2025 completas |
| Serie A | 135 | 2022–2026 | ✅ 2022–2025 completas |
| Bundesliga | 78 | 2022–2026 | ✅ 2022–2025 completas |
| Ligue 1 | 61 | 2022–2026 | ✅ 2022–2025 completas |
| Liga MX | 262 | 2022–2026 | ✅ 2022–2025 completas |
| MLS | 253 | 2022–2026 | ✅ 2022–2025 completas |
| Brasileirão | 71 | 2022–2026 | ✅ 2022–2025 completas |

### Huecos detectados
| Competición | ID | Partidos en BD | Prioridad |
|---|---|---|---|
| Championship (2ª Inglaterra) | 40 | 40 (solo 2024, incompleta) | 🔴 Alta |
| La Liga 2 (2ª España) | 141 | 0 | 🔴 Alta |
| Serie B (2ª Italia) | 136 | 0 | 🔴 Alta |
| Ligue 2 (2ª Francia) | 62 | 0 | 🟡 Media |
| 2. Bundesliga | 79 | 0 | 🟡 Media |
| UEFA Champions League | 2 | 279 (127 sin estadísticas) | 🔴 Alta |
| UEFA Europa League | 3 | 0 | 🟡 Media |
| UEFA Conference League | 848 | 0 | 🟢 Baja |
| FA Cup | 45 | 0 | 🟢 Baja |
| Copa del Rey | 143 | 0 | 🟢 Baja |

### Costo estimado en peticiones a la API
- **Completar lo ya descargado**: ~167 peticiones (127 Champions + 40 Championship).
- **Segundas divisiones, 1 temporada cada una**: ~2 080 partidos ≈ 2 085 peticiones.
- **Segundas divisiones, 4 temporadas (2022–2025)**: ~8 320 peticiones.
- Con el plan PRO (7 500/día) las cinco segundas divisiones de una temporada caben en **un solo día**.

### Orden sugerido de carga
1. `SYNC_LEAGUES=2,40 npm run sync:stats` — cerrar huecos actuales (~167 peticiones).
2. `SYNC_LEAGUES=40,141,136 FOOTBALL_SEASON=2025 npm run sync:data` — segundas divisiones grandes.
3. `SYNC_LEAGUES=62,79 FOOTBALL_SEASON=2025 npm run sync:data` — resto de segundas divisiones.
4. Repetir los pasos 2 y 3 para 2024, 2023 y 2022.
5. `SYNC_LEAGUES=3,848 npm run sync:data` — competiciones europeas secundarias.
6. Copas nacionales (45, 143) solo si se necesita cobertura de calendario.

> Nota: las segundas divisiones son especialmente valiosas para apuestas porque las
> casas ofrecen cuotas menos ajustadas que en las ligas top.

---

## B. Ruta de mejora del frontend

### Fase 1 — Navegación y consistencia (base)
- [x] Barra superior unificada con enlace a Calendario y resaltado de página activa.
- [x] Calendario con vista de próximos 7 días.
- [ ] Unificar `index.html` e `inicio.html`: hoy conviven dos portadas distintas.
- [ ] Extraer los estilos embebidos de cada HTML a `styles.css` (hoy hay CSS duplicado en 5 páginas).
- [ ] Estado de carga y error consistente en todas las vistas (hoy cada página lo resuelve a su manera).
- [ ] Página 404 propia en lugar del error por defecto de Express.

### Fase 2 — Experiencia de consulta
- [ ] Buscador global en la barra superior (equipos, ligas y partidos) con atajo `/`.
- [ ] Filtro por competición dentro del calendario (hoy solo se puede filtrar por API).
- [ ] Marcar en el calendario los partidos con estadísticas disponibles frente a los que no las tienen.
- [ ] Vista de tabla de posiciones por liga y temporada.
- [ ] Ficha de equipo con racha, local/visitante y promedios (existe `equipo.html` casi vacío).
- [ ] Historial de enfrentamientos ampliado con filtros por temporada y localía.

### Fase 3 — Producto de pago
- [ ] Página de precios con comparación de plan gratuito y premium.
- [ ] Limitar la prueba gratuita a un número de consultas por día, no solo por días.
- [ ] Marca de agua o difuminado en las estadísticas avanzadas para usuarios sin plan.
- [ ] Panel personal con historial de picks, aciertos y racha del usuario.
- [ ] Exportar boletas a imagen para compartir en redes.

### Fase 4 — Rendimiento y confianza
- [ ] Caché en cliente de las respuestas del calendario (hoy se vuelve a pedir en cada navegación).
- [ ] Paginación o carga diferida en listados largos de partidos.
- [ ] Indicador de calibración del modelo visible en cada pick.
- [ ] Modo oscuro y claro conmutable (hoy solo existe el tema oscuro).
- [ ] Accesibilidad: foco visible, etiquetas ARIA y contraste revisado.

### Fase 5 — Producción
- [ ] Migrar de WSL a VPS con PM2 y arranque automático.
- [ ] HTTPS con Let's Encrypt y dominio propio.
- [ ] Respaldos automáticos de MongoDB.
- [ ] Cron diario de `sync:calendario` para mantener los próximos días al día.
- [ ] Monitoreo de errores y de consumo de la cuota de la API.
