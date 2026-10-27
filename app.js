// Mondo 3D a blocchi. Espone window.MONDO per l'editor delle facciate.
(async function(){
const CFG=window.CONFIG;
// nomi e scelta del borgo (i testi arrivano da config.js, mai da HTML scritto a mano)
document.title=CFG.nome+" a Blocchi";document.getElementById("nomeBorgo").textContent=CFG.nome;
document.getElementById("load").textContent="Costruisco "+CFG.nome+"…";
document.getElementById("giro").textContent=(CFG.borgo==="manarola"?"Il giro di ":"Da vedere a ")+CFG.nome;
for(const [id,nome] of Object.entries(CFG.borghi)){const a=document.createElement("a");a.className="chip";a.textContent=nome;a.href="?borgo="+id;if(id===CFG.borgo)a.setAttribute("aria-current","page");document.getElementById("borghi").append(a)}
const WORLD=await (await fetch(CFG.mondo)).json();
const {GW,GH}=WORLD;
const dec=s=>{const b=atob(s),u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u};
const tq=new Uint16Array(dec(WORLD.top).buffer), type=dec(WORLD.typ), bidr=new Uint16Array(dec(WORLD.bid).buffer);
const N=GW*GH, top=new Float32Array(N);for(let i=0;i<N;i++)top[i]=tq[i]/4-2;
const idx=(x,y)=>y*GW+x, inb=(x,y)=>x>=0&&y>=0&&x<GW&&y<GH;
const B=WORLD.b; // [roof,col,shut,roofc]
// colori facciata: palette del generatore + colori in piu' del catalogo
const PAL=[...WORLD.pal,"#FFFFFF","#BDB6A8"];
const SHUT_KEYS=["verde","marrone","grigio","azzurro","nessuna"];
const SHUT=["#3d6b3a","#6b4a2e","#5f7a6a","#4f7f9a",null];
const CHIUSE={aperte:.15,miste:.5,chiuse:.85};
let seed=11;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
const hash=(a,b,c)=>{let h=(a*73856093)^(b*19349663)^(c*83492791);h=(h^(h>>>13))*1274126177;return ((h^(h>>>16))>>>0)/4294967296};
// ---------- stato di ogni casa (valori del generatore, poi sovrascritti dalle schede) ----------
const defaults=B.map(b=>({col:b[1],shut:b[2],chiuse:.45,tetto:b[3]?"cotto":"ardesia"}));
let S=defaults.map(d=>({...d}));
function applyOverrides(ov){ // ov: {numeroCasa(1..): {campo:valore}}
  S=defaults.map(d=>({...d}));
  for(const k in ov){const s=S[k-1];if(!s)continue;const o=ov[k];
    if(o.facciata&&/^#[0-9A-Fa-f]{6}$/.test(o.facciata)){const h=o.facciata.toUpperCase();let c=PAL.indexOf(h);if(c<0){c=PAL.push(h)-1;atlasDirty=true}s.col=c}
    if(o.persiane_colore){const c=SHUT_KEYS.indexOf(o.persiane_colore);if(c>=0)s.shut=c}
    if(o.persiane_stato&&CHIUSE[o.persiane_stato]!=null)s.chiuse=CHIUSE[o.persiane_stato];
    if(o.tetto)s.tetto=o.tetto}
}
// ---------- textures ----------
function cv(w,h){const c=document.createElement("canvas");c.width=w;c.height=h;return c}
function mk(c,rep=true){const t=new THREE.CanvasTexture(c);t.magFilter=THREE.NearestFilter;t.minFilter=rep?THREE.NearestMipmapNearestFilter:THREE.NearestFilter;t.generateMipmaps=rep;if(rep)t.wrapS=t.wrapT=THREE.RepeatWrapping;return t}
const hex=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
function noise(g,ox,oy,base,v,w=16,h=16){for(let y=0;y<h;y++)for(let x=0;x<w;x++){const k=1+(rnd()-.5)*v;g.fillStyle=`rgb(${base.map(c=>Math.max(0,Math.min(255,c*k|0))).join(",")})`;g.fillRect(ox+x,oy+y,1,1)}}
function tile(draw){const c=cv(16,16);draw(c.getContext("2d"));return mk(c)}
const T={
 grass:tile(g=>noise(g,0,0,[104,146,66],.32)),
 scrub:tile(g=>{noise(g,0,0,[74,112,58],.35);g.fillStyle="#3f6332";for(let i=0;i<10;i++)g.fillRect(rnd()*15|0,rnd()*15|0,2,2)}),
 vine:tile(g=>{noise(g,0,0,[118,124,70],.3);for(let x=0;x<16;x+=4){g.fillStyle="#4f7d2f";g.fillRect(x,0,3,16);g.fillStyle="#7aa944";for(let y=0;y<16;y+=3)g.fillRect(x+(y%2),y,2,2)}}),
 rock:tile(g=>{noise(g,0,0,[146,140,128],.28);g.fillStyle="rgba(60,55,50,.45)";[[2,3,5],[9,7,6],[4,12,7],[12,2,3]].forEach(([x,y,l])=>g.fillRect(x,y,l,1))}),
 wall:tile(g=>{noise(g,0,0,[170,158,136],.25);g.fillStyle="rgba(70,62,52,.7)";for(let y=0;y<16;y+=4){g.fillRect(0,y,16,1);for(let x=(y/4%2)*4;x<16;x+=8)g.fillRect(x,y,1,4)}}),
 street:tile(g=>{noise(g,0,0,[196,186,166],.14);g.fillStyle="rgba(110,98,84,.45)";for(let y=0;y<16;y+=4){g.fillRect(0,y,16,1);for(let x=(y/4%2)*3;x<16;x+=6)g.fillRect(x,y,1,4)}}),
 trail:tile(g=>{noise(g,0,0,[176,150,112],.22)}),
 sand:tile(g=>noise(g,0,0,[70,98,108],.3)),
 slate:tile(g=>{noise(g,0,0,[96,100,106],.14);g.fillStyle="rgba(0,0,0,.28)";for(let y=1;y<16;y+=3)g.fillRect(0,y,16,1);g.fillStyle="rgba(255,255,255,.08)";for(let y=2;y<16;y+=3)for(let x=(y%2)*3;x<16;x+=6)g.fillRect(x,y,1,2)}),
 cotto:tile(g=>{noise(g,0,0,[172,92,64],.16);g.fillStyle="rgba(0,0,0,.25)";for(let x=1;x<16;x+=3)g.fillRect(x,0,1,16)}),
 terrazza:tile(g=>{noise(g,0,0,[200,190,172],.1);g.fillStyle="rgba(0,0,0,.12)";for(let y=0;y<16;y+=8){g.fillRect(0,y,16,1);g.fillRect(y,0,1,16)}})
};
const M={};for(const k in T)M[k]=new THREE.MeshLambertMaterial({map:T[k]});
M.facade=new THREE.MeshLambertMaterial();
// facciate: atlante colore x (persiana, aperta/chiusa/porta). Si rifa' se arriva un colore nuovo dal catalogo.
const TS=16,AR=SHUT.length*3;let AC=0,atlasDirty=true;
function buildAtlas(){AC=PAL.length;const at=cv(AC*TS,AR*TS),ag=at.getContext("2d");
PAL.forEach((pc,ci)=>{const base=hex(pc);const light=base.map(c=>Math.min(255,c+(255-c)*.6));
  SHUT.forEach((sc,si)=>{for(let v=0;v<3;v++){const ox=ci*TS,oy=(si*3+v)*TS;noise(ag,ox,oy,base,.1);
    ag.fillStyle=`rgb(${light})`;
    if(v<2){ag.fillRect(ox+5,oy+3,6,10);ag.fillStyle="#2a2321";ag.fillRect(ox+6,oy+4,4,8);
      if(sc===null){ag.fillStyle="rgba(170,200,215,.55)";ag.fillRect(ox+6,oy+4,4,8);ag.fillStyle="#e9e2d6";ag.fillRect(ox+8,oy+4,1,8)}
      else{ag.fillStyle=sc;
      if(v===0){ag.fillRect(ox+3,oy+4,2,8);ag.fillRect(ox+11,oy+4,2,8);ag.fillStyle="rgba(0,0,0,.25)";for(let y=5;y<12;y+=2){ag.fillRect(ox+3,oy+y,2,1);ag.fillRect(ox+11,oy+y,2,1)}}
      else{ag.fillRect(ox+6,oy+4,4,8);ag.fillStyle="rgba(0,0,0,.28)";for(let y=5;y<12;y+=2)ag.fillRect(ox+6,oy+y,4,1);ag.fillRect(ox+8,oy+4,1,8)}}
      ag.fillStyle="#e9e2d6";ag.fillRect(ox+5,oy+12,6,1)}
    else{ag.fillRect(ox+4,oy+4,8,12);ag.fillStyle="#4a3324";ag.fillRect(ox+5,oy+5,6,11);ag.fillStyle="#5c4130";ag.fillRect(ox+5,oy+5,6,1);ag.fillRect(ox+8,oy+5,1,11);ag.fillStyle="#c9a24a";ag.fillRect(ox+9,oy+11,1,1)}
    ag.fillStyle="rgba(255,255,255,.18)";ag.fillRect(ox,oy,16,1)}})});
if(M.facade.map)M.facade.map.dispose();M.facade.map=mk(at,false);M.facade.needsUpdate=true;atlasDirty=false}

const TOP=["grass","rock","vine","street","trail",null,"sand","scrub"];
const SIDE=["wall","rock","wall","wall","rock",null,"sand","rock"];
const isWalk=i=>type[i]===3||type[i]===4;
// celle di ogni casa (per evidenziarla)
const cellsOf=B.map(()=>[]);for(let i=0;i<N;i++)if(type[i]===5)cellsOf[bidr[i]-1].push(i);

const renderer=new THREE.WebGLRenderer({canvas:document.getElementById("c"),antialias:false});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
const scene=new THREE.Scene();const SKY=new THREE.Color("#b4dbe9");scene.background=SKY;scene.fog=new THREE.Fog(SKY,140,360);
let terrain=new THREE.Group();scene.add(terrain);
function build(){
  if(atlasDirty)buildAtlas();
  const G={};const geo=k=>G[k]||(G[k]={p:[],n:[],u:[]});
  function quad(m,v,nrm,uv){const g=geo(m);[0,1,2,0,2,3].forEach(k=>{g.p.push(...v[k]);g.n.push(...nrm);g.u.push(...uv[k])})}
  for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){
    const i=idx(x,y),t=top[i],ty=type[i];
    const m=ty===5?S[bidr[i]-1].tetto==="cotto"?"cotto":S[bidr[i]-1].tetto==="terrazza"?"terrazza":"slate":TOP[ty];
    quad(m,[[x,t,y],[x,t,y+1],[x+1,t,y+1],[x+1,t,y]],[0,1,0],[[x,y],[x,y+1],[x+1,y+1],[x+1,y]]);
    for(const[dx,dy,v]of[[1,0,0],[-1,0,1],[0,1,2],[0,-1,3]]){
      const nx=x+dx,ny=y+dy;const ni=inb(nx,ny)?idx(nx,ny):-1;const nt=ni>=0?top[ni]:-2;if(nt>=t)continue;
      const[c0,c1]=v===0?[[x+1,y+1],[x+1,y]]:v===1?[[x,y],[x,y+1]]:v===2?[[x,y+1],[x+1,y+1]]:[[x+1,y],[x,y]];
      const nrm=[dx,0,dy];
      if(ty!==5){quad(SIDE[ty],[[c0[0],nt,c0[1]],[c1[0],nt,c1[1]],[c1[0],t,c1[1]],[c0[0],t,c0[1]]],nrm,[[0,nt],[1,nt],[1,t],[0,t]]);continue}
      const s=S[bidr[i]-1],col=s.col,sh=s.shut;const street=ni>=0&&isWalk(ni);
      const k0=Math.floor(nt+1e-6);
      for(let k=k0;k<Math.ceil(t-1e-6);k++){
        const lo=Math.max(nt,k),hi=Math.min(t,k+1);if(hi-lo<.01)continue;
        let v3=hash(x*4+v,y,k)<s.chiuse?1:0;if(k===k0&&street&&hash(x,y*3+v,7)<.4)v3=2;
        const u0=(col*TS+.3)/(AC*TS),u1=((col+1)*TS-.3)/(AC*TS);const row=sh*3+v3;
        const vt=y0=>1-((row*TS)+(1-(y0-k))*TS)/(AR*TS);
        quad("facade",[[c0[0],lo,c0[1]],[c1[0],lo,c1[1]],[c1[0],hi,c1[1]],[c0[0],hi,c0[1]]],nrm,[[u0,vt(lo)],[u1,vt(lo)],[u1,vt(hi)],[u0,vt(hi)]]);
      }
    }
  }
  scene.remove(terrain);terrain.traverse(o=>{if(o.geometry)o.geometry.dispose()});
  terrain=new THREE.Group();
  for(const k in G){const g=G[k];const bg=new THREE.BufferGeometry();bg.setAttribute("position",new THREE.Float32BufferAttribute(g.p,3));bg.setAttribute("normal",new THREE.Float32BufferAttribute(g.n,3));bg.setAttribute("uv",new THREE.Float32BufferAttribute(g.u,2));terrain.add(new THREE.Mesh(bg,M[k]))}
  scene.add(terrain);
}
build();
// mare
const seaC=cv(16,16);const sg=seaC.getContext("2d");noise(sg,0,0,[52,132,164],.12);sg.fillStyle="rgba(255,255,255,.35)";[[2,3,4],[9,8,5],[4,13,3]].forEach(([x,y,l])=>sg.fillRect(x,y,l,1));
const seaT=mk(seaC);seaT.repeat.set(200,200);
const sea=new THREE.Mesh(new THREE.PlaneGeometry(900,900),new THREE.MeshLambertMaterial({map:seaT,transparent:true,opacity:.88}));sea.rotation.x=-Math.PI/2;sea.position.set(GW/2,.25,GH/2);scene.add(sea);
scene.add(new THREE.HemisphereLight(0xe8f4ff,0x6a5d48,.72));const sun=new THREE.DirectionalLight(0xffe2b8,.8);sun.position.set(-120,90,-20);scene.add(sun);
// comignoli
const chim=new THREE.Mesh(new THREE.BoxGeometry(.35,.6,.35),new THREE.MeshLambertMaterial({color:"#d9cfc0"}));
const done=new Set();for(let i=0;i<N;i++){if(type[i]!==5)continue;const k=bidr[i];if(done.has(k)||hash(k,3,9)>.45)continue;done.add(k);const m=chim.clone();m.position.set(i%GW+.5,top[i]+.3,Math.floor(i/GW)+.5);scene.add(m)}
// gozzi alla marina
const R=WORLD.route;
if(R.length>4){const mx=R[4].x,my=R[4].y;const cols=["#c8423a","#2f6fae","#3f8a55","#e0b13e","#f2efe6"];let n=0;
 for(let r=1;r<7&&n<6;r++)for(let a=0;a<12&&n<6;a++){const x=Math.round(mx+Math.cos(a)*r),y=Math.round(my+Math.sin(a)*r);if(!inb(x,y))continue;const i=idx(x,y);if(type[i]!==3||hash(x,y,1)<.55)continue;
  const g=new THREE.Group();const hull=new THREE.Mesh(new THREE.BoxGeometry(1.6,.35,.6),new THREE.MeshLambertMaterial({color:cols[n%5]}));const rim=new THREE.Mesh(new THREE.BoxGeometry(1.62,.08,.62),new THREE.MeshLambertMaterial({color:"#f6efe0"}));rim.position.y=.2;g.add(hull,rim);g.position.set(x+.5,top[i]+.2,y+.5);g.rotation.y=hash(x,y,2)*3;scene.add(g);n++}}
// evidenziazione della casa scelta
const hlMat=new THREE.MeshBasicMaterial({color:"#ffd34d",transparent:true,opacity:.55,depthTest:false});
let hl=null;
function highlight(k){if(hl){scene.remove(hl);hl.geometry.dispose();hl=null}if(k==null)return;
  const p=[];for(const i of cellsOf[k-1]){const x=i%GW,y=Math.floor(i/GW),t=top[i]+.06;p.push(x,t,y,x,t,y+1,x+1,t,y+1,x,t,y,x+1,t,y+1,x+1,t,y)}
  const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(p,3));hl=new THREE.Mesh(g,hlMat);hl.renderOrder=5;scene.add(hl)}
// ---------- insegne ----------
await document.fonts.load('700 40px "Pixelify Sans"').catch(()=>{});
const CATC={sleep:"#e6a93a",eat:"#e2826b",shop:"#b48cd8",see:"#5fc1d6"};
function label(text,sub,col,big){const c=cv(8,8),m=c.getContext("2d");const f1=big?'700 50px "Pixelify Sans", monospace':'700 40px "Pixelify Sans", monospace',f2='600 26px "DM Sans", sans-serif';m.font=f1;const w1=m.measureText(text).width;m.font=f2;const W=Math.ceil(Math.max(w1,m.measureText(sub).width)+56);const H=big?132:116;c.width=W;c.height=H+30;const g=c.getContext("2d");
  g.fillStyle=big?"rgba(246,239,224,.95)":"rgba(22,25,28,.9)";g.fillRect(0,0,W,H);g.fillStyle=col;g.fillRect(0,0,12,H);g.beginPath();g.moveTo(W/2-16,H);g.lineTo(W/2+16,H);g.lineTo(W/2,H+26);g.fillStyle=big?"rgba(246,239,224,.95)":"rgba(22,25,28,.9)";g.fill();
  g.fillStyle=big?"#16191c":"#f6efe0";g.font=f1;g.fillText(text,30,big?62:54);g.fillStyle=big?"#8a5a10":col;g.font=f2;g.fillText(sub,30,big?104:92);
  const t=new THREE.CanvasTexture(c);t.minFilter=THREE.LinearFilter;const s=new THREE.Sprite(new THREE.SpriteMaterial({map:t,fog:false}));s.center.set(.5,0);s.userData.ar=W/(H+30);return s}
const groundAtCell=(x,y)=>{x=Math.max(0,Math.min(GW-1,Math.floor(x)));y=Math.max(0,Math.min(GH-1,Math.floor(y)));return top[idx(x,y)]};
const pinGeo=new THREE.OctahedronGeometry(.45);
const pois=WORLD.pois.map(p=>{const h=groundAtCell(p.x,p.y)+1.4;const m=new THREE.Mesh(pinGeo,new THREE.MeshBasicMaterial({color:CATC[p.c]}));m.position.set(p.x,h,p.y);m.userData.p=p;scene.add(m);p.pin=m;p.h=h;p.on=p.c!=="shop";m.visible=p.on;return p});
const routeSigns=R.map((r,k)=>{const s=label(`${k+1} · ${r.n}`,"Tappa dell'itinerario","#e6a93a",true);s.position.set(r.x+.5,groundAtCell(r.x,r.y)+2.5,r.y+.5);s.userData.r=k;scene.add(s);return s});
let shownLabels=new Map();
document.getElementById("load").remove();
// ---------- camera e controlli ----------
const cam=new THREE.PerspectiveCamera(72,1,.08,700);
// personaggio a blocchi (1 blocco = 2 m, quindi una persona e' alta circa 0,9 blocchi)
const avatar=new THREE.Group();
const lam=c=>new THREE.MeshLambertMaterial({color:c});
const part=(w,h,d,c,x,y,z)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),lam(c));m.position.set(x,y,z);avatar.add(m);return m};
const pivot=(x,y,z,w,h,d,c)=>{const g=new THREE.Group();g.position.set(x,y,z);const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),lam(c));m.position.y=-h/2;g.add(m);avatar.add(g);return g};
part(.26,.3,.14,"#2f6fae",0,.55,0);                 // maglia
part(.2,.2,.2,"#e8b58f",0,.8,0);                    // testa
part(.21,.06,.21,"#4a3324",0,.9,0);                 // capelli
part(.04,.04,.01,"#16191c",-.05,.81,-.101);part(.04,.04,.01,"#16191c",.05,.81,-.101); // occhi
const legL=pivot(-.065,.4,0,.12,.4,.13,"#33405a"),legR=pivot(.065,.4,0,.12,.4,.13,"#33405a");
const armL=pivot(-.18,.69,0,.09,.3,.1,"#2f6fae"),armR=pivot(.18,.69,0,.09,.3,.1,"#2f6fae");
avatar.visible=false;scene.add(avatar);
let third=true,walkPhase=0,heading=0;
const $=id=>document.getElementById(id);
const bView=$("bView");
function setView(t){third=t;bView.setAttribute("aria-pressed",String(t))}
bView.onclick=()=>setView(!third);
let mode="fly",yaw=0,pitch=0;const pos=new THREE.Vector3(),vel=new THREE.Vector3();
function lookAt(tx,ty,tz){const d=new THREE.Vector3(tx-pos.x,ty-pos.y,tz-pos.z).normalize();yaw=Math.atan2(-d.x,-d.z);pitch=Math.asin(d.y)}
{const r=R[R.length-1];if(R.length>1){pos.set(r.x-8,groundAtCell(r.x,r.y)+22,r.y+16);lookAt(150,22,150)}else{const g=groundAtCell(r.x,r.y);pos.set(r.x-25,g+40,r.y+35);lookAt(r.x,g,r.y)}}heading=yaw;
function resize(){renderer.setSize(innerWidth,innerHeight,false);cam.aspect=innerWidth/innerHeight;cam.updateProjectionMatrix()}addEventListener("resize",resize);resize();
const typing=e=>/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
const keys={};addEventListener("keydown",e=>{if(typing(e))return;if(e.target.tagName==="BUTTON"&&e.key===" ")return;keys[e.key.toLowerCase()]=true});addEventListener("keyup",e=>keys[e.key.toLowerCase()]=false);addEventListener("blur",()=>{for(const k in keys)keys[k]=false});
// ---------- spostamenti animati ----------
const ease=t=>t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2;
const angDiff=(a,b)=>Math.atan2(Math.sin(b-a),Math.cos(b-a));
let tw=null;
function tweenTo(x,y,z,toYaw,toPitch,dur,end){tw={t:0,dur,from:{x:pos.x,y:pos.y,z:pos.z,yaw,pitch},to:{x,y,z,yaw:yaw+angDiff(yaw,toYaw),pitch:toPitch},end};vel.set(0,0,0)}
function stepTween(dt){tw.t=Math.min(1,tw.t+dt/tw.dur);const k=ease(tw.t),f=tw.from,o=tw.to;
  pos.set(f.x+(o.x-f.x)*k,f.y+(o.y-f.y)*k,f.z+(o.z-f.z)*k);yaw=f.yaw+(o.yaw-f.yaw)*k;pitch=f.pitch+(o.pitch-f.pitch)*k;
  if(tw.t>=1){const e=tw.end;tw=null;if(e)e()}}
