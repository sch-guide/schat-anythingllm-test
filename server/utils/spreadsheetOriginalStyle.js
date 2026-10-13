const bounded=(value,min,max,fallback)=>Number.isFinite(Number(value))?Math.max(min,Math.min(max,Number(value))):fallback;
function columnWidthPixels(width){return Math.floor(bounded(width,0,255,8.43)*7+5);}
function colorHex(color,theme=[]){
 if(!color)return undefined;
 let value=color.argb||color.rgb||(Number.isInteger(color.theme)?theme[color.theme]:null);
 if(!value&&Number.isInteger(color.indexed))value=(["000000","FFFFFF","FF0000","00FF00","0000FF","FFFF00","FF00FF","00FFFF"])[color.indexed%8];
 if(!/^(?:[a-f0-9]{6}|[a-f0-9]{8})$/iu.test(value||""))return undefined;
 value=value.slice(-6);const tint=bounded(color.tint,-1,1,0);
 if(tint)value=value.match(/../g).map(hex=>{const n=parseInt(hex,16);return Math.round(tint<0?n*(1+tint):n*(1-tint)+255*tint).toString(16).padStart(2,"0");}).join("");
 return "#"+value.toUpperCase();
}
function originalCellStyle(style={},theme=[]){
 const css={},font=style.font||{},alignment=style.alignment||{};
 if(font.name)css.fontFamily=String(font.name).replace(/&quot;/g,"").slice(0,100);
 if(font.size)css.fontSize=bounded(font.size,1,409,11)*4/3;
 if(font.bold)css.fontWeight="bold";if(font.italic)css.fontStyle="italic";
 if(font.underline)css.textDecoration="underline";
 const ink=colorHex(font.color,theme);if(ink)css.color=ink;
 const fill=style.fill?.type==="pattern"&&style.fill.pattern==="solid"?colorHex(style.fill.fgColor,theme):null;
 if(fill)css.backgroundColor=fill;
 if(["left","center","right","justify"].includes(alignment.horizontal))css.textAlign=alignment.horizontal;
 if(["top","middle","bottom"].includes(alignment.vertical))css.verticalAlign=alignment.vertical;
 css.whiteSpace=alignment.wrapText?"pre-wrap":"pre";
 if(alignment.indent)css.paddingLeft=bounded(alignment.indent,0,20,0)*8+2;
 for(const side of ["top","right","bottom","left"]){
  const border=style.border?.[side];if(!border?.style)continue;
  const types={thin:[1,"solid"],hair:[1,"solid"],medium:[2,"solid"],thick:[3,"solid"],double:[3,"double"],dotted:[1,"dotted"],dashed:[1,"dashed"],dashDot:[1,"dashed"],mediumDashed:[2,"dashed"],mediumDashDot:[2,"dashed"]};
  const [width,type]=types[border.style]||[1,"solid"];
  css["border"+side[0].toUpperCase()+side.slice(1)]=width+"px "+type+" "+(colorHex(border.color,theme)||"#000000");
 }
 return css;
}
module.exports={originalCellStyle,columnWidthPixels};
