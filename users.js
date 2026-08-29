export const USUARIOS = {
    DAMIAN: 'damian',
    MAXI: 'maxi'
};

export function normalizarUsuarioId(valor) {
    const texto = String(valor ?? '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

    if (texto.includes('dami')) return USUARIOS.DAMIAN;
    if (texto.includes('maxi')) return USUARIOS.MAXI;
    return '';
}

export function usuarioEsDamian(valor) {
    return normalizarUsuarioId(valor) === USUARIOS.DAMIAN;
}

export function usuarioNombre(valor) {
    const usuarioId = normalizarUsuarioId(valor);
    if (usuarioId === USUARIOS.DAMIAN) return 'Damián';
    if (usuarioId === USUARIOS.MAXI) return 'Maxi';
    return 'Usuario';
}

export function usuarioCorto(valor) {
    const usuarioId = normalizarUsuarioId(valor);
    if (usuarioId === USUARIOS.DAMIAN) return 'Dami';
    if (usuarioId === USUARIOS.MAXI) return 'Maxi';
    return 'Usuario';
}