const yawTo=(x,z,tx,tz)=>Math.atan2(-(tx-x),-(tz-z));
const C=renderer.domElement;let drag=null,moved=0;
C.addEventListener("pointerdown",e=>{drag={x:e.clientX,y:e.clientY,id:e.pointerId};moved=0;C.setPointerCapture(e.pointerId);closeMenu()});
C.addEventListener("pointermove",e=>{if(!drag||drag.id!==e.pointerId)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;moved+=Math.abs(dx)+Math.abs(dy);if(!tw){yaw-=dx*.005;pitch=Math.max(-1.45,Math.min(1.45,pitch-dy*.005))}drag.x=e.clientX;drag.y=e.clientY});
C.addEventListener("pointerup",e=>{if(drag&&moved<6)pick(e);drag=null});
const ray=new THREE.Raycaster();
function setRay(e){const r=C.getBoundingClientRect();ray.setFromCamera({x:(e.clientX-r.left)/r.width*2-1,y:-(e.clientY-r.top)/r.height*2+1},cam)}
function pickBuilding(){const h=ray.intersectObjects(terrain.children);if(!h.length)return null;const p=h[0].point.clone().addScaledVector(h[0].face.normal,-.02);
  const x=Math.floor(p.x),y=Math.floor(p.z);if(!inb(x,y))return null;const i=idx(x,y);return type[i]===5?bidr[i]:null}
