// Revierte Generador_Codigo_Repuestos.xlsx a su estado original (antes de
// la expansion de Sistema/Sub-Sistema que no correspondia hacer aqui).
import ExcelJS from 'exceljs';

const PATH = 'C:/Users/Sistemas Pineda/Desktop/Generador_Codigo_Repuestos.xlsx';

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(PATH);
const wsListas = wb.getWorksheet('Listas');
const wsGen = wb.getWorksheet('Generador');

// desmerge todo lo que toque A/B entre filas 8-43
for (const merge of [...wsListas.model.merges]) {
  const [ini] = merge.split(':');
  const [, colLetra, filaStr] = ini.match(/^([A-Z]+)(\d+)$/);
  const filaNum = Number(filaStr);
  if ((colLetra === 'A' || colLetra === 'B') && filaNum >= 8 && filaNum <= 43) {
    wsListas.unMergeCells(merge);
  }
}
for (let r = 8; r <= 43; r++) {
  wsListas.getCell(r, 1).value = null;
  wsListas.getCell(r, 2).value = null;
}

wsListas.mergeCells('A9:B9');
wsListas.getCell('A9').value = '2. SISTEMA';
wsListas.getCell('A9').font = { bold: true };
const SISTEMA_ORIG = [
  ['Motor', 'M'], ['Chasis', 'C'], ['Electricidad', 'E'], ['Suspension', 'S'],
  ['Transmision', 'T'], ['Frenos', 'F'], ['Accesorios', 'A'], ['Direccion', 'D'],
];
SISTEMA_ORIG.forEach(([n, c], i) => {
  wsListas.getCell(10 + i, 1).value = n;
  wsListas.getCell(10 + i, 2).value = c;
});

wsListas.mergeCells('A20:B20');
wsListas.getCell('A20').value = '3. SUB-SISTEMA (revisa/corrige, la foto no se leia bien aqui)';
const SUB_ORIG = [
  ['Admision', 'AD'], ['Carroceria', 'CA'], ['Luces', 'LU'], ['Amortiguacion', 'AM'],
  ['Caja diferencial', 'CD'], ['ABS, EBD, etc.', 'AB'], ['Hidraulica', 'HI'],
  ['EPS', 'EP'], ['Lubricacion', 'LB'],
];
SUB_ORIG.forEach(([n, c], i) => {
  wsListas.getCell(21 + i, 1).value = n;
  wsListas.getCell(21 + i, 2).value = c;
});

wsGen.dataValidations.model['B6'] = {
  type: 'list', formulae: ['Listas!$A$10:$A$17'], allowBlank: true,
  showErrorMessage: true, errorTitle: 'Valor no válido', error: 'Elige un valor de la lista',
};
wsGen.getCell('D6').value = { formula: 'IFERROR(INDEX(Listas!$B$10:$B$17,MATCH(B6,Listas!$A$10:$A$17,0)),"")' };

wsGen.dataValidations.model['B7'] = {
  type: 'list', formulae: ['Listas!$A$21:$A$29'], allowBlank: true,
  showErrorMessage: true, errorTitle: 'Valor no válido', error: 'Elige un valor de la lista',
};
wsGen.getCell('D7').value = { formula: 'IFERROR(INDEX(Listas!$B$21:$B$29,MATCH(B7,Listas!$A$21:$A$29,0)),"")' };

await wb.xlsx.writeFile(PATH);
console.log('Revertido a estado original:', PATH);
