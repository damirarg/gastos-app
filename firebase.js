import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, setDoc, deleteDoc, doc, updateDoc, onSnapshot, query, orderBy, writeBatch } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
    obtenerNumeroLimpio,
    calcularProporcionAlquiler,
    inicializarInputsMonto,
    calcularTotalesPrestamo,
    calcularBalanceNeteado,
    calcularLiquidezPersonal,
    obtenerPagadorFinanciero
} from "./calculations.js";
import { procesarExcelOCSV } from "./importer.js";
import { escapeHTML, escapeAttr, normalizarTextoComparacion, fechaLocalKey, formatearFechaCSV, valorCSV, aplicarColorMonto } from "./render.js";
import { USUARIOS, normalizarUsuarioId, usuarioNombre, usuarioCorto } from "./users.js";

const firebaseConfig = {
    apiKey: "AIzaSyAppvZkCIXB4LLTBMIipFcRR6T_sJyQ1PA",
    authDomain: "app-gastos-app.firebaseapp.com",
    projectId: "app-gastos-app",
    storageBucket: "app-gastos-app.firebasestorage.app",
    messagingSenderId: "799819701178",
    appId: "1:799819701178:web:bce68957bada57913c9b83"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const pantallaLoginWrapper = document.getElementById('pantalla-login-wrapper');
const seccionApp = document.getElementById('seccion-app');
const formLogin = document.getElementById('form-login');
const filtroMesInput = document.getElementById('filtro-mes');
const fechaManualInput = document.getElementById('fecha-manual');
const periodoImputacionInput = document.getElementById('periodo-imputacion');
const ayudaPeriodo = document.getElementById('ayuda-periodo');

const hoy = new Date();
const mesActualStr = hoy.toISOString().slice(0, 7);
filtroMesInput.value = mesActualStr;
periodoImputacionInput.value = mesActualStr;
fechaManualInput.value = hoy.toISOString().split('T')[0];
document.getElementById('cuota-fecha').value = hoy.toISOString().split('T')[0];
document.getElementById('traspaso-fecha').value = hoy.toISOString().split('T')[0];
document.getElementById('pago-tarjeta-fecha').value = hoy.toISOString().split('T')[0];
document.getElementById('ajuste-fecha').value = hoy.toISOString().split('T')[0];
document.getElementById('prestamo-fecha-inicio').value = "2026-02-01";

filtroMesInput.addEventListener('change', () => {
    sugerirPeriodoImputacion();
    escucharGastosEnTiempoReal();
    cargarIngresosYsaldoDelMes();
});

function obtenerNombreUsuario(email) {
    return normalizarUsuarioId(email);
}

function usuarioLabelSeguro(valor, corto = false) {
    return escapeHTML(corto ? usuarioCorto(valor) : usuarioNombre(valor));
}

function obtenerPeriodoDesdeFecha(fechaValor, sumarMes = false) {
    if (!fechaValor) return mesActualStr;
    const fecha = new Date(fechaValor + "T12:00:00");
    if (isNaN(fecha.getTime())) return mesActualStr;
    if (sumarMes) fecha.setMonth(fecha.getMonth() + 1);
    return fecha.toISOString().slice(0, 7);
}

function obtenerPeriodoSugerido() {
    const tipo = document.getElementById('tipo-reparto')?.value || 'comun';
    const formato = document.getElementById('formato-pago')?.value || 'efectivo';

    if (tipo === 'proporcional') return obtenerPeriodoDesdeFecha(fechaManualInput.value, false);
    if (tipo === 'privado') return obtenerPeriodoDesdeFecha(fechaManualInput.value, formato === 'tarjeta');
    return obtenerPeriodoDesdeFecha(fechaManualInput.value, true);
}

function obtenerPeriodoSugeridoParaGasto({ fechaValor, tipo = 'comun', formato = 'efectivo' }) {
    if (tipo === 'proporcional') return obtenerPeriodoDesdeFecha(fechaValor, false);
    if (tipo === 'privado') return obtenerPeriodoDesdeFecha(fechaValor, formato === 'tarjeta');
    return obtenerPeriodoDesdeFecha(fechaValor, true);
}

function actualizarAyudaPeriodo() {
    if (!ayudaPeriodo) return;

    const tipo = document.getElementById('tipo-reparto')?.value || 'comun';
    const formato = document.getElementById('formato-pago')?.value || 'efectivo';
    const periodo = periodoImputacionInput.value || obtenerPeriodoSugerido();
    const [anio, mes] = periodo.split('-');
    const nombrePeriodo = anio && mes
        ? new Date(Number(anio), Number(mes) - 1, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
        : 'el período elegido';

    if (tipo === 'proporcional') {
        ayudaPeriodo.textContent = `Alquiler: se reparte en ${nombrePeriodo}.`;
    } else if (tipo === 'privado' && formato === 'tarjeta') {
        ayudaPeriodo.textContent = `Personal con tarjeta: se controla en el resumen de ${nombrePeriodo}.`;
    } else if (tipo === 'privado') {
        ayudaPeriodo.textContent = `Personal sin tarjeta: impacta en tu caja de ${nombrePeriodo}.`;
    } else {
        ayudaPeriodo.textContent = `Común: descuenta caja por fecha real y se reparte en ${nombrePeriodo}.`;
    }
}

function sugerirPeriodoImputacion({ forzar = false } = {}) {
    if (!forzar && periodoEditadoManual) {
        actualizarAyudaPeriodo();
        return;
    }

    periodoImputacionInput.value = obtenerPeriodoSugerido();
    actualizarAyudaPeriodo();
}








function esPosibleDuplicadoImportacion(borrador) {
    const fechaBorrador = fechaLocalKey(borrador.fechaObj);
    const conceptoBorrador = normalizarTextoComparacion(borrador.concepto);
    if (!fechaBorrador || !borrador.monto) return false;

    return listaGastosCompletaBase.some((gasto) => {
        if (Math.round(Number(gasto.monto || 0)) !== Math.round(Number(borrador.monto || 0))) return false;
        if (fechaLocalKey(gasto.fecha) !== fechaBorrador) return false;

        const conceptoGuardado = normalizarTextoComparacion(gasto.concepto);
        if (!conceptoGuardado || !conceptoBorrador) return true;
        return conceptoGuardado === conceptoBorrador ||
            conceptoGuardado.includes(conceptoBorrador) ||
            conceptoBorrador.includes(conceptoGuardado);
    });
}

function extraerConsumosDesdeTextoOCR(texto) {
    const lineas = texto.split(/\n+/).map(linea => linea.trim()).filter(linea => linea.length > 4);
    const consumos = [];

    lineas.forEach((linea) => {
        const fechaMatch = linea.match(/\b(\d{1,2}[\/.-]\d{1,2}(?:[\/.-]\d{2,4})?)\b/);
        const montos = [...linea.matchAll(/(?:\$|\s|^)(-?\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})?|-?\d+(?:,\d{2})?)\b/g)]
            .map(match => match[1])
            .filter(valor => /\d/.test(valor));
        const montoTexto = montos[montos.length - 1];
        if (!montoTexto) return;

        const monto = Number(montoTexto.replace(/\./g, '').replace(/\s/g, '').replace(',', '.'));
        if (!monto || Math.abs(monto) < 1) return;

        const fechaTexto = fechaMatch ? fechaMatch[1] : fechaManualInput.value;
        const partesFecha = fechaTexto.split(/[\/.-]/).map(Number);
        const anio = partesFecha[2] ? (partesFecha[2] < 100 ? 2000 + partesFecha[2] : partesFecha[2]) : hoy.getFullYear();
        const fechaObj = partesFecha.length >= 2
            ? new Date(anio, partesFecha[1] - 1, partesFecha[0], 12, 0, 0, 0)
            : new Date(fechaManualInput.value + "T12:00:00");
        const concepto = linea
            .replace(fechaMatch?.[0] || '', '')
            .replace(montoTexto, '')
            .replace(/\$/g, '')
            .replace(/\s+/g, ' ')
            .trim() || 'Movimiento detectado';

        consumos.push({
            fecha: fechaObj.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
            fechaObj,
            concepto,
            monto: Math.round(Math.abs(monto))
        });
    });

    return consumos;
}

let listaGastosGlobal = [];
let listaGastosCompletaBase = []; // Para calcular saldos reales sin filtrar por periodo
let listaTarjetasGlobal = [];
let listaCuentasGlobal = [];
let listaCuotasPrestamoGlobal = [];
let listaTraspasosGlobal = [];
let listaPagosTarjetasGlobal = [];
let listaAjustesCuentaGlobal = [];
let ingresosPorMesGlobal = {};
let saldosCuentasGlobales = {};
let listaBorradoresImportacion = [];
const suscripcionesTiempoReal = {
    gastos: null,
    tarjetas: null,
    cuentas: null,
    prestamoConfig: null,
    cuotasPrestamo: null,
    traspasos: null,
    pagosTarjeta: null,
    ajustesCuenta: null,
    ingresos: null,
    saldosCuentas: null
};
let idGastoEnEdicionPeriodo = null;
let esEdicionMasiva = false;
let modoSeleccionActivoComun = false;
let modoSeleccionActivoPrivado = false;
let usuarioActivoId = '';
let periodoEditadoManual = false;

function reemplazarSuscripcion(nombre, nuevaSuscripcion) {
    if (suscripcionesTiempoReal[nombre]) suscripcionesTiempoReal[nombre]();
    suscripcionesTiempoReal[nombre] = nuevaSuscripcion;
}

function limpiarSuscripcionesTiempoReal() {
    Object.keys(suscripcionesTiempoReal).forEach((nombre) => {
        if (suscripcionesTiempoReal[nombre]) {
            suscripcionesTiempoReal[nombre]();
            suscripcionesTiempoReal[nombre] = null;
        }
    });
}

async function ejecutarBatchEnBloques(items, aplicarOperacion, tamanoBloque = 450) {
    for (let i = 0; i < items.length; i += tamanoBloque) {
        const batch = writeBatch(db);
        items.slice(i, i + tamanoBloque).forEach((item) => aplicarOperacion(batch, item));
        await batch.commit();
    }
}

onAuthStateChanged(auth, (user) => {
    if (user) {
        pantallaLoginWrapper.classList.add('oculto');
        seccionApp.classList.remove('oculto');
        const nombreUser = obtenerNombreUsuario(user.email);
        usuarioActivoId = nombreUser;
        document.getElementById('usuario-activo-email').textContent = usuarioCorto(nombreUser);
        document.getElementById('nombre-privado-titular').textContent = usuarioNombre(nombreUser);
        queueMicrotask(() => sincronizarCargaConUsuario());

        escucharTarjetasYcuentas();
        escucharGastosEnTiempoReal();
        escucharIngresosYSaldos();
        escucharSaldosCuentasGlobales();
        escucharPrestamoYcuotas();
        escucharTraspasosYPagosTarjetas();
    } else {
        usuarioActivoId = '';
        limpiarSuscripcionesTiempoReal();
        pantallaLoginWrapper.classList.remove('oculto');
        seccionApp.classList.add('oculto');
    }
});

formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        await signInWithEmailAndPassword(auth, document.getElementById('login-email').value, document.getElementById('login-password').value);
        formLogin.reset();
    } catch (error) { alert("Error de autenticación."); }
});

document.getElementById('btn-logout').addEventListener('click', () => signOut(auth));

document.getElementById('btn-exportar-mes').addEventListener('click', () => exportarMesActualCSV());
document.getElementById('btn-toggle-detalle-balance').addEventListener('click', () => {
    const detalle = document.getElementById('detalle-balance-box');
    detalle.classList.toggle('oculto');
    document.getElementById('btn-toggle-detalle-balance').textContent = detalle.classList.contains('oculto') ? 'Ver detalle del cálculo' : 'Ocultar detalle';
});

window.cambiarVista = function(idVista, boton) {
    const navMas = document.getElementById('nav-mas');
    if (navMas && !['vista-prestamos', 'vista-tarjetas'].includes(idVista)) navMas.classList.add('oculto');

    document.querySelectorAll('.modulo-vista').forEach(v => v.classList.add('oculto'));
    document.querySelectorAll('.btn-tab').forEach(b => b.classList.remove('activo'));
    document.getElementById(idVista).classList.remove('oculto');
    boton.classList.add('activo');
};

window.toggleNavMas = function(boton) {
    const navMas = document.getElementById('nav-mas');
    if (!navMas) return;

    navMas.classList.toggle('oculto');
    boton.classList.toggle('activo', !navMas.classList.contains('oculto'));
};

