// src/services/excel.service.js
const ExcelJS = require('exceljs');
const safeNum = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
const safeName = (s) =>
  (s || 'Empleado').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || 'Empleado';

// Convierte horas decimales -> valor de tiempo Excel (días)
const toExcelTime = (hours) => safeNum(hours) / 24;

// Formatea horas decimales a "HH:MM" (para mostrar negativos como texto)
const decToHHMM = (h) => {
  const n = Number(h) || 0;
  const sign = n < 0 ? '-' : '';
  let abs = Math.abs(n);
  const hours = Math.floor(abs);
  let minutes = Math.round((abs - hours) * 60);
  if (minutes === 60) { minutes = 0; abs = hours + 1; }
  return `${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

// Helpers para semanas (lunes–domingo) sin dayjs
const ymd = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
const mondayOf = (dateStr) => {
  const d = new Date(dateStr + 'T00:00:00');
  const dow = d.getDay(); // 0=Dom,1=Lun,...6=Sab
  const diffToMonday = (dow + 6) % 7; // Dom(0)->6, Lun(1)->0, ...
  d.setDate(d.getDate() - diffToMonday);
  return ymd(d);
};
const addDays = (dateStr, n) => {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return ymd(d);
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

    // Base diaria requerida (fallback 8h) SOLO PARA mostrar “a deber” diario
    const baseHoursPerDay = Number.isFinite(Number(calc?.baseHoursPerDay))
      ? Number(calc.baseHoursPerDay)
      : 8;

    // ---- Relleno diario (grilla) + acumular EXTRAS (decimales) ----
    let col = 3; // C
    let totalOvertimeDec = 0;
    const daysArr = [];

    for (const d of (calc?.days || [])) {
      const dateStr = d?.date;
      const worked = safeNum(d?.worked);
      const overtime = safeNum(d?.overtime);

      // Fecha en fila 5
      const cDate = ws.getRow(5).getCell(col);
      cDate.value = dateStr ? new Date(dateStr + 'T00:00:00') : null;
      if (cDate.value) cDate.numFmt = 'dd/mm/yyyy';
      cDate.alignment = { horizontal: 'center' };

      // Horas trabajadas en fila 6
      const cWorked = ws.getRow(6).getCell(col);
      if (worked === 0) {
        cWorked.value = 'DESCANSO';
        cWorked.alignment = { horizontal: 'center' };
      } else {
        cWorked.value = toExcelTime(worked);
        cWorked.numFmt = '[h]:mm';
        cWorked.alignment = { horizontal: 'center' };
      }

      // Horas extras en fila 7
      const cOT = ws.getRow(7).getCell(col);
      if (worked === 0) {
        cOT.value = 'DESCANSO';
        cOT.alignment = { horizontal: 'center' };
      } else {
        cOT.value = toExcelTime(overtime);
        cOT.numFmt = '[h]:mm';
        cOT.alignment = { horizontal: 'center' };
        totalOvertimeDec += overtime; // acumula extras solo en días trabajados
      }

      // Horas a Deber en fila 8 (informativo diario)
      const cOwed = ws.getRow(8).getCell(col);
      if (worked === 0) {
        cOwed.value = 'DESCANSO';
        cOwed.alignment = { horizontal: 'center' };
      } else {
        const owed = worked < baseHoursPerDay ? (baseHoursPerDay - worked) : 0;
        cOwed.value = toExcelTime(owed);
        cOwed.numFmt = '[h]:mm';
        cOwed.alignment = { horizontal: 'center' };
      }

      daysArr.push({ date: dateStr, worked, overtime });
      col++;
    }

    // ---- Regla semanal 48h: agrupar lunes–domingo y calcular deuda ----
    const weeksMap = new Map();
    for (const d of daysArr) {
      const wk = mondayOf(d.date);
      if (!weeksMap.has(wk)) weeksMap.set(wk, []);
      weeksMap.get(wk).push(d);
    }

    const WEEK_TARGET = 48; // horas
    const weekly = [];
    let totalOwedWeeklyDec = 0;

    for (const [weekStart, arr] of weeksMap.entries()) {
      arr.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      const workedSum = arr.reduce((acc, x) => acc + safeNum(x.worked), 0);
      const overtimeSum = arr.reduce((acc, x) => acc + safeNum(x.overtime), 0);
      const owedWeek = Math.max(0, WEEK_TARGET - workedSum);

      weekly.push({
        weekStart,
        weekEnd: addDays(weekStart, 6),
        workedDec: workedSum,
        overtimeDec: overtimeSum,
        owedDec: owedWeek,
      });

      totalOwedWeeklyDec += owedWeek;
    }

    // ---- Total Neto (Extras - Deber semanal 48h) en C3 ----
    const netDec = totalOvertimeDec - totalOwedWeeklyDec;
    const cTotal = ws.getCell('C3');
    if (netDec >= 0) {
      cTotal.value = toExcelTime(netDec);
      cTotal.numFmt = '[h]:mm';
      cTotal.alignment = { horizontal: 'center' };
    } else {
      cTotal.value = decToHHMM(netDec); // texto para negativos
      cTotal.alignment = { horizontal: 'center' };
    }

    // ---- Resumen semanal (tabla debajo) ----
    let row = 10; // inicio del bloque
    ws.getCell(`B${row}`).value = 'Resumen semanal (meta 48 h)';
    ws.getCell(`B${row}`).font = { bold: true };
    row++;

    // encabezados
    ws.getCell(`B${row}`).value = 'Semana';
    ws.getCell(`C${row}`).value = 'Trabajadas';
    ws.getCell(`D${row}`).value = 'Horas extra';
    ws.getCell(`E${row}`).value = 'Horas a deber (48h)';
    ws.getCell(`F${row}`).value = 'Neto (Extra - Deber)';
    ['B','C','D','E','F'].forEach(colL => {
      const cell = ws.getCell(`${colL}${row}`);
      cell.font = { bold: true };
      cell.alignment = { horizontal: 'center' };
      ws.getColumn(colL).width = Math.max(ws.getColumn(colL).width || 12, 16);
    });
    row++;

    // filas semanales
    let sumWorked = 0, sumOT = 0, sumOwed = 0, sumNet = 0;
    weekly
      .sort((a, b) => (a.weekStart < b.weekStart ? -1 : a.weekStart > b.weekStart ? 1 : 0))
      .forEach(w => {
        const label = `${w.weekStart} – ${w.weekEnd}`;
        ws.getCell(`B${row}`).value = label;

        const cWorked = ws.getCell(`C${row}`);
        cWorked.value = toExcelTime(w.workedDec);
        cWorked.numFmt = '[h]:mm';
        cWorked.alignment = { horizontal: 'center' };

        const cOT = ws.getCell(`D${row}`);
        cOT.value = toExcelTime(w.overtimeDec);
        cOT.numFmt = '[h]:mm';
        cOT.alignment = { horizontal: 'center' };

        const cOwed = ws.getCell(`E${row}`);
        cOwed.value = toExcelTime(w.owedDec);
        cOwed.numFmt = '[h]:mm';
        cOwed.alignment = { horizontal: 'center' };

        const netW = w.overtimeDec - w.owedDec;
        const cNet = ws.getCell(`F${row}`);
        if (netW >= 0) {
          cNet.value = toExcelTime(netW);
          cNet.numFmt = '[h]:mm';
        } else {
          cNet.value = decToHHMM(netW); // texto para negativos
        }
        cNet.alignment = { horizontal: 'center' };

        sumWorked += w.workedDec;
        sumOT += w.overtimeDec;
        sumOwed += w.owedDec;
        sumNet += netW;

        row++;
      });

    // fila de totales semanales
    ws.getCell(`B${row}`).value = 'Totales';
    ws.getCell(`B${row}`).font = { bold: true };

    const cWorkTot = ws.getCell(`C${row}`);
    cWorkTot.value = toExcelTime(sumWorked);
    cWorkTot.numFmt = '[h]:mm';
    cWorkTot.alignment = { horizontal: 'center' };
    cWorkTot.font = { bold: true };

    const cOTTot = ws.getCell(`D${row}`);
    cOTTot.value = toExcelTime(sumOT);
    cOTTot.numFmt = '[h]:mm';
    cOTTot.alignment = { horizontal: 'center' };
    cOTTot.font = { bold: true };

    const cOwedTot = ws.getCell(`E${row}`);
    cOwedTot.value = toExcelTime(sumOwed);
    cOwedTot.numFmt = '[h]:mm';
    cOwedTot.alignment = { horizontal: 'center' };
    cOwedTot.font = { bold: true };

    const cNetTot = ws.getCell(`F${row}`);
    if (sumNet >= 0) {
      cNetTot.value = toExcelTime(sumNet);
      cNetTot.numFmt = '[h]:mm';
    } else {
      cNetTot.value = decToHHMM(sumNet);
    }
    cNetTot.alignment = { horizontal: 'center' };
    cNetTot.font = { bold: true };
  }

  return wb;
}

module.exports = { buildWorkbook };
