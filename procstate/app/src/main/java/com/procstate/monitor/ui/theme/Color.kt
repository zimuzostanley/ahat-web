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

    // Tableau 10-inspired maximally distinct palette with dark mode variants.
    val palette = linkedMapOf(
        "System" to DualColor(Color(0xFF4E79A7), Color(0xFF7AADDE)),  // steel blue
        "Persistent" to DualColor(Color(0xFF59A14F), Color(0xFF8CD17D)), // green
        "Top" to DualColor(Color(0xFFE15759), Color(0xFFFF9D9A)),     // red
        "Foreground" to DualColor(Color(0xFF76B7B2), Color(0xFFA0DAD6)), // teal
        "Visible" to DualColor(Color(0xFFF28E2B), Color(0xFFFFBE7D)),  // orange
        "FG Service" to DualColor(Color(0xFFEDC948), Color(0xFFF1DE82)), // gold
        "Bound FG" to DualColor(Color(0xFFB07AA1), Color(0xFFD4A6C8)),  // mauve
        "Bound Top" to DualColor(Color(0xFF9C755F), Color(0xFFC9A78C)),  // brown
        "Perceptible" to DualColor(Color(0xFFFF9DA7), Color(0xFFFFCCD2)), // pink
        "Imp FG" to DualColor(Color(0xFFBAB0AC), Color(0xFFD7CEC7)),    // warm gray
        "Imp BG" to DualColor(Color(0xFFD97706), Color(0xFFFBBF24)),    // amber
        "Previous" to DualColor(Color(0xFF499894), Color(0xFF86BCB6)),   // sage
        "Home" to DualColor(Color(0xFF86BCB6), Color(0xFFB4D9D2)),      // mint
        "Service" to DualColor(Color(0xFFCF4E50), Color(0xFFF19092)),    // coral
        "Service B" to DualColor(Color(0xFFA0CBE8), Color(0xFFC6DFEF)),  // sky
        "Svc Restart" to DualColor(Color(0xFFD4A6C8), Color(0xFFE8C8DE)), // lavender
        "Receiver" to DualColor(Color(0xFF8CD17D), Color(0xFFB6E1A6)),   // lime
        "Backup" to DualColor(Color(0xFFB6992D), Color(0xFFDCC651)),     // olive
        "Heavy" to DualColor(Color(0xFFD32F2F), Color(0xFFEF5350)),     // strong red
        "Last Activity" to DualColor(Color(0xFF8D6E63), Color(0xFFBCAAA4)), // taupe
        "Cached" to DualColor(Color(0xFF78909C), Color(0xFFB0BEC5)),    // blue gray
        "Frozen" to DualColor(Color(0xFF00ACC1), Color(0xFF4DD0E1)),    // cyan
        "Native" to DualColor(Color(0xFF7B1FA2), Color(0xFFBA68C8)),    // purple
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
