export function normalizarFechaImportada(valor) {
    const fallback = new Date();
    fallback.setHours(12, 0, 0, 0);

    let fecha = null;
    if (valor instanceof Date) {
        fecha = new Date(valor);
    } else if (typeof valor === 'number') {
        const excelDate = window.XLSX.SSF.parse_date_code(valor);
        if (excelDate) fecha = new Date(excelDate.y, excelDate.m - 1, excelDate.d, 12, 0, 0, 0);
    } else if (typeof valor === 'string') {
        const texto = valor.trim();
        const matchDMY = texto.match(/^(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?$/);
        const matchYMD = texto.match(/^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})$/);

        if (matchDMY) {
            const anioActual = new Date().getFullYear();
            let anio = matchDMY[3] ? Number(matchDMY[3]) : anioActual;
            if (anio < 100) anio += 2000;
            fecha = new Date(anio, Number(matchDMY[2]) - 1, Number(matchDMY[1]), 12, 0, 0, 0);
        } else if (matchYMD) {
            fecha = new Date(Number(matchYMD[1]), Number(matchYMD[2]) - 1, Number(matchYMD[3]), 12, 0, 0, 0);
        } else {
            const parseada = new Date(texto);
            if (!isNaN(parseada.getTime())) fecha = parseada;
        }
    }

    if (!fecha || isNaN(fecha.getTime())) fecha = fallback;
    fecha.setHours(12, 0, 0, 0);

    return {
        fechaObj: fecha,
        texto: fecha.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    };
}

export function procesarExcelOCSV(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const data = new Uint8Array(e.target.result);
            const workbook = window.XLSX.read(data, { type: 'array' });
            let colFecha = 1, colConcepto = 2, colMonto = 5; let datosInicio = 1;
            const jsonRows = window.XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 });

            for (let i = 0; i < Math.min(15, jsonRows.length); i++) {
                const fila = jsonRows[i]; if (!fila) continue;
                const textoFila = fila.map(c => String(c).toLowerCase()).join(' ');
                if (textoFila.includes('importe') || textoFila.includes('monto')) {
                    for (let j = 0; j < fila.length; j++) {
                        const celda = String(fila[j] || '').toLowerCase();
                        if (celda.includes('fecha')) colFecha = j;
                        if (celda.includes('establecimiento') || celda.includes('detalle') || celda.includes('concepto')) colConcepto = j;
                        if (celda.includes('importe') || celda.includes('monto')) colMonto = j;
                    }
                    datosInicio = i + 1; break;
                }
            }

            const consumos = [];
            for (let i = datosInicio; i < jsonRows.length; i++) {
                const fila = jsonRows[i]; if (!fila || fila.length === 0) continue;
                let concepto = String(fila[colConcepto] || fila[1] || fila[0] || 'Consumo').trim();
                let fechaGasto = fila[colFecha];
                const fechaNormalizada = normalizarFechaImportada(fechaGasto);

                let montoVal = fila[colMonto] !== undefined ? fila[colMonto] : fila[fila.length - 1];
                let montoNumerico = 0;

                if (typeof montoVal === 'number') { montoNumerico = montoVal; }
                else if (typeof montoVal === 'string') {
                    let texto = montoVal.trim();
                    let lastComma = texto.lastIndexOf(','); let lastDot = texto.lastIndexOf('.');
                    if (lastComma > lastDot) texto = texto.replace(/\./g, '').replace(',', '.'); else texto = texto.replace(/,/g, '');
                    montoNumerico = parseFloat(texto);
                }
                if (!isNaN(montoNumerico) && montoNumerico > 0) {
                    const montoLimpio = Math.round(montoNumerico);
                    if (concepto.toUpperCase().includes('SU PAGO') || concepto.toUpperCase().includes('PAGO DE TARJETA')) continue;
                    consumos.push({ fecha: fechaNormalizada.texto, fechaObj: fechaNormalizada.fechaObj, concepto: concepto, monto: montoLimpio });
                }
            }
            resolve(consumos);
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(file);
    });
}
