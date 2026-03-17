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

    // Tableau 20 from Vega-Lite (exact hex values from vega.github.io/vega/docs/schemes)
    // 10 saturated + 10 light pairs. Extended to 23 with 3 extra distinct colors.
    // Dark mode: uses the lighter pair from each Tableau 20 duo.
    val palette = linkedMapOf(
        "System" to DualColor(Color(0xFF4C78A8), Color(0xFF9ECAE9)),       // 1. steel blue / light blue
        "Persistent" to DualColor(Color(0xFFF58518), Color(0xFFFFBF79)),   // 2. orange / light orange
        "Top" to DualColor(Color(0xFF54A24B), Color(0xFF88D27A)),          // 3. green / light green
        "Foreground" to DualColor(Color(0xFFE45756), Color(0xFFFF9D98)),   // 4. red / light red
        "Visible" to DualColor(Color(0xFF4399D2), Color(0xFF83BCB6)),      // 5. teal-blue / light teal
        "FG Service" to DualColor(Color(0xFFB07AA1), Color(0xFFD6A5C9)),   // 6. mauve / light mauve
        "Bound FG" to DualColor(Color(0xFF9E765F), Color(0xFFD8B5A5)),     // 7. brown / light brown
        "Bound Top" to DualColor(Color(0xFFD67195), Color(0xFFFCBFD2)),    // 8. pink / light pink
        "Perceptible" to DualColor(Color(0xFFB9A20F), Color(0xFFF2CF5B)),  // 9. olive / light olive
        "Imp FG" to DualColor(Color(0xFF43989D), Color(0xFF7EC8C2)),       // 10. teal / light teal (shifted)
        "Imp BG" to DualColor(Color(0xFF79706E), Color(0xFFBAB0AC)),       // 11. gray / light gray
        "Previous" to DualColor(Color(0xFF9ECAE9), Color(0xFFC0DAEE)),     // 12. light steel blue
        "Home" to DualColor(Color(0xFFFFBF79), Color(0xFFFFD9AD)),         // 13. light orange
        "Service" to DualColor(Color(0xFF88D27A), Color(0xFFB2E2A4)),      // 14. light green
        "Service B" to DualColor(Color(0xFFFF9D98), Color(0xFFFFBFBC)),    // 15. light red
        "Svc Restart" to DualColor(Color(0xFFB279A2), Color(0xFFCE9DBE)),  // 16. mauve variant (shifted)
        "Receiver" to DualColor(Color(0xFFD8B5A5), Color(0xFFE8CFC2)),     // 17. light brown
        "Backup" to DualColor(Color(0xFFFCBFD2), Color(0xFFFDD8E4)),       // 18. light pink
        "Heavy" to DualColor(Color(0xFFF2CF5B), Color(0xFFF7E28C)),        // 19. light olive
        "Last Activity" to DualColor(Color(0xFF83BCB6), Color(0xFFADD4CF)), // 20. light teal
        "Cached" to DualColor(Color(0xFFBAB0AC), Color(0xFFD0C9C5)),       // gray (Tableau 20 pair 11 light)
        "Frozen" to DualColor(Color(0xFF72A9D4), Color(0xFFA3C9E8)),       // blue variant
        "Native" to DualColor(Color(0xFFE89744), Color(0xFFFFC98A)),       // orange variant (shifted)
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
