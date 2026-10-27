import math, json, base64, random, os, xml.etree.ElementTree as ET
D=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','🗺️ dati')
import numpy as np
from PIL import Image
from scipy import ndimage

import sys
LUOGO=sys.argv[1] if len(sys.argv)>1 else 'manarola'
# edifici reali (Regione CTR 3D + DTM + OSM + LiDAR), da scarica_edifici.py; se manca si usa osm.xml come prima
EDI=os.path.join(D,LUOGO+'.json')
EDI=json.load(open(EDI)) if os.path.exists(EDI) else None
if EDI: S,N,W,E=EDI['bbox']['S'],EDI['bbox']['N'],EDI['bbox']['W'],EDI['bbox']['E']
else: S,N,W,E=44.1038,44.1096,9.7243,9.7328
CELL=2.0
latM=111320.0; lonM=111320.0*math.cos(math.radians((S+N)/2))
GW=int(round((E-W)*lonM/CELL)); GH=int(round((N-S)*latM/CELL))
def toG(lat,lon): return ((lon-W)*lonM/CELL, (N-lat)*latM/CELL)
print('grid',GW,GH)

# ---------- elevation ----------
z=15;n=2**z
tx=lambda lon:(lon+180)/360*n
ty=lambda lat:(1-math.log(math.tan(math.radians(lat))+1/math.cos(math.radians(lat)))/math.pi)/2*n
tiles={}
import glob,os
for f in glob.glob(os.path.join(D,'tiles','*.png')):
    x,y=map(int,os.path.basename(f)[:-4].split('_'))
    a=np.asarray(Image.open(f).convert('RGB')).astype(np.float64)
    tiles[(x,y)]=a[:,:,0]*256+a[:,:,1]+a[:,:,2]/256-32768
def px(gx,gy):
    X,Y=gx//256,gy//256; t=tiles.get((X,Y))
    return 0.0 if t is None else t[gy-Y*256,gx-X*256]
elev=np.zeros((GH,GW))
DTMF=os.path.join(D,LUOGO+'_dtm.npz')
for j in range(GH if not os.path.exists(DTMF) or LUOGO=='manarola' else 0):   # AWS: ripiego (e confronto per Manarola)
    lat=N-(j+.5)*CELL/latM
    fy=ty(lat)*256-.5
    for i in range(GW):
        lon=W+(i+.5)*CELL/lonM
        fx=tx(lon)*256-.5
        X,Y=int(math.floor(fx)),int(math.floor(fy)); u,v=fx-X,fy-Y
        elev[j,i]=px(X,Y)*(1-u)*(1-v)+px(X+1,Y)*u*(1-v)+px(X,Y+1)*(1-u)*v+px(X+1,Y+1)*u*v
# DTM 2023 della Regione (5 m, salva_dtm.py): stesso terreno usato per le altezze degli edifici
if os.path.exists(DTMF):
    from scarica_edifici import wgs84_to_3003
    dz=np.load(DTMF); Z=np.nan_to_num(dz['z'].astype(np.float64),nan=0.0); x0=float(dz['x0']); y1=float(dz['y1']); P=float(dz['passo'])
    aws=elev.copy()
    for j in range(GH):
        lat=N-(j+.5)*CELL/latM
        for i in range(GW):
            X,Y=wgs84_to_3003(lat,W+(i+.5)*CELL/lonM)
            fx=(X-x0)/P-.5; fy=(y1-Y)/P-.5; xi,yi=int(fx),int(fy); u,v=fx-xi,fy-yi
            elev[j,i]=Z[yi,xi]*(1-u)*(1-v)+Z[yi,xi+1]*u*(1-v)+Z[yi+1,xi]*(1-u)*v+Z[yi+1,xi+1]*u*v
    dd_=np.abs(aws-elev)[(elev>1)&(aws!=0)]
    print('terreno: DTM Regione 2023'+(' (differenza da AWS: mediana %.1f m, 95%% %.1f m)'%(np.median(dd_),np.percentile(dd_,95)) if dd_.size else ''))
