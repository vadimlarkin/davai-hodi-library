'use strict';
// Local PNG composition using the site's existing logo, with no external service.
const quoteCard = (() => {
  let logoPromise;
  function loadLogo() {
    if (!logoPromise) logoPromise = new Promise((resolve,reject)=>{
      const logo=new Image();
      logo.onload=()=>resolve(logo);
      logo.onerror=()=>{logoPromise=null;reject(new Error('logo'));};
      logo.src=new URL('assets/podcast-logo-transparent.png',document.baseURI).href;
    });
    return logoPromise;
  }
  function wrapText(ctx,text,width) {
    const lines=[];
    for (const paragraph of String(text).split(/\n/)) {
      let line='';
      for (const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
        if (ctx.measureText(word).width>width) {
          if(line){lines.push(line);line='';}
          for (const letter of Array.from(word)) {
            if(line && ctx.measureText(line+letter).width>width){lines.push(line);line='';}
            line+=letter;
          }
        } else {
          const next=line?`${line} ${word}`:word;
          if(line && ctx.measureText(next).width>width){lines.push(line);line=word;}else line=next;
        }
      }
      lines.push(line);
    }
    return lines;
  }
  async function create({text,game,episode,timestamp}) {
    const logo=await loadLogo();
    const canvas=document.createElement('canvas');
    const ctx=canvas.getContext('2d');
    if(!ctx)throw new Error('canvas');
    const width=1080,padding=72;
    ctx.font='bold 46px Arial, Helvetica, sans-serif';
    const titleLines=wrapText(ctx,`«${game}»`,width-padding*2);
    const quoteTop=148+titleLines.length*56+52;
    let size=68,lines,lineHeight;
    for(size of [68,64,60,56,52]) {
      ctx.font=`${size}px Georgia, "Times New Roman", serif`;
      lines=wrapText(ctx,`«${text}»`,width-padding*2-32);
      lineHeight=Math.round(size*1.3);
      if(quoteTop+lines.length*lineHeight+72+180<=1080)break;
    }
    canvas.width=width;
    canvas.height=Math.max(1080,quoteTop+lines.length*lineHeight+72+180);
    ctx.fillStyle='#faf8f4';ctx.fillRect(0,0,width,canvas.height);
    ctx.textBaseline='top';ctx.textAlign='left';
    ctx.fillStyle='#656c72';ctx.font='bold 22px Arial, Helvetica, sans-serif';
    ctx.fillText('ЧТО МЫ ГОВОРИЛИ ПРО',padding,76);
    ctx.fillStyle='#16191c';ctx.font='bold 46px Arial, Helvetica, sans-serif';
    titleLines.forEach((line,i)=>ctx.fillText(line,padding,132+i*56));
    ctx.fillStyle='#f04e37';ctx.fillRect(padding,quoteTop,5,lines.length*lineHeight-12);
    ctx.fillStyle='#16191c';ctx.font=`${size}px Georgia, "Times New Roman", serif`;
    lines.forEach((line,i)=>ctx.fillText(line,padding+32,quoteTop+i*lineHeight));
    const footer=canvas.height-180;
    ctx.fillStyle='#dddeda';ctx.fillRect(padding,footer,width-padding*2,2);
    const logoSize=88;
    const ratio=Math.min(logoSize/logo.width,logoSize/logo.height);
    ctx.drawImage(logo,padding+(logoSize-logo.width*ratio)/2,footer+40+(logoSize-logo.height*ratio)/2,logo.width*ratio,logo.height*ratio);
    ctx.font='bold 40px Arial, Helvetica, sans-serif';ctx.fillStyle='#16191c';
    ctx.fillText('давай ходи',padding+logoSize+20,footer+43);
    ctx.font='22px Arial, Helvetica, sans-serif';ctx.fillStyle='#656c72';
    ctx.fillText('Игротека подкаста',padding+logoSize+20,footer+96);
    ctx.textAlign='right';ctx.fillStyle='#16191c';ctx.font='bold 28px Arial, Helvetica, sans-serif';
    ctx.fillText(episode,width-padding,footer+48);
    ctx.font='28px Arial, Helvetica, sans-serif';ctx.fillStyle='#656c72';ctx.fillText(timestamp,width-padding,footer+95);
    return new Promise((resolve,reject)=>canvas.toBlob(blob=>{canvas.width=0;canvas.height=0;blob?resolve(blob):reject(new Error('png'));},'image/png'));
  }
  return {create,wrapText};
})();
