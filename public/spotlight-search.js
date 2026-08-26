/**
 * Data-Fut Spotlight Search (Cmd+K / Ctrl+K)
 * Modal universal de búsqueda rápida tokenizada para navegación instantánea
 * entre competiciones, equipos y jugadores.
 */
(function () {
  let modalCreado = false;
  let backdropEl = null;
  let inputEl = null;
  let resultsEl = null;
  let catalogoItems = [];
  let indiceActivo = 0;
  let cargandoCatalogo = false;

  async function cargarCatalogo() {
    if (catalogoItems.length > 0 || cargandoCatalogo) return;
    cargandoCatalogo = true;

    try {
      const cacheado = sessionStorage.getItem('datafut_spotlight_items');
      if (cacheado) {
        catalogoItems = JSON.parse(cacheado);
        cargandoCatalogo = false;
        return;
      }

      const resp = await fetch('/api/home/resumen');
      if (!resp.ok) return;
      const data = await resp.json();
      const items = [];

      // Añadir ligas
      (data.ligas || []).forEach(l => {
        items.push({
          id: l.id,
          tipo: 'liga',
          nombre: l.nombre,
          pais: l.pais || 'Competición',
          url: `/competicion.html?id=${l.id}`,
          icono: `/api/ligas/${l.id}/logo`,
          sub: `${l.pais || 'Internacional'} · Competición`
        });
      });

      // Añadir accesos directos principales
      items.push({
        id: 'nav-calendario',
        tipo: 'pagina',
        nombre: 'Calendario de Partidos',
        pais: 'Acceso directo',
        url: '/calendario.html',
        icono: '/brand-mark.svg',
        sub: 'Ver agenda y partidos del día'
      });
      items.push({
        id: 'nav-comparador',
        tipo: 'pagina',
        nombre: 'Comparador Estadístico',
        pais: 'Acceso directo',
        url: '/comparador.html',
        icono: '/brand-mark.svg',
        sub: 'Análisis frente a frente y generación de picks'
      });
      items.push({
        id: 'nav-picks',
        tipo: 'pagina',
        nombre: 'Picks y Seguimiento',
        pais: 'Acceso directo',
        url: '/picks.html',
        icono: '/brand-mark.svg',
        sub: 'Cartera de selecciones y rendimiento del modelo'
      });
      items.push({
        id: 'nav-jugadores',
        tipo: 'pagina',
        nombre: 'Directorio de Jugadores',
        pais: 'Acceso directo',
        url: '/jugadores.html',
        icono: '/brand-mark.svg',
        sub: 'Goleadores, asistentes y notas por 90 minutos'
      });

      catalogoItems = items;
      sessionStorage.setItem('datafut_spotlight_items', JSON.stringify(items));
    } catch (err) {
      console.warn('No se pudo precargar el catálogo de spotlight:', err);
    } finally {
      cargandoCatalogo = false;
    }
  }

  function crearModal() {
    if (modalCreado) return;
    modalCreado = true;

    backdropEl = document.createElement('div');
    backdropEl.id = 'spotlight-search-modal';
    backdropEl.className = 'spotlight-backdrop';
    backdropEl.setAttribute('role', 'dialog');
    backdropEl.setAttribute('aria-modal', 'true');
    backdropEl.setAttribute('aria-label', 'Búsqueda global');

    const isMac = navigator.platform?.toUpperCase().indexOf('MAC') >= 0;
    const shortcutLabel = isMac ? '⌘K' : 'Ctrl+K';

    backdropEl.innerHTML = `
      <div class="spotlight-modal">
        <div class="spotlight-input-wrap">
          <svg class="spotlight-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input type="text" class="spotlight-input" placeholder="Buscar equipo, liga o sección…" autocomplete="off" spellcheck="false">
          <span class="spotlight-shortcut-chip">${shortcutLabel}</span>
        </div>
        <div class="spotlight-results" role="listbox"></div>
        <div class="spotlight-footer">
          <span>Usa <b>↑</b> <b>↓</b> para navegar</span>
          <span><b>Enter</b> para ir · <b>Esc</b> para salir</span>
        </div>
      </div>
    `;

    document.body.appendChild(backdropEl);

    inputEl = backdropEl.querySelector('.spotlight-input');
    resultsEl = backdropEl.querySelector('.spotlight-results');

    // Cerrar al dar clic en el fondo
    backdropEl.addEventListener('click', e => {
      if (e.target === backdropEl) cerrarSpotlight();
    });

    // Búsqueda en tiempo real
    inputEl.addEventListener('input', () => {
      indiceActivo = 0;
      renderizarResultados();
    });

    // Teclado para navegar entre resultados
    inputEl.addEventListener('keydown', e => {
      const itemsEls = resultsEl.querySelectorAll('.spotlight-item');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (itemsEls.length) {
          indiceActivo = (indiceActivo + 1) % itemsEls.length;
          actualizarSeleccionVisual();
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (itemsEls.length) {
          indiceActivo = (indiceActivo - 1 + itemsEls.length) % itemsEls.length;
          actualizarSeleccionVisual();
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const seleccionado = itemsEls[indiceActivo];
        if (seleccionado) {
          const url = seleccionado.dataset.url;
          if (url) {
            cerrarSpotlight();
            window.location.href = url;
          }
        }
      } else if (e.key === 'Escape') {
        cerrarSpotlight();
      }
    });
  }

  function actualizarSeleccionVisual() {
    const itemsEls = resultsEl.querySelectorAll('.spotlight-item');
    itemsEls.forEach((el, i) => {
      el.classList.toggle('active', i === indiceActivo);
      if (i === indiceActivo) {
        el.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  function renderizarResultados() {
    const query = inputEl.value.trim();
    if (!catalogoItems.length) {
      resultsEl.innerHTML = '<div class="spotlight-empty">Cargando catálogo…</div>';
      return;
    }

    let resultados = catalogoItems;
    if (query) {
      if (window.FutbolSearch?.ordenar) {
        resultados = window.FutbolSearch.ordenar(catalogoItems, query, item => `${item.nombre} ${item.pais || ''}`);
      } else {
        const q = query.toLowerCase();
        resultados = catalogoItems.filter(item => `${item.nombre} ${item.pais || ''}`.toLowerCase().includes(q));
      }
    }

    const maxResults = 8;
    const itemsAMostrar = resultados.slice(0, maxResults);

    if (!itemsAMostrar.length) {
      resultsEl.innerHTML = '<div class="spotlight-empty">No se encontraron coincidencias.</div>';
      return;
    }

    resultsEl.innerHTML = itemsAMostrar.map((item, idx) => `
      <a href="${item.url}" class="spotlight-item ${idx === indiceActivo ? 'active' : ''}" data-url="${item.url}" role="option" aria-selected="${idx === indiceActivo}">
        <img src="${item.icono}" alt="" class="spotlight-item-icon" onerror="this.src='/brand-mark.svg'">
        <div class="spotlight-item-text">
          <span class="spotlight-item-title">${item.nombre}</span>
          <span class="spotlight-item-sub">${item.sub}</span>
        </div>
      </a>
    `).join('');
  }

  function abrirSpotlight() {
    crearModal();
    cargarCatalogo();
    backdropEl.classList.add('open');
    inputEl.value = '';
    indiceActivo = 0;
    renderizarResultados();
    requestAnimationFrame(() => inputEl.focus());
  }

  function cerrarSpotlight() {
    if (backdropEl) {
      backdropEl.classList.remove('open');
      inputEl.blur();
    }
  }

  // Atajo global de teclado Cmd+K / Ctrl+K
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (backdropEl?.classList.contains('open')) {
        cerrarSpotlight();
      } else {
        abrirSpotlight();
      }
    } else if (e.key === 'Escape' && backdropEl?.classList.contains('open')) {
      cerrarSpotlight();
    }
  });

  // Exportar helper global
  window.abrirBuscadorSpotlight = abrirSpotlight;
  window.cerrarBuscadorSpotlight = cerrarSpotlight;

  // Precargar al cargar la página
  document.addEventListener('DOMContentLoaded', () => {
    cargarCatalogo();
  });
})();
