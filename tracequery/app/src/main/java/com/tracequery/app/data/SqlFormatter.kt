package com.tracequery.app.data

/**
 * Simple SQL formatter. Uppercases keywords and adds newlines before
 * major clauses for readability. Not a full parser — works on common
 * patterns produced by the app's SQL generation.
 */
object SqlFormatter {

    private val majorClauses = listOf(
        "SELECT", "FROM", "WHERE", "GROUP BY", "ORDER BY",
        "HAVING", "LIMIT", "OFFSET", "INNER JOIN", "LEFT JOIN",
        "RIGHT JOIN", "CROSS JOIN", "UNION", "UNION ALL",
        "INCLUDE PERFETTO MODULE",
    )

    private val keywords = setOf(
        "SELECT", "FROM", "WHERE", "AND", "OR", "NOT", "IN", "LIKE",
        "BETWEEN", "ORDER", "BY", "GROUP", "HAVING", "LIMIT", "OFFSET",
        "AS", "ON", "JOIN", "LEFT", "RIGHT", "INNER", "OUTER", "CROSS",
        "UNION", "ALL", "INSERT", "INTO", "UPDATE", "DELETE", "CREATE",
        "DROP", "ALTER", "TABLE", "VIEW", "INDEX", "DISTINCT", "CASE",
        "WHEN", "THEN", "ELSE", "END", "IS", "NULL", "EXISTS", "WITH",
        "RECURSIVE", "ASC", "DESC", "OVER", "PARTITION", "INCLUDE",
        "PERFETTO", "MODULE", "COUNT", "SUM", "AVG", "MIN", "MAX",
    )

    fun format(sql: String): String {
        // Normalize whitespace
        var s = sql.trim().replace(Regex("\\s+"), " ")

        // Add newlines before major clauses (case-insensitive)
        for (clause in majorClauses.sortedByDescending { it.length }) {
            val pattern = Regex("\\s+${Regex.escape(clause)}\\b", RegexOption.IGNORE_CASE)
            s = s.replace(pattern) { "\n${it.value.trim().uppercase()}" }
        }

        // Uppercase standalone keywords
        s = s.replace(Regex("\\b(${keywords.joinToString("|")})\\b", RegexOption.IGNORE_CASE)) {
            it.value.uppercase()
        }

        // Indent lines after the first (continuation)
        val lines = s.lines()
        return lines.mapIndexed { i, line ->
            val trimmed = line.trim()
            if (i == 0 || trimmed.startsWith("SELECT") || trimmed.startsWith("INCLUDE")) {
                trimmed
            } else {
                "  $trimmed"
            }
        }.joinToString("\n").trim()
    }
}
