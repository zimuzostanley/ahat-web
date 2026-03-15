package com.tracequery.app.ui.component

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tracequery.app.ui.theme.CodeFontFamily
import com.tracequery.app.ui.theme.SqlColors

// ── Syntax rules ─────────────────────────────────────────────────────────────

private data class SyntaxRule(val pattern: Regex, val style: SpanStyle)

private val sqlSyntaxRules = listOf(
    // Single-line comments (-- ...)
    SyntaxRule(
        Regex("--.*"),
        SpanStyle(color = SqlColors.Comment)
    ),
    // Multi-line comments
    SyntaxRule(
        Regex("/\\*[\\s\\S]*?\\*/"),
        SpanStyle(color = SqlColors.Comment)
    ),
    // String literals
    SyntaxRule(
        Regex("'(?:[^'\\\\]|\\\\.)*'"),
        SpanStyle(color = SqlColors.String)
    ),
    // INCLUDE PERFETTO MODULE
    SyntaxRule(
        Regex("\\bINCLUDE\\s+PERFETTO\\s+MODULE\\b", RegexOption.IGNORE_CASE),
        SpanStyle(color = SqlColors.Module)
    ),
    // SQL keywords
    SyntaxRule(
        Regex(
            "\\b(?:SELECT|FROM|WHERE|AND|OR|NOT|IN|LIKE|BETWEEN|ORDER|BY|" +
            "GROUP|HAVING|LIMIT|OFFSET|AS|ON|JOIN|LEFT|RIGHT|INNER|OUTER|CROSS|" +
            "UNION|ALL|INSERT|INTO|UPDATE|DELETE|CREATE|DROP|ALTER|TABLE|VIEW|" +
            "INDEX|DISTINCT|CASE|WHEN|THEN|ELSE|END|IS|EXISTS|WITH|RECURSIVE|" +
            "REPLACE|VALUES|SET|INCLUDE|PERFETTO|MODULE|ASC|DESC|OVER|PARTITION|" +
            "ROWS|RANGE|UNBOUNDED|PRECEDING|FOLLOWING|CURRENT|ROW|WINDOW|" +
            "EXCEPT|INTERSECT|NATURAL|USING|EXPLAIN|QUERY|PLAN|PRAGMA|" +
            "VIRTUAL|IF|BEGIN|COMMIT|ROLLBACK|TEMP|TEMPORARY|TRIGGER|" +
            "PRIMARY|KEY|FOREIGN|REFERENCES|CHECK|DEFAULT|UNIQUE|CONSTRAINT|" +
            "CAST|GLOB|MATCH|REGEXP|ESCAPE|COLLATE|INDEXED|REINDEX|" +
            "ATTACH|DETACH|DATABASE|VACUUM|ANALYZE|AUTOINCREMENT)\\b",
            RegexOption.IGNORE_CASE
        ),
        SpanStyle(color = SqlColors.Keyword)
    ),
    // NULL, TRUE, FALSE
    SyntaxRule(
        Regex("\\b(?:NULL|TRUE|FALSE)\\b", RegexOption.IGNORE_CASE),
        SpanStyle(color = SqlColors.Null)
    ),
    // Common SQL aggregate/window functions
    SyntaxRule(
        Regex(
            "\\b(?:COUNT|SUM|AVG|MIN|MAX|TOTAL|GROUP_CONCAT|" +
            "ROW_NUMBER|RANK|DENSE_RANK|NTILE|LAG|LEAD|" +
            "FIRST_VALUE|LAST_VALUE|NTH_VALUE|" +
            "ABS|COALESCE|IFNULL|IIF|INSTR|LENGTH|LOWER|UPPER|" +
            "LTRIM|RTRIM|TRIM|SUBSTR|REPLACE|HEX|QUOTE|TYPEOF|" +
            "UNICODE|ZEROBLOB|LIKELY|UNLIKELY|" +
            "PRINTF|FORMAT|CHAR|NULLIF|RANDOM|" +
            "ROUND|SIGN|MAX_VALUE|MIN_VALUE)\\b(?=\\s*\\()",
            RegexOption.IGNORE_CASE
        ),
        SpanStyle(color = SqlColors.Function)
    ),
    // Numbers
    SyntaxRule(
        Regex("\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b"),
        SpanStyle(color = SqlColors.Number)
    ),
)

// ── Syntax highlighting transformation ───────────────────────────────────────

private class SqlSyntaxTransformation : VisualTransformation {
    override fun filter(text: AnnotatedString): TransformedText {
        val annotated = highlight(text.text)
        return TransformedText(annotated, OffsetMapping.Identity)
    }

    private fun highlight(text: String): AnnotatedString {
        return buildAnnotatedString {
            append(text)
            // Track which characters are already styled (higher priority rules first)
            val styled = BooleanArray(text.length)

            for (rule in sqlSyntaxRules) {
                for (match in rule.pattern.findAll(text)) {
                    val range = match.range
                    // Skip if any character in this range is already styled
                    if ((range.first..range.last).any { it < styled.size && styled[it] }) continue
                    addStyle(rule.style, range.first, range.last + 1)
                    for (i in range.first..minOf(range.last, styled.size - 1)) {
                        styled[i] = true
                    }
                }
            }
        }
    }
}

// ── SqlEditor composable ─────────────────────────────────────────────────────

@Composable
fun SqlEditor(
    value: TextFieldValue,
    onValueChange: (TextFieldValue) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "Enter PerfettoSQL query...",
) {
    val syntaxTransformation = remember { SqlSyntaxTransformation() }
    val vScrollState = rememberScrollState()
    val hScrollState = rememberScrollState()

    Row(
        modifier = modifier
            .background(SqlColors.Background)
            .verticalScroll(vScrollState)
    ) {
        // Line number gutter
        val lineCount = maxOf(value.text.count { it == '\n' } + 1, 1)
        val gutterText = (1..lineCount).joinToString("\n") { it.toString() }

        Text(
            text = gutterText,
            modifier = Modifier
                .background(SqlColors.Gutter)
                .padding(horizontal = 8.dp, vertical = 12.dp)
                .widthIn(min = 32.dp),
            style = TextStyle(
                fontFamily = CodeFontFamily,
                fontSize = 13.sp,
                lineHeight = 20.sp,
                color = SqlColors.LineNumber,
            ),
        )

        // Editor area
        Box(
            modifier = Modifier
                .weight(1f)
                .horizontalScroll(hScrollState)
                .padding(vertical = 12.dp, horizontal = 8.dp)
        ) {
            if (value.text.isEmpty()) {
                Text(
                    text = placeholder,
                    style = TextStyle(
                        fontFamily = CodeFontFamily,
                        fontSize = 13.sp,
                        lineHeight = 20.sp,
                        color = SqlColors.LineNumber,
                    ),
                )
            }

            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                modifier = Modifier.fillMaxWidth(),
                textStyle = TextStyle(
                    fontFamily = CodeFontFamily,
                    fontSize = 13.sp,
                    lineHeight = 20.sp,
                    color = SqlColors.Plain,
                ),
                cursorBrush = SolidColor(SqlColors.Cursor),
                visualTransformation = syntaxTransformation,
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.None,
                    keyboardType = KeyboardType.Ascii,
                ),
            )
        }
    }
}