else: print('terreno: AWS Terrain Tiles (manca',os.path.basename(DTMF),')')
sea=elev<=0.6
lab,nl=ndimage.label(~sea)
sizes=ndimage.sum(np.ones_like(lab),lab,range(1,nl+1))
for k,s in enumerate(sizes,1):
    if s<60: sea[lab==k]=True
lab,nl=ndimage.label(sea)
sizes=ndimage.sum(np.ones_like(lab),lab,range(1,nl+1))
for k,s in enumerate(sizes,1):
    if s<40: sea[lab==k]=False
T=np.where(sea,-1.0,np.maximum(1.0,np.round(elev/CELL)))   # terrain top, blocks (1 block = 2 m)
Tsm=ndimage.gaussian_filter(np.maximum(elev,0)/CELL,1.2)

# ---------- OSM ----------
r=ET.parse(os.path.join(D,'osm.xml' if LUOGO=='manarola' else LUOGO+'_osm.xml')).getroot()
nodes={nd.get('id'):(float(nd.get('lat')),float(nd.get('lon'))) for nd in r.iter('node')}
def tg(e): return {t.get('k'):t.get('v') for t in e.findall('tag')}
ways=[]
for w in r.iter('way'):
    pts=[toG(*nodes[x.get('ref')]) for x in w.findall('nd') if x.get('ref') in nodes]
    if len(pts)>=2: ways.append((tg(w),pts))

def inpoly(x,y,p):
    c=False;j=len(p)-1
    for i in range(len(p)):
        xi,yi=p[i];xj,yj=p[j]
        if (yi>y)!=(yj>y) and x<(xj-xi)*(y-yi)/(yj-yi)+xi: c=not c
        j=i
    return c
def cells_in(p):
    xs=[a for a,b in p];ys=[b for a,b in p];out=[]
    for y in range(max(0,int(min(ys))),min(GH,int(max(ys))+1)):
        for x in range(max(0,int(min(xs))),min(GW,int(max(xs))+1)):
            if inpoly(x+.5,y+.5,p): out.append((x,y))
    return out
def line_cells(p,width):
    out=set()
    for k in range(1,len(p)):
        (a,b),(c,d)=p[k-1],p[k]
        L=math.hypot(c-a,d-b); steps=int(L*3)+1
        nx,ny=(-(d-b)/L,(c-a)/L) if L>0 else (0,0)
        for s in range(steps+1):
            x=a+(c-a)*s/steps; y=b+(d-b)*s/steps
            for o in np.linspace(-(width-1)/2,(width-1)/2,max(1,width)):
                xx,yy=int(math.floor(x+nx*o)),int(math.floor(y+ny*o))
                if 0<=xx<GW and 0<=yy<GH: out.add((xx,yy))
    return raccorda(out)
def raccorda(out,libera=lambda x,y:True):
    """Celle che si toccano solo in diagonale: aggiunge una cella di raccordo, cosi' si passa sempre per un lato."""
    out=set(out); todo=list(out)
    while todo:
        x,y=todo.pop()
        for dx,dy in((1,1),(1,-1),(-1,1),(-1,-1)):
            if (x+dx,y+dy) in out and (x+dx,y) not in out and (x,y+dy) not in out:
                for c in ((x+dx,y),(x,y+dy)):   # la prima delle due celle che e' libera
                    if 0<=c[0]<GW and 0<=c[1]<GH and libera(*c): out.add(c); todo.append(c); break
    return out

# types: 0 grass 1 rock 2 vine 3 street 4 path(sentiero) 5 building 6 sea 7 scrub
typ=np.zeros((GH,GW),np.uint8)
typ[sea]=6
for t,p in ways:
    if t.get('landuse')=='vineyard' or t.get('crop')=='grape':
        for x,y in cells_in(p):
            if typ[y,x]==0: typ[y,x]=2
    if t.get('natural') in ('wood','scrub') or t.get('landuse')=='forest':
        for x,y in cells_in(p):
            if typ[y,x]==0: typ[y,x]=7
