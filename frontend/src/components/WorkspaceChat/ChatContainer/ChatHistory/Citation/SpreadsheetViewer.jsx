import {Fragment,useEffect,useMemo,useRef,useState} from "react";
import StorageFiles from "@/models/files";
import {sheetEvidenceRows,sourceSheetEvidenceQuotes,verifiedSheetEvidenceText,sheetTextHighlightParts,fitSheetScale,firstVisibleEvidenceTarget} from "@/utils/spreadsheetView";
export default function SpreadsheetViewer({source,workspaceSlug,answerText=""}) {
 const quotes=sourceSheetEvidenceQuotes(source);
 const evidenceKey=JSON.stringify(quotes);
 const evidence=useMemo(()=>new Set(sheetEvidenceRows(quotes)),[evidenceKey]);
 const sourceSheet=String(source.section||"").replace(/^시트:\s*/u,"");
 const [sheet,setSheet]=useState(sourceSheet);
 const [start,setStart]=useState(()=>Math.max(0,([ ...evidence][0]||1)-3));
 const [data,setData]=useState(null),[error,setError]=useState("");
 useEffect(()=>{setSheet(sourceSheet);setStart(Math.max(0,([...evidence][0]||1)-3));},[source.spreadsheetRef,sourceSheet,evidenceKey]);
 useEffect(()=>{
  let cancelled=false;setData(null);setError("");
  if(!source.spreadsheetRef){setError("이전에 등록한 엑셀은 원본이 보관되지 않았습니다. 원본 표로 보려면 새 이름으로 다시 등록해 주세요.");return;}
  StorageFiles.originalSpreadsheet(workspaceSlug,source.spreadsheetRef,{sheet,start})
   .then(value=>{if(!cancelled)setData(value);}).catch(e=>{if(!cancelled)setError(e.message);});
  return()=>{cancelled=true;};
 },[source.spreadsheetRef,workspaceSlug,sheet,start]);
 if(error)return <p role="status" className="my-3 text-sm text-theme-text-secondary">{error}</p>;
 if(!data)return <p role="status" className="my-3 text-sm">엑셀 원본을 불러오는 중입니다.</p>;
 return <SpreadsheetPreview data={data} evidenceCells={verifiedSheetEvidenceText(data,sourceSheet,quotes,answerText)} onSheetChange={value=>{setSheet(value);setStart(0);}} onStartChange={setStart} />;
}
export function SpreadsheetPreview({data,evidenceCells=[],onSheetChange,onStartChange}) {
 const viewportRef=useRef(null),tableRef=useRef(null);
 const sheetWidth=Array.from({length:data.columns},(_,c)=>data.hiddenColumns?.[c]?0:(data.columnWidths?.[c]||90)).reduce((a,b)=>a+b,0);
 const fontSizes=data.rows.flatMap(row=>row.cells.map((value,c)=>String(value).trim()?row.styles?.[c]?.fontSize:null)).filter(size=>Number.isFinite(size)&&size>0);
 const minimumScale=fontSizes.length?Math.max(.45,Math.min(.65,12/Math.min(...fontSizes))):.65;
 const estimatedHeight=data.rows.filter(row=>!row.hidden).reduce((sum,row)=>sum+(row.height||20),0);
 const [scale,setScale]=useState(.75),[height,setHeight]=useState(estimatedHeight);
 const evidenceKey=JSON.stringify(evidenceCells);
 useEffect(()=>{
  const viewport=viewportRef.current,table=tableRef.current;if(!viewport||!table)return;
  const measure=()=>{setScale(fitSheetScale(viewport.clientWidth,sheetWidth,minimumScale));setHeight(Math.max(table.offsetHeight,table.scrollHeight,estimatedHeight));};
  measure();
  if(typeof ResizeObserver!=="undefined"){const observer=new ResizeObserver(measure);observer.observe(viewport);observer.observe(table);return()=>observer.disconnect();}
  window.addEventListener("resize",measure);return()=>window.removeEventListener("resize",measure);
 },[sheetWidth,data.sheet,data.start,estimatedHeight,minimumScale]);
 useEffect(()=>{
  const viewport=viewportRef.current;if(!viewport)return;
  const rects=[...viewport.querySelectorAll('[data-answer-evidence="true"]')].map(mark=>mark.getBoundingClientRect());
  const index=firstVisibleEvidenceTarget(rects);if(index<0)return;
  const outer=viewport.getBoundingClientRect(),target=rects[index];
  viewport.scrollTop=Math.max(0,viewport.scrollTop+target.top-outer.top-24);
  if(target.left<outer.left||target.right>outer.right)viewport.scrollLeft=Math.max(0,viewport.scrollLeft+target.left-outer.left-16);
 },[data.sheet,data.start,evidenceKey,scale,height]);
 return <div className="my-2 w-full min-w-0 text-sm">
  {data.sheets.length>1 && <select aria-label="워크시트 선택" className="mb-2 max-w-full rounded border bg-theme-bg-primary p-1" value={data.sheet} onChange={e=>onSheetChange(e.target.value)}>{data.sheets.map(name=><option key={name}>{name}</option>)}</select>}
  <div ref={viewportRef} className="max-h-[60vh] w-full min-w-0 overflow-auto rounded border border-theme-sidebar-border" data-testid="spreadsheet-scroll">
   <div style={{position:"relative",width:sheetWidth*scale,height:Math.ceil(height*scale)+2,overflow:"hidden",margin:"0 auto"}}>
    <div style={{position:"absolute",top:0,left:0,width:sheetWidth,transform:`scale(${scale})`,transformOrigin:"top left"}}>
     <SpreadsheetGrid data={data} evidenceCells={evidenceCells} gridRef={tableRef} />
    </div>
   </div>
  </div>
  {(data.start>0 || data.start+data.rows.length<data.totalRows) && <div className="mt-2 flex items-center gap-3"><button type="button" disabled={!data.start} onClick={()=>onStartChange(Math.max(0,data.start-100))}>이전</button><span>{data.start+1}–{data.start+data.rows.length} / {data.totalRows}</span><button type="button" disabled={data.start+data.rows.length>=data.totalRows} onClick={()=>onStartChange(data.start+100)}>다음</button></div>}
  {data.truncatedColumns && <p role="status" className="mt-1 text-xs">표시 가능한 열 범위를 초과했습니다.</p>}
 </div>;
}

