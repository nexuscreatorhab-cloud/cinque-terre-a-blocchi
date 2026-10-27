// 🧱 Cinque Terre a Blocchi: funzione "consenso-genitore" (Supabase Edge Function, verify_jwt = false)
// Azioni: richiedi (dal ragazzo, con login) · info / conferma / rifiuta (dal genitore, con il link) · revoca
// Segreti: BREVO_API_KEY. Automatici: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SITO = "https://nexuscreatorhab-cloud.github.io";
const BASE = SITO + "/cinque-terre-a-blocchi";
const MITTENTE = { name: "Cinque Terre a Blocchi", email: "cinqueterreablocchi@hotmail.com" };
const INFORMATIVA = "1 · 27/10/2026";
const MAX_INVII = 3; // per account ogni 24 ore

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const cors = {
  "Access-Control-Allow-Origin": SITO,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
const risposta = (dati: unknown, stato = 200) =>
  new Response(JSON.stringify(dati), { status: stato, headers: { ...cors, "Content-Type": "application/json" } });

async function sha256(t: string) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, "0")).join("");
}
function nuovoToken() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

async function mandaEmail(a: string, oggetto: string, testo: string, html: string) {
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": Deno.env.get("BREVO_API_KEY")!, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({ sender: MITTENTE, to: [{ email: a }], subject: oggetto, textContent: testo, htmlContent: html }),
  });
  if (!r.ok) throw new Error("invio email " + r.status);
}

// il link porta il token dopo "#", così non finisce nei registri dei server
async function richiedi(req: Request, email: string) {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer /, "");
  const { data: { user } } = await admin.auth.getUser(jwt);
  if (!user) return risposta({ errore: "Devi entrare con il tuo account." }, 401);
  email = String(email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) return risposta({ errore: "Email non valida." }, 400);
  if (email === (user.email || "").toLowerCase()) return risposta({ errore: "Serve l'email di un genitore, non la tua." }, 400);

  const { data: p } = await admin.from("profili").select("soprannome, stato_consenso").eq("id", user.id).single();
  if (!p || p.stato_consenso !== "in_attesa") return risposta({ errore: "Il tuo account non ha bisogno del consenso." }, 400);

  const { data: c } = await admin.from("consensi_genitori").select("invii, primo_invio").eq("utente", user.id).maybeSingle();
  const finestra = c?.primo_invio && Date.now() - new Date(c.primo_invio).getTime() < 864e5;
  const invii = finestra ? c!.invii : 0;
  if (invii >= MAX_INVII) return risposta({ errore: "Hai già mandato troppe richieste oggi. Riprova domani." }, 429);

  const token = nuovoToken();
  const { error } = await admin.from("consensi_genitori").upsert({
    utente: user.id, email_genitore: email, token_hash: await sha256(token),
    scadenza: new Date(Date.now() + 7 * 864e5).toISOString(),
    invii: invii + 1, primo_invio: finestra ? c!.primo_invio : new Date().toISOString(),
  });
  if (error) return risposta({ errore: "Errore del server." }, 500);

  const link = `${BASE}/consenso.html#t=${token}`;
  const nick = esc(p.soprannome);
  await mandaEmail(email, "Richiesta di consenso · Cinque Terre a Blocchi",
    `Buongiorno,\n\nun ragazzo o una ragazza con il soprannome "${p.soprannome}" ha indicato il suo indirizzo email per partecipare a Cinque Terre a Blocchi, un gioco online che ricostruisce a blocchi i borghi delle Cinque Terre.\n\nPer legge, sotto i 14 anni serve il consenso di chi esercita la responsabilità genitoriale. Per leggere l'informativa e decidere apra questo link (vale 7 giorni):\n${link}\n\nSe non conosce questa richiesta, ignori il messaggio: senza conferma l'account viene cancellato entro 30 giorni.\n\nCinque Terre a Blocchi\n${MITTENTE.email}`,
    `<p>Buongiorno,</p><p>un ragazzo o una ragazza con il soprannome <b>${nick}</b> ha indicato il suo indirizzo email per partecipare a <b>Cinque Terre a Blocchi</b>, un gioco online che ricostruisce a blocchi i borghi delle Cinque Terre.</p><p>Per legge, sotto i 14 anni serve il consenso di chi esercita la responsabilità genitoriale.</p><p><a href="${link}">Leggi l'informativa e decidi</a> (il link vale 7 giorni)</p><p>Se non conosce questa richiesta, ignori il messaggio: senza conferma l'account viene cancellato entro 30 giorni.</p><p>Cinque Terre a Blocchi · ${MITTENTE.email}</p>`);
  return risposta({ ok: true });
}