gy,gx=np.gradient(T)
steep=(np.hypot(gx,gy)>1.6)&(~sea)
typ[steep&(typ!=2)]=1
# fasce di vigna intorno al paese (artistico: nei dati OSM qui sono poche)
if LUOGO=='manarola' or not EDI: vx,vy=150,140
else:
    cc=[toG(*e['poly'][0]) for e in EDI['edifici']]; vx,vy=sum(a for a,b in cc)/len(cc),sum(b for a,b in cc)/len(cc)
YY,XX=np.mgrid[0:GH,0:GW]
dd=np.hypot(XX-vx,YY-vy)
slope=np.hypot(gx,gy)
if LUOGO!='la_spezia': typ[(typ==0)&(dd<150)&(slope>0.25)&(slope<1.6)&(T>6)]=2
typ[(T<=2)&(~sea)]=1

street=np.zeros((GH,GW),bool); trail=np.zeros((GH,GW),bool)
WID={'pedestrian':3,'residential':3,'tertiary':3,'unclassified':3,'service':3,'living_street':3,'footway':2,'steps':2,'path':2,'track':2,'cycleway':3}   # minimi: sentieri e scale 2, il resto 3
GALLERIE=[]   # gallerie lunghe: non si disegnano, collegano i due imbocchi (nel gioco: "Esci dalla galleria")
for t,p in ways:
    h=t.get('highway')
    if h not in WID or t.get('tunnel')=='culvert': continue
    if t.get('tunnel') in ('yes','building_passage') or t.get('covered')=='yes':
        L=sum(math.hypot(p[k][0]-p[k-1][0],p[k][1]-p[k-1][1]) for k in range(1,len(p)))
        if L>15: GALLERIE.append((t.get('name') or h,p[0],p[-1])); continue   # oltre 30 m
        # passaggio coperto corto sotto le case: diventa un vicolo percorribile
    cs=line_cells(p,WID[h])
    for x,y in cs:
        if sea[y,x]: continue
        if h in ('path','track'): trail[y,x]=True
        else: street[y,x]=True
# small pier / marina slipway: keep whatever OSM gives (man_made=pier)
for t,p in ways:
    if t.get('man_made') in ('pier','breakwater') or t.get('leisure')=='slipway':
        for x,y in (cells_in(p) if p[0]==p[-1] else line_cells(p,2)):
            street[y,x]=True; sea[y,x]=False
walk=street|trail
# niente strozzature: dove la strada e' larga 1 cella (in orizzontale o in verticale) si aggiunge la cella accanto
def sposta(m,dx,dy):
    o=np.zeros_like(m)
    o[max(dy,0):GH+min(dy,0),max(dx,0):GW+min(dx,0)]=m[max(-dy,0):GH+min(-dy,0),max(-dx,0):GW+min(-dx,0)]
    return o
for _ in range(3):
    for dx,dy in((1,0),(0,1)):
        stretta=walk&~sposta(walk,dx,dy)&~sposta(walk,-dx,-dy)
        avanti=sposta(stretta,dx,dy)&~sea; indietro=sposta(stretta&~sposta(~sea,-dx,-dy),-dx,-dy)&~sea
        for add,ddx,ddy in((avanti,dx,dy),(indietro,-dx,-dy)):
            da_strada=sposta(street,ddx,ddy)
            street|=add&da_strada; trail|=add&~da_strada
        walk=street|trail
for x,y in raccorda(zip(*np.nonzero(walk.T)))-set(zip(*np.nonzero(walk.T))):
    if sea[y,x]: continue
    if any(0<=x+dx<GW and 0<=y+dy<GH and street[y+dy,x+dx] for dx,dy in((1,0),(-1,0),(0,1),(0,-1))): street[y,x]=True
    else: trail[y,x]=True
walk=street|trail
# ---------- street heights: smooth continuous ramps ----------
Sh=np.where(walk,np.maximum(Tsm,1.0),0.0)
ys,xs=np.nonzero(walk)
idx={(x,y):k for k,(x,y) in enumerate(zip(xs,ys))}
pairs=[]
for k,(x,y) in enumerate(zip(xs,ys)):
    for dx,dy in((1,0),(0,1),(1,1),(1,-1)):
        j=idx.get((x+dx,y+dy))
        if j is not None: pairs.append((k,j,1.0 if dx==0 or dy==0 else 1.41))