export function SpreadsheetGrid({data,evidenceCells=[],gridRef}) {
 const textsFor=(r,c,merge)=>evidenceCells.filter(cell=>merge
  ? cell.row-1>=merge.s.r&&cell.row-1<=merge.e.r&&cell.column>=merge.s.c&&cell.column<=merge.e.c
  : cell.row===r&&cell.column===c).flatMap(cell=>cell.texts||[]);
 const widths=Array.from({length:data.columns},(_,c)=>data.columnWidths?.[c]||90);
 return <table ref={gridRef} className="border-collapse" aria-label="엑셀 원본 표" style={{tableLayout:"fixed",width:widths.reduce((sum,width,c)=>sum+(data.hiddenColumns?.[c]?0:width),0),backgroundColor:"#fff",color:"#111",fontSize:14,lineHeight:1.2}}>
   <colgroup>{widths.map((width,c)=><col key={c} style={{width,display:data.hiddenColumns?.[c]?"none":undefined}} />)}</colgroup>
   <tbody>{data.rows.map(row=><tr key={row.row} style={{height:row.height||20,display:row.hidden?"none":undefined}}>{row.cells.map((value,c)=>{
    const r=row.row-1,merge=data.merges.find(m=>r>=m.s.r&&r<=m.e.r&&c>=m.s.c&&c<=m.e.c);
    const anchor=merge?Math.max(merge.s.r,data.start):r;
    if(merge&&(r!==anchor||c!==merge.s.c))return null;
    const parts=sheetTextHighlightParts(merge?merge.value:value,textsFor(row.row,c,merge));
    const originalStyle=merge?.style||row.styles?.[c]||{};
    return <td key={c} rowSpan={merge?Math.min(merge.e.r,data.start+data.rows.length-1)-anchor+1:1} colSpan={merge?Math.min(merge.e.c,data.columns-1)-merge.s.c+1:1}
      style={{padding:"0 2px",height:row.height||20,verticalAlign:"bottom",...originalStyle,whiteSpace:"pre-wrap",overflow:"visible",overflowWrap:"anywhere",display:data.hiddenColumns?.[c]?"none":undefined}}>{parts.map((part,i)=>part.highlighted?<mark key={i} className="evidence-highlight" data-answer-evidence="true" style={{backgroundColor:"#e6f7c8",color:"inherit",padding:"0 1px",borderRadius:1,boxDecorationBreak:"clone",WebkitBoxDecorationBreak:"clone"}}>{part.text}</mark>:<Fragment key={i}>{part.text}</Fragment>)}</td>;
   })}</tr>)}</tbody>
  </table>;
}
