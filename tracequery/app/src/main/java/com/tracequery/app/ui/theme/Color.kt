package com.tracequery.app.ui.theme

import androidx.compose.ui.graphics.Color

// ── Light theme ──────────────────────────────────────────────────────────────

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

// ── Dark theme ───────────────────────────────────────────────────────────────

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

// ── SQL syntax highlighting ──────────────────────────────────────────────────
// Light mode: dark text on light background
// Dark mode: bright text on dark background

object SqlColorsLight {
    val Background = Color(0xFFF5F5F5)
    val Gutter = Color(0xFFEBEBEB)
    val LineNumber = Color(0xFF999999)
    val Cursor = Color(0xFF333333)
    val Keyword = Color(0xFF0000FF)
    val Function = Color(0xFF795E26)
    val String = Color(0xFFA31515)
    val Number = Color(0xFF098658)
    val Comment = Color(0xFF008000)
    val Table = Color(0xFF267F99)
    val Module = Color(0xFFAF00DB)
    val Null = Color(0xFF0000FF)
    val Plain = Color(0xFF1A1A1A)
}

object SqlColorsDark {
    val Background = Color(0xFF1E1E1E)
    val Gutter = Color(0xFF252526)
    val LineNumber = Color(0xFF6E7681)
    val Cursor = Color(0xFFAEAFAD)
    val Keyword = Color(0xFF569CD6)
    val Function = Color(0xFFDCDCAA)
    val String = Color(0xFFCE9178)
    val Number = Color(0xFFB5CEA8)
    val Comment = Color(0xFF6A9955)
    val Table = Color(0xFF4EC9B0)
    val Module = Color(0xFFC586C0)
    val Null = Color(0xFF569CD6)
    val Plain = Color(0xFFD4D4D4)
}
