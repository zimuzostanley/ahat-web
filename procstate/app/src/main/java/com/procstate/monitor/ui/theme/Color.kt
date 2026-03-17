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

/**
 * Dynamic color assignment using the Tableau 20 palette from Vega-Lite.
 * States are assigned colors as they're first encountered — no static mapping.
 * This means every raw device state (fg, cch, psvc, prcl, etc.) gets a color.
 */
@Stable
object ProcStateColors {

    data class DualColor(val light: Color, val dark: Color)

    // Tableau 20 exact hex values from vega.github.io/vega/docs/schemes/#tableau20
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

    private val fallback = DualColor(Color(0xFF636363), Color(0xFF969696))

    // Dynamic assignment: state string -> index into TABLEAU_20
    private val stateIndex = LinkedHashMap<String, Int>()

    /** All states seen so far, in order of first appearance. */
    val order: List<String> get() = stateIndex.keys.toList()

    fun get(state: String, isDark: Boolean): Color {
        val idx = stateIndex.getOrPut(state) { stateIndex.size }
        val dual = if (idx < TABLEAU_20.size) TABLEAU_20[idx] else fallback
        return if (isDark) dual.dark else dual.light
    }

    /** Whether white text is legible on this color (luminance-based). */
    fun useWhiteText(color: Color): Boolean = color.luminance() < 0.4f
}
