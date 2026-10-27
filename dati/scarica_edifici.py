"""Scarica gli edifici reali dei borghi e li salva in ../🗺️ dati/<luogo>.json

Fonti (in ordine di priorita'):
  1. Regione Liguria, "Edifici e Manufatti - CTR 1:5000 2007/2013 3D / DB Topografico"
     (WFS M2237, layer L8178): sagoma + quota di gronda (Z dei vertici, m s.l.m.)
  2. Regione Liguria, "DTM - Modello Digitale del Terreno ed. 2023" (WCS M2056, passo 5 m):
     quota del terreno sotto ogni edificio
  3. OpenStreetMap (Overpass): building:levels / height per controllo e per completare
  4. Ministero dell'Ambiente, LiDAR Liguria 1 m: provato, se risponde (vedi README)

Uso:  python3 scarica_edifici.py [luogo ...]      (senza argomenti: tutti)
Serve: numpy, pillow. Rispetta i limiti: pause tra le richieste, nessuna richiesta parallela.
"""
import io, json, math, os, subprocess, sys, time, urllib.parse
from datetime import date
import numpy as np
from PIL import Image

D = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '🗺️ dati')
UA = 'CinqueTerreBlocchi/0.1 (prototipo personale, dati pubblici)'
# S, W, N, E: il centro abitato di ogni luogo (Manarola = stesso bbox di gen.py)
LUOGHI = {
    'monterosso':  (44.1400, 9.6420, 44.1505, 9.6610),
    'vernazza':    (44.1320, 9.6790, 44.1380, 9.6880),
    'corniglia':   (44.1160, 9.7050, 44.1230, 9.7165),
    'manarola':    (44.1038, 9.7243, 44.1096, 9.7328),
    'riomaggiore': (44.0960, 9.7330, 44.1030, 9.7425),
    'la_spezia':   (44.0990, 9.8100, 44.1160, 9.8420),
}
WFS = 'https://geoservizi.regione.liguria.it/geoserver/M2237/ows'
WCS = 'https://geoservizi.regione.liguria.it/geoserver/M2056/wcs'
OVERPASS = 'https://overpass-api.de/api/interpreter'
M_PIANO = 3.0          # metri per piano per stimare i piani dall'altezza
OGGI = date.today().isoformat()


def get(url, data=None, tries=10, wait=6, timeout=180):
    """GET/POST con ripetizioni: il proxy della Regione da' spesso 500/502 a caso."""
    # curl usa i certificati di sistema (la Python di python.org spesso non li ha)
    cmd = ['curl', '-sS', '-f', '-m', str(timeout), '-A', UA, url]
    if data is not None:
        cmd[1:1] = ['--data-binary', '@-']
    last = None
    for i in range(tries):
        try:
            r = subprocess.run(cmd, input=data, capture_output=True)
            if r.returncode:
                raise IOError(r.stderr.decode(errors='ignore').strip())
            b = r.stdout
            if b[:200].lstrip().startswith((b'<!DOCTYPE HTML', b'<html')):
                raise IOError('risposta HTML (errore proxy)')
            return b
        except Exception as e:
            last = e
            time.sleep(wait * (i + 1))
    raise IOError(f'{url[:90]}... non risponde: {last}')


def tiles(S, W, N, E, step=0.006):
    """Divide il bbox in tasselli, cosi' nessuna richiesta WFS e' troppo grande."""
    ys = list(np.arange(S, N, step)) + [N]
    xs = list(np.arange(W, E, step)) + [E]
    for a, b in zip(ys, ys[1:]):
        for c, d in zip(xs, xs[1:]):
            yield a, c, b, d


# ---------- 1. edifici CTR 3D della Regione ----------
def regione_edifici(S, W, N, E):
    feats = {}
    for s, w, n, e in tiles(S, W, N, E):
        q = urllib.parse.urlencode({'service': 'WFS', 'version': '1.0.0', 'request': 'GetFeature',
                                    'typeName': 'M2237:L8178', 'srsName': 'EPSG:4326',
                                    'bbox': f'{w},{s},{e},{n},EPSG:4326', 'maxFeatures': 20000,
                                    'outputFormat': 'application/json'})
        js = json.loads(get(f'{WFS}?{q}'))
        for f in js['features']:
            feats[f['properties']['id']] = f
        time.sleep(1)
    return list(feats.values())


