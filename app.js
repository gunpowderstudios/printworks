const $=s=>document.querySelector(s);
const state={zip:null,file:null,stylesXml:null,designMap:null,stories:[],spreads:[],fonts:[],styles:[],styleDefs:[],styleRoles:{},styleMasters:{},selected:null,pdfFile:null,pdfDoc:null,pageText:{},activePage:null};

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
 $('#exportBtn').onclick=exportIDML;
 $('#autoStyleBtn').onclick=()=>{
   const btn=$('#autoStyleBtn');
   const count=autoAssignStyleRoles(true);
   renderStyleLab();
   btn.textContent=count?'Auto tidy · '+count+' assigned':'No matches found';
   setTimeout(()=>btn.textContent='Auto tidy',1800);
 };
 $('#tidyExportBtn').onclick=exportTidiedIDML;
 $('#pdfBtn').onclick=()=>$('#pdfInput').click();
 $('#pdfInput').onchange=e=>handlePDF(e.target.files[0]);
 $('#lightboxClose').onclick=closeLightbox;
 $('#lightbox').onclick=e=>{if(e.target.id==='lightbox')closeLightbox()};
 document.addEventListener('keydown',e=>{if(e.key==='Escape')closeLightbox()});
 renderMoods();
}
async function handleFile(file){
 if(!file)return;
 if(!file.name.toLowerCase().endsWith('.idml'))return alert('Version 1.3 currently accepts IDML files, with an optional companion PDF.');
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
 const all=[state.stylesXml,...state.stories.map(x=>x.text)].join('\\n');
 state.fonts=uniq([...attrValues(all,'AppliedFont'),...attrValues(all,'FontFamily')]).filter(x=>!/^\$ID/.test(x)).slice(0,40);
 state.styleDefs=parseParagraphStyles(state.stylesXml);
 state.styles=state.styleDefs.map(x=>x.name).slice(0,80);
 autoAssignStyleRoles(false);
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
 renderStyleLab();
 const count=Math.max(1,state.pageTotal);
 $('#pageGrid').innerHTML=Array.from({length:count},(_,i)=>{
   const t=state.textSamples[i%Math.max(1,state.textSamples.length)]||'Printworks found the page structure, but no readable story text was associated with this preview.';
   const words=t.split(' '); const head=words.slice(0,Math.min(7,words.length)).join(' ');
   const body=words.slice(7,30).join(' ');
   return `<article class="page-card"><span class="page-num">${i+1}</span><h4>${escapeHtml(head||'Page '+(i+1))}</h4><p>${escapeHtml(body)}</p><div class="page-lines"><i></i><i></i><i></i></div></article>`;
 }).join('');
}