const categoriasBase = [
    '🛒 Supermercado', '💊 Farmacia', '💡 Luz', '🔥 Gas', '🌐 Internet', '💧 Agua',
    '🏠 Seguro Casa', '🧹 Servicio Doméstico', '🏊‍♂️ Servicio Pileta', '🧪 Insumos Pileta',
    '🐈 Mascotas', '🛠️ Reparaciones Casa', '🍷 Salidas/Ocio', '⚕️ Obra Social',
    '📺 Suscripción Streaming', '🤖 Suscripción IA',
    '👕 Vestimenta', '✂️ Peluquería', '⛽ Combustible', '🚗 Seguro Auto',
    '🔧 Service Auto', '📄 Patente', '🛍️ Varios'
];

let categoriasExtra = JSON.parse(localStorage.getItem('categoriasExtraGastos') || '[]').filter(Boolean);

const categoriasPorTipo = {
    proporcional: ['🏠 Alquiler'],
    comun: [...categoriasBase, ...categoriasExtra],
    privado: ['🚬 Puchos', ...categoriasBase, ...categoriasExtra]
};

function refrescarCategoriasPorTipo() {
    const extrasUnicas = [...new Set(categoriasExtra.map(cat => cat.trim()).filter(Boolean))];
    categoriasExtra = extrasUnicas;
    localStorage.setItem('categoriasExtraGastos', JSON.stringify(categoriasExtra));
    categoriasPorTipo.comun = [...categoriasBase, ...categoriasExtra];
    categoriasPorTipo.privado = ['🚬 Puchos', ...categoriasBase, ...categoriasExtra];
}

function inicializarSelectoresFiltro() {
    const selectComun = document.getElementById('cat-comun');
    const selectPrivado = document.getElementById('cat-privado');

    let optsComun = '<option value="">Todas las categorías</option>';
    categoriasPorTipo['comun'].forEach(c => optsComun += `<option value="${c}">${c}</option>`);
    categoriasPorTipo['proporcional'].forEach(c => optsComun += `<option value="${c}">${c}</option>`);
    if (selectComun) selectComun.innerHTML = optsComun;

    let optsPrivado = '<option value="">Todas las categorías</option>';
    categoriasPorTipo['privado'].forEach(c => optsPrivado += `<option value="${c}">${c}</option>`);
    if (selectPrivado) selectPrivado.innerHTML = optsPrivado;
}
inicializarSelectoresFiltro();

window.agregarCategoriaManual = function() {
    const input = document.getElementById('nueva-categoria');
    const valor = input.value.trim();
    if (!valor) return;
    if (!categoriasExtra.includes(valor) && !categoriasBase.includes(valor)) categoriasExtra.push(valor);
    refrescarCategoriasPorTipo();
    inicializarSelectoresFiltro();
    actualizarCategoriasManuales();
    selectCategoriaManual.value = valor;
    input.value = '';
};

const selectTipoRepartoManual = document.getElementById('tipo-reparto');
const selectCategoriaManual = document.getElementById('categoria');
function actualizarCategoriasManuales() {
    selectCategoriaManual.innerHTML = '';
    (categoriasPorTipo[selectTipoRepartoManual.value] || []).forEach(cat => {
        const op = document.createElement('option'); op.value = cat; op.textContent = cat; selectCategoriaManual.appendChild(op);
    });

    const categoriaPreferida = selectTipoRepartoManual.value === 'proporcional' ? '🏠 Alquiler' : '🛍️ Varios';
    if ([...selectCategoriaManual.options].some(op => op.value === categoriaPreferida)) {
        selectCategoriaManual.value = categoriaPreferida;
    }
}
selectTipoRepartoManual.addEventListener('change', () => {
    actualizarCategoriasManuales();
    sincronizarCargaConUsuario();
    sugerirPeriodoImputacion();
});
actualizarCategoriasManuales();

window.actualizarCategoriasFilaBorrador = function(index) {
    const selectTipo = document.getElementById(`reparto-borrador-${index}`);
    const selectCat = document.getElementById(`cat-borrador-${index}`);
    const selectMedio = document.getElementById(`medio-borrador-${index}`);
    const inputPeriodo = document.getElementById(`periodo-borrador-${index}`);
    selectCat.innerHTML = '';
    (categoriasPorTipo[selectTipo.value] || []).forEach(cat => {
        const op = document.createElement('option'); op.value = cat; op.textContent = cat; selectCat.appendChild(op);
    });
    if (inputPeriodo) {
        const formato = selectMedio?.value?.startsWith('tarjeta_') ? 'tarjeta' : (selectMedio?.value?.startsWith('cuenta_') ? 'transferencia' : 'efectivo');
        inputPeriodo.value = obtenerPeriodoSugeridoParaGasto({ fechaValor: listaBorradoresImportacion[index]?.fechaObj?.toISOString().slice(0, 10), tipo: selectTipo.value, formato });
    }
};

window.actualizarPeriodoFilaBorrador = function(index) {
    const selectTipo = document.getElementById(`reparto-borrador-${index}`);
    const selectMedio = document.getElementById(`medio-borrador-${index}`);
    const inputPeriodo = document.getElementById(`periodo-borrador-${index}`);
    if (!selectTipo || !selectMedio || !inputPeriodo) return;

    const formato = selectMedio.value.startsWith('tarjeta_') ? 'tarjeta' : (selectMedio.value.startsWith('cuenta_') ? 'transferencia' : 'efectivo');
    inputPeriodo.value = obtenerPeriodoSugeridoParaGasto({
        fechaValor: listaBorradoresImportacion[index]?.fechaObj?.toISOString().slice(0, 10),
        tipo: selectTipo.value,
        formato
    });
};

window.actualizarCategoriaGasto = async function(idGasto, nuevaCategoria) {
    try { await updateDoc(doc(db, "gastos", idGasto), { categoria: nuevaCategoria }); }
    catch (error) { alert("Error al actualizar la categoría."); }
};

window.actualizarRepartoGasto = async function(idGasto, nuevoReparto) {
    try {
        const gastoObj = listaGastosGlobal.find(g => g.id === idGasto);
        let nuevaCategoria = gastoObj ? gastoObj.categoria : "";
        const actualizacion = {
            tipoReparto: nuevoReparto,
            categoria: nuevaCategoria,
            esPrivado: nuevoReparto === 'privado',
            owner: nuevoReparto === 'privado' ? normalizarUsuarioId(gastoObj?.pagadoPor || usuarioActivoId) : 'hogar'
        };

        if (nuevoReparto === 'privado' && !categoriasPorTipo['privado'].includes(nuevaCategoria)) {
            actualizacion.categoria = '🛍️ Varios';
        } else if (nuevoReparto === 'comun' && !categoriasPorTipo['comun'].includes(nuevaCategoria)) {
            actualizacion.categoria = '🛒 Supermercado';
        } else if (nuevoReparto === 'proporcional') {
            actualizacion.categoria = '🏠 Alquiler';
        }

        await updateDoc(doc(db, "gastos", idGasto), actualizacion);
    } catch (error) { alert("Error al actualizar el tipo de reparto."); }
};

window.actualizarMedioGasto = async function(idGasto, valorSeleccionado) {
    try {
        let formato = 'efectivo';
        let medioId = '';

        if (valorSeleccionado.startsWith('tarjeta_')) {
            formato = 'tarjeta';
            medioId = valorSeleccionado.replace('tarjeta_', '');
        } else if (valorSeleccionado.startsWith('cuenta_')) {
            formato = 'transferencia';
            medioId = valorSeleccionado.replace('cuenta_', '');
        }

        await updateDoc(doc(db, "gastos", idGasto), { formato: formato, medioId: medioId });
    } catch (error) { alert("Error al actualizar el medio de pago."); }
};

window.editarPeriodoImputacion = function(idGasto) {
    const gastoObj = listaGastosGlobal.find(g => g.id === idGasto);
    if (!gastoObj) return;

    esEdicionMasiva = false;
    idGastoEnEdicionPeriodo = idGasto;
    document.getElementById('modal-nuevo-periodo').value = gastoObj.periodo || filtroMesInput.value;
    document.getElementById('modal-reimputar').classList.remove('oculto');
};

window.abrirModalReimputarMasivo = function(origen) {
    const idBody = origen === 'comun' ? 'tabla-gastos-body' : 'tabla-gastos-privados-body';
    const seleccionados = document.querySelectorAll(`#${idBody} .chk-item:checked`);

    if (seleccionados.length === 0) {
        alert("Por favor, tildá al menos un gasto para reimputar.");
        return;
    }

    esEdicionMasiva = true;
    document.getElementById('modal-nuevo-periodo').value = filtroMesInput.value;
    document.getElementById('modal-reimputar').classList.remove('oculto');
};

window.cerrarModalReimputar = function() {
    idGastoEnEdicionPeriodo = null;
    esEdicionMasiva = false;
    document.getElementById('modal-reimputar').classList.add('oculto');
};

window.confirmarReimputacionModal = async function() {
    const nuevoPeriodo = document.getElementById('modal-nuevo-periodo').value;
    if (!nuevoPeriodo) return;

    if (esEdicionMasiva) {
        const seleccionadosComun = document.querySelectorAll('#tabla-gastos-body .chk-item:checked');
        const seleccionadosPriv = document.querySelectorAll('#tabla-gastos-privados-body .chk-item:checked');
        const todos = [...seleccionadosComun, ...seleccionadosPriv];

        try {
            await ejecutarBatchEnBloques(todos, (batch, chk) => {
                batch.update(doc(db, "gastos", chk.value), { periodo: nuevoPeriodo });
            });
            cerrarModalReimputar();
        } catch (error) { alert("Error al procesar la reimputación masiva."); }
    } else if (idGastoEnEdicionPeriodo) {
        try {
            await updateDoc(doc(db, "gastos", idGastoEnEdicionPeriodo), { periodo: nuevoPeriodo });
            cerrarModalReimputar();
        } catch (error) { alert("Error al actualizar el período."); }
    }
};

window.ejecutarEliminacionMasiva = async function(origen) {
    const idBody = origen === 'comun' ? 'tabla-gastos-body' : 'tabla-gastos-privados-body';
    const seleccionados = document.querySelectorAll(`#${idBody} .chk-item:checked`);

    if (seleccionados.length === 0) {
        alert("Por favor, tildá al menos un gasto para eliminar.");
        return;
    }

    if (confirm(`¿Estás seguro de que querés borrar permanentemente los ${seleccionados.length} gastos seleccionados?`)) {
        try {
            await ejecutarBatchEnBloques([...seleccionados], (batch, chk) => {
                batch.delete(doc(db, "gastos", chk.value));
            });
        } catch (error) { alert("Error al eliminar los gastos seleccionados."); }
    }
};

window.toggleModoSeleccion = function(origen) {
    if (origen === 'comun') {
        modoSeleccionActivoComun = !modoSeleccionActivoComun;
        document.querySelectorAll('#tabla-gastos-comunes .col-chk').forEach(el => el.classList.toggle('oculto', !modoSeleccionActivoComun));
        document.getElementById('barra-masiva-comun').classList.toggle('oculto', !modoSeleccionActivoComun);
    } else {
        modoSeleccionActivoPrivado = !modoSeleccionActivoPrivado;
        document.querySelectorAll('#tabla-gastos-privados .col-chk').forEach(el => el.classList.toggle('oculto', !modoSeleccionActivoPrivado));
        document.getElementById('barra-masiva-privado').classList.toggle('oculto', !modoSeleccionActivoPrivado);
    }
};

window.toggleSeleccionarTodos = function(idBody, estaMarcado) {
    document.querySelectorAll(`#${idBody} .chk-item`).forEach(chk => {
        if (chk.parentElement.parentElement.style.display !== 'none') {
            chk.checked = estaMarcado;
        }
    });
};

window.editarConcepto = async function(idGasto) {
    const gastoObj = listaGastosGlobal.find(g => g.id === idGasto);
    if (!gastoObj) return;
    const nuevoConcepto = prompt("Modificá el concepto/detalle del gasto:", gastoObj.concepto);
    if (nuevoConcepto !== null && nuevoConcepto.trim() !== "" && nuevoConcepto !== gastoObj.concepto) {
        try { await updateDoc(doc(db, "gastos", idGasto), { concepto: nuevoConcepto.trim() }); }
        catch (error) { alert("Error al actualizar el concepto."); }
    }
};

