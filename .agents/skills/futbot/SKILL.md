---
name: futbot
description: Guía, base de conocimiento y reglas operativas del asistente conversacional FutBot en Data-Fut. Detalla la estructura de secciones de la plataforma, directrices de nombres naturales sin exponer rutas técnicas ni URLs, y la arquitectura de maquetación flotante.
---

# FutBot: Asistente Virtual Oficial de Data-Fut

FutBot es el asistente conversacional con Inteligencia Artificial integrado en Data-Fut (modelo Google Gemini 3.1 Flash Lite) para responder dudas de usuarios y visitantes sobre analítica de fútbol, mercados estadísticos y uso de la plataforma.

---

## 1. Reglas Fundamentales de Comunicación
- **Sin rutas ni URLs:** Nunca se deben mencionar rutas técnicas (`/picks.html`, `/picks`, `/calendario.html`, `/comparador`, `.html`) ni enlaces markdown tipo `[Texto](/url)` ni URLs crudas (`https://data-fut.com`).
- **Nombres naturales de producto:** Referirse siempre a las herramientas por su nombre oficial:
  - *"el Comparador"*
  - *"la sección de Mejores Picks"*
  - *"Mis Boletas"* (y el botón de *"Mis picks"*)
  - *"el Centro de Competición"*
  - *"el Centro de Partido"*
  - *"el Calendario de partidos"*
  - *"el Directorio de Equipos y Jugadores"*
  - *"la sección de Suscripción"*
- **Tono y estilo:** Español de México / Latinoamérica. Respuestas amables, concisas (máximo 2 a 3 párrafos), directas y pedagógicas.
- **Juego responsable:** Data-Fut es un software estadístico independiente, no una casa de apuestas. La información es puramente informativa.

---

## 2. Arquitectura y Posicionamiento de Interfaz (Widget Flotante y Exclusión Mutua)
- **Lanzador flotante (`#asistente-launcher-btn`):**
  - Apilado en reposo: Se posiciona dinámicamente justo encima del botón de *"Mis picks"* (`#global-picks-trigger`), calculando su altura real para mantener una separación limpia de 12px. Si no hay botón de picks presente (ej. usuario no autenticado o páginas administrativas), se ancla a `bottom: 20px; right: 20px;`.
- **Ventana modal de chat (`#asistente-modal-container`):**
  - Se ancla limpiamente a `bottom: 20px; right: 20px; z-index: 9991;` aprovechando toda la altura de la pantalla sin flotar en el aire. En móviles menores a 480px se despliega como bottom-sheet (`bottom: 0; right: 0`).
- **Exclusión mutua garantizada (Zero-Collision):**
  - **Al abrir "Mis boletas":** La clase `body.global-picks-open` oculta inmediatamente el lanzador y modal de FutBot (`display: none !important`), impidiendo que el botón verde se encime sobre el pie del panel o tape enlaces como *"Ir a Mis boletas"*.
  - **Al abrir FutBot:** La clase `body.asistente-chat-abierto` oculta suavemente el botón de *"Mis picks"* (`opacity: 0; pointer-events: none; visibility: hidden`), y si el panel de boletas estaba abierto, lo cierra de forma automática.
  - Ninguno de los dos paneles compite por espacio ni se solapan bajo ninguna resolución.

---

## 3. Caché y Service Worker
- Para prevenir que navegadores móviles y de escritorio sirvan estilos o scripts desactualizados:
  - `public/sw.js` utiliza estrategia **Network-first** tanto para `.html`, `.js` como para `.css`.
  - Los archivos HTML referencian `asistente.css?v=...` y `asistente.js?v=...` con cache-busters sincronizados.

---

## 4. Backend y Sanitización Defensiva
- Archivo: `services/aiChat.js`
- Función: `responderConsulta(mensaje, opciones)`
- Sanitizador regex: `sanitizarRespuesta(texto)` elimina de forma defensiva cualquier URL, enlace markdown o ruta técnica huérfana antes de emitir la respuesta JSON al cliente.

---

## 5. Copiloto Analista y Contexto en Pantalla (Context-Aware AI)
- **Hook frontend `window.obtenerContextoFutBot()`**:
  - Implementado en el **Comparador** (`public/app-picks.js`) y en el **Centro de Partido** (`public/partido.js`).
  - Retorna un objeto con `{ pagina, partido, liga, candidatos, mercados }`.
