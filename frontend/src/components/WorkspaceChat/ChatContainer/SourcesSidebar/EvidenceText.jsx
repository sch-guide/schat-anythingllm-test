import {textEvidenceParts} from "@/utils/textEvidenceHighlight";
export default function EvidenceText({text="",quotes=[]}) {
  const parts=textEvidenceParts(text,quotes);
  return <>
    {parts.some(part=>part.highlighted) && <p className="mb-2 text-xs text-zinc-400 light:text-slate-500">연두색 표시 = 답변에 사용된 근거</p>}
    <p className="whitespace-pre-line">{parts.map((part,index)=>part.highlighted
      ? <mark key={index} style={{backgroundColor:"#e6f7c8",color:"#18330a"}}>{part.text}</mark>
      : <span key={index}>{part.text}</span>)}</p>
  </>;
}
