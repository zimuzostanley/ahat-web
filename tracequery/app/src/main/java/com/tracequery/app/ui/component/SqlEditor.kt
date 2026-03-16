package com.tracequery.app.ui.component

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.ui.graphics.luminance
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
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
import com.tracequery.app.ui.theme.SqlColorsDark
import com.tracequery.app.ui.theme.SqlColorsLight

// ── Syntax rules ─────────────────────────────────────────────────────────────

private data class SyntaxRule(val pattern: Regex, val style: SpanStyle)

private fun buildRules(c: SqlColorSet): List<SyntaxRule> = listOf(
    SyntaxRule(Regex("--.*"), SpanStyle(color = c.comment)),
    SyntaxRule(Regex("/\\*[\\s\\S]*?\\*/"), SpanStyle(color = c.comment)),
    SyntaxRule(Regex("'(?:[^'\\\\]|\\\\.)*'"), SpanStyle(color = c.string)),
    SyntaxRule(Regex("\\bINCLUDE\\s+PERFETTO\\s+MODULE\\b", RegexOption.IGNORE_CASE), SpanStyle(color = c.module)),
    SyntaxRule(
        Regex("\\b(?:SELECT|FROM|WHERE|AND|OR|NOT|IN|LIKE|BETWEEN|ORDER|BY|GROUP|HAVING|LIMIT|OFFSET|AS|ON|JOIN|LEFT|RIGHT|INNER|OUTER|CROSS|UNION|ALL|INSERT|INTO|UPDATE|DELETE|CREATE|DROP|ALTER|TABLE|VIEW|INDEX|DISTINCT|CASE|WHEN|THEN|ELSE|END|IS|EXISTS|WITH|RECURSIVE|REPLACE|VALUES|SET|INCLUDE|PERFETTO|MODULE|ASC|DESC|OVER|PARTITION|ROWS|RANGE|UNBOUNDED|PRECEDING|FOLLOWING|CURRENT|ROW|WINDOW|EXCEPT|INTERSECT|NATURAL|USING|EXPLAIN|QUERY|PLAN|PRAGMA|VIRTUAL|IF|BEGIN|COMMIT|ROLLBACK|TEMP|TEMPORARY|TRIGGER|PRIMARY|KEY|FOREIGN|REFERENCES|CHECK|DEFAULT|UNIQUE|CONSTRAINT|CAST|GLOB|MATCH|REGEXP|ESCAPE|COLLATE|INDEXED|REINDEX|ATTACH|DETACH|DATABASE|VACUUM|ANALYZE|AUTOINCREMENT|CREATE_FUNCTION|CREATE_VIEW_FUNCTION|PERFETTO_TABLE|PERFETTO_VIEW|MACRO|RETURNS|SQL)\\b", RegexOption.IGNORE_CASE),
        SpanStyle(color = c.keyword)
    ),
    SyntaxRule(Regex("\\b(?:NULL|TRUE|FALSE)\\b", RegexOption.IGNORE_CASE), SpanStyle(color = c.null_)),
    SyntaxRule(Regex("\\b(?:_interval_intersect|_interval_agg|_counter_intervals|_slice_flattened|_graph_scan|trace_start|trace_end|trace_dur|TRACE_BOUNDS)\\b", RegexOption.IGNORE_CASE), SpanStyle(color = c.table)),
    SyntaxRule(
        Regex("\\b(?:COUNT|SUM|AVG|MIN|MAX|TOTAL|GROUP_CONCAT|ROW_NUMBER|RANK|DENSE_RANK|LAG|LEAD|FIRST_VALUE|LAST_VALUE|ABS|COALESCE|IFNULL|IIF|INSTR|LENGTH|LOWER|UPPER|LTRIM|RTRIM|TRIM|SUBSTR|REPLACE|HEX|TYPEOF|PRINTF|NULLIF|RANDOM|ROUND|CAST|STR_SPLIT|EXTRACT_ARG|TO_REALTIME|TO_MONOTONIC|DUR_TO_STR|SPANS_OVERLAPPING_DUR|CAT_STACKS)\\b(?=\\s*\\()", RegexOption.IGNORE_CASE),
        SpanStyle(color = c.function)
    ),
    SyntaxRule(Regex("\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b"), SpanStyle(color = c.number)),
)

private data class SqlColorSet(
    val background: Color, val gutter: Color, val lineNumber: Color,
    val cursor: Color, val plain: Color,
    val keyword: Color, val function: Color, val string: Color,
    val number: Color, val comment: Color, val table: Color,
    val module: Color, val null_: Color,
)

