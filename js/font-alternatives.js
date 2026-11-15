/* Curated Google Fonts alternatives. These are suggestions, not visual font recognition. */
(function(root){
 'use strict';

 // Family, supported styles (regular and bold unless specified), and catalogue slug.
 const fonts={
   Arimo:['Arimo','arimo','bi'], Tinos:['Tinos','tinos','bi'], Cousine:['Cousine','cousine','bi'],
   Inter:['Inter','inter','bi'], Roboto:['Roboto','roboto','bi'], Lato:['Lato','lato','bi'],
   Montserrat:['Montserrat','montserrat','bi'], Poppins:['Poppins','poppins','bi'],
   Figtree:['Figtree','figtree','bi'], Jost:['Jost','jost','bi'], Outfit:['Outfit','outfit','b'],
   Nunito:['Nunito Sans','nunitosans','bi'], Gelasio:['Gelasio','gelasio','bi'],
   SourceSerif:['Source Serif 4','sourceserif4','bi'], LibreBaskerville:['Libre Baskerville','librebaskerville','bi'],
   LibreCaslon:['Libre Caslon Text','librecaslontext','bi'], EB:['EB Garamond','ebgaramond','bi'],
   Cormorant:['Cormorant Garamond','cormorantgaramond','bi'], Playfair:['Playfair Display','playfairdisplay','bi'],
   Bodoni:['Bodoni Moda','bodonimoda','bi'], RobotoMono:['Roboto Mono','robotomono','bi'],
   IBMMono:['IBM Plex Mono','ibmplexmono','bi'], Oswald:['Oswald','oswald','b'], Anton:['Anton','anton',''],
   Bebas:['Bebas Neue','bebasneue',''], Stardos:['Stardos Stencil','stardosstencil','b'],
   BlackOps:['Black Ops One','blackopsone',''], Allerta:['Allerta Stencil','allertastencil',''],
   Marker:['Permanent Marker','permanentmarker',''], Kalam:['Kalam','kalam','b'],
   Caveat:['Caveat','caveat','b'], Comic:['Comic Neue','comicneue','bi'], Bangers:['Bangers','bangers',''],
   Slab:['Roboto Slab','robotoslab','b'], CourierPrime:['Courier Prime','courierprime','bi']
 };
 const sets=[
   [['Arial','ArialMT','Arial Unicode MS','Helvetica','Helvetica Neue','HelveticaNeueLTStd','Nimbus Sans'],['Arimo','Inter','Roboto']],
   [['Times','Times Roman','Times New Roman','Nimbus Roman'],['Tinos','LibreBaskerville','SourceSerif']],
   [['Courier','Courier New','Nimbus Mono PS'],['Cousine','CourierPrime','IBMMono']],
   [['Inter'],['Arimo','Roboto']],
   [['Roboto'],['Inter','Arimo']],
   [['Montserrat'],['Figtree','Poppins']],
   [['Bangers'],['Marker','Comic']],
   [['Black Ops One','Stardos Stencil','Allerta Stencil'],['Stardos','BlackOps','Allerta']],
   [['Georgia'],['Gelasio','SourceSerif','LibreBaskerville']],
   [['Garamond','Adobe Garamond','Adobe Garamond Pro','Garamond Premier Pro','AGaramondPro'],['EB','Cormorant','LibreCaslon']],
   [['Baskerville','Baskerville Old Face','Baskerville MT'],['LibreBaskerville','SourceSerif','Gelasio']],
   [['Didot','Bodoni','Bodoni MT','Bodoni 72'],['Bodoni','Playfair','Cormorant']],
   [['Futura','Futura PT','Futura Std'],['Jost','Outfit','Poppins']],
   [['Avenir','Avenir Next','Avenir Next LT Pro'],['Nunito','Figtree','Lato']],
   [['Gotham','Gotham Pro','Proxima Nova'],['Montserrat','Figtree','Inter']],
   [['Verdana','Tahoma'],['Lato','Arimo','Nunito']],
   [['Impact','Haettenschweiler','Trade Gothic Condensed','DIN Condensed'],['Anton','Oswald','Bebas']],
   [['Stencil','Stencil Std','Stencil MT','Stencil BT','USAAF Stencil'],['Stardos','BlackOps','Allerta']],
   [['Bank Gothic','Bank Gothic BT','Agency FB'],['Oswald','Bebas','Outfit']],
   [['Comic Sans','Comic Sans MS','ComicSansMS'],['Comic','Kalam','Caveat']],
   [['Marker Felt','Felt Tip Roman','Bradley Hand','Bradley Hand ITC'],['Marker','Kalam','Caveat']],
   [['Komika Text','Komika Title','Action Man','Anime Ace','CC Wild Words','Wild Words'],['Bangers','Marker','Comic']],
   [['Rockwell','Rockwell Std','Clarendon','Clarendon BT'],['Slab','SourceSerif','Gelasio']]
 ];
 const key=name=>name.toLowerCase().replace(/[^a-z0-9]/g,'');
 const aliases=new Map(sets.flatMap(([names,ids])=>names.map(name=>[key(name),ids])));
 const suffix=/(?:extrabold|ultrabold|semibold|demibold|demi|bold|extrablack|ultrablack|black|heavy|extralight|ultralight|light|thin|medium|regular|normal|roman|book|italic|oblique|upright|psmt|ps|mt|std|pro|lt|bt)$/;
 function match(name){
   const raw=key(name);
   if(!raw)return [];
   // Already-free families get a direct link and a few related faces when curated.
   const existing=Object.keys(fonts).find(id=>raw===key(fonts[id][0]));
   let base=raw;
   while(!aliases.has(base)&&!Object.keys(fonts).some(id=>base===key(fonts[id][0]))&&suffix.test(base)){
     base=base.replace(suffix,'');
   }
   const self=existing||Object.keys(fonts).find(id=>base===key(fonts[id][0]));
   const ids=[...new Set([...(self?[self]:[]),...(aliases.get(base)||[])])].slice(0,3);
   const style=raw.slice(base.length);
   const bold=/(bold|black|heavy|demi)/.test(style), italic=/(italic|oblique)/.test(style);
   return ids.map(id=>{
     const [family,slug,support]=fonts[id];
     const weight=bold&&support.includes('b')?700:400;
     const slant=italic&&support.includes('i')?'italic':'normal';
     return {family,slug,weight,slant,exact:id===self,
       differentStyle:(bold&&weight!==700)||(italic&&slant!=='italic')};
   });
 }
 const googleUrl=font=>'https://fonts.google.com/specimen/'+font.family.replaceAll(' ','+');
 let dialog, revision=0;
 function close(){revision++;if(dialog?.open)dialog.close();}
 function el(tag,text,className){
   const node=document.createElement(tag);
   if(text!=null)node.textContent=text;
   if(className)node.className=className;
   return node;
 }
 function modal(){
   if(dialog)return dialog;
   dialog=el('dialog',null,'font-alt-dialog');
   dialog.setAttribute('aria-labelledby','fontAltTitle');
   dialog.addEventListener('close',()=>{if(!dialog.open)revision++;});
   dialog.addEventListener('click',e=>{if(e.target===dialog)close();});
   document.body.append(dialog);
   return dialog;
 }
 // Font requests contain only fixed catalogue family names and styles. The PDF
 // sample is used for local canvas measurement and is never sent to Google.
 async function loadPreview(font){
   const {family,weight,slant}=font;
   const css=slant+' '+weight+' 32px "'+family+'"';
   const style=(slant==='italic'?'ital,':'')+'wght@'+(slant==='italic'?'1,':'')+weight;
   const href='https://fonts.googleapis.com/css2?family='+encodeURIComponent(family)+':'+style+'&display=swap';
   let link=[...document.querySelectorAll('link[data-font-preview]')].find(x=>x.href===href);
   if(!link){
     link=el('link');
     link.rel='stylesheet';link.href=href;link.dataset.fontPreview='';
     link.ready=new Promise((resolve,reject)=>{link.onload=resolve;link.onerror=reject;});
     document.head.append(link);
   }
   let timer;
   try{
     await Promise.race([
       link.ready,
       new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Font stylesheet timed out')),6000);})
     ]);
   }finally{clearTimeout(timer);}
   return css;
 }
 async function drawOriginal(canvas,pdf,sample){
   const page=await pdf.getPage(sample.page);
   const base=page.getViewport({scale:1});
   const [a,b,c,d,x,y]=sample.transform;
   const [vx,vy]=base.convertToViewportPoint(x,y);
   const t=base.transform;
   const angle=Math.atan2(t[1]*a+t[3]*b,t[0]*a+t[2]*b);
   // A baseline-aligned crop is only meaningful for upright horizontal text.
   if(Math.abs(angle)>0.02 || c!==0 || d<=0)return false;
   const pointScale=base.scale*page.userUnit;
   const width=sample.width*pointScale, size=sample.size*pointScale;
   if(!Number.isFinite(width)||!Number.isFinite(size)||width<=0||size<=0)return false;
   const shown=32/size, quality=Math.min(root.devicePixelRatio||1,2);
   const left=vx-3/shown, top=vy-35/shown;
   const cssWidth=Math.ceil(width*shown)+6, cssHeight=49;
   if(cssWidth>3000)return false;
   canvas.width=Math.ceil(cssWidth*quality);canvas.height=Math.ceil(cssHeight*quality);
   canvas.style.width=cssWidth+'px';canvas.style.height=cssHeight+'px';
   await page.render({canvasContext:canvas.getContext('2d'),viewport:base,
     transform:[shown*quality,0,0,shown*quality,-left*shown*quality,-top*shown*quality]}).promise;
   return true;
 }
 async function open(name,pdf,sample){
   const mine=++revision, box=modal(), choices=match(name);
   box.replaceChildren();
   const title=el('h2',name?'Free alternatives for '+name:'Find similar free fonts');
   title.id='fontAltTitle';
   const done=el('button','Close','mini-btn');done.type='button';done.onclick=close;done.autofocus=true;
   const header=el('div',null,'font-alt-header');header.append(title,done);box.append(header);
   if(!box.open)box.showModal();
   if(!choices.length){
     box.append(el('p',name?'No close match found in the curated list.':'No close match found because the PDF doesn’t give this font a readable name.'));
     return;
   }
   box.append(el('p','Curated suggestions from Google Fonts. Previews don’t change the PDF.','insp-note'));
   const valid=sample&&sample.size>0&&sample.width>0&&!sample.vertical&&sample.transform[2]===0;
   const text=sample?.str||'The quick brown fox';
   const original=el('div',null,'font-alt-original');
   if(sample){
     original.append(el('strong','Original on page '+sample.page));
     const view=el('div',null,'font-alt-scroll');
     const canvas=el('canvas');
     canvas.setAttribute('role','img');canvas.setAttribute('aria-label','Original PDF sample: '+text);
     view.append(canvas);original.append(view);box.append(original);
     if(valid){
       drawOriginal(canvas,pdf,sample).then(ok=>{if(!ok)view.textContent='Original preview unavailable for this text.';})
         .catch(()=>{view.textContent='Original preview unavailable for this text.';});
     }else view.textContent='Original preview unavailable for this text.';
   }
   const cards=el('div',null,'font-alt-cards');box.append(cards);
   const results=await Promise.all(choices.map(async(font,index)=>{
     const card=el('article',null,'font-alt-card');
     const link=el('a',font.family);link.href=googleUrl(font);link.target='_blank';link.rel='noopener noreferrer';
     const tags=el('div',font.exact?'Already on Google Fonts':index===(choices[0].exact?1:0)?'Closest look':'','font-alt-tags');
     const preview=el('div',null,'font-alt-scroll');
     const line=el('span','Loading preview…','font-alt-sample');preview.append(line);
     const fit=el('p',font.differentStyle?'Closest available style shown.':'','insp-note');
     card.append(link,tags,preview,fit);cards.append(card);
     try{
       const css=await loadPreview(font);
       // Loading with a local string chooses the necessary unicode ranges.
       // The stylesheet URL above never includes a text parameter.
       const loaded=await document.fonts.load(css,text);
       if(mine!==revision)return null;
       if(!loaded.length)throw Error('Font did not load');
       line.style.font=css;line.textContent=text;
       if(!valid||!/^[-\x20-\x7e\u00a0-\u024f\u2000-\u206f]+$/.test(text)){
         fit.append(' Width comparison unavailable for this sample.');return null;
       }
       const context=el('canvas').getContext('2d');
       context.font=css;
       const ratio=context.measureText(text).width/(sample.width/sample.size*32);
       if(!Number.isFinite(ratio)||ratio<=0)return null;
       const delta=Math.round((ratio-1)*100);
       fit.append(delta===0?' About the same width.':' About '+Math.abs(delta)+'% '+(delta>0?'wider.':'narrower.'));
       return {ratio,tags};
     }catch{
       if(mine===revision){line.textContent='Preview unavailable';fit.append(' Open Google Fonts to see this typeface.');}
       return null;
     }
   }));
   if(mine!==revision)return;
   const best=results.filter((result,i)=>result&&!choices[i].exact).sort((a,b)=>Math.abs(a.ratio-1)-Math.abs(b.ratio-1))[0];
   if(best)best.tags.append(best.tags.textContent?' · Closest fit':'Closest fit');
   box.append(el('p','Samples are shown at the same apparent type size. Width is estimated for this excerpt only. Recheck line breaks and spacing in your layout.','insp-note'));
 }
 root.PWFontAlternatives={open,close};
 if(typeof module!=='undefined')module.exports={match,googleUrl};
})(typeof window!=='undefined'?window:globalThis);
