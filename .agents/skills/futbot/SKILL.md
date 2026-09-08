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

## 2. Arquitectura y Posicionamiento de Interfaz (Widget Flotante)
- **Lanzador flotante (`#asistente-launcher-btn`):**
  - Ubicación base en desktop: `bottom: 84px !important; right: 20px !important;`.
  - Ubicación base en móviles: `bottom: 72px !important; right: 14px !important;`.
  - Apilado dinámico: `reposicionarLauncher()` en `public/asistente.js` calcula el `getBoundingClientRect()` del widget de *"Mis picks"* (`.global-picks-widget`) y aplica una propiedad en línea `bottom: (distFromBottom + 14)px !important`.
  - De esta forma, FutBot **nunca se encima con "Mis picks"** bajo ninguna resolución, zoom o estado de autenticación.
- **Ventana modal de chat (`#asistente-modal-container`):**
  - Desplegable sobre el lanzador con `bottom: 88px; right: 22px; z-index: 9991`. En móviles menores a 480px se maximiza estilo bottom-sheet.

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

