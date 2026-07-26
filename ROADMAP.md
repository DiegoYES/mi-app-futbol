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
