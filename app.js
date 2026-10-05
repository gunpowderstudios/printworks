const $=s=>document.querySelector(s);
const state={zip:null,file:null,stylesXml:null,designMap:null,stories:[],spreads:[],fonts:[],styles:[],selected:null,pdfFile:null,pdfDoc:null};

const moods=[
 {id:'editorial',name:'Editorial Serif',class:'style-editorial',head:'Cormorant Garamond',body:'Source Serif 4',label:'Inter',desc:'Elegant, bookish and atmospheric. Strong for rules, lore, premium board-game manuals and narrative pages.',sample:'Adventure begins on the page.',bodySample:'A restrained serif system with generous rhythm, clear hierarchy and a more literary feel.',headStyle:{font:'Cormorant Garamond',style:'Semibold',size:28,leading:30},bodyStyle:{font:'Source Serif 4',style:'Regular',size:10.5,leading:14},labelStyle:{font:'Inter',style:'Bold',size:8.5,leading:10}},
 {id:'modern',name:'Modern Grotesk',class:'style-modern',head:'Arial',body:'Arial',label:'Arial',desc:'Direct, bold and highly legible. Useful for instructions, diagrams, quick-reference sheets and contemporary packaging.',sample:'Make every move count.',bodySample:'A compact sans-serif system designed for clarity, speed and strong information hierarchy.',headStyle:{font:'Arial',style:'Bold',size:27,leading:28},bodyStyle:{font:'Arial',style:'Regular',size:10,leading:13.5},labelStyle:{font:'Arial',style:'Bold',size:8,leading:9.5}},
 {id:'humanist',name:'Humanist Play',class:'style-humanist',head:'Trebuchet MS',body:'Trebuchet MS',label:'Arial',desc:'Friendly and accessible without looking childish. Good for family games, cards, sidebars and player-facing instructions.',sample:'Easy to learn. Hard to leave.',bodySample:'Open forms and relaxed spacing make dense rules feel lighter and more welcoming.',headStyle:{font:'Trebuchet MS',style:'Bold',size:26,leading:29},bodyStyle:{font:'Trebuchet MS',style:'Regular',size:10.5,leading:14},labelStyle:{font:'Arial',style:'Bold',size:8.5,leading:10}},
 {id:'classic',name:'Classic Display',class:'style-classic',head:'Times New Roman',body:'Georgia',label:'Arial',desc:'High-contrast, dramatic and traditional. Useful when the document needs ceremony, fantasy atmosphere or a collector-edition feel.',sample:'Enter the unknown.',bodySample:'A theatrical display face paired with a calm reading serif and disciplined small labels.',headStyle:{font:'Times New Roman',style:'Bold',size:26,leading:29},bodyStyle:{font:'Georgia',style:'Regular',size:10.5,leading:14},labelStyle:{font:'Arial',style:'Bold',size:8,leading:9.5}}
];