const STYLE_ROLES=[
 {id:'none',label:'— Leave alone —'},
 {id:'card-heading',label:'Card Heading'},
 {id:'item-heading',label:'Item Heading'},
 {id:'item-description',label:'Item Description'},
 {id:'body',label:'Body'},
 {id:'caption',label:'Caption'},
 {id:'rules-note',label:'Rules Note'},
 {id:'section-heading',label:'Section Heading'}
];
function parseParagraphStyles(xml){
 try{
  const doc=new DOMParser().parseFromString(xml,'application/xml');
  return [...doc.getElementsByTagName('ParagraphStyle')].map(n=>({
    self:n.getAttribute('Self')||'',
    name:n.getAttribute('Name')||'Unnamed Style',
    font:n.getAttribute('AppliedFont')||'',
    fontStyle:n.getAttribute('FontStyle')||'Regular',
    size:n.getAttribute('PointSize')||'',
    leading:n.getAttribute('Leading')||'',
    basedOn:[...n.getElementsByTagName('BasedOn')][0]?.textContent||''
  })).filter(s=>s.name!=='[No Paragraph Style]'&&s.name!=='[Basic Paragraph]');
 }catch(e){console.warn('Could not parse paragraph styles',e);return []}
}
function guessStyleRole(style){
 const n=String(style.name||'').toLowerCase().replace(/[_-]+/g,' ');
 const size=Number(style.size)||0;
 const bold=/bold|black|heavy|semibold|demi/i.test(style.fontStyle||'');
 if(/card.*(head|heading|title|name)|(head|heading|title|name).*card/.test(n))return 'card-heading';
 if(/item.*(head|heading|title|name)|(head|heading|title|name).*item/.test(n))return 'item-heading';
 if(/item.*(desc|description|copy|text)|description|flavour|flavor/.test(n))return 'item-description';
 if(/caption|folio|credit|footer|small|figure|fig\.?/.test(n))return 'caption';
 if(/rule.*note|note|tip|warning|callout|important|remember|example/.test(n))return 'rules-note';
 if(/section|chapter|subhead|sub head|heading ?[123]|head ?[123]|^heading$|^title$|main head/.test(n))return 'section-heading';
 if(/body|normal|copy|paragraph|para|main text|body text|rules text|description text/.test(n))return 'body';
 if(size>=18&&bold)return 'section-heading';
 if(size>=13&&bold)return 'item-heading';
 if(size>0&&size<=9)return 'caption';
 return 'none';
}
function autoAssignStyleRoles(reset){
 if(reset){
   state.styleRoles={};
   state.styleMasters={};
 }
 let assignedCount=0;
 for(const s of state.styleDefs){
  if(reset||!state.styleRoles[s.self]){
    const role=guessStyleRole(s);
    state.styleRoles[s.self]=role;
    if(role!=='none')assignedCount++;
  }
 }
 for(const role of STYLE_ROLES.filter(r=>r.id!=='none')){
  const assigned=state.styleDefs.filter(s=>state.styleRoles[s.self]===role.id);
  if(assigned.length){
    const best=[...assigned].sort((a,b)=>(Number(b.size)||0)-(Number(a.size)||0))[0];
    state.styleMasters[role.id]=best.self;
  }
 }
 return assignedCount;
}
function stylePreviewText(role){
 return ({
  'card-heading':'TREASURE CARD',
  'item-heading':'Ancient Lantern',
  'item-description':'A useful item found deep inside the dungeon.',
  'body':'Move your hero through the dungeon and follow the rules shown here.',
  'caption':'Example / Figure 01',
  'rules-note':'Remember: resolve traps before moving again.',
  'section-heading':'Combat & Encounters'
 })[role]||'Aa Typography';
}
function renderStyleLab(){
 const list=$('#styleLabList');if(!list)return;
 if(!state.styleDefs.length){list.innerHTML='<div class="style-empty">No paragraph styles found in this IDML.</div>';$('#styleLabSummary').textContent='No paragraph styles found';return}
 const groupedCount=Object.values(state.styleRoles).filter(x=>x&&x!=='none').length;
 $('#styleLabSummary').textContent=state.styleDefs.length+' paragraph styles · '+groupedCount+' assigned';
 list.innerHTML=state.styleDefs.map((s,i)=>{
  const role=state.styleRoles[s.self]||'none';
  const master=role!=='none'&&state.styleMasters[role]===s.self;
  const options=STYLE_ROLES.map(r=>`<option value="${r.id}" ${r.id===role?'selected':''}>${r.label}</option>`).join('');
  const meta=[s.font,s.fontStyle,s.size?Number(s.size)+' pt':'',s.leading&&s.leading!=='Auto'?s.leading+' lead':''].filter(Boolean).join(' · ');
  return `<div class="style-row" data-self="${escapeHtml(s.self)}">
    <select class="style-role-select" data-self="${escapeHtml(s.self)}">${options}</select>
    <div class="style-name"><strong>${escapeHtml(s.name)}</strong><small>${escapeHtml(s.self)}</small></div>
    <div class="style-type-preview" style="${inlineStylePreview(s)}"><span>${escapeHtml(stylePreviewText(role))}</span><small>${escapeHtml(meta||'Inherited settings')}</small></div>
    <label class="master-choice"><input type="radio" name="master-${escapeHtml(role)}" data-role="${escapeHtml(role)}" data-self="${escapeHtml(s.self)}" ${master?'checked':''} ${role==='none'?'disabled':''}><span>Master</span></label>
  </div>`;
 }).join('');
 document.querySelectorAll('.style-role-select').forEach(sel=>sel.onchange=()=>{
   const self=sel.dataset.self,old=state.styleRoles[self]||'none',role=sel.value;
   state.styleRoles[self]=role;
   if(old!=='none'&&state.styleMasters[old]===self)delete state.styleMasters[old];
   if(role!=='none'&&!state.styleMasters[role])state.styleMasters[role]=self;
   renderStyleLab();
 });
 document.querySelectorAll('.master-choice input').forEach(r=>r.onchange=()=>{if(r.checked&&r.dataset.role!=='none'){state.styleMasters[r.dataset.role]=r.dataset.self;renderStyleLab()}});
}
function inlineStylePreview(s){
 const css=[];
 if(s.font)css.push("font-family:'"+String(s.font).replace(/'/g,"\\'")+"',sans-serif");
 if(/bold|black|heavy|semibold/i.test(s.fontStyle))css.push('font-weight:700');
 if(/italic|oblique/i.test(s.fontStyle))css.push('font-style:italic');
 const size=Math.max(13,Math.min(25,Number(s.size)||16));css.push('font-size:'+size+'px');
 return css.join(';');
}
function cleanRoleName(role){return STYLE_ROLES.find(r=>r.id===role)?.label||role}
function canonicalStyleId(role){return 'ParagraphStyle/PW_Clean_'+role.replace(/[^a-z0-9]+/gi,'_')}
function buildCanonicalStyle(role,master){
 const id=canonicalStyleId(role),name='PW '+cleanRoleName(role);
 return `<ParagraphStyle Self="${escAttr(id)}" Name="${escAttr(name)}" Imported="false" NextStyle="ParagraphStyle/$ID/[No paragraph style]"${master.font?` AppliedFont="${escAttr(master.font)}"`:''}${master.fontStyle?` FontStyle="${escAttr(master.fontStyle)}"`:''}${master.size?` PointSize="${escAttr(master.size)}"`:''}${master.leading?` Leading="${escAttr(master.leading)}"`:''}><Properties><BasedOn type="string">$ID/[No paragraph style]</BasedOn></Properties></ParagraphStyle>`;
}
function buildCleanStyleGroup(xml){
 const roles=STYLE_ROLES.filter(r=>r.id!=='none').map(r=>r.id).filter(role=>state.styleDefs.some(s=>state.styleRoles[s.self]===role));
 if(!roles.length)return xml;
 const styles=roles.map(role=>{
  const candidates=state.styleDefs.filter(s=>state.styleRoles[s.self]===role);
  const master=candidates.find(s=>s.self===state.styleMasters[role])||candidates[0];
  return buildCanonicalStyle(role,master);
 }).join('');
 const block=`<ParagraphStyleGroup Self="ParagraphStyleGroup/Printworks_Clean" Name="Printworks Clean Styles"><Properties></Properties>${styles}</ParagraphStyleGroup>`;
 const existing=/<ParagraphStyleGroup Self="ParagraphStyleGroup\/Printworks_Clean"[\s\S]*?<\/ParagraphStyleGroup>/;
 if(existing.test(xml))return xml.replace(existing,block);
 const pos=xml.lastIndexOf('</idPkg:Styles>');
 return pos>=0?xml.slice(0,pos)+block+xml.slice(pos):xml;
}
function remapAllStyleReferences(xml){
 let out=xml;
 for(const s of state.styleDefs){
  const role=state.styleRoles[s.self];
  if(!role||role==='none')continue;
  out=out.split(s.self).join(canonicalStyleId(role));
 }
 return out;
}
function escapeRegExp(s){
 return String(s).replace(/[.*+?^$()|[\]\\]/g,'\\$&');
}
function removeUnifiedStyleDefinitions(xml){
 let out=xml;
 for(const s of state.styleDefs){
  const role=state.styleRoles[s.self];
  if(!role||role==='none')continue;
  const id=escapeRegExp(s.self);
  const rx=new RegExp('<ParagraphStyle\\b(?=[^>]*\\bSelf="'+id+'")[^>]*(?:\\/>|>[\\s\\S]*?<\\/ParagraphStyle>)','g');
  out=out.replace(rx,'');
 }
 return out;
}
async function exportTidiedIDML(){
 if(!state.zip)return;
 const assigned=state.styleDefs.filter(s=>state.styleRoles[s.self]&&state.styleRoles[s.self]!=='none');
 if(!assigned.length)return alert('Assign at least one existing style to a Style Lab role first.');
 try{
  $('#tidyExportBtn').disabled=true;$('#tidyExportBtn').textContent='Tidying…';
  const out=new JSZip();
  for(const f of Object.values(state.zip.files)){
   if(f.dir){out.folder(f.name);continue}
   if(f.name.endsWith('.xml')){
    let xml=await f.async('string');
    xml=remapAllStyleReferences(xml);
    if(f.name==='Resources/Styles.xml')xml=buildCleanStyleGroup(removeUnifiedStyleDefinitions(xml));
    out.file(f.name,xml);
   }else out.file(f.name,await f.async('uint8array'));
  }
  const blob=await out.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6}});
  const link=document.createElement('a');link.href=URL.createObjectURL(blob);
  link.download=state.file.name.replace(/\.idml$/i,'')+'-printworks-tidied.idml';
  document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(link.href),2000);
 }catch(err){console.error(err);alert('Could not create the tidied IDML: '+err.message)}
 finally{$('#tidyExportBtn').disabled=false;$('#tidyExportBtn').textContent='Create tidied IDML'}
}