function pick(e){setRay(e);
  if(API.editing){const k=pickBuilding();if(k!=null){if(tut.step===4)highlight(k);if(API.onBuilding)API.onBuilding(k);tut.ev("casa")}return}
  const objs=[...routeSigns,...[...shownLabels.values()],...pois.filter(p=>p.pin.visible).map(p=>p.pin)];const h=ray.intersectObjects(objs);if(!h.length)return;const o=h[0].object;
  if(o.userData.r!==undefined)showStop(o.userData.r);else showPoi(o.userData.p)}
const joy=$("joy"),knob=$("knob");let jv={x:0,y:0},jid=null;
joy.addEventListener("pointerdown",e=>{jid=e.pointerId;joy.setPointerCapture(jid);jm(e)});joy.addEventListener("pointermove",e=>{if(e.pointerId===jid)jm(e)});
const jend=()=>{jid=null;jv={x:0,y:0};knob.style.transform=""};joy.addEventListener("pointerup",jend);joy.addEventListener("pointercancel",jend);
function jm(e){const r=joy.getBoundingClientRect();let x=(e.clientX-r.left-r.width/2)/45,y=(e.clientY-r.top-r.height/2)/45;const l=Math.hypot(x,y);if(l>1){x/=l;y/=l}jv={x,y};knob.style.transform=`translate(${x*35}px,${y*35}px)`}
let vUp=0;const hold=(el,v)=>{el.addEventListener("pointerdown",()=>vUp=v);["pointerup","pointerleave","pointercancel"].forEach(t=>el.addEventListener(t,()=>vUp=0))};hold($("bUp"),1);hold($("bDn"),-1);
const ud=$("updown"),card=$("card");
function nearestWalk(px,pz,rad){let best=null,bd=1e9;for(let y=Math.max(0,Math.floor(pz-rad));y<Math.min(GH,pz+rad);y++)for(let x=Math.max(0,Math.floor(px-rad));x<Math.min(GW,px+rad);x++){if(!isWalk(idx(x,y)))continue;const d=Math.hypot(x+.5-px,y+.5-pz);if(d<bd){bd=d;best=[x,y]}}return best}
function markMode(m){mode=m;$("mWalk").setAttribute("aria-pressed",m==="walk");$("mFly").setAttribute("aria-pressed",m==="fly");ud.hidden=m!=="fly"}
// cambio modalita' sempre con un movimento morbido, mai un salto
function setMode(m){if(m===mode||tw)return;jump=null;
  if(m==="fly"){markMode("fly");tweenTo(pos.x,pos.y+18,pos.z,yaw,-.45,1);tut.ev("vola");return}
  let c=nearestWalk(pos.x,pos.z,10),ty=yaw;if(!c){const r=R[Math.min(1,R.length-1)];c=[r.x,r.y];ty=yawTo(r.x+.5,r.y+.5,r.lx,r.ly)}
  tweenTo(c[0]+.5,groundAtCell(c[0],c[1])+.9,c[1]+.5,ty,-.05,1.2,()=>markMode("walk"))}
