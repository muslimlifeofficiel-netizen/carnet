/* Carnet de Suivi : remplace le moteur de claude.ai par le serveur de Muslim Life (PocketBase).
   Le code du Carnet appelle toujours `await claude.use("db" | "user" | "assets" | "sample" | "mcp")` :
   ce fichier rend les mêmes services, branchés sur le serveur. Rien d'autre à changer dans le Carnet.
   Connexion : code à 6 chiffres reçu par e-mail. Le jeton reste sur le téléphone. */
(function () {
  var SERVEUR = window.CARNET_SERVEUR || "https://carnet.muslimlifefitness.com";
  var CLE = "carnet_session";
  var session = null;
  try { session = JSON.parse(localStorage.getItem(CLE) || "null"); } catch (e) {}

  function err(code, message) { var e = new Error(message || code); e.code = code; return e; }
  function api(methode, chemin, corps, brut) {
    var h = {};
    if (session && session.token) h.Authorization = session.token;
    if (corps !== undefined && !brut) h["Content-Type"] = "application/json";
    return fetch(SERVEUR + chemin, { method: methode, headers: h, body: corps === undefined ? undefined : (brut ? corps : JSON.stringify(corps)) })
      .then(function (r) {
        return r.text().then(function (t) {
          var j = {}; try { j = t ? JSON.parse(t) : {}; } catch (e) {}
          if (r.status === 401) { deconnexion(); throw err("revoked", "Session expirée"); }
          if (r.status === 404) throw err("not_found", j.message);
          if (r.status === 403) throw err("invalid_argument", j.message || "interdit");
          if (r.status === 429) throw err("resource_exhausted", j.message);
          if (r.status >= 500) throw err("unavailable", j.message);
          if (r.status >= 400) throw err("invalid_argument", j.message);
          return j;
        });
      }, function () { throw err("unavailable", "Pas de connexion"); });
  }
  function deconnexion() { session = null; try { localStorage.removeItem(CLE); } catch (e) {} }
  function q(s) { return "'" + String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'"; }

  /* ---------- Connexion par code e-mail ---------- */
  window.__connexionML = {
    connecte: function () { return !!(session && session.token); },
    demanderCode: function (email) { return api("POST", "/api/collections/users/request-otp", { email: email }).then(function (r) { return r.otpId; }); },
    validerCode: function (otpId, code) {
      return api("POST", "/api/collections/users/auth-with-otp", { otpId: otpId, password: code }).then(function (r) {
        session = { token: r.token, user: r.record };
        try { localStorage.setItem(CLE, JSON.stringify(session)); } catch (e) {}
        // Décalage horaire de l'élève : sert au résumé du jour à minuit.
        return api("PATCH", "/api/collections/users/records/" + r.record.id, { decalage: new Date().getTimezoneOffset() }).then(function () { return r.record; });
      });
    },
    deconnecter: deconnexion,
    moi: function () { return session && session.user; },
    profil: function (champs) { return api("PATCH", "/api/collections/users/records/" + session.user.id, champs).then(function (u) { session.user = u; try { localStorage.setItem(CLE, JSON.stringify(session)); } catch (e) {} return u; }); }
  };

  /* ---------- db ---------- */
  var cache = {}; // chemin -> enregistrement serveur
  function geler(o) { if (o && typeof o === "object") { Object.freeze(o); for (var k in o) geler(o[k]); } return o; }
  function snapDoc(chemin, rec) {
    var d = rec ? geler(JSON.parse(JSON.stringify(rec.data || {}))) : undefined;
    return { id: chemin.split("/").pop(), exists: !!rec, data: function () { return d; }, metadata: { fromCache: false, hasPendingWrites: false } };
  }
  function lireDoc(chemin) {
    return api("GET", "/api/collections/docs/records?perPage=1&filter=" + encodeURIComponent("path=" + q(chemin)))
      .then(function (r) { var rec = (r.items || [])[0] || null; if (rec) cache[chemin] = rec; else delete cache[chemin]; return rec; });
  }
  function fusion(a, b) {
    var r = JSON.parse(JSON.stringify(a || {}));
    for (var k in b) r[k] = (b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) && r[k] && typeof r[k] === "object" && !Array.isArray(r[k])) ? fusion(r[k], b[k]) : b[k];
    return r;
  }
  var abonnes = [];
  function prevenir() { abonnes.forEach(function (f) { try { f(); } catch (e) {} }); }
  setInterval(prevenir, 15000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) prevenir(); });

  function docRef(chemin) {
    var ref = {
      id: chemin.split("/").pop(), path: chemin,
      get: function () { return lireDoc(chemin).then(function (rec) { return snapDoc(chemin, rec); }); },
      set: function (data) {
        var p = cache[chemin] ? Promise.resolve(cache[chemin]) : lireDoc(chemin);
        return p.then(function (rec) {
          return rec ? api("PATCH", "/api/collections/docs/records/" + rec.id, { data: data }) : api("POST", "/api/collections/docs/records", { path: chemin, data: data });
        }).then(function (rec) { cache[chemin] = rec; prevenir(); });
      },
      update: function (data) {
        return lireDoc(chemin).then(function (rec) {
          if (!rec) throw err("invalid_argument", "document absent");
          return api("PATCH", "/api/collections/docs/records/" + rec.id, { data: fusion(rec.data, data) });
        }).then(function (rec) { cache[chemin] = rec; prevenir(); });
      },
      delete: function () {
        return lireDoc(chemin).then(function (rec) { return rec ? api("DELETE", "/api/collections/docs/records/" + rec.id) : null; })
          .then(function () { delete cache[chemin]; prevenir(); });
      },
      acquire: function () { return Promise.resolve({ acquired: true }); },
      onSnapshot: function (next, erreur) {
        var actif = true, dernier = null;
        function tour() { if (!actif) return; ref.get().then(function (s) { var j = JSON.stringify(s.exists ? s.data() : null); if (j !== dernier) { dernier = j; next(s); } }, function (e) { if (e.code === "revoked") { actif = false; erreur && erreur(e); } }); }
        abonnes.push(tour); tour();
        return function () { actif = false; abonnes = abonnes.filter(function (f) { return f !== tour; }); };
      },
      collection: function (p) { return collRef(chemin + "/" + p); }
    };
    return ref;
  }
  function val(o, champ) { return o ? o[champ] : undefined; }
  function compare(a, op, b) {
    switch (op) {
      case "==": return a === b; case "!=": return a !== b; case "<": return a < b; case "<=": return a <= b;
      case ">": return a > b; case ">=": return a >= b; case "in": return (b || []).indexOf(a) >= 0;
      case "not-in": return (b || []).indexOf(a) < 0; case "array-contains": return Array.isArray(a) && a.indexOf(b) >= 0;
    } return false;
  }
  function collRef(chemin, filtres, tri, max) {
    filtres = filtres || [];
    function lire() {
      return api("GET", "/api/collections/docs/records?perPage=1000&sort=path&filter=" + encodeURIComponent("coll=" + q(chemin))).then(function (r) {
        var items = (r.items || []).filter(function (rec) { cache[rec.path] = rec; return filtres.every(function (f) { return compare(val(rec.data, f[0]), f[1], f[2]); }); });
        if (tri) items.sort(function (x, y) { var a = val(x.data, tri[0]), b = val(y.data, tri[0]); if (a === undefined) return 1; if (b === undefined) return -1; return (a < b ? -1 : a > b ? 1 : 0) * (tri[1] === "desc" ? -1 : 1); });
        if (max) items = items.slice(0, max);
        var docs = items.map(function (rec) { return snapDoc(rec.path, rec); });
        return docs;
      });
    }
    function qs(docs, avant) {
      var ids = {}; (avant || []).forEach(function (d, i) { ids[d.id] = i; });
      return { docs: docs, size: docs.length, empty: docs.length === 0, metadata: { fromCache: false, hasPendingWrites: false },
        docChanges: function () { return docs.map(function (d, i) { return { type: ids[d.id] === undefined ? "added" : "modified", doc: d, oldIndex: ids[d.id] === undefined ? -1 : ids[d.id], newIndex: i }; }); } };
    }
    return {
      path: chemin,
      where: function (c, op, v) { return collRef(chemin, filtres.concat([[c, op, v]]), tri, max); },
      orderBy: function (c, dir) { return collRef(chemin, filtres, [c, dir || "asc"], max); },
      limit: function (n) { return collRef(chemin, filtres, tri, n); },
      get: function () { return lire().then(function (d) { return qs(d); }); },
      onSnapshot: function (next, erreur) {
        var actif = true, dernier = null, precedent = [];
        function tour() { if (!actif) return; lire().then(function (d) { var j = JSON.stringify(d.map(function (x) { return [x.id, x.data()]; })); if (j !== dernier) { dernier = j; var s = qs(d, precedent); precedent = d; next(s); } }, function (e) { if (e.code === "revoked") { actif = false; erreur && erreur(e); } }); }
        abonnes.push(tour); tour();
        return function () { actif = false; abonnes = abonnes.filter(function (f) { return f !== tour; }); };
      },
      doc: function (id) { return docRef(chemin + "/" + (id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)))); },
      add: function (data) { var r = this.doc(); return r.set(data).then(function () { return r; }); }
    };
  }
  var db = { doc: docRef, collection: function (c) { return collRef(c); } };

  /* ---------- user ---------- */
  var user = {
    id: function () { return Promise.resolve(session ? session.user.id : null); },
    me: function () { return Promise.resolve(session ? { id: session.user.id, name: session.user.pseudo || "" } : { id: null, name: "" }); },
    isOwner: function () { return false; }, canEdit: function () { return false; },
    can: function (n) { return n === "data.write" ? !!session : null; },
    profiles: function (ids) { var r = {}; (ids || []).forEach(function (i) { r[i] = { id: i, name: "" }; }); return Promise.resolve(r); }
  };

  /* ---------- assets (photos, PDF) : protégés, lus avec un jeton ---------- */
  var urls = {};
  function urlFichier(id) {
    if (urls[id]) return Promise.resolve(urls[id]);
    return api("GET", "/api/collections/fichiers/records/" + id).then(function (rec) {
      return api("POST", "/api/files/token").then(function (t) {
        urls[id] = SERVEUR + "/api/files/fichiers/" + id + "/" + rec.fichier + "?token=" + t.token;
        return urls[id];
      });
    });
  }
  var assets = {
    upload: function (blob, opts) {
      var f = new FormData();
      f.append("fichier", blob, (blob && blob.name) || ("fichier." + ((blob.type || "").split("/")[1] || "bin")));
      f.append("public", opts && opts.public ? "true" : "false");
      return api("POST", "/api/collections/fichiers/records", f, true).then(function (rec) {
        return { id: rec.id, url: "/_blob/" + rec.id, sizeBytes: blob.size, contentType: blob.type };
      });
    },
    list: function () { return api("GET", "/api/collections/fichiers/records?perPage=500").then(function (r) { return { assets: (r.items || []).map(function (x) { return { id: x.id, url: "/_blob/" + x.id }; }), usage: {} }; }); },
    delete: function (id) { return api("DELETE", "/api/collections/fichiers/records/" + id); },
    urlFichier: urlFichier
  };
  // Le Carnet affiche les fichiers par « /_blob/<id> » : on remplace ces adresses par l'adresse protégée.
  function corrige(el) {
    var a = el.getAttribute && el.getAttribute("src");
    if (a && a.indexOf("/_blob/") === 0) { el.removeAttribute("src"); urlFichier(a.slice(7).split("?")[0]).then(function (u) { el.setAttribute("src", u); }, function () {}); }
  }
  new MutationObserver(function (ms) {
    ms.forEach(function (m) {
      if (m.type === "attributes") corrige(m.target);
      (m.addedNodes || []).forEach(function (n) { if (n.nodeType === 1) { corrige(n); n.querySelectorAll && n.querySelectorAll("[src^='/_blob/']").forEach(corrige); } });
    });
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["src"] });

  /* ---------- sample (IA) : seulement lecture du coaching et import des séances, 1 fois par mois ---------- */
  function sample(input, opts) {
    opts = opts || {};
    var type = opts.carnetType || window.__carnetIA;
    if (type !== "coaching" && type !== "seances") return Promise.reject(err("not_granted", "Le résumé du jour est préparé chaque nuit par le serveur."));
    var texte = typeof input === "string" ? input : (input || []).map(function (m) { return m.content; }).join("\n\n");
    return api("POST", "/api/carnet/ia", { type: type, texte: texte, max: opts.maxTokens || 3000 }).then(function (r) {
      if (opts.onText) opts.onText({ text: r.text, delta: r.text });
      return { text: r.text, truncated: false };
    });
  }
  sample.json = function (input, opts) { return sample(input, opts).then(function (r) { var t = r.text.replace(/^```(json)?|```$/g, "").trim(); return JSON.parse(t); }); };
  sample.limits = function () { return Promise.resolve({ images: false }); };

  /* ---------- mcp : seule action gardée, envoyer la fiche au coach (adresse fixée par le serveur) ---------- */
  var mcp = {
    call: function (serveur, outil, args) {
      if (/gmail/i.test(serveur) && /send/.test(outil)) return api("POST", "/api/carnet/fiche", { sujet: (args || {}).subject, texte: (args || {}).body || (args || {}).text || "" });
      return Promise.reject(err("not_granted", "Indisponible dans l'app."));
    }
  };

  var services = { db: db, user: user, assets: assets, sample: sample, mcp: mcp };
  window.claude = window.claude || {};
  window.claude.use = function (nom) { return Promise.resolve(session && services[nom] ? services[nom] : null); };
  window.__carnetServeur = { api: api, resumeDuJour: function () { return api("GET", "/api/collections/resumes/records?perPage=1&sort=-jour").then(function (r) { return (r.items || [])[0] || null; }); } };
})();
