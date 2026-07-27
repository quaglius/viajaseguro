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

  const viajerosTrigger = document.getElementById('viajeros-trigger');
  const viajerosTriggerText = document.getElementById('viajeros-trigger-text');
  const viajerosPanel = document.getElementById('viajeros-panel');
  const viajerosTotalLabel = document.getElementById('viajeros-total');
  const viajerosListoBtn = document.getElementById('viajeros-listo');
  const pasajerosSelector = document.querySelector('.pasajeros-selector');

  const CURRENCY_SYMBOLS = { 3: 'US$', 4: '€', 6: 'Bs', 7: 'AR$', 104: 'R$', 105: 'COL$', 107: 'MX$', 109: 'CLP$' };
  let formStarted = false;
  let lastCurrencyId = 3; // fallback USD si la API no informa moneda explícita

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
  async function cargarParametros() {
    try {
      const resp = await fetch('/api/parametros');
      const data = await resp.json();

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
    } catch (err) {
      showError('No se pudieron cargar los países y destinos desde Cardinal.');
    }
  }

  function fillSelect(select, items, labelKey) {
    select.innerHTML = '<option value="">Seleccioná una opción</option>';
    items.forEach((item) => {
      const opt = document.createElement('option');
      opt.value = item.id;
      opt.textContent = item[labelKey];
      select.appendChild(opt);
    });
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
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();

    const edades = edadesDesdeConteo();

    const payload = {
      origenId: origenSelect.value,
      destinoId: destinoSelect.value,
      fechaSalida: document.getElementById('fecha-salida').value,
      fechaRegreso: document.getElementById('fecha-regreso').value,
      edades,
      // El POC no le pide el email al usuario (no emite nada real); mandamos
      // uno sintético porque la API de Cardinal lo exige como obligatorio.
      email: `cotizacion.${Date.now()}@viajaseguro.app`,
    };

    if (!payload.origenId || !payload.destinoId || !payload.fechaSalida || !payload.fechaRegreso || !edades.length) {
      showError('Completá origen, destino, fechas y al menos un viajero para cotizar.');
      return;
    }

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
  });

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
  function renderResultados(cotizacion) {
    const productos = (cotizacion.productos || []).slice().sort((a, b) => a.costoFinal - b.costoFinal);

    resultsList.innerHTML = '';
    resultsMeta.textContent = `${productos.length} plan${productos.length === 1 ? '' : 'es'} disponible${productos.length === 1 ? '' : 's'}`;

    if (!productos.length) {
      resultsList.innerHTML = '<p class="sin-resultados">No encontramos planes para esta combinación de datos. Probá ajustando el destino o las fechas.</p>';
    }

    productos.forEach((producto, index) => {
      const card = document.createElement('article');
      card.className = 'plan-card' + (index === 0 ? ' plan-card--destacado' : '');
      card.innerHTML = `
        ${index === 0 ? '<span class="plan-card__badge">Mejor precio</span>' : ''}
        <div class="plan-card__header">
          <h3>${producto.productoNombre}</h3>
          ${producto.costoLista && producto.costoLista !== producto.costoFinal
            ? `<span class="plan-card__precio-lista">${formatMoney(producto.costoLista)}</span>`
            : ''}
        </div>
        <p class="plan-card__precio">${formatMoney(producto.costoFinal)}
          <span class="plan-card__precio-detalle">total, todos los pasajeros</span>
        </p>
        ${producto.prestaciones && producto.prestaciones.length
          ? `<ul class="plan-card__prestaciones">
              ${producto.prestaciones.slice(0, 4).map((p) => `<li>${p.nombre}</li>`).join('')}
            </ul>`
          : ''}
        <button type="button" class="btn-comprar" data-index="${index}">Comprar este plan</button>
      `;
      card.querySelector('.btn-comprar').addEventListener('click', () => {
        window.gaEcommerce.addToCart(producto, lastCurrencyId, index);
        abrirModalComprar(producto, index);
      });
      resultsList.appendChild(card);
    });

    resultsSection.hidden = false;
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

    window.gaEcommerce.viewItemList(productos, lastCurrencyId);
  }

  function formatMoney(value) {
    return `${CURRENCY_SYMBOLS[lastCurrencyId] || '$'} ${Number(value).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;
  }

  // --- 6. Modal "Comprar" (sin emitir nada de verdad) -----------------------
  function abrirModalComprar(producto, index) {
    modalBody.innerHTML = `
      <p>Acá se emitiría el voucher directo — este POC no emite pólizas reales.</p>
      <p class="modal-plan-nombre">${producto.productoNombre} · ${formatMoney(producto.costoFinal)}</p>
    `;
    modal.hidden = false;
    window.gaEcommerce.beginCheckout(producto, lastCurrencyId, index);
  }
  modalClose.addEventListener('click', () => {
    modal.hidden = true;
  });
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.hidden = true;
  });

  actualizarViajerosUI();
  cargarParametros();
})();