function goTo(x,y,lx,ly){const far=Math.hypot(x-pos.x,y-pos.z);
  tweenTo(x+.5,groundAtCell(x,y)+.9,y+.5,yawTo(x+.5,y+.5,lx,ly),-.02,Math.min(2.4,.8+far/60),()=>markMode("walk"))}
// Cammina e Vola chiudono sempre la modalita' Segna, cosi' il personaggio torna visibile
function esciSegna(){if(API.editing)$("bEdit").click()}
$("mWalk").onclick=()=>{esciSegna();setMode("walk")};$("mFly").onclick=()=>{esciSegna();setMode("fly")};
// ---------- menu ----------
const menu=$("menu"),bMenu=$("bMenu");
function closeMenu(){if(menu.hidden)return;menu.hidden=true;bMenu.setAttribute("aria-expanded","false")}
bMenu.onclick=()=>{menu.hidden=!menu.hidden;bMenu.setAttribute("aria-expanded",String(!menu.hidden))};
addEventListener("keydown",e=>{if(e.key==="Escape")closeMenu()});
menu.querySelectorAll(".chips button[data-cat]").forEach(b=>b.onclick=()=>{const on=b.getAttribute("aria-pressed")!=="true";b.setAttribute("aria-pressed",on);pois.forEach(p=>{if(p.c===b.dataset.cat){p.on=on;p.pin.visible=on}})});
const rl=$("rList");R.forEach((r,k)=>{const li=document.createElement("li");const b=document.createElement("button");const n=document.createElement("span");n.className="n";n.textContent=k+1;const t=document.createElement("span");t.textContent=r.n;b.append(n,t);b.onclick=()=>{showStop(k);goTo(r.x,r.y,r.lx,r.ly);closeMenu()};li.append(b);rl.append(li)});
$("bTut").onclick=()=>{closeMenu();tut.start()};
// ---------- scheda ----------
const cK=$("cK"),cT=$("cT"),cP=$("cP"),cR=$("cR");let shown=null;
$("cX").onclick=()=>{card.hidden=true;shown=null};
function btn(row,t,cls,f){const b=document.createElement("button");b.textContent=t;b.className=cls;b.onclick=f;row.append(b);return b}
function showStop(k){const r=R[k];shown="r"+k;card.hidden=false;cK.textContent=`Tappa ${k+1} di ${R.length}`;cT.textContent=r.n;cP.textContent=r.t;cR.replaceChildren();
  if(k<R.length-1)btn(cR,"Prossima tappa →","act",()=>{showStop(k+1);const n=R[k+1];goTo(n.x,n.y,n.lx,n.ly)});
  btn(cR,"Portami qui","ghost",()=>goTo(r.x,r.y,r.lx,r.ly))}
