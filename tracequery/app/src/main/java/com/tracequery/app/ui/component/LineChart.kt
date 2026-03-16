package com.tracequery.app.ui.component

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tracequery.app.ui.theme.CodeFontFamily

// Tableau 10 colors
private val TABLEAU_COLORS = listOf(
    Color(0xFF4E79A7), Color(0xFFF28E2B), Color(0xFFE15759), Color(0xFF76B7B2),
    Color(0xFF59A14F), Color(0xFFEDC948), Color(0xFFB07AA1), Color(0xFFFF9DA7),
    Color(0xFF9C755F), Color(0xFFBAB0AC),
)

data class ChartLine(
    val yColumn: String,
    val color: Color,
    val points: List<Pair<Double, Double>>, // (x, y) pairs
)

data class ChartData(
    val xColumn: String,
    val lines: List<ChartLine>,
) {
    companion object {
        /** Max points to render per line. Beyond this, downsample. */
        private const val MAX_POINTS = 2000

        fun create(
            pagedQuery: com.tracequery.app.data.PagedQuery,
            xCol: String,
            yCols: List<String>,
        ): ChartData {
            val columns = pagedQuery.columns.map { it.name }
            val xIdx = columns.indexOf(xCol)
            if (xIdx < 0) return ChartData(xCol, emptyList())

            val lines = yCols.mapIndexed { i, yCol ->
                val yIdx = columns.indexOf(yCol)
                if (yIdx < 0) return@mapIndexed ChartLine(yCol, TABLEAU_COLORS[i % TABLEAU_COLORS.size], emptyList())

                // Read points from the paged query — only the 2 columns we need
                val rawPoints = ArrayList<Pair<Double, Double>>(minOf(pagedQuery.rowsRead, MAX_POINTS * 2))
                for (r in 0 until pagedQuery.rowsRead) {
                    val row = pagedQuery.getRow(r) ?: continue
                    val x = row.getOrNull(xIdx)?.toDoubleOrNull() ?: continue
                    val y = row.getOrNull(yIdx)?.toDoubleOrNull() ?: continue
                    rawPoints.add(x to y)
                }
                rawPoints.sortBy { it.first }

                // Downsample if too many points (LTTB-like: keep min/max per bucket)
                val points = if (rawPoints.size <= MAX_POINTS) rawPoints
                else downsample(rawPoints, MAX_POINTS)

                ChartLine(yCol, TABLEAU_COLORS[i % TABLEAU_COLORS.size], points)
            }

            return ChartData(xCol, lines)
        }

        /** Simple min/max downsampling: for each bucket, keep the point with
         *  min Y and the point with max Y. Preserves visual shape. */
        private fun downsample(points: List<Pair<Double, Double>>, targetSize: Int): List<Pair<Double, Double>> {
            val bucketSize = points.size.toDouble() / targetSize
            val result = ArrayList<Pair<Double, Double>>(targetSize)
            var i = 0.0
            while (i < points.size) {
                val end = minOf((i + bucketSize).toInt(), points.size)
                val start = i.toInt()
                if (start >= end) break
                var minP = points[start]; var maxP = points[start]
                for (j in start until end) {
                    if (points[j].second < minP.second) minP = points[j]
                    if (points[j].second > maxP.second) maxP = points[j]
                }
                if (minP.first <= maxP.first) { result.add(minP); if (minP != maxP) result.add(maxP) }
                else { result.add(maxP); if (minP != maxP) result.add(minP) }
                i += bucketSize
            }
            return result
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun LineChart(
    chart: ChartData,
    onRemoveLine: (String) -> Unit,
    onRemoveChart: () -> Unit,
    modifier: Modifier = Modifier,
) {
    if (chart.lines.isEmpty() || chart.lines.all { it.points.isEmpty() }) {
        Text("No numeric data to chart", style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(16.dp))
        return
    }

    val textMeasurer = rememberTextMeasurer()
    val axisTextStyle = TextStyle(fontFamily = CodeFontFamily, fontSize = 10.sp,
        color = MaterialTheme.colorScheme.onSurfaceVariant)
    val gridColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.15f)
    val axisColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.5f)

    // Compute bounds across all lines
    var xMin = Double.MAX_VALUE; var xMax = Double.MIN_VALUE
    var yMin = Double.MAX_VALUE; var yMax = Double.MIN_VALUE
    chart.lines.forEach { line ->
        line.points.forEach { (x, y) ->
            if (x < xMin) xMin = x; if (x > xMax) xMax = x
            if (y < yMin) yMin = y; if (y > yMax) yMax = y
        }
    }
    if (xMin == xMax) { xMin -= 1; xMax += 1 }
    if (yMin == yMax) { yMin -= 1; yMax += 1 }
    // Add 5% padding
    val xRange = xMax - xMin; val yRange = yMax - yMin
    xMin -= xRange * 0.02; xMax += xRange * 0.02
    yMin -= yRange * 0.05; yMax += yRange * 0.05

    // Tooltip state
    var tooltipInfo by remember { mutableStateOf<String?>(null) }
    var tooltipOffset by remember { mutableStateOf(Offset.Zero) }

    Column(modifier.fillMaxWidth()) {
        // Legend chips
        FlowRow(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            chart.lines.forEach { line ->
                AssistChip(
                    onClick = { onRemoveLine(line.yColumn) },
                    label = {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.size(8.dp).background(line.color))
                            Spacer(Modifier.width(4.dp))
                            Text(line.yColumn, style = MaterialTheme.typography.labelSmall)
                        }
                    },
                    trailingIcon = { Icon(Icons.Default.Close, "Remove", Modifier.size(14.dp)) },
                    shape = MaterialTheme.shapes.medium,
                    colors = AssistChipDefaults.assistChipColors(
                        containerColor = MaterialTheme.colorScheme.surface),
                )
            }
            AssistChip(
                onClick = onRemoveChart,
                label = { Text("Remove chart", style = MaterialTheme.typography.labelSmall) },
                trailingIcon = { Icon(Icons.Default.Close, null, Modifier.size(14.dp)) },
                shape = MaterialTheme.shapes.medium,
            )
        }

        // X axis label
        Text(chart.xColumn, style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.align(Alignment.CenterHorizontally).padding(bottom = 2.dp))

        // Chart
        Box {
            Canvas(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(200.dp)
                    .padding(start = 48.dp, end = 12.dp, top = 8.dp, bottom = 24.dp)
                    .pointerInput(chart) {
                        detectTapGestures { tapOffset ->
                            // Find nearest point
                            val w = size.width.toFloat()
                            val h = size.height.toFloat()
                            var bestDist = Float.MAX_VALUE
                            var bestLabel = ""
                            chart.lines.forEach { line ->
                                line.points.forEach { (x, y) ->
                                    val px = ((x - xMin) / (xMax - xMin) * w).toFloat()
                                    val py = (h - (y - yMin) / (yMax - yMin) * h).toFloat()
                                    val dist = kotlin.math.hypot(
                                        (tapOffset.x - px).toDouble(),
                                        (tapOffset.y - py).toDouble()
                                    ).toFloat()
                                    if (dist < bestDist && dist < 40.dp.toPx()) {
                                        bestDist = dist
                                        bestLabel = "${line.yColumn}: ${formatNum(y)}\nx: ${formatNum(x)}"
                                        tooltipOffset = Offset(px, py)
                                    }
                                }
                            }
                            tooltipInfo = if (bestLabel.isNotEmpty()) bestLabel else null
                        }
                    },
            ) {
                val w = size.width; val h = size.height

                // Grid lines
                val gridDash = PathEffect.dashPathEffect(floatArrayOf(4f, 4f))
                for (i in 0..4) {
                    val y = h * i / 4
                    drawLine(gridColor, Offset(0f, y), Offset(w, y), pathEffect = gridDash)
                }
                for (i in 0..4) {
                    val x = w * i / 4
                    drawLine(gridColor, Offset(x, 0f), Offset(x, h), pathEffect = gridDash)
                }

                // Axes
                drawLine(axisColor, Offset(0f, h), Offset(w, h), strokeWidth = 1f)
                drawLine(axisColor, Offset(0f, 0f), Offset(0f, h), strokeWidth = 1f)

                // Y axis ticks + labels
                for (i in 0..4) {
                    val frac = i / 4.0
                    val value = yMin + (yMax - yMin) * frac
                    val y = (h - h * frac).toFloat()
                    val label = formatNum(value)
                    val measured = textMeasurer.measure(label, axisTextStyle, maxLines = 1)
                    drawText(measured, topLeft = Offset(-measured.size.width - 4f, y - measured.size.height / 2))
                }

                // X axis ticks + labels
                for (i in 0..4) {
                    val frac = i / 4.0
                    val value = xMin + (xMax - xMin) * frac
                    val x = (w * frac).toFloat()
                    val label = formatNum(value)
                    val measured = textMeasurer.measure(label, axisTextStyle, maxLines = 1)
                    drawText(measured, topLeft = Offset(x - measured.size.width / 2, h + 4f))
                }

                // Lines
                chart.lines.forEach { line ->
                    if (line.points.size < 2) return@forEach
                    val path = Path()
                    line.points.forEachIndexed { idx, (x, y) ->
                        val px = ((x - xMin) / (xMax - xMin) * w).toFloat()
                        val py = (h - (y - yMin) / (yMax - yMin) * h).toFloat()
                        if (idx == 0) path.moveTo(px, py) else path.lineTo(px, py)
                    }
                    drawPath(path, line.color, style = Stroke(width = 2f))
                }
            }

            // Tooltip
            if (tooltipInfo != null) {
                Box(
                    Modifier
                        .offset { IntOffset(tooltipOffset.x.toInt() + 8, tooltipOffset.y.toInt() - 40) }
                        .background(MaterialTheme.colorScheme.surfaceVariant, MaterialTheme.shapes.medium)
                        .padding(horizontal = 8.dp, vertical = 4.dp),
                ) {
                    Text(tooltipInfo!!, style = MaterialTheme.typography.labelSmall)
                }
            }
        }
    }
}

private fun formatNum(v: Double): String {
    if (v == 0.0) return "0"
    val abs = kotlin.math.abs(v)
    return when {
        abs >= 1_000_000_000 -> "%.1fB".format(v / 1_000_000_000)
        abs >= 1_000_000 -> "%.1fM".format(v / 1_000_000)
        abs >= 1_000 -> "%.1fK".format(v / 1_000)
        abs >= 1 -> "%.1f".format(v)
        else -> "%.3g".format(v)
    }
}
