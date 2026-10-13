const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { defaultStorageRoot } = require("../../../originalDocuments");
const { readPdfPageLayouts } = require("../../../documentChecklists/pdfLayout");
const { contactQueryVariant } = require("../../../chats/expandedBodySearch");
const compact = (s) => String(s || "").replace(/\s/gu, "");
const LABELS = new Set(["단축", "내선", "직통"]);
const cache = new Map();
const center = (item) => item.x + item.w / 2;
const currentQuestion = (text) => String(text || "").split("<hospital_document_context>")[0].trim();

// Only exact personal-name cells aligned with a repeated table header qualify.
// No department/merged-cell inheritance, digit-length inference or row guessing.
function directoryEntries(layout, question, sourceText) {
  const target = contactQueryVariant(currentQuestion(question));
  if (!target) return [];
  const items = (layout?.items || []).filter(i =>
    typeof i.str === "string" && [i.x,i.y,i.w,i.h].every(Number.isFinite));
  const headers = items.filter(i => compact(i.str) === "성명");
  const entries = [];
  for (const name of items) {
    const person = compact(name.str);
    if (!/^[가-힣]{2,5}$/u.test(person) || person !== compact(target)) continue;
    const numberHeaders = items.filter(i => LABELS.has(compact(i.str)));
    const nameHeaders = headers.filter(h => h.y > name.y && Math.abs(center(h)-center(name)) <= 4)
      .sort((a,b) => a.y-b.y);
    const header = nameHeaders[0] || numberHeaders.filter(h => h.y > name.y &&
      h.x > name.x && h.x - (name.x+name.w) <= 40).sort((a,b)=>a.y-b.y)[0];
    if (!header) continue;
    const next = headers.filter(h => Math.abs(h.y-header.y) <= 1 && h.x > name.x+name.w)
      .sort((a,b) => a.x-b.x)[0];
    const fields = numberHeaders.filter(i =>
      Math.abs(i.y-header.y) <= 1 && i.x > name.x+name.w &&
      i.x-(name.x+name.w) <= 80 && (!next || i.x < next.x));
    if (!fields.length || new Set(fields.map(i=>compact(i.str))).size !== fields.length) continue;
    const cells = [];
    let ambiguous = false;
    for (const field of fields) {
      const candidates = items.filter(i => /^\d{3,6}$/u.test(compact(i.str)) &&
        Math.abs(i.y-name.y) <= 1 && Math.abs(center(i)-center(field)) <= 4);
      if (candidates.length > 1) { ambiguous = true; break; }
      if (candidates.length === 1) cells.push({cell:candidates[0], label:compact(field.str)});
    }
    if (ambiguous || !cells.length) continue;
    // Keep original content-stream order so the quote can be found on the PDF.
    const first = items.indexOf(name), last = Math.max(...cells.map(c=>items.indexOf(c.cell)));
    if (last <= first) continue;
    const region = items.slice(first,last+1);
    if (region.some(i => i !== name && !cells.some(c=>c.cell===i) && compact(i.str))) continue;
    const quote = region.map(i=>i.str).join(" ");
    const needle = compact(quote), original = compact(sourceText);
    const start = original.indexOf(needle);
    if (needle.length < 8 || start < 0 || original.indexOf(needle,start+1) >= 0) continue;
    entries.push({name:person, numbers:cells.map(c=>({label:c.label,value:compact(c.cell.str)})), quote});
  }
  return entries;
}

async function enrichDirectorySources(sources, question, {readLayouts=readPdfPageLayouts, storageRoot=defaultStorageRoot()} = {}) {
  if (!contactQueryVariant(currentQuestion(question))) return sources;
  return Promise.all(sources.map(async source => {
    const sheetSource = await require('./sheetDepartmentContacts').enrichSheetDepartmentSource(source,currentQuestion(question));
    if (sheetSource !== source) return sheetSource;
    if (!/전화번호부/u.test(source.document_name || source.documentName || source.title || "")) return source;
    const id = source.document_id || source.documentId;
    const page = Number(source.page);
    if (!id || !Number.isInteger(page) || page < 1) return source;
    try {
      const file = path.join(storageRoot,createHash("sha256").update(String(id)).digest("hex")+".pdf");
      const stat = fs.statSync(file);
      const key = `${file}:${stat.mtimeMs}:${stat.size}:${page}`;
      if (!cache.has(key)) {
        if (cache.size >= 8) cache.delete(cache.keys().next().value);
        cache.set(key, readLayouts(file,[page]).catch(() => new Map()));
      }
      const layout = (await cache.get(key)).get(page);
      const rows = directoryEntries(layout, question, source.text || source.excerpt);
      return rows.length ? {...source, directoryEntries:rows} : source;
    } catch { return source; }
  }));
}

function directoryAnswer(sources, question) {
  question = currentQuestion(question);
  const sheetAnswer=require('./sheetDepartmentContacts').sheetDepartmentAnswer(sources,question);
  if(sheetAnswer)return sheetAnswer;
  const target = compact(contactQueryVariant(question));
  if (!target || /휴대|핸드폰|팩스|비교|차이|말고|제외|아니|아닌|변경|맞|확인/u.test(question)) return null;
  const wanted = /단축/u.test(question) ? "단축" : /내선/u.test(question) ? "내선" : /직통/u.test(question) ? "직통" : null;
  const matches = sources.flatMap(source => (source.directoryEntries || [])
    .filter(row => row.name === target).map(row=>({source,row})));
  if (!matches.length) return null;
  const choices = matches.map(({row})=> row.numbers.filter(n=>!wanted || n.label===wanted));
  if (choices.some(c=>!c.length)) return null;
  const signatures = new Set(choices.map(c=>JSON.stringify(c)));
  if (signatures.size !== 1) return null;
  const {source,row} = matches[0];
  const numbers = choices[0];
  const original = compact(source.text || source.excerpt);
  const needle = compact(row.quote), start = original.indexOf(needle);
  if (needle.length < 8 || start < 0 || original.indexOf(needle,start+1) >= 0) return null;
  const text = wanted ? `${row.name}님의 ${wanted}번호는 ${numbers[0].value}입니다.` :
    `${row.name}님의 전화번호부 등록 번호입니다.\n` + numbers.map(n=>`- ${n.label}번호: ${n.value}`).join("\n");
  return {text,source,quote:row.quote};
}
module.exports = {directoryEntries,enrichDirectorySources,directoryAnswer,sheetDepartmentContacts:require('./sheetDepartmentContacts').sheetDepartmentContacts};
