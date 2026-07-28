(function () {
  const box = document.getElementById('gracias-box');
  const titulo = document.getElementById('gracias-titulo');
  const texto = document.getElementById('gracias-texto');
  const vouchersBox = document.getElementById('gracias-vouchers');

  const params = new URLSearchParams(window.location.search);
  const paymentId = params.get('payment_id') || params.get('collection_id');

  if (!paymentId) {
    mostrarError('No encontramos información de ningún pago en este link.');
    return;
  }

  async function consultarEstado(intento) {
    try {
      const resp = await fetch(`/api/completar_pago?paymentId=${encodeURIComponent(paymentId)}`);
      const data = await resp.json();

      if (data.resultado !== 'ok') {
        mostrarError((data.mensajes && data.mensajes.join(' ')) || 'No pudimos confirmar tu pago.');
        return;
      }

      switch (data.estado) {
        case 'emitido':
          mostrarVouchers(data.vouchers || []);
          return;
        case 'approved':
        case 'en_proceso':
          if (intento < 6) {
            setTimeout(() => consultarEstado(intento + 1), 2000);
          } else {
            mostrarError('Tu pago se acreditó pero todavía estamos emitiendo el voucher. Te va a llegar por mail en cuanto termine.');
          }
          return;
        case 'pending':
        case 'in_process':
          titulo.textContent = 'Tu pago está pendiente';
          texto.textContent = 'Todavía no se acreditó — no hace falta que hagas nada más, esta página se va a actualizar sola.';
          setTimeout(() => consultarEstado(intento + 1), 4000);
          return;
        case 'error_emision':
          mostrarError(
            'Tu pago se acreditó pero hubo un problema al emitir el voucher con Cardinal. ' +
            'Escribinos con tu comprobante de pago y lo resolvemos a mano.' +
            (data.mensajes ? ` (${data.mensajes.join(' ')})` : '')
          );
          return;
        default:
          mostrarError('El pago no se acreditó (estado: ' + data.estado + ').');
      }
    } catch (err) {
      mostrarError('No pudimos conectar con el servidor para confirmar tu pago.');
    }
  }

  function mostrarError(mensaje) {
    box.classList.add('gracias-box--error');
    titulo.textContent = 'Necesitamos revisar tu pago';
    texto.textContent = mensaje;
  }

  function mostrarVouchers(vouchers) {
    box.classList.add('gracias-box--ok');
    titulo.textContent = '¡Listo! Tu asistencia está emitida 🎉';
    texto.textContent = 'Te mandamos una copia por mail a cada pasajero. Guardá estos links:';

    vouchersBox.innerHTML = vouchers.map((v) => `
      <div class="voucher-row">
        <div>
          <strong>${v.nombre} ${v.apellido}</strong>
          <span class="voucher-row__nro">Voucher ${v.nroVoucher}</span>
        </div>
        ${v.linkImprimir ? `<a href="${v.linkImprimir}" target="_blank" rel="noopener" class="btn-listo">Ver voucher →</a>` : ''}
      </div>
    `).join('');

    const valorTotal = vouchers.reduce((acc, v) => acc + Number(v.tarifa || 0), 0);
    if (window.gaEcommerce && vouchers.length) {
      window.gaEcommerce.purchase({
        voucherId: vouchers.map((v) => v.nroVoucher).join(','),
        valor: valorTotal,
        currencyCode: 'ARS',
        productoId: vouchers[0].productoId,
        productoNombre: vouchers[0].productoNombre,
      });
    }
  }

  consultarEstado(0);
})();
