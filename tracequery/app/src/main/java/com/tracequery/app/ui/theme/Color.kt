package com.tracequery.app.ui.theme

import androidx.compose.ui.graphics.Color

// ── Light theme ──────────────────────────────────────────────────────────────

val LightPrimary = Color(0xFF4A55A2)       // Muted indigo
val LightOnPrimary = Color(0xFFFFFFFF)
val LightSecondary = Color(0xFF0F9D9F)     // Teal
val LightBackground = Color(0xFFF8F9FC)
val LightSurface = Color(0xFFFFFFFF)
val LightSurfaceVariant = Color(0xFFF1F3F5)
val LightOnSurface = Color(0xFF1A1C1E)
val LightOnSurfaceVariant = Color(0xFF6B7280)
val LightOutline = Color(0xFFE2E5E9)
val LightError = Color(0xFFDC2626)

// ── Dark theme ───────────────────────────────────────────────────────────────

val DarkPrimary = Color(0xFF8B9CF7)        // Lighter indigo
val DarkOnPrimary = Color(0xFF1A1C2E)
val DarkSecondary = Color(0xFF5EEAD4)      // Teal
val DarkBackground = Color(0xFF111318)
val DarkSurface = Color(0xFF1C1E24)
val DarkSurfaceVariant = Color(0xFF262830)
val DarkOnSurface = Color(0xFFE8EAED)
val DarkOnSurfaceVariant = Color(0xFF9CA3AF)
val DarkOutline = Color(0xFF363840)
val DarkError = Color(0xFFF87171)

// ── SQL syntax highlighting (always dark background) ─────────────────────────

object SqlColors {
    val Background = Color(0xFF1E1E1E)
    val Gutter = Color(0xFF252526)
    val LineNumber = Color(0xFF6E7681)
    val Cursor = Color(0xFFAEAFAD)
    val Selection = Color(0xFF264F78)

    val Keyword = Color(0xFF569CD6)
    val Function = Color(0xFFDCDCAA)
    val String = Color(0xFFCE9178)
    val Number = Color(0xFFB5CEA8)
    val Comment = Color(0xFF6A9955)
    val Operator = Color(0xFFD4D4D4)
    val Table = Color(0xFF4EC9B0)
    val Module = Color(0xFFC586C0)
    val Null = Color(0xFF569CD6)
    val Plain = Color(0xFFD4D4D4)
}

// ── Data grid ────────────────────────────────────────────────────────────────

object GridColors {
    // These are resolved at compose time from MaterialTheme
    val NullText = Color(0xFF6B7280)
    val NumberText = Color(0xFF3B82F6)
}