# ---------- 2. DTM 2023 della Regione ----------
def wgs84_to_3003(lat, lon):
    """WGS84 -> Monte Mario / Italy zone 1 (EPSG:3003, sistema nativo del DTM).
    Helmert inverso dei parametri EPSG Roma40->WGS84, poi Trasversa di Mercatore (precisione ~1-2 m)."""
    a, f = 6378137.0, 1 / 298.257223563
    e2 = f * (2 - f)
    la, lo = math.radians(lat), math.radians(lon)
    n = a / math.sqrt(1 - e2 * math.sin(la) ** 2)
    X, Y, Z = n * math.cos(la) * math.cos(lo), n * math.cos(la) * math.sin(lo), n * (1 - e2) * math.sin(la)
    tx, ty, tz, rx, ry, rz, s = -104.1, -49.1, -9.9, 0.971, -2.917, 0.714, -11.68
    k = math.pi / 180 / 3600
    rx, ry, rz, m = rx * k, ry * k, rz * k, 1 + s * 1e-6
    X, Y, Z = X - tx, Y - ty, Z - tz
    X, Y, Z = (X + rz * Y - ry * Z) / m, (-rz * X + Y + rx * Z) / m, (ry * X - rx * Y + Z) / m
    a, f = 6378388.0, 1 / 297.0                      # ellissoide Internazionale 1924
    e2 = f * (2 - f)
    p = math.hypot(X, Y)
    lo, la = math.atan2(Y, X), math.atan2(Z, p * (1 - e2))
    for _ in range(6):
        n = a / math.sqrt(1 - e2 * math.sin(la) ** 2)
        la = math.atan2(Z + e2 * n * math.sin(la), p)
    k0, ep2 = 0.9996, e2 / (1 - e2)
    n = a / math.sqrt(1 - e2 * math.sin(la) ** 2)
    T, C, A = math.tan(la) ** 2, ep2 * math.cos(la) ** 2, (lo - math.radians(9.0)) * math.cos(la)
    M = a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * la
             - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * math.sin(2 * la)
             + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * math.sin(4 * la) - (35 * e2 ** 3 / 3072) * math.sin(6 * la))
    x = 1500000.0 + k0 * n * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120)
    y = k0 * (M + n * math.tan(la) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24
                                       + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720))
    return x, y


class DTM:
    """DTM scaricato nel sistema nativo EPSG:3003 a passo 5 m: niente ricampionamento lato server.
    (Chiesto in EPSG:4326 il GeoTIFF arriva senza georeferenziazione e risulta spostato.)"""
    PASSO = 5.0

    def __init__(self, S, W, N, E):
        xs, ys = zip(*[wgs84_to_3003(a, b) for a in (S, N) for b in (W, E)])
        P = self.PASSO
        self.x0, self.x1 = math.floor((min(xs) - 50) / P) * P, math.ceil((max(xs) + 50) / P) * P
        self.y0, self.y1 = math.floor((min(ys) - 50) / P) * P, math.ceil((max(ys) + 50) / P) * P
        self.w, self.h = int((self.x1 - self.x0) / P), int((self.y1 - self.y0) / P)
        q = urllib.parse.urlencode({'service': 'WCS', 'version': '1.0.0', 'request': 'GetCoverage',
                                    'coverage': 'M2056:L6952', 'crs': 'EPSG:3003',
                                    'bbox': f'{self.x0},{self.y0},{self.x1},{self.y1}',
                                    'width': self.w, 'height': self.h, 'format': 'GeoTIFF'})
        b = get(f'{WCS}?{q}')
        if not b.startswith((b'MM', b'II')):
            raise IOError('il DTM non e\' un GeoTIFF: ' + b[:200].decode(errors='ignore'))
        self.z = np.asarray(Image.open(io.BytesIO(b)), dtype=np.float64)
        # nodata (-32767, mare) -> NaN
        self.z[(self.z > 3000) | (self.z < -50)] = np.nan

    def at(self, lat, lon):
        X, Y = wgs84_to_3003(lat, lon)
        fx = (X - self.x0) / self.PASSO - .5
        fy = (self.y1 - Y) / self.PASSO - .5
        x, y = int(math.floor(fx)), int(math.floor(fy))
        u, v = fx - x, fy - y
        x, y = min(max(x, 0), self.w - 2), min(max(y, 0), self.h - 2)
        z = self.z
        return (z[y, x] * (1 - u) * (1 - v) + z[y, x + 1] * u * (1 - v)
                + z[y + 1, x] * (1 - u) * v + z[y + 1, x + 1] * u * v)


