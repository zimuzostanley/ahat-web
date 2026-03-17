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

    val palette = linkedMapOf(
        "System" to DualColor(Color(0xFF7C3AED), Color(0xFFA78BFA)),
        "Persistent" to DualColor(Color(0xFF4F46E5), Color(0xFF818CF8)),
        "Top" to DualColor(Color(0xFF16A34A), Color(0xFF4ADE80)),
        "Foreground" to DualColor(Color(0xFF059669), Color(0xFF34D399)),
        "Visible" to DualColor(Color(0xFF0D9488), Color(0xFF2DD4BF)),
        "FG Service" to DualColor(Color(0xFF0891B2), Color(0xFF22D3EE)),
        "Bound FG" to DualColor(Color(0xFF0284C7), Color(0xFF38BDF8)),
        "Bound Top" to DualColor(Color(0xFF2563EB), Color(0xFF60A5FA)),
        "Perceptible" to DualColor(Color(0xFFCA8A04), Color(0xFFFACC15)),
        "Imp FG" to DualColor(Color(0xFFD97706), Color(0xFFFBBF24)),
        "Imp BG" to DualColor(Color(0xFFEA580C), Color(0xFFFB923C)),
        "Previous" to DualColor(Color(0xFF9333EA), Color(0xFFC4B5FD)),
        "Home" to DualColor(Color(0xFF65A30D), Color(0xFFA3E635)),
        "Service" to DualColor(Color(0xFFDB2777), Color(0xFFF472B6)),
        "Service B" to DualColor(Color(0xFFE879A0), Color(0xFFFDA4AF)),
        "Svc Restart" to DualColor(Color(0xFFBE123C), Color(0xFFFB7185)),
        "Receiver" to DualColor(Color(0xFFC026D3), Color(0xFFE879F9)),
        "Backup" to DualColor(Color(0xFF0E7490), Color(0xFF5EEAD4)),
        "Heavy" to DualColor(Color(0xFFDC2626), Color(0xFFF87171)),
        "Last Activity" to DualColor(Color(0xFF78716C), Color(0xFFA8A29E)),
        "Cached" to DualColor(Color(0xFF6B7280), Color(0xFF9CA3AF)),
        "Frozen" to DualColor(Color(0xFF06B6D4), Color(0xFF67E8F9)),
        "Native" to DualColor(Color(0xFF6D28D9), Color(0xFFB4A4F4)),
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
