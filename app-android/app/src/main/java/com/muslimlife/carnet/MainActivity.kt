package com.muslimlife.carnet

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.*
import android.bluetooth.le.*
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.*
import androidx.health.connect.client.request.AggregateGroupByPeriodRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.time.*
import java.util.UUID

/*
 * Carnet de Suivi, app Android.
 * Affiche le Carnet (page web) et lui donne deux pouvoirs qu'une page web n'a pas dans une app :
 *  - la montre, par Health Connect (données gardées sur le téléphone) ;
 *  - la balance, par Bluetooth (le décodage des trames reste en JavaScript, dans natif.js).
 * La page parle à l'app par l'objet JavaScript « CarnetNatif » ; l'app répond par window.__natifRetour(type, donnees).
 */
class MainActivity : ComponentActivity() {

    companion object {
        // Adresse du Carnet. Plus tard : l'adresse du serveur du Carnet.
        const val URL_CARNET = "https://muslimlifeofficiel-netizen.github.io/carnet/web-app/"
    }

    private lateinit var web: WebView
    private val ui = Handler(Looper.getMainLooper())

    // ---------- Retour vers la page ----------
    fun retour(type: String, donnees: Any) {
        val json = JSONObject.quote(donnees.toString())
        ui.post { web.evaluateJavascript("window.__natifRetour && window.__natifRetour(${JSONObject.quote(type)}, JSON.parse($json))", null) }
    }
    fun erreur(type: String, message: String?) = retour(type, JSONObject().put("erreur", message ?: "erreur"))

    // ---------- Montre : Health Connect ----------
    private val perms = setOf(
        HealthPermission.getReadPermission(StepsRecord::class),
        HealthPermission.getReadPermission(DistanceRecord::class),
        HealthPermission.getReadPermission(TotalCaloriesBurnedRecord::class),
        HealthPermission.getReadPermission(HeartRateRecord::class),
        HealthPermission.getReadPermission(SleepSessionRecord::class),
        HealthPermission.getReadPermission(ExerciseSessionRecord::class),
        HealthPermission.getReadPermission(OxygenSaturationRecord::class),
        HealthPermission.getReadPermission(Vo2MaxRecord::class),
        HealthPermission.getReadPermission(WeightRecord::class),
        HealthPermission.getReadPermission(BodyFatRecord::class)
    )
    private var joursDemandes = 7
    private val demandeSante = registerForActivityResult(PermissionController.createRequestPermissionResultContract()) { ok ->
        retour("montre-autorisation", JSONObject().put("accordees", ok.size).put("total", perms.size))
        if (ok.isNotEmpty()) lireMontre(joursDemandes)
    }

    fun connecterMontre(jours: Int) {
        joursDemandes = jours
        val statut = HealthConnectClient.getSdkStatus(this)
        if (statut != HealthConnectClient.SDK_AVAILABLE) {
            erreur("montre-donnees", "Health Connect indisponible sur ce téléphone (statut $statut). Installe ou mets à jour Health Connect.")
            return
        }
        val client = HealthConnectClient.getOrCreate(this)
        lifecycleScope.launch {
            try {
                val deja = client.permissionController.getGrantedPermissions()
                if (deja.containsAll(perms)) lireMontre(jours) else ui.post { demandeSante.launch(perms) }
            } catch (e: Exception) { erreur("montre-donnees", e.message) }
        }
    }

