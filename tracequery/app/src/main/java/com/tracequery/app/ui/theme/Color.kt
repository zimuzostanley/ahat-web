package com.tracequery.app.ui.theme

import androidx.compose.ui.graphics.Color

// ── App palette (Perfetto-inspired) ──────────────────────────────────────────

val PerfettoPurple = Color(0xFF6750A4)
val PerfettoTeal = Color(0xFF4EC9B0)
val SurfaceDark = Color(0xFF1A1A2E)
val SurfaceDarkVariant = Color(0xFF16213E)
val BackgroundDark = Color(0xFF0F0F23)
val OnSurfaceDark = Color(0xFFE1E1E6)
val OnSurfaceVariantDark = Color(0xFF9CA3AF)
val ErrorRed = Color(0xFFEF4444)
val SuccessGreen = Color(0xFF22C55E)

val SurfaceLight = Color(0xFFF8FAFC)
val SurfaceLightVariant = Color(0xFFE2E8F0)
val BackgroundLight = Color(0xFFFFFFFF)
val OnSurfaceLight = Color(0xFF0F172A)
val OnSurfaceVariantLight = Color(0xFF64748B)

// ── SQL syntax highlighting colors (VS Code dark+ inspired) ──────────────────

object SqlColors {
    val Background = Color(0xFF1E1E1E)
    val Gutter = Color(0xFF2D2D2D)
    val LineNumber = Color(0xFF858585)
    val Cursor = Color(0xFFAEAFAD)
    val Selection = Color(0xFF264F78)

    val Keyword = Color(0xFF569CD6)      // SELECT, FROM, WHERE, JOIN...
    val Function = Color(0xFFDCDCAA)     // COUNT, SUM, AVG, IFNULL...
    val String = Color(0xFFCE9178)       // 'string literals'
    val Number = Color(0xFFB5CEA8)       // 42, 3.14
    val Comment = Color(0xFF6A9955)      // -- line comments
    val Operator = Color(0xFFD4D4D4)     // =, <, >, +, -, *, /
    val Table = Color(0xFF4EC9B0)        // Known Perfetto table names
    val Module = Color(0xFFC586C0)       // INCLUDE PERFETTO MODULE
    val Null = Color(0xFF569CD6)         // NULL
    val Plain = Color(0xFFD4D4D4)
}

// ── Data grid colors ─────────────────────────────────────────────────────────

object GridColors {
    val HeaderBg = Color(0xFF1E293B)
    val RowEven = Color(0xFF0F172A)
    val RowOdd = Color(0xFF1E293B)
    val RowHover = Color(0xFF334155)
    val Border = Color(0xFF334155)
    val NullText = Color(0xFF6B7280)
    val NumberText = Color(0xFFB5CEA8)
    val StringText = Color(0xFFE1E1E6)
}