window.filtrarTabla = function(idTabla, idSearch, idCat, idMedio) {
    const textoBusqueda = document.getElementById(idSearch).value.toLowerCase();
    const categoriaBuscada = document.getElementById(idCat).value;
    const medioBuscado = document.getElementById(idMedio).value;
    const filas = document.getElementById(idTabla).getElementsByTagName('tr');

    for (let i = 0; i < filas.length; i++) {
        const tr = filas[i];
        if (tr.cells.length === 1) continue;

        const concepto = tr.getAttribute('data-concepto') || "";
        const categoria = tr.getAttribute('data-categoria') || "";
        const medio = tr.getAttribute('data-medio') || "";

        const coincideTexto = concepto.includes(textoBusqueda);
        const coincideCat = categoriaBuscada === "" || categoria === categoriaBuscada;
        const coincideMedio = medioBuscado === "" || medio === medioBuscado;

        if (coincideTexto && coincideCat && coincideMedio) {
            tr.style.display = "";
        } else {
            tr.style.display = "none";
        }
    }
};

const selectPagadoPor = document.getElementById('pagado-por');
const selectFormatoPago = document.getElementById('formato-pago');
const contTarjeta = document.getElementById('contenedor-tarjeta');
const contCuenta = document.getElementById('contenedor-cuenta');
const selectGastoTarjeta = document.getElementById('gasto-tarjeta-asociada');
const selectGastoCuenta = document.getElementById('gasto-cuenta-asociada');

function sincronizarCargaConUsuario() {
    if (!selectPagadoPor || !selectTipoRepartoManual) return;

    if (usuarioActivoId && selectTipoRepartoManual.value === 'privado') {
        selectPagadoPor.value = usuarioActivoId;
        selectPagadoPor.disabled = true;
        selectPagadoPor.title = 'Los gastos personales se asignan al usuario logueado.';
    } else {
        selectPagadoPor.disabled = false;
        selectPagadoPor.title = '';
        if (usuarioActivoId && !selectPagadoPor.value) selectPagadoPor.value = usuarioActivoId;
    }

    actualizarFiltrosMedioPago();
}

function actualizarFiltrosMedioPago() {
    const quienPaga = selectPagadoPor.value;
    const formato = selectFormatoPago.value;
    const titularBuscado = normalizarUsuarioId(quienPaga);

    if (formato === 'efectivo') {
        contTarjeta.style.display = 'none'; contCuenta.style.display = 'none';
    } else if (formato === 'tarjeta') {
        contTarjeta.style.display = 'flex'; contCuenta.style.display = 'none';
        selectGastoTarjeta.innerHTML = '';
        const tarjetasFiltradas = listaTarjetasGlobal.filter(t => normalizarUsuarioId(t.titular) === titularBuscado);
        if(tarjetasFiltradas.length === 0) selectGastoTarjeta.innerHTML = '<option value="">Sin tarjetas cargadas</option>';
        tarjetasFiltradas.forEach(t => {
            const op = document.createElement('option'); op.value = t.id; op.textContent = `${t.marca} (**** ${t.ultimos4})`; selectGastoTarjeta.appendChild(op);
        });
    } else if (formato === 'transferencia') {
        contTarjeta.style.display = 'none'; contCuenta.style.display = 'flex';
        selectGastoCuenta.innerHTML = '';
        const cuentasFiltradas = listaCuentasGlobal.filter(c => normalizarUsuarioId(c.titular) === titularBuscado);
        if(cuentasFiltradas.length === 0) selectGastoCuenta.innerHTML = '<option value="">Sin cuentas cargadas</option>';
        cuentasFiltradas.forEach(c => {
            const op = document.createElement('option'); op.value = c.id; op.textContent = c.banco; selectGastoCuenta.appendChild(op);
        });
    }
}

selectPagadoPor.addEventListener('change', actualizarFiltrosMedioPago);
selectFormatoPago.addEventListener('change', () => {
    actualizarFiltrosMedioPago();
    sugerirPeriodoImputacion();
});
fechaManualInput.addEventListener('change', () => sugerirPeriodoImputacion());
periodoImputacionInput.addEventListener('change', () => {
    periodoEditadoManual = true;
    actualizarAyudaPeriodo();
});
document.getElementById('proy-ingreso').addEventListener('input', actualizarProyeccion);
document.getElementById('proy-fijos').addEventListener('input', actualizarProyeccion);
sincronizarCargaConUsuario();
sugerirPeriodoImputacion({ forzar: true });

window.prepararCargaRapida = function(tipo, formato) {
    selectTipoRepartoManual.value = tipo;
    selectFormatoPago.value = formato;
    actualizarCategoriasManuales();
    sincronizarCargaConUsuario();
    periodoEditadoManual = false;
    sugerirPeriodoImputacion({ forzar: true });
    document.getElementById('concepto').focus();
};

document.getElementById('form-tarjeta').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        await addDoc(collection(db, "tarjetas"), { titular: normalizarUsuarioId(document.getElementById('tarjeta-titular').value), tipo: document.getElementById('tarjeta-tipo').value, marca: document.getElementById('tarjeta-marca').value, ultimos4: document.getElementById('tarjeta-ultimos4').value });
        document.getElementById('form-tarjeta').reset();
    } catch (error) { alert("Error al guardar la tarjeta."); }
});

document.getElementById('form-cuenta').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        await addDoc(collection(db, "cuentas"), { titular: normalizarUsuarioId(document.getElementById('cuenta-titular').value), banco: document.getElementById('cuenta-banco').value, alias: document.getElementById('cuenta-alias').value });
        document.getElementById('form-cuenta').reset();
    } catch (error) { alert("Error al guardar la cuenta."); }
});

function renderizarDropdownsMedios() {
    const selectImp = document.getElementById('archivo-medio-select');
    selectImp.innerHTML = `<option value="efectivo">💵 Efectivo / Ninguna</option>`;

    let optFiltros = '<option value="">Todos los medios de pago</option><option value="efectivo">💵 Efectivo</option>';

    listaTarjetasGlobal.forEach(t => {
        const desc = t.tipo === 'extension' ? '(Extensión)' : '(Propia)';
        selectImp.innerHTML += `<option value="tarjeta_${escapeAttr(t.id)}">💳 ${escapeHTML(t.marca)} - ${usuarioLabelSeguro(t.titular, true)} ${desc}</option>`;
        optFiltros += `<option value="${escapeAttr(t.id)}">💳 ${escapeHTML(t.marca)} (${usuarioLabelSeguro(t.titular, true)} - ${desc})</option>`;
    });

    listaCuentasGlobal.forEach(c => {
        selectImp.innerHTML += `<option value="cuenta_${escapeAttr(c.id)}">🏦 ${escapeHTML(c.banco)} - ${usuarioLabelSeguro(c.titular, true)}</option>`;
        optFiltros += `<option value="${escapeAttr(c.id)}">🏦 ${escapeHTML(c.banco)} (${usuarioLabelSeguro(c.titular, true)})</option>`;
    });

    document.getElementById('medio-comun').innerHTML = optFiltros;
    document.getElementById('medio-privado').innerHTML = optFiltros;

    actualizarFiltrosMedioPago();
}

function describirMedioPago(gasto) {
    if (gasto.formato === 'tarjeta' && gasto.medioId) {
        const tarjeta = listaTarjetasGlobal.find(t => t.id === gasto.medioId);
        if (tarjeta) return `${tarjeta.marca} ${usuarioCorto(tarjeta.titular)} ${tarjeta.tipo === 'extension' ? 'Extension' : 'Propia'}`;
    }
    if (gasto.formato === 'transferencia' && gasto.medioId) {
        const cuenta = listaCuentasGlobal.find(c => c.id === gasto.medioId);
        if (cuenta) return `${cuenta.banco} ${usuarioCorto(cuenta.titular)}`;
    }
    return gasto.formato || 'efectivo';
}