    fun lireMontre(jours: Int) {
        val client = HealthConnectClient.getOrCreate(this)
        val zone = ZoneId.systemDefault()
        lifecycleScope.launch {
            try {
                val fin = LocalDate.now().plusDays(1).atStartOfDay()
                val debut = fin.minusDays(jours.toLong().coerceIn(1, 30))
                val res = JSONObject()
                val tab = JSONArray()
                val parJour = client.aggregateGroupByPeriod(AggregateGroupByPeriodRequest(
                    metrics = setOf(StepsRecord.COUNT_TOTAL, DistanceRecord.DISTANCE_TOTAL, TotalCaloriesBurnedRecord.ENERGY_TOTAL,
                        HeartRateRecord.BPM_AVG, HeartRateRecord.BPM_MIN, HeartRateRecord.BPM_MAX),
                    timeRangeFilter = TimeRangeFilter.between(debut, fin),
                    timeRangeSlicer = Period.ofDays(1)))
                val plage = TimeRangeFilter.between(debut.atZone(zone).toInstant(), fin.atZone(zone).toInstant())
                val nuits = client.readRecords(ReadRecordsRequest(SleepSessionRecord::class, plage)).records
                val seances = client.readRecords(ReadRecordsRequest(ExerciseSessionRecord::class, plage)).records
                for (g in parJour) {
                    val r = g.result
                    val date = g.startTime.toLocalDate()
                    val j = JSONObject().put("date", date.toString())
                    r[StepsRecord.COUNT_TOTAL]?.let { j.put("pas", it) }
                    r[DistanceRecord.DISTANCE_TOTAL]?.let { j.put("km", Math.round(it.inKilometers * 100) / 100.0) }
                    r[TotalCaloriesBurnedRecord.ENERGY_TOTAL]?.let { j.put("kcal", Math.round(it.inKilocalories)) }
                    r[HeartRateRecord.BPM_AVG]?.let { j.put("fcMoy", it) }
                    r[HeartRateRecord.BPM_MIN]?.let { j.put("fcMin", it) }
                    r[HeartRateRecord.BPM_MAX]?.let { j.put("fcMax", it) }
                    // Sommeil : nuits qui se terminent ce jour-là
                    val minutes = nuits.filter { it.endTime.atZone(zone).toLocalDate() == date }
                        .sumOf { Duration.between(it.startTime, it.endTime).toMinutes() }
                    if (minutes > 0) j.put("sommeilMin", minutes)
                    val sport = seances.filter { it.startTime.atZone(zone).toLocalDate() == date }
                        .sumOf { Duration.between(it.startTime, it.endTime).toMinutes() }
                    if (sport > 0) j.put("seancesMin", sport)
                    tab.put(j)
                }
                res.put("jours", tab)
                client.readRecords(ReadRecordsRequest(OxygenSaturationRecord::class, plage)).records.lastOrNull()?.let { res.put("spo2", it.percentage.value) }
                client.readRecords(ReadRecordsRequest(Vo2MaxRecord::class, plage)).records.lastOrNull()?.let { res.put("vo2max", it.vo2MillilitersPerMinuteKilogram) }
                client.readRecords(ReadRecordsRequest(WeightRecord::class, plage)).records.lastOrNull()?.let { res.put("poids", it.weight.inKilograms) }
                client.readRecords(ReadRecordsRequest(BodyFatRecord::class, plage)).records.lastOrNull()?.let { res.put("masseGrasse", it.percentage.value) }
                val sources = (nuits.map { it.metadata.dataOrigin.packageName } + seances.map { it.metadata.dataOrigin.packageName }).distinct()
                res.put("sources", JSONArray(sources))
                retour("montre-donnees", res)
            } catch (e: Exception) { erreur("montre-donnees", "${e.javaClass.simpleName} : ${e.message}") }
        }
    }

    // ---------- Balance : Bluetooth (trames brutes, décodées dans la page) ----------
    private val ble = Ble(this)
    private var actionBleEnAttente: (() -> Unit)? = null
    private val demandeBle = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { r ->
        if (r.values.all { it }) actionBleEnAttente?.invoke() else erreur("ble-etat", "Autorisation Bluetooth refusée.")
        actionBleEnAttente = null
    }
    fun avecBle(action: () -> Unit) {
        val besoin = if (Build.VERSION.SDK_INT >= 31) arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
                     else arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
        if (besoin.all { checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }) action()
        else { actionBleEnAttente = action; ui.post { demandeBle.launch(besoin) } }
    }

