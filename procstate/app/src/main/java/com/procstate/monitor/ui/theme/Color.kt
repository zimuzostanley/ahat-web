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

    // Custom distinct palette. Light = full color, dark = lightened for dark bg.
    private val PALETTE = listOf(
        DualColor(Color(0xFF1F77B4), Color(0xFF6BAED6)),  // 0  blue
        DualColor(Color(0xFFFF7F0E), Color(0xFFFFAA4D)),  // 1  orange
        DualColor(Color(0xFF2CA02C), Color(0xFF5FD35F)),  // 2  green
        DualColor(Color(0xFFD62728), Color(0xFFFF6B6B)),  // 3  red
        DualColor(Color(0xFF9467BD), Color(0xFFBB8FDD)),  // 4  purple
        DualColor(Color(0xFF8C564B), Color(0xFFBD8B7D)),  // 5  brown
        DualColor(Color(0xFFE377C2), Color(0xFFF0A4D8)),  // 6  pink
        DualColor(Color(0xFF17BECF), Color(0xFF56D4E1)),  // 7  cyan
        DualColor(Color(0xFFFDCA26), Color(0xFFFFE066)),  // 8  yellow
        DualColor(Color(0xFF7CBB00), Color(0xFFA3D44A)),  // 9  lime
        DualColor(Color(0xFF393B79), Color(0xFF6B6EA8)),  // 10 indigo
        DualColor(Color(0xFFDE5A3C), Color(0xFFEF8D78)),  // 11 coral
        DualColor(Color(0xFF006D6F), Color(0xFF3DA5A7)),  // 12 dark teal
        DualColor(Color(0xFFB5509C), Color(0xFFD487C4)),  // 13 magenta
        DualColor(Color(0xFF7F7F7F), Color(0xFFB0B0B0)),  // 14 gray (cached)
    )

    /**
     * OOM adj label -> friendly name + explicit Tableau 20 color index.
     * From Android ProcessList.makeOomAdjString() + dumpsys activity lru output.
     * Intentional color assignments for visual clarity.
     */
    private data class StateInfo(val label: String, val colorIndex: Int)

    // Static mapping: raw state -> (friendly label, palette index)
    // 0=blue 1=orange 2=green 3=red 4=purple 5=brown 6=pink 7=cyan
    // 8=yellow 9=lime 10=indigo 11=coral 12=dark teal 13=magenta 14=gray
    private val STATE_MAP = mapOf(
        // Core states (from makeOomAdjString)
        "ntv" to StateInfo("Native", 10),            // indigo
        "sys" to StateInfo("System", 0),             // blue
        "pers" to StateInfo("Persistent", 0),        // blue
        "psvc" to StateInfo("Persistent Svc", 12),   // dark teal
        "fg" to StateInfo("Foreground", 2),           // green
        "top" to StateInfo("Top", 2),                 // green
        "vis" to StateInfo("Visible", 7),             // cyan
        "prcp" to StateInfo("Perceptible", 1),        // orange
        "prcm" to StateInfo("Perceptible Med", 8),    // yellow
        "prcl" to StateInfo("Perceptible Low", 9),    // lime
        "bkup" to StateInfo("Backup", 12),            // dark teal
        "hvy" to StateInfo("Heavy", 3),               // red
        "svc" to StateInfo("Service", 6),             // pink
        "home" to StateInfo("Home", 9),               // lime
        "prev" to StateInfo("Previous", 5),           // brown
        "svcb" to StateInfo("Service B", 13),         // magenta
        "cch" to StateInfo("Cached", 14),             // gray
        // Additional aliases from dumpsys activity lru
        "btop" to StateInfo("Bound Top", 4),          // purple
        "fgs" to StateInfo("FG Service", 7),          // cyan
        "bfgs" to StateInfo("Bound FG", 4),           // purple
        "impfg" to StateInfo("Imp FG", 1),            // orange
        "impbg" to StateInfo("Imp BG", 11),           // coral
        "backup" to StateInfo("Backup", 12),          // dark teal
        "service" to StateInfo("Service", 6),         // pink
        "service-rs" to StateInfo("Svc Restart", 3),  // red
        "receiver" to StateInfo("Receiver", 8),       // yellow
        "heavy" to StateInfo("Heavy", 3),             // red
        "lastact" to StateInfo("Last Activity", 5),   // brown
        "cached" to StateInfo("Cached", 14),          // gray
        "frzn" to StateInfo("Frozen", 10),            // indigo
        "native" to StateInfo("Native", 10),          // indigo
        "fore" to StateInfo("Foreground", 2),         // green
        "percep" to StateInfo("Perceptible", 1),      // orange
        "perceptible" to StateInfo("Perceptible", 1),
        "svcrst" to StateInfo("Svc Restart", 3),
        "lstact" to StateInfo("Last Activity", 5),
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
        val dual = if (info != null) PALETTE[info.colorIndex] else {
            // Unknown state: stable hash into palette
            PALETTE[(state.hashCode() and 0x7FFFFFFF) % PALETTE.size]
        }
        return if (isDark) dual.dark else dual.light
    }

    /** Whether white text is legible on this color (luminance-based). */
    fun useWhiteText(color: Color): Boolean = color.luminance() < 0.4f
}