function showPoi(p){if(shown===p)return;shown=p;card.hidden=false;cK.textContent=p.k;cT.textContent=p.n;cP.textContent="Posizione reale da OpenStreetMap.";cR.replaceChildren();
  btn(cR,"Portami lì","act",()=>{const b=nearestWalk(p.x,p.y,12);if(b)goTo(b[0],b[1],p.x,p.y)})}
// ---------- tutorial guidato ----------
const coach=$("coach"),tK=$("tK"),tDots=$("tDots"),tT=$("tT"),tP=$("tP"),tR=$("tR");
const touch=matchMedia("(pointer:coarse)").matches;
const store={get(){try{return localStorage.getItem("ctb-tutorial")}catch(e){return null}},set(v){try{localStorage.setItem("ctb-tutorial",v)}catch(e){}}};
const STEPS=[
  {t:"Benvenuto a "+window.CONFIG.nome,p:"È il paese vero, ricostruito a blocchi: 1 blocco = 2 metri. In un minuto ti mostro come si gioca.",go:"Iniziamo"},
  {t:"Cammina",p:touch?"Usa il cerchio in basso a sinistra per camminare. Trascina il dito sullo schermo per guardarti intorno.":"Cammina con i tasti W A S D o con le frecce. Trascina col mouse per guardarti intorno.",wait:"passi"},
  {t:"Vola",p:"Ora tocca 🕊️ Vola qui sotto: ti alzi sopra i tetti e vedi tutto il paese.",wait:"vola",glow:"mFly"},
  {t:"Segna",p:"Le case non sono ancora tutte uguali a quelle vere. Tocca ✏️ Segna per aiutarci.",wait:"segna",glow:"bEdit"},
  {t:"Scegli una casa",p:"Tocca una casa qualsiasi: si illumina di giallo e puoi dire com'è davvero (colore, persiane, tetto…).",wait:"casa"},
  {t:"Fatto!",p:"Per salvare entra con la tua email. La prima volta che salvi una casa ricevi la targhetta Esploratore 🧭.",go:"Ho capito"}];