private val LightSet = SqlColorSet(
    SqlColorsLight.Background, SqlColorsLight.Gutter, SqlColorsLight.LineNumber,
    SqlColorsLight.Cursor, SqlColorsLight.Plain,
    SqlColorsLight.Keyword, SqlColorsLight.Function, SqlColorsLight.String,
    SqlColorsLight.Number, SqlColorsLight.Comment, SqlColorsLight.Table,
    SqlColorsLight.Module, SqlColorsLight.Null,
)

private val DarkSet = SqlColorSet(
    SqlColorsDark.Background, SqlColorsDark.Gutter, SqlColorsDark.LineNumber,
    SqlColorsDark.Cursor, SqlColorsDark.Plain,
    SqlColorsDark.Keyword, SqlColorsDark.Function, SqlColorsDark.String,
    SqlColorsDark.Number, SqlColorsDark.Comment, SqlColorsDark.Table,
    SqlColorsDark.Module, SqlColorsDark.Null,
)

// ── Highlighting ─────────────────────────────────────────────────────────────

private class SqlHighlight(private val rules: List<SyntaxRule>) : VisualTransformation {
    override fun filter(text: AnnotatedString): TransformedText {
        return TransformedText(highlight(text.text), OffsetMapping.Identity)
    }

    private fun highlight(text: String): AnnotatedString = buildAnnotatedString {
        append(text)
        val styled = BooleanArray(text.length)
        for (rule in rules) {
            for (match in rule.pattern.findAll(text)) {
                val r = match.range
                if ((r.first..minOf(r.last, styled.size - 1)).any { styled[it] }) continue
                addStyle(rule.style, r.first, r.last + 1)
                for (i in r.first..minOf(r.last, styled.size - 1)) styled[i] = true
            }
        }
    }
}

// ── SqlEditor ────────────────────────────────────────────────────────────────

@Composable
fun SqlEditor(
    code: String,
    onCodeChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "Enter SQL query...",
) {
    // Detect dark/light from the actual MaterialTheme, not system setting
    // (our ThemeMode can override system)
    val bgLuminance = MaterialTheme.colorScheme.background.luminance()
    val isDark = bgLuminance < 0.5f
    val colors = if (isDark) DarkSet else LightSet
    val rules = remember(isDark) { buildRules(colors) }
    val transformation = remember(isDark) { SqlHighlight(rules) }
    val vScroll = rememberScrollState()
    val hScroll = rememberScrollState()
    val focusRequester = remember { FocusRequester() }

    var tfv by remember { mutableStateOf(TextFieldValue(code)) }
    if (tfv.text != code) {
        tfv = TextFieldValue(code, TextRange(code.length))
    }

    val lineCount = maxOf(tfv.text.count { it == '\n' } + 1, 1)
    val gutterText = (1..lineCount).joinToString("\n") { it.toString() }
    val gutterWidth = (lineCount.toString().length * 10 + 20).dp

    val codeStyle = TextStyle(
        fontFamily = CodeFontFamily, fontSize = 13.sp,
        lineHeight = 20.sp, color = colors.plain,
    )

    val outlineColor = MaterialTheme.colorScheme.outline

    Row(
        modifier = modifier
            .background(colors.background, shape = MaterialTheme.shapes.medium)
            .border(1.dp, outlineColor.copy(alpha = 0.5f), MaterialTheme.shapes.medium)
            .verticalScroll(vScroll),
    ) {
        Text(
            text = gutterText,
            modifier = Modifier
                .background(colors.gutter)
                .padding(horizontal = 8.dp, vertical = 12.dp)
                .widthIn(min = gutterWidth),
            style = codeStyle.copy(color = colors.lineNumber),
        )

        Box(
            modifier = Modifier
                .weight(1f)
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                ) { focusRequester.requestFocus() }
                .horizontalScroll(hScroll)
                .padding(vertical = 12.dp, horizontal = 8.dp),
        ) {
            if (tfv.text.isEmpty()) {
                Text(text = placeholder, style = codeStyle.copy(color = colors.lineNumber))
            }

            BasicTextField(
                value = tfv,
                onValueChange = { newTfv ->
                    tfv = newTfv
                    onCodeChange(newTfv.text)
                },
                modifier = Modifier.fillMaxWidth().focusRequester(focusRequester),
                textStyle = codeStyle,
                cursorBrush = SolidColor(colors.cursor),
                visualTransformation = transformation,
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.None,
                    keyboardType = KeyboardType.Ascii,
                ),
            )
        }
    }
}