async function getPdfJs(){
 if(window.pdfjsLib)return window.pdfjsLib;
 const mod=await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs');
 mod.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
 return mod;
}
async function handlePDF(file){
 if(!file)return;
 if(!file.name.toLowerCase().endsWith('.pdf'))return alert('Please choose a PDF file.');
 try{
  $('#pdfBtn').disabled=true;$('#pdfBtn').textContent='Rendering…';
  const pdfjs=await getPdfJs();
  const data=new Uint8Array(await file.arrayBuffer());
  const doc=await pdfjs.getDocument({data}).promise;
  state.pdfFile=file;state.pdfDoc=doc;
  $('#pdfStatus').classList.remove('hidden');
  const mismatch=state.pageTotal&&doc.numPages!==state.pageTotal;
  $('#pdfStatus').innerHTML=`<strong>PDF preview:</strong> ${escapeHtml(file.name)} · ${doc.numPages} pages${mismatch?` <span class="warn">IDML has ${state.pageTotal} pages, so page matching may differ.</span>`:''}`;
  $('#pdfBtn').textContent='Replace PDF';
  await renderPdfGrid();
 }catch(err){console.error(err);alert('Printworks could not render this PDF. '+err.message);$('#pdfBtn').textContent='Add PDF preview'}
 finally{$('#pdfBtn').disabled=false}
}
async function renderPdfGrid(){
 if(!state.pdfDoc)return;
 const grid=$('#pageGrid');grid.innerHTML='';
 for(let i=1;i<=state.pdfDoc.numPages;i++){
  const card=document.createElement('button');card.className='pdf-page-card';card.type='button';card.innerHTML=`<span class="pdf-page-label">Page ${i}</span><canvas></canvas>`;grid.appendChild(card);
  card.onclick=()=>openPageLab(i);
  const page=await state.pdfDoc.getPage(i);const base=page.getViewport({scale:1});const target=210;const scale=target/base.width;const viewport=page.getViewport({scale});
  const canvas=card.querySelector('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
  await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
 }
 $('#pageCount').textContent=state.pdfDoc.numPages+' PDF pages';
}
async function extractPdfPageText(num){
 if(state.pageText[num])return state.pageText[num];
 const page=await state.pdfDoc.getPage(num);
 const content=await page.getTextContent();
 const items=content.items.filter(x=>x.str&&x.str.trim());
 const lines=[];
 let current=[],lastY=null;
 for(const item of items){
  const y=Math.round(item.transform?.[5]||0);
  if(lastY!==null&&Math.abs(y-lastY)>4&&current.length){lines.push(current.join(' ').replace(/\s+/g,' ').trim());current=[]}
  current.push(item.str);lastY=y;
 }
 if(current.length)lines.push(current.join(' ').replace(/\s+/g,' ').trim());
 const clean=lines.filter(Boolean);
 state.pageText[num]=clean;
 return clean;
}
function inferPageHierarchy(lines){
 const cleaned=lines.map(x=>x.trim()).filter(Boolean);
 if(!cleaned.length)return {kicker:'PAGE',headline:'No text detected',body:'This PDF page may contain outlined text or image-only artwork.'};
 const short=cleaned.filter(x=>x.length>=3&&x.length<=90);
 let headline=short.find(x=>x.split(/\s+/).length<=12) || cleaned[0];
 const kicker=cleaned.find(x=>x!==headline&&x.length<45&&x.toUpperCase()===x&&/[A-Z]/.test(x)) || 'PAGE';
 const body=cleaned.filter(x=>x!==headline&&x!==kicker).join(' ').replace(/\s+/g,' ').trim().slice(0,700) || cleaned.slice(1).join(' ').slice(0,700);
 return {kicker,headline,body};
}
async function openPageLab(num){
 if(!state.pdfDoc)return;
 state.activePage=num;
 const lab=$('#pageLab');lab.classList.remove('hidden');
 $('#pageLabTitle').textContent='Page '+num+' typography';
 const page=await state.pdfDoc.getPage(num);
 const canvas=$('#pageLabOriginal');
 const base=page.getViewport({scale:1});
 const target=420;const scale=Math.min(target/base.width,1.4);const viewport=page.getViewport({scale});
 canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
 await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
 const lines=await extractPdfPageText(num);
 renderPageTreatments(inferPageHierarchy(lines));
 lab.scrollIntoView({behavior:'smooth',block:'start'});
}
function renderPageTreatments(content){
 $('#pageTreatmentGrid').innerHTML=moods.map(m=>`<button class="page-treatment ${m.class} ${state.selected?.id===m.id?'selected':''}" data-id="${m.id}" type="button">
   <div class="page-treatment-kicker">${escapeHtml(content.kicker)}</div>
   <div class="page-treatment-head">${escapeHtml(content.headline)}</div>
   <div class="page-treatment-body">${escapeHtml(content.body)}</div>
   <div class="page-treatment-footer"><strong>${m.name}</strong><span>${m.head} · ${m.body}</span></div>
 </button>`).join('');
 document.querySelectorAll('.page-treatment').forEach(el=>el.onclick=()=>{selectMood(el.dataset.id);renderPageTreatments(content)});
}
async function openPdfPage(num){
 if(!state.pdfDoc)return;
 const box=$('#lightbox'),canvas=$('#lightboxCanvas');box.classList.remove('hidden');box.setAttribute('aria-hidden','false');$('#lightboxCaption').textContent='Page '+num+' · '+state.pdfFile.name;
 const page=await state.pdfDoc.getPage(num);const base=page.getViewport({scale:1});const maxW=Math.min(window.innerWidth-100,1100),maxH=window.innerHeight-130;const scale=Math.min(maxW/base.width,maxH/base.height,2);const viewport=page.getViewport({scale});
 canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
}
function closeLightbox(){const box=$('#lightbox');box.classList.add('hidden');box.setAttribute('aria-hidden','true')}
function renderMoods(){
 $('#moodGrid').innerHTML=moods.map(m=>`<article class="mood-card ${m.class}" data-id="${m.id}">
  <div class="mood-sample"><div><div class="mood-kicker">PRINTWORKS / ${m.name}</div><div class="mood-head">${m.sample}</div><div class="mood-body">${m.bodySample}</div></div></div>
  <div class="mood-meta"><strong>${m.name}</strong><span>${m.head} · ${m.body}</span></div>
 </article>`).join('');
 document.querySelectorAll('.mood-card').forEach(el=>el.onclick=()=>selectMood(el.dataset.id));
}
function selectMood(id){
 state.selected=moods.find(m=>m.id===id);
 document.querySelectorAll('.mood-card').forEach(x=>x.classList.toggle('selected',x.dataset.id===id));
 document.querySelectorAll('.page-treatment').forEach(x=>x.classList.toggle('selected',x.dataset.id===id));
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