function exportarMesActualCSV() {
    if (listaGastosGlobal.length === 0) {
        alert("No hay gastos para exportar en el período seleccionado.");
        return;
    }

    const encabezado = ['Fecha', 'Periodo', 'Concepto', 'Categoria', 'Pagado por', 'Tipo reparto', 'Formato', 'Medio', 'Monto'];
    const filas = listaGastosGlobal.map((gasto) => [
        formatearFechaCSV(gasto.fecha),
        gasto.periodo || filtroMesInput.value,
        gasto.concepto || '',
        gasto.categoria || '',
            usuarioNombre(gasto.pagadoPor),
        gasto.tipoReparto || '',
        gasto.formato || '',
        describirMedioPago(gasto),
        gasto.monto || 0
    ]);

    const contenido = [encabezado, ...filas]
        .map((fila) => fila.map(valorCSV).join(','))
        .join('\n');
    const blob = new Blob([`\ufeff${contenido}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `gastos-${filtroMesInput.value}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function escucharTarjetasYcuentas() {
    reemplazarSuscripcion('tarjetas', onSnapshot(collection(db, "tarjetas"), (snapshot) => {
        listaTarjetasGlobal = [];
        const contListaT = document.getElementById('lista-tarjetas'); contListaT.innerHTML = "";
        snapshot.forEach((docSnap) => {
            const t = docSnap.data(); t.id = docSnap.id; listaTarjetasGlobal.push(t);
            const desc = t.tipo === 'extension' ? '(Extensión)' : '(Propia)';
            contListaT.innerHTML += `<div class="tarjeta-item"><span>💳 <strong>${escapeHTML(t.marca)}</strong> - ${usuarioLabelSeguro(t.titular, true)} <small>${desc}</small> (**** ${escapeHTML(t.ultimos4)})</span><button class="btn-eliminar" onclick="eliminarMedio('tarjetas', '${escapeAttr(t.id)}')">🗑️</button></div>`;
        });
        renderizarDropdownsMedios();
    }));

    reemplazarSuscripcion('cuentas', onSnapshot(collection(db, "cuentas"), (snapshot) => {
        listaCuentasGlobal = [];
        const contListaC = document.getElementById('lista-cuentas'); contListaC.innerHTML = "";
        snapshot.forEach((docSnap) => {
            const c = docSnap.data(); c.id = docSnap.id; listaCuentasGlobal.push(c);
            contListaC.innerHTML += `<div class="tarjeta-item"><span>🏦 <strong>${escapeHTML(c.banco)}</strong> - ${usuarioLabelSeguro(c.titular, true)}</span><button class="btn-eliminar" onclick="eliminarMedio('cuentas', '${escapeAttr(c.id)}')">🗑️</button></div>`;
        });
        renderizarDropdownsMedios();
    }));
}

function escucharIngresosYSaldos() {
    reemplazarSuscripcion('ingresos', onSnapshot(collection(db, "ingresos"), (snapshot) => {
        ingresosPorMesGlobal = {};
        snapshot.forEach((docSnap) => {
            ingresosPorMesGlobal[docSnap.id] = docSnap.data();
        });
        cargarIngresosYsaldoDelMes();
    }));
}

function escucharSaldosCuentasGlobales() {
    reemplazarSuscripcion('saldosCuentas', onSnapshot(doc(db, "configuracion", "saldos_cuentas_globales"), (docSnap) => {
        saldosCuentasGlobales = docSnap.exists() ? docSnap.data() : {};
        cargarIngresosYsaldoDelMes();
    }));
}

window.eliminarMedio = async function(coleccion, id) {
    if (confirm("¿Borrar este medio de pago?")) { await deleteDoc(doc(db, coleccion, id)); }
};

// INGRESOS MENSUALES Y SALDOS GLOBALES DE LAS TRES CUENTAS EN FIREBASE
async function cargarIngresosYsaldoDelMes() {
    const mes = filtroMesInput.value;
    const data = ingresosPorMesGlobal[mes] || null;
    const saldosGlobales = obtenerSaldosGlobalesUsuario(obtenerNombreUsuario(auth.currentUser?.email || ''));
    const saldosFallback = saldosGlobales || obtenerUltimosSaldosMensualesLegacy(mes);

    if (data) {
        document.getElementById('sueldo-damian').value = new Intl.NumberFormat('es-AR').format(data.sueldoDamian || 0);
        document.getElementById('sueldo-maxi').value = new Intl.NumberFormat('es-AR').format(data.sueldoMaxi || 0);
    } else {
        document.getElementById('sueldo-damian').value = '';
        document.getElementById('sueldo-maxi').value = '';
    }

    document.getElementById('saldo-base-efectivo').value = formatearMontoInput(saldosFallback?.efectivo);
    document.getElementById('saldo-base-galicia').value = formatearMontoInput(saldosFallback?.galicia);
    document.getElementById('saldo-base-mp').value = formatearMontoInput(saldosFallback?.mp);

    calcularProporcionAlquiler();
    if(window.recalcularBalanceNeteado) window.recalcularBalanceNeteado();
    if(window.calcularDineroPersonalPrivado) window.calcularDineroPersonalPrivado();
}

function formatearMontoInput(valor) {
    if (valor === undefined || valor === null) return '';
    const numero = Number(valor || 0);
    return (numero < 0 ? '-' : '') + new Intl.NumberFormat('es-AR').format(Math.abs(numero));
}

document.getElementById('btn-guardar-ingresos').addEventListener('click', async () => {
    const mes = filtroMesInput.value;
    const sD = obtenerNumeroLimpio('sueldo-damian');
    const sM = obtenerNumeroLimpio('sueldo-maxi');
    try {
        const btn = document.getElementById('btn-guardar-ingresos');
        btn.textContent = "Guardando..."; btn.disabled = true;
        await setDoc(doc(db, "ingresos", mes), { sueldoDamian: sD, sueldoMaxi: sM }, { merge: true });
        btn.textContent = "✓ Guardado";
        setTimeout(() => { btn.textContent = "💾 Guardar Ingresos"; btn.disabled = false; }, 2000);
    } catch (error) { alert("Error al guardar ingresos."); }
});

document.getElementById('btn-guardar-saldos-base').addEventListener('click', async () => {
    const mes = filtroMesInput.value;
    const userActivo = obtenerNombreUsuario(auth.currentUser.email);
    const bEfectivo = obtenerNumeroLimpio('saldo-base-efectivo');
    const bGalicia = obtenerNumeroLimpio('saldo-base-galicia');
    const bMP = obtenerNumeroLimpio('saldo-base-mp');

    const btn = document.getElementById('btn-guardar-saldos-base');
    btn.textContent = "Guardando saldos..."; btn.disabled = true;

    try {
        await setDoc(doc(db, "configuracion", "saldos_cuentas_globales"), {
            [userActivo]: {
                efectivo: bEfectivo,
                galicia: bGalicia,
                mp: bMP,
                periodoBase: mes,
                actualizadoEn: new Date()
            }
        }, { merge: true });
        btn.textContent = "✓ Saldos Globales Guardados";
        setTimeout(() => { btn.textContent = "💾 Guardar Saldos Globales"; btn.disabled = false; }, 2000);
    } catch (error) { alert("Error al guardar saldos globales."); btn.textContent = "💾 Guardar Saldos Globales"; btn.disabled = false; }
});

function escucharTraspasosYPagosTarjetas() {
    const qTraspasos = query(collection(db, "traspasos_cuentas"), orderBy("fecha", "desc"));
    reemplazarSuscripcion('traspasos', onSnapshot(qTraspasos, (snapshot) => {
        listaTraspasosGlobal = [];
        snapshot.forEach((docSnap) => {
            const t = docSnap.data(); t.id = docSnap.id;
            listaTraspasosGlobal.push(t);
        });
        renderizarTraspasosCuenta();
        if(window.calcularDineroPersonalPrivado) window.calcularDineroPersonalPrivado();
    }));

    const qPagos = query(collection(db, "pagos_tarjeta"), orderBy("fecha", "desc"));
    reemplazarSuscripcion('pagosTarjeta', onSnapshot(qPagos, (snapshot) => {
        listaPagosTarjetasGlobal = [];
        snapshot.forEach((docSnap) => {
            const p = docSnap.data(); p.id = docSnap.id;
            listaPagosTarjetasGlobal.push(p);
        });
        if(window.calcularDineroPersonalPrivado) window.calcularDineroPersonalPrivado();
    }));

    const qAjustes = query(collection(db, "ajustes_cuenta"), orderBy("fecha", "desc"));
    reemplazarSuscripcion('ajustesCuenta', onSnapshot(qAjustes, (snapshot) => {
        listaAjustesCuentaGlobal = [];
        snapshot.forEach((docSnap) => {
            const ajuste = docSnap.data(); ajuste.id = docSnap.id;
            listaAjustesCuentaGlobal.push(ajuste);
        });
        renderizarAjustesCuenta();
        if(window.calcularDineroPersonalPrivado) window.calcularDineroPersonalPrivado();
    }));
}

function renderizarAjustesCuenta() {
    const contenedor = document.getElementById('lista-ajustes-cuenta');
    if (!contenedor || !auth.currentUser) return;

    const userActivo = obtenerNombreUsuario(auth.currentUser.email);
    const ajustes = listaAjustesCuentaGlobal
        .filter(ajuste => normalizarUsuarioId(ajuste.owner) === userActivo)
        .slice(0, 6);

    if (!ajustes.length) {
        contenedor.innerHTML = '<p class="balance-subtext">No hay ajustes registrados.</p>';
        return;
    }

    contenedor.innerHTML = ajustes.map((ajuste) => {
        const fechaObj = ajuste.fecha ? ajuste.fecha.toDate ? ajuste.fecha.toDate() : new Date(ajuste.fecha) : new Date();
        const fecha = fechaObj.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
        const signo = ajuste.tipo === 'compra_usd' ? '-' : (ajuste.tipo === 'extraccion_galicia' ? '↔' : '+');
        const cuenta = ajuste.tipo === 'extraccion_galicia' ? 'Galicia → Efectivo' : (ajuste.cuenta || '');
        return `
            <div class="item-compacto">
                <span>${fecha} · ${escapeHTML(describirTipoAjuste(ajuste.tipo))} · ${escapeHTML(cuenta)}</span>
                <div class="item-compacto-acciones">
                    <strong>${signo}$${new Intl.NumberFormat('es-AR').format(Math.abs(Number(ajuste.monto || 0)))}</strong>
                    <button type="button" class="btn-eliminar" title="Borrar ajuste" onclick="eliminarAjusteCuenta('${escapeAttr(ajuste.id)}')">🗑️</button>
                </div>
            </div>
        `;
    }).join('');
}

window.eliminarAjusteCuenta = async function(id) {
    if (!confirm("¿Borrar este ajuste de cuenta?")) return;
    try {
        await deleteDoc(doc(db, "ajustes_cuenta", id));
    } catch (error) {
        alert("Error al borrar el ajuste.");
    }
};

function describirTipoAjuste(tipo) {
    if (tipo === 'compra_usd') return 'Compra USD';
    if (tipo === 'rendimiento_mp') return 'Rendimiento MP';
    if (tipo === 'extraccion_galicia') return 'Extracción';
    return 'Ajuste manual';
}

function traspasoPerteneceAUsuario(traspaso, userActivo) {
    return !traspaso.owner || normalizarUsuarioId(traspaso.owner) === normalizarUsuarioId(userActivo);
}

function nombreCuentaFija(cuenta) {
    if (cuenta === 'efectivo') return 'Efectivo';
    if (cuenta === 'mp') return 'Mercado Pago';
    return 'Banco Galicia';
}

function renderizarTraspasosCuenta() {
    const contenedor = document.getElementById('lista-traspasos-cuenta');
    if (!contenedor || !auth.currentUser) return;

    const userActivo = obtenerNombreUsuario(auth.currentUser.email);
    const traspasos = listaTraspasosGlobal
        .filter(traspaso => traspasoPerteneceAUsuario(traspaso, userActivo))
        .slice(0, 8);

    if (!traspasos.length) {
        contenedor.innerHTML = '<p class="balance-subtext">No hay traspasos registrados.</p>';
        return;
    }

    contenedor.innerHTML = traspasos.map((traspaso) => {
        const fecha = traspaso.fecha?.toDate
            ? traspaso.fecha.toDate().toLocaleDateString('es-AR')
            : new Date(traspaso.fecha).toLocaleDateString('es-AR');
        return `
            <div class="item-compacto">
                <span>${fecha} · ${escapeHTML(nombreCuentaFija(traspaso.origen))} → ${escapeHTML(nombreCuentaFija(traspaso.destino))}</span>
                <div class="item-compacto-acciones">
                    <strong>$${new Intl.NumberFormat('es-AR').format(Number(traspaso.monto || 0))}</strong>
                    <button type="button" class="btn-eliminar" title="Borrar traspaso" onclick="eliminarTraspasoCuenta('${escapeAttr(traspaso.id)}')">🗑️</button>
                </div>
            </div>
        `;
    }).join('');
}

window.eliminarTraspasoCuenta = async function(id) {
    if (!confirm("¿Borrar este traspaso entre cuentas?")) return;
    try {
        await deleteDoc(doc(db, "traspasos_cuentas", id));
    } catch (error) {
        alert("Error al borrar el traspaso.");
    }
};

document.getElementById('form-traspaso-cuentas').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fecha = new Date(document.getElementById('traspaso-fecha').value + "T12:00:00");
    const origen = document.getElementById('traspaso-origen').value;
    const destino = document.getElementById('traspaso-destino').value;
    const monto = obtenerNumeroLimpio('traspaso-monto');

    if (origen === destino) {
        alert("La cuenta de origen y destino deben ser diferentes.");
        return;
    }
    if (!monto || monto <= 0) return;

    try {
        await addDoc(collection(db, "traspasos_cuentas"), {
            fecha: fecha, origen: origen, destino: destino, monto: monto,
            owner: usuarioActivoId,
            periodo: filtroMesInput.value,
            usuarioCreador: auth.currentUser.email,
            createdAt: new Date()
        });
        document.getElementById('form-traspaso-cuentas').reset();
        document.getElementById('traspaso-fecha').value = new Date().toISOString().split('T')[0];
        if(window.calcularDineroPersonalPrivado) window.calcularDineroPersonalPrivado();
        alert("Traspaso entre cuentas registrado correctamente.");
    } catch (error) { alert("Error al registrar el traspaso."); }
});

document.getElementById('form-pago-tarjeta').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fecha = new Date(document.getElementById('pago-tarjeta-fecha').value + "T12:00:00");
    const tarjetaTipo = document.getElementById('pago-tarjeta-tipo').value;
    const cuentaLiquidadora = document.getElementById('pago-tarjeta-cuenta').value;
    const monto = obtenerNumeroLimpio('pago-tarjeta-monto');

    if (!monto || monto <= 0) return;

    try {
        await addDoc(collection(db, "pagos_tarjeta"), {
            fecha: fecha, tarjetaTipo: tarjetaTipo, cuentaLiquidadora: cuentaLiquidadora, monto: monto,
            owner: usuarioActivoId,
            periodo: filtroMesInput.value,
            usuarioCreador: auth.currentUser.email,
            createdAt: new Date()
        });
        document.getElementById('form-pago-tarjeta').reset();
        document.getElementById('pago-tarjeta-fecha').value = new Date().toISOString().split('T')[0];
        document.getElementById('contenedor-pago-tarjeta').classList.add('oculto');
        alert("Pago de tarjeta registrado correctamente.");
    } catch (error) { alert("Error al registrar el pago de tarjeta."); }
});

document.getElementById('form-ajuste-cuenta').addEventListener('submit', async (e) => {
    e.preventDefault();
    const tipo = document.getElementById('ajuste-tipo').value;
    const cuenta = document.getElementById('ajuste-cuenta').value;
    const monto = obtenerNumeroLimpio('ajuste-monto');
    const usd = obtenerNumeroLimpio('ajuste-usd');
    const cotizacion = obtenerNumeroLimpio('ajuste-cotizacion');
    const fecha = new Date(document.getElementById('ajuste-fecha').value + "T12:00:00");
    const nota = document.getElementById('ajuste-nota').value.trim();

    if (!monto) return;

    try {
        await addDoc(collection(db, "ajustes_cuenta"), {
            tipo,
            cuenta,
            monto,
            usd,
            cotizacion,
            nota,
            fecha,
            owner: usuarioActivoId,
            usuarioCreador: auth.currentUser.email,
            createdAt: new Date()
        });
        document.getElementById('form-ajuste-cuenta').reset();
        document.getElementById('ajuste-fecha').value = new Date().toISOString().split('T')[0];
    } catch (error) {
        alert("Error al registrar el ajuste.");
    }
});

document.getElementById('ajuste-tipo').addEventListener('change', (e) => {
    if (e.target.value === 'compra_usd') document.getElementById('ajuste-cuenta').value = 'galicia';
    if (e.target.value === 'rendimiento_mp') document.getElementById('ajuste-cuenta').value = 'mp';
    if (e.target.value === 'extraccion_galicia') document.getElementById('ajuste-cuenta').value = 'galicia';
});

