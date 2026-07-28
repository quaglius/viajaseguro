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
  let parametrosCache = null; // último /api/parametros — para tiposDocumentos y paisesResidencia del form de pasajeros

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

      mostrarConfirmacionPago({ cotizacionGuid: data.cotizacion.guid, producto: productoFinal, pasajeros, observaciones });
    } catch (err) {
      errorBoxPax.textContent = 'No pudimos conectar con Cardinal para confirmar el precio. Probá de nuevo.';
      errorBoxPax.hidden = false;
    } finally {
      continuarBtn.disabled = false;
      continuarBtn.textContent = 'Confirmar y ver precio final';
    }
  }

  function mostrarConfirmacionPago({ cotizacionGuid, producto, pasajeros, observaciones }) {
    const costoLocal = producto.costoFinalMonedaPais || producto.costoFinal;

    modalBody.innerHTML = `
      <div class="confirmacion-pago">
        <p class="confirmacion-pago__plan">${producto.productoNombre.trim()}</p>
        <p class="confirmacion-pago__precio">${formatMoney(costoLocal)}
          <span class="plan-card__precio-detalle">total · ${formatMoney(producto.costoFinal)} · ${pasajeros.length} pasajero${pasajeros.length === 1 ? '' : 's'}</span>
        </p>
        <p class="confirmacion-pago__nota">Vas a pagar en Mercado Pago y, apenas se acredite, emitimos el voucher automáticamente.</p>
        <p id="pago-error" class="form-error" hidden></p>
        <button type="button" id="btn-pagar" class="btn-primary">Pagar con Mercado Pago</button>
      </div>
    `;

    document.getElementById('btn-pagar').addEventListener('click', async () => {
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
    });
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