pairs=np.array(pairs)
a=pairs[:,0].astype(int);b=pairs[:,1].astype(int);dist=pairs[:,2];PA,PB=a,b
h=Sh[ys,xs].copy(); target=np.maximum(Tsm[ys,xs],1.0)
istr=street[ys,xs]
lim=np.minimum(np.where(istr[a]&istr[b],0.3,0.5)*dist,0.5)
for it in range(2500):
    if it<2000: h+=0.006*(target-h)
    d=h[b]-h[a]
    ex=np.where(d>lim,d-lim,np.where(d<-lim,d+lim,0))
    corr=np.zeros_like(h); cnt=np.zeros_like(h)
    np.add.at(corr,a,ex/2); np.add.at(corr,b,-ex/2); np.add.at(cnt,a,1); np.add.at(cnt,b,1)
    h+=corr/np.maximum(cnt,1)*1.0
# quarti di blocco interi, poi vincolo esatto |salto|<=2 quarti (0,5 blocchi) tra vicine:
# inviluppo inferiore e superiore con pendenza 0,5 (la rampa si allunga invece del gradino), poi la media
def inviluppo(q,segno):
    q=q.copy()
    while True:
        v=q.copy()
        if segno<0: np.minimum.at(v,a,q[b]+2); np.minimum.at(v,b,q[a]+2)
        else: np.maximum.at(v,a,q[b]-2); np.maximum.at(v,b,q[a]-2)
        if (v==q).all(): return q
        q=v
hq=np.round(h*4).astype(np.int64)
hq=(inviluppo(hq,-1)+inviluppo(hq,1))//2
assert np.abs(hq[b]-hq[a]).max()<=2
h=hq/4
print('strade: scostamento dal terreno dopo le rampe: mediana %.2f, max %.1f blocchi'%(np.median(np.abs(h-target)),np.abs(h-target).max()))
Sh[ys,xs]=np.maximum(h,0.5)
print('max street jump',np.abs(np.round(h*4)[b]-np.round(h*4)[a]).max()/4)

# ---------- buildings ----------
PAL=['#E9B24A','#E2794F','#C9543B','#F3C69C','#E99A8A','#D8A23E','#B54F38','#F4DE9E','#A8C49A','#E8C3BE','#CF6A46','#EFDFC6','#93B7C6','#DD8E5B','#F0B37A']
bid=-np.ones((GH,GW),np.int32); blds=[]
# edifici: dal file reale se c'e' (OSM resta per strade, vigne e locali), altrimenti da osm.xml
if EDI:
    SRC=[({'building':e.get('tipo') or 'yes','_e':e},[toG(a,b) for a,b in e['poly']]) for e in EDI['edifici']]
else:
    SRC=ways
fonte_cnt={}
for t,p in SRC:
    if 'building' not in t or p[0]!=p[-1]: continue
    cs_all=[(x,y) for x,y in cells_in(p) if not sea[y,x]]
    cs=[(x,y) for x,y in cs_all if not walk[y,x]]
    if t.get('_e') and cs_all and len(cs)<0.5*len(cs_all):
        # edificio reale coperto quasi tutto da una strada OSM (es. campanile in piazza): vince l'edificio
        cs=[(x,y) for x,y in cs_all if bid[y,x]<0]
        for x,y in cs: street[y,x]=trail[y,x]=walk[y,x]=False
    if not cs:
        cx=int(sum(a for a,b in p)/len(p));cy=int(sum(b for a,b in p)/len(p))
        if 0<=cx<GW and 0<=cy<GH and not sea[cy,cx] and not walk[cy,cx] and bid[cy,cx]<0: cs=[(cx,cy)]
    cs=[(x,y) for x,y in cs if bid[y,x]<0]
    if not cs: continue
    try: lv=float(t.get('building:levels','0'))
    except: lv=0
    if not lv: lv=1 if t.get('building') in ('shed','garage','hut','roof','service') else 4
    gmin=min(T[y,x] for x,y in cs); gmax=max(T[y,x] for x,y in cs)
    # quanto e' alta la strada accanto (le case partono dalla strada)
    nb=[Sh[y+dy,x+dx] for x,y in cs for dx,dy in((1,0),(-1,0),(0,1),(0,-1)) if 0<=x+dx<GW and 0<=y+dy<GH and walk[y+dy,x+dx]]
    base=min([gmin]+nb) if nb else gmin
    e=t.get('_e')
    if e and e.get('quota_gronda') is not None:
        # quota vera della gronda (m s.l.m.): la casa e' gia' posata sul terreno reale
        roof=e['quota_gronda']/CELL; f='gronda'
        if roof<gmax+0.5: roof=gmax+0.5; f='gronda (alzata sopra il terreno)'
    elif e and e.get('piani'):
        b0=e['quota_terreno_min']/CELL if e.get('quota_terreno_min') is not None else base
        roof=max(b0+e['piani']*1.5, gmax+1.5); f='piani reali'
    else:
        roof=max(base+lv*1.5, gmax+1.5); f='stima'
    fonte_cnt[f]=fonte_cnt.get(f,0)+1
    k=len(blds); blds.append({'cells':cs,'roof':round(roof*4)/4,'lv':lv,'e':e,'gmin':gmin})
    for x,y in cs: bid[y,x]=k