// LÓGICA DE PRÉSTAMOS
function escucharPrestamoYcuotas() {
    reemplazarSuscripcion('prestamoConfig', onSnapshot(doc(db, "configuracion", "prestamo_auto_maxi"), (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            document.getElementById('prestamo-monto-original').value = new Intl.NumberFormat('es-AR').format(data.montoOriginal || 0);
            document.getElementById('prestamo-fecha-inicio').value = data.fechaInicio || "2026-02-01";
            document.getElementById('prestamo-motivo').value = data.motivo || "Préstamo Compra Auto Maxi";
        }
        recalcularTotalesPrestamo();
    }));

    const q = query(collection(db, "cuotas_prestamo"), orderBy("fecha", "desc"));
    reemplazarSuscripcion('cuotasPrestamo', onSnapshot(q, (snapshot) => {
        listaCuotasPrestamoGlobal = [];
        const tbody = document.getElementById('tabla-prestamo-cuotas-body');
        tbody.innerHTML = "";

        snapshot.forEach((docSnap) => {
            const cuota = docSnap.data(); cuota.id = docSnap.id;
            listaCuotasPrestamoGlobal.push(cuota);

            const fechaObj = cuota.fecha ? cuota.fecha.toDate() : new Date();
            const fechaFmt = fechaObj.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });

            let cuentaFmt = "💵 Efectivo";
            if (cuota.cuentaDestino === 'mp') cuentaFmt = "📱 Mercado Pago";
            else if (cuota.cuentaDestino === 'galicia') cuentaFmt = "🏦 Banco Galicia";

            tbody.innerHTML += `
                <tr>
                    <td>${fechaFmt}</td>
                    <td>${escapeHTML(cuota.motivo || "Pago cuota auto")}</td>
                    <td><span class="badge-pagado">${cuentaFmt}</span></td>
                    <td><strong>$${new Intl.NumberFormat('es-AR').format(cuota.monto)}</strong></td>
                    <td><button class="btn-eliminar" onclick="eliminarCuotaPrestamo('${cuota.id}')">🗑️</button></td>
                </tr>`;
        });

        if (listaCuotasPrestamoGlobal.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-secondary);">No hay pagos registrados.</td></tr>`;
        }

        recalcularTotalesPrestamo();
        if(window.calcularDineroPersonalPrivado) window.calcularDineroPersonalPrivado();
    }));
}

document.getElementById('form-config-prestamo').addEventListener('submit', async (e) => {
    e.preventDefault();
    const montoOriginal = obtenerNumeroLimpio('prestamo-monto-original');
    const fechaInicio = document.getElementById('prestamo-fecha-inicio').value;
    const motivo = document.getElementById('prestamo-motivo').value;

    try {
        await setDoc(doc(db, "configuracion", "prestamo_auto_maxi"), {
            montoOriginal: montoOriginal, fechaInicio: fechaInicio, motivo: motivo
        }, { merge: true });
        alert("Préstamo configurado correctamente.");
    } catch (error) { alert("Error al guardar la configuración del préstamo."); }
});

document.getElementById('form-pago-prestamo').addEventListener('submit', async (e) => {
    e.preventDefault();
    const montoCuota = obtenerNumeroLimpio('cuota-monto');
    const fechaCuota = new Date(document.getElementById('cuota-fecha').value + "T12:00:00");
    const cuentaDestino = document.getElementById('cuota-cuenta-destino').value;

    if (!montoCuota || montoCuota <= 0) return;

    try {
        await addDoc(collection(db, "cuotas_prestamo"), {
            monto: montoCuota, fecha: fechaCuota, cuentaDestino: cuentaDestino,
            motivo: "Cuota préstamo auto Maxi", usuarioCreador: auth.currentUser.email,
            owner: usuarioActivoId,
            periodo: filtroMesInput.value,
            createdAt: new Date()
        });
        document.getElementById('form-pago-prestamo').reset();
        document.getElementById('cuota-fecha').value = new Date().toISOString().split('T')[0];
    } catch (error) { alert("Error al registrar el cobro de la cuota."); }
});

window.eliminarCuotaPrestamo = async function(id) {
    if (confirm("¿Borrar este pago del préstamo?")) { await deleteDoc(doc(db, "cuotas_prestamo", id)); }
};

function recalcularTotalesPrestamo() {
    const montoOriginal = obtenerNumeroLimpio('prestamo-monto-original');
    const totales = calcularTotalesPrestamo(montoOriginal, listaCuotasPrestamoGlobal);

    document.getElementById('metric-prestamo-original').textContent = "$" + new Intl.NumberFormat('es-AR').format(totales.montoOriginal);
    document.getElementById('metric-prestamo-cobrado').textContent = "$" + new Intl.NumberFormat('es-AR').format(totales.totalCobrado);
    document.getElementById('metric-prestamo-pendiente').textContent = "$" + new Intl.NumberFormat('es-AR').format(totales.pendiente);
}

window.estadoDeudaActual = null;
document.getElementById('btn-abrir-saldar').addEventListener('click', () => {
    const cont = document.getElementById('contenedor-saldar-deuda');
    cont.classList.remove('oculto');
    const hoyStr = new Date().toISOString().split('T')[0];
    document.getElementById('saldar-fecha').value = hoyStr;
    if (window.estadoDeudaActual) {
        document.getElementById('saldar-monto').value = new Intl.NumberFormat('es-AR').format(window.estadoDeudaActual.monto);
    }
});

document.getElementById('form-saldar-deuda').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!window.estadoDeudaActual) return;
    const montoLimpio = obtenerNumeroLimpio('saldar-monto');
    const medio = document.getElementById('saldar-medio').value;
    const fechaIngresada = new Date(document.getElementById('saldar-fecha').value + "T12:00:00");
    const periodoActual = filtroMesInput.value;

    if (!montoLimpio || montoLimpio <= 0) return;

    try {
        await addDoc(collection(db, "gastos"), {
            concepto: "Liquidación de saldos del mes", monto: montoLimpio, categoria: "Liquidación",
            pagadoPor: normalizarUsuarioId(window.estadoDeudaActual.deudor), tipoReparto: "devolucion", formato: medio,
            medioId: "", usuarioCreador: auth.currentUser.email, fecha: fechaIngresada, periodo: periodoActual,
            owner: normalizarUsuarioId(window.estadoDeudaActual.deudor),
            createdAt: new Date()
        });
        document.getElementById('form-saldar-deuda').reset();
        document.getElementById('contenedor-saldar-deuda').classList.add('oculto');
    } catch (error) { alert("Error al registrar el pago de la deuda."); }
});

function escucharGastosEnTiempoReal() {
    const q = query(collection(db, "gastos"), orderBy("fecha", "desc"));
    reemplazarSuscripcion('gastos', onSnapshot(q, (snapshot) => {
        listaGastosGlobal = [];
        listaGastosCompletaBase = []; // Almacena todos los documentos sin filtrar por mes para el cálculo de saldos físicos
        const tablaComunBody = document.getElementById('tabla-gastos-body');
        const tablaPrivadaBody = document.getElementById('tabla-gastos-privados-body');
        tablaComunBody.innerHTML = ""; tablaPrivadaBody.innerHTML = "";

        const mesSeleccionado = filtroMesInput.value;
        const usuarioLogueadoActual = obtenerNombreUsuario(auth.currentUser.email);

        let contadorComunes = 0; let contadorPrivados = 0;

        snapshot.forEach((docSnap) => {
            const gasto = docSnap.data(); gasto.id = docSnap.id;
            listaGastosCompletaBase.push(gasto); // Se guarda para el cálculo de caja independiente del período

            const fechaObj = gasto.fecha ? gasto.fecha.toDate() : new Date();
            const periodoGasto = gasto.periodo ? gasto.periodo : fechaObj.toISOString().slice(0, 7);

            if (periodoGasto === mesSeleccionado) {
                listaGastosGlobal.push(gasto);
                const fechaFormateada = fechaObj.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
                const montoFormateado = new Intl.NumberFormat('es-AR').format(gasto.monto);
                const conceptoSeguro = escapeHTML(gasto.concepto || 'Sin concepto');
                const conceptoAttr = escapeAttr((gasto.concepto || '').toLowerCase());
                const categoriaSegura = escapeHTML(gasto.categoria || 'Sin categoria');
                const categoriaAttr = escapeAttr(gasto.categoria || '');
                const pagadoPorSeguro = usuarioLabelSeguro(gasto.pagadoPor, false);

                let medioFiltroVal = gasto.medioId ? gasto.medioId : gasto.formato;
                const medioAttr = escapeAttr(medioFiltroVal);
                let valorSeleccionadoActual = gasto.medioId ? `${gasto.formato === 'tarjeta' ? 'tarjeta_' : 'cuenta_'}${gasto.medioId}` : 'efectivo';

                let selectMedioTablaHTML = `<select class="mini-select" onchange="actualizarMedioGasto('${gasto.id}', this.value)">`;
                selectMedioTablaHTML += `<option value="efectivo" ${valorSeleccionadoActual === 'efectivo' ? 'selected' : ''}>💵 Efectivo</option>`;

                listaTarjetasGlobal.forEach(t => {
                    const val = `tarjeta_${t.id}`;
                    const isSelected = (val === valorSeleccionadoActual) ? 'selected' : '';
                    const desc = t.tipo === 'extension' ? 'Ext' : 'Propia';
                    selectMedioTablaHTML += `<option value="${escapeAttr(val)}" ${isSelected}>💳 ${escapeHTML(t.marca)} (${desc})</option>`;
                });

                listaCuentasGlobal.forEach(c => {
                    const val = `cuenta_${c.id}`;
                    const isSelected = (val === valorSeleccionadoActual) ? 'selected' : '';
                    selectMedioTablaHTML += `<option value="${escapeAttr(val)}" ${isSelected}>🏦 ${escapeHTML(c.banco)}</option>`;
                });
                selectMedioTablaHTML += `</select>`;

                const accionesHTML = `
                    <div class="acciones-celda">
                        <button class="btn-editar-icono" title="Reimputar período" onclick="editarPeriodoImputacion('${gasto.id}')">📅</button>
                        <button class="btn-editar-icono" title="Editar concepto" onclick="editarConcepto('${gasto.id}')">✏️</button>
                        <button class="btn-eliminar" title="Eliminar gasto" onclick="eliminarGasto('${gasto.id}')">🗑️</button>
                    </div>
                `;

                const colChkComun = `<td class="col-chk ${modoSeleccionActivoComun ? '' : 'oculto'}"><input type="checkbox" class="chk-tabla chk-item" value="${gasto.id}"></td>`;
                const colChkPriv = `<td class="col-chk ${modoSeleccionActivoPrivado ? '' : 'oculto'}"><input type="checkbox" class="chk-tabla chk-item" value="${gasto.id}"></td>`;

                if (gasto.tipoReparto === 'comun' || gasto.tipoReparto === 'proporcional' || gasto.tipoReparto === 'devolucion') {
                    contadorComunes++;
                    let categoriaComunHTML = categoriaSegura;
                    if (gasto.tipoReparto !== 'devolucion') {
                        const categoriasDisponibles = gasto.tipoReparto === 'proporcional' ? categoriasPorTipo['proporcional'] : categoriasPorTipo['comun'];
                        categoriaComunHTML = `<select class="mini-select" onchange="actualizarCategoriaGasto('${gasto.id}', this.value)">`;
                        categoriasDisponibles.forEach(cat => {
                            const isSelected = cat === gasto.categoria ? 'selected' : '';
                            categoriaComunHTML += `<option value="${escapeAttr(cat)}" ${isSelected}>${escapeHTML(cat)}</option>`;
                        });
                        categoriaComunHTML += `</select>`;
                    }
                    let selectRepartoHTML = `<select class="mini-select" onchange="actualizarRepartoGasto('${gasto.id}', this.value)">
                        <option value="comun" ${gasto.tipoReparto === 'comun' ? 'selected' : ''}>🤝 Común</option>
                        <option value="privado" ${gasto.tipoReparto === 'privado' ? 'selected' : ''}>👤 Personal</option>
                        <option value="proporcional" ${gasto.tipoReparto === 'proporcional' ? 'selected' : ''}>🏠 Alquiler %</option>
                    </select>`;
                    if (gasto.tipoReparto === 'devolucion') { selectRepartoHTML = `<span class="badge-pagado">🤝 Liquidación</span>`; }

                    tablaComunBody.innerHTML += `
                        <tr data-concepto="${conceptoAttr}" data-categoria="${categoriaAttr}" data-medio="${medioAttr}">
                            ${colChkComun}
                            <td>${fechaFormateada}</td>
                            <td><strong>${conceptoSeguro}</strong></td>
                            <td>${categoriaComunHTML}</td>
                            <td><span class="badge-pagado">${pagadoPorSeguro}</span></td>
                            <td>${selectMedioTablaHTML}</td>
                            <td>${selectRepartoHTML}</td>
                            <td><strong>$${montoFormateado}</strong></td>
                            <td>${accionesHTML}</td>
                        </tr>`;
                }

            if (gasto.tipoReparto === 'privado' && normalizarUsuarioId(gasto.pagadoPor) === usuarioLogueadoActual) {
                    contadorPrivados++;
                    let selectRepartoPrivadoHTML = `<select class="mini-select" onchange="actualizarRepartoGasto('${gasto.id}', this.value)">
                        <option value="comun">🤝 Común</option>
                        <option value="privado" selected>👤 Personal</option>
                        <option value="proporcional">🏠 Alquiler %</option>
                    </select>`;

                    let selectCatHTML = `<select class="mini-select" onchange="actualizarCategoriaGasto('${gasto.id}', this.value)">`;
                    categoriasPorTipo['privado'].forEach(cat => {
                        let isSelected = (cat === gasto.categoria) ? 'selected' : '';
                        selectCatHTML += `<option value="${cat}" ${isSelected}>${cat}</option>`;
                    });
                    selectCatHTML += `</select>`;

                    tablaPrivadaBody.innerHTML += `
                        <tr data-concepto="${conceptoAttr}" data-categoria="${categoriaAttr}" data-medio="${medioAttr}">
                            ${colChkPriv}
                            <td>${fechaFormateada}</td>
                            <td><strong>${conceptoSeguro}</strong></td>
                            <td>${selectRepartoPrivadoHTML}</td>
                            <td>${selectCatHTML}</td>
                            <td>${selectMedioTablaHTML}</td>
                            <td><strong>$${montoFormateado}</strong></td>
                            <td>${accionesHTML}</td>
                        </tr>`;
                }
            }
        });

        if (contadorComunes === 0) tablaComunBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-secondary);">No hay gastos comunes o liquidaciones registradas.</td></tr>`;
        if (contadorPrivados === 0) tablaPrivadaBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-secondary);">No tenés gastos personales registrados.</td></tr>`;

        filtrarTabla('tabla-gastos-body', 'search-comun', 'cat-comun', 'medio-comun');
        filtrarTabla('tabla-gastos-privados-body', 'search-privado', 'cat-privado', 'medio-privado');

        recalcularBalanceNeteado();
        calcularDineroPersonalPrivado();
        actualizarGraficosDashboard();
    }));
}

