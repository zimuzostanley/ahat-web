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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextRange
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
    SyntaxRule(Regex("--.*"), SpanStyle(color = SqlColors.Comment)),
    SyntaxRule(Regex("/\\*[\\s\\S]*?\\*/"), SpanStyle(color = SqlColors.Comment)),
    SyntaxRule(Regex("'(?:[^'\\\\]|\\\\.)*'"), SpanStyle(color = SqlColors.String)),
    SyntaxRule(
        Regex("\\bINCLUDE\\s+PERFETTO\\s+MODULE\\b", RegexOption.IGNORE_CASE),
        SpanStyle(color = SqlColors.Module)
    ),
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
            "ATTACH|DETACH|DATABASE|VACUUM|ANALYZE|AUTOINCREMENT|" +
            "CREATE_FUNCTION|CREATE_VIEW_FUNCTION|PERFETTO_TABLE|PERFETTO_VIEW|MACRO|RETURNS|SQL)\\b",
            RegexOption.IGNORE_CASE
        ),
        SpanStyle(color = SqlColors.Keyword)
    ),
    SyntaxRule(
        Regex("\\b(?:NULL|TRUE|FALSE)\\b", RegexOption.IGNORE_CASE),
        SpanStyle(color = SqlColors.Null)
    ),
    SyntaxRule(
        Regex(
            "\\b(?:_interval_intersect|_interval_agg|_counter_intervals|" +
            "_slice_flattened|_graph_scan|trace_start|trace_end|trace_dur|TRACE_BOUNDS)\\b",
            RegexOption.IGNORE_CASE
        ),
        SpanStyle(color = SqlColors.Table)
    ),
    SyntaxRule(
        Regex(
            "\\b(?:COUNT|SUM|AVG|MIN|MAX|TOTAL|GROUP_CONCAT|" +
            "ROW_NUMBER|RANK|DENSE_RANK|LAG|LEAD|FIRST_VALUE|LAST_VALUE|" +
            "ABS|COALESCE|IFNULL|IIF|INSTR|LENGTH|LOWER|UPPER|" +
            "LTRIM|RTRIM|TRIM|SUBSTR|REPLACE|HEX|TYPEOF|" +
            "PRINTF|NULLIF|RANDOM|ROUND|CAST|" +
            "STR_SPLIT|EXTRACT_ARG|TO_REALTIME|TO_MONOTONIC|" +
            "DUR_TO_STR|SPANS_OVERLAPPING_DUR|CAT_STACKS)\\b(?=\\s*\\()",
            RegexOption.IGNORE_CASE
        ),
        SpanStyle(color = SqlColors.Function)
    ),
    SyntaxRule(
        Regex("\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b"),
        SpanStyle(color = SqlColors.Number)
    ),
)

// ── Syntax highlighting ──────────────────────────────────────────────────────

private fun highlightSql(code: String): AnnotatedString = buildAnnotatedString {
    append(code)
    val styled = BooleanArray(code.length)
    for (rule in sqlSyntaxRules) {
        for (match in rule.pattern.findAll(code)) {
            val range = match.range
            if ((range.first..minOf(range.last, styled.size - 1)).any { styled[it] }) continue
            addStyle(rule.style, range.first, range.last + 1)
            for (i in range.first..minOf(range.last, styled.size - 1)) styled[i] = true
        }
    }
}

private class SqlHighlightTransformation : VisualTransformation {
    override fun filter(text: AnnotatedString): TransformedText {
        return TransformedText(highlightSql(text.text), OffsetMapping.Identity)
    }
}

// ── SqlEditor composable ─────────────────────────────────────────────────────

/**
 * SQL editor with syntax highlighting and line numbers.
 *
 * Manages TextFieldValue INTERNALLY to preserve cursor position.
 * Only syncs with external [code] when it changes from outside (not from typing).
 */
@Composable
fun SqlEditor(
    code: String,
    onCodeChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "Enter SQL query...",
) {
    val transformation = remember { SqlHighlightTransformation() }
    val vScroll = rememberScrollState()
    val hScroll = rememberScrollState()

    // Internal TextFieldValue — preserves cursor across recompositions.
    // Only resync when external code changes (not from our own typing).
    var tfv by remember { mutableStateOf(TextFieldValue(code)) }
    if (tfv.text != code) {
        tfv = TextFieldValue(code, TextRange(code.length))
    }

    val lineCount = maxOf(tfv.text.count { it == '\n' } + 1, 1)
    val gutterText = (1..lineCount).joinToString("\n") { it.toString() }
    val gutterWidth = (lineCount.toString().length * 10 + 20).dp

    val codeStyle = TextStyle(
        fontFamily = CodeFontFamily,
        fontSize = 13.sp,
        lineHeight = 20.sp,
        color = SqlColors.Plain,
    )

    Row(
        modifier = modifier
            .background(SqlColors.Background)
            .verticalScroll(vScroll),
    ) {
        // Line number gutter
        Text(
            text = gutterText,
            modifier = Modifier
                .background(SqlColors.Gutter)
                .padding(horizontal = 8.dp, vertical = 12.dp)
                .widthIn(min = gutterWidth),
            style = codeStyle.copy(color = SqlColors.LineNumber),
        )

        // Editor
        Box(
            modifier = Modifier
                .weight(1f)
                .horizontalScroll(hScroll)
                .padding(vertical = 12.dp, horizontal = 8.dp),
        ) {
            if (tfv.text.isEmpty()) {
                Text(text = placeholder, style = codeStyle.copy(color = SqlColors.LineNumber))
            }

            BasicTextField(
                value = tfv,
                onValueChange = { newTfv ->
                    tfv = newTfv
                    onCodeChange(newTfv.text)
                },
                modifier = Modifier.fillMaxWidth(),
                textStyle = codeStyle,
                cursorBrush = SolidColor(SqlColors.Cursor),
                visualTransformation = transformation,
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.None,
                    keyboardType = KeyboardType.Ascii,
                ),
            )
        }
    }
}
