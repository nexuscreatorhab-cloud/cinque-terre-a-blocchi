// Editor delle facciate: accesso con email, profilo, proposte per ogni casa, foto.
// Tutto il testo che arriva dal database viene inserito con textContent, mai come HTML.
(function(){
const CFG=window.CONFIG;
const sb=supabase.createClient(CFG.supabaseUrl,CFG.supabaseKey,{auth:{flowType:"pkce",persistSession:true,detectSessionInUrl:true}});
const ed=document.getElementById("ed"),bEdit=document.getElementById("bEdit"),toastEl=document.getElementById("toast");
const CAMPI=[
  ["facciata","Colore della facciata"],["persiane_colore","Colore delle persiane"],["persiane_stato","Persiane aperte o chiuse"],
  ["persiane_condizione","Stato delle persiane"],["tetto","Tetto"],["piani","Numero di piani"],["piano_terra","Piano terra"],
  ["balconi","Balconi"],["fiori","Fiori"],["cornici","Cornici delle finestre"],["panni","Panni stesi"],["lampione","Lampione"],["decorazioni","Decorazioni"],
  ["portone_colore","Colore del portone"],["portone_forma","Forma del portone"],["portone_contorno","Contorno del portone"],["sopraluce","Sopra il portone"],
  ["ringhiera_colore","Colore della ringhiera"],["edicola","Edicola votiva"],["scala_esterna","Scala esterna"],["pergolato","Pergolato"],["insegna","Insegna"]];
// un campo compare solo se il catalogo ha almeno un valore per lui
const STATO_FOTO={nessuna:"senza foto",in_attesa:"foto in controllo",ok:"foto approvata ✓",ko:"foto da rifare"};
// arrivo dal link dell'email: apro subito l'editor
let daLink=/[?&]code=/.test(location.search);
let user=null,profilo=null,catalogo={},ufficiali={},mie={},vista="mio",casa=null,bozza={},foto=null;

// ---------- piccoli aiuti per costruire il pannello ----------
function el(tag,attrs={},...kids){const e=document.createElement(tag);for(const k in attrs){const v=attrs[k];if(k==="on")for(const ev in v)e.addEventListener(ev,v[ev]);else if(k==="text")e.textContent=v;else if(v!==false&&v!=null)e.setAttribute(k,v===true?"":v)}for(const c of kids)if(c!=null)e.append(c);return e}
function panel(kicker,title,...body){ed.replaceChildren(el("div",{class:"top"},el("span",{class:"k",text:kicker}),el("button",{id:"eX","aria-label":"Chiudi",text:"✕",on:{click:chiudiPannello}})),el("h2",{text:title}),...body);ed.hidden=false;document.body.classList.add("edopen")}
function chiudiPannello(){ed.hidden=true;document.body.classList.remove("edopen");casa=null;MONDO.highlight(null)}
function msg(t,kind){return el("p",{class:"msg "+(kind||""),text:t})}
let tt;function toast(t){toastEl.textContent=t;toastEl.hidden=false;clearTimeout(tt);tt=setTimeout(()=>toastEl.hidden=true,3500)}
const label=(campo,valore)=>{const c=(catalogo[campo]||[]).find(o=>o.valore===valore);return c?c.etichetta:valore};

// ---------- dati ----------
async function caricaCatalogo(){const {data,error}=await sb.from("catalogo").select("campo,valore,etichetta,ordine").order("ordine");if(error)throw error;catalogo={};for(const r of data)(catalogo[r.campo]||=[]).push(r)}
async function caricaUfficiali(){const {data,error}=await sb.from("schede_ufficiali").select("edificio,campo,valore").eq("borgo",CFG.borgo);if(error)throw error;ufficiali={};for(const r of data)(ufficiali[r.edificio]||={})[r.campo]=r.valore}
async function caricaMie(){mie={};if(!user)return;const {data,error}=await sb.from("proposte").select("id,edificio,campo,valore,stato_foto").eq("borgo",CFG.borgo);if(error)throw error;for(const r of data)(mie[r.edificio]||={})[r.campo]=r}
async function caricaProfilo(){profilo=null;if(!user)return;const {data}=await sb.from("profili").select("soprannome,anno_nascita,stato_consenso,livello").eq("id",user.id).maybeSingle();profilo=data}
function ridisegna(){const ov={};for(const k in ufficiali)ov[k]={...ufficiali[k]};
  if(vista==="mio")for(const k in mie){ov[k]||={};for(const c in mie[k])ov[k][c]=mie[k][c].valore}
  MONDO.apply(ov)}

// ---------- pannelli ----------
function pannelloIntro(){
  if(!user)return pannelloLogin();
  if(!profilo)return pannelloProfilo();
  if(profilo.stato_consenso==="in_attesa")return panel("Segna le facciate","Serve un genitore",msg("Hai meno di 14 anni: per partecipare serve l'ok di un genitore. Stiamo preparando il modulo per i genitori, torna presto!"),el("div",{class:"rowb"},el("button",{class:"ghost",text:"Il mio account",on:{click:pannelloAccount}})));
  panel("Segna le facciate","Ciao "+profilo.soprannome+"!",
    el("p",{text:"Tocca una casa per dire com'è davvero: colori, persiane, tetto, balconi e altri dettagli. Scatta una foto della facciata, senza persone."}),
    el("p",{class:"small",text:"Le tue scelte le vedi subito nel tuo paese. Diventano ufficiali per tutti quando almeno 5 persone dicono la stessa cosa e una foto è stata approvata."}),
    vistaSwitch(),
    el("div",{class:"rowb"},el("button",{class:"ghost",text:"Il mio account",on:{click:pannelloAccount}})))}

function vistaSwitch(){const mk=(v,t)=>el("button",{"aria-pressed":String(vista===v),text:t,on:{click:()=>{vista=v;ridisegna();if(casa)pannelloCasa(casa);else pannelloIntro()}}});
  return el("div",{class:"field"},el("div",{class:"h"},el("b",{text:"Cosa vedo"})),el("div",{class:"opts"},mk("mio","Il mio paese"),mk("ufficiale","Paese ufficiale")))}

function pannelloLogin(){
  if(CFG.anteprima)return panel("Anteprima","Accesso spento",el("p",{text:"Questa è un'anteprima per provare il paese. L'accesso con email e il salvataggio funzionano sul sito vero."}));
  const email=el("input",{type:"email",autocomplete:"email",required:true,placeholder:"nome@esempio.it"});
  const ok=el("input",{type:"checkbox"});
  const out=el("div");
  const invia=el("button",{class:"act",text:"Mandami il link",on:{click:async()=>{
    if(!email.checkValidity()){out.replaceChildren(msg("Scrivi un'email valida.","ko"));return}
    if(!ok.checked){out.replaceChildren(msg("Per continuare spunta l'informativa privacy.","ko"));return}
    invia.disabled=true;
    const {error}=await sb.auth.signInWithOtp({email:email.value.trim(),options:{emailRedirectTo:location.origin+location.pathname,shouldCreateUser:true}});
    invia.disabled=false;
    out.replaceChildren(error?msg("Non sono riuscito a mandare l'email. Riprova tra qualche minuto.","ko"):msg("Fatto! Apri l'email che ti abbiamo mandato e tocca il link: tornerai qui già dentro.","ok"))}}});
  panel("Segna le facciate","Entra con la tua email",
    el("p",{text:"Ti mandiamo un link per entrare, senza password. Usiamo l'email solo per farti accedere."}),
    el("label",{},"Email",email),
    el("label",{class:"check"},ok,el("span",{},"Ho letto l'",el("a",{href:"privacy.html",target:"_blank",rel:"noopener",text:"informativa privacy"}))),
    el("div",{class:"rowb"},invia),out)}

function pannelloProfilo(){
  const nick=el("input",{maxlength:"20",autocomplete:"nickname",placeholder:"es. gabbiano_77"});
  const anno=el("input",{type:"number",inputmode:"numeric",min:"1920",max:String(new Date().getFullYear()-6),placeholder:"es. 2009"});
  const out=el("div");
  const salva=el("button",{class:"act",text:"Crea il profilo",on:{click:async()=>{
    if(!/^[A-Za-z0-9_À-ÿ]{3,20}$/.test(nick.value)){out.replaceChildren(msg("Il soprannome deve avere da 3 a 20 lettere o numeri, senza spazi. Non usare il tuo nome vero.","ko"));return}
    const a=parseInt(anno.value,10);if(!(a>=1920&&a<=new Date().getFullYear()-6)){out.replaceChildren(msg("Scrivi un anno di nascita valido.","ko"));return}
    salva.disabled=true;
    const {error}=await sb.from("profili").insert({soprannome:nick.value,anno_nascita:a});
    salva.disabled=false;
    if(error){out.replaceChildren(msg(error.code==="23505"?"Questo soprannome è già preso, scegline un altro.":"Non sono riuscito a creare il profilo.","ko"));return}
    await caricaProfilo();pannelloIntro()}}});
  panel("Segna le facciate","Il tuo profilo",
    el("p",{text:"In pubblico si vede solo il soprannome. L'anno di nascita serve solo a capire se serve l'ok di un genitore."}),
    el("label",{},"Soprannome",nick),el("label",{},"Anno di nascita",anno),el("div",{class:"rowb"},salva),out)}

function pannelloAccount(){
  if(!user)return pannelloLogin();
  const out=el("div");let conferma=false;
  const canc=el("button",{class:"ghost",text:"Cancella il mio account",on:{click:async()=>{
    if(!conferma){conferma=true;canc.textContent="Sicuro? Tocca di nuovo per cancellare tutto";return}
    canc.disabled=true;const {error}=await sb.rpc("cancella_account");
    if(error){canc.disabled=false;out.replaceChildren(msg("Non sono riuscito a cancellare l'account. Riprova.","ko"));return}
    await sb.auth.signOut();toast("Account cancellato. Ciao!");chiudiPannello()}}});
  panel("Il mio account",profilo?profilo.soprannome:"Account",
    profilo?el("p",{},"Livello ",el("span",{class:"badge",text:String(profilo.livello)})):null,
    el("div",{class:"rowb"},
      el("button",{class:"ghost",text:"Scarica i miei dati",on:{click:scaricaDati}}),
      el("button",{class:"ghost",text:"Esci",on:{click:async()=>{await sb.auth.signOut();chiudiPannello();toast("Sei uscito.")}}})),
    el("div",{class:"rowb"},canc),out,
    el("div",{class:"rowb"},el("button",{class:"ghost",text:"← Indietro",on:{click:pannelloIntro}})))}

async function scaricaDati(){
  const [p,q,n]=await Promise.all([sb.from("profili").select("*"),sb.from("proposte").select("*"),sb.from("note").select("*")]);
  const blob=new Blob([JSON.stringify({profilo:p.data,proposte:q.data,note:n.data},null,2)],{type:"application/json"});
  const a=el("a",{href:URL.createObjectURL(blob),download:"i-miei-dati-cinque-terre-a-blocchi.json"});document.body.append(a);a.click();a.remove()}

function pannelloCasa(k){
  if(!user||!profilo||profilo.stato_consenso==="in_attesa")return pannelloIntro();
  casa=k;MONDO.highlight(k);
  const mio=mie[k]||{},uff=ufficiali[k]||{};
  bozza={};for(const c in mio)bozza[c]=mio[c].valore;foto=null;
  const campi=CAMPI.filter(([c])=>catalogo[c]).map(([c,t])=>{
    const stato=[];if(uff[c])stato.push("Ufficiale: "+label(c,uff[c]));else stato.push("Ancora da confermare");
    if(mio[c])stato.push("Tu: "+label(c,mio[c].valore)+" · "+STATO_FOTO[mio[c].stato_foto]);
    const opts=el("div",{class:"opts",role:"group","aria-label":t});
    const disegna=()=>{for(const b of opts.children)b.setAttribute("aria-pressed",String(b.dataset.v===bozza[c]))};
    for(const o of catalogo[c]){
      const b=c==="facciata"?el("button",{class:"sw","data-v":o.valore,title:o.etichetta,"aria-label":o.etichetta}):el("button",{"data-v":o.valore,text:o.etichetta});
      if(c==="facciata")b.style.background=o.valore;
      b.addEventListener("click",()=>{bozza[c]=bozza[c]===o.valore?undefined:o.valore;disegna()});opts.append(b)}
    disegna();
    return el("div",{class:"field"},el("div",{class:"h"},el("b",{text:t}),el("span",{class:"st",text:stato.join("\n")})),opts)});
  const fileIn=el("input",{type:"file",accept:"image/*",capture:"environment"});
  fileIn.addEventListener("change",()=>{foto=fileIn.files[0]||null});
  const nota=el("textarea",{maxlength:"500",placeholder:"Qualcosa che non c'è nell'elenco? Scrivilo qui (lo legge solo chi gestisce il progetto)."});
  const out=el("div");
  const salva=el("button",{class:"act",text:"Salva",on:{click:async()=>{salva.disabled=true;try{await salvaCasa(k,nota.value.trim(),out)}finally{salva.disabled=false}}}});
  panel("Casa n. "+k,"Com'è questa casa?",
    el("p",{class:"small",text:"Scegli solo quello che vedi davvero. Tocca di nuovo un'opzione per toglierla."}),
    vistaSwitch(),...campi,
    el("div",{class:"field"},el("label",{},"Foto della facciata (senza persone)",fileIn),el("p",{class:"small",text:"Serve per rendere ufficiali le tue scelte. La foto la vede solo il controllo automatico e poi viene cancellata."})),
    el("div",{class:"field"},el("label",{},"Note",nota)),
    el("div",{class:"rowb"},salva,el("button",{class:"ghost",text:"Chiudi",on:{click:chiudiPannello}})),out)}

async function riduciFoto(file){
  const img=await createImageBitmap(file,{imageOrientation:"from-image"});
  const s=Math.min(1,1600/Math.max(img.width,img.height));const c=document.createElement("canvas");c.width=Math.round(img.width*s);c.height=Math.round(img.height*s);
  c.getContext("2d").drawImage(img,0,0,c.width,c.height);img.close&&img.close();
  // ridisegnare su canvas toglie i dati nascosti della foto (posizione GPS, modello del telefono)
  return await new Promise((ok,ko)=>c.toBlob(b=>b?ok(b):ko(new Error("foto")),"image/jpeg",.82))}

async function salvaCasa(k,nota,out){
  const mio=mie[k]||{};let percorso=null;
  if(foto){out.replaceChildren(msg("Carico la foto…"));
    try{const blob=await riduciFoto(foto);percorso=user.id+"/"+crypto.randomUUID()+".jpg";
      const {error}=await sb.storage.from("foto").upload(percorso,blob,{contentType:"image/jpeg",upsert:false});if(error)throw error}
    catch(e){out.replaceChildren(msg("Non sono riuscito a caricare la foto. Prova con una foto più piccola.","ko"));return}}
  const errori=[];let fatte=0;
  for(const [c] of CAMPI){const v=bozza[c],m=mio[c];
    if(v===undefined){if(m){const {error}=await sb.from("proposte").delete().eq("id",m.id);if(error)errori.push(error.message);else fatte++}continue}
    if(m&&m.valore===v&&!percorso)continue;
    const dati={valore:v};if(percorso)dati.foto=percorso;
    const {error}=m?await sb.from("proposte").update(dati).eq("id",m.id):await sb.from("proposte").insert({borgo:CFG.borgo,edificio:k,campo:c,...dati});
    if(error)errori.push(error.message);else fatte++}
  if(nota){const {error}=await sb.from("note").insert({borgo:CFG.borgo,edificio:k,testo:nota});if(error)errori.push(error.message);else fatte++}
  await caricaMie();ridisegna();
  if(errori.length){out.replaceChildren(msg(errori[0],"ko"));return}
  toast(fatte?"Salvato! Grazie 🧱":"Niente da salvare.");pannelloCasa(k)}

// ---------- avvio ----------
bEdit.addEventListener("click",()=>{const on=bEdit.getAttribute("aria-pressed")!=="true";bEdit.setAttribute("aria-pressed",String(on));
  MONDO.editing=on;document.body.classList.toggle("editing",on);if(on)pannelloIntro();else chiudiPannello()});
function avvia(){
  MONDO.onBuilding=k=>{if(!user||!profilo)return pannelloIntro();pannelloCasa(k)};
  sb.auth.onAuthStateChange((ev,session)=>{const nuovo=session?session.user:null;if((nuovo&&nuovo.id)===(user&&user.id))return;user=nuovo;
    setTimeout(async()=>{await caricaProfilo();await caricaMie();ridisegna();
      if(user&&ev==="SIGNED_IN"&&daLink){daLink=false;toast("Sei dentro!");if(!MONDO.editing)bEdit.click();else pannelloIntro()}else if(MONDO.editing&&!casa)pannelloIntro()},0)});
  Promise.all([caricaCatalogo(),caricaUfficiali()]).then(ridisegna).catch(()=>toast("Non riesco a collegarmi: le schede ufficiali non sono caricate."))}
if(window.MONDO)avvia();else addEventListener("mondo-pronto",avvia,{once:true});
})();
