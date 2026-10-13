// Match only unique verbatim evidence, preserving the source's original text.
export function textEvidenceParts(text = "", quotes = []) {
  text = String(text || "");
  let compact="";
  const positions=[];
  for(let i=0;i<text.length;i++) if(!/\s/u.test(text[i])) {compact+=text[i];positions.push(i);}
  const ranges=[];
  for(const quote of Array.isArray(quotes) ? quotes : []) {
    if(typeof quote!=="string") continue;
    const needle=quote.replace(/\s/gu,"");
    if(needle.length<8) continue;
    const start=compact.indexOf(needle);
    if(start<0 || compact.indexOf(needle,start+1)>=0) continue;
    ranges.push([positions[start],positions[start+needle.length-1]+1]);
  }
  ranges.sort((a,b)=>a[0]-b[0]);
  const merged=[];
  for(const range of ranges) {
    const last=merged.at(-1);
    if(last && range[0]<=last[1]) last[1]=Math.max(last[1],range[1]);
    else merged.push([...range]);
  }
  let cursor=0;
  const result=[];
  for(const [start,end] of merged) {
    if(start>cursor) result.push({text:text.slice(cursor,start),highlighted:false});
    result.push({text:text.slice(start,end),highlighted:true});cursor=end;
  }
  if(cursor<text.length) result.push({text:text.slice(cursor),highlighted:false});
  return result;
}