    // ---------- Pont JavaScript ----------
    inner class Pont {
        @JavascriptInterface fun info(): String = JSONObject()
            .put("app", "Carnet Android").put("version", "0.1")
            .put("healthConnect", HealthConnectClient.getSdkStatus(this@MainActivity) == HealthConnectClient.SDK_AVAILABLE)
            .put("bluetooth", packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)).toString()
        @JavascriptInterface fun montreConnecte(jours: Int) { ui.post { connecterMontre(jours) } }
        @JavascriptInterface fun montreLire(jours: Int) { ui.post { lireMontre(jours) } }
        @JavascriptInterface fun bleCherche(services: String, prefixes: String) { ui.post { avecBle { ble.chercher(services, prefixes) } } }
        @JavascriptInterface fun bleArrete() { ui.post { ble.arreterRecherche() } }
        @JavascriptInterface fun bleConnecte(adresse: String) { ui.post { avecBle { ble.connecter(adresse) } } }
        @JavascriptInterface fun bleEcrit(caracteristique: String, hex: String) { ui.post { ble.ecrire(caracteristique, hex) } }
        @JavascriptInterface fun bleDeconnecte() { ui.post { ble.deconnecter() } }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#0B0B0A"))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            webViewClient = WebViewClient()
            webChromeClient = WebChromeClient()
            addJavascriptInterface(Pont(), "CarnetNatif")
        }
        setContentView(web)
        if (savedInstanceState != null) web.restoreState(savedInstanceState) else web.loadUrl(URL_CARNET)
    }
    override fun onSaveInstanceState(outState: Bundle) { super.onSaveInstanceState(outState); web.saveState(outState) }
    @Deprecated("Retour arrière dans la page")
    override fun onBackPressed() { if (web.canGoBack()) web.goBack() else super.onBackPressed() }
    override fun onDestroy() { ble.deconnecter(); super.onDestroy() }
}

/* Bluetooth basse consommation, générique : chercher, se connecter, écouter toutes les caractéristiques qui notifient,
   écrire des octets. Les opérations GATT passent une par une (file d'attente), comme Android l'exige. */
@SuppressLint("MissingPermission")
class Ble(private val a: MainActivity) {
    private val ui = Handler(Looper.getMainLooper())
    private val adaptateur: BluetoothAdapter? get() = (a.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter
    private var gatt: BluetoothGatt? = null
    private val vus = mutableSetOf<String>()
    private val file = ArrayDeque<() -> Unit>()
    private var occupe = false
    private val CCCD = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

    private fun uuid(court: String): UUID =
        if (court.length <= 4) UUID.fromString("0000${court.padStart(4, '0')}-0000-1000-8000-00805f9b34fb") else UUID.fromString(court)

    private val rappelScan = object : ScanCallback() {
        override fun onScanResult(type: Int, r: ScanResult) {
            val adr = r.device.address
            if (!vus.add(adr)) return
            val nom = r.scanRecord?.deviceName ?: r.device.name ?: ""
            val svc = JSONArray((r.scanRecord?.serviceUuids ?: emptyList()).map { it.uuid.toString() })
            a.retour("ble-trouve", JSONObject().put("adresse", adr).put("nom", nom).put("rssi", r.rssi).put("services", svc))
        }
        override fun onScanFailed(code: Int) { a.erreur("ble-etat", "Recherche Bluetooth impossible (code $code).") }
    }

    fun chercher(services: String, prefixes: String) {
        val ad = adaptateur
        if (ad == null || !ad.isEnabled) { a.erreur("ble-etat", "Active le Bluetooth du téléphone."); return }
        vus.clear()
        val listeSvc = services.split(",").map { it.trim() }.filter { it.isNotEmpty() }
        val listeNoms = prefixes.split(",").map { it.trim() }.filter { it.isNotEmpty() }
        // Pas de filtre système (les noms se filtrent mal) : on trie ici.
        val rappel = object : ScanCallback() {
            override fun onScanResult(type: Int, r: ScanResult) {
                val nom = r.scanRecord?.deviceName ?: r.device.name ?: ""
                val svcs = (r.scanRecord?.serviceUuids ?: emptyList()).map { it.uuid }
                val ok = listeSvc.isEmpty() && listeNoms.isEmpty() ||
                    listeSvc.any { s -> svcs.contains(uuid(s)) } || listeNoms.any { p -> nom.startsWith(p, ignoreCase = true) }
                if (ok) rappelScan.onScanResult(type, r)
            }
            override fun onScanFailed(code: Int) = rappelScan.onScanFailed(code)
        }
        enCours = rappel
        ad.bluetoothLeScanner?.startScan(null, ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), rappel)
        a.retour("ble-etat", JSONObject().put("etat", "recherche"))
        ui.postDelayed({ arreterRecherche() }, 20000)
    }
    private var enCours: ScanCallback? = null
    fun arreterRecherche() {
        enCours?.let { try { adaptateur?.bluetoothLeScanner?.stopScan(it) } catch (_: Exception) {} }
        if (enCours != null) a.retour("ble-etat", JSONObject().put("etat", "fin-recherche"))
        enCours = null
    }

