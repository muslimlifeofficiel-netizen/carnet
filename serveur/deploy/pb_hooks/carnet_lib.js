// Carnet de Suivi : fonctions du serveur (chargées par carnet.pb.js avec require).
const PRIX_ENTREE = 0.10 / 1e6, PRIX_SORTIE = 0.50 / 1e6; // Claude Haiku 5.5, requêtes < 100 000 jetons
const MODELE = "claude-haiku-5-5";
const QUOTA_MOIS = { coaching: 1, seances: 1 };

// Droits d'un chemin : seuls ces chemins existent. Calculés ici, jamais par l'app.
function analyseChemin(path, auth) {
  if (typeof path !== "string" || !/^[A-Za-z0-9_\-.~:@+]+(\/[A-Za-z0-9_\-.~:@+]+)*$/.test(path)) return { err: "chemin invalide" };
  const s = path.split("/");
  if (s.length % 2 !== 0 || s.length > 16) return { err: "chemin de document invalide" };
  const coll = s.slice(0, -1).join("/");
  const genre = auth.getString("genre");
  if (s[0] === "data" && s[1] === "users") {
    if (s[2] !== auth.id) return { err: "interdit" };
    return { coll, prive: true, ecriture: "owner", owner: auth.id, genre };
  }
  if (!genre) return { err: "choisis frère ou sœur d'abord" };
  if (s[0] === "classement") {
    if (s.length !== 2 || s[1] !== auth.id) return { err: "interdit" };
    return { coll, prive: false, ecriture: "owner", owner: auth.id, genre };
  }
  if (s[0] === "pactes" || s[0] === "clans") return { coll, prive: false, ecriture: "tous", owner: auth.id, genre };
  return { err: "chemin non autorisé" };
}

function moisDe(d) { return d.toISOString().slice(0, 7); }

function compteMois(app, ownerId, type) {
  const recs = app.findRecordsByFilter("ia_journal", "owner = {:o} && type = {:t} && mois = {:m} && echec = false", "", 100, 0,
    { o: ownerId, t: type, m: moisDe(new Date()) });
  return recs.length;
}

function journalIA(app, ownerId, type, entree, sortie, echec) {
  const col = app.findCollectionByNameOrId("ia_journal");
  const r = new Record(col);
  r.set("owner", ownerId); r.set("type", type); r.set("mois", moisDe(new Date()));
  r.set("entree", entree || 0); r.set("sortie", sortie || 0);
  r.set("cout", Math.round(((entree || 0) * PRIX_ENTREE + (sortie || 0) * PRIX_SORTIE) * 1e6) / 1e6);
  r.set("echec", !!echec);
  app.save(r);
}

// Appel à Claude. Lance une erreur si la clé manque ou si l'appel échoue (l'appelant prévoit le repli).
function appelClaude(systeme, texte, maxSortie) {
  const cle = $os.getenv("ANTHROPIC_API_KEY");
  if (!cle) throw new Error("clé API absente");
  const res = $http.send({
    url: "https://api.anthropic.com/v1/messages",
    method: "POST",
    timeout: 90,
    headers: { "content-type": "application/json", "x-api-key": cle, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODELE, max_tokens: maxSortie || 800, system: systeme, messages: [{ role: "user", content: texte }] }),
  });
  if (res.statusCode !== 200) throw new Error("API " + res.statusCode + " " + toString(res.body, 300));
  const j = res.json || {};
  const t = (j.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
  if (!t) throw new Error("réponse vide");
  return { texte: t, entree: (j.usage || {}).input_tokens || 0, sortie: (j.usage || {}).output_tokens || 0 };
}

function alerte(app, sujet, texte) {
  const a = $os.getenv("COACH_EMAIL");
  if (!a) return;
  try {
    const s = app.settings();
    app.newMailClient().send(new MailerMessage({
      from: { address: s.meta.senderAddress, name: s.meta.senderName || "Carnet de Suivi" },
      to: [{ address: a }], subject: "[Carnet] " + sujet, text: texte,
    }));
  } catch (e) { console.log("alerte non envoyée : " + e); }
}

// Données d'un élève, sans rien qui l'identifie : seulement des chiffres et des états.
function donneesAnonymes(app, ownerId, jourISO) {
  const debut = new Date(new Date(jourISO + "T00:00:00Z").getTime() - 6 * 86400000).toISOString().slice(0, 10);
  const recs = app.findRecordsByFilter("docs", "owner = {:o} && prive = true", "-updated", 400, 0, { o: ownerId });
  const jours = [], corps = [], bilans = [];
  let coaching = null;
  for (const r of recs) {
    const cle = r.getString("path").split("/").pop();
    let d = {};
    try { d = JSON.parse(toString(r.get("data"))); } catch (_) {}
    if (/^\d{4}-\d{2}-\d{2}$/.test(cle) && cle >= debut && cle <= jourISO) jours.push({ jour: cle, ...nettoie(d) });
    else if (/^corps-\d{4}-\d{2}-\d{2}$/.test(cle) && cle.slice(6) >= debut) corps.push({ jour: cle.slice(6), ...nettoie(d) });
    else if (/^bilan-/.test(cle) && bilans.length < 2) bilans.push({ cle, ...nettoie(d) });
    else if (/^coaching-ia/.test(cle) && !coaching) coaching = nettoie(d);
  }
  jours.sort((a, b) => (a.jour < b.jour ? -1 : 1));
  return { periode: { du: debut, au: jourISO }, jours, corps, bilans, coaching };
}

