"""Da attivita_osm.json (scarica_attivita.py) all'SQL per public.attivita:
trova l'edificio di ogni attivita' nella griglia di dati/<borgo>.json (stessa griglia di gen.py).

Uso:  python3 attivita_sql.py attivita_osm.json > attivita.sql
"""
import base64, json, math, os, sys
from array import array

D = os.path.dirname(os.path.abspath(__file__))
# S, W, N, E: gli stessi riquadri di scarica_edifici.py e scarica_attivita.py
LUOGHI = {
    'monterosso':  (44.1400, 9.6420, 44.1505, 9.6610),
    'vernazza':    (44.1320, 9.6790, 44.1380, 9.6880),
    'corniglia':   (44.1160, 9.7050, 44.1230, 9.7165),
    'manarola':    (44.1038, 9.7243, 44.1096, 9.7328),
    'riomaggiore': (44.0960, 9.7330, 44.1030, 9.7425),
    'la_spezia':   (44.0990, 9.8100, 44.1160, 9.8420),
}
CELL = 2.0
VICINO = 3   # celle (6 m): un'attivita' segnata sulla porta, in strada, va all'edificio piu' vicino


def griglia(borgo):
    w = json.load(open(os.path.join(D, borgo + '.json')))
    typ = base64.b64decode(w['typ'])
    bid = array('H'); bid.frombytes(base64.b64decode(w['bid']))
    return w['GW'], w['GH'], typ, bid


def edificio(x, y, GW, GH, typ, bid):
    best, bd = None, 1e9
    cx, cy = int(x), int(y)
    for j in range(max(0, cy - VICINO), min(GH, cy + VICINO + 1)):
        for i in range(max(0, cx - VICINO), min(GW, cx + VICINO + 1)):
            k = j * GW + i
            if typ[k] != 5:
                continue
            d = math.hypot(i + .5 - x, j + .5 - y)
            if d < bd and d <= VICINO:
                best, bd = bid[k], d
    return best


def q(s):
    return "'" + s.replace("'", "''") + "'" if s is not None else 'null'


src = json.load(open(sys.argv[1]))
oggi = src['scaricato']
G = {}
righe, conta = [], {}
for a in src['attivita']:
    b = a['luogo']
    S, W, N, E = LUOGHI[b]
    lonM = 111320.0 * math.cos(math.radians((S + N) / 2))
    x, y = (a['lon'] - W) * lonM / CELL, (N - a['lat']) * 111320.0 / CELL
    if b not in G:
        G[b] = griglia(b)
    GW, GH = G[b][0], G[b][1]
    e = edificio(x, y, *G[b]) if 0 <= x < GW and 0 <= y < GH else None
    conta.setdefault(b, [0, 0])[0] += 1
    conta[b][1] += e is not None
    righe.append(f"({q(a['osm_id'])},{q(a['nome'])},{q(a['categoria'])},{q(a['sottotipo'])},{q(b)},"
                 f"{e if e else 'null'},{a['lat']},{a['lon']},'{oggi}')")

print('-- Generato da dati/attivita_sql.py. Fonte: © OpenStreetMap contributors (ODbL)')
print('insert into public.attivita (osm_id, nome, categoria, sottotipo, borgo, edificio, lat, lon, aggiornato) values')
print(',\n'.join(righe))
print('on conflict (osm_id) do update set nome = excluded.nome, categoria = excluded.categoria, sottotipo = excluded.sottotipo,')
print('  borgo = excluded.borgo, edificio = excluded.edificio, lat = excluded.lat, lon = excluded.lon, aggiornato = excluded.aggiornato;')
for b, (n, e) in conta.items():
    print(f'-- {b}: {n} attivita, {e} su un edificio', file=sys.stderr)
