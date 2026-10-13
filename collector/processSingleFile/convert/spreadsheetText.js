// Repeat the sheet headers on every row so chunk boundaries cannot separate
// a phone number from its type. Blank/merged cells are never filled by guess.
const valueText = (value) => value === null || value === undefined ? "" : String(value).trim();
function columnName(index) {
  let name = "";
  for (let n = index + 1; n; n = Math.floor((n-1)/26))
    name = String.fromCharCode(65+(n-1)%26)+name;
  return name;
}
function spreadsheetText(sheet = {}) {
  const rows = (Array.isArray(sheet.data) ? sheet.data : [])
    .map((row,index)=>({index:index+1,cells:Array.isArray(row) ? row.map(valueText) : []}))
    .filter(row=>row.cells.some(Boolean));
  if (!rows.length) return "";
  const knownHeader = /^(성명|이름|부서|진료과|항목|단축(?:번호)?|내선(?:번호)?|직통(?:번호)?|전화번호|연락처)$/u;
  const headerCount = row => row.cells.filter(cell=>knownHeader.test(cell.replace(/\s/gu,""))).length;
  const clearHeader = rows.findIndex(row=>headerCount(row) >= 2);
  const knownIndex = clearHeader >= 0 ? clearHeader : rows.findIndex(row=>row.cells.length>=2 && headerCount(row)>0);
  const headerIndex = knownIndex >= 0 ? knownIndex : rows.findIndex(row=>row.cells.filter(Boolean).length >= 2);
  if (headerIndex < 0) return rows.map(row=>`행 ${row.index}: ${row.cells.join(" | ")}`).join("\n");
  const headers = rows[headerIndex].cells;
  let blockSize = headers.length;
  // Repeated horizontal tables (name/short/extension, name/short/extension).
  for (let size=2; size <= headers.length/2; size++) {
    if (headers.length%size===0 && headers.every((h,i)=>h===headers[i%size]) && headers.some(Boolean)) {
      blockSize=size; break;
    }
  }
  const content = rows.slice(0,headerIndex).map(row=>row.cells.filter(Boolean).join(" | "));
  content.push(`열 이름: ${headers.map((h,i)=>h||`열 ${columnName(i)}`).join(" | ")}`);
  for (const row of rows.slice(headerIndex+1)) {
    const width = Math.max(headers.length,row.cells.length);
    for(let start=0;start<width;start+=blockSize) {
      const end=Math.min(start+blockSize,width);
      if (!row.cells.slice(start,end).some(Boolean)) continue;
      const fields=[];
      for(let i=start;i<end;i++) fields.push(`${headers[i]||`열 ${columnName(i)}`}: ${row.cells[i]||"[빈 칸]"}`);
      content.push(`행 ${row.index}${blockSize<headers.length ? ` (묶음 ${start/blockSize+1})` : ""}: ${fields.join(" | ")}`);
    }
  }
  return content.join("\n");
}
module.exports = { spreadsheetText };
