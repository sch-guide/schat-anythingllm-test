export function sheetEvidenceRows(quotes=[]) {
  const rows=new Set();
  for(const quote of quotes)if(typeof quote==="string")for(const match of quote.matchAll(/행\s+(\d+)(?:\s*\(묶음\s*\d+\))?\s*:/gu))rows.add(Number(match[1]));
  return [...rows].filter(row=>Number.isSafeInteger(row)&&row>0).sort((a,b)=>a-b);
}
export function sheetColumnName(index) {
 let name="";
 for(let n=index+1;n;n=Math.floor((n-1)/26))name=String.fromCharCode(65+(n-1)%26)+name;
 return name;
}
const compact=text=>String(text??"").replace(/\s/gu,"");
function segments(text) {
 const matches=[...String(text||"").matchAll(/행\s+(\d+)(?:\s*\(묶음\s*\d+\))?\s*:/gu)];
 return matches.map((match,i)=>({row:Number(match[1]),body:text.slice(match.index+match[0].length,matches[i+1]?.index).trim()}));
}
function rawFieldValues(body) {return String(body).trim().split(/\s*\|\s*/u).map(field=>field.slice(field.indexOf(":")+1).trim());}
function fieldValues(body) {return rawFieldValues(body).map(value=>compact(value)||"[빈칸]");}
function matchingColumns(values,cells) {
 if(values.filter(value=>value&&value!=="[빈칸]").length<2)return [];
 const original=cells.map(value=>compact(value)||"[빈칸]");
 const matches=[];
 for(let start=0;start<=original.length-values.length;start++)if(values.every((value,i)=>value===original[start+i] || (!/^\d+$/u.test(value) && uniqueTextRange(cells[start+i],value)!==null)))matches.push(start);
 return matches.length===1?values.map((_,i)=>matches[0]+i):[];
}
function matchingSourceColumns(body,canonical) {
 const fields=String(body).trim().split(/\s*\|\s*/u),original=String(canonical).trim().split(/\s*\|\s*/u);
 const columns=matchingColumns(fieldValues(body),rawFieldValues(canonical));
 const label=field=>field.includes(":")?compact(field.slice(0,field.indexOf(":"))):"";
 return columns.length&&fields.every((field,i)=>!label(field)||label(field)===label(original[columns[i]]))?columns:[];
}
export function sourceSheetEvidenceQuotes(source={}) {
 const quotes=source.evidenceQuotes?.length?source.evidenceQuotes:(source.highlightTexts||[]);
 const rows=segments(source.text||source.excerpt||"");
 const result=[];
 for(const quote of quotes) {
  if(typeof quote!=="string")continue;
  if(segments(quote).length){
   for(const part of segments(quote))if(rows.some(row=>row.row===part.row&&matchingSourceColumns(part.body,row.body).length))result.push(`행 ${part.row}: ${part.body}`);
   continue;
  }
  const matches=rows.filter(row=>matchingSourceColumns(quote,row.body).length>0);
  if(matches.length===1)result.push(`행 ${matches[0].row}: ${quote}`);
 }
 return result;
}
export function verifiedSheetEvidenceCells(data,sourceSheet,quotes=[]) {
 if(!sourceSheet||data?.sheet!==sourceSheet)return [];
 const found=new Map();
 for(const quote of quotes)for(const part of segments(quote)){
  const row=data.rows.find(row=>row.row===part.row);if(!row)continue;
  for(const column of matchingColumns(fieldValues(part.body),row.cells))found.set(`${row.row}:${column}`,{row:row.row,column});
 }
 return [...found.values()].sort((a,b)=>a.row-b.row||a.column-b.column);
}
export function verifiedSheetEvidenceRows(data,sourceSheet,quotes=[]) {
 return [...new Set(verifiedSheetEvidenceCells(data,sourceSheet,quotes).map(cell=>cell.row))];
}