    fun connecter(adresse: String) {
        arreterRecherche()
        deconnecter()
        val dev = adaptateur?.getRemoteDevice(adresse) ?: run { a.erreur("ble-etat", "Appareil introuvable."); return }
        a.retour("ble-etat", JSONObject().put("etat", "connexion"))
        gatt = dev.connectGatt(a, false, rappelGatt, BluetoothDevice.TRANSPORT_LE)
    }

    fun deconnecter() {
        file.clear(); occupe = false
        gatt?.let { try { it.disconnect(); it.close() } catch (_: Exception) {} }
        gatt = null
    }

    private fun suivant() {
        if (occupe) return
        val op = file.removeFirstOrNull() ?: return
        occupe = true
        op()
    }
    private fun fini() { occupe = false; ui.post { suivant() } }

    fun ecrire(car: String, hex: String) {
        val g = gatt ?: return
        val octets = hex.trim().split(" ", ":").filter { it.isNotEmpty() }.map { it.toInt(16).toByte() }.toByteArray()
        file.addLast {
            val c = g.services.flatMap { it.characteristics }.firstOrNull { it.uuid == uuid(car) }
            if (c == null) { fini(); return@addLast }
            val type = if (c.properties and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE != 0)
                BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE else BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
            c.writeType = type
            val ok = if (Build.VERSION.SDK_INT >= 33) g.writeCharacteristic(c, octets, type) == BluetoothStatusCodes.SUCCESS
                     else { @Suppress("DEPRECATION") run { c.value = octets; g.writeCharacteristic(c) } }
            if (!ok) fini()
            else if (type == BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE) ui.postDelayed({ fini() }, 60)
        }
        ui.post { suivant() }
    }

    private fun hex(b: ByteArray) = b.joinToString(" ") { "%02x".format(it) }

    private val rappelGatt = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(g: BluetoothGatt, statut: Int, etat: Int) {
            if (etat == BluetoothProfile.STATE_CONNECTED) { ui.post { g.discoverServices() } }
            else if (etat == BluetoothProfile.STATE_DISCONNECTED) {
                a.retour("ble-etat", JSONObject().put("etat", "deconnecte"))
                ui.post { file.clear(); occupe = false }
            }
        }
        override fun onServicesDiscovered(g: BluetoothGatt, statut: Int) {
            val liste = JSONArray()
            for (s in g.services) for (c in s.characteristics) {
                val p = c.properties
                liste.put(JSONObject().put("service", s.uuid.toString()).put("uuid", c.uuid.toString())
                    .put("ecriture", p and (BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0)
                    .put("notifie", p and (BluetoothGattCharacteristic.PROPERTY_NOTIFY or BluetoothGattCharacteristic.PROPERTY_INDICATE) != 0))
                if (p and (BluetoothGattCharacteristic.PROPERTY_NOTIFY or BluetoothGattCharacteristic.PROPERTY_INDICATE) != 0) {
                    file.addLast {
                        g.setCharacteristicNotification(c, true)
                        val d = c.getDescriptor(CCCD)
                        if (d == null) { fini(); return@addLast }
                        val v = if (p and BluetoothGattCharacteristic.PROPERTY_NOTIFY != 0) BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                                else BluetoothGattDescriptor.ENABLE_INDICATION_VALUE
                        val ok = if (Build.VERSION.SDK_INT >= 33) g.writeDescriptor(d, v) == BluetoothStatusCodes.SUCCESS
                                 else { @Suppress("DEPRECATION") run { d.value = v; g.writeDescriptor(d) } }
                        if (!ok) fini()
                    }
                }
            }
            file.addLast { a.retour("ble-etat", JSONObject().put("etat", "connecte").put("caracteristiques", liste)); fini() }
            ui.post { suivant() }
        }
        override fun onDescriptorWrite(g: BluetoothGatt, d: BluetoothGattDescriptor, statut: Int) { fini() }
        override fun onCharacteristicWrite(g: BluetoothGatt, c: BluetoothGattCharacteristic, statut: Int) {
            if (c.writeType != BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE) fini()
        }
        override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic, valeur: ByteArray) {
            a.retour("ble-trame", JSONObject().put("uuid", c.uuid.toString()).put("hex", hex(valeur)))
        }
        @Deprecated("Android 12 et moins")
        override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic) {
            if (Build.VERSION.SDK_INT < 33) {
                @Suppress("DEPRECATION") val v = c.value ?: return
                a.retour("ble-trame", JSONObject().put("uuid", c.uuid.toString()).put("hex", hex(v)))
            }
        }
    }
}
