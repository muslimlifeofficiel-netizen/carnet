/* Carnet de Suivi : connexion, inscription et tutoriel (l'intro).
   Ordre à la première ouverture : connexion (quand le serveur est en ligne) → accord (index.html) → inscription → tutoriel.
   Le tutoriel se revoit depuis « Comment ça marche ». Textes : brouillon de Claude du 27/11, à valider par Sami. */
(function () {
  var SERVEUR_ACTIF = window.CARNET_SERVEUR_ACTIF === true; // passe à true quand carnet.muslimlifefitness.com répond
  var $ = function (id) { return document.getElementById(id); };
  function lire(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  function ecrire(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function el(html) { var d = document.createElement("div"); d.innerHTML = html.trim(); return d.firstChild; }

  var css = document.createElement("style");
  css.textContent = [
    ".ecran{position:fixed;inset:0;background:#0B0B0A;color:#F2EFE8;z-index:20;overflow:auto;padding:32px 20px 40px;font:15px/1.5 -apple-system,Roboto,sans-serif}",
    ".ecran h2{font-size:24px;margin:8px 0 6px}.ecran .gris{color:#9A968D;font-size:14px;margin:0 0 20px}",
    ".ecran input{width:100%;box-sizing:border-box;background:#1A1A18;color:#F2EFE8;border:1px solid #2E2D2A;border-radius:12px;padding:14px;font-size:16px;margin:6px 0 14px}",
    ".ecran label.t{font-size:13px;color:#9A968D}.choix{display:flex;gap:10px;margin:6px 0 16px}",
    ".choix button{flex:1;margin:0;background:#1A1A18;color:#F2EFE8;border:2px solid #2E2D2A}.choix .frere.on{border-color:#2C7AD8;background:#2C7AD8;color:#fff}.choix .soeur.on{border-color:#CE5A86;background:#CE5A86;color:#fff}",
    ".tuto{display:flex;flex-direction:column;justify-content:space-between;padding:0}",
    ".pistes{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;flex:1;scrollbar-width:none}.pistes::-webkit-scrollbar{display:none}",
    ".slide{flex:0 0 100%;scroll-snap-align:center;box-sizing:border-box;padding:56px 28px 20px;display:flex;flex-direction:column;justify-content:center}",
    ".slide .num{color:#C99A2E;font-weight:800;font-size:13px;letter-spacing:2px}.slide h3{font-size:28px;line-height:1.15;margin:10px 0 16px}",
    ".slide p{margin:0 0 8px;font-size:17px;color:#D9D5CC}.slide ul{padding-left:20px;margin:6px 0}.slide li{margin:6px 0;font-size:16px}",
    ".points{display:flex;justify-content:center;gap:8px;padding:10px}.points i{width:8px;height:8px;border-radius:4px;background:#2E2D2A}.points i.on{background:#C99A2E;width:22px}",
    ".tuto .bas{padding:0 20px 28px}.passer{position:absolute;top:18px;right:18px;color:#9A968D;font-size:14px;background:none;border:0;width:auto;margin:0;padding:6px}"
  ].join("\n");
  document.head.appendChild(css);

  /* ---------- Connexion (code par e-mail) ---------- */
  function ecranConnexion(fini) {
    var e = el('<div class="ecran"><h2>Ton Carnet</h2><p class="gris">Entre l\'e-mail que tu as donné à ton coach. Tu reçois un code. Pas de mot de passe.</p>'
      + '<label class="t">Ton e-mail</label><input id="iMail" type="email" autocomplete="email">'
      + '<div id="zCode" hidden><label class="t">Le code reçu</label><input id="iCode" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></div>'
      + '<button id="bCo">Recevoir mon code</button><div class="etat" id="eCo"></div></div>');
    document.body.appendChild(e);
    var otp = null;
    $("bCo").onclick = function () {
      var C = window.__connexionML;
      if (!otp) {
        $("eCo").textContent = "Envoi…";
        C.demanderCode($("iMail").value.trim()).then(function (id) { otp = id; $("zCode").hidden = false; $("bCo").textContent = "Valider"; $("eCo").textContent = "Code envoyé. Regarde tes e-mails."; },
          function () { $("eCo").textContent = "Impossible d'envoyer le code. Vérifie l'adresse."; });
      } else {
        C.validerCode(otp, $("iCode").value.trim()).then(function () { e.remove(); fini(); },
          function () { $("eCo").textContent = "Code faux ou expiré."; });
      }
    };
  }

  /* ---------- Inscription : pseudo, frère ou sœur, date de naissance ---------- */
  function ecranInscription(fini) {
    var e = el('<div class="ecran"><h2>Faisons connaissance</h2><p class="gris">Trois questions. Une seule fois.</p>'
      + '<label class="t">Ton prénom ou ton pseudo (24 caractères)</label><input id="iPseudo" maxlength="24">'
      + '<label class="t">Tu es</label><div class="choix"><button class="frere" data-g="frere">Un frère</button><button class="soeur" data-g="soeur">Une sœur</button></div>'
      + '<label class="t">Ta date de naissance</label><input id="iNaiss" type="date">'
      + '<p class="gris" style="font-size:12px;margin-top:-6px">Elle sert à calculer ta composition, ton métabolisme et tes zones. Rien d\'autre.</p>'
      + '<button id="bIns" disabled>Continuer</button></div>');
    document.body.appendChild(e);
    var genre = null;
    e.querySelectorAll(".choix button").forEach(function (b) { b.onclick = function () { genre = b.dataset.g; e.querySelectorAll(".choix button").forEach(function (x) { x.classList.toggle("on", x === b); }); maj(); }; });
    function maj() { $("bIns").disabled = !($("iPseudo").value.trim() && genre && $("iNaiss").value); }
    $("iPseudo").oninput = maj; $("iNaiss").onchange = maj;
    $("bIns").onclick = function () {
      var p = { pseudo: $("iPseudo").value.trim(), genre: genre, naissance: $("iNaiss").value };
      ecrire("carnet_profil", p);
      var envoi = (SERVEUR_ACTIF && window.__connexionML && window.__connexionML.connecte())
        ? window.__connexionML.profil({ pseudo: p.pseudo, genre: p.genre, naissance: p.naissance + " 00:00:00.000Z", consentement: lire("carnet_accord") })
        : Promise.resolve();
      envoi.then(function () { e.remove(); fini(p); }, function () { e.remove(); fini(p); });
    };
  }

  /* ---------- Tutoriel en slides ---------- */
  function slides(genre) {
    var soeur = genre === "soeur";
    return [
      ["Bienvenue", "Salam aleykoum.<br>Voici ton Carnet.", "<p>Ta santé, ton sport, ta nutrition.</p><p>Chaque jour.</p><p>Avec ton coach.</p>"],
      ["Chaque jour", "Tu pointes.", "<p>Santé, sport, nutrition : bien, moyen ou mauvais.</p><p>30 secondes.</p><p>Tu ne pointes que le jour même. Ta série se construit jour après jour.</p>"],
      ["Le vendredi", "Ton bilan.", soeur
        ? "<p>Ton poids, tes réponses, ce que tu as à dire.</p><p>Aucune photo pour les sœurs.</p><p><b>En enregistrant ton bilan, ta fiche part à ton coach.</b></p>"
        : "<p>Ton poids, tes 4 photos, tes réponses, ce que tu as à dire.</p><p><b>En enregistrant ton bilan, ta fiche part à ton coach.</b></p>"],
      ["Ton coaching", "Dépose ton PDF.", "<p>Chaque mois, dépose ton coaching dans l'app.</p><p>Le Carnet le lit et en tire l'essentiel : ton objectif, tes calories, ton planning.</p>"],
      ["Les rangs", "Ça se mérite.", "<p>Chaque jour pointé te donne des points.</p><p>De Wood à Prisme.</p><p>Ton rang ne redescend jamais.</p>"],
      ["Ton corps", "Montre et balance.", "<p>Branche-les une fois.</p><p>Le Carnet lit tes pas, ton sommeil, ton cœur et ta composition.</p><p>Chaque nuit, ton résumé du jour t'attend.</p>"],
      ["Tes données", "Sont à toi.", "<p>Seul ton coach les voit.</p><p>Aucun autre élève. Rien n'est vendu.</p><p>Les autres voient seulement ton étendard : pseudo, rang, points.</p>"],
      ["Ta première mission", "Débloque ton rang.", "<ul><li>Choisis ton pseudo" + (soeur ? "" : " et ta photo") + "</li><li>Dépose ton coaching</li><li>Pointe aujourd'hui</li><li>Fais ton premier bilan vendredi</li></ul><p>Tout fait : rang Wood.</p>"]
    ];
  }
  function tutoriel(fini) {
    var p = lire("carnet_profil") || {};
    var S = slides(p.genre);
    var e = el('<div class="ecran tuto"><button class="passer">Passer</button><div class="pistes"></div><div class="points"></div><div class="bas"><button id="bTuto">Suivant</button></div></div>');
    var pistes = e.querySelector(".pistes"), pts = e.querySelector(".points");
    S.forEach(function (s, i) {
      pistes.appendChild(el('<section class="slide"><div class="num">' + String(i + 1).padStart(2, "0") + " · " + s[0].toUpperCase() + "</div><h3>" + s[1] + "</h3>" + s[2] + "</section>"));
      pts.appendChild(document.createElement("i"));
    });
    document.body.appendChild(e);
    function idx() { return Math.round(pistes.scrollLeft / pistes.clientWidth); }
    function maj() { var i = idx(); pts.querySelectorAll("i").forEach(function (x, k) { x.classList.toggle("on", k === i); }); $("bTuto").textContent = i === S.length - 1 ? "C'est parti" : "Suivant"; }
    pistes.addEventListener("scroll", function () { window.requestAnimationFrame(maj); });
    function fermer() { ecrire("carnet_tuto_vu", { date: new Date().toISOString() }); e.remove(); fini && fini(); }
    $("bTuto").onclick = function () { var i = idx(); if (i >= S.length - 1) fermer(); else pistes.scrollTo({ left: (i + 1) * pistes.clientWidth, behavior: "smooth" }); };
    e.querySelector(".passer").onclick = fermer;
    maj();
  }
  window.__tutorielML = tutoriel; // « Comment ça marche »

  /* ---------- Enchaînement à la première ouverture ---------- */
  function suite() {
    if (!lire("carnet_profil")) return ecranInscription(function () { suite(); });
    if (!lire("carnet_tuto_vu")) return tutoriel();
  }
  function attendreAccord() { var A = lire("carnet_accord"); if (A && A.sante && A.majeur) suite(); else setTimeout(attendreAccord, 400); }
  function demarrer() {
    if (SERVEUR_ACTIF && window.__connexionML && !window.__connexionML.connecte()) return ecranConnexion(attendreAccord);
    attendreAccord();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", demarrer); else demarrer();
})();
