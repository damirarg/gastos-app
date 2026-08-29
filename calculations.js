import { USUARIOS, normalizarUsuarioId } from "./users.js";

export function formatearMonedaEnVivo(input) {
    let texto = input.value;
    let esNegativo = texto.trim().startsWith('-');
    let digitos = texto.replace(/\D/g, '');
    if (!digitos) {
        input.value = esNegativo ? '-' : '';
        return;
    }
    let valorFormateado = new Intl.NumberFormat('es-AR').format(parseInt(digitos, 10));
    input.value = esNegativo ? '-' + valorFormateado : valorFormateado;
}

export function obtenerNumeroLimpio(id) {
    let input = document.getElementById(id);
    if (!input) return 0;
    let texto = input.value.trim();
    let esNegativo = texto.startsWith('-');
    let digitos = texto.replace(/\D/g, '');
    if (!digitos) return 0;
    let num = parseInt(digitos, 10);
    return esNegativo ? -num : num;
}

export function inicializarInputsMonto() {
    document.querySelectorAll('.monto-input').forEach(input => {
        input.addEventListener('input', (e) => {
            formatearMonedaEnVivo(e.target);
            if (e.target.id === 'sueldo-damian' || e.target.id === 'sueldo-maxi') {
                calcularProporcionAlquiler();
                if (window.recalcularBalanceNeteado) window.recalcularBalanceNeteado();
            }
            if (window.calcularDineroPersonalPrivado) window.calcularDineroPersonalPrivado();
        });
    });
}


export function calcularProporcionAlquiler() {
    const sD = obtenerNumeroLimpio('sueldo-damian'); const sM = obtenerNumeroLimpio('sueldo-maxi'); const t = sD + sM;
    document.getElementById('proporcion-info').textContent = t > 0 ? `📊 Proporción alquiler: Damián ${((sD/t)*100).toFixed(1)}% | Maxi ${((sM/t)*100).toFixed(1)}%` : '📊 Proporción alquiler: Damián 0% | Maxi 0%';
}

function fechaPeriodoKey(fecha) {
    if (!fecha) return '';
    const fechaObj = fecha.toDate ? fecha.toDate() : new Date(fecha);
    if (isNaN(fechaObj.getTime())) return '';
    return fechaObj.toISOString().slice(0, 7);
}

export function obtenerPagadorFinanciero(gasto, tarjetas = []) {
    if (gasto.formato !== 'tarjeta' || !gasto.medioId) return normalizarUsuarioId(gasto.pagadoPor);

    const tarjeta = tarjetas.find(t => t.id === gasto.medioId);
    if (!tarjeta) return normalizarUsuarioId(gasto.pagadoPor);

    const titular = normalizarUsuarioId(tarjeta.titular);
    if (!titular) return normalizarUsuarioId(gasto.pagadoPor);
    if (tarjeta.tipo === 'extension') return titular === USUARIOS.DAMIAN ? USUARIOS.MAXI : USUARIOS.DAMIAN;
    return titular;
}

export function calcularTotalesPrestamo(montoOriginal, cuotas = []) {
    const totalCobrado = cuotas.reduce((total, cuota) => total + Number(cuota.monto || 0), 0);
    return {
        montoOriginal,
        totalCobrado,
        pendiente: Math.max(0, montoOriginal - totalCobrado)
    };
}

