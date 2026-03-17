package com.procstate.monitor.ui.theme

import androidx.compose.runtime.Stable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance

// ── Light theme (matching tracequery) ───────────────────────────────────────

val LightPrimary = Color(0xFF4A55A2)
val LightOnPrimary = Color(0xFFFFFFFF)
val LightSecondary = Color(0xFF0F9D9F)
val LightBackground = Color(0xFFF8F9FC)
val LightSurface = Color(0xFFFFFFFF)
val LightSurfaceVariant = Color(0xFFEEF0F4)
val LightOnSurface = Color(0xFF1A1C1E)
val LightOnSurfaceVariant = Color(0xFF5F6368)
val LightOutline = Color(0xFFDADCE0)
val LightError = Color(0xFFDC2626)

// ── Dark theme ──────────────────────────────────────────────────────────────

val DarkPrimary = Color(0xFF8B9CF7)
val DarkOnPrimary = Color(0xFF1A1C2E)
val DarkSecondary = Color(0xFF5EEAD4)
val DarkBackground = Color(0xFF111318)
val DarkSurface = Color(0xFF1C1E24)
val DarkSurfaceVariant = Color(0xFF262830)
val DarkOnSurface = Color(0xFFE8EAED)
val DarkOnSurfaceVariant = Color(0xFF9CA3AF)
val DarkOutline = Color(0xFF363840)
val DarkError = Color(0xFFF87171)

// ── Proc state colors ───────────────────────────────────────────────────────

@Stable
object ProcStateColors {

    data class DualColor(val light: Color, val dark: Color)

    // Tableau 20 palette from Vega-Lite (vega.github.io/vega/docs/schemes/#tableau20)
    private val TABLEAU_20 = listOf(
        DualColor(Color(0xFF4C78A8), Color(0xFF9ECAE9)),  // 1  steel blue
        DualColor(Color(0xFFF58518), Color(0xFFFFBF79)),  // 2  orange
        DualColor(Color(0xFF54A24B), Color(0xFF88D27A)),  // 3  green
        DualColor(Color(0xFFE45756), Color(0xFFFF9D98)),  // 4  red
        DualColor(Color(0xFF79706E), Color(0xFFBAB0AC)),  // 5  gray
        DualColor(Color(0xFF43989D), Color(0xFF83BCB6)),  // 6  teal
        DualColor(Color(0xFFB07AA1), Color(0xFFD6A5C9)),  // 7  mauve
        DualColor(Color(0xFF9E765F), Color(0xFFD8B5A5)),  // 8  brown
        DualColor(Color(0xFFD67195), Color(0xFFFCBFD2)),  // 9  pink
        DualColor(Color(0xFFB9A20F), Color(0xFFF2CF5B)),  // 10 olive
        DualColor(Color(0xFF9ECAE9), Color(0xFFC0DAEE)),  // 11 light steel blue
        DualColor(Color(0xFFFFBF79), Color(0xFFFFD9AD)),  // 12 light orange
        DualColor(Color(0xFF88D27A), Color(0xFFB2E2A4)),  // 13 light green
        DualColor(Color(0xFFFF9D98), Color(0xFFFFBFBC)),  // 14 light red
        DualColor(Color(0xFFBAB0AC), Color(0xFFD0C9C5)),  // 15 light gray
        DualColor(Color(0xFF83BCB6), Color(0xFFADD4CF)),  // 16 light teal
        DualColor(Color(0xFFD6A5C9), Color(0xFFE8C8DE)),  // 17 light mauve
        DualColor(Color(0xFFD8B5A5), Color(0xFFE8CFC2)),  // 18 light brown
        DualColor(Color(0xFFFCBFD2), Color(0xFFFDD8E4)),  // 19 light pink
        DualColor(Color(0xFFF2CF5B), Color(0xFFF7E28C)),  // 20 light olive
    )

    /**
     * OOM adj label -> friendly name + explicit Tableau 20 color index.
     * From Android ProcessList.makeOomAdjString() + dumpsys activity lru output.
     * Intentional color assignments for visual clarity.
     */
    private data class StateInfo(val label: String, val colorIndex: Int)

    private val STATE_MAP = mapOf(
        // From makeOomAdjString (by priority, high to low)
        "ntv" to StateInfo("Native", 7),           // brown
        "sys" to StateInfo("System", 0),            // steel blue
        "pers" to StateInfo("Persistent", 0),       // steel blue (same as system)
        "psvc" to StateInfo("Persistent Svc", 6),   // mauve
        "fg" to StateInfo("Foreground", 2),          // green
        "vis" to StateInfo("Visible", 5),            // teal
        "prcp" to StateInfo("Perceptible", 1),       // orange
        "prcm" to StateInfo("Perceptible Med", 11),  // light orange
        "prcl" to StateInfo("Perceptible Low", 9),   // olive
        "bkup" to StateInfo("Backup", 16),           // light teal
        "hvy" to StateInfo("Heavy", 3),              // red
        "svc" to StateInfo("Service", 8),            // pink
        "home" to StateInfo("Home", 12),             // light orange
        "prev" to StateInfo("Previous", 17),         // light brown
        "svcb" to StateInfo("Service B", 18),        // light pink
        "cch" to StateInfo("Cached", 14),            // light gray
        // Additional states from dumpsys activity lru
        "top" to StateInfo("Top", 2),                // green (same as fg)
        "btop" to StateInfo("Bound Top", 10),        // light steel blue
        "fgs" to StateInfo("FG Service", 5),         // teal (same as visible)
        "bfgs" to StateInfo("Bound FG", 15),         // light gray-teal
        "impfg" to StateInfo("Imp FG", 1),           // orange (same as perceptible)
        "impbg" to StateInfo("Imp BG", 11),          // light orange
        "backup" to StateInfo("Backup", 16),         // light teal
        "service" to StateInfo("Service", 8),        // pink
        "service-rs" to StateInfo("Svc Restart", 13), // light red
        "receiver" to StateInfo("Receiver", 19),     // light olive
        "heavy" to StateInfo("Heavy", 3),            // red
        "lastact" to StateInfo("Last Activity", 17), // light brown
        "cached" to StateInfo("Cached", 14),         // light gray
        "frzn" to StateInfo("Frozen", 4),            // gray
        "native" to StateInfo("Native", 7),          // brown
        "fore" to StateInfo("Foreground", 2),        // green
        "percep" to StateInfo("Perceptible", 1),     // orange
        "perceptible" to StateInfo("Perceptible", 1),
        "svcrst" to StateInfo("Svc Restart", 13),
        "lstact" to StateInfo("Last Activity", 17),
        "prev" to StateInfo("Previous", 17),
    )

    private val fallback = DualColor(Color(0xFF636363), Color(0xFF969696))

    private val seenStates = mutableSetOf<String>()

    /** All states seen so far. */
    val order: List<String> get() = seenStates.toList()

    /** Map raw state to friendly label. */
    fun label(state: String): String = STATE_MAP[state]?.label ?: state

    fun get(state: String, isDark: Boolean): Color {
        seenStates.add(state)
        val info = STATE_MAP[state]
        val dual = if (info != null) TABLEAU_20[info.colorIndex] else {
            // Unknown state: stable hash into palette
            TABLEAU_20[(state.hashCode() and 0x7FFFFFFF) % TABLEAU_20.size]
        }
        return if (isDark) dual.dark else dual.light
    }

    /** Whether white text is legible on this color (luminance-based). */
    fun useWhiteText(color: Color): Boolean = color.luminance() < 0.4f
}
