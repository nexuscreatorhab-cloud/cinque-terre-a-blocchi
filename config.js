// Configurazione pubblica. La chiave "publishable" e' fatta per stare nel browser:
// cosa si puo' leggere o scrivere lo decidono le regole del database, non questa chiave.
(function(){
  const BORGHI={manarola:"Manarola",riomaggiore:"Riomaggiore",corniglia:"Corniglia",vernazza:"Vernazza",monterosso:"Monterosso",la_spezia:"La Spezia"};
  // il borgo arriva dall'indirizzo (?borgo=vernazza); solo quelli in elenco, altrimenti Manarola
  const q=new URLSearchParams(location.search).get("borgo");
  const borgo=Object.prototype.hasOwnProperty.call(BORGHI,q)?q:"manarola";
  window.CONFIG = {
    supabaseUrl: "https://jammrsiqgddxihxhhkbt.supabase.co",
    supabaseKey: "sb_publishable_fq2n5XR5kH84VaO36Dxm8Q_nonY3AVY",
    borghi: BORGHI,
    borgo,
    nome: BORGHI[borgo],
    mondo: "dati/"+borgo+".json"
  };
})();
