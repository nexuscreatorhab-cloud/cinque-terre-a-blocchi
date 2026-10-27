"""Scarica i dati OpenStreetMap (strade, vigne, locali) di un luogo in ../🗺️ dati/<luogo>_osm.xml.
Manarola usa osm.xml (gia' presente). Licenza ODbL: "© OpenStreetMap contributors".

Uso:  python3 scarica_osm.py [luogo ...]
"""
import os, sys, time, urllib.parse
from scarica_edifici import D, LUOGHI, OVERPASS, get

for l in sys.argv[1:] or [x for x in LUOGHI if x != 'manarola']:
    S, W, N, E = LUOGHI[l]
    q = f'[out:xml][timeout:300];(way({S},{W},{N},{E});node({S},{W},{N},{E}););(._;>;);out body;'   # niente relazioni: gen.py usa nodi e way
    b = get(OVERPASS, data=urllib.parse.urlencode({'data': q}).encode(), tries=5, wait=60, timeout=360)
    if b'<osm' not in b[:500]:
        raise IOError(f'{l}: risposta Overpass inattesa: {b[:200]!r}')
    open(os.path.join(D, f'{l}_osm.xml'), 'wb').write(b)
    print(l, len(b) // 1024, 'KB', b.count(b'<way '), 'way')
    time.sleep(10)
