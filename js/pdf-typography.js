/* PDF typography explorer — client-side only; PDF.js is loaded by app.js. */
(function(){
 'use strict';
 const $=q=>document.querySelector(q), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
 let token=0, doc=null, pages=[], names=new Map();
 const section=()=>$('#pdfTypographySection');
 const keyOf=item=>item.fontName||'Unknown PDF font';
 // PDF.js text items use a renderer ID, not the PDF's font name. The
 // pinned PDF.js build exposes the font object under the same ID.
 function pdfFontLabel(name){
   if(typeof name!=='string')return '';
   const label=name.trim().replace(/^[A-Z]{6}\+/,'').trim();
   return /^(?:g_|sans-serif$|serif$|monospace$|unknown(?: pdf)? font$)/i.test(label)?'':label;
 }
 async function resolveFonts(page,keys){
   const objects=page.commonObjs, found=new Map();
   if(!objects||!keys.length)return found;
   const read=key=>pdfFontLabel(objects.get(key)?.name);
   try{
     if(keys.some(key=>!objects.has(key))){
       const ops=await page.getOperatorList();
       // Only wait for IDs the operator list actually references. A text
       // run can exist without a corresponding renderable font object.
       const pending=new Set();
       for(const args of ops.argsArray){
         if(typeof args?.[0]==='string')pending.add(args[0]);
         else if(Array.isArray(args?.[0]))for(const id of args[0])if(typeof id==='string')pending.add(id);
       }
       let timeout;
       try{
         await Promise.race([
           Promise.all(keys.filter(key=>pending.has(key)&&!objects.has(key)).map(key=>new Promise(resolve=>objects.get(key,resolve)))),
           new Promise(resolve=>{timeout=setTimeout(resolve,750);})
         ]);
       }finally{clearTimeout(timeout);}
     }
   }catch(err){console.warn('PDF font names unavailable on this page',err);}
   for(const key of keys)if(objects.has(key)){const label=read(key);if(label)found.set(key,label);}
   return found;
 }
 const fontLabel=entry=>entry.label||'Unknown font '+entry.number;
 function reset(){window.PWFontAlternatives?.close();token++;doc=null;pages=[];names.clear();section()?.classList.add('hidden');if($('#pdfTypePages'))$('#pdfTypePages').innerHTML='';}
 async function start(pdf){
   window.PWFontAlternatives?.close();
   const mine=++token;doc=pdf;pages=[];names.clear();
   section().classList.remove('hidden');
   $('#pdfTypeStatus').textContent='Reading text positions and typography across '+pdf.numPages+' pages…';
   $('#pdfTypePages').innerHTML='';
   try{
    for(let i=1;i<=pdf.numPages;i++){
      if(mine!==token)return;
      const p=await pdf.getPage(i), tc=await p.getTextContent();
      if(mine!==token)return;
      const textItems=tc.items.filter(x=>x.str && x.str.trim());
      const unresolved=[...new Set(textItems.map(keyOf))].filter(key=>!names.get(key)?.label && key!=='Unknown PDF font' && key!=='g_font_error');
      const resolved=await resolveFonts(p,unresolved);
      if(mine!==token)return;
      const items=textItems.map(item=>{
        const k=keyOf(item);
        // Text transforms are in PDF points at viewport scale 1.
        const sx=Math.hypot(item.transform[0],item.transform[1]);
        const sy=Math.hypot(item.transform[2],item.transform[3]);
        const size=Math.round((sy||sx||0)*10)/10;
        if(!names.has(k)) names.set(k,{label:'',number:names.size+1,items:0,pages:new Set(),sizes:new Set()});
        const font=names.get(k);if(resolved.has(k))font.label=resolved.get(k);font.items++;font.pages.add(i);if(size)font.sizes.add(size);
        return {str:item.str,font:k,size,transform:item.transform,width:item.width,height:item.height,vertical:!!tc.styles?.[k]?.vertical};
      });
      pages.push({number:i,items,hasText:items.length>0});
      $('#pdfTypeStatus').textContent='Reading page '+i+' of '+pdf.numPages+'…';
      if(i%8===0)await new Promise(r=>setTimeout(r,0));
    }
    if(mine!==token)return;
    const ps=$('#pdfTypePage');ps.innerHTML='<option value="all">All pages</option>'+pages.map(p=>'<option value="'+p.number+'">Page '+p.number+'</option>').join('');
    const fs=$('#pdfTypeFont');fs.innerHTML='<option value="all">All fonts</option>'+[...names].map(([k,v])=>'<option value="'+esc(k)+'">'+esc(fontLabel(v))+'</option>').join('');
    ps.onchange=()=>render();fs.onchange=()=>render();
    render();
   }catch(e){if(mine!==token)return;console.error('PDF typography',e);$('#pdfTypeStatus').textContent='Could not extract typography: '+e.message;}
 }
 function render(){
   if(!doc)return;
   const f=$('#pdfTypeFont').value, pg=$('#pdfTypePage').value;
   const available=pages.filter(p=>pg==='all'||String(p.number)===pg);
   const count=available.reduce((n,p)=>n+p.items.filter(it=>f==='all'||it.font===f).length,0);
   $('#pdfTypeSummary').textContent=pages.length+' pages · '+names.size+(names.size===1?' font · ':' fonts · ')+count+' text runs';
   const ordered=[...names].sort((a,b)=>b[1].items-a[1].items);
   $('#pdfTypeFonts').innerHTML=ordered.map(([key,v])=>{
      const active=f===key;
      const sizes=[...v.sizes].sort((a,b)=>a-b);
      return '<div class="pdf-type-entry"><button type="button" class="pdf-type-chip '+(active?'selected':'')+'" data-font="'+esc(key)+'"><strong>'+esc(fontLabel(v))+'</strong><small>'+v.pages.size+' pages · '+v.items+' runs · '+(sizes.length?sizes.slice(0,12).join(', ')+(sizes.length>12?'…':'')+' pt':'size unavailable')+'</small></button><button type="button" class="mini-btn pdf-font-alt" data-font="'+esc(key)+'" aria-label="Find similar free fonts to '+esc(fontLabel(v))+'">Find similar free fonts</button></div>';
   }).join('')||'<p>No selectable text fonts found.</p>';
   $('#pdfTypeFonts').querySelectorAll('.pdf-type-chip').forEach(b=>b.onclick=()=>{$('#pdfTypeFont').value=$('#pdfTypeFont').value===b.dataset.font?'all':b.dataset.font;render();});
   $('#pdfTypeFonts').querySelectorAll('.pdf-font-alt').forEach(button=>{
     button.hidden=!window.PWFontAlternatives;
     button.onclick=()=>{
       const key=button.dataset.font;
       const entry=names.get(key);
       let sample=null, score=-Infinity;
       for(const p of available){
         for(const item of p.items){
           if(item.font!==key||!item.str.trim())continue;
           const length=[...item.str].length;
           const upright=!item.vertical&&item.transform[1]===0&&item.transform[2]===0&&item.size>0&&item.width>0;
           const rank=(upright?500:0)+(length<=65?100:0)-Math.abs(length-(item.size>=16?12:32));
           if(rank>score){score=rank;sample={...item,page:p.number};}
         }
       }
       window.PWFontAlternatives.open(entry.label,doc,sample);
     };
   });
   const empty=available.filter(p=>!p.hasText).length;
   $('#pdfTypeStatus').textContent=(empty?empty+' page(s) contain no extractable text; artwork may be flattened, scanned or outlined. ':'')+'Font names come from the PDF. Point sizes are estimated from the text on the page. Check the preflight section for embedding status.';
   const grid=$('#pdfTypePages');grid.innerHTML='';
   for(const p of available){
      const card=document.createElement('article');card.className='pdf-type-page';
      card.innerHTML='<strong>Page '+p.number+'</strong><div class="pdf-type-stage"><canvas></canvas><div class="pdf-type-overlay"></div></div><small>'+p.items.length+' text runs</small>';
      grid.appendChild(card);
      drawPage(p,card,f,token);
   }
 }
 async function drawPage(p,card,filter,mine){
   try{
    const page=await doc.getPage(p.number);if(mine!==token||!card.isConnected)return;
    const base=page.getViewport({scale:1}), scale=Math.min(1.35,740/base.width);
    const viewport=page.getViewport({scale}),canvas=card.querySelector('canvas');
    const dpr=Math.min(devicePixelRatio||1,2);
    canvas.width=Math.round(viewport.width*dpr);canvas.height=Math.round(viewport.height*dpr);
    canvas.style.width=viewport.width+'px';canvas.style.height=viewport.height+'px';
    await page.render({canvasContext:canvas.getContext('2d'),viewport,transform:[dpr,0,0,dpr,0,0]}).promise;
    if(mine!==token||!card.isConnected)return;
    const layer=card.querySelector('.pdf-type-overlay');layer.style.width=viewport.width+'px';layer.style.height=viewport.height+'px';
    if(filter==='all')return;
    p.items.filter(t=>t.font===filter).forEach(it=>{
      const t=viewport.transform, m=it.transform;
      const x=t[0]*m[4]+t[2]*m[5]+t[4], y=t[1]*m[4]+t[3]*m[5]+t[5];
      const h=Math.max(3,it.size*scale), w=Math.max(3,it.width*scale);
      const box=document.createElement('span');box.className='pdf-type-mark';
      box.style.left=x+'px';box.style.top=(y-h)+'px';box.style.width=w+'px';box.style.height=h+'px';
      box.title=it.str;layer.appendChild(box);
    });
   }catch(e){console.warn('PDF typography page '+p.number,e);}
 }
 window.PWTypography={start,reset};
})();