print('edifici',len(blds),'tetto da:',fonte_cnt)
# controllo: edifici simbolo (quote in metri; il tetto nel mondo e' a passi di 50 cm)
for b in blds:
    e=b['e'] or {}
    tag=' '.join(str(e.get(k) or '') for k in ('nome','tipo','uso'))
    if any(s in tag for s in ('Chiesa','Campanile','stazione','Stazione','Oratorio','Cattedrale','Castello','Torre','Santuario','municipio')):
        print('  %-55s terreno %5.1f  tetto %5.1f m  altezza %4.1f m  (gronda CTR %s, piani %s)'%(
            tag.strip()[:55],b['gmin']*CELL,b['roof']*CELL,(b['roof']-b['gmin'])*CELL,e.get('quota_gronda'),e.get('piani')))
# colori: vicini sempre diversi
rnd=random.Random(5)
adj=[set() for _ in blds]
for y in range(GH):
    for x in range(GW):
        k=bid[y,x]
        if k<0: continue
        for dx,dy in((1,0),(0,1),(1,1),(1,-1),(2,0),(0,2)):
            if 0<=x+dx<GW and 0<=y+dy<GH:
                j=bid[y+dy,x+dx]
                if j>=0 and j!=k: adj[k].add(j);adj[j].add(k)
cols=[-1]*len(blds)
for k in sorted(range(len(blds)),key=lambda k:-len(adj[k])):
    used={cols[j] for j in adj[k]}
    opts=[c for c in range(len(PAL)) if c not in used] or list(range(len(PAL)))
    cols[k]=rnd.choice(opts)
for k,b in enumerate(blds):
    b['col']=cols[k]; b['shut']=rnd.choice([0,0,0,1,2])  # verdi, marroni, grigio-verdi
    b['roofc']=0 if rnd.random()<.8 else 1                # ardesia o cotto

# ---------- final top heights (quarter blocks) ----------
top=np.where(sea,-1.0,T.copy())
top[walk]=Sh[walk]
for k,b in enumerate(blds):
    for x,y in b['cells']: top[y,x]=b['roof']; typ[y,x]=5
typ[street]=3; typ[trail&~street]=4; typ[sea]=6
# dopo le case (che possono aver preso celle di strada): di nuovo raccordo delle diagonali e niente strozzature,
# solo su celle libere; la cella nuova prende la quota media delle celle di strada che collega
def aggiungi(x,y,fonti):
    if typ[y,x] in (5,6) or not fonti: return
    typ[y,x]=3 if any(typ[b_,a_]==3 for a_,b_ in fonti) else 4
    top[y,x]=round(sum(top[b_,a_] for a_,b_ in fonti)/len(fonti)*4)/4
    walk[y,x]=True; (street if typ[y,x]==3 else trail)[y,x]=True