const tut={step:-1,walked:0,
  start(){card.hidden=true;shown=null;this.show(0)},
  show(n){this.step=n;const s=STEPS[n],last=STEPS.length-1;coach.hidden=false;tK.textContent=n===0||n===last?"Tutorial":`Passo ${n} di ${last-1}`;tT.textContent=s.t;tP.textContent=s.p;
    tDots.replaceChildren(...STEPS.map((_,i)=>{const d=document.createElement("i");if(i<=n)d.className="on";return d}));
    tR.replaceChildren();if(s.go)btn(tR,s.go,"act",()=>this.next());if(n<last)btn(tR,"Salta","ghost",()=>this.end());
    document.querySelectorAll("#bar button").forEach(b=>b.classList.toggle("glow",b.id===s.glow));
    if(n===1){this.walked=0;const r=R[Math.min(1,R.length-1)];tw=null;goTo(r.x,r.y,r.lx,r.ly)}},
  next(){if(this.step<STEPS.length-1)this.show(this.step+1);else this.end()},
  ev(name){if(this.step<0)return;const s=STEPS[this.step];if(s.wait===name){const n=this.step;setTimeout(()=>{if(this.step===n)this.next()},name==="casa"?900:500)}},
  end(){const era=this.step;this.step=-1;coach.hidden=true;if(era>=3)esciSegna();document.querySelectorAll("#bar .glow").forEach(b=>b.classList.remove("glow"));store.set("fatto")}};
