# 🧱 Cinque Terre a Blocchi

I borghi delle Cinque Terre ricostruiti a blocchi (1 blocco = 2 m). Chi li conosce segna com'è davvero ogni casa: colori, persiane, tetti, portoni. Un dettaglio diventa ufficiale quando almeno 5 persone sono d'accordo (70%) e almeno una foto è approvata dal controllo automatico.

- `index.html`, `app.js`, `editor.js`, `style.css`: il mondo 3D, il tutorial e l'editor delle facciate
- `missioni.html`: missioni, livelli, targhette e classifica
- `privacy.html`, `consenso.html`: informativa e consenso dei genitori (sotto i 14 anni)
- `dati/manarola.json`: il mondo generato (edifici e quote: Regione Liguria; strade e luoghi: © OpenStreetMap contributors)
- `supabase/`: schema del database con regole di sicurezza e funzioni server (consenso genitori, controllo foto)
- `vendor/`: three.js r128 e supabase-js 2.45.4, con le loro licenze

Sicurezza: solo HTTPS, Content-Security-Policy rigida, nessuna libreria da CDN, regole di accesso nel database, foto ripulite dai dati GPS e cancellate subito dopo il controllo.