for _ in range(3):
    camm=(typ==3)|(typ==4); celle=set(zip(*np.nonzero(camm.T)))
    for x,y in raccorda(celle,lambda x,y:typ[y,x] not in (5,6))-celle:
        aggiungi(x,y,[(x+dx,y+dy) for dx,dy in((1,0),(-1,0),(0,1),(0,-1),(1,1),(1,-1),(-1,1),(-1,-1)) if (x+dx,y+dy) in celle])
    for dx,dy in((1,0),(0,1)):
        camm=(typ==3)|(typ==4)
        for y,x in np.argwhere(camm&~sposta(camm,dx,dy)&~sposta(camm,-dx,-dy)):
            for sx,sy in((dx,dy),(-dx,-dy)):
                if 0<=x+sx<GW and 0<=y+sy<GH and typ[y+sy,x+sx] not in (5,6): aggiungi(x+sx,y+sy,[(x,y)]); break
# raccordo del prato: 3 anelli intorno alla strada, ciascuno entro 0,5 blocchi dall'anello prima
fisso=walk.copy(); libero=(~walk)&(~sea)&(bid<0)
for ring in range(3):
    lo_=np.full((GH,GW),np.inf); hi_=np.full((GH,GW),-np.inf)
    for dx,dy in((1,0),(-1,0),(0,1),(0,-1)):
        sh=np.roll(np.roll(np.where(fisso,top,np.nan),dy,0),dx,1)
        if dy==1: sh[0,:]=np.nan
        if dy==-1: sh[-1,:]=np.nan
        if dx==1: sh[:,0]=np.nan
        if dx==-1: sh[:,-1]=np.nan
        lo_=np.fmin(lo_,sh); hi_=np.fmax(hi_,sh)
    anello=libero&~fisso&np.isfinite(lo_)
    nuovo=np.clip(top,hi_-0.5,lo_+0.5); nuovo=np.where(hi_-0.5>lo_+0.5,(lo_+hi_)/2,nuovo)
    top[anello]=np.round(nuovo[anello]*4)/4; fisso|=anello
# terreno attaccato alla strada: niente buchi sotto le rampe
topq=np.round(top*4).astype(np.int32)+8   # +8 cosi' il mare (-1) diventa 4
assert topq.min()>=0 and topq.max()<65535

# ---------- POIs ----------
def cat(t):
    if t.get('tourism') in ('hotel','guest_house','apartment','hostel'): return 'sleep'
    if t.get('amenity') in ('restaurant','cafe','fast_food','ice_cream','bar','pub'): return 'eat'
    if 'shop' in t: return 'shop'
    if t.get('amenity') in ('place_of_worship','ferry_terminal') or t.get('tourism') in ('artwork','attraction','viewpoint','information') or t.get('historic') or t.get('railway') in ('station',) or t.get('leisure')=='playground': return 'see'
    return None
KIND={'hotel':'Hotel','guest_house':'Affittacamere','apartment':'Casa vacanze','hostel':'Ostello','restaurant':'Ristorante','cafe':'Bar','fast_food':'Cibo da asporto','ice_cream':'Gelateria','bar':'Bar','pub':'Pub','place_of_worship':'Chiesa','artwork':'Opera d\'arte','attraction':'Attrazione','viewpoint':'Belvedere','information':'Punto informazioni','memorial':'Monumento','station':'Stazione','playground':'Parco giochi','ferry_terminal':'Battelli'}
pois=[]
def addpoi(t,lat,lon):
    c=cat(t)
    if not c or 'name' not in t: return
    x,y=toG(lat,lon)
    if not(0<=x<GW and 0<=y<GH): return
    v=t.get('tourism') or t.get('amenity') or t.get('historic') or t.get('railway') or t.get('leisure')
    kind=KIND.get(v, 'Negozio' if c=='shop' else v)
    if c=='shop': kind={'gift':'Souvenir','clothes':'Abbigliamento','deli':'Gastronomia','wine':'Enoteca','supermarket':'Supermercato','convenience':'Alimentari','art':'Galleria d\'arte','ticket':'Biglietti battelli','outdoor':'Trekking','sports':'Sport','pottery':'Ceramiche','tobacco':'Tabaccheria','hairdresser':'Parrucchiere'}.get(t['shop'],'Negozio')
    pois.append({'n':t['name'],'c':c,'k':kind,'x':round(x,1),'y':round(y,1)})
