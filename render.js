export function escapeHTML(valor) {
    return String(valor ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));
}

export function escapeAttr(valor) {
    return escapeHTML(valor).replace(/`/g, '&#96;');
}

export function normalizarTextoComparacion(valor) {
    return String(valor ?? '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

export function fechaLocalKey(fecha) {
    if (!fecha) return '';
    const fechaObj = fecha.toDate ? fecha.toDate() : new Date(fecha);
    if (isNaN(fechaObj.getTime())) return '';
    const anio = fechaObj.getFullYear();
    const mes = String(fechaObj.getMonth() + 1).padStart(2, '0');
    const dia = String(fechaObj.getDate()).padStart(2, '0');
    return `${anio}-${mes}-${dia}`;
}

export function formatearFechaCSV(fecha) {
    const key = fechaLocalKey(fecha);
    if (!key) return '';
    const [anio, mes, dia] = key.split('-');
    return `${dia}/${mes}/${anio}`;
}

export function valorCSV(valor) {
    const texto = String(valor ?? '');
    return `"${texto.replace(/"/g, '""')}"`;
}

export function aplicarColorMonto(elemento, monto, ceroComoNeutro = true) {
    elemento.classList.remove('texto-positivo', 'texto-negativo', 'texto-alerta');
    if (monto > 0) elemento.classList.add('texto-positivo');
    else if (monto < 0) elemento.classList.add('texto-negativo');
    else if (!ceroComoNeutro) elemento.classList.add('texto-alerta');
}
