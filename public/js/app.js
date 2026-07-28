(function () {
  const form = document.getElementById('cotizador-form');
  const origenSelect = document.getElementById('origen');
  const destinoSelect = document.getElementById('destino');
  const resultsSection = document.getElementById('resultados');
  const resultsList = document.getElementById('resultados-lista');
  const resultsMeta = document.getElementById('resultados-meta');
  const errorBox = document.getElementById('form-error');
  const submitBtn = document.getElementById('submit-cotizar');
  const modal = document.getElementById('modal-comprar');
  const modalBody = document.getElementById('modal-comprar-body');
  const modalClose = document.getElementById('modal-close');
  const modalDetalle = document.getElementById('modal-detalle');
  const modalDetalleClose = document.getElementById('modal-detalle-close');
  const modalDetalleTitulo = document.getElementById('modal-detalle-titulo');
  const modalDetalleBody = document.getElementById('modal-detalle-body');
  const fechaSalidaInput = document.getElementById('fecha-salida');
  const fechaRegresoInput = document.getElementById('fecha-regreso');

  const viajerosTrigger = document.getElementById('viajeros-trigger');
  const viajerosTriggerText = document.getElementById('viajeros-trigger-text');
  const viajerosPanel = document.getElementById('viajeros-panel');
  const viajerosTotalLabel = document.getElementById('viajeros-total');
  const viajerosListoBtn = document.getElementById('viajeros-listo');
  const pasajerosSelector = document.querySelector('.pasajeros-selector');

  // id de moneda (Cardinal) → símbolo e ISO 4217 (para mostrar y para GA4).
  const MONEDAS = {
    3: { simbolo: 'US$', iso: 'USD' },
    4: { simbolo: '€', iso: 'EUR' },
    6: { simbolo: 'Bs', iso: 'VES' },
    7: { simbolo: 'AR$', iso: 'ARS' },
    104: { simbolo: 'R$', iso: 'BRL' },
    105: { simbolo: 'COL$', iso: 'COP' },
    107: { simbolo: 'MX$', iso: 'MXN' },
    109: { simbolo: 'CLP$', iso: 'CLP' },
  };
  let formStarted = false;

  // --- 0. Selector de pasajeros (adultos / menores / seniors) --------------
  // La API pide una edad puntual por pasajero, no un conteo por franja. Para
  // no pedirle el detalle al usuario, usamos una edad representativa de cada
  // franja al armar el array `edades` que espera Cardinal.
  const EDAD_REPRESENTATIVA = { adultos: 30, menores: 10, seniors: 78 };
  const conteoViajeros = { adultos: 0, menores: 0, seniors: 0 };

  function totalViajeros() {
    return conteoViajeros.adultos + conteoViajeros.menores + conteoViajeros.seniors;
  }

  function edadesDesdeConteo() {
    return Object.entries(conteoViajeros).flatMap(([tipo, cantidad]) =>
      Array(cantidad).fill(EDAD_REPRESENTATIVA[tipo])
    );
  }

  function actualizarViajerosUI() {
    const total = totalViajeros();
    viajerosTriggerText.textContent = total > 0 ? `${total} viajero${total === 1 ? '' : 's'}` : '¿Cuántos viajan?';
    viajerosTotalLabel.textContent = `${total} viajero${total === 1 ? '' : 's'}`;
    viajerosPanel.querySelectorAll('.stepper').forEach((stepper) => {
      const tipo = stepper.dataset.tipo;
      stepper.querySelector('[data-count]').textContent = conteoViajeros[tipo];
      stepper.querySelector('[data-action="dec"]').disabled = conteoViajeros[tipo] === 0;
    });
  }

  function abrirViajerosPanel() {
    viajerosPanel.hidden = false;
    viajerosTrigger.setAttribute('aria-expanded', 'true');
  }
  function cerrarViajerosPanel() {
    viajerosPanel.hidden = true;
    viajerosTrigger.setAttribute('aria-expanded', 'false');
  }

  viajerosTrigger.addEventListener('click', () => {
    viajerosPanel.hidden ? abrirViajerosPanel() : cerrarViajerosPanel();
  });

  viajerosPanel.addEventListener('click', (e) => {
    const btn = e.target.closest('.stepper__btn');
    if (!btn) return;
    const tipo = btn.closest('.stepper').dataset.tipo;
    const delta = btn.dataset.action === 'inc' ? 1 : -1;
    conteoViajeros[tipo] = Math.max(0, Math.min(9, conteoViajeros[tipo] + delta));
    actualizarViajerosUI();
  });

  viajerosListoBtn.addEventListener('click', cerrarViajerosPanel);

  document.addEventListener('click', (e) => {
    if (!pasajerosSelector.contains(e.target)) cerrarViajerosPanel();
  });

  // --- 1. Cargar orígenes / destinos reales desde la API ---------------------
  // Cacheados en localStorage 10 minutos: es un catálogo de países que casi
  // no cambia, y la llamada a Cardinal puede tardar — así el formulario queda
  // usable al instante en visitas repetidas.
  const PARAMETROS_CACHE_KEY = 'vs_parametros_cache_v1';
  const PARAMETROS_CACHE_MS = 10 * 60 * 1000;

  async function obtenerParametros() {
    try {
      const cached = JSON.parse(localStorage.getItem(PARAMETROS_CACHE_KEY) || 'null');
      if (cached && Date.now() - cached.ts < PARAMETROS_CACHE_MS) return cached.data;
    } catch {
      /* localStorage corrupto o deshabilitado: seguimos con el fetch */
    }
    const resp = await fetch('/api/parametros');
    const data = await resp.json();
    try {
      localStorage.setItem(PARAMETROS_CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
    } catch {
      /* ignorar cuota excedida */
    }
    return data;
  }

  async function cargarParametros() {
    try {
      const data = await obtenerParametros();

      // El endpoint /parametros de Cardinal todavía no lista `destinos` para
      // este agente aunque /cotizar ya los acepta (desfasaje conocido de su
      // lado), así que usamos el mismo catálogo de países de `paisesResidencia`
      // como destino — es el mismo listado de países, no un dato inventado.
      const destinos = (data.destinos && data.destinos.length) ? data.destinos : data.paisesResidencia;

      fillSelect(origenSelect, data.paisesResidencia || data.origenes || [], 'nombre');
      fillSelect(destinoSelect, destinos || [], 'nombre');

      if (!destinos || !destinos.length) {
        showError(
          'El agente emisor configurado no tiene destinos habilitados en este entorno. ' +
          'Revisá las credenciales (CARDINAL_AGENTE_GUID) — ver README.'
        );
        submitBtn.disabled = true;
      }

      aplicarBusquedaDesdeUrl();
    } catch (err) {
      showError('No se pudieron cargar los países y destinos desde Cardinal.');
    }
  }

  function fillSelect(select, items, labelKey) {
    const valorPrevio = select.value;
    select.innerHTML = '<option value="">Seleccioná una opción</option>';
    items.forEach((item) => {
      const opt = document.createElement('option');
      opt.value = item.id;
      opt.textContent = item[labelKey];
      select.appendChild(opt);
    });
    if (valorPrevio) select.value = valorPrevio;
  }

  // --- 2. Búsqueda vía URL — para compartir un link con la cotización lista ---
  const PARAM_KEYS = { origen: 'origen', destino: 'destino', salida: 'salida', regreso: 'regreso', adultos: 'adultos', menores: 'menores', seniors: 'seniors' };

  function aplicarBusquedaDesdeUrl() {
    const p = new URLSearchParams(location.search);
    const origenId = p.get(PARAM_KEYS.origen);
    const destinoId = p.get(PARAM_KEYS.destino);
    const salida = p.get(PARAM_KEYS.salida);
    const regreso = p.get(PARAM_KEYS.regreso);
    const adultos = parseInt(p.get(PARAM_KEYS.adultos), 10) || 0;
    const menores = parseInt(p.get(PARAM_KEYS.menores), 10) || 0;
    const seniors = parseInt(p.get(PARAM_KEYS.seniors), 10) || 0;

    if (origenId) origenSelect.value = origenId;
    if (destinoId) destinoSelect.value = destinoId;
    if (salida) fechaSalidaInput.value = salida;
    if (regreso) fechaRegresoInput.value = regreso;
    if (adultos || menores || seniors) {
      conteoViajeros.adultos = adultos;
      conteoViajeros.menores = menores;
      conteoViajeros.seniors = seniors;
      actualizarViajerosUI();
    }

    const busquedaCompleta = origenSelect.value && destinoSelect.value && salida && regreso && (adultos + menores + seniors) > 0;
    if (busquedaCompleta) ejecutarCotizacion();
  }

  function actualizarUrlConBusqueda(payload) {
    const p = new URLSearchParams();
    p.set(PARAM_KEYS.origen, payload.origenId);
    p.set(PARAM_KEYS.destino, payload.destinoId);
    p.set(PARAM_KEYS.salida, payload.fechaSalida);
    p.set(PARAM_KEYS.regreso, payload.fechaRegreso);
    p.set(PARAM_KEYS.adultos, conteoViajeros.adultos);
    p.set(PARAM_KEYS.menores, conteoViajeros.menores);
    p.set(PARAM_KEYS.seniors, conteoViajeros.seniors);
    history.replaceState(null, '', `?${p.toString()}`);
  }

  // --- 3. Tracking de inicio de formulario --------------------------------
  form.addEventListener(
    'focusin',
    () => {
      if (!formStarted) {
        formStarted = true;
        window.track('form_start', { form_id: 'cotizador' });
      }
    },
    { once: true }
  );

  // --- 4. Submit / cotización ----------------------------------------------
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    ejecutarCotizacion();
  });

  async function ejecutarCotizacion() {
    hideError();

    const edades = edadesDesdeConteo();

    const payload = {
      origenId: origenSelect.value,
      destinoId: destinoSelect.value,
      fechaSalida: fechaSalidaInput.value,
      fechaRegreso: fechaRegresoInput.value,
      edades,
      // El POC no le pide el email al usuario (no emite nada real); mandamos
      // uno sintético porque la API de Cardinal lo exige como obligatorio.
      email: `cotizacion.${Date.now()}@viajaseguro.app`,
    };

    if (!payload.origenId || !payload.destinoId || !payload.fechaSalida || !payload.fechaRegreso || !edades.length) {
      showError('Completá origen, destino, fechas y al menos un viajero para cotizar.');
      return;
    }

    actualizarUrlConBusqueda(payload);

    window.track('search', {
      search_term: `${origenSelect.selectedOptions[0]?.textContent} → ${destinoSelect.selectedOptions[0]?.textContent}`,
      pasajeros: edades.length,
    });

    setLoading(true);
    try {
      const resp = await fetch('/api/cotizar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();

      if (data.resultado !== 'ok') {
        showError((data.mensajes && data.mensajes.join(' ')) || 'No pudimos cotizar tu viaje. Probá con otros datos.');
        window.track('cotizacion_error', { error: (data.mensajes || []).join(' | ') });
        return;
      }

      renderResultados(data.cotizacion);
    } catch (err) {
      showError('No pudimos conectar con Cardinal. Intentá de nuevo en unos minutos.');
    } finally {
      setLoading(false);
    }
  }

  function setLoading(isLoading) {
    submitBtn.disabled = isLoading;
    submitBtn.textContent = isLoading ? 'Cotizando…' : 'Cotizar mi viaje';
  }

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.hidden = false;
  }
  function hideError() {
    errorBox.hidden = true;
  }

  // --- 5. Render de resultados + eventos ecommerce ------------------------
  function monto(costo) {
    return costo ? Number(costo.amount) : NaN;
  }

  function pctOff(lista, final) {
    const l = monto(lista);
    const f = monto(final);
    if (!l || !f || l <= f) return 0;
    return Math.round((1 - f / l) * 100);
  }

  function renderResultados(cotizacion) {
    const productos = (cotizacion.productos || []).slice().sort((a, b) => monto(a.costoFinal) - monto(b.costoFinal));

    resultsList.innerHTML = '';
    resultsMeta.textContent = `${productos.length} plan${productos.length === 1 ? '' : 'es'} disponible${productos.length === 1 ? '' : 's'}`;

    if (!productos.length) {
      resultsList.innerHTML = '<p class="sin-resultados">No encontramos planes para esta combinación de datos. Probá ajustando el destino o las fechas.</p>';
    }

    productos.forEach((producto, index) => {
      // Precio en la moneda local del país de origen (la que de verdad le
      // importa al usuario) con el equivalente en USD como referencia chica.
      const costoLocal = producto.costoFinalMonedaPais || producto.costoFinal;
      const costoLocalLista = producto.costoListaMonedaPais || producto.costoLista;
      const descuento = pctOff(costoLocalLista, costoLocal);

      const card = document.createElement('article');
      card.className = 'plan-card' + (index === 0 ? ' plan-card--recomendado' : '');
      card.innerHTML = `
        ${index === 0 ? '<span class="plan-card__badge">Recomendado</span>' : ''}
        <div class="plan-card__header">
          <h3>${producto.productoNombre.trim()}</h3>
          ${descuento ? `<span class="plan-card__off">${descuento}% OFF</span>` : ''}
        </div>
        <div class="plan-card__precio-wrap">
          ${descuento ? `<span class="plan-card__precio-lista">Total ${formatMoney(costoLocalLista)}</span>` : ''}
          <p class="plan-card__precio">${formatMoney(costoLocal)}
            <span class="plan-card__precio-detalle">total · ${formatMoney(producto.costoFinal)} · todos los pasajeros</span>
          </p>
        </div>
        ${producto.prestaciones && producto.prestaciones.length
          ? `<div class="plan-card__prestaciones">
              ${producto.prestaciones.map((p) => `
                <div class="prestacion-row">
                  <span class="prestacion-row__nombre">${p.nombre.trim()}</span>
                  <span class="prestacion-row__valor">${p.valor.trim()}</span>
                </div>
              `).join('')}
            </div>`
          : ''}
        <button type="button" class="btn-ver-mas" data-producto-id="${producto.productoId}">Ver cobertura completa →</button>
        <button type="button" class="btn-comprar" data-index="${index}">Comprar este plan</button>
      `;
      card.querySelector('.btn-ver-mas').addEventListener('click', () => {
        abrirModalDetalle(producto);
      });
      card.querySelector('.btn-comprar').addEventListener('click', () => {
        window.gaEcommerce.addToCart(producto, monedaIso(producto.costoFinal), index);
        abrirModalComprar(producto, index);
      });
      resultsList.appendChild(card);
    });

    resultsSection.hidden = false;
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

    if (productos.length) window.gaEcommerce.viewItemList(productos, monedaIso(productos[0].costoFinal));
  }

  function monedaIso(costo) {
    return (costo && MONEDAS[costo.currency]?.iso) || 'USD';
  }

  function formatMoney(costo) {
    const simbolo = (costo && MONEDAS[costo.currency]?.simbolo) || '$';
    return `${simbolo} ${monto(costo).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;
  }

  // --- 6. Modal "Comprar" (sin emitir nada de verdad) -----------------------
  function abrirModalComprar(producto, index) {
    modalBody.innerHTML = `
      <p>Acá se emitiría el voucher directo — este POC no emite pólizas reales.</p>
      <p class="modal-plan-nombre">${producto.productoNombre} · ${formatMoney(producto.costoFinal)}</p>
    `;
    modal.hidden = false;
    window.gaEcommerce.beginCheckout(producto, monedaIso(producto.costoFinal), index);
  }
  modalClose.addEventListener('click', () => {
    modal.hidden = true;
  });
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.hidden = true;
  });

  // --- 7. Modal "Ver cobertura completa" — detalle_productos cacheado -------
  // Es catálogo casi estático (no depende de fechas ni pasajeros), así que
  // se cachea 24hs por productoId en vez de pedirlo de nuevo cada vez.
  const DETALLE_CACHE_KEY = 'vs_detalle_cache_v1';
  const DETALLE_CACHE_MS = 24 * 60 * 60 * 1000;

  async function obtenerDetalleProducto(productoId) {
    let cache = {};
    try {
      cache = JSON.parse(localStorage.getItem(DETALLE_CACHE_KEY) || '{}');
    } catch {
      cache = {};
    }
    const cached = cache[productoId];
    if (cached && Date.now() - cached.ts < DETALLE_CACHE_MS) return cached.data;

    const resp = await fetch('/api/detalle_productos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productoIds: [productoId] }),
    });
    const data = await resp.json();
    const detalle = data.productos && data.productos[0];
    if (detalle) {
      cache[productoId] = { ts: Date.now(), data: detalle };
      try {
        localStorage.setItem(DETALLE_CACHE_KEY, JSON.stringify(cache));
      } catch {
        /* ignorar cuota excedida */
      }
    }
    return detalle;
  }

  async function abrirModalDetalle(producto) {
    modalDetalleTitulo.textContent = producto.productoNombre.trim();
    modalDetalleBody.innerHTML = '<p class="detalle-cargando">Cargando coberturas…</p>';
    modalDetalle.hidden = false;

    try {
      const detalle = await obtenerDetalleProducto(producto.productoId);
      const prestaciones = (detalle?.prestaciones || []).slice().sort((a, b) => a.orden - b.orden);

      modalDetalleBody.innerHTML = prestaciones.length
        ? prestaciones.map((p) => `
            <div class="prestacion-row${p.NoIncluido ? ' prestacion-row--no-incluido' : ''}">
              <span class="prestacion-row__nombre">${p.nombre.trim()}</span>
              <span class="prestacion-row__valor">${p.NoIncluido ? 'No incluido' : p.valor.trim()}</span>
            </div>
          `).join('')
        : '<p>No pudimos traer el detalle completo de este plan.</p>';
    } catch (err) {
      modalDetalleBody.innerHTML = '<p>No pudimos traer el detalle completo de este plan. Probá de nuevo en un momento.</p>';
    }
  }
  modalDetalleClose.addEventListener('click', () => {
    modalDetalle.hidden = true;
  });
  modalDetalle.addEventListener('click', (e) => {
    if (e.target === modalDetalle) modalDetalle.hidden = true;
  });

  actualizarViajerosUI();
  cargarParametros();
})();
