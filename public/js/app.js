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

  const filtrosEmpresasBox = document.getElementById('filtros-empresas');
  const filtroCoberturaSelect = document.getElementById('filtro-cobertura');
  const filtroPrecioDesdeInput = document.getElementById('filtro-precio-desde');
  const filtroPrecioHastaInput = document.getElementById('filtro-precio-hasta');
  const ordenSelect = document.getElementById('orden-resultados');
  const filtrosLimpiarBtn = document.getElementById('filtros-limpiar');

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
  let parametrosCache = null; // último /api/parametros — para tiposDocumentos y paisesResidencia del form de pasajeros

  // --- Comparador multi-empresa ---------------------------------------------
  // Cardinal siempre sale de la API real (/api/cotizar). Las demás todavía no
  // tienen integración — sus precios salen de dummy_asistencia_viajero.json,
  // servido por /api/comparador_dummy, y son de referencia hasta que se
  // sumen APIs reales. El orden acá define el orden por defecto ("relevancia").
  const ORDEN_EMPRESAS = ['cardinal', 'assistcard', 'coris', 'universal', 'pax', 'europassistance'];
  const EMPRESAS = {
    cardinal: { nombre: 'Cardinal Assistance', logo: logoDe('cardinalassistance.com') },
    assistcard: { nombre: 'Assist Card', logo: logoDe('assistcard.com') },
    coris: { nombre: 'Coris Asistencia al Viajero', logo: logoDe('coris.com.ar') },
    universal: { nombre: 'Universal Assistance', logo: logoDe('universal-assistance.com') },
    pax: { nombre: 'Pax Assistance', logo: logoDe('paxassistance.com') },
    europassistance: { nombre: 'Europ Assistance', logo: logoDe('europ-assistance.com.ar') },
  };
  function logoDe(dominio) {
    return `https://www.google.com/s2/favicons?domain=${dominio}&sz=64`;
  }

  let comparadorDummyCache = null;
  async function obtenerComparadorDummy() {
    if (comparadorDummyCache) return comparadorDummyCache;
    try {
      const resp = await fetch('/api/comparador_dummy');
      const data = await resp.json();
      comparadorDummyCache = data.empresas || {};
    } catch {
      comparadorDummyCache = {};
    }
    return comparadorDummyCache;
  }

  let listaComparadorCompleta = []; // sin filtrar/ordenar
  const filtros = { empresasExcluidas: new Set(), coberturaMin: null, precioDesde: null, precioHasta: null, orden: 'relevancia' };

  function extraerCobertura(prestaciones) {
    if (!prestaciones || !prestaciones.length) return null;
    const nombresCobertura = /tope m.ximo global|asistencia m.dica por accidente|^asistencia m.dica por enfermedad$/i;
    let max = null;
    prestaciones.forEach((p) => {
      if (!nombresCobertura.test(p.nombre.trim())) return;
      const match = String(p.valor).match(/[\d.]+/);
      if (!match) return;
      const n = Number(match[0].replace(/\./g, ''));
      if (!Number.isNaN(n) && (max === null || n > max)) max = n;
    });
    return max;
  }

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
  const PARAMETROS_CACHE_KEY = 'vs_parametros_cache_v2'; // v2: ahora incluye tiposDocumentos
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
      parametrosCache = data;

      // El endpoint /parametros de Cardinal todavía no lista `destinos` para
      // este agente aunque /cotizar ya los acepta (desfasaje conocido de su
      // lado), así que usamos el mismo catálogo de países de `paisesResidencia`
      // como destino — es el mismo listado de países, no un dato inventado.
      const destinos = (data.destinos && data.destinos.length) ? data.destinos : data.paisesResidencia;

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
  // El origen queda fijo en Argentina, así que no forma parte de la URL.
  const PARAM_KEYS = { destino: 'destino', salida: 'salida', regreso: 'regreso', adultos: 'adultos', menores: 'menores', seniors: 'seniors' };

  function aplicarBusquedaDesdeUrl() {
    const p = new URLSearchParams(location.search);
    const destinoId = p.get(PARAM_KEYS.destino);
    const salida = p.get(PARAM_KEYS.salida);
    const regreso = p.get(PARAM_KEYS.regreso);
    const adultos = parseInt(p.get(PARAM_KEYS.adultos), 10) || 0;
    const menores = parseInt(p.get(PARAM_KEYS.menores), 10) || 0;
    const seniors = parseInt(p.get(PARAM_KEYS.seniors), 10) || 0;

    if (destinoId) destinoSelect.value = destinoId;
    if (salida) fechaSalidaInput.value = salida;
    if (regreso) fechaRegresoInput.value = regreso;
    if (adultos || menores || seniors) {
      conteoViajeros.adultos = adultos;
      conteoViajeros.menores = menores;
      conteoViajeros.seniors = seniors;
      actualizarViajerosUI();
    }

    const busquedaCompleta = destinoSelect.value && salida && regreso && (adultos + menores + seniors) > 0;
    if (busquedaCompleta) ejecutarCotizacion();
  }

  function actualizarUrlConBusqueda(payload) {
    const p = new URLSearchParams();
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
      search_term: `Argentina → ${destinoSelect.selectedOptions[0]?.textContent}`,
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

      await renderResultados(data.cotizacion);
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

  async function renderResultados(cotizacion) {
    const productosCardinal = (cotizacion.productos || []).map((producto) => ({
      empresaId: 'cardinal',
      esReal: true,
      productoId: producto.productoId,
      productoNombre: producto.productoNombre.trim(),
      costoLocal: producto.costoFinalMonedaPais || producto.costoFinal,
      costoLocalLista: producto.costoListaMonedaPais || producto.costoLista,
      costoFinal: producto.costoFinal,
      prestaciones: producto.prestaciones || [],
      raw: producto,
    }));

    const otrasEmpresas = await obtenerComparadorDummy();
    const productosOtros = Object.entries(otrasEmpresas).flatMap(([empresaId, empresa]) =>
      (empresa.cotizar?.cotizacion?.productos || []).map((producto) => ({
        empresaId,
        esReal: false,
        productoId: producto.productoId,
        productoNombre: producto.productoNombre.trim(),
        costoLocal: producto.costoFinal,
        costoLocalLista: producto.costoLista,
        costoFinal: producto.costoFinal,
        prestaciones: producto.prestaciones || [],
        raw: producto,
      }))
    );

    listaComparadorCompleta = [...productosCardinal, ...productosOtros].map((item) => ({
      ...item,
      cobertura: extraerCobertura(item.prestaciones),
      descuento: pctOff(item.costoLocalLista, item.costoLocal),
    }));

    filtros.empresasExcluidas = new Set();
    filtroCoberturaSelect.value = '';
    filtroPrecioDesdeInput.value = '';
    filtroPrecioHastaInput.value = '';
    ordenSelect.value = 'relevancia';
    filtros.coberturaMin = null;
    filtros.precioDesde = null;
    filtros.precioHasta = null;
    filtros.orden = 'relevancia';

    renderFiltrosEmpresas();
    renderizarListaFiltrada();

    resultsSection.hidden = false;
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderFiltrosEmpresas() {
    const empresasPresentes = [...new Set(listaComparadorCompleta.map((i) => i.empresaId))]
      .sort((a, b) => ORDEN_EMPRESAS.indexOf(a) - ORDEN_EMPRESAS.indexOf(b));

    filtrosEmpresasBox.innerHTML = empresasPresentes.map((id) => {
      const empresa = EMPRESAS[id] || { nombre: id, logo: '' };
      const activo = !filtros.empresasExcluidas.has(id);
      return `
        <button type="button" class="chip-empresa${activo ? ' chip-empresa--activo' : ''}" data-empresa="${id}">
          <img src="${empresa.logo}" alt="" class="chip-empresa__logo" onerror="this.remove()" />
          ${empresa.nombre}
        </button>
      `;
    }).join('');
  }

  function aplicarFiltrosYOrden(lista) {
    let resultado = lista.filter((item) => {
      if (filtros.empresasExcluidas.has(item.empresaId)) return false;
      if (filtros.coberturaMin && (!item.cobertura || item.cobertura < filtros.coberturaMin)) return false;
      const precio = monto(item.costoLocal);
      if (filtros.precioDesde !== null && precio < filtros.precioDesde) return false;
      if (filtros.precioHasta !== null && precio > filtros.precioHasta) return false;
      return true;
    });

    switch (filtros.orden) {
      case 'precio_asc':
        resultado.sort((a, b) => monto(a.costoLocal) - monto(b.costoLocal));
        break;
      case 'precio_desc':
        resultado.sort((a, b) => monto(b.costoLocal) - monto(a.costoLocal));
        break;
      case 'bonificacion':
        resultado.sort((a, b) => b.descuento - a.descuento);
        break;
      default: // relevancia: Cardinal siempre primero, adentro de cada empresa el más barato primero
        resultado.sort((a, b) => {
          const ia = ORDEN_EMPRESAS.indexOf(a.empresaId);
          const ib = ORDEN_EMPRESAS.indexOf(b.empresaId);
          if (ia !== ib) return ia - ib;
          return monto(a.costoLocal) - monto(b.costoLocal);
        });
    }
    return resultado;
  }

  function productoMasBaratoDeCardinal() {
    const cardinalItems = listaComparadorCompleta.filter((i) => i.empresaId === 'cardinal');
    if (!cardinalItems.length) return null;
    return cardinalItems.reduce((min, i) => (monto(i.costoLocal) < monto(min.costoLocal) ? i : min));
  }

  function renderizarListaFiltrada() {
    const lista = aplicarFiltrosYOrden(listaComparadorCompleta);
    const recomendado = productoMasBaratoDeCardinal();

    resultsList.innerHTML = '';
    resultsMeta.textContent = `${lista.length} plan${lista.length === 1 ? '' : 'es'} disponible${lista.length === 1 ? '' : 's'}`;

    if (!lista.length) {
      resultsList.innerHTML = '<p class="sin-resultados">Ningún plan cumple estos filtros. Probá ajustándolos.</p>';
      return;
    }

    lista.forEach((item, index) => {
      const empresa = EMPRESAS[item.empresaId] || { nombre: item.empresaId, logo: '' };
      const esRecomendado = recomendado && item.empresaId === recomendado.empresaId && item.productoId === recomendado.productoId;

      const card = document.createElement('article');
      card.className = 'plan-card' + (esRecomendado ? ' plan-card--recomendado' : '');
      card.innerHTML = `
        ${esRecomendado ? '<span class="plan-card__badge">Recomendado</span>' : ''}
        <div class="plan-card__empresa">
          <img src="${empresa.logo}" alt="" class="plan-card__empresa-logo" onerror="this.remove()" />
          <span>${empresa.nombre}</span>
          ${!item.esReal ? '<span class="plan-card__proximamente">Próximamente</span>' : ''}
        </div>
        <div class="plan-card__header">
          <h3>${item.productoNombre}</h3>
          ${item.descuento ? `<span class="plan-card__off">${item.descuento}% OFF</span>` : ''}
        </div>
        <div class="plan-card__precio-wrap">
          ${item.descuento ? `<span class="plan-card__precio-lista">Total ${formatMoney(item.costoLocalLista)}</span>` : ''}
          <p class="plan-card__precio">${formatMoney(item.costoLocal)}
            <span class="plan-card__precio-detalle">total · ${formatMoney(item.costoFinal)} · todos los pasajeros</span>
          </p>
        </div>
        ${item.prestaciones.length
          ? `<div class="plan-card__prestaciones">
              ${item.prestaciones.slice(0, 7).map((p) => `
                <div class="prestacion-row">
                  <span class="prestacion-row__nombre">${p.nombre.trim()}</span>
                  <span class="prestacion-row__valor">${p.valor.trim()}</span>
                </div>
              `).join('')}
            </div>`
          : ''}
        <button type="button" class="btn-ver-mas">Ver cobertura completa →</button>
        ${item.esReal
          ? `<button type="button" class="btn-comprar">Comprar este plan</button>`
          : `<button type="button" class="btn-comprar btn-comprar--proximamente" disabled>Próximamente disponible</button>`}
      `;
      card.querySelector('.btn-ver-mas').addEventListener('click', () => {
        abrirModalDetalle(item);
      });
      if (item.esReal) {
        card.querySelector('.btn-comprar').addEventListener('click', () => {
          window.gaEcommerce.addToCart(item.raw, monedaIso(item.costoFinal), index);
          abrirModalComprar(item.raw, index);
        });
      }
      resultsList.appendChild(card);
    });

    const productosGa = lista.filter((i) => i.esReal).map((i) => i.raw);
    if (productosGa.length) window.gaEcommerce.viewItemList(productosGa, monedaIso(productosGa[0].costoFinal));
  }

  filtrosEmpresasBox.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip-empresa');
    if (!chip) return;
    const id = chip.dataset.empresa;
    filtros.empresasExcluidas.has(id) ? filtros.empresasExcluidas.delete(id) : filtros.empresasExcluidas.add(id);
    renderFiltrosEmpresas();
    renderizarListaFiltrada();
  });

  filtroCoberturaSelect.addEventListener('change', () => {
    filtros.coberturaMin = filtroCoberturaSelect.value ? Number(filtroCoberturaSelect.value) : null;
    renderizarListaFiltrada();
  });
  filtroPrecioDesdeInput.addEventListener('input', () => {
    filtros.precioDesde = filtroPrecioDesdeInput.value !== '' ? Number(filtroPrecioDesdeInput.value) : null;
    renderizarListaFiltrada();
  });
  filtroPrecioHastaInput.addEventListener('input', () => {
    filtros.precioHasta = filtroPrecioHastaInput.value !== '' ? Number(filtroPrecioHastaInput.value) : null;
    renderizarListaFiltrada();
  });
  ordenSelect.addEventListener('change', () => {
    filtros.orden = ordenSelect.value;
    renderizarListaFiltrada();
  });
  filtrosLimpiarBtn.addEventListener('click', () => {
    filtros.empresasExcluidas = new Set();
    filtros.coberturaMin = null;
    filtros.precioDesde = null;
    filtros.precioHasta = null;
    filtros.orden = 'relevancia';
    filtroCoberturaSelect.value = '';
    filtroPrecioDesdeInput.value = '';
    filtroPrecioHastaInput.value = '';
    ordenSelect.value = 'relevancia';
    renderFiltrosEmpresas();
    renderizarListaFiltrada();
  });

  function monedaIso(costo) {
    return (costo && MONEDAS[costo.currency]?.iso) || 'USD';
  }

  function formatMoney(costo) {
    const simbolo = (costo && MONEDAS[costo.currency]?.simbolo) || '$';
    return `${simbolo} ${monto(costo).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;
  }

  // --- 6. Modal "Comprar" → form de pasajeros → repreguntar precio → pago ---
  // Los "viajeros" elegidos en el buscador usaban una edad representativa por
  // franja (ver EDAD_REPRESENTATIVA) sólo para poder cotizar sin pedir datos
  // de más. Acá sí necesitamos la edad real de cada uno — así que antes de
  // pagar volvemos a cotizar con las fechaNacimiento reales para asegurarnos
  // de emitir por el precio correcto (Cardinal exige que la cantidad y edad
  // de los pasajeros de /emitir coincida exactamente con la cotización).
  let pasajerosContext = null; // { producto, index } del plan elegido en la lista de resultados

  // Cardinal devuelve "Documento" a secas para el DNI — se lo etiqueta más
  // claro para el usuario sin tocar el id real que se manda a la API.
  const ETIQUETA_TIPO_DOCUMENTO = { Documento: 'DNI' };

  function opcionesSelect(items, valorPorDefecto, etiquetas) {
    return (items || [])
      .map((item) => {
        const label = (etiquetas && etiquetas[item.nombre]) || item.nombre;
        return `<option value="${item.id}"${String(item.id) === String(valorPorDefecto) ? ' selected' : ''}>${label}</option>`;
      })
      .join('');
  }

  function etiquetasPasajeros() {
    const etiquetas = { adultos: 'Adulto', menores: 'Menor', seniors: 'Senior' };
    return Object.entries(conteoViajeros).flatMap(([tipo, cantidad]) => Array(cantidad).fill(etiquetas[tipo]));
  }

  // Datos de prueba para completar el form rápido en testing — igual quedan
  // editables, es sólo un valor por defecto.
  const NOMBRES_DUMMY = ['Juan', 'María', 'Carlos', 'Lucía', 'Martín', 'Sofía', 'Diego', 'Valentina'];
  const APELLIDOS_DUMMY = ['Pérez', 'Gómez', 'Fernández', 'López', 'Díaz', 'Romero', 'Suárez', 'Acosta'];

  function datosDummyPasajero(i) {
    const nombre = NOMBRES_DUMMY[i % NOMBRES_DUMMY.length];
    const apellido = APELLIDOS_DUMMY[i % APELLIDOS_DUMMY.length];
    const sinAcentos = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    return {
      nombre,
      apellido,
      email: `${sinAcentos(nombre.toLowerCase())}.${sinAcentos(apellido.toLowerCase())}@viajaseguro.app`,
      telefono: `+5491155501${String(100 + i).slice(-3)}`,
      nroDocumento: String(30000000 + i * 1111),
      fechaNacimiento: '1990-05-15',
      domicilio: 'Av. Siempre Viva 123',
      localidad: 'CABA',
      emergenciaNombre: 'Ana',
      emergenciaApellido: 'Torres',
      emergenciaTelefono: '+5491155559999',
    };
  }

  function renderPasajeroFieldset(i, etiquetaTipo) {
    const tiposDocumentos = parametrosCache?.tiposDocumentos || [];
    const paises = parametrosCache?.paisesResidencia || [];
    const dniId = tiposDocumentos.find((t) => t.nombre === 'Documento')?.id ?? tiposDocumentos[0]?.id;
    const d = datosDummyPasajero(i);
    return `
      <fieldset class="pasajero-fieldset" data-pasajero="${i}">
        <legend>Pasajero ${i + 1}${etiquetaTipo ? ` · ${etiquetaTipo}` : ''}</legend>
        <div class="pasajero-grid">
          <div class="field"><label>Nombre</label><input type="text" data-campo="nombre" required maxlength="100" value="${d.nombre}" /></div>
          <div class="field"><label>Apellido</label><input type="text" data-campo="apellido" required maxlength="100" value="${d.apellido}" /></div>
          <div class="field"><label>Email</label><input type="email" data-campo="email" required maxlength="100" value="${d.email}" /></div>
          <div class="field"><label>Teléfono</label><input type="tel" data-campo="telefono" required maxlength="50" value="${d.telefono}" /></div>
          <div class="field"><label>Tipo de documento</label><select data-campo="tipoDocumentoId" required><option value="">Seleccioná</option>${opcionesSelect(tiposDocumentos, dniId, ETIQUETA_TIPO_DOCUMENTO)}</select></div>
          <div class="field"><label>N° de documento</label><input type="text" data-campo="nroDocumento" required maxlength="20" value="${d.nroDocumento}" /></div>
          <div class="field"><label>Fecha de nacimiento</label><input type="date" data-campo="fechaNacimiento" required value="${d.fechaNacimiento}" /></div>
          <div class="field"><label>País de residencia</label><select data-campo="paisId" required><option value="">Seleccioná</option>${opcionesSelect(paises, 6)}</select></div>
          <div class="field pasajero-grid__ancho"><label>Domicilio</label><input type="text" data-campo="domicilio" required maxlength="250" value="${d.domicilio}" /></div>
          <div class="field"><label>Localidad</label><input type="text" data-campo="localidad" required maxlength="100" value="${d.localidad}" /></div>
          <div class="field"><label>Emergencia — Nombre</label><input type="text" data-campo="emergenciaNombre" required maxlength="100" value="${d.emergenciaNombre}" /></div>
          <div class="field"><label>Emergencia — Apellido</label><input type="text" data-campo="emergenciaApellido" required maxlength="100" value="${d.emergenciaApellido}" /></div>
          <div class="field"><label>Emergencia — Teléfono</label><input type="tel" data-campo="emergenciaTelefono" required maxlength="50" value="${d.emergenciaTelefono}" /></div>
        </div>
      </fieldset>
    `;
  }

  function abrirModalComprar(producto, index) {
    pasajerosContext = { producto, index };
    const etiquetas = etiquetasPasajeros();
    const n = etiquetas.length || 1;

    modalBody.innerHTML = `
      <form id="pasajeros-form" novalidate>
        ${Array.from({ length: n }, (_, i) => renderPasajeroFieldset(i, etiquetas[i])).join('')}
        <div class="field">
          <label>Observaciones (opcional)</label>
          <textarea data-campo="observaciones" rows="2" maxlength="250"></textarea>
        </div>
        <p id="pasajeros-form-error" class="form-error" hidden></p>
        <div class="form-actions">
          <button type="submit" class="btn-primary" id="pasajeros-continuar">Confirmar y ver precio final</button>
        </div>
      </form>
    `;
    modal.hidden = false;
    document.getElementById('pasajeros-form').addEventListener('submit', onSubmitPasajeros);
  }

  function edadEn(fechaNacimiento, fechaReferencia) {
    const nacimiento = new Date(fechaNacimiento);
    const referencia = new Date(fechaReferencia);
    let edad = referencia.getFullYear() - nacimiento.getFullYear();
    const diffMes = referencia.getMonth() - nacimiento.getMonth();
    if (diffMes < 0 || (diffMes === 0 && referencia.getDate() < nacimiento.getDate())) edad--;
    return edad;
  }

  function leerPasajerosDelForm(formEl) {
    return Array.from(formEl.querySelectorAll('.pasajero-fieldset')).map((fs) => {
      const get = (campo) => fs.querySelector(`[data-campo="${campo}"]`).value.trim();
      return {
        nombre: get('nombre'),
        apellido: get('apellido'),
        email: get('email'),
        telefono: get('telefono'),
        tipoDocumentoId: Number(get('tipoDocumentoId')),
        nroDocumento: get('nroDocumento'),
        fechaNacimiento: get('fechaNacimiento'),
        paisId: Number(get('paisId')),
        domicilio: get('domicilio'),
        localidad: get('localidad'),
        emergenciaNombre: get('emergenciaNombre'),
        emergenciaApellido: get('emergenciaApellido'),
        emergenciaTelefono: get('emergenciaTelefono'),
      };
    });
  }

  async function onSubmitPasajeros(e) {
    e.preventDefault();
    const formEl = e.target;
    const errorBoxPax = document.getElementById('pasajeros-form-error');
    errorBoxPax.hidden = true;

    if (!formEl.checkValidity()) {
      formEl.reportValidity();
      return;
    }

    const pasajeros = leerPasajerosDelForm(formEl);
    const observaciones = formEl.querySelector('[data-campo="observaciones"]').value.trim();
    const fechaSalida = fechaSalidaInput.value;
    const edadesReales = pasajeros.map((p) => edadEn(p.fechaNacimiento, fechaSalida));

    const continuarBtn = document.getElementById('pasajeros-continuar');
    continuarBtn.disabled = true;
    continuarBtn.textContent = 'Verificando precio final…';

    try {
      const resp = await fetch('/api/cotizar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origenId: origenSelect.value,
          destinoId: destinoSelect.value,
          fechaSalida,
          fechaRegreso: fechaRegresoInput.value,
          edades: edadesReales,
          email: pasajeros[0].email,
        }),
      });
      const data = await resp.json();

      if (data.resultado !== 'ok') {
        errorBoxPax.textContent = (data.mensajes && data.mensajes.join(' ')) || 'No pudimos recalcular el precio final.';
        errorBoxPax.hidden = false;
        return;
      }

      const nombreBuscado = pasajerosContext.producto.productoNombre.trim();
      const productoFinal = (data.cotizacion.productos || []).find((p) => p.productoNombre.trim() === nombreBuscado);

      if (!productoFinal) {
        errorBoxPax.textContent = 'Con las edades reales de los pasajeros este plan ya no está disponible. Cerrá esta ventana y volvé a cotizar.';
        errorBoxPax.hidden = false;
        return;
      }

      await mostrarConfirmacionPago({ cotizacionGuid: data.cotizacion.guid, producto: productoFinal, pasajeros, observaciones });
    } catch (err) {
      errorBoxPax.textContent = 'No pudimos conectar con Cardinal para confirmar el precio. Probá de nuevo.';
      errorBoxPax.hidden = false;
    } finally {
      continuarBtn.disabled = false;
      continuarBtn.textContent = 'Confirmar y ver precio final';
    }
  }

  let mpConfiguradoCache = null;
  async function mercadoPagoConfigurado() {
    if (mpConfiguradoCache !== null) return mpConfiguradoCache;
    try {
      const resp = await fetch('/api/config');
      const data = await resp.json();
      mpConfiguradoCache = !!data.mpConfigurado;
    } catch {
      mpConfiguradoCache = false;
    }
    return mpConfiguradoCache;
  }

  async function mostrarConfirmacionPago({ cotizacionGuid, producto, pasajeros, observaciones }) {
    const costoLocal = producto.costoFinalMonedaPais || producto.costoFinal;
    const mpListo = await mercadoPagoConfigurado();

    modalBody.innerHTML = `
      <div class="confirmacion-pago">
        <p class="confirmacion-pago__plan">${producto.productoNombre.trim()}</p>
        <p class="confirmacion-pago__precio">${formatMoney(costoLocal)}
          <span class="plan-card__precio-detalle">total · ${formatMoney(producto.costoFinal)} · ${pasajeros.length} pasajero${pasajeros.length === 1 ? '' : 's'}</span>
        </p>
        ${mpListo
          ? `<p class="confirmacion-pago__nota">Vas a pagar en Mercado Pago y, apenas se acredite, emitimos el voucher automáticamente.</p>
             <p id="pago-error" class="form-error" hidden></p>
             <button type="button" id="btn-pagar" class="btn-primary">Pagar con Mercado Pago</button>`
          : `<p class="confirmacion-pago__nota confirmacion-pago__nota--warn">
               Mercado Pago todavía no está configurado en este entorno. Este botón emite el voucher
               directo en Cardinal <strong>sin cobrar nada</strong> — es sólo para poder probar la
               emisión real mientras se carga el pago.
             </p>
             <p id="pago-error" class="form-error" hidden></p>
             <button type="button" id="btn-pagar" class="btn-primary">Emitir sin pagar (modo prueba)</button>`}
      </div>
    `;

    document.getElementById('btn-pagar').addEventListener('click', () => {
      mpListo
        ? pagarConMercadoPago({ cotizacionGuid, producto, pasajeros, observaciones, costoLocal })
        : emitirSinPago({ cotizacionGuid, producto, pasajeros, observaciones });
    });
  }

  async function pagarConMercadoPago({ cotizacionGuid, producto, pasajeros, observaciones, costoLocal }) {
    const btnPagar = document.getElementById('btn-pagar');
    const pagoError = document.getElementById('pago-error');
    pagoError.hidden = true;
    btnPagar.disabled = true;
    btnPagar.textContent = 'Redirigiendo a Mercado Pago…';

    window.gaEcommerce.beginCheckout(producto, monedaIso(producto.costoFinal), pasajerosContext.index);

    try {
      const resp = await fetch('/api/crear_pago', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cotizacionGuid,
          productoSeleccionadoId: producto.productoId,
          productoNombre: producto.productoNombre.trim(),
          // montoCotizado es el valor de control que Cardinal compara contra
          // la cotización al emitir — usamos el mismo costoFinal (USD) que
          // devuelve /cotizar como base, ya que es "el monto obtenido en la
          // cotización" según la doc.
          montoCotizado: monto(producto.costoFinal),
          montoPagoLocal: monto(costoLocal),
          observaciones,
          pasajeros,
        }),
      });
      const data = await resp.json();

      if (data.resultado !== 'ok' || !data.initPoint) {
        pagoError.textContent = (data.mensajes && data.mensajes.join(' ')) || 'No pudimos iniciar el pago.';
        pagoError.hidden = false;
        btnPagar.disabled = false;
        btnPagar.textContent = 'Pagar con Mercado Pago';
        return;
      }

      window.location.href = data.initPoint;
    } catch (err) {
      pagoError.textContent = 'No pudimos conectar con Mercado Pago. Probá de nuevo.';
      pagoError.hidden = false;
      btnPagar.disabled = false;
      btnPagar.textContent = 'Pagar con Mercado Pago';
    }
  }

  // Atajo de emisión real sin pago — ver /api/emitir_sin_pago. Se desactiva
  // solo (403) apenas se configure MP_ACCESS_TOKEN en el servidor.
  async function emitirSinPago({ cotizacionGuid, producto, pasajeros, observaciones }) {
    const btnPagar = document.getElementById('btn-pagar');
    const pagoError = document.getElementById('pago-error');
    pagoError.hidden = true;
    btnPagar.disabled = true;
    btnPagar.textContent = 'Emitiendo…';

    try {
      const resp = await fetch('/api/emitir_sin_pago', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cotizacionGuid,
          productoSeleccionadoId: producto.productoId,
          montoCotizado: monto(producto.costoFinal),
          observaciones,
          pasajeros,
        }),
      });
      const data = await resp.json();

      if (data.resultado !== 'ok') {
        pagoError.textContent = (data.mensajes && data.mensajes.join(' ')) || 'No pudimos emitir el voucher.';
        pagoError.hidden = false;
        btnPagar.disabled = false;
        btnPagar.textContent = 'Emitir sin pagar (modo prueba)';
        return;
      }

      mostrarVoucherEmitido(data.vouchers || [], producto);
    } catch (err) {
      pagoError.textContent = 'No pudimos conectar con Cardinal. Probá de nuevo.';
      pagoError.hidden = false;
      btnPagar.disabled = false;
      btnPagar.textContent = 'Emitir sin pagar (modo prueba)';
    }
  }

  function mostrarVoucherEmitido(vouchers, producto) {
    modalBody.innerHTML = `
      <div class="confirmacion-pago">
        <p class="confirmacion-pago__plan">¡Voucher emitido! 🎉</p>
        <div class="gracias-vouchers">
          ${vouchers.map((v) => `
            <div class="voucher-row">
              <div>
                <strong>${v.nombre} ${v.apellido}</strong>
                <span class="voucher-row__nro">Voucher ${v.nroVoucher}</span>
              </div>
              ${v.linkImprimir ? `<a href="${v.linkImprimir}" target="_blank" rel="noopener" class="btn-listo">Ver voucher →</a>` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    `;

    const valorTotal = vouchers.reduce((acc, v) => acc + Number(v.tarifa || 0), 0);
    if (vouchers.length) {
      window.gaEcommerce.purchase({
        voucherId: vouchers.map((v) => v.nroVoucher).join(','),
        valor: valorTotal,
        currencyCode: 'ARS',
        productoId: producto.productoId,
        productoNombre: producto.productoNombre.trim(),
      });
    }
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

  async function abrirModalDetalle(item) {
    modalDetalleTitulo.textContent = item.productoNombre;
    modalDetalleBody.innerHTML = '<p class="detalle-cargando">Cargando coberturas…</p>';
    modalDetalle.hidden = false;

    try {
      // Cardinal: el detalle completo (~70 prestaciones) sale de un endpoint
      // aparte, cacheado. Las demás empresas ya traen su lista completa en el
      // JSON dummy, no hace falta pedir nada más.
      const prestaciones = item.esReal
        ? ((await obtenerDetalleProducto(item.raw.productoId))?.prestaciones || []).slice().sort((a, b) => a.orden - b.orden)
        : item.prestaciones.slice().sort((a, b) => a.orden - b.orden);

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
