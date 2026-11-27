/// <reference path="../pb_data/types.d.ts" />
// Carnet de Suivi : règles et tâches du serveur.

// ---- Documents : droits calculés à partir du chemin ----
onRecordCreateRequest((e) => {
  const L = require(`${__hooks}/carnet_lib.js`);
  if (!e.auth || e.auth.collection().name !== "users") { e.next(); return; } // Sami (administrateur) passe
  const a = L.analyseChemin(e.record.getString("path"), e.auth);
  if (a.err) throw new ForbiddenError(a.err);
  e.record.set("coll", a.coll); e.record.set("prive", a.prive); e.record.set("ecriture", a.ecriture);
  e.record.set("owner", a.owner); e.record.set("genre", a.genre);
  e.next();
}, "docs");

onRecordUpdateRequest((e) => {
  if (!e.auth || e.auth.collection().name !== "users") { e.next(); return; }
  const avant = e.record.original();
  for (const f of ["path", "coll", "owner", "prive", "ecriture", "genre"]) e.record.set(f, avant.get(f)); // non modifiables
  e.next();
}, "docs");

// ---- Fichiers : propriétaire et genre posés par le serveur ; aucune photo publique pour une sœur ----
onRecordCreateRequest((e) => {
  if (!e.auth || e.auth.collection().name !== "users") { e.next(); return; }
  e.record.set("owner", e.auth.id);
  const g = e.auth.getString("genre");
  e.record.set("genre", g);
  if (g !== "frere") e.record.set("public", false);
  e.next();
}, "fichiers");

// ---- Élève : le genre se choisit une fois ; seul Sami le change ----
onRecordUpdateRequest((e) => {
  if (!e.auth || e.auth.collection().name !== "users") { e.next(); return; }
  const avant = e.record.original().getString("genre");
  if (avant && e.record.getString("genre") !== avant) throw new ForbiddenError("Le genre ne se change pas. Écris à ton coach.");
  e.next();
}, "users");

// ---- Résumé du jour : chaque heure, pour les élèves dont il est minuit ----
cronAdd("carnet_resume_du_jour", "7 * * * *", () => {
  require(`${__hooks}/carnet_lib.js`).genererResumes($app);
});

// Lancement à la main par Sami (administrateur seulement), pour tester.
routerAdd("POST", "/api/carnet/resumes-maintenant", (e) => {
  require(`${__hooks}/carnet_lib.js`).genererResumes(e.app);
  return e.json(200, { ok: true });
}, $apis.requireSuperuserAuth());

// ---- IA à la demande : lecture du coaching et import des séances (1 fois par mois chacun) ----
routerAdd("POST", "/api/carnet/ia", (e) => {
  const L = require(`${__hooks}/carnet_lib.js`);
  const b = e.requestInfo().body || {};
  const type = String(b.type || "");
  if (!L.QUOTA_MOIS[type]) throw new BadRequestError("type inconnu");
  let consent = {};
  try { consent = JSON.parse(toString(e.auth.get("consentement"))) || {}; } catch (_) {}
  if (consent.ia !== true) throw new ForbiddenError("L'IA est désactivée dans ton profil.");
  if (L.compteMois(e.app, e.auth.id, type) >= L.QUOTA_MOIS[type]) throw new TooManyRequestsError("Déjà fait ce mois-ci. Prochain le mois prochain.");
  const texte = String(b.texte || "").slice(0, 300000);
  const consigne = String(b.consigne || "").slice(0, 20000);
  if (!texte) throw new BadRequestError("texte vide");
  try {
    const rep = L.appelClaude(consigne || "Tu aides le Carnet de Suivi. Réponds en français.", texte, Math.min(Number(b.max) || 3000, 6000));
    L.journalIA(e.app, e.auth.id, type, rep.entree, rep.sortie, false);
    return e.json(200, { text: rep.texte });
  } catch (err) {
    L.journalIA(e.app, e.auth.id, type, 0, 0, true);
    L.alerte(e.app, "IA indisponible", "Une demande « " + type + " » a échoué : " + err);
    return e.json(503, { message: "L'IA est indisponible pour l'instant. Ton coaching sera relu plus tard." });
  }
}, $apis.requireAuth("users"));

// ---- Texte d'un PDF de l'élève (extrait sur le serveur, rien n'est envoyé ailleurs) ----
routerAdd("POST", "/api/carnet/pdf-texte", (e) => {
  const b = e.requestInfo().body || {};
  const rec = e.app.findRecordById("fichiers", String(b.fichier || ""));
  if (rec.getString("owner") !== e.auth.id) throw new ForbiddenError("interdit");
  const nom = rec.getString("fichier");
  if (!/\.pdf$/i.test(nom)) throw new BadRequestError("ce n'est pas un PDF");
  const chemin = e.app.dataDir() + "/storage/" + rec.baseFilesPath() + "/" + nom;
  const sortie = $os.cmd("pdftotext", "-layout", "-enc", "UTF-8", chemin, "-").output();
  return e.json(200, { texte: toString(sortie).slice(0, 300000) });
}, $apis.requireAuth("users"));

// ---- Fiche du bilan envoyée au coach (adresse fixée sur le serveur, jamais choisie par l'app) ----
routerAdd("POST", "/api/carnet/fiche", (e) => {
  const L = require(`${__hooks}/carnet_lib.js`);
  const coach = $os.getenv("COACH_EMAIL");
  if (!coach) throw new BadRequestError("adresse du coach non réglée");
  const b = e.requestInfo().body || {};
  const s = e.app.settings();
  e.app.newMailClient().send(new MailerMessage({
    from: { address: s.meta.senderAddress, name: s.meta.senderName || "Carnet de Suivi" },
    to: [{ address: coach }],
    subject: String(b.sujet || "Bilan du vendredi").slice(0, 200),
    text: String(b.texte || "").slice(0, 50000) + "\n\nid: " + e.auth.id,
  }));
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));
