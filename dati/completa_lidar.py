"""Completa e controlla ../🗺️ dati/<luogo>.json con il LiDAR 1 m del Ministero dell'Ambiente.

Il WMS restituisce le quote solo punto per punto (GetFeatureInfo text/plain), quindi si interroga:
  - ogni edificio senza altezza o con dati incoerenti: DSM (tetto) e DTM (terreno) nel centroide
    e DTM sui vertici -> altezza = DSM - DTM minimo
  - un campione di edifici con altezza CTR: confronto DSM nel centroide con la quota di gronda
Una richiesta ogni 0,5 s. Il LiDAR copre solo parte della regione (fasce fluviali): fuori copertura
non restituisce valori e l'edificio resta segnalato.

Uso:  python3 completa_lidar.py [luogo ...]   (CAMPIONE=25 di default)
"""
import json, math, os, random, re, sys, time
from datetime import date
from scarica_edifici import D, LUOGHI, M_PIANO, centroide, get

WMS = 'http://wms.pcn.minambiente.it/ogc?map=/ms_ogc/WMS_v1.3/servizi-LiDAR/LIDAR_LIGURIA.map'
DTM, DSM = 'EL.LIDAR.LIGURIA.1x1.DTM', 'EL.LIDAR.LIGURIA.1x1.DSM_FIRST'
CAMPIONE = int(os.environ.get('CAMPIONE', 25))
OGGI = date.today().isoformat()
richieste = 0


def quota(layer, lat, lon):
    global richieste
    d = 0.00005
    url = (f'{WMS}&SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo&LAYERS={layer}&QUERY_LAYERS={layer}'
           f'&STYLES=&SRS=EPSG:4326&BBOX={lon - d},{lat - d},{lon + d},{lat + d}&WIDTH=11&HEIGHT=11&X=5&Y=5'
           '&INFO_FORMAT=text/plain&FEATURE_COUNT=1')
    time.sleep(0.5)
    richieste += 1
    try:
        t = get(url, tries=3, wait=5, timeout=60).decode(errors='ignore')
    except IOError:
        return None
    m = re.findall(r'Stretched value;Pixel Value;\s*[\d.]+;(-?[\d.]+);', t)
    if not m:
        return None
    v = float(m[-1])
    return v if -50 < v < 3000 else None


def lidar_edificio(e):
    la, lo = centroide(e['poly'])
    tetto = quota(DSM, la, lo)
    if tetto is None:
        return None
    vert = e['poly'][:-1]
    passo = max(1, len(vert) // 2)
    terreni = [quota(DTM, a, b) for a, b in [(la, lo)] + vert[::passo]]
    terreni = [t for t in terreni if t is not None]
    if not terreni:
        return None
    return round(tetto, 2), round(min(terreni), 2)


def completa(luogo):
    path = os.path.join(D, f'{luogo}.json')
    d = json.load(open(path))
    E = d['edifici']
    da_fare = [e for e in E if e['altezza'] is None or any('incoerente' in n or 'sospetta' in n for n in e['note'])]
    con_ctr = [e for e in E if (e.get('fonte_altezza') or '').startswith('Regione')]
    campione = random.Random(1).sample(con_ctr, min(CAMPIONE, len(con_ctr)))
    print(f'== {luogo}: {len(da_fare)} da completare, {len(campione)} di controllo')
    completati, fuori = 0, 0
    for e in da_fare:
        r = lidar_edificio(e)
        if r is None:
            fuori += 1
            e['note'].append(f'LiDAR {OGGI}: nessun valore (fuori copertura o servizio giu\')')
            continue
        tetto, terra = r
        e['lidar_tetto'], e['lidar_terreno'] = tetto, terra
        h = round(tetto - terra, 1)
        if h >= 2:
            e['altezza'] = h
            e['fonte_altezza'] = 'LiDAR 1 m Ministero Ambiente: DSM centroide - DTM minimo (colmo, non gronda)'
            e['piani'] = int(e['osm_piani']) if e.get('osm_piani') else max(1, round(h / M_PIANO))
            if e.get('quota_gronda') is None:
                e['quota_gronda'] = tetto
            completati += 1
        else:
            e['note'].append(f'LiDAR: tetto solo {h} m sopra il terreno')
    diffs = []
    for e in campione:
        la, lo = centroide(e['poly'])
        t = quota(DSM, la, lo)
        if t is not None:
            e['lidar_tetto'] = round(t, 2)
            diffs.append(round(t - e['quota_gronda'], 1))
    diffs.sort()
    ctrl = {'campione': len(campione), 'con_lidar': len(diffs)}
    if diffs:
        ctrl.update({'mediana_dsm_meno_gronda_m': diffs[len(diffs) // 2],
                     'entro_3m': sum(1 for x in diffs if abs(x) <= 3),
                     'oltre_5m': sum(1 for x in diffs if abs(x) > 5), 'differenze': diffs})
    d['qualita']['lidar'] = {'data': OGGI, 'completati': completati, 'senza_valore': fuori, 'controllo_ctr': ctrl}
    d['qualita']['con_altezza'] = sum(1 for e in E if e['altezza'] is not None)
    d['qualita']['senza_altezza'] = sum(1 for e in E if e['altezza'] is None)
    d['qualita']['altezza_da_lidar'] = sum(1 for e in E if (e.get('fonte_altezza') or '').startswith('LiDAR'))
    d['qualita']['con_note'] = sum(1 for e in E if e['note'])
    for f in d['fonti']:
        if f['nome'].startswith('Ministero'):
            f.update({'servizio': WMS + ' (GetFeatureInfo text/plain)', 'scaricato': OGGI,
                      'uso': 'completare edifici senza altezza/incoerenti; controllo a campione della CTR',
                      'stato': f'usato il {OGGI}', 'licenza': 'Geoportale Nazionale MASE, dati pubblici; citare la fonte'})
    json.dump(d, open(path, 'w'), ensure_ascii=False, separators=(',', ':'))
    print(f'   completati {completati}, senza valore {fuori}, controllo {ctrl.get("con_lidar")}/{len(campione)} '
          f'mediana DSM-gronda {ctrl.get("mediana_dsm_meno_gronda_m")} m, entro 3 m {ctrl.get("entro_3m")}')


if __name__ == '__main__':
    for l in sys.argv[1:] or list(LUOGHI):
        if os.path.exists(os.path.join(D, f'{l}.json')):
            completa(l)
    print('richieste LiDAR:', richieste)
