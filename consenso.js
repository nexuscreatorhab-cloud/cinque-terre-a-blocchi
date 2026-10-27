// 🧱 Cinque Terre a Blocchi: pagina del consenso del genitore (nessuna libreria, nessun cookie)
(() => {
  const FUNZIONE = "https://jammrsiqgddxihxhhkbt.supabase.co/functions/v1/consenso-genitore";
  const $ = (id) => document.getElementById(id);
  const parametri = new URLSearchParams(location.hash.slice(1));
  const token = parametri.get("t"), revoca = parametri.get("r");
  // il token resta in memoria ma sparisce dalla barra degli indirizzi e dalla cronologia
  history.replaceState(null, "", location.pathname);

  const stato = (testo, tipo) => { const p = document.createElement("p"); p.textContent = testo; if (tipo) p.className = tipo; $("stato").replaceChildren(p); };
  async function chiama(dati) {
    const r = await fetch(FUNZIONE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dati) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.errore || "Errore di collegamento. Riprova più tardi.");
    return j;
  }
  const blocca = (on) => document.querySelectorAll("button").forEach((b) => (b.disabled = on));

  async function avvia() {
    if (revoca) { stato(""); $("revoca").hidden = false; return; }
    if (!token) return stato("Il link non è completo. Apri il link ricevuto per email.", "ko");
    try {
      const info = await chiama({ azione: "info", token });
      $("nick").textContent = info.soprannome;
      stato(""); $("richiesta").hidden = false;
    } catch (e) { stato(e.message, "ko"); }
  }

  $("dichiaro").addEventListener("change", (e) => ($("si").disabled = !e.target.checked));
  $("si").addEventListener("click", async () => {
    blocca(true);
    try { await chiama({ azione: "conferma", token, dichiaro: "si" }); $("richiesta").hidden = true; stato("Grazie, il consenso è stato registrato. Le abbiamo mandato un'email di conferma con il link per ritirarlo.", "ok"); }
    catch (e) { blocca(false); stato(e.message, "ko"); }
  });
  $("no").addEventListener("click", async () => {
    blocca(true);
    try { await chiama({ azione: "rifiuta", token }); $("richiesta").hidden = true; stato("Fatto: l'account del minore è stato cancellato con tutti i suoi dati.", "ok"); }
    catch (e) { blocca(false); stato(e.message, "ko"); }
  });
  $("ritira").addEventListener("click", async () => {
    blocca(true);
    try { await chiama({ azione: "revoca", token: revoca }); $("revoca").hidden = true; stato("Consenso ritirato: l'account del minore è stato cancellato con tutti i suoi dati.", "ok"); }
    catch (e) { blocca(false); stato(e.message, "ko"); }
  });
  avvia();
})();