$("bEdit").addEventListener("click",()=>setTimeout(()=>{if(API.editing)tut.ev("segna")},0));
// ---------- API per l'editor ----------
const API={editing:false,onBuilding:null,palette:PAL,count:B.length,
  apply(ov){applyOverrides(ov);build()},
  highlight,
  defaults:k=>{const d=defaults[k-1];return{facciata:PAL[d.col],persiane_colore:SHUT_KEYS[d.shut],tetto:d.tetto}},
  focus(k){const c=cellsOf[k-1];if(!c||!c.length)return;let sx=0,sy=0;for(const i of c){sx+=i%GW;sy+=Math.floor(i/GW)}sx/=c.length;sy/=c.length;const t=top[c[0]];
    markMode("fly");const x=sx+.5+10,y=t+9,z=sy+.5+10,dx=sx+.5-x,dy=t-1-y,dz=sy+.5-z;
    tweenTo(x,y,z,Math.atan2(-dx,-dz),Math.asin(dy/Math.hypot(dx,dy,dz))-(innerWidth<640?.35:0),.9)}};// su telefono la casa resta sopra il pannello
window.MONDO=API;window.dispatchEvent(new Event("mondo-pronto"));
// ---------- loop ----------
const fwd=new THREE.Vector3(),rt=new THREE.Vector3(),st=new THREE.Vector3(),want=new THREE.Vector3(),camT=new THREE.Vector3();let last=performance.now(),camInit=false;
function groundAt(x,z){const xi=Math.floor(x),zi=Math.floor(z);if(!inb(xi,zi))return null;const i=idx(xi,zi);return type[i]===6?null:top[i]}
let jump=null;
function frame(now){const dt=Math.min(.05,(now-last)/1000);last=now;
  let mx=(keys.d||keys.arrowright?1:0)-(keys.a||keys.arrowleft?1:0)+jv.x, mz=(keys.w||keys.arrowup?1:0)-(keys.s||keys.arrowdown?1:0)-jv.y;
  let up=(keys.e?1:0)-(keys.q?1:0)+vUp;
  const sm=1-Math.exp(-dt*8);// accelera e frena dolcemente
  if(tw){stepTween(dt);mx=mz=up=0}
  else if(mode==="fly"){fwd.set(-Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),-Math.cos(yaw)*Math.cos(pitch));rt.set(Math.cos(yaw),0,-Math.sin(yaw));
    want.set(0,0,0).addScaledVector(fwd,mz*24).addScaledVector(rt,mx*24);want.y+=up*24;vel.lerp(want,sm);pos.addScaledVector(vel,dt);
    const g=groundAt(pos.x,pos.z);pos.y=Math.min(170,Math.max(pos.y,(g??0)+1.5))}
  else{fwd.set(-Math.sin(yaw),0,-Math.cos(yaw));rt.set(Math.cos(yaw),0,-Math.sin(yaw));const v=keys.shift?5:2.6;
    want.set(0,0,0).addScaledVector(fwd,mz*v).addScaledVector(rt,mx*v);vel.lerp(want,sm);vel.y=0;st.copy(vel).multiplyScalar(dt);const cur=pos.y-.9;
    const ok=(x,z)=>{const g=groundAt(x,z);return g!==null&&g-cur<=1.05};const ox=pos.x,oz=pos.z;
    for(const ax of["x","z"]){const d=ax==="x"?st.x:st.z;if(!d)continue;const nx=ax==="x"?pos.x+d:pos.x,nz=ax==="z"?pos.z+d:pos.z;const r=.28*Math.sign(d);if(ok(nx,nz)&&ok(ax==="x"?nx+r:nx,ax==="z"?nz+r:nz))ax==="x"?pos.x=nx:pos.z=nz;else ax==="x"?vel.x=0:vel.z=0}
    if(tut.step===1){tut.walked+=Math.hypot(pos.x-ox,pos.z-oz);if(tut.walked>4){tut.walked=-1e9;tut.ev("passi")}}
    const g=groundAt(pos.x,pos.z)??cur;
    // gradino alto: piccolo salto ad arco; in discesa e sui gradini bassi si scende/sale dolcemente
    if(!jump&&g-cur>.6)jump={t:0,from:pos.y,to:g+.9};
    if(jump){jump.t+=dt/.25;const k=Math.min(1,jump.t);pos.y=jump.from+(jump.to-jump.from)*k+Math.sin(Math.PI*k)*.45;if(k>=1)jump=null}
    else pos.y+=(g+.9-pos.y)*Math.min(1,dt*10)}
  const spd=Math.hypot(vel.x,vel.z);
  const moving=mode==="walk"&&!tw&&spd>.3;
  walkPhase=moving?walkPhase+dt*spd*3.4:walkPhase*.8;const sw=Math.sin(walkPhase)*(moving?Math.min(.7,spd*.27):0);
  legL.rotation.x=sw;legR.rotation.x=-sw;armL.rotation.x=-sw*.8;armR.rotation.x=sw*.8;if(jump){armL.rotation.x=armR.rotation.x=Math.PI*.85;legL.rotation.x=.5;legR.rotation.x=-.3}
  // il personaggio si gira verso dove cammina, senza scatti
  const tgt=moving?Math.atan2(-vel.x,-vel.z):yaw;heading+=angDiff(heading,tgt)*Math.min(1,dt*10);
  const flying=mode==="fly";
  if(third&&!API.editing){
    avatar.visible=true;avatar.rotation.order="YXZ";avatar.rotation.y=heading;
    if(flying){ // in volo: sdraiato in avanti quando avanza, braccia avanti
      const ahead=vel.x*-Math.sin(yaw)+vel.z*-Math.cos(yaw);const lean=-Math.min(1,Math.max(0,ahead/24))*1.1;avatar.rotation.x+=(lean-avatar.rotation.x)*Math.min(1,dt*6);
      armL.rotation.x=armR.rotation.x=Math.PI*.9;legL.rotation.x=Math.sin(now/180)*.15;legR.rotation.x=-legL.rotation.x;
      avatar.position.set(pos.x,pos.y-.45,pos.z);
    }else{avatar.rotation.x*=1-Math.min(1,dt*8);avatar.position.set(pos.x,pos.y-.9,pos.z);if(!tw)pitch=Math.max(-1.1,Math.min(.5,pitch))}
    // camera dietro e un po' sopra; se c'e' un muro in mezzo si avvicina
    const far=flying?5:3.2,tx=pos.x,ty=pos.y+(flying?.1:.15),tz=pos.z;fwd.set(-Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),-Math.cos(yaw)*Math.cos(pitch));
    let d=.5;for(;d<far;d+=.1){const cx=tx-fwd.x*d,cy=ty-fwd.y*d+.35,cz=tz-fwd.z*d;const g=groundAt(cx,cz);if(g!==null&&g>cy-.15)break}
    d=Math.max(.5,d-.15);camT.set(tx-fwd.x*d,ty-fwd.y*d+.35,tz-fwd.z*d);
  }else{avatar.visible=false;camT.copy(pos)}
  if(!camInit||camT.distanceTo(cam.position)>20){cam.position.copy(camT);camInit=true}else cam.position.lerp(camT,1-Math.exp(-dt*12));
  cam.rotation.set(pitch,yaw,0,"YXZ");
  seaT.offset.x=(now/1000*.008)%1;
  const vis=API.editing?[]:pois.filter(p=>p.on).map(p=>[p,Math.hypot(p.x-pos.x,p.h-pos.y,p.y-pos.z)]).filter(a=>a[1]<(mode==="walk"?28:45)).sort((a,b)=>a[1]-b[1]).slice(0,mode==="walk"?6:8);
  const wantL=new Set(vis.map(a=>a[0]));
  for(const [p,s] of shownLabels){if(!wantL.has(p)){scene.remove(s);s.material.map.dispose();s.material.dispose();shownLabels.delete(p)}}
  for(const [p] of vis){if(!shownLabels.has(p)){const s=label(p.n,p.k,CATC[p.c],false);s.position.set(p.x,p.h+.6,p.y);s.userData.p=p;scene.add(s);shownLabels.set(p,s)}}
  const kA=cam.aspect<1?.75:1;
  for(const [p,s] of shownLabels){const d=s.position.distanceTo(pos);const k=Math.max(.35,Math.min(1.4,d/30))*kA;s.scale.set(3.2*s.userData.ar*k,3.2*k,1)}
  routeSigns.forEach(s=>{const d=s.position.distanceTo(pos);s.visible=!API.editing&&d>7;const k=Math.max(.5,Math.min(3,d/30))*kA;s.scale.set(4*s.userData.ar*k,4*k,1)});
  pois.forEach(p=>{p.pin.visible=p.on&&!API.editing;p.pin.rotation.y=now/700;p.pin.position.y=p.h+Math.sin(now/500+p.x)*.12});
  renderer.render(scene,cam);requestAnimationFrame(frame)}
markMode("fly");requestAnimationFrame(frame);
// chi arriva dal link dell'email non rivede il tutorial
if(!store.get()&&!/[?&]code=/.test(location.search))tut.start();
})();
