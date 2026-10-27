// Pagina "Missioni": legge missioni, livelli, targhette e classifica dal database.
// Il login è quello del mondo (stessa sessione salvata nel browser).
"use strict";
const SB_URL = "https://jammrsiqgddxihxhhkbt.supabase.co";
const SB_KEY = "sb_publishable_fq2n5XR5kH84VaO36Dxm8Q_nonY3AVY";
const sb = supabase.createClient(SB_URL, SB_KEY);
const $ = id => document.getElementById(id);

function el(tag, attrs = {}, ...figli) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "text") e.textContent = v;
    else if (k === "on") for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
    else if (k === "style") e.style.cssText = v;
    else e.setAttribute(k, v);
  }
  for (const f of figli) if (f != null) e.append(f);
  return e;
}

function mancano(fine) {
  const ms = new Date(fine) - Date.now();
  if (ms <= 0) return "finita";
  const g = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 36e5);
  return g > 0 ? `mancano ${g} g e ${h} h` : `mancano ${h} h`;
}

// un blocco per ogni casa da completare
function barra(fatto, obiettivo) {
  const blocchi = [];
  for (let i = 0; i < obiettivo; i++) blocchi.push(el("i", { class: i < fatto ? "si" : "" }));
  return el("div", { class: "blocchi", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(obiettivo), "aria-valuenow": String(fatto) }, ...blocchi);
}

let livelli = [];

async function settimana() {
  const box = $("settimana");
  const { data, error } = await sb.from("missioni").select("id,titolo,descrizione,inizio,fine").order("inizio", { ascending: false }).limit(1);
  if (error) { box.replaceChildren(el("p", { class: "muted", text: "Non riesco a caricare le missioni. Riprova tra poco." })); return; }
  const m = data[0];
  if (!m || new Date(m.fine) <= Date.now()) {
    box.replaceChildren(el("h2", { text: "Missione della settimana" }),
      el("p", { class: "big", text: "Nuova missione in arrivo lunedì." }),
      el("p", { class: "muted", text: "Intanto segna le facciate del tuo borgo: ogni dettaglio conta per i livelli." }));
    return;
  }
  box.replaceChildren(el("h2", { text: "Missione della settimana" }),
    el("p", { class: "big", text: m.titolo }),
    el("p", { text: m.descrizione }),
    el("span", { class: "tempo", text: "⏳ " + mancano(m.fine) }));
}

async function io() {
  const box = $("io");
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    box.replaceChildren(el("h2", { text: "Entra in gioco" }),
      el("p", { text: "Entra dal mondo per vedere i tuoi progressi e le tue targhette." }),
      el("a", { class: "btn", href: "./", text: "Vai al mondo" }));
    return;
  }
  const uid = session.user.id;
  const [prof, mis, tar, tipi] = await Promise.all([
    sb.from("profili").select("soprannome,livello").eq("id", uid).maybeSingle(),
    sb.rpc("mie_missioni"),
    sb.from("targhette").select("tipo,borgo,assegnata").eq("utente", uid).order("assegnata", { ascending: false }),
    sb.from("tipi_targhetta").select("tipo,nome,icona"),
  ]);
  if (!prof.data) {
    box.replaceChildren(el("h2", { text: "Crea il tuo profilo" }),
      el("p", { text: "Scegli un soprannome nel mondo e torna qui." }),
      el("a", { class: "btn", href: "./", text: "Vai al mondo" }));
    return;
  }
  const liv = livelli.find(l => l.numero === prof.data.livello);
  const prossimo = livelli.find(l => l.numero === prof.data.livello + 1);
  for (const li of $("elenco-livelli").children) li.classList.toggle("mio", li.dataset.n === String(prof.data.livello));
  const nomi = Object.fromEntries((tipi.data || []).map(t => [t.tipo, t]));
  box.replaceChildren(
    el("h2", { text: "Il tuo profilo" }),
    el("div", { class: "chi" }, el("span", { class: "icona", text: liv ? liv.icona : "🌱" }),
      el("div", {}, el("small", { text: prof.data.soprannome }), el("div", { class: "big", text: liv ? liv.nome : "" }))),
    prossimo ? el("p", { class: "muted", text: `Prossimo: ${prossimo.icona} ${prossimo.nome}. ${prossimo.descrizione}` }) : el("p", { class: "muted", text: "Livello massimo. Il borgo è tuo." }),
    ...(mis.data || []).map(m => el("div", { class: "missione" + (m.fatto >= m.obiettivo ? " fatta" : "") },
      el("b", { text: `${m.icona} ${m.titolo}` }), barra(m.fatto, m.obiettivo),
      el("span", { class: "muted", text: m.fatto >= m.obiettivo ? `Fatta! Targhetta "${m.targhetta}"` : `${m.fatto} su ${m.obiettivo}` }))),
    el("h2", { text: "Le tue targhette", style: "margin-top:12px" }),
    (tar.data || []).length
      ? el("ul", { class: "targhette" }, ...tar.data.map(t => {
          const n = nomi[t.tipo] || { icona: "🏅", nome: t.tipo };
          return el("li", {}, el("span", { text: n.icona }), document.createTextNode(n.nome + (t.borgo ? " · " + t.borgo : "")));
        }))
      : el("p", { class: "muted", text: "Ancora nessuna. Chiudi una missione per la prima." }));
}

async function classifica() {
  const { data: borghi } = await sb.from("borghi").select("id,nome").order("nome");
  const tabs = $("borghi");
  const mostra = async (b) => {
    for (const t of tabs.children) t.setAttribute("aria-selected", String(t.dataset.id === b.id));
    const { data } = await sb.rpc("classifica", { p_borgo: b.id });
    const lista = $("lista");
    if (!data || !data.length) { lista.replaceChildren(el("li", { class: "muted vuoto", text: `Nessuno in classifica a ${b.nome}. Il primo posto è libero.` })); return; }
    lista.replaceChildren(...data.map(r => {
      const l = livelli.find(x => x.numero === r.livello);
      return el("li", {}, document.createTextNode(`${r.soprannome} ${l ? l.icona : ""}`), el("span", { class: "pt", text: `${r.ufficiali} 🧱` }));
    }));
  };
  tabs.replaceChildren(...(borghi || []).map(b => el("button", { role: "tab", "data-id": b.id, text: b.nome, on: { click: () => mostra(b) } })));
  if (borghi && borghi.length) mostra(borghi[0]);
}

async function elencoLivelli() {
  livelli = (await sb.from("livelli").select("*").order("numero")).data || [];
  $("elenco-livelli").replaceChildren(...livelli.filter(l => l.numero > 0).map(l =>
    el("li", { "data-n": String(l.numero) }, el("span", { class: "icona", text: l.icona }),
      el("div", {}, el("b", { text: l.nome }), el("small", { text: l.descrizione })))));
}

(async () => {
  await elencoLivelli();
  await Promise.all([settimana(), io(), classifica()]);
})();
