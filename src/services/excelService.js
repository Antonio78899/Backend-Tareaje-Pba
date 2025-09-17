// src/services/excel.service.js
const ExcelJS = require('exceljs');
const safeNum = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
const safeName = (s) =>
  (s || 'Empleado').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || 'Empleado';

// Convierte horas decimales -> valor de tiempo Excel (días)
const toExcelTime = (hours) => safeNum(hours) / 24;

// Formatea horas decimales a "HH:MM" (para mostrar negativos como texto)
const decToHHMM = (h) => {
  const sign = h < 0 ? '-' : '';
  let abs = Math.abs(h);
  const hours = Math.floor(abs);
  let minutes = Math.round((abs - hours) * 60);
  if (minutes === 60) { // corrección por redondeo
    minutes = 0;
    abs = hours + 1;
  }
  return `${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

async function buildWorkbook(employeesCalcs) {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();

  for (const item of employeesCalcs || []) {
    const { employee, calc } = item || {};
    const ws = wb.addWorksheet(safeName(employee?.fullName), {
      // congelamos hasta la fila de fechas
      views: [{ state: 'frozen', xSplit: 2, ySplit: 5 }],
    });

    ws.properties.defaultColWidth = 15;
    ws.getColumn(2).width = 22;

    // Encabezados generales
    ws.getCell('B2').value = 'Nombre';
    ws.getCell('B2').font = { bold: true };
    ws.getCell('C2').value = employee?.fullName || '';

    // Etiqueta de total NETO
    ws.getCell('B3').value = 'Total Neto (Extras - Deber)';
    ws.getCell('B3').font = { bold: true };

    // Encabezados por día
    ws.getCell('B5').value = ''; // (columna de etiquetas para fechas)
    ws.getCell('B6').value = 'Horas Trabajadas';
    ws.getCell('B6').font = { bold: true };
    ws.getCell('B7').value = 'Horas Extras';
    ws.getCell('B7').font = { bold: true };
    ws.getCell('B8').value = 'Horas a Deber';
    ws.getCell('B8').font = { bold: true };

    // Base diaria requerida (fallback 8h)
    const baseHoursPerDay = Number.isFinite(Number(calc?.baseHoursPerDay))
      ? Number(calc.baseHoursPerDay)
      : 8;

    // Acumuladores para total neto
    let totalOvertimeDec = 0; // horas decimales
    let totalOwedDec = 0;     // horas decimales

    let col = 3; // C
    for (const d of (calc?.days || [])) {
      // Fecha en fila 5
      const cDate = ws.getRow(5).getCell(col);
      cDate.value = d?.date ? new Date(d.date + 'T00:00:00') : null;
      if (cDate.value) cDate.numFmt = 'dd/mm/yyyy';
      cDate.alignment = { horizontal: 'center' };

      const worked = safeNum(d?.worked);
      const overtime = safeNum(d?.overtime);

      // ---- Horas Trabajadas (fila 6) ----
      const cWorked = ws.getRow(6).getCell(col);
      if (worked === 0) {
        cWorked.value = 'DESCANSO';
        cWorked.alignment = { horizontal: 'center' };
      } else {
        cWorked.value = toExcelTime(worked);
        cWorked.numFmt = '[h]:mm';
        cWorked.alignment = { horizontal: 'center' };
      }

      // ---- Horas Extras (fila 7) ----
      const cOT = ws.getRow(7).getCell(col);
      if (worked === 0) {
        // Día sin trabajar: también DESCANSO en OT
        cOT.value = 'DESCANSO';
        cOT.alignment = { horizontal: 'center' };
      } else {
        cOT.value = toExcelTime(overtime);
        cOT.numFmt = '[h]:mm';
        cOT.alignment = { horizontal: 'center' };
        totalOvertimeDec += overtime; // acumula extras solo en días trabajados
      }

      // ---- Horas a Deber (fila 8) ----
      const cOwed = ws.getRow(8).getCell(col);
      if (worked === 0) {
        // Requisito: mostrar "DESCANSO" también aquí
        cOwed.value = 'DESCANSO';
        cOwed.alignment = { horizontal: 'center' };
      } else {
        let owed = 0;
        if (worked < baseHoursPerDay) {
          owed = baseHoursPerDay - worked; // horas decimales
          totalOwedDec += owed;
        }
        cOwed.value = toExcelTime(owed);
        cOwed.numFmt = '[h]:mm';
        cOwed.alignment = { horizontal: 'center' };
      }

      col++;
    }

    // ----- Total Neto (Extras - Deber) en C3 -----
    const net = totalOvertimeDec - totalOwedDec;
    const cTotal = ws.getCell('C3');
    if (net >= 0) {
      cTotal.value = toExcelTime(net);
      cTotal.numFmt = '[h]:mm';
      cTotal.alignment = { horizontal: 'center' };
    } else {
      // Excel no muestra tiempos negativos con [h]:mm → lo mostramos como texto "-HH:MM"
      cTotal.value = decToHHMM(net);
      cTotal.alignment = { horizontal: 'center' };
    }
  }

  return wb;
}

module.exports = { buildWorkbook };
