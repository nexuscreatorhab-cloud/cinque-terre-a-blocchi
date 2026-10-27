"""Salva il DTM 2023 della Regione (passo 5 m, EPSG:3003) in ../🗺️ dati/<luogo>_dtm.npz per gen.py.

Uso:  python3 salva_dtm.py [luogo ...]      (senza argomenti: tutti)
"""
import os, sys
import numpy as np
from scarica_edifici import D, DTM, LUOGHI, OGGI

for l in sys.argv[1:] or list(LUOGHI):
    d = DTM(*LUOGHI[l])
    np.savez_compressed(os.path.join(D, f'{l}_dtm.npz'), z=d.z.astype(np.float32),
                        x0=d.x0, y1=d.y1, passo=d.PASSO, data=OGGI,
                        fonte='Regione Liguria DTM ed. 2023 (WCS M2056:L6952), EPSG:3003')
    print(l, d.z.shape, np.nanmin(d.z), np.nanmax(d.z))
