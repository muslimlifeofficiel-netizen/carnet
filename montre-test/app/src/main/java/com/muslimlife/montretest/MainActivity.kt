package com.muslimlife.montretest

import android.graphics.Color
import android.os.Bundle
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.*
import androidx.health.connect.client.request.AggregateGroupByPeriodRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import java.time.*
import java.time.format.DateTimeFormatter

// Page de test du Carnet de Suivi : lit Health Connect (données de la montre déposées par l'app de la marque).
class MainActivity : ComponentActivity() {
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
    private lateinit var sortie: TextView
    private val demande = registerForActivityResult(PermissionController.createRequestPermissionResultContract()) { ok ->
        ecris("Autorisations accordées : ${ok.size} sur ${perms.size}")
        lire()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val pad = (16 * resources.displayMetrics.density).toInt()
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(pad, pad * 2, pad, pad); setBackgroundColor(Color.parseColor("#0B0B0A")) }
        col.addView(TextView(this).apply { text = "Test montre ML"; textSize = 22f; setTextColor(Color.WHITE) })
        col.addView(Button(this).apply { text = "Autoriser et lire mes données"; setOnClickListener { demarrer() } })
        sortie = TextView(this).apply { textSize = 14f; setTextColor(Color.parseColor("#E8E2D0")); setTextIsSelectable(true) }
        col.addView(ScrollView(this).apply { addView(sortie) })
        setContentView(col)
        ecris("Touche le bouton. Health Connect te demandera l'autorisation.")
    }

    private fun ecris(t: String) { sortie.append(t + "\n") }

    private fun demarrer() {
        val statut = HealthConnectClient.getSdkStatus(this)
        if (statut != HealthConnectClient.SDK_AVAILABLE) { ecris("Health Connect indisponible (statut $statut). Installe ou mets à jour Health Connect."); return }
        val client = HealthConnectClient.getOrCreate(this)
        lifecycleScope.launch {
            val deja = client.permissionController.getGrantedPermissions()
            if (deja.containsAll(perms)) lire() else demande.launch(perms)
        }
    }

    private fun lire() {
        val client = HealthConnectClient.getOrCreate(this)
        val jour = DateTimeFormatter.ofPattern("EEE dd/MM")
        val heure = DateTimeFormatter.ofPattern("dd/MM HH:mm").withZone(ZoneId.systemDefault())
        lifecycleScope.launch {
            try {
                val fin = LocalDate.now().plusDays(1).atStartOfDay()
                val debut = fin.minusDays(7)
                ecris("\n— 7 DERNIERS JOURS —")
                val parJour = client.aggregateGroupByPeriod(AggregateGroupByPeriodRequest(
                    metrics = setOf(StepsRecord.COUNT_TOTAL, DistanceRecord.DISTANCE_TOTAL, TotalCaloriesBurnedRecord.ENERGY_TOTAL,
                        HeartRateRecord.BPM_AVG, HeartRateRecord.BPM_MIN, HeartRateRecord.BPM_MAX),
                    timeRangeFilter = TimeRangeFilter.between(debut, fin),
                    timeRangeSlicer = Period.ofDays(1)))
                for (g in parJour) {
                    val r = g.result
                    ecris("${g.startTime.format(jour)} : ${r[StepsRecord.COUNT_TOTAL] ?: "-"} pas, " +
                        "${r[DistanceRecord.DISTANCE_TOTAL]?.inKilometers?.let { "%.1f km".format(it) } ?: "- km"}, " +
                        "${r[TotalCaloriesBurnedRecord.ENERGY_TOTAL]?.inKilocalories?.let { "%.0f kcal".format(it) } ?: "- kcal"}, " +
                        "cœur ${r[HeartRateRecord.BPM_MIN] ?: "-"}/${r[HeartRateRecord.BPM_AVG] ?: "-"}/${r[HeartRateRecord.BPM_MAX] ?: "-"} (min/moy/max)")
                }
                val plage = TimeRangeFilter.between(debut.atZone(ZoneId.systemDefault()).toInstant(), fin.atZone(ZoneId.systemDefault()).toInstant())
                ecris("\n— AUJOURD'HUI, D'OÙ VIENNENT LES DONNÉES —")
                val auj = TimeRangeFilter.between(LocalDate.now().atStartOfDay(ZoneId.systemDefault()).toInstant(), Instant.now().plusSeconds(60))
                val pas = client.readRecords(ReadRecordsRequest(StepsRecord::class, auj)).records
                ecris("Pas : ${pas.sumOf { it.count }} en ${pas.size} relevé(s), source : ${pas.map { it.metadata.dataOrigin.packageName }.distinct().joinToString().ifEmpty { "aucune" }}")
                val dist = client.readRecords(ReadRecordsRequest(DistanceRecord::class, auj)).records
                ecris("Distance : ${"%.2f".format(dist.sumOf { it.distance.inKilometers })} km, source : ${dist.map { it.metadata.dataOrigin.packageName }.distinct().joinToString().ifEmpty { "aucune" }}")
                val fc = client.readRecords(ReadRecordsRequest(HeartRateRecord::class, auj)).records.flatMap { r -> r.samples.map { it to r.metadata.dataOrigin.packageName } }
                fc.lastOrNull()?.let { (e, src) -> ecris("Dernier cœur : ${e.beatsPerMinute} bpm à ${heure.format(e.time)} (${fc.size} mesures), source : $src") } ?: ecris("Cœur : aucune mesure aujourd'hui")
                ecris("\n— SOMMEIL —")
                val noms = mapOf(SleepSessionRecord.STAGE_TYPE_AWAKE to "éveil", SleepSessionRecord.STAGE_TYPE_LIGHT to "léger",
                    SleepSessionRecord.STAGE_TYPE_DEEP to "profond", SleepSessionRecord.STAGE_TYPE_REM to "paradoxal",
                    SleepSessionRecord.STAGE_TYPE_SLEEPING to "endormi", SleepSessionRecord.STAGE_TYPE_OUT_OF_BED to "hors du lit")
                val nuits = client.readRecords(ReadRecordsRequest(SleepSessionRecord::class, plage)).records
                if (nuits.isEmpty()) ecris("Aucune nuit.")
                for (n in nuits) {
                    val d = Duration.between(n.startTime, n.endTime)
                    val phases = n.stages.groupBy { it.stage }.map { (s, l) -> "${noms[s] ?: s} ${l.sumOf { Duration.between(it.startTime, it.endTime).toMinutes() }} min" }
                    ecris("${heure.format(n.startTime)} → ${heure.format(n.endTime)} : ${d.toHours()} h ${d.toMinutesPart()} min" +
                        (if (phases.isEmpty()) " (sans phases)" else " (" + phases.joinToString(", ") + ")"))
                }
                ecris("\n— SÉANCES —")
                val seances = client.readRecords(ReadRecordsRequest(ExerciseSessionRecord::class, plage)).records
                if (seances.isEmpty()) ecris("Aucune séance.")
                for (s in seances) ecris("${heure.format(s.startTime)} : type ${s.exerciseType}${s.title?.let { " « $it »" } ?: ""}, ${Duration.between(s.startTime, s.endTime).toMinutes()} min")
                ecris("\n— AUTRES —")
                client.readRecords(ReadRecordsRequest(OxygenSaturationRecord::class, plage)).records.lastOrNull()?.let { ecris("SpO2 : ${it.percentage.value} % (${heure.format(it.time)})") } ?: ecris("SpO2 : aucune")
                client.readRecords(ReadRecordsRequest(Vo2MaxRecord::class, plage)).records.lastOrNull()?.let { ecris("VO2 max : ${it.vo2MillilitersPerMinuteKilogram}") } ?: ecris("VO2 max : aucune")
                client.readRecords(ReadRecordsRequest(WeightRecord::class, plage)).records.lastOrNull()?.let { ecris("Poids : ${it.weight.inKilograms} kg") } ?: ecris("Poids : aucun")
                client.readRecords(ReadRecordsRequest(BodyFatRecord::class, plage)).records.lastOrNull()?.let { ecris("Masse grasse : ${it.percentage.value} %") } ?: ecris("Masse grasse : aucune")
                ecris("\nFini. Fais une capture et envoie-la.")
            } catch (e: Exception) {
                ecris("Erreur : ${e.javaClass.simpleName} : ${e.message}")
            }
        }
    }
}
