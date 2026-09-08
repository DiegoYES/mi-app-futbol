(function () {
  'use strict';

  const STORAGE_KEY = 'datafut_asistente_historial';
  const STORAGE_OPEN_KEY = 'datafut_asistente_abierto';

  const PREGUNTAS_RAPIDAS = [
    '¿Cómo funciona el comparador?',
    '¿Qué significa Over 2.5 y BTTS?',
    '¿Qué incluye la suscripción de $70 MXN?'
  ];

  function obtenerPreguntasContextuales() {
    const ctx = typeof window.obtenerContextoFutBot === 'function' ? window.obtenerContextoFutBot() : null;
    if (ctx && ctx.partido) {
      return [
        '¿Qué pick ves más sólido para este partido?',
        '¿Ves probable el Over 2.5 goles?',
        '¿Cómo ve el modelo los córners y tarjetas?'
      ];
    }
    return PREGUNTAS_RAPIDAS;
  }

  function iniciarAsistente() {
    if (document.getElementById('asistente-launcher-btn')) return;

    // 1. Crear el botón lanzador
    const launcher = document.createElement('button');
    launcher.id = 'asistente-launcher-btn';
    launcher.className = 'asistente-launcher';
    launcher.type = 'button';
    launcher.setAttribute('aria-label', 'Abrir asistente virtual de Data-Fut');
    launcher.innerHTML = `
      <svg class="asistente-launcher-icon" viewBox="0 0 24 24">
        <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.38-1 1.72V7h4a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-8a3 3 0 0 1 3-3h4V5.72c-.6-.34-1-.98-1-1.72a2 2 0 0 1 2-2M7.5 12a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3m9 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3M8 17h8v-1H8v1z"/>
      </svg>
      <span class="asistente-launcher-badge" title="En línea"></span>
    `;

    // 2. Crear el modal de chat
    const modal = document.createElement('section');
    modal.id = 'asistente-modal-container';
    modal.className = 'asistente-modal oculto';
    modal.setAttribute('aria-label', 'Ventana del asistente virtual');
    modal.innerHTML = `
      <header class="asistente-header">
        <div class="asistente-header-info">
          <div class="asistente-avatar">🤖</div>
          <div class="asistente-title-group">
            <h3>FutBot <span class="asistente-online-dot"></span></h3>
            <p class="asistente-subtitle">Asistente Virtual · Data-Fut</p>
          </div>
        </div>
        <button id="asistente-close-btn" class="asistente-close-btn" type="button" aria-label="Cerrar chat">✕</button>
      </header>
      <div id="asistente-messages-list" class="asistente-messages" role="log" aria-live="polite"></div>
      <footer class="asistente-footer">
        <form id="asistente-chat-form" class="asistente-form">
          <input id="asistente-input-text" class="asistente-input" type="text" maxlength="400" placeholder="Pregunta sobre Data-Fut..." autocomplete="off">
          <button id="asistente-submit-btn" class="asistente-send-btn" type="submit" aria-label="Enviar pregunta">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
          </button>
        </form>
        <p class="asistente-disclaimer">Análisis informativo. Data-Fut no garantiza resultados.</p>
      </footer>
    `;

    document.body.appendChild(launcher);
    document.body.appendChild(modal);

    const closeBtn = document.getElementById('asistente-close-btn');
    const form = document.getElementById('asistente-chat-form');
    const input = document.getElementById('asistente-input-text');
    const submitBtn = document.getElementById('asistente-submit-btn');
    const messagesList = document.getElementById('asistente-messages-list');

    let enviando = false;

    function refrescarChipsSiEsInicial() {
      const contenedorChips = messagesList.querySelector('.asistente-chips-container');
      if (contenedorChips && messagesList.querySelectorAll('.asistente-msg-user').length === 0) {
        contenedorChips.remove();
        renderizarChips(obtenerPreguntasContextuales());
      }
    }

    function toggleChat(abrir) {
      const estaOculto = modal.classList.contains('oculto');
      const nuevoEstado = typeof abrir === 'boolean' ? abrir : estaOculto;
      if (nuevoEstado) {
        modal.classList.remove('oculto');
        sessionStorage.setItem(STORAGE_OPEN_KEY, '1');
        refrescarChipsSiEsInicial();
        input.focus();
        desplazarAbajo();
      } else {
        modal.classList.add('oculto');
        sessionStorage.removeItem(STORAGE_OPEN_KEY);
      }
    }

    launcher.addEventListener('click', function () {
      toggleChat();
    });

    closeBtn.addEventListener('click', function () {
      toggleChat(false);
    });

    function desplazarAbajo() {
      messagesList.scrollTop = messagesList.scrollHeight;
    }

    function guardarHistorial(historial) {
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(historial));
      } catch (_) {}
    }

    function obtenerHistorial() {
      try {
        const guardado = sessionStorage.getItem(STORAGE_KEY);
        return guardado ? JSON.parse(guardado) : null;
      } catch (_) {
        return null;
      }
    }

    function escaparHTML(str) {
      return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function procesarInlineMarkdown(texto) {
      let s = escaparHTML(texto);
      s = s.replace(/`([^`]+)`/g, '<code class="asistente-inline-code">$1</code>');
      s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      s = s.replace(/(^|[^*])\*([^*]+)\*([^*]|$)/g, '$1<em>$2</em>$3');
      return s;
    }

    function formatearMarkdownBot(texto) {
      if (!texto) return '';
      const lineas = String(texto).split(/\r?\n/);
      const resultado = [];
      let enLista = false;
      let bufferParrafo = [];

      function volcarParrafo() {
        if (bufferParrafo.length > 0) {
          resultado.push(`<p>${bufferParrafo.join('<br>')}</p>`);
          bufferParrafo = [];
        }
      }

      function cerrarLista() {
        if (enLista) {
          resultado.push('</ul>');
          enLista = false;
        }
      }

      for (let i = 0; i < lineas.length; i++) {
        const rawLinea = lineas[i];
        const linea = rawLinea.trim();

        if (!linea) {
          volcarParrafo();
          cerrarLista();
          continue;
        }

        const matchLista = linea.match(/^(?:[-*•]|\d+\.)\s+(.+)$/);
        if (matchLista) {
          volcarParrafo();
          if (!enLista) {
            resultado.push('<ul class="asistente-bullet-list">');
            enLista = true;
          }
          const contenido = procesarInlineMarkdown(matchLista[1]);
          resultado.push(`<li>${contenido}</li>`);
        } else {
          cerrarLista();
          bufferParrafo.push(procesarInlineMarkdown(linea));
        }
      }

      volcarParrafo();
      cerrarLista();

      return resultado.join('');
    }

    function renderizarMensaje(texto, remitente) {
      const div = document.createElement('div');
      div.className = `asistente-msg asistente-msg-${remitente}`;
      if (remitente === 'bot') {
        div.innerHTML = formatearMarkdownBot(texto);
      } else {
        div.textContent = texto;
      }
      messagesList.appendChild(div);
      desplazarAbajo();
      return div;
    }

    function renderizarChips(preguntas) {
      const contenedor = document.createElement('div');
      contenedor.className = 'asistente-chips-container';
      preguntas.forEach(function (pregunta) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'asistente-chip-btn';
        btn.textContent = pregunta;
        btn.addEventListener('click', function () {
          enviarPregunta(pregunta);
        });
        contenedor.appendChild(btn);
      });
      messagesList.appendChild(contenedor);
      desplazarAbajo();
    }

    function mostrarTyping() {
      const typing = document.createElement('div');
      typing.id = 'asistente-typing-indicator';
      typing.className = 'asistente-typing';
      typing.innerHTML = '<span></span><span></span><span></span>';
      messagesList.appendChild(typing);
      desplazarAbajo();
    }

    function ocultarTyping() {
      const typing = document.getElementById('asistente-typing-indicator');
      if (typing) typing.remove();
    }

    async function enviarPregunta(textoPregunta) {
      const texto = String(textoPregunta || '').trim();
      if (!texto || enviando) return;

      enviando = true;
      submitBtn.disabled = true;
      input.disabled = true;

      // 1. Mostrar mensaje del usuario
      renderizarMensaje(texto, 'user');
      input.value = '';

      // 2. Guardar en historial
      const historial = obtenerHistorial() || [];
      historial.push({ rol: 'user', texto: texto });
      guardarHistorial(historial);

      // 3. Mostrar indicador de escritura
      mostrarTyping();

      try {
        const contexto = typeof window.obtenerContextoFutBot === 'function'
          ? window.obtenerContextoFutBot()
          : null;

        const res = await fetch('/api/asistente/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mensaje: texto, contexto: contexto })
        });

        const datos = await res.json();
        ocultarTyping();

        let respuestaBot = '';
        if (res.ok && datos.respuesta) {
          respuestaBot = datos.respuesta;
        } else {
          respuestaBot = datos.error || 'No pude procesar tu duda en este momento. Intenta de nuevo más tarde.';
        }

        renderizarMensaje(respuestaBot, 'bot');
        historial.push({ rol: 'bot', texto: respuestaBot });
        guardarHistorial(historial);
      } catch (err) {
        ocultarTyping();
        const msgError = 'Hubo un problema de conexión con el asistente. Verifica tu red e intenta de nuevo.';
        renderizarMensaje(msgError, 'bot');
        historial.push({ rol: 'bot', texto: msgError });
        guardarHistorial(historial);
      } finally {
        enviando = false;
        submitBtn.disabled = false;
        input.disabled = false;
        input.focus();
      }
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      enviarPregunta(input.value);
    });

    // Cargar historial previo o mensaje de bienvenida inicial
    const historialPrevio = obtenerHistorial();
    if (historialPrevio && historialPrevio.length > 0) {
      historialPrevio.forEach(function (m) {
        renderizarMensaje(m.texto, m.rol);
      });
    } else {
      renderizarMensaje(
        '¡Hola! Soy FutBot 🤖, el asistente virtual de Data-Fut. ¿En qué te puedo ayudar hoy?',
        'bot'
      );
      renderizarChips(obtenerPreguntasContextuales());
    }

    // Restaurar si el usuario lo tenía abierto
    if (sessionStorage.getItem(STORAGE_OPEN_KEY) === '1') {
      toggleChat(true);
    }

    // Evitar encimarse con el widget flotante de Mis picks o cualquier elemento inferior
    function reposicionarLauncher() {
      const btn = document.getElementById('asistente-launcher-btn');
      if (!btn) return;

      const esMovil = window.innerWidth <= 600;
      const baseBottom = esMovil ? 72 : 84;
      const baseRight = esMovil ? 14 : 20;

      const picks = document.querySelector('.global-picks-widget') || document.getElementById('global-picks-trigger');
      if (picks) {
        document.body.classList.add('has-global-picks');
        const rect = picks.getBoundingClientRect();
        if (rect.height > 0 && rect.top > 0) {
          const distFromBottom = Math.round(window.innerHeight - rect.top);
          const targetBottom = Math.max(baseBottom, distFromBottom + 14);
          btn.style.setProperty('bottom', `${targetBottom}px`, 'important');
          btn.style.setProperty('right', `${baseRight}px`, 'important');
          return;
        }
      }

      btn.style.setProperty('bottom', `${baseBottom}px`, 'important');
      btn.style.setProperty('right', `${baseRight}px`, 'important');
    }

    reposicionarLauncher();
    window.addEventListener('resize', reposicionarLauncher);
    window.addEventListener('scroll', reposicionarLauncher, { passive: true });
    window.addEventListener('futbol:usuario-cargado', reposicionarLauncher);
    window.addEventListener('futbol:picks-actualizados', reposicionarLauncher);
    [200, 600, 1200, 2500, 5000].forEach(ms => setTimeout(reposicionarLauncher, ms));
    if (typeof MutationObserver !== 'undefined') {
      const picksObserver = new MutationObserver(reposicionarLauncher);
      picksObserver.observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciarAsistente);
  } else {
    iniciarAsistente();
  }
})();