def inpoly(x, y, p):
    c = False
    j = len(p) - 1
    for i in range(len(p)):
        (xi, yi), (xj, yj) = p[i], p[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            c = not c
        j = i
    return c


def con_bbox(pl):
    xs = [x for x, y in pl]
    ys = [y for x, y in pl]
    return min(xs), min(ys), max(xs), max(ys), pl


def dentro(x, y, pb):
    """inpoly con controllo veloce del riquadro (pb = con_bbox(...))."""
    return pb[0] <= x <= pb[2] and pb[1] <= y <= pb[3] and inpoly(x, y, pb[4])


def punti_interni(poly, passo_m=1.5):
    """Vertici + griglia interna (lat, lon) per campionare il terreno sotto la sagoma."""
    lats = [a for a, b in poly]
    lons = [b for a, b in poly]
    dla = passo_m / 111320.0
    dlo = passo_m / (111320.0 * math.cos(math.radians(lats[0])))
    pts = list(poly)
    pl = [(b, a) for a, b in poly]
    for la in np.arange(min(lats) + dla / 2, max(lats), dla):
        for lo in np.arange(min(lons) + dlo / 2, max(lons), dlo):
            if inpoly(lo, la, pl):
                pts.append((la, lo))
    return pts


# ---------- 3. OpenStreetMap ----------
def osm_edifici(S, W, N, E):
    q = f'[out:json][timeout:120];(way["building"]({S},{W},{N},{E});relation["building"]({S},{W},{N},{E}););out tags geom;'
    js = json.loads(get(OVERPASS, data=urllib.parse.urlencode({'data': q}).encode(), tries=4, wait=20))
    out = []
    for el in js['elements']:
        if el['type'] == 'way':
            ring = [(g['lat'], g['lon']) for g in el.get('geometry', [])]
        else:
            outer = [m for m in el.get('members', []) if m.get('role') == 'outer' and 'geometry' in m]
            ring = [(g['lat'], g['lon']) for g in outer[0]['geometry']] if outer else []
        if len(ring) >= 4 and ring[0] == ring[-1]:
            out.append({'id': f"{el['type']}/{el['id']}", 'tags': el.get('tags', {}), 'poly': ring})
    return out


def num(v):
    try:
        return float(str(v).replace(',', '.').split()[0].rstrip('m'))
    except Exception:
        return None


def area_m2(poly):
    lat0 = poly[0][0]
    k = 111320.0 * math.cos(math.radians(lat0))
    xy = [(lo * k, la * 111320.0) for la, lo in poly]
    return abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(xy, xy[1:]))) / 2


def centroide(poly):
    return (sum(a for a, b in poly[:-1]) / (len(poly) - 1), sum(b for a, b in poly[:-1]) / (len(poly) - 1))


# ---------- assemblaggio ----------
ALTI_OK = ('Chiesa', 'Campanile', 'Torre', 'Castello')


