"""Scarica da OpenStreetMap le attivita' reali (alloggi, locali, negozi, barche, servizi)
dei 6 luoghi e le salva in attivita_osm.json nella cartella corrente.
Licenza ODbL: "© OpenStreetMap contributors".

Si tengono solo nome e tipo (piu' id e posizione OSM): niente telefono, sito o indirizzo.
Una richiesta per luogo, una alla volta, con pausa: niente carico inutile su Overpass.

Uso:  python3 scarica_attivita.py
Serve solo Python 3 e curl.
"""
import json, subprocess, time, urllib.parse
from datetime import date

UA = 'CinqueTerreBlocchi/0.1 (prototipo personale, dati pubblici)'
OVERPASS = 'https://overpass-api.de/api/interpreter'
# S, W, N, E: gli stessi riquadri di scarica_edifici.py
LUOGHI = {
    'monterosso':  (44.1400, 9.6420, 44.1505, 9.6610),
    'vernazza':    (44.1320, 9.6790, 44.1380, 9.6880),
    'corniglia':   (44.1160, 9.7050, 44.1230, 9.7165),
    'manarola':    (44.1038, 9.7243, 44.1096, 9.7328),
    'riomaggiore': (44.0960, 9.7330, 44.1030, 9.7425),
    'la_spezia':   (44.0990, 9.8100, 44.1160, 9.8420),
}
# chiave OSM -> valori tenuti (None = tutti) e categoria
TIPI = [
    ('tourism', {'hotel', 'guest_house', 'hostel', 'apartment', 'motel', 'chalet', 'camp_site'}, 'alloggio'),
    ('amenity', {'restaurant', 'cafe', 'bar', 'pub', 'fast_food', 'ice_cream', 'biergarten', 'food_court'}, 'ristorazione'),
    ('amenity', {'boat_rental', 'boat_sharing'}, 'barca'),
    ('shop', {'boat'}, 'barca'),
    ('shop', {'travel_agency'}, 'tour'),
    ('office', {'travel_agent', 'guide'}, 'tour'),
    ('amenity', {'pharmacy', 'bank', 'post_office', 'car_rental', 'bicycle_rental', 'fuel', 'ferry_terminal'}, 'servizio'),
    ('shop', None, 'negozio'),
    ('craft', {'winery'}, 'negozio'),
]
SCARTA_SHOP = {'vacant', 'no', 'yes'}


def query(S, W, N, E):
    bb = f'({S},{W},{N},{E})'
    righe = ''.join(f'nwr["name"]["{k}"]{bb};' for k in sorted({k for k, _, _ in TIPI}))
    return f'[out:json][timeout:120];({righe});out center tags;'


def classifica(t):
    for k, vals, cat in TIPI:
        v = t.get(k)
        if v and (vals is None or v in vals) and not (k == 'shop' and v in SCARTA_SHOP):
            return cat, f'{k}={v}'
    return None


def get(data):
    for i in range(5):
        r = subprocess.run(['curl', '-sS', '-f', '-m', '180', '-A', UA, '--data-binary', '@-', OVERPASS],
                           input=data, capture_output=True)
        if r.returncode == 0 and r.stdout.lstrip().startswith(b'{'):
            return json.loads(r.stdout)
        print('  riprovo:', r.stderr.decode(errors='ignore').strip()[:120])
        time.sleep(30 * (i + 1))
    raise IOError('Overpass non risponde')


out = {'fonte': '© OpenStreetMap contributors (ODbL), via Overpass API', 'scaricato': date.today().isoformat(), 'attivita': []}
for luogo, bb in LUOGHI.items():
    js = get(urllib.parse.urlencode({'data': query(*bb)}).encode())
    n = 0
    for e in js['elements']:
        t = e.get('tags', {})
        if any(k.startswith(('disused:', 'abandoned:', 'was:')) for k in t) or t.get('opening_hours') == 'closed':
            continue
        c = classifica(t)
        if not c or ('lat' not in e and 'center' not in e):
            continue
        lat, lon = (e['lat'], e['lon']) if 'lat' in e else (e['center']['lat'], e['center']['lon'])
        out['attivita'].append({'osm_id': f"{e['type']}/{e['id']}", 'nome': t['name'].strip(), 'categoria': c[0],
                                'sottotipo': c[1], 'luogo': luogo, 'lat': round(lat, 7), 'lon': round(lon, 7)})
        n += 1
    print(luogo, n, 'attivita')
    time.sleep(10)

json.dump(out, open('attivita_osm.json', 'w'), ensure_ascii=False, indent=0)
print('salvato attivita_osm.json:', len(out['attivita']), 'attivita')