window.eliminarGasto = async function(id) {
    if (!confirm("¿Borrar este gasto o pago?")) return;
    try {
        await deleteDoc(doc(db, "gastos", id));
    } catch (error) {
        alert("No se pudo borrar el gasto. Si vuelve a aparecer, puede ser un gasto con permisos antiguos; probá recargar o avisame para revisar ese registro.");
    }
};

document.getElementById('form-gasto').addEventListener('submit', async (e) => {
    e.preventDefault();
    const concepto = document.getElementById('concepto').value;
    const montoLimpio = obtenerNumeroLimpio('monto');
    const formato = document.getElementById('formato-pago').value;
    const tipoReparto = document.getElementById('tipo-reparto').value;
    const fechaManual = document.getElementById('fecha-manual').value;
    const periodoImputacion = document.getElementById('periodo-imputacion').value;
    const fechaGasto = new Date(fechaManual + "T12:00:00");

    let medioId = "";
    if (formato === 'tarjeta') medioId = document.getElementById('gasto-tarjeta-asociada').value;
    else if (formato === 'transferencia') medioId = document.getElementById('gasto-cuenta-asociada').value;

    if (!montoLimpio) return;

    try {
        await addDoc(collection(db, "gastos"), {
        concepto: concepto, monto: montoLimpio, categoria: document.getElementById('categoria').value,
        pagadoPor: normalizarUsuarioId(document.getElementById('pagado-por').value), tipoReparto,
            formato: formato, medioId: medioId, usuarioCreador: auth.currentUser.email,
            owner: tipoReparto === 'privado' ? usuarioActivoId : 'hogar',
            esPrivado: tipoReparto === 'privado',
            fecha: fechaGasto, periodo: periodoImputacion,
            createdAt: new Date()
        });
        document.getElementById('form-gasto').reset();
        fechaManualInput.value = new Date().toISOString().split('T')[0];
        periodoEditadoManual = false;
        if (usuarioActivoId) selectPagadoPor.value = usuarioActivoId;
        actualizarCategoriasManuales();
        sincronizarCargaConUsuario();
        sugerirPeriodoImputacion({ forzar: true });
    } catch (e) { alert("Error al confirmar el gasto."); }
});

document.getElementById('btn-procesar-archivo').addEventListener('click', async () => {
    const medioImportacion = document.getElementById('archivo-medio-select').value;
    const file = document.getElementById('archivo-input').files[0];
    if (!file) return;

    const btn = document.getElementById('btn-procesar-archivo'); btn.disabled = true;
    try {
        const consumos = await procesarExcelOCSV(file);
        renderizarBorradoresImportacion(consumos, medioImportacion);
    } catch (error) { alert("Error al leer la planilla."); } finally { btn.disabled = false; }
});

function renderizarBorradoresImportacion(consumos, medioImportacion) {
    const tbody = document.getElementById('tabla-previa-ia-body'); tbody.innerHTML = "";
    document.getElementById('contenedor-previa-ia').classList.remove('oculto');

    let pDefecto = USUARIOS.DAMIAN;
    if (medioImportacion.startsWith('tarjeta_')) {
        const id = medioImportacion.replace('tarjeta_', '');
        const tObj = listaTarjetasGlobal.find(t => t.id === id);
        if (tObj) pDefecto = normalizarUsuarioId(tObj.titular) || USUARIOS.DAMIAN;
    } else if (medioImportacion.startsWith('cuenta_')) {
        const id = medioImportacion.replace('cuenta_', '');
        const cObj = listaCuentasGlobal.find(c => c.id === id);
        if (cObj) pDefecto = normalizarUsuarioId(cObj.titular) || USUARIOS.DAMIAN;
    }

    listaBorradoresImportacion = consumos;

    let optCats = ''; categoriasPorTipo['comun'].forEach(cat => { optCats += `<option value="${escapeAttr(cat)}">${escapeHTML(cat)}</option>`; });
    let optMedios = `<option value="efectivo">💵 Efectivo / Otra</option>`;
    listaTarjetasGlobal.forEach(t => {
        const selected = medioImportacion === `tarjeta_${t.id}` ? 'selected' : '';
        optMedios += `<option value="tarjeta_${escapeAttr(t.id)}" ${selected}>💳 ${escapeHTML(t.marca)} - ${usuarioLabelSeguro(t.titular, true)}</option>`;
    });
    listaCuentasGlobal.forEach(c => {
        const selected = medioImportacion === `cuenta_${c.id}` ? 'selected' : '';
        optMedios += `<option value="cuenta_${escapeAttr(c.id)}" ${selected}>🏦 ${escapeHTML(c.banco)} - ${usuarioLabelSeguro(c.titular, true)}</option>`;
    });

    consumos.forEach((c, i) => {
        const tr = document.createElement('tr');
        const posibleDuplicado = esPosibleDuplicadoImportacion(c);
        if (posibleDuplicado) tr.classList.add('fila-duplicado');
        const avisoDuplicado = posibleDuplicado ? '<br><span class="badge-alerta">Posible duplicado</span>' : '';
        const formatoInicial = medioImportacion.startsWith('tarjeta_') ? 'tarjeta' : (medioImportacion.startsWith('cuenta_') ? 'transferencia' : 'efectivo');
        const periodoSugerido = obtenerPeriodoSugeridoParaGasto({ fechaValor: c.fechaObj?.toISOString().slice(0, 10), tipo: 'comun', formato: formatoInicial });
        tr.innerHTML = `
            <td>${escapeHTML(c.fecha)}</td><td><strong>${escapeHTML(c.concepto)}</strong>${avisoDuplicado}</td><td>$${new Intl.NumberFormat('es-AR').format(c.monto)}</td>
            <td><select class="mini-select" id="reparto-borrador-${i}" onchange="actualizarCategoriasFilaBorrador(${i})"><option value="comun" selected>Común</option><option value="privado">Personal</option><option value="proporcional">Alquiler %</option></select></td>
            <td><select class="mini-select" id="cat-borrador-${i}">${optCats}</select></td>
            <td><select class="mini-select" id="pagador-borrador-${i}"><option value="damian" ${pDefecto === USUARIOS.DAMIAN ? 'selected' : ''}>Damián</option><option value="maxi" ${pDefecto === USUARIOS.MAXI ? 'selected' : ''}>Maxi</option></select></td>
            <td><select class="mini-select" id="medio-borrador-${i}" onchange="actualizarPeriodoFilaBorrador(${i})">${optMedios}</select></td>
            <td><input type="month" class="mini-input" id="periodo-borrador-${i}" value="${periodoSugerido}"></td>
            <td><button class="btn-accion-rapida" onclick="confirmarGastoBorrador(${i}, this)">+ Agregar</button></td>`;
        tbody.appendChild(tr);
    });
}

async function procesarCapturaGastos(file) {
    if (!file || !window.Tesseract) {
        alert('No se pudo iniciar el lector de capturas.');
        return;
    }
    const zona = document.getElementById('zona-captura');
    zona.querySelector('span').textContent = 'Leyendo captura...';
    try {
        const resultado = await window.Tesseract.recognize(file, 'spa+eng');
        const consumos = extraerConsumosDesdeTextoOCR(resultado.data.text);
        if (!consumos.length) {
            alert('No pude detectar movimientos claros. Probá con una captura más nítida o importá el archivo del banco.');
            return;
        }
        renderizarBorradoresImportacion(consumos, document.getElementById('archivo-medio-select').value);
    } catch (error) {
        alert('Error al leer la captura.');
    } finally {
        zona.querySelector('span').textContent = 'Copiá la imagen y pegala acá, o seleccioná una captura.';
    }
}

document.getElementById('captura-input').addEventListener('change', (e) => procesarCapturaGastos(e.target.files[0]));
document.getElementById('zona-captura').addEventListener('paste', (e) => {
    const item = [...e.clipboardData.items].find(clip => clip.type.startsWith('image/'));
    if (item) procesarCapturaGastos(item.getAsFile());
});

window.confirmarGastoBorrador = async function(index, boton) {
    try {
        const borrador = listaBorradoresImportacion[index];
        if (!borrador) {
            alert("No se encontró el consumo del borrador.");
            return;
        }
        if (esPosibleDuplicadoImportacion(borrador) && !confirm("Este consumo parece estar cargado previamente. ¿Querés agregarlo igual?")) {
            return;
        }
        const medioSeleccionado = document.getElementById(`medio-borrador-${index}`).value;
        const tipoReparto = document.getElementById(`reparto-borrador-${index}`).value;
        const pagadoPor = normalizarUsuarioId(document.getElementById(`pagador-borrador-${index}`).value);
        let formato = 'efectivo'; let medioId = '';

        if (medioSeleccionado.startsWith('tarjeta_')) { formato = 'tarjeta'; medioId = medioSeleccionado.replace('tarjeta_', ''); }
        else if (medioSeleccionado.startsWith('cuenta_')) { formato = 'transferencia'; medioId = medioSeleccionado.replace('cuenta_', ''); }

        await addDoc(collection(db, "gastos"), {
            concepto: borrador.concepto, monto: borrador.monto, categoria: document.getElementById(`cat-borrador-${index}`).value,
            pagadoPor, tipoReparto,
            formato: formato, medioId: medioId, usuarioCreador: auth.currentUser.email, fecha: borrador.fechaObj || new Date(),
            owner: tipoReparto === 'privado' ? pagadoPor : 'hogar',
            esPrivado: tipoReparto === 'privado',
            periodo: document.getElementById(`periodo-borrador-${index}`).value || filtroMesInput.value,
            createdAt: new Date()
        });
        boton.parentElement.innerHTML = `<span style="color: var(--success-color); font-weight: bold;">✓ Agregado</span>`;
    } catch (error) { alert("Error al confirmar."); }
};