export function calcularBalanceNeteado({ gastos = [], tarjetas = [], sueldoDamian = 0, sueldoMaxi = 0 }) {
    let balanceNetoDamian = 0;
    let totalPagadoDamian = 0;
    let totalPagadoMaxi = 0;
    const detalleBalance = {
        comun: { titulo: 'Gastos comunes 50/50', monto: 0, items: [] },
        proporcional: { titulo: 'Alquiler proporcional', monto: 0, items: [] },
        privado: { titulo: 'Personales pagados por el otro', monto: 0, items: [] },
        devolucion: { titulo: 'Devoluciones registradas', monto: 0, items: [] }
    };
    const totalIngresos = sueldoDamian + sueldoMaxi;
    const pctDamian = totalIngresos > 0 ? sueldoDamian / totalIngresos : 0.5;
    const pctMaxi = totalIngresos > 0 ? sueldoMaxi / totalIngresos : 0.5;

    function registrarDetalle(grupo, gasto, pagadorFinanciero, efectoDamian) {
        if (!detalleBalance[grupo]) return;
        detalleBalance[grupo].monto += efectoDamian;
        detalleBalance[grupo].items.push({
            concepto: gasto.concepto || 'Sin concepto',
            monto: Number(gasto.monto || 0),
            pagadoPor: pagadorFinanciero,
            consumidor: normalizarUsuarioId(gasto.pagadoPor),
            efectoDamian
        });
    }

    gastos.forEach(gasto => {
        const monto = Number(gasto.monto || 0);
        const consumidor = normalizarUsuarioId(gasto.pagadoPor);
        const reparto = gasto.tipoReparto;
        const pagadorFinanciero = obtenerPagadorFinanciero(gasto, tarjetas);
        let efectoDamian = 0;

        if (reparto === 'comun') {
            if (pagadorFinanciero === USUARIOS.DAMIAN) {
                efectoDamian = monto * 0.5;
                totalPagadoDamian += monto;
            } else {
                efectoDamian = -monto * 0.5;
                totalPagadoMaxi += monto;
            }
            balanceNetoDamian += efectoDamian;
            registrarDetalle('comun', gasto, pagadorFinanciero, efectoDamian);
        } else if (reparto === 'proporcional') {
            if (pagadorFinanciero === USUARIOS.DAMIAN) {
                efectoDamian = monto * pctMaxi;
                totalPagadoDamian += monto;
            } else {
                efectoDamian = -monto * pctDamian;
                totalPagadoMaxi += monto;
            }
            balanceNetoDamian += efectoDamian;
            registrarDetalle('proporcional', gasto, pagadorFinanciero, efectoDamian);
        } else if (reparto === 'privado') {
            if (consumidor === USUARIOS.DAMIAN && pagadorFinanciero === USUARIOS.MAXI) {
                efectoDamian = -monto;
                totalPagadoMaxi += monto;
            } else if (consumidor === USUARIOS.MAXI && pagadorFinanciero === USUARIOS.DAMIAN) {
                efectoDamian = monto;
                totalPagadoDamian += monto;
            }
            balanceNetoDamian += efectoDamian;
            if (efectoDamian) registrarDetalle('privado', gasto, pagadorFinanciero, efectoDamian);
        } else if (reparto === 'devolucion') {
            efectoDamian = consumidor === USUARIOS.DAMIAN ? monto : -monto;
            balanceNetoDamian += efectoDamian;
            registrarDetalle('devolucion', gasto, pagadorFinanciero, efectoDamian);
        }
    });

    const montoDeuda = Math.round(Math.abs(balanceNetoDamian));
    let estadoDeuda = null;
    if (Math.abs(balanceNetoDamian) >= 1) {
        estadoDeuda = {
            deudor: balanceNetoDamian > 0 ? USUARIOS.MAXI : USUARIOS.DAMIAN,
            acreedor: balanceNetoDamian > 0 ? USUARIOS.DAMIAN : USUARIOS.MAXI,
            monto: montoDeuda
        };
    }

    return {
        balanceNetoDamian,
        totalPagadoDamian,
        totalPagadoMaxi,
        detalleBalance,
        estadoDeuda,
        estaAlDia: !estadoDeuda
    };
}