- **Inyección y procesamiento en backend**:
  - `routes/aiChat.js` valida y limita el objeto `contexto`.
  - `services/aiChat.js` formatea el bloque `[Contexto actual del usuario en pantalla]` y lo inyecta en el `system_instruction` de Gemini.
  - FutBot interpreta los datos calculados por el motor de Data-Fut para responder qué picks recomienda, explicar la probabilidad de un mercado específico (Over 2.5 goles, córners, tarjetas) o contrastar las cuotas/estimaciones de ambos clubes.
- **Chips contextuales inteligentes**:
  - `public/asistente.js` adapta los chips iniciales a preguntas sobre el partido activo en pantalla (ej. *"¿Qué pick ves más sólido para este partido?"*, *"¿Ves probable el Over 2.5 goles?"*).

---

## 6. Reglas de Exclusión de Picks Triviales (Sin Valor)
FutBot y el motor estadístico de Data-Fut (`services/pickRules.js`) tienen prohibido recomendar mercados con líneas triviales que carezcan de valor de cuota o competitividad:
1. **Over 0.5 goles** (total o por equipo).
2. **Over ≤ 2.5 tiros totales** (o líneas ≤ 2.5 de tiros).
3. **Over ≤ 1.5 tiros a puerta** (total o por equipo; ej. *"Más de 1.5 tiros a puerta del local"*).
4. **Over ≤ 1.5 córners** (total o por equipo; ej. *"Más de 1.5 córners del local"*).
5. **Over 0.5 tarjetas por equipo** (amarillas o totales registradas por equipo ≤ 0.5).
6. **Over ≤ 2.5 faltas** (total o por equipo).

* **Excepción clave:** Los **Under** equivalentes (ej. *Menos de 0.5 goles*, *Menos de 2.5 faltas*) **sí tienen valor** y son válidos si la estadística del encuentro los sustenta.
* FutBot descarta activamente los Over triviales en sus recomendaciones analíticas y solo prioriza selecciones con valor de mercado real.

---

## 7. Formato Visual y Renderizado de Mensajes (Markdown)
- **Parseo seguro en cliente (`public/asistente.js`)**:
  - `escaparHTML(str)` desinfecta caracteres especiales (`&`, `<`, `>`, `"`, `'`) previniendo cualquier riesgo de inyección XSS.
  - `procesarInlineMarkdown(texto)` convierte `**texto**` en `<strong>texto</strong>` y `*texto*` en `<em>texto</em>`.
  - `formatearMarkdownBot(texto)` detecta viñetas (`* `, `- `, `• ` o `\d+\. `) y las agrupa semánticamente en listas `<ul class="asistente-bullet-list"><li>...</li></ul>`.
- **Estilos en `public/asistente.css`**:
  - `strong`: destacado en verde neón (`#54e38e`) de alta legibilidad.
  - `.asistente-bullet-list`: espacio vertical adecuado con marcadores en verde neón (`li::marker { color: #54e38e; }`).
- **Directriz de generación (`services/aiChat.js`)**:
  - FutBot siempre presenta picks separados en renglones independientes con viñetas:
    `- **[Mercado/Pick]** (Estimación: XX% | Confianza: alta/media): Justificación estadística concisa.`
  - Nunca agrupa los picks dentro de párrafos corridos y densos.

---

## 8. Prevención Estricta de Alucinaciones y Mercados Clave (Benchmark)
- **Prohibición de números inventados:** FutBot tiene terminantemente prohibido inventar o estimar libremente porcentajes de probabilidad o cuotas.
- **Inyección de Mercados Clave (`mercados_clave`):** Para evitar que el asistente invente probabilidades en los mercados más consultados (Over/Under 2.5 goles, Ambos Anotan, Over 1.5), `public/app-picks.js` y `public/partido.js` inyectan explícitamente estos mercados con sus frecuencias matemáticas calculadas por Data-Fut.
- **Honestidad estadística:** Si un mercado como *Over 2.5 goles* o *Ambos anotan* tiene una estimación baja o no califica como pick candidato (ej. Over 2.5 al 46.5%), FutBot lo comunica con total transparencia, explicando que el modelo no lo recomienda o que la tendencia se inclina hacia el Under, y redirige al usuario hacia los picks que sí cuentan con respaldo en *Candidatos*.