async function trovaDaToken(token: string) {
  if (!token || token.length > 100) return null;
  const { data } = await admin.from("consensi_genitori").select("utente, email_genitore, scadenza, confermato, profili(soprannome, anno_nascita)")
    .eq("token_hash", await sha256(token)).maybeSingle();
  if (!data || data.confermato || new Date(data.scadenza) < new Date()) return null;
  return data;
}

async function cancellaAccount(utente: string) {
  // prima le foto, poi l'utente: profilo, proposte, note e consenso si cancellano a cascata
  const { data: foto } = await admin.storage.from("foto").list(utente);
  if (foto?.length) await admin.storage.from("foto").remove(foto.map((f) => `${utente}/${f.name}`));
  await admin.auth.admin.deleteUser(utente);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return risposta({ errore: "Metodo non ammesso." }, 405);
  let corpo: Record<string, string>;
  try { corpo = await req.json(); } catch { return risposta({ errore: "Richiesta non valida." }, 400); }

  try {
    switch (corpo.azione) {
      case "richiedi":
        return await richiedi(req, corpo.email);

      case "info": {
        const c = await trovaDaToken(corpo.token);
        if (!c) return risposta({ errore: "Il link non è valido o è scaduto." }, 404);
        // @ts-ignore relazione 1:1
        return risposta({ soprannome: c.profili.soprannome, anno_nascita: c.profili.anno_nascita });
      }

      case "conferma": {
        if (corpo.dichiaro !== "si") return risposta({ errore: "Serve la dichiarazione." }, 400);
        const c = await trovaDaToken(corpo.token);
        if (!c) return risposta({ errore: "Il link non è valido o è scaduto." }, 404);
        const revoca = nuovoToken();
        await admin.from("consensi_genitori").update({
          confermato: new Date().toISOString(), versione_informativa: INFORMATIVA,
          token_hash: null, scadenza: null, revoca_hash: await sha256(revoca),
        }).eq("utente", c.utente);
        await admin.from("profili").update({ stato_consenso: "ok" }).eq("id", c.utente);
        const link = `${BASE}/consenso.html#r=${revoca}`;
        await mandaEmail(c.email_genitore, "Consenso registrato · Cinque Terre a Blocchi",
          `Buongiorno,\n\nil suo consenso è stato registrato. Può ritirarlo in qualsiasi momento da questo link: l'account verrà cancellato con tutti i suoi dati.\n${link}\n\nInformativa: ${BASE}/privacy.html\n\nCinque Terre a Blocchi\n${MITTENTE.email}`,
          `<p>Buongiorno,</p><p>il suo consenso è stato registrato.</p><p>Può <a href="${link}">ritirarlo in qualsiasi momento</a>: l'account verrà cancellato con tutti i suoi dati.</p><p><a href="${BASE}/privacy.html">Informativa privacy</a></p><p>Cinque Terre a Blocchi · ${MITTENTE.email}</p><p>Conservi questa email.</p>`);
        return risposta({ ok: true });
      }

      case "rifiuta": {
        const c = await trovaDaToken(corpo.token);
        if (!c) return risposta({ errore: "Il link non è valido o è scaduto." }, 404);
        await cancellaAccount(c.utente);
        return risposta({ ok: true });
      }

      case "revoca": {
        const t = String(corpo.token || "");
        if (!t || t.length > 100) return risposta({ errore: "Link non valido." }, 404);
        const { data: c } = await admin.from("consensi_genitori").select("utente").eq("revoca_hash", await sha256(t)).maybeSingle();
        if (!c) return risposta({ errore: "Il link non è valido o l'account è già stato cancellato." }, 404);
        await cancellaAccount(c.utente);
        return risposta({ ok: true });
      }
    }
    return risposta({ errore: "Azione sconosciuta." }, 400);
  } catch (_e) {
    return risposta({ errore: "Errore del server. Riprova più tardi." }, 500);
  }
});