def costruisci(luogo, S, W, N, E, lidar_ok):
    print(f'\n== {luogo}')
    reg = regione_edifici(S, W, N, E)
    print('  Regione CTR 3D:', len(reg), 'edifici')
    dtm = DTM(S, W, N, E)
    print('  DTM 2023:', dtm.z.shape, 'quote', np.nanmin(dtm.z), '-', np.nanmax(dtm.z))
    time.sleep(1)
    try:
        osm = osm_edifici(S, W, N, E)
        print('  OSM:', len(osm), 'edifici')
    except IOError as e:
        osm = []
        print('  OSM non disponibile:', e)
    time.sleep(2)

    # indice OSM per abbinamento: centroide della sagoma regionale dentro l'edificio OSM (o viceversa)
    osm_pl = [con_bbox([(b, a) for a, b in o['poly']]) for o in osm]
    osm_c = [centroide(o['poly']) for o in osm]
    usati = set()

    def abbina(poly):
        la, lo = centroide(poly)
        for k, pl in enumerate(osm_pl):
            if dentro(lo, la, pl):
                return k
        rp = con_bbox([(b, a) for a, b in poly])
        for k, (cla, clo) in enumerate(osm_c):
            if dentro(clo, cla, rp):
                return k
        return None

    edifici = []
    for f in reg:
        p = f['properties']
        g = f['geometry']
        ring = g['coordinates'][0] if g['type'] == 'Polygon' else g['coordinates'][0][0]
        poly = [(round(c[1], 7), round(c[0], 7)) for c in ring]
        zs = [c[2] for c in ring if len(c) > 2]
        gronda = round(max(zs), 2) if zs and max(zs) > 0 else None
        terreno = [dtm.at(a, b) for a, b in punti_interni(poly)]
        terreno = [t for t in terreno if not math.isnan(t)]
        e = {'id': 'RL:' + p['id'], 'poly': poly, 'area_m2': round(area_m2(poly), 1),
             'tipo': p.get('def_tipo_edil'), 'uso': p.get('def_cat_uso'),
             'quota_gronda': gronda,
             'quota_terreno_min': round(min(terreno), 1) if terreno else None,
             'quota_terreno_max': round(max(terreno), 1) if terreno else None,
             'fonte_sagoma': 'Regione Liguria CTR 3D', 'note': []}
        k = abbina(poly)
        if k is not None:
            usati.add(k)
            t = osm[k]['tags']
            e['osm_id'] = osm[k]['id']
            e['osm_piani'] = num(t.get('building:levels'))
            e['osm_altezza'] = num(t.get('height'))
            if t.get('name'):
                e['nome'] = t['name']
        edifici.append(e)

    # edifici solo in OSM (es. costruiti dopo la CTR o mancanti): sagoma OSM, quota terreno dal DTM
    reg_pl = [con_bbox([(b, a) for a, b in e['poly']]) for e in edifici]
    doppioni = 0
    for k, o in enumerate(osm):
        if k in usati or o['tags'].get('building') in ('no', 'construction', 'ruins', 'roof'):
            continue
        # se la sagoma OSM e' gia' coperta per meta' da edifici CTR e' un doppione, non un edificio nuovo
        pts = punti_interni(o['poly'], 1.0)
        coperti = sum(1 for la, lo in pts if any(dentro(lo, la, pl) for pl in reg_pl))
        if coperti >= 0.5 * len(pts):
            doppioni += 1
            continue
        terreno = [dtm.at(a, b) for a, b in punti_interni(o['poly'])]
        terreno = [t for t in terreno if not math.isnan(t)]
        t = o['tags']
        edifici.append({'id': 'OSM:' + o['id'], 'poly': [(round(a, 7), round(b, 7)) for a, b in o['poly']],
                        'area_m2': round(area_m2(o['poly']), 1), 'tipo': t.get('building'), 'uso': None,
                        'quota_gronda': None,
                        'quota_terreno_min': round(min(terreno), 1) if terreno else None,
                        'quota_terreno_max': round(max(terreno), 1) if terreno else None,
                        'fonte_sagoma': 'OpenStreetMap', 'osm_id': o['id'],
                        'osm_piani': num(t.get('building:levels')), 'osm_altezza': num(t.get('height')),
                        'nome': t.get('name'), 'note': ['solo in OSM, non nella CTR']})

    # altezza, piani, controlli di qualita'
    for e in edifici:
        g, tmin, tmax = e['quota_gronda'], e['quota_terreno_min'], e['quota_terreno_max']
        alto_ok = any(s in (e.get('tipo') or '') for s in ALTI_OK)
        h = None
        if g is not None and tmin is not None:
            h = round(g - tmin, 1)
            e['altezza_monte'] = round(g - tmax, 1)   # facciata verso monte (puo' essere bassa nei borghi a terrazze)
            if h < 2.0:
                e['note'].append(f'gronda solo {h} m sopra il terreno: incoerente (DTM a 5 m o sagoma su muro/terrazza)')
                h = None
            elif h > 45 and not alto_ok:
                e['note'].append(f'altezza {h} m sospetta')
        if h is not None:
            e['altezza'] = h
            e['fonte_altezza'] = 'Regione: quota gronda CTR 3D - DTM 2023 (punto piu\' basso della sagoma)'
        elif e.get('osm_altezza'):
            e['altezza'] = e['osm_altezza']
            e['fonte_altezza'] = 'OSM height'
        elif e.get('osm_piani'):
            e['altezza'] = round(e['osm_piani'] * M_PIANO, 1)
            e['fonte_altezza'] = 'OSM building:levels x 3 m'
        else:
            e['altezza'] = None
            e['fonte_altezza'] = None
            e['note'].append('altezza mancante in tutte le fonti')
        if e['altezza'] is not None:
            e['piani'] = int(e['osm_piani']) if e.get('osm_piani') else max(1, round(e['altezza'] / M_PIANO))
            if e.get('quota_gronda') is None and tmin is not None:
                e['quota_gronda'] = round(tmin + e['altezza'], 1)
        else:
            e['piani'] = None
        # confronto con OSM
        if h is not None and e.get('osm_piani'):
            if abs(e['osm_piani'] * M_PIANO - h) > 6:
                e['note'].append(f"OSM dice {e['osm_piani']:g} piani, la CTR {h} m: da verificare")
        if tmin is None:
            e['note'].append('quota del terreno mancante (fuori DTM o mare)')
        if e['area_m2'] < 6:
            e['note'].append('sagoma molto piccola (< 6 m2)')

    n = len(edifici)
    q = {
        'edifici': n,
        'da_regione': sum(1 for e in edifici if e['fonte_sagoma'].startswith('Regione')),
        'solo_osm': sum(1 for e in edifici if e['fonte_sagoma'] == 'OpenStreetMap'),
        'con_altezza': sum(1 for e in edifici if e['altezza'] is not None),
        'altezza_da_regione': sum(1 for e in edifici if (e['fonte_altezza'] or '').startswith('Regione')),
        'altezza_da_osm': sum(1 for e in edifici if (e['fonte_altezza'] or '').startswith('OSM')),
        'senza_altezza': sum(1 for e in edifici if e['altezza'] is None),
        'con_note': sum(1 for e in edifici if e['note']),
        'abbinati_osm': sum(1 for e in edifici if e.get('osm_id') and e['fonte_sagoma'].startswith('Regione')),
        'doppioni_osm_scartati': doppioni,
    }
    print('  qualita\':', q)
    out = {
        'luogo': luogo, 'bbox': {'S': S, 'W': W, 'N': N, 'E': E}, 'crs': 'EPSG:4326 (lat, lon); quote m s.l.m.',
        'generato': OGGI,
        'formato': 'poly = [[lat, lon], ...] chiuso. Per gen.py: piani -> building:levels; '
                   'quota_terreno_min/quota_gronda permettono di posare l\'edificio alla quota vera.',
        'fonti': [
            {'nome': 'Regione Liguria - Edifici e Manufatti CTR 1:5000 2007/2013 II ed. 3D / DB Topografico',
             'servizio': WFS + ' (layer M2237:L8178)', 'dati': '2007-2013', 'scaricato': OGGI,
             'uso': 'sagoma, tipo, uso, quota di gronda (Z dei vertici)',
             'licenza': 'dati aperti Regione Liguria (servizio: Fees/AccessConstraints NONE); citare la fonte'},
            {'nome': 'Regione Liguria - DTM Modello Digitale del Terreno ed. 2023 (passo 5 m)',
             'servizio': WCS + ' (M2056:L6952)', 'dati': '2023', 'scaricato': OGGI,
             'uso': 'quota del terreno sotto la sagoma',
             'licenza': 'dati aperti Regione Liguria; citare la fonte'},
            {'nome': 'OpenStreetMap', 'servizio': OVERPASS, 'dati': OGGI, 'scaricato': OGGI,
             'uso': 'controllo piani/altezze, edifici mancanti nella CTR',
             'licenza': 'ODbL - "© OpenStreetMap contributors"'},
            {'nome': 'Ministero dell\'Ambiente - LiDAR Liguria 1 m', 'servizio': 'wms.pcn.minambiente.it',
             'uso': 'non usato' if not lidar_ok else 'controllo', 'scaricato': OGGI,
             'stato': 'provato il ' + OGGI + ': ' + ('risponde' if lidar_ok else 'DTM vuoto, DSM 503')},
        ],
        'qualita': q,
        'edifici': edifici,
    }
    with open(os.path.join(D, f'{luogo}.json'), 'w') as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(',', ':'))
    return q


if __name__ == '__main__':
    scelti = sys.argv[1:] or list(LUOGHI)
    lidar_ok = os.environ.get('LIDAR_OK') == '1'
    riepilogo = {}
    for l in scelti:
        try:
            riepilogo[l] = costruisci(l, *LUOGHI[l], lidar_ok)
        except IOError as e:
            print(f'  {l}: ERRORE {e}')
            riepilogo[l] = {'errore': str(e)}
    print(json.dumps(riepilogo, indent=1, ensure_ascii=False))