export function fitSheetScale(viewportWidth,sheetWidth,minimumScale=.65) {
 if(!(viewportWidth>0&&sheetWidth>0))return .75;
 return Math.max(minimumScale,Math.min(.8,(viewportWidth-8)/sheetWidth));
}
function uniqueTextRange(text,needle,allowRepeated=false) {
 text=String(text??"");needle=compact(needle);
 if(needle.length<2||needle==="[빈칸]")return null;
 const positions=[];let normalized="";
 for(let i=0;i<text.length;i++)if(!/\s/u.test(text[i])){positions.push(i);normalized+=text[i];}
 const starts=[];
 for(let index=normalized.indexOf(needle);index>=0;index=normalized.indexOf(needle,index+1))starts.push(index);
 if(!allowRepeated&&starts.length!==1)return null;
 const word=/[가-힣A-Za-z0-9]/u;
 for(const start of starts){
  const a=positions[start],b=positions[start+needle.length-1]+1;
  if((a>0&&word.test(text[a-1])&&word.test(text[a]))||(b<text.length&&word.test(text[b])&&word.test(text[b-1])))continue;
  return [a,b];
 }
 return null;
}
export function sheetTextHighlightParts(text,texts=[]) {
 text=String(text??"");
 const ranges=texts.map(needle=>uniqueTextRange(text,needle)).filter(Boolean).sort((a,b)=>a[0]-b[0]);
 const merged=[];
 for(const range of ranges){const last=merged.at(-1);if(last&&range[0]<=last[1])last[1]=Math.max(last[1],range[1]);else merged.push([...range]);}
 const parts=[];let cursor=0;
 for(const [a,b] of merged){if(a>cursor)parts.push({text:text.slice(cursor,a),highlighted:false});parts.push({text:text.slice(a,b),highlighted:true});cursor=b;}
 if(cursor<text.length)parts.push({text:text.slice(cursor),highlighted:false});
 return parts;
}
export function verifiedSheetEvidenceText(data,sourceSheet,quotes=[],answerText="") {
 if(!sourceSheet||data?.sheet!==sourceSheet||!String(answerText).trim())return [];
 const plain=String(answerText).replace(/\*\*|__|`/gu,"")
  .replace(/([가-힣]{2,5})님(?=$|[\s)의은는께,.:])/gu,'$1 ')
  .replace(/(\d{3,6})(입니다|이에요|예요)(?=$|[\s.,!])/gu,'$1 ');
 const items=plain.split(/\r?\n/u).filter(line=>/^\s*(?:[-*•]\s+|\d+[.)]\s+)/u.test(line));
 const answer=items.length?items.join("\n"):plain;
 const fragments=answer.split(/[\n:：|•]/u).map(text=>text.trim().replace(/^(?:[-*]\s*|\d+[.)]\s*)/u,"")).filter(Boolean);
 const found=new Map();
 for(const quote of quotes)for(const part of segments(quote)){
  const row=data.rows.find(row=>row.row===part.row);if(!row)continue;
  const raw=part.body.trim().split(/\s*\|\s*/u).map(field=>field.slice(field.indexOf(":")+1).trim());
  const columns=matchingColumns(fieldValues(part.body),row.cells);
  columns.forEach((column,i)=>{
   const person=/^(?:성명|이름|전담간호사)\s*:/u.test(part.body.trim().split(/\s*\|\s*/u)[i]||'')
    ? /^([가-힣]{2,5})\(\d+\)$/u.exec(raw[i])?.[1] : null;
   const candidates=[raw[i],...(person?[person]:[]),...fragments.filter(fragment=>uniqueTextRange(raw[i],fragment))];
   const texts=[...new Set(candidates.filter(text=>uniqueTextRange(answer,text,true)&&uniqueTextRange(row.cells[column],text)))];
   if(!texts.length)return;
   const key=`${row.row}:${column}`,old=found.get(key);
   found.set(key,{row:row.row,column,texts:[...new Set([...(old?.texts||[]),...texts])]});
  });
 }
 return [...found.values()].sort((a,b)=>a.row-b.row||a.column-b.column);
}

export function firstVisibleEvidenceTarget(rects=[]) {
 let index=-1;
 rects.forEach((rect,i)=>{if(rect.right>rect.left&&rect.bottom>rect.top&&(index<0||rect.top<rects[index].top))index=i;});
 return index;
}