for nd in r.iter('node'):
    t=tg(nd)
    if t: addpoi(t,float(nd.get('lat')),float(nd.get('lon')))
for t,p in ways:
    if 'name' in t and (t.get('amenity')=='place_of_worship' or t.get('leisure')=='playground'):
        lat=N-(sum(b for a,b in p)/len(p))*CELL/latM; lon=W+(sum(a for a,b in p)/len(p))*CELL/lonM
        addpoi(t,lat,lon)
# dedupe stesso nome vicino
seen=[];P=[]
for p in pois:
    if any(q['n']==p['n'] and abs(q['x']-p['x'])+abs(q['y']-p['y'])<4 for q in P): continue
    P.append(p)
pois=P
print('pois',len(pois),{c:sum(1 for p in pois if p['c']==c) for c in('sleep','eat','shop','see')})

def nearest_walk(lat,lon,maxr=25):
    x0,y0=toG(lat,lon);best=None;bd=1e9
    for y in range(max(0,int(y0)-maxr),min(GH,int(y0)+maxr)):
        for x in range(max(0,int(x0)-maxr),min(GW,int(x0)+maxr)):
            if walk[y,x]:
                d=math.hypot(x+.5-x0,y+.5-y0)
                if d<bd: bd=d;best=(x,y)
    return best,(x0,y0)
ROUTE=[('Stazione','Si arriva in treno: dal binario parte la lunga galleria pedonale verso il paese.',44.10492,9.7292,44.1068,9.7290),
 ('Uscita della galleria','Qui si sbuca in paese. A destra si sale verso la chiesa, a sinistra si scende verso la marina.',44.10715,9.72905,44.1076,9.7303),
 ('Chiesa di San Lorenzo','In cima al paese, sulla piazza: la chiesa del 1338 e il campanile staccato.',44.10752,9.73002,44.1076,9.7303),
 ('Via Birolli','La via principale: scende verso il mare tra bar, ristoranti e negozi.',44.10690,9.72835,44.1066,9.7272),
 ('La marina','Le barche tirate a secco in piazza e la rampa che scende in acqua.',44.10662,9.72735,44.1063,9.7262),
 ('Nessun Dorma','Il sentiero lungo la costa porta a Punta Bonfiglio: da qui il tramonto sulle altre Cinque Terre.',44.10745,9.72600,44.1066,9.7275)]
if LUOGO!='manarola':
    NOMI={'monterosso':'Monterosso al Mare','vernazza':'Vernazza','corniglia':'Corniglia','riomaggiore':'Riomaggiore','la_spezia':'La Spezia'}
    ch=[e for e in (EDI or {}).get('edifici',[]) if 'Luogo di culto' in (e.get('uso') or '')]
    ch=max(ch,key=lambda e:e['area_m2']) if ch else None
    la_,lo_=(sum(a for a,b in ch['poly'])/len(ch['poly']),sum(b for a,b in ch['poly'])/len(ch['poly'])) if ch else ((S+N)/2,(W+E)/2)
    ROUTE=[('Centro di '+NOMI.get(LUOGO,LUOGO),'Punto di partenza: '+(ch.get('nome') or 'la chiesa principale' if ch else 'il centro del paese')+'.',la_,lo_,la_,lo_)]
route=[]
for name,txt,lat,lon,llat,llon in ROUTE:
    (wx,wy),_=nearest_walk(lat,lon)
    lx,ly=toG(llat,llon)
    route.append({'n':name,'t':txt,'x':wx,'y':wy,'lx':round(lx,1),'ly':round(ly,1)})
print(route)
# ---------- controllo: tappe collegate solo da strada/sentiero, salti <=0,5 blocchi ----------
from collections import deque
cam=(typ==3)|(typ==4)
def imbocco(pt,r=6):
    x0,y0=int(pt[0]),int(pt[1]);c=[(math.hypot(x-x0,y-y0),x,y) for y in range(max(0,y0-r),min(GH,y0+r+1)) for x in range(max(0,x0-r),min(GW,x0+r+1)) if cam[y,x]]
    return min(c)[1:] if c else None