window.recalcularBalanceNeteado = function() {
    const sueldoDamian = obtenerNumeroLimpio('sueldo-damian'); const sueldoMaxi = obtenerNumeroLimpio('sueldo-maxi');
    const balance = calcularBalanceNeteado({
        gastos: listaGastosGlobal,
        tarjetas: listaTarjetasGlobal,
        sueldoDamian,
        sueldoMaxi
    });

    document.getElementById('detalle-saldos').textContent = `Paga al banco/resumen compartido: Damián $${new Intl.NumberFormat('es-AR').format(balance.totalPagadoDamian)} | Maxi $${new Intl.NumberFormat('es-AR').format(balance.totalPagadoMaxi)}`;
    renderizarDetalleBalance(balance);
    actualizarCierreMensual(balance);
    actualizarProyeccion();

    const resTexto = document.getElementById('resultado-balance'); const estMetrica = document.getElementById('metric-estado');
    const btnAbrirSaldar = document.getElementById('btn-abrir-saldar'); const contSaldar = document.getElementById('contenedor-saldar-deuda');

    if (balance.estaAlDia) {
        resTexto.textContent = "🎉 ¡Las cuentas están perfectamente al día!"; estMetrica.textContent = "Al día";
        estMetrica.classList.remove('texto-positivo', 'texto-negativo', 'texto-alerta');
        estMetrica.classList.add('texto-positivo');
        btnAbrirSaldar.classList.add('oculto'); contSaldar.classList.add('oculto'); window.estadoDeudaActual = null;
    } else if (balance.estadoDeuda.deudor === USUARIOS.MAXI) {
        resTexto.textContent = `👉 Maxi le debe $${new Intl.NumberFormat('es-AR').format(balance.estadoDeuda.monto)} a Damián`; estMetrica.textContent = `Maxi debe $${new Intl.NumberFormat('es-AR').format(balance.estadoDeuda.monto)}`;
        estMetrica.classList.remove('texto-positivo', 'texto-negativo', 'texto-alerta');
        estMetrica.classList.add('texto-alerta');
        btnAbrirSaldar.classList.remove('oculto'); window.estadoDeudaActual = { deudor: USUARIOS.MAXI, monto: balance.estadoDeuda.monto };
    } else {
        resTexto.textContent = `👉 Damián le debe $${new Intl.NumberFormat('es-AR').format(balance.estadoDeuda.monto)} a Maxi`; estMetrica.textContent = `Dami debe $${new Intl.NumberFormat('es-AR').format(balance.estadoDeuda.monto)}`;
        estMetrica.classList.remove('texto-positivo', 'texto-negativo', 'texto-alerta');
        estMetrica.classList.add('texto-alerta');
        btnAbrirSaldar.classList.remove('oculto'); window.estadoDeudaActual = { deudor: USUARIOS.DAMIAN, monto: balance.estadoDeuda.monto };
    }
};

function formatearEfectoBalance(monto) {
    const montoRedondeado = Math.round(Math.abs(monto));
    if (montoRedondeado === 0) return '$0';
    const direccion = monto > 0 ? 'Maxi debe a Damián' : 'Damián debe a Maxi';
    return `${direccion}: $${new Intl.NumberFormat('es-AR').format(montoRedondeado)}`;
}

function renderizarDetalleBalance(balance) {
    const contenedor = document.getElementById('detalle-balance-box');
    if (!contenedor || !balance.detalleBalance) return;

    const grupos = ['comun', 'proporcional', 'privado', 'devolucion'];
    const htmlGrupos = grupos.map((clave) => {
        const grupo = balance.detalleBalance[clave];
        if (!grupo || !grupo.items.length) return '';

        const items = grupo.items.slice(0, 8).map((item) => `
            <p>
                <span>${escapeHTML(item.concepto)} <small>(${usuarioLabelSeguro(item.pagadoPor, true)})</small></span>
                <span>${formatearEfectoBalance(item.efectoDamian)}</span>
            </p>
        `).join('');
        const resto = grupo.items.length > 8
            ? `<p><span>Y ${grupo.items.length - 8} movimientos más</span><span>${formatearEfectoBalance(grupo.items.slice(8).reduce((total, item) => total + item.efectoDamian, 0))}</span></p>`
            : '';

        return `
            <div class="detalle-balance-grupo">
                <h3><span>${escapeHTML(grupo.titulo)}</span><span>${formatearEfectoBalance(grupo.monto)}</span></h3>
                ${items}
                ${resto}
            </div>
        `;
    }).join('');

    contenedor.innerHTML = htmlGrupos || '<p class="balance-subtext">No hay movimientos para explicar en este período.</p>';
    contenedor.innerHTML += `<p class="detalle-balance-total">${formatearEfectoBalance(balance.balanceNetoDamian)}</p>`;
}

function mesSiguiente(periodo) {
    const [anio, mes] = periodo.split('-').map(Number);
    if (!anio || !mes) return mesActualStr;
    const fecha = new Date(anio, mes, 1);
    return fecha.toISOString().slice(0, 7);
}

function compararPeriodos(a, b) {
    return a.localeCompare(b);
}

function mesesEntre(inicio, fin) {
    const meses = [];
    let cursor = inicio;
    while (compararPeriodos(cursor, fin) <= 0 && meses.length < 240) {
        meses.push(cursor);
        cursor = mesSiguiente(cursor);
    }
    return meses;
}

function obtenerSaldosBaseDesdeDoc(data) {
    return {
        efectivo: Number(data?.baseEfectivoDamian || 0),
        galicia: Number(data?.baseGaliciaDamian || 0),
        mp: Number(data?.baseMPDamian || 0)
    };
}

function tieneSaldosBase(data) {
    return data && (
        data.baseEfectivoDamian !== undefined ||
        data.baseGaliciaDamian !== undefined ||
        data.baseMPDamian !== undefined
    );
}

function obtenerSaldosGlobalesUsuario(userActivo) {
    const saldosUsuario = saldosCuentasGlobales[normalizarUsuarioId(userActivo)];
    if (!saldosUsuario) return null;
    return {
        efectivo: Number(saldosUsuario.efectivo || 0),
        galicia: Number(saldosUsuario.galicia || 0),
        mp: Number(saldosUsuario.mp || 0),
        periodoBase: saldosUsuario.periodoBase || mesActualStr,
        actualizadoEn: saldosUsuario.actualizadoEn || null,
        esGlobal: true
    };
}

function obtenerUltimosSaldosMensualesLegacy() {
    const periodosConBase = Object.keys(ingresosPorMesGlobal)
        .filter(periodo => tieneSaldosBase(ingresosPorMesGlobal[periodo]))
        .sort();
    const periodoBase = periodosConBase[periodosConBase.length - 1];
    if (!periodoBase) return null;
    return {
        ...obtenerSaldosBaseDesdeDoc(ingresosPorMesGlobal[periodoBase]),
        periodoBase,
        actualizadoEn: null,
        esGlobal: false
    };
}

function periodoDesdeFechaMovimiento(fecha) {
    const key = fechaLocalKey(fecha);
    return key ? key.slice(0, 7) : '';
}

function obtenerPeriodoSaldoGlobal(userActivo, periodoBase) {
    const periodos = [mesActualStr, periodoBase].filter(Boolean);

    listaGastosCompletaBase.forEach((gasto) => {
        const pagadorFinanciero = obtenerPagadorFinanciero(gasto, listaTarjetasGlobal);
        if (pagadorFinanciero !== normalizarUsuarioId(userActivo)) return;
        if (gasto.formato !== 'efectivo' && gasto.formato !== 'transferencia') return;
        const periodo = periodoDesdeFechaMovimiento(gasto.fecha);
        if (periodo) periodos.push(periodo);
    });

    listaCuotasPrestamoGlobal.forEach((cuota) => {
        const periodo = periodoDesdeFechaMovimiento(cuota.fecha);
        if (periodo) periodos.push(periodo);
    });

    listaTraspasosGlobal.forEach((traspaso) => {
        if (!traspasoPerteneceAUsuario(traspaso, userActivo)) return;
        const periodo = periodoDesdeFechaMovimiento(traspaso.fecha);
        if (periodo) periodos.push(periodo);
    });

    listaPagosTarjetasGlobal.forEach((pago) => {
        const periodo = periodoDesdeFechaMovimiento(pago.fecha);
        if (periodo) periodos.push(periodo);
    });

    listaAjustesCuentaGlobal.forEach((ajuste) => {
        if (normalizarUsuarioId(ajuste.owner) !== normalizarUsuarioId(userActivo)) return;
        const periodo = periodoDesdeFechaMovimiento(ajuste.fecha);
        if (periodo) periodos.push(periodo);
    });

    return periodos.sort()[periodos.length - 1] || mesActualStr;
}

function aplicarTraspasoADisponibilidades(disponibilidades, traspaso) {
    const monto = Number(traspaso.monto || 0);
    if (!monto) return;

    if (traspaso.origen === 'efectivo') disponibilidades.efectivo -= monto;
    else if (traspaso.origen === 'galicia') disponibilidades.galicia -= monto;
    else if (traspaso.origen === 'mp') disponibilidades.mp -= monto;

    if (traspaso.destino === 'efectivo') disponibilidades.efectivo += monto;
    else if (traspaso.destino === 'galicia') disponibilidades.galicia += monto;
    else if (traspaso.destino === 'mp') disponibilidades.mp += monto;

    disponibilidades.total = disponibilidades.efectivo + disponibilidades.galicia + disponibilidades.mp;
}

function fechaMovimientoMs(fecha) {
    if (!fecha) return null;
    const fechaObj = fecha.toDate ? fecha.toDate() : new Date(fecha);
    const ms = fechaObj.getTime();
    return Number.isFinite(ms) ? ms : null;
}

function fueCreadoDespuesDelSaldoBase(movimiento, saldosGuardados) {
    if (!saldosGuardados?.esGlobal) return true;
    const baseMs = fechaMovimientoMs(saldosGuardados.actualizadoEn);
    const creadoMs = fechaMovimientoMs(movimiento.createdAt);
    if (!baseMs || !creadoMs) return false;
    return creadoMs >= baseMs;
}

function aplicarImpactoCuenta(disponibilidades, cuenta, impacto) {
    if (cuenta === 'efectivo') disponibilidades.efectivo += impacto;
    else if (cuenta === 'mp') disponibilidades.mp += impacto;
    else disponibilidades.galicia += impacto;

    disponibilidades.total = disponibilidades.efectivo + disponibilidades.galicia + disponibilidades.mp;
}

function cuentaDesdeGastoTransferencia(gasto) {
    const cuenta = listaCuentasGlobal.find(c => c.id === gasto.medioId);
    return cuenta && cuenta.banco.toLowerCase().includes('mercado') ? 'mp' : 'galicia';
}

function obtenerImpactoAjuste(ajuste) {
    const monto = Number(ajuste.monto || 0);
    if (ajuste.tipo === 'compra_usd') return -Math.abs(monto);
    if (ajuste.tipo === 'rendimiento_mp') return Math.abs(monto);
    return monto;
}

function aplicarAjusteADisponibilidades(disponibilidades, ajuste) {
    if (ajuste.tipo === 'extraccion_galicia') {
        const monto = Math.abs(Number(ajuste.monto || 0));
        aplicarImpactoCuenta(disponibilidades, 'galicia', -monto);
        aplicarImpactoCuenta(disponibilidades, 'efectivo', monto);
        return;
    }

    aplicarImpactoCuenta(disponibilidades, ajuste.cuenta, obtenerImpactoAjuste(ajuste));
}

function movimientoEsPrevioALaBase(movimiento, periodoBase) {
    const periodoMovimiento = periodoDesdeFechaMovimiento(movimiento.fecha);
    return periodoMovimiento && compararPeriodos(periodoMovimiento, periodoBase) < 0;
}

function aplicarMovimientosPropiosPreviosALaBase(liquidez, userActivo, periodoBase, saldosGuardados) {
    if (!liquidez || !periodoBase) return;
    const userNormalizado = normalizarUsuarioId(userActivo);

    listaGastosCompletaBase.forEach((gasto) => {
        if (!movimientoEsPrevioALaBase(gasto, periodoBase)) return;
        if (!gasto.createdAt) return;
        if (!fueCreadoDespuesDelSaldoBase(gasto, saldosGuardados)) return;

        const pagadorFinanciero = obtenerPagadorFinanciero(gasto, listaTarjetasGlobal);
        if (pagadorFinanciero !== userNormalizado) return;
        if (gasto.formato === 'efectivo') aplicarImpactoCuenta(liquidez.disponibilidades, 'efectivo', -Number(gasto.monto || 0));
        else if (gasto.formato === 'transferencia') aplicarImpactoCuenta(liquidez.disponibilidades, cuentaDesdeGastoTransferencia(gasto), -Number(gasto.monto || 0));
    });

    listaCuotasPrestamoGlobal.forEach((cuota) => {
        if (cuota.owner && normalizarUsuarioId(cuota.owner) !== userNormalizado) return;
        if (!movimientoEsPrevioALaBase(cuota, periodoBase)) return;
        if (!cuota.createdAt) return;
        if (!fueCreadoDespuesDelSaldoBase(cuota, saldosGuardados)) return;

        aplicarImpactoCuenta(liquidez.disponibilidades, cuota.cuentaDestino, Number(cuota.monto || 0));
    });

    listaTraspasosGlobal.forEach((traspaso) => {
        if (!traspasoPerteneceAUsuario(traspaso, userActivo)) return;
        if (!movimientoEsPrevioALaBase(traspaso, periodoBase)) return;
        if (!fueCreadoDespuesDelSaldoBase(traspaso, saldosGuardados)) return;

        aplicarTraspasoADisponibilidades(liquidez.disponibilidades, traspaso);
    });

    listaPagosTarjetasGlobal.forEach((pago) => {
        if (pago.owner && normalizarUsuarioId(pago.owner) !== userNormalizado) return;
        if (!movimientoEsPrevioALaBase(pago, periodoBase)) return;
        if (!pago.createdAt) return;
        if (!fueCreadoDespuesDelSaldoBase(pago, saldosGuardados)) return;

        aplicarImpactoCuenta(liquidez.disponibilidades, pago.cuentaLiquidadora, -Number(pago.monto || 0));
    });

    listaAjustesCuentaGlobal.forEach((ajuste) => {
        if (normalizarUsuarioId(ajuste.owner) !== userNormalizado) return;
        if (!movimientoEsPrevioALaBase(ajuste, periodoBase)) return;
        if (!fueCreadoDespuesDelSaldoBase(ajuste, saldosGuardados)) return;

        aplicarAjusteADisponibilidades(liquidez.disponibilidades, ajuste);
    });
}

