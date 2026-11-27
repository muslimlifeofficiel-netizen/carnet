/* Carnet de Suivi : pouvoirs de l'app Android (montre et balance).
   Dans l'app, l'objet CarnetNatif existe ; dans un navigateur, il n'existe pas et ces fonctions le disent.
   window.__montreML.connecte(jours) -> Promise({jours:[{date,pas,km,kcal,fcMoy,fcMin,fcMax,sommeilMin,seancesMin}], spo2, vo2max, poids, masseGrasse, sources})
   window.__balanceML.connecte(profil, suivi) -> Promise({kg, ohms}) ; profil = {femme:bool, age, cm} ; suivi(etat) pour l'affichage.
   Balance prise en charge : famille ICOMON / Fitdays (service FFB0), protocole écrit pour le Carnet le 26/11/2026. */
(function(){
  var N = window.CarnetNatif || null;
  var ecoute = {};
  window.__natifRetour = function(type, d){ (ecoute[type] || []).slice().forEach(function(f){ try{ f(d); }catch(e){ console.error(e); } }); };
  function sur(type, f){ (ecoute[type] = ecoute[type] || []).push(f); return function(){ ecoute[type] = (ecoute[type] || []).filter(function(x){ return x !== f; }); }; }
  window.__natifML = { present: !!N, info: function(){ try{ return N ? JSON.parse(N.info()) : null; }catch(e){ return null; } } };

  /* ---------- Montre ---------- */
  window.__montreML = {
    connecte: function(jours){
      return new Promise(function(ok, ko){
        if (!N) return ko(new Error("La montre se connecte dans l'app Carnet installée sur Android."));
        var stop = sur("montre-donnees", function(d){ stop(); d && d.erreur ? ko(new Error(d.erreur)) : ok(d); });
        N.montreConnecte(jours || 7);
      });
    }
  };

  /* ---------- Balance (FFB0) ---------- */
  function chk(f){ var s = 0; for (var i = 3; i <= 18; i++) s += f[i]; return s & 0x1f; }
  function hexVers(dv){ var s = []; for (var i = 0; i < dv.length; i++) s.push(("0" + dv[i].toString(16)).slice(-2)); return s.join(" "); }
  function octets(hex){ return new Uint8Array(hex.trim().split(" ").map(function(x){ return parseInt(x, 16); })); }

  window.__balanceML = {
    connecte: function(profil, suivi){
      suivi = suivi || function(){};
      return new Promise(function(ok, ko){
        if (!N) return ko(new Error("La balance se connecte dans l'app Carnet installée sur Android."));
        var sortie = 0, baEnvoyes = 0, ecr = null, dernierKg = 0, fini = false, arrets = [];
        function tout(){ arrets.forEach(function(f){ f(); }); }
        function termine(r){ if (fini) return; fini = true; tout(); setTimeout(function(){ N.bleDeconnecte(); }, 500); ok(r); }
        function echoue(m){ if (fini) return; fini = true; tout(); N.bleDeconnecte(); ko(new Error(m)); }
        function fab(type, charge){ var f = new Uint8Array(20); f[0] = sortie; sortie = (sortie + 1) & 0xff; f[1] = charge.length + 1; f[2] = 0; f[3] = type; f.set(charge, 4); f[19] = chk(f); return f; }
        function envoie(f){ if (ecr) N.bleEcrit(ecr, hexVers(f)); }
        function accuse(seq){ envoie(fab(0xb0, [seq, 0x00])); }
        function envoieProfil(){
          if (!profil || !profil.age || !profil.cm) return;
          var t = Math.floor(Date.now() / 1000), off = -new Date().getTimezoneOffset(), o = off < 0 ? (0x8000 | -off) : off, w = 6000;
          envoie(fab(0xba, [t>>>24 & 255, t>>>16 & 255, t>>>8 & 255, t & 255, o >> 8, o & 255, 0, 0, 0, 0, profil.cm & 255, w >> 8, w & 255, ((profil.femme ? 0 : 1) << 7) | (profil.age & 0x7f), 0x2f]));
          baEnvoyes++;
        }
        arrets.push(sur("ble-etat", function(d){
          if (d.erreur) return echoue(d.erreur);
          if (d.etat === "recherche") suivi("Recherche de la balance… monte dessus pour la réveiller.");
          if (d.etat === "connexion") suivi("Connexion…");
          if (d.etat === "connecte"){
            (d.caracteristiques || []).forEach(function(c){ if (c.uuid.indexOf("0000ffb1") === 0 && c.ecriture) ecr = "ffb1"; });
            suivi("Connecté. Monte sur la balance pieds nus et reste immobile.");
          }
          if (d.etat === "fin-recherche" && suivi.trouve !== true) suivi("Aucune balance trouvée. Monte sur la balance puis réessaie.");
          if (d.etat === "deconnecte" && !fini){ dernierKg ? termine({kg: dernierKg, ohms: 0}) : echoue("Balance déconnectée."); }
        }));
        arrets.push(sur("ble-trouve", function(d){ if (suivi.trouve) return; suivi.trouve = true; suivi("Balance trouvée : " + (d.nom || d.adresse)); N.bleConnecte(d.adresse); }));
        arrets.push(sur("ble-trame", function(d){
          var b = octets(d.hex); if (b.length < 6) return;
          var seq = b[0], partie = b[2], t = b[3];
          if (b.length >= 20 && partie === 0){
            if (t === 0xa1){ accuse(seq); if (baEnvoyes < 3) envoieProfil(); }
            else if (t === 0xa0 || t === 0xa3 || t === 0xa4) accuse(seq);
          }
          if (partie === 0 && t === 0xa2 && b.length >= 9){
            var g = (b[6] << 16) | (b[7] << 8) | b[8];
            if (g > 0){ dernierKg = g / 1000; suivi((b[4] === 3 ? "Poids stabilisé : " : "Pesée en cours : ") + dernierKg.toFixed(2).replace(".", ",") + " kg"); }
          }
          if (partie === 0 && t === 0xa3 && b.length >= 8){
            var g2 = (b[5] << 16) | (b[6] << 8) | b[7];
            if (g2 > 0) dernierKg = g2 / 1000;
            var imp = b.length > 10 ? ((b[9] << 8) | b[10]) : 0;
            if (imp > 0) return termine({kg: dernierKg, ohms: imp});
            suivi("Poids : " + dernierKg.toFixed(2).replace(".", ",") + " kg. Reste immobile, mesure de la composition…");
            // Sans 2e partie dans les 8 secondes : on garde le poids seul.
            setTimeout(function(){ if (!fini) termine({kg: dernierKg, ohms: 0}); }, 8000);
          }
          // HPS-8007 : impédance dans la 2e partie du résultat (octets 3 et 4, en ohms), confirmé le 26/11 (456 ohms).
          if (partie === 1 && b[1] === 0x12 && dernierKg){ var R = (b[3] << 8) | b[4]; termine({kg: dernierKg, ohms: R}); }
        }));
        N.bleCherche("ffb0", "HPS,QN,LEFU,icomon,Body,BF");
      });
    }
  };

  /* Composition à partir du poids et de l'impédance : mêmes formules que le Carnet (Wu 2015, Wang 1999, Janssen 2000, Mifflin-St Jeor). */
  window.__compoML = function(kg, R, p){
    if (!p || !(R > 100 && R < 1500)) return null;
    var h2r = p.cm * p.cm / R;
    var ffm = 13.055 + 0.204*kg + 0.394*h2r - 0.136*p.age + (p.femme ? 0 : 8.125);
    var smm = h2r*0.401 + (p.femme ? 0 : 3.825) - 0.071*p.age + 5.102;
    return {poids:kg, gras:(kg-ffm)/kg*100, maigre:ffm, eau:0.73*ffm/kg*100, muscle:smm, bmr:10*kg + 6.25*p.cm - 5*p.age + (p.femme ? -161 : 5), imc:kg/Math.pow(p.cm/100, 2)};
  };
})();