SALTI={}
for nome,p0,p1 in GALLERIE:
    a_,b_=imbocco(p0),imbocco(p1)
    if a_ and b_: SALTI.setdefault(a_,[]).append(b_); SALTI.setdefault(b_,[]).append(a_); print('galleria come collegamento:',nome,a_,'<->',b_)
def raggiungibili(x0,y0):
    seen=np.zeros((GH,GW),bool); seen[y0,x0]=True; q=deque([(x0,y0)])
    while q:
        x,y=q.popleft()
        for dx,dy in((1,0),(-1,0),(0,1),(0,-1)):
            nx,ny=x+dx,y+dy
            if 0<=nx<GW and 0<=ny<GH and cam[ny,nx] and not seen[ny,nx] and abs(top[ny,nx]-top[y,x])<=0.5+1e-6:
                seen[ny,nx]=True; q.append((nx,ny))
        for nx,ny in SALTI.get((x,y),[]):
            if not seen[ny,nx]: seen[ny,nx]=True; q.append((nx,ny))
    return seen
ok0=raggiungibili(route[0]['x'],route[0]['y'])
staccate=[r['n'] for r in route[1:] if not ok0[r['y'],r['x']]]
print('itinerario:',len(route),'tappe;','tutte collegate alla prima' if not staccate else 'NON collegate alla prima: '+', '.join(staccate))
for r in route: print('   %-24s cella %s, raggiungibile: %s'%(r['n'],(r['x'],r['y']),bool(ok0[r['y'],r['x']])))
# larghezza: per ogni cella percorribile la corsa piu' corta tra orizzontale e verticale
def corse(m):
    out=np.zeros(m.shape,int)
    for y in range(m.shape[0]):
        x=0
        while x<m.shape[1]:
            if m[y,x]:
                x1=x
                while x1<m.shape[1] and m[y,x1]: x1+=1
                out[y,x:x1]=x1-x; x=x1
            else: x+=1
    return out
larg=np.minimum(corse(cam),corse(cam.T).T)
print('larghezza minima trovata: %d celle (%d m); celle larghe 1: %d su %d'%(larg[cam].min(),larg[cam].min()*CELL,(larg[cam]==1).sum(),cam.sum()))

# ---------- export ----------
b64=lambda a:base64.b64encode(a.tobytes()).decode()
out={'GW':GW,'GH':GH,'top':b64(topq.astype('<u2')),'typ':b64(typ.astype(np.uint8)),
     'bid':b64((bid+1).astype('<u2')),'pal':PAL,
     'b':[[b['roof'],b['col'],b['shut'],b['roofc']] for b in blds],
     'pois':pois,'route':route}
SUF='' if LUOGO=='manarola' else '_'+LUOGO   # Manarola: world.json come prima
json.dump(out,open(os.path.join(D,'world'+SUF+'.json'),'w'),separators=(',',':'))
print('bytes',len(json.dumps(out)),'buildings',len(blds))
# anteprima dall'alto
im=Image.new('RGB',(GW*3,GH*3));pp=im.load()
TC={0:(110,150,70),1:(140,135,125),2:(90,120,50),3:(225,215,195),4:(190,170,130),6:(40,100,150),7:(70,110,60)}
for y in range(GH):
    for x in range(GW):
        c=TC.get(int(typ[y,x]),(0,0,0))
        if typ[y,x]==5: c=tuple(int(PAL[blds[bid[y,x]]['col']][i:i+2],16) for i in(1,3,5))
        for a2 in range(3):
            for b2 in range(3): pp[x*3+a2,y*3+b2]=c
im.save(os.path.join(D,'anteprima'+SUF+'.png'))
jj=np.abs(h[PB]-h[PA])
print('pairs',len(jj),'>0.5:',(jj>0.5).sum(),'>1:',(jj>1).sum())
bad=[(xs[PA[k]],ys[PA[k]],jj[k]) for k in np.nonzero(jj>1)[0][:10]]
print(bad)