export function calcularLiquidezPersonal({
    gastos = [],
    tarjetas = [],
    cuentas = [],
    cuotasPrestamo = [],
    traspasos = [],
    pagosTarjeta = [],
    periodoActual,
    userActivo,
    saldosBase = {}
}) {
    let egresosEfectivo = 0;
    let egresosGalicia = 0;
    let egresosMP = 0;
    let egresosTarjetaPropia = 0;
    let egresosTarjetaExtension = 0;

    gastos.forEach(gasto => {
        let tarjeta = null;
        const pagadorFinanciero = obtenerPagadorFinanciero(gasto, tarjetas);
        if (gasto.formato === 'tarjeta' && gasto.medioId) {
            tarjeta = tarjetas.find(t => t.id === gasto.medioId) || null;
        }

        if (pagadorFinanciero !== normalizarUsuarioId(userActivo)) return;

        const mesRealGasto = fechaPeriodoKey(gasto.fecha);
        if (mesRealGasto === periodoActual) {
            if (gasto.formato === 'efectivo') {
                egresosEfectivo += Number(gasto.monto || 0);
            } else if (gasto.formato === 'transferencia') {
                const cuenta = cuentas.find(c => c.id === gasto.medioId);
                if (cuenta && cuenta.banco.toLowerCase().includes('mercado')) {
                    egresosMP += Number(gasto.monto || 0);
                } else {
                    egresosGalicia += Number(gasto.monto || 0);
                }
            }
        }

        const periodoGasto = gasto.periodo || mesRealGasto;
        if (periodoGasto === periodoActual && gasto.formato === 'tarjeta') {
            if (tarjeta && tarjeta.tipo === 'extension') egresosTarjetaExtension += Number(gasto.monto || 0);
            else egresosTarjetaPropia += Number(gasto.monto || 0);
        }
    });

    cuotasPrestamo.forEach(cuota => {
        if (fechaPeriodoKey(cuota.fecha) !== periodoActual) return;
        if (cuota.cuentaDestino === 'efectivo') egresosEfectivo -= Number(cuota.monto || 0);
        else if (cuota.cuentaDestino === 'galicia') egresosGalicia -= Number(cuota.monto || 0);
        else if (cuota.cuentaDestino === 'mp') egresosMP -= Number(cuota.monto || 0);
    });

    traspasos.forEach(traspaso => {
        if (fechaPeriodoKey(traspaso.fecha) !== periodoActual) return;

        if (traspaso.origen === 'efectivo') egresosEfectivo += Number(traspaso.monto || 0);
        else if (traspaso.origen === 'galicia') egresosGalicia += Number(traspaso.monto || 0);
        else if (traspaso.origen === 'mp') egresosMP += Number(traspaso.monto || 0);

        if (traspaso.destino === 'efectivo') egresosEfectivo -= Number(traspaso.monto || 0);
        else if (traspaso.destino === 'galicia') egresosGalicia -= Number(traspaso.monto || 0);
        else if (traspaso.destino === 'mp') egresosMP -= Number(traspaso.monto || 0);
    });

    let totalPagadoPropia = 0;
    let totalPagadoExtension = 0;
    pagosTarjeta.forEach(pago => {
        if (fechaPeriodoKey(pago.fecha) !== periodoActual) return;

        if (pago.cuentaLiquidadora === 'efectivo') egresosEfectivo += Number(pago.monto || 0);
        else if (pago.cuentaLiquidadora === 'galicia') egresosGalicia += Number(pago.monto || 0);
        else if (pago.cuentaLiquidadora === 'mp') egresosMP += Number(pago.monto || 0);

        if (pago.tarjetaTipo === 'extension') totalPagadoExtension += Number(pago.monto || 0);
        else totalPagadoPropia += Number(pago.monto || 0);
    });

    const dispEfectivo = Number(saldosBase.efectivo || 0) - egresosEfectivo;
    const dispGalicia = Number(saldosBase.galicia || 0) - egresosGalicia;
    const dispMP = Number(saldosBase.mp || 0) - egresosMP;
    const dispTotal = dispEfectivo + dispGalicia + dispMP;
    const deudaPropiaNeta = Math.max(0, egresosTarjetaPropia - totalPagadoPropia);
    const deudaExtensionNeta = Math.max(0, egresosTarjetaExtension - totalPagadoExtension);

    return {
        disponibilidades: {
            efectivo: dispEfectivo,
            galicia: dispGalicia,
            mp: dispMP,
            total: dispTotal
        },
        tarjetas: {
            propia: deudaPropiaNeta,
            extension: deudaExtensionNeta,
            total: deudaPropiaNeta + deudaExtensionNeta
        },
        movimientos: {
            egresosEfectivo,
            egresosGalicia,
            egresosMP,
            egresosTarjetaPropia,
            egresosTarjetaExtension,
            totalPagadoPropia,
            totalPagadoExtension
        }
    };
}
