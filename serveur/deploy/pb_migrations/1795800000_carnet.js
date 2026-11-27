/// <reference path="../pb_data/types.d.ts" />
// Carnet de Suivi : schéma de la base.
// Principe : les données du Carnet gardent leur forme (un document JSON par chemin, comme dans claude.ai).
// Les droits sont calculés par le serveur à partir du chemin (hooks), jamais par l'app.
migrate((app) => {
  // ---- Élèves (connexion par code e-mail, pas de mot de passe ; comptes créés par Sami seulement) ----
  const users = app.findCollectionByNameOrId("users");
  users.fields.add(new TextField({ name: "pseudo", max: 24 }));
  users.fields.add(new SelectField({ name: "genre", values: ["frere", "soeur"], maxSelect: 1 }));
  users.fields.add(new DateField({ name: "naissance" }));
  users.fields.add(new JSONField({ name: "consentement", maxSize: 4000 }));
  users.fields.add(new NumberField({ name: "decalage", onlyInt: true })); // minutes, comme getTimezoneOffset()
  users.otp.enabled = true;
  users.otp.duration = 600;
  users.otp.length = 6;
  users.passwordAuth.enabled = false;
  users.listRule = "id = @request.auth.id";
  users.viewRule = "id = @request.auth.id";
  users.createRule = null;   // seul Sami crée un compte élève
  users.updateRule = "id = @request.auth.id";
  users.deleteRule = null;   // seul Sami supprime
  app.save(users);

  // ---- Documents du Carnet (un par chemin) ----
  const docs = new Collection({
    type: "base",
    name: "docs",
    fields: [
      { type: "text", name: "path", required: true, max: 1000 },
      { type: "text", name: "coll", required: true, max: 1000 },
      { type: "relation", name: "owner", collectionId: users.id, maxSelect: 1, cascadeDelete: true, required: true },
      { type: "bool", name: "prive" },
      { type: "select", name: "ecriture", values: ["owner", "tous"], maxSelect: 1 },
      { type: "select", name: "genre", values: ["frere", "soeur"], maxSelect: 1 },
      { type: "json", name: "data", maxSize: 300000 },
      { type: "autodate", name: "created", onCreate: true },
      { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_docs_path ON docs (path)",
      "CREATE INDEX idx_docs_coll ON docs (coll)",
      "CREATE INDEX idx_docs_owner ON docs (owner)",
    ],
    listRule: "@request.auth.id != '' && (owner = @request.auth.id || (prive = false && genre = @request.auth.genre))",
    viewRule: "@request.auth.id != '' && (owner = @request.auth.id || (prive = false && genre = @request.auth.genre))",
    createRule: "@request.auth.id != ''",
    updateRule: "@request.auth.id != '' && (owner = @request.auth.id || (prive = false && ecriture = 'tous' && genre = @request.auth.genre))",
    deleteRule: "@request.auth.id != '' && (owner = @request.auth.id || (prive = false && ecriture = 'tous' && genre = @request.auth.genre))",
  });
  app.save(docs);

  // ---- Fichiers (photos, PDF), protégés : servis seulement avec un jeton ----
  const fichiers = new Collection({
    type: "base",
    name: "fichiers",
    fields: [
      { type: "relation", name: "owner", collectionId: users.id, maxSelect: 1, cascadeDelete: true, required: true },
      { type: "file", name: "fichier", maxSelect: 1, maxSize: 20971520, protected: true,
        mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"] },
      { type: "bool", name: "public" },  // photo de profil visible des élèves du même genre
      { type: "select", name: "genre", values: ["frere", "soeur"], maxSelect: 1 },
      { type: "autodate", name: "created", onCreate: true },
    ],
    listRule: "@request.auth.id != '' && (owner = @request.auth.id || (public = true && genre = @request.auth.genre))",
    viewRule: "@request.auth.id != '' && (owner = @request.auth.id || (public = true && genre = @request.auth.genre))",
    createRule: "@request.auth.id != ''",
    updateRule: null,
    deleteRule: "owner = @request.auth.id",
  });
  app.save(fichiers);

  // ---- Résumés du jour (écrits par le serveur seulement) ----
  const resumes = new Collection({
    type: "base",
    name: "resumes",
    fields: [
      { type: "relation", name: "owner", collectionId: users.id, maxSelect: 1, cascadeDelete: true, required: true },
      { type: "text", name: "jour", required: true, max: 10 },
      { type: "text", name: "texte", max: 4000 },
      { type: "select", name: "source", values: ["ia", "calcul", "repris"], maxSelect: 1 },
      { type: "autodate", name: "created", onCreate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_resumes_jour ON resumes (owner, jour)"],
    listRule: "owner = @request.auth.id",
    viewRule: "owner = @request.auth.id",
    createRule: null, updateRule: null, deleteRule: null,
  });
  app.save(resumes);

  // ---- Journal de l'IA (coûts et limites ; Sami seulement) ----
  const ia = new Collection({
    type: "base",
    name: "ia_journal",
    fields: [
      { type: "relation", name: "owner", collectionId: users.id, maxSelect: 1, cascadeDelete: true },
      { type: "select", name: "type", values: ["resume", "coaching", "seances"], maxSelect: 1 },
      { type: "text", name: "mois", max: 7 },
      { type: "number", name: "entree" },
      { type: "number", name: "sortie" },
      { type: "number", name: "cout" },
      { type: "bool", name: "echec" },
      { type: "autodate", name: "created", onCreate: true },
    ],
    indexes: ["CREATE INDEX idx_ia_owner_mois ON ia_journal (owner, type, mois)"],
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
  });
  app.save(ia);
}, (app) => {
  for (const n of ["ia_journal", "resumes", "fichiers", "docs"]) {
    try { app.delete(app.findCollectionByNameOrId(n)); } catch (_) {}
  }
});
