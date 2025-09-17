// src/services/excel.service.js
const ExcelJS = require('exceljs');
const safeNum = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
const safeName = (s) =>
  (s || 'Empleado').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || 'Empleado';

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
    ws.getCell('C3').value = safeNum(calc?.totalOvertime);
    ws.getCell('C3').numFmt = '0.00';

    // Encabezados por día
    ws.getCell('B5').value = ''; // (columna de etiquetas)
    ws.getCell('B6').value = 'Horas Trabajadas';
    ws.getCell('B6').font = { bold: true };
    ws.getCell('B7').value = 'Horas Extras';
    ws.getCell('B7').font = { bold: true };

    let col = 3; // C
    for (const d of calc?.days || []) {
      // Fecha en fila 5
      const cDate = ws.getRow(5).getCell(col);
      cDate.value = d?.date ? new Date(d.date + 'T00:00:00') : null;
      if (cDate.value) cDate.numFmt = 'dd/mm/yyyy';

      // Horas trabajadas en fila 6
      const cWorked = ws.getRow(6).getCell(col);
      const worked = safeNum(d?.worked);
      cWorked.value = worked;
      cWorked.numFmt = '0.00';

      // Horas extras en fila 7
      const cOT = ws.getRow(7).getCell(col);
      const overtime = safeNum(d?.overtime);

      if (overtime > 0) {
        cOT.value = overtime;
        cOT.numFmt = '0.00';
      } else {
        cOT.value = 'DESCANSO';
        // opcional: centrado para que se vea prolijo
        cOT.alignment = { horizontal: 'center' };
      }

      col++;
    }
  }

  return wb;
}

module.exports = { buildWorkbook };
