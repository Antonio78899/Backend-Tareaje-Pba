// src/services/excel.service.js
const ExcelJS = require('exceljs');
const safeNum = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
const safeName = (s) =>
  (s || 'Empleado').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || 'Empleado';

// Convierte horas decimales -> valor de tiempo Excel (días)
const toExcelTime = (hours) => safeNum(hours) / 24;

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

    ws.getCell('B3').value = 'Horas Extras (Total)';
    ws.getCell('B3').font = { bold: true };
    ws.getCell('C3').value = toExcelTime(calc?.totalOvertime);
    ws.getCell('C3').numFmt = '[h]:mm';
    ws.getCell('C3').alignment = { horizontal: 'center' };

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

    let col = 3; // C
    for (const d of (calc?.days || [])) {
      // Fecha en fila 5
      const cDate = ws.getRow(5).getCell(col);
      cDate.value = d?.date ? new Date(d.date + 'T00:00:00') : null;
      if (cDate.value) cDate.numFmt = 'dd/mm/yyyy';
      cDate.alignment = { horizontal: 'center' };

      // Horas trabajadas en fila 6 -> tiempo [h]:mm
      const cWorked = ws.getRow(6).getCell(col);
      const worked = safeNum(d?.worked);
      cWorked.value = toExcelTime(worked);
      cWorked.numFmt = '[h]:mm';
      cWorked.alignment = { horizontal: 'center' };

      // Horas extras en fila 7 -> tiempo [h]:mm o "DESCANSO"
      const cOT = ws.getRow(7).getCell(col);
      const overtime = safeNum(d?.overtime);

      if (worked === 0) {
        // Día del rango sin ninguna hora trabajada -> "DESCANSO"
        cOT.value = 'DESCANSO';
        cOT.alignment = { horizontal: 'center' };
      } else {
        // Día trabajado: mostrar OT en formato tiempo (0:00 si no hay)
        cOT.value = toExcelTime(overtime);
        cOT.numFmt = '[h]:mm';
        cOT.alignment = { horizontal: 'center' };
      }

      // Horas a Deber en fila 8 -> si trabajó menos que la base y trabajó algo
      const cOwed = ws.getRow(8).getCell(col);
      let owed = 0;
      if (worked > 0 && worked < baseHoursPerDay) {
        owed = baseHoursPerDay - worked; // horas decimales
      }
      cOwed.value = toExcelTime(owed);
      cOwed.numFmt = '[h]:mm';
      cOwed.alignment = { horizontal: 'center' };

      col++;
    }
  }

  return wb;
}

module.exports = { buildWorkbook };
