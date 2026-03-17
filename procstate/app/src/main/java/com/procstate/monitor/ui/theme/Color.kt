package com.procstate.monitor.ui.theme

import androidx.compose.runtime.Composable
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
// Tableau-inspired palette with dual light/dark variants.
// Light: saturated on white backgrounds. Dark: desaturated/brighter on #111318.

@Stable
object ProcStateColors {

    data class DualColor(val light: Color, val dark: Color)

    // Vega-Lite "category20" scheme — 20 maximally distinct hues, extended to 23.
    // Light: full saturation for white bg. Dark: lightened for #111318 bg.
    val palette = linkedMapOf(
        "System" to DualColor(Color(0xFF1F77B4), Color(0xFF6BAED6)),  // blue
        "Persistent" to DualColor(Color(0xFFFF7F0E), Color(0xFFFFA84D)), // orange
        "Top" to DualColor(Color(0xFF2CA02C), Color(0xFF5FD35F)),     // green
        "Foreground" to DualColor(Color(0xFFD62728), Color(0xFFFF6B6B)), // red
        "Visible" to DualColor(Color(0xFF9467BD), Color(0xFFBB8FDD)),  // purple
        "FG Service" to DualColor(Color(0xFF8C564B), Color(0xFFBD8B7D)), // brown
        "Bound FG" to DualColor(Color(0xFFE377C2), Color(0xFFF0A4D8)),  // pink
        "Bound Top" to DualColor(Color(0xFF7F7F7F), Color(0xFFB0B0B0)), // gray
        "Perceptible" to DualColor(Color(0xFFBCBD22), Color(0xFFDBDB57)), // yellow-green
        "Imp FG" to DualColor(Color(0xFF17BECF), Color(0xFF56D4E1)),    // cyan
        "Imp BG" to DualColor(Color(0xFFAEC7E8), Color(0xFFC8D9EE)),   // light blue
        "Previous" to DualColor(Color(0xFFFFBB78), Color(0xFFFFD1A3)),  // light orange
        "Home" to DualColor(Color(0xFF98DF8A), Color(0xFFB8EBAB)),     // light green
        "Service" to DualColor(Color(0xFFFF9896), Color(0xFFFFBBBA)),   // light red
        "Service B" to DualColor(Color(0xFFC5B0D5), Color(0xFFDACAE5)), // light purple
        "Svc Restart" to DualColor(Color(0xFFC49C94), Color(0xFFDDBFB8)), // light brown
        "Receiver" to DualColor(Color(0xFFF7B6D2), Color(0xFFFAD0E3)),  // light pink
        "Backup" to DualColor(Color(0xFFC7C7C7), Color(0xFFDDDDDD)),   // light gray
        "Heavy" to DualColor(Color(0xFFDBDB8D), Color(0xFFE8E8AE)),    // light yellow-green
        "Last Activity" to DualColor(Color(0xFF9EDAE5), Color(0xFFBEE7EF)), // light cyan
        "Cached" to DualColor(Color(0xFF636363), Color(0xFF969696)),    // dark gray
        "Frozen" to DualColor(Color(0xFF3182BD), Color(0xFF80C9E8)),    // medium blue
        "Native" to DualColor(Color(0xFFE6550D), Color(0xFFFF8C42)),    // dark orange
    )

    /** Canonical ordering for consistent bar chart segment order. */
    val order: List<String> = palette.keys.toList()

    fun get(state: String, isDark: Boolean): Color {
        val dual = palette[state] ?: return if (isDark) Color(0xFF9CA3AF) else Color(0xFF6B7280)
        return if (isDark) dual.dark else dual.light
    }

    /** Whether white text is legible on this color (luminance-based). */
    fun useWhiteText(color: Color): Boolean = color.luminance() < 0.4f
}