function init(){
 const dz=$('#dropZone'), fi=$('#fileInput');
 dz.onclick=()=>fi.click(); dz.onkeydown=e=>{if(e.key==='Enter'||e.key===' ')fi.click()};
 ['dragenter','dragover'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add('drag')}));
 ['dragleave','drop'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove('drag')}));
 dz.addEventListener('drop',e=>handleFile(e.dataTransfer.files[0]));
 fi.onchange=e=>handleFile(e.target.files[0]);
 $('#newFileBtn').onclick=()=>{fi.value='';$('#pdfInput').value='';state.pdfFile=null;state.pdfDoc=null;$('#pdfStatus').classList.add('hidden');$('#pdfBtn').textContent='Add PDF preview';$('#workspace').classList.add('hidden');$('.hero').classList.remove('hidden');window.scrollTo({top:0,behavior:'smooth'})};
 $('#exportBtn').onclick=exportIDML;\n $('#pdfBtn').onclick=()=>$('#pdfInput').click();\n $('#pdfInput').onchange=e=>handlePDF(e.target.files[0]);\n $('#lightboxClose').onclick=closeLightbox;\n $('#lightbox').onclick=e=>{if(e.target.id==='lightbox')closeLightbox()};\n document.addEventListener('keydown',e=>{if(e.key==='Escape')closeLightbox()});
 renderMoods();
}
async function handleFile(file){
 if(!file)return;
 if(!file.name.toLowerCase().endsWith('.idml'))return alert('Version 1.0 currently accepts IDML files only.');
 try{
  $('#healthBadge').textContent='Reading…';
  const zip=await JSZip.loadAsync(file);
  state.zip=zip;state.file=file;
  state.stylesXml=await textFile(zip,'Resources/Styles.xml');
  state.designMap=await textFile(zip,'designmap.xml');
  state.stories=await readFolder(zip,'Stories/');
  state.spreads=await readFolder(zip,'Spreads/');
  if(!state.designMap||!state.stylesXml)throw new Error('This does not look like a complete IDML package.');
  analyse();
  renderDocument();
  $('.hero').classList.add('hidden');$('#workspace').classList.remove('hidden');
  $('#workspace').scrollIntoView({behavior:'smooth',block:'start'});
 }catch(err){console.error(err);alert('Printworks could not read this IDML. '+err.message)}
}
async function textFile(zip,path){const f=zip.file(path);return f?await f.async('string'):''}
async function readFolder(zip,prefix){
 const files=Object.values(zip.files).filter(f=>!f.dir&&f.name.startsWith(prefix)&&f.name.endsWith('.xml'));
 return Promise.all(files.map(async f=>({name:f.name,text:await f.async('string')})));
}
function attrValues(xml,attr){
 const rx=new RegExp(attr+'="([^"]+)"','g');const out=[];let m;
 while((m=rx.exec(xml)))out.push(decodeXml(m[1]));
 return out;
}
function uniq(a){return [...new Set(a.filter(Boolean))]}
function decodeXml(s){return s.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>')}
function analyse(){
 const all=[state.stylesXml,...state.stories.map(x=>x.text)].join('\n');
 state.fonts=uniq([...attrValues(all,'AppliedFont'),...attrValues(all,'FontFamily')]).filter(x=>!/^\$ID/.test(x)).slice(0,40);
 state.styles=uniq(attrValues(state.stylesXml,'Name')).filter(x=>x&&x!=='[No Paragraph Style]'&&x!=='[Basic Paragraph]').slice(0,80);
 const pageMatches=state.spreads.flatMap(s=>[...s.text.matchAll(/<Page\b/g)]);
 state.pageTotal=pageMatches.length;
 state.storyTotal=state.stories.length;
 state.wordCount=state.stories.reduce((n,s)=>n+plainStoryText(s.text).trim().split(/\s+/).filter(Boolean).length,0);
 state.textSamples=state.stories.map(s=>plainStoryText(s.text)).filter(t=>t.trim()).slice(0,Math.max(1,state.pageTotal));
}
function plainStoryText(xml){
 return [...xml.matchAll(/<Content>([\s\S]*?)<\/Content>/g)].map(m=>decodeXml(m[1].replace(/<[^>]+>/g,''))).join(' ').replace(/\s+/g,' ').trim();
}
function renderDocument(){
 $('#docName').textContent=state.file.name;
 $('#pageCount').textContent=state.pageTotal+' pages';
 $('#healthBadge').textContent='Analysed';
 $('#stats').innerHTML=[
  ['Pages',state.pageTotal],['Stories',state.storyTotal],['Words',state.wordCount.toLocaleString()],['Styles',state.styles.length]
 ].map(([l,v])=>`<div class="stat"><strong>${v}</strong><span>${l}</span></div>`).join('');
 $('#fontList').innerHTML=(state.fonts.length?state.fonts:['No explicit font names found']).map(x=>`<span class="chip">${escapeHtml(x)}</span>`).join('');
 $('#styleList').innerHTML=(state.styles.length?state.styles:['No named styles found']).map(x=>`<div>${escapeHtml(x)}</div>`).join('');
 const count=Math.max(1,state.pageTotal);
 $('#pageGrid').innerHTML=Array.from({length:count},(_,i)=>{
   const t=state.textSamples[i%Math.max(1,state.textSamples.length)]||'Printworks found the page structure, but no readable story text was associated with this preview.';
   const words=t.split(' '); const head=words.slice(0,Math.min(7,words.length)).join(' ');
   const body=words.slice(7,30).join(' ');
   return `<article class="page-card"><span class="page-num">${i+1}</span><h4>${escapeHtml(head||'Page '+(i+1))}</h4><p>${escapeHtml(body)}</p><div class="page-lines"><i></i><i></i><i></i></div></article>`;
 }).join('');
}
async function getPdfJs(){\n if(window.pdfjsLib)return window.pdfjsLib;\n const mod=await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs');\n mod.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';\n return mod;\n}\nasync function handlePDF(file){\n if(!file)return;\n if(!file.name.toLowerCase().endsWith('.pdf'))return alert('Please choose a PDF file.');\n try{\n  $('#pdfBtn').disabled=true;$('#pdfBtn').textContent='Rendering…';\n  const pdfjs=await getPdfJs();\n  const data=new Uint8Array(await file.arrayBuffer());\n  const doc=await pdfjs.getDocument({data}).promise;\n  state.pdfFile=file;state.pdfDoc=doc;\n  $('#pdfStatus').classList.remove('hidden');\n  const mismatch=state.pageTotal&&doc.numPages!==state.pageTotal;\n  $('#pdfStatus').innerHTML=`<strong>PDF preview:</strong> ${escapeHtml(file.name)} · ${doc.numPages} pages${mismatch?` <span class="warn">IDML has ${state.pageTotal} pages, so page matching may differ.</span>`:''}`;\n  $('#pdfBtn').textContent='Replace PDF';\n  await renderPdfGrid();\n }catch(err){console.error(err);alert('Printworks could not render this PDF. '+err.message);$('#pdfBtn').textContent='Add PDF preview'}\n finally{$('#pdfBtn').disabled=false}\n}\nasync function renderPdfGrid(){\n if(!state.pdfDoc)return;\n const grid=$('#pageGrid');grid.innerHTML='';\n for(let i=1;i<=state.pdfDoc.numPages;i++){\n  const card=document.createElement('button');card.className='pdf-page-card';card.type='button';card.innerHTML=`<span class="pdf-page-label">Page ${i}</span><canvas></canvas>`;grid.appendChild(card);\n  card.onclick=()=>openPdfPage(i);\n  const page=await state.pdfDoc.getPage(i);const base=page.getViewport({scale:1});const target=210;const scale=target/base.width;const viewport=page.getViewport({scale});\n  const canvas=card.querySelector('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);\n  await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;\n }\n $('#pageCount').textContent=state.pdfDoc.numPages+' PDF pages';\n}\nasync function openPdfPage(num){\n if(!state.pdfDoc)return;\n const box=$('#lightbox'),canvas=$('#lightboxCanvas');box.classList.remove('hidden');box.setAttribute('aria-hidden','false');$('#lightboxCaption').textContent='Page '+num+' · '+state.pdfFile.name;\n const page=await state.pdfDoc.getPage(num);const base=page.getViewport({scale:1});const maxW=Math.min(window.innerWidth-100,1100),maxH=window.innerHeight-130;const scale=Math.min(maxW/base.width,maxH/base.height,2);const viewport=page.getViewport({scale});\n canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;\n}\nfunction closeLightbox(){const box=$('#lightbox');box.classList.add('hidden');box.setAttribute('aria-hidden','true')}\nfunction renderMoods(){
 $('#moodGrid').innerHTML=moods.map(m=>`<article class="mood-card ${m.class}" data-id="${m.id}">
  <div class="mood-sample"><div><div class="mood-kicker">PRINTWORKS / ${m.name}</div><div class="mood-head">${m.sample}</div><div class="mood-body">${m.bodySample}</div></div></div>
  <div class="mood-meta"><strong>${m.name}</strong><span>${m.head} · ${m.body}</span></div>
 </article>`).join('');
 document.querySelectorAll('.mood-card').forEach(el=>el.onclick=()=>selectMood(el.dataset.id));
}
function selectMood(id){
 state.selected=moods.find(m=>m.id===id);
 document.querySelectorAll('.mood-card').forEach(x=>x.classList.toggle('selected',x.dataset.id===id));
 $('#selectedTitle').textContent=state.selected.name;
 $('#selectedDescription').textContent=state.selected.desc;
 $('#exportPanel').classList.remove('hidden');
 $('#exportPanel').scrollIntoView({behavior:'smooth',block:'nearest'});
}
function escAttr(s){return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;')}
function makeParagraphStyle(name,s){
 return `<ParagraphStyle Self="ParagraphStyle/PW_${name}" Name="PW ${name}" Imported="false" NextStyle="ParagraphStyle/$ID/[No paragraph style]" AppliedFont="${escAttr(s.font)}" FontStyle="${escAttr(s.style)}" PointSize="${s.size}" Leading="${s.leading}"><Properties><BasedOn type="string">$ID/[No paragraph style]</BasedOn></Properties></ParagraphStyle>`;
}
function addPrintworksStyles(xml,m){
 const block=`<ParagraphStyleGroup Self="ParagraphStyleGroup/Printworks" Name="Printworks"><Properties></Properties>${makeParagraphStyle('Headline',m.headStyle)}${makeParagraphStyle('Body',m.bodyStyle)}${makeParagraphStyle('Label',m.labelStyle)}</ParagraphStyleGroup>`;
 if(xml.includes('ParagraphStyleGroup/Printworks')){
   return xml.replace(/<ParagraphStyleGroup Self="ParagraphStyleGroup\/Printworks"[\s\S]*?<\/ParagraphStyleGroup>/,block);
 }
 const pos=xml.lastIndexOf('</idPkg:Styles>');
 return pos>=0?xml.slice(0,pos)+block+xml.slice(pos):xml;
}
function detectStyleTargets(){
 const low=state.styles.map(x=>({name:x,l:x.toLowerCase()}));
 const head=low.find(x=>/(title|heading|headline|head 1|h1)/.test(x.l))?.name;
 const body=low.find(x=>/(body|body text|normal|copy|paragraph)/.test(x.l))?.name;
 const label=low.find(x=>/(caption|label|small|folio|running)/.test(x.l))?.name;
 return {head,body,label};
}
function applyStoryStyles(xml,targets){
 let out=xml;
 const swaps=[[targets.head,'ParagraphStyle/PW_Headline'],[targets.body,'ParagraphStyle/PW_Body'],[targets.label,'ParagraphStyle/PW_Label']];
 for(const [oldName,newId] of swaps){
  if(!oldName)continue;
  const oldId='ParagraphStyle/'+oldName;
  out=out.split('AppliedParagraphStyle="'+oldId+'"').join('AppliedParagraphStyle="'+newId+'"');
 }
 return out;
}
async function exportIDML(){
 if(!state.zip||!state.selected)return;
 try{
  $('#exportBtn').disabled=true;$('#exportBtn').textContent='Building…';
  const out=new JSZip();
  const entries=Object.values(state.zip.files);
  const targets=detectStyleTargets();
  for(const f of entries){
    if(f.dir){out.folder(f.name);continue}
    if(f.name==='Resources/Styles.xml'){
      out.file(f.name,addPrintworksStyles(await f.async('string'),state.selected));
    }else if($('#applyStyles').checked&&f.name.startsWith('Stories/')&&f.name.endsWith('.xml')){
      out.file(f.name,applyStoryStyles(await f.async('string'),targets));
    }else{
      out.file(f.name,await f.async('uint8array'));
    }
  }
  const blob=await out.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6}});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download=state.file.name.replace(/\.idml$/i,'')+'-printworks-'+state.selected.id+'.idml';
  document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),2000);
 }catch(err){console.error(err);alert('Could not create the revised IDML: '+err.message)}
 finally{$('#exportBtn').disabled=false;$('#exportBtn').textContent='Create new IDML'}
}
function escapeHtml(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}
document.addEventListener('DOMContentLoaded',init);
