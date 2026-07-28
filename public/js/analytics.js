/**
 * analytics.js
 * -----------------------------------------------------------------------
 * - Inicializa GA4 (gtag.js) usando el Measurement ID inyectado server-side.
 * - Captura los parámetros UTM de la URL de entrada y los persiste en
 *   sessionStorage, para poder mandarlos como parámetros custom en TODOS
 *   los eventos del funnel (no solo en el primer pageview).
 * - Expone `window.track(eventName, params)` y helpers de e-commerce
 *   (viewItemList, selectItem, addToCart, beginCheckout) siguiendo el
 *   esquema de GA4 Enhanced Ecommerce.
 * -----------------------------------------------------------------------
 */
(function () {
  const MEASUREMENT_ID = document.documentElement.dataset.gaId || '';

  // --- 1. Cargar gtag.js dinámicamente -------------------------------------
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;

  if (MEASUREMENT_ID) {
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
    document.head.appendChild(script);
  }

  gtag('js', new Date());
  gtag('config', MEASUREMENT_ID, {
    // Enviamos los page_view manualmente después de fijar las UTMs,
    // así el primer evento ya viaja con la campaña completa.
    send_page_view: false,
  });

  // --- 2. Captura y persistencia de UTMs -----------------------------------
  const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
  const STORAGE_KEY = 'viajaseguro_utms';

  function captureUtms() {
    const params = new URLSearchParams(window.location.search);
    const found = {};
    let hasAny = false;
    UTM_KEYS.forEach((key) => {
      const value = params.get(key);
      if (value) {
        found[key] = value;
        hasAny = true;
      }
    });

    if (hasAny) {
      // Si llegan UTMs nuevas, pisan a las que hubiera de una visita anterior
      // en la misma sesión (última campaña gana, comportamiento estándar).
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(found));
      return found;
    }

    const stored = sessionStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  }

  const utms = captureUtms();

  // --- 3. Helper genérico de tracking --------------------------------------
  // Todos los eventos pasan por acá para que las UTMs viajen siempre.
  window.track = function track(eventName, params) {
    gtag('event', eventName, { ...utms, ...(params || {}) });
  };

  // Page view manual, ya con las UTMs pegadas.
  window.track('page_view', {
    page_location: window.location.href,
    page_title: document.title,
  });

  // --- 4. Helpers de e-commerce (GA4 Enhanced Ecommerce) -------------------
  // Referencia: https://developers.google.com/analytics/devguides/collection/ga4/ecommerce

  window.gaEcommerce = {
    // Se dispara cuando se muestra la lista de planes cotizados.
    viewItemList(productos, currencyCode) {
      window.track('view_item_list', {
        item_list_name: 'Resultados de cotización',
        currency: currencyCode,
        items: productos.map((p, i) => toGaItem(p, currencyCode, i)),
      });
    },

    // Se dispara cuando el usuario abre el detalle de un plan puntual.
    selectItem(producto, currencyCode, index) {
      window.track('select_item', {
        item_list_name: 'Resultados de cotización',
        items: [toGaItem(producto, currencyCode, index)],
      });
    },

    // Se dispara al clickear "Comprar" en un plan — es la señal de
    // intención de compra más fuerte que tenemos en este POC.
    addToCart(producto, currencyCode, index) {
      window.track('add_to_cart', {
        currency: currencyCode,
        value: montoDe(producto.costoFinal),
        items: [toGaItem(producto, currencyCode, index)],
      });
    },

    // Se dispara al pasar a Mercado Pago — ahí sí hay intención de pago real.
    beginCheckout(producto, currencyCode, index) {
      window.track('begin_checkout', {
        currency: currencyCode,
        value: montoDe(producto.costoFinal),
        items: [toGaItem(producto, currencyCode, index)],
      });
    },

    // Se dispara sólo cuando Cardinal confirma la emisión real del voucher
    // (ver gracias.html) — es una transacción de verdad, no simulada.
    purchase({ voucherId, valor, currencyCode, productoId, productoNombre }) {
      window.track('purchase', {
        transaction_id: voucherId,
        currency: currencyCode,
        value: valor,
        items: [{
          item_id: String(productoId),
          item_name: productoNombre,
          price: valor,
          currency: currencyCode,
          quantity: 1,
        }],
      });
    },
  };

  function montoDe(costo) {
    return costo && costo.amount !== undefined ? Number(costo.amount) : Number(costo) || 0;
  }

  function toGaItem(producto, currencyCode, index) {
    return {
      item_id: String(producto.productoId),
      item_name: producto.productoNombre,
      price: montoDe(producto.costoFinal),
      currency: currencyCode,
      index,
      quantity: 1,
    };
  }
})();