// Garde chiffres, booléens et textes courts (états) ; retire les textes libres, ids de photos et adresses.
function nettoie(o, prof) {
  prof = prof || 0;
  if (o === null || o === undefined || prof > 4) return undefined;
  if (typeof o === "number" || typeof o === "boolean") return o;
  if (typeof o === "string") return o.length <= 24 && !/@|https?:/.test(o) ? o : undefined;
  if (Array.isArray(o)) return o.slice(0, 40).map((x) => nettoie(x, prof + 1)).filter((x) => x !== undefined);
  const r = {};
  for (const k in o) {
    if (/photo|avatar|image|pdf|mail|nom|pseudo|perso|note|texte|description|id$/i.test(k)) continue;
    const v = nettoie(o[k], prof + 1);
    if (v !== undefined) r[k] = v;
  }
  return r;
}

// Résumé sans IA : toujours disponible.
function resumeCalcule(d) {
  const n = d.jours.length;
  const p = [];
  p.push(n === 0 ? "Aucun pointage ces 7 derniers jours. On reprend aujourd'hui." :
    n + (n > 1 ? " jours pointés" : " jour pointé") + " sur les 7 derniers jours.");
  const pesees = d.corps.map((c) => (c.balance && c.balance.kg) || c.poids).filter((x) => typeof x === "number");
  if (pesees.length >= 2) {
    const e = Math.round((pesees[pesees.length - 1] - pesees[0]) * 10) / 10;
    p.push("Poids sur la semaine : " + (e > 0 ? "+" : "") + String(e).replace(".", ",") + " kg.");
  }
  if (n >= 6) p.push("Belle régularité. Continue comme ça.");
  else if (n > 0 && n <= 3) p.push("Vise un pointage chaque jour, même court.");
  return p.join(" ");
}

const SYSTEME_RESUME = [
  "Tu écris le résumé du jour d'un élève du coaching Muslim Life, en français, en le tutoyant.",
  "Style : phrases courtes, direct, sobre, fraternel, jamais vendeur. Pas d'emoji, pas de tiret cadratin.",
  "3 ou 4 phrases, 60 mots au plus, deux chiffres au plus.",
  "Tu n'inventes rien. Une donnée absente n'est pas un échec : ne dis jamais qu'une chose non notée n'a pas été faite.",
  "Ne nomme aucun trouble ni maladie. Face à un signal de santé inquiétant, conseille d'en parler à son coach.",
  "Aucune citation religieuse. Termine par un conseil concret pour aujourd'hui.",
  "Tu reçois seulement des chiffres et des états, au format JSON.",
].join("\n");

function genererResumes(app) {
  const maintenant = Date.now();
  let echecs = 0;
  for (const u of app.findAllRecords("users")) {
    const decalage = u.getInt("decalage"); // getTimezoneOffset() de l'élève : minutes
    const local = new Date(maintenant - decalage * 60000);
    if (local.getUTCHours() !== 0) continue;
    const jour = local.toISOString().slice(0, 10);
    const veille = new Date(local.getTime() - 86400000).toISOString().slice(0, 10);
    try { app.findFirstRecordByFilter("resumes", "owner = {:o} && jour = {:j}", { o: u.id, j: jour }); continue; } catch (_) {}

    const col = app.findCollectionByNameOrId("resumes");
    const r = new Record(col);
    r.set("owner", u.id); r.set("jour", jour);

    // Rien de nouveau depuis le dernier résumé : on le garde, sans appel à l'IA.
    let dernier = null;
    try { dernier = app.findRecordsByFilter("resumes", "owner = {:o}", "-jour", 1, 0, { o: u.id })[0] || null; } catch (_) {}
    if (dernier) {
      const neufs = app.findRecordsByFilter("docs", "owner = {:o} && updated > {:t}", "", 1, 0, { o: u.id, t: dernier.getString("created") });
      if (neufs.length === 0) {
        r.set("texte", dernier.getString("texte")); r.set("source", "repris");
        app.save(r); continue;
      }
    }

    const d = donneesAnonymes(app, u.id, veille);
    let consent = {};
    try { consent = JSON.parse(toString(u.get("consentement"))) || {}; } catch (_) {}
    if (consent.ia === true) {
      try {
        const rep = appelClaude(SYSTEME_RESUME, JSON.stringify(d), 300);
        journalIA(app, u.id, "resume", rep.entree, rep.sortie, false);
        r.set("texte", rep.texte); r.set("source", "ia");
        app.save(r); continue;
      } catch (err) {
        echecs++;
        journalIA(app, u.id, "resume", 0, 0, true);
        console.log("résumé IA en échec : " + err);
      }
    }
    r.set("texte", resumeCalcule(d)); r.set("source", "calcul");
    app.save(r);
  }
  if (echecs > 0) alerte(app, "IA indisponible", echecs + " résumé(s) du jour faits sans IA. Vérifie le crédit de l'API Claude.");
}

module.exports = { genererResumes, analyseChemin, compteMois, journalIA, appelClaude, alerte, donneesAnonymes, resumeCalcule, SYSTEME_RESUME, QUOTA_MOIS };