function calcularLiquidezEncadenada(userActivo, periodoDestino) {
    const saldosGuardados = obtenerSaldosGlobalesUsuario(userActivo) || obtenerUltimosSaldosMensualesLegacy();
    const periodoBase = saldosGuardados?.periodoBase || periodoDestino;
    let saldos = saldosGuardados
        ? {
            efectivo: saldosGuardados.efectivo,
            galicia: saldosGuardados.galicia,
            mp: saldosGuardados.mp
        }
        : {
            efectivo: obtenerNumeroLimpio('saldo-base-efectivo'),
            galicia: obtenerNumeroLimpio('saldo-base-galicia'),
            mp: obtenerNumeroLimpio('saldo-base-mp')
        };
    let liquidez = null;

    const periodosCaja = compararPeriodos(periodoBase, periodoDestino) <= 0
        ? mesesEntre(periodoBase, periodoDestino)
        : [periodoDestino];

    periodosCaja.forEach((periodoCaja) => {
        liquidez = calcularLiquidezPersonal({
            gastos: listaGastosCompletaBase,
            tarjetas: listaTarjetasGlobal,
            cuentas: listaCuentasGlobal,
            cuotasPrestamo: listaCuotasPrestamoGlobal,
            traspasos: listaTraspasosGlobal,
            pagosTarjeta: listaPagosTarjetasGlobal,
            ajustesCuenta: listaAjustesCuentaGlobal,
            periodoActual: periodoDestino,
            periodoCaja,
            userActivo,
            saldosBase: saldos
        });
        saldos = { ...liquidez.disponibilidades };
    });

    return {
        liquidez,
        periodoBase,
        periodoDestino,
        saldoMesAnterior: periodoDestino === periodoBase ? saldos : null
    };
}

function obtenerLiquidezGlobal(userActivo) {
    const saldosGuardados = obtenerSaldosGlobalesUsuario(userActivo) || obtenerUltimosSaldosMensualesLegacy();
    const periodoBase = saldosGuardados?.periodoBase || mesActualStr;
    const periodoSaldoGlobal = obtenerPeriodoSaldoGlobal(userActivo, periodoBase);
    const resultado = calcularLiquidezEncadenada(userActivo, periodoSaldoGlobal);
    aplicarMovimientosPropiosPreviosALaBase(resultado.liquidez, userActivo, resultado.periodoBase, saldosGuardados);
    return resultado;
}

function obtenerLiquidezActual(userActivo, periodoActual) {
    return calcularLiquidezEncadenada(userActivo, periodoActual).liquidez;
}

function actualizarProyeccion() {
    if (!auth.currentUser) return;
    const periodoActual = filtroMesInput.value;
    const periodoProyectado = mesSiguiente(periodoActual);
    const userActivo = obtenerNombreUsuario(auth.currentUser.email);
    const liquidezActual = obtenerLiquidezGlobal(userActivo).liquidez;
    const liquidezProyectada = obtenerLiquidezActual(userActivo, periodoProyectado);
    const ingresoEsperado = obtenerNumeroLimpio('proy-ingreso');
    const otrosFijos = obtenerNumeroLimpio('proy-fijos');

    const balanceProyectado = calcularBalanceNeteado({
        gastos: listaGastosCompletaBase.filter(gasto => {
            const fechaObj = gasto.fecha ? gasto.fecha.toDate ? gasto.fecha.toDate() : new Date(gasto.fecha) : new Date();
            return (gasto.periodo || fechaObj.toISOString().slice(0, 7)) === periodoProyectado;
        }),
        tarjetas: listaTarjetasGlobal,
        sueldoDamian: obtenerNumeroLimpio('sueldo-damian'),
        sueldoMaxi: obtenerNumeroLimpio('sueldo-maxi')
    });
    const deudaAFavor = balanceProyectado.estadoDeuda && balanceProyectado.estadoDeuda.acreedor === userActivo ? balanceProyectado.estadoDeuda.monto : 0;
    const deudaAPagar = balanceProyectado.estadoDeuda && balanceProyectado.estadoDeuda.deudor === userActivo ? balanceProyectado.estadoDeuda.monto : 0;
    const saldoFinal = liquidezActual.disponibilidades.total + ingresoEsperado + deudaAFavor - deudaAPagar - liquidezProyectada.tarjetas.total - otrosFijos;

    const elTotal = document.getElementById('proy-total');
    const elDetalle = document.getElementById('proy-detalle');
    if (!elTotal || !elDetalle) return;
    elTotal.textContent = "$" + new Intl.NumberFormat('es-AR').format(Math.round(saldoFinal));
    aplicarColorMonto(elTotal, saldoFinal);
    elDetalle.textContent = `Mes proyectado ${periodoProyectado}: saldo actual $${new Intl.NumberFormat('es-AR').format(Math.round(liquidezActual.disponibilidades.total))} + ingresos $${new Intl.NumberFormat('es-AR').format(ingresoEsperado)} + a cobrar $${new Intl.NumberFormat('es-AR').format(deudaAFavor)} - a pagar $${new Intl.NumberFormat('es-AR').format(deudaAPagar)} - tarjetas $${new Intl.NumberFormat('es-AR').format(Math.round(liquidezProyectada.tarjetas.total))} - fijos $${new Intl.NumberFormat('es-AR').format(otrosFijos)}.`;
}

function actualizarCierreMensual(balance) {
    const contenedor = document.getElementById('resumen-cierre-mensual');
    if (!contenedor) return;
    const periodo = filtroMesInput.value;
    const estado = balance.estadoDeuda
        ? `${usuarioNombre(balance.estadoDeuda.deudor)} le debe $${new Intl.NumberFormat('es-AR').format(balance.estadoDeuda.monto)} a ${usuarioNombre(balance.estadoDeuda.acreedor)}`
        : 'Las cuentas están al día';
    contenedor.innerHTML = `
        <div class="detalle-balance-grupo">
            <h3><span>Período ${escapeHTML(periodo)}</span><span>${escapeHTML(estado)}</span></h3>
            <p><span>Pagado por Damián</span><span>$${new Intl.NumberFormat('es-AR').format(Math.round(balance.totalPagadoDamian))}</span></p>
            <p><span>Pagado por Maxi</span><span>$${new Intl.NumberFormat('es-AR').format(Math.round(balance.totalPagadoMaxi))}</span></p>
            <p><span>Resultado neto</span><span>${formatearEfectoBalance(balance.balanceNetoDamian)}</span></p>
        </div>
    `;
}

window.copiarCierreMensual = async function() {
    const texto = document.getElementById('resumen-cierre-mensual')?.innerText || '';
    if (!texto) return;
    try {
        await navigator.clipboard.writeText(texto);
        alert('Resumen de cierre copiado.');
    } catch (error) {
        alert(texto);
    }
};

let chartCatInstance = null; let chartAportesInstance = null; let chartPrivadoInstance = null;
function actualizarGraficosDashboard() {
    let totalComun = 0; const porCat = {}; let pagaDami = 0; let pagaMaxi = 0;
    const porCatPrivado = {}; const usuarioLogueadoActual = obtenerNombreUsuario(auth.currentUser ? auth.currentUser.email : "");

    listaGastosGlobal.forEach(g => {
        if(g.tipoReparto === 'comun' || g.tipoReparto === 'proporcional'){
            totalComun += g.monto; porCat[g.categoria || "Varios"] = (porCat[g.categoria || "Varios"] || 0) + g.monto;
            if (normalizarUsuarioId(g.pagadoPor) === USUARIOS.DAMIAN) pagaDami += g.monto; if (normalizarUsuarioId(g.pagadoPor) === USUARIOS.MAXI) pagaMaxi += g.monto;
        } else if (g.tipoReparto === 'privado' && normalizarUsuarioId(g.pagadoPor) === usuarioLogueadoActual) {
            porCatPrivado[g.categoria || "Varios"] = (porCatPrivado[g.categoria || "Varios"] || 0) + g.monto;
        }
    });

    document.getElementById('metric-total-mes').textContent = "$" + new Intl.NumberFormat('es-AR').format(totalComun);
    document.getElementById('metric-promedio').textContent = "$" + new Intl.NumberFormat('es-AR').format(Math.round(totalComun / (Object.keys(porCat).length || 1)));

    if (chartCatInstance) chartCatInstance.destroy();
    chartCatInstance = new Chart(document.getElementById('chart-categorias').getContext('2d'), { type: 'doughnut', data: { labels: Object.keys(porCat), datasets: [{ data: Object.values(porCat), backgroundColor: ['#0071e3', '#34c759', '#ff9500', '#ff2d55', '#5856d6', '#af52de', '#5ac8fa', '#e57373', '#ffc107', '#4dd0e1'] }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } } });

    if (chartAportesInstance) chartAportesInstance.destroy();
    chartAportesInstance = new Chart(document.getElementById('chart-aportes').getContext('2d'), { type: 'bar', data: { labels: ['Damián', 'Maxi'], datasets: [{ label: 'Gasto Común ($)', data: [pagaDami, pagaMaxi], backgroundColor: ['#0071e3', '#34c759'], borderRadius: 8 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } } });

    if (chartPrivadoInstance) chartPrivadoInstance.destroy();
    chartPrivadoInstance = new Chart(document.getElementById('chart-categorias-privado').getContext('2d'), { type: 'doughnut', data: { labels: Object.keys(porCatPrivado), datasets: [{ data: Object.values(porCatPrivado), backgroundColor: ['#0071e3', '#34c759', '#ff9500', '#ff2d55', '#5856d6', '#af52de', '#5ac8fa', '#e57373', '#ffc107', '#4dd0e1'] }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } } });
}

// CÁLCULO FÍSICO DE CAJA BASADO EN LA FECHA REAL DE LA OPERACIÓN
window.calcularDineroPersonalPrivado = function() {
    if (!auth.currentUser) return;
    const userActivo = obtenerNombreUsuario(auth.currentUser.email);
    const resultadoEncadenado = obtenerLiquidezGlobal(userActivo);
    const liquidez = resultadoEncadenado.liquidez;
    if (!liquidez) return;

    actualizarMontoEnElementos(['disp-efectivo', 'global-disp-efectivo'], liquidez.disponibilidades.efectivo);
    actualizarMontoEnElementos(['disp-galicia', 'global-disp-galicia'], liquidez.disponibilidades.galicia);
    actualizarMontoEnElementos(['disp-mp', 'global-disp-mp'], liquidez.disponibilidades.mp);
    actualizarMontoEnElementos(['disp-total-liquidez', 'global-disp-total-liquidez'], liquidez.disponibilidades.total);

    document.getElementById('credito-propio').textContent = "$" + new Intl.NumberFormat('es-AR').format(liquidez.tarjetas.propia);
    document.getElementById('credito-extension').textContent = "$" + new Intl.NumberFormat('es-AR').format(liquidez.tarjetas.extension);
    document.getElementById('credito-total-tarjetas').textContent = "$" + new Intl.NumberFormat('es-AR').format(liquidez.tarjetas.total);
    const detalleArrastre = document.getElementById('detalle-arrastre-saldo');
    if (detalleArrastre) {
        const origenGlobal = obtenerSaldosGlobalesUsuario(userActivo) ? 'global' : 'mensual anterior';
        detalleArrastre.textContent = `Saldo ${origenGlobal} único; no cambia por el período en pantalla. Calculado desde ${resultadoEncadenado.periodoBase} hasta ${resultadoEncadenado.periodoDestino}.`;
    }
    actualizarProyeccion();
};

function actualizarMontoEnElementos(ids, monto) {
    ids.forEach((id) => {
        const elemento = document.getElementById(id);
        if (!elemento) return;
        elemento.textContent = "$" + new Intl.NumberFormat('es-AR').format(monto);
        aplicarColorMonto(elemento, monto);
    });
}

inicializarInputsMonto();
