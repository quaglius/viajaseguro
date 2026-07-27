(function () {
  const form = document.getElementById('cotizador-form');
  const origenSelect = document.getElementById('origen');
  const destinoSelect = document.getElementById('destino');
  const pasajerosWrap = document.getElementById('pasajeros-edades');
  const addPasajeroBtn = document.getElementById('add-pasajero');
  const resultsSection = document.getElementById('resultados');
  const resultsList = document.getElementById('resultados-lista');
  const resultsMeta = document.getElementById('resultados-meta');
  const errorBox = document.getElementById('form-error');
  const submitBtn = document.getElementById('submit-cotizar');
  const modal = document.getElementById('modal-comprar');
  const modalBody = document.getElementById('modal-comprar-body');
  const modalClose = document.getElementById('modal-close');

  const CURRENCY_SYMBOLS = { 3: 'US$', 4: '€', 6: 'Bs', 7: 'AR$', 104: 'R$', 105: 'COL$', 107: 'MX$', 109: 'CLP$' };
  let formStarted = false;
  let lastCurrencyId = 3; // fallback USD si la API no informa moneda explícita

  // --- 1. Cargar orígenes / destinos reales desde la API ---------------------
  async function cargarParametros() {
    try {
      const resp = await fetch('/api/parametros');
      const data = await resp.json();

      fillSelect(origenSelect, data.paisesResidencia || data.origenes || [], 'nombre');
      fillSelect(destinoSelect, data.destinos || [], 'nombre');

      if (!data.destinos || !data.destinos.length) {
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

  // --- 2. Pasajeros dinámicos --------------------------------------------
  function addPasajeroInput() {
    const row = document.createElement('div');
    row.className = 'pasajero-row';
    row.innerHTML = `
      <input type="number" min="0" max="99" placeholder="Edad" class="edad-input" required />
      <button type="button" class="btn-remove-pasajero" aria-label="Quitar pasajero">✕</button>
    `;
    row.querySelector('.btn-remove-pasajero').addEventListener('click', () => {
      if (pasajerosWrap.children.length > 1) row.remove();
    });
    pasajerosWrap.appendChild(row);
  }
  addPasajeroBtn.addEventListener('click', addPasajeroInput);
  addPasajeroInput(); // arranca con 1 pasajero

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

    const edades = Array.from(pasajerosWrap.querySelectorAll('.edad-input'))
      .map((i) => i.value)
      .filter((v) => v !== '');

    const payload = {
      origenId: origenSelect.value,
      destinoId: destinoSelect.value,
      fechaSalida: document.getElementById('fecha-salida').value,
      fechaRegreso: document.getElementById('fecha-regreso').value,
      edades,
      email: document.getElementById('email').value,
    };

    if (!payload.origenId || !payload.destinoId || !payload.fechaSalida || !payload.fechaRegreso || !edades.length || !payload.email) {
      showError('Completá todos los campos para cotizar.');
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
      card.className = 'plan-card';
      card.innerHTML = `
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

  cargarParametros();
})();
