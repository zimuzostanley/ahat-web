package com.procstate.monitor

import com.procstate.monitor.data.TraceExporter
import com.procstate.monitor.data.TraceExporter.Entry
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TraceExporterTest {

    private fun entry(ts: Long, name: String = "com.test", uid: String = "u0a100",
                      pid: Int = 1000, state: String = "fg", frozen: Boolean = false) =
        Entry(ts, name, uid, pid, state, frozen)

    // ── mergeStateSlices ────────────────────────────────────────────────────

    @Test
    fun `mergeStateSlices single entry`() {
        val entries = listOf(entry(1000, state = "fg"))
        val slices = TraceExporter.mergeStateSlices(entries, listOf(1000L, 2000L))
        assertEquals(1, slices.size)
        assertEquals("fg", slices[0].name)
        assertEquals(1000_000L, slices[0].startUs) // 1000ms * 1000
        assertEquals(1000_000L, slices[0].durUs)    // next ts is 2000ms
    }

    @Test
    fun `mergeStateSlices merges consecutive same state`() {
        val entries = listOf(
            entry(1000, state = "fg"),
            entry(2000, state = "fg"),
            entry(3000, state = "fg"),
        )
        val slices = TraceExporter.mergeStateSlices(entries, listOf(1000L, 2000L, 3000L, 4000L))
        assertEquals(1, slices.size)
        assertEquals("fg", slices[0].name)
        assertEquals(1000_000L, slices[0].startUs)
        assertEquals(3000_000L, slices[0].durUs) // 1000 to 4000 = 3000ms
    }

    @Test
    fun `mergeStateSlices splits on state change`() {
        val entries = listOf(
            entry(1000, state = "fg"),
            entry(2000, state = "cch"),
            entry(3000, state = "cch"),
        )
        val slices = TraceExporter.mergeStateSlices(entries, listOf(1000L, 2000L, 3000L, 4000L))
        assertEquals(2, slices.size)
        assertEquals("fg", slices[0].name)
        assertEquals(1000_000L, slices[0].startUs)
        assertEquals(1000_000L, slices[0].durUs) // 1000 to 2000
        assertEquals("cch", slices[1].name)
        assertEquals(2000_000L, slices[1].startUs)
        assertEquals(2000_000L, slices[1].durUs) // 2000 to 4000
    }

    @Test
    fun `mergeStateSlices multiple transitions`() {
        val entries = listOf(
            entry(1000, state = "fg"),
            entry(2000, state = "vis"),
            entry(3000, state = "cch"),
        )
        val slices = TraceExporter.mergeStateSlices(entries, listOf(1000L, 2000L, 3000L, 4000L))
        assertEquals(3, slices.size)
        assertEquals("fg", slices[0].name)
        assertEquals("vis", slices[1].name)
        assertEquals("cch", slices[2].name)
    }

    @Test
    fun `mergeStateSlices empty input`() {
        assertEquals(0, TraceExporter.mergeStateSlices(emptyList(), listOf(1000L)).size)
    }

    @Test
    fun `mergeStateSlices last slice uses default duration when no next timestamp`() {
        val entries = listOf(entry(5000, state = "fg"))
        val slices = TraceExporter.mergeStateSlices(entries, listOf(5000L))
        assertEquals(1, slices.size)
        assertEquals(1000_000L, slices[0].durUs) // default 1s
    }

    // ── mergeFrozenSlices ───────────────────────────────────────────────────

    @Test
    fun `mergeFrozenSlices no frozen entries`() {
        val entries = listOf(
            entry(1000, frozen = false),
            entry(2000, frozen = false),
        )
        assertEquals(0, TraceExporter.mergeFrozenSlices(entries, listOf(1000L, 2000L, 3000L)).size)
    }

    @Test
    fun `mergeFrozenSlices single frozen period`() {
        val entries = listOf(
            entry(1000, frozen = false),
            entry(2000, frozen = true),
            entry(3000, frozen = true),
            entry(4000, frozen = false),
        )
        val slices = TraceExporter.mergeFrozenSlices(entries, listOf(1000L, 2000L, 3000L, 4000L, 5000L))
        assertEquals(1, slices.size)
        assertEquals(2000_000L, slices[0].startUs)
        assertEquals(2000_000L, slices[0].durUs) // 2000 to 4000
    }

    @Test
    fun `mergeFrozenSlices multiple frozen periods`() {
        val entries = listOf(
            entry(1000, frozen = true),
            entry(2000, frozen = false),
            entry(3000, frozen = true),
            entry(4000, frozen = false),
        )
        val slices = TraceExporter.mergeFrozenSlices(entries, listOf(1000L, 2000L, 3000L, 4000L, 5000L))
        assertEquals(2, slices.size)
    }

    @Test
    fun `mergeFrozenSlices open frozen at end`() {
        val entries = listOf(
            entry(1000, frozen = false),
            entry(2000, frozen = true),
            entry(3000, frozen = true),
        )
        val slices = TraceExporter.mergeFrozenSlices(entries, listOf(1000L, 2000L, 3000L, 4000L))
        assertEquals(1, slices.size)
        assertEquals(2000_000L, slices[0].startUs)
        assertEquals(2000_000L, slices[0].durUs) // 2000 to 4000 (next timestamp)
    }

    // ── detectLifecycleEvents ───────────────────────────────────────────────

    @Test
    fun `detectLifecycleEvents no restarts`() {
        val entries = listOf(
            entry(1000, pid = 100),
            entry(2000, pid = 100),
            entry(3000, pid = 100),
        )
        assertEquals(0, TraceExporter.detectLifecycleEvents(entries).size)
    }

    @Test
    fun `detectLifecycleEvents one restart`() {
        val entries = listOf(
            entry(1000, pid = 100),
            entry(2000, pid = 200),
            entry(3000, pid = 200),
        )
        val events = TraceExporter.detectLifecycleEvents(entries)
        assertEquals(1, events.size)
        assertEquals(2000_000L, events[0].tsUs)
        assertEquals("process start", events[0].name)
    }

    @Test
    fun `detectLifecycleEvents multiple restarts`() {
        val entries = listOf(
            entry(1000, pid = 100),
            entry(2000, pid = 200),
            entry(3000, pid = 300),
        )
        assertEquals(2, TraceExporter.detectLifecycleEvents(entries).size)
    }

    @Test
    fun `detectLifecycleEvents ignores pid 0`() {
        val entries = listOf(
            entry(1000, pid = 0),
            entry(2000, pid = 100),
        )
        assertEquals(0, TraceExporter.detectLifecycleEvents(entries).size)
    }

    // ── Full export ─────────────────────────────────────────────────────────

    @Test
    fun `export produces valid JSON with traceEvents`() {
        val entries = listOf(
            entry(1000, state = "fg"),
            entry(2000, state = "cch"),
        )
        val json = TraceExporter.export(entries, { it }, listOf(1000L, 2000L, 3000L))
        val obj = JSONObject(json)
        assertTrue(obj.has("traceEvents"))
        assertTrue(obj.getJSONArray("traceEvents").length() > 0)
        assertEquals("ms", obj.getString("displayTimeUnit"))
    }

    @Test
    fun `export contains metadata events`() {
        val entries = listOf(entry(1000, state = "fg"))
        val json = TraceExporter.export(entries, { "TestApp" }, listOf(1000L, 2000L))
        val obj = JSONObject(json)
        val events = obj.getJSONArray("traceEvents")
        var hasProcessName = false
        var hasThreadName = false
        for (i in 0 until events.length()) {
            val e = events.getJSONObject(i)
            if (e.getString("ph") == "M") {
                when (e.getString("name")) {
                    "process_name" -> hasProcessName = true
                    "thread_name" -> hasThreadName = true
                }
            }
        }
        assertTrue("Should have process_name metadata", hasProcessName)
        assertTrue("Should have thread_name metadata", hasThreadName)
    }

    @Test
    fun `export contains counter events for state counts`() {
        val entries = listOf(
            entry(1000, name = "a", state = "fg"),
            entry(1000, name = "b", state = "fg"),
            entry(1000, name = "c", state = "cch"),
        )
        val json = TraceExporter.export(entries, { it }, listOf(1000L, 2000L))
        val obj = JSONObject(json)
        val events = obj.getJSONArray("traceEvents")
        var counterCount = 0
        for (i in 0 until events.length()) {
            val e = events.getJSONObject(i)
            if (e.getString("ph") == "C" && e.getString("name") == "processes") {
                counterCount++
                val args = e.getJSONObject("args")
                assertEquals(2, args.getInt("fg"))
                assertEquals(1, args.getInt("cch"))
            }
        }
        assertTrue("Should have counter events", counterCount > 0)
    }

    @Test
    fun `export contains frozen counter`() {
        val entries = listOf(
            entry(1000, name = "a", frozen = true),
            entry(1000, name = "b", frozen = false),
        )
        val json = TraceExporter.export(entries, { it }, listOf(1000L, 2000L))
        val obj = JSONObject(json)
        val events = obj.getJSONArray("traceEvents")
        var frozenCounter = false
        for (i in 0 until events.length()) {
            val e = events.getJSONObject(i)
            if (e.getString("ph") == "C" && e.getString("name") == "frozen") {
                frozenCounter = true
                assertEquals(1, e.getJSONObject("args").getInt("frozen"))
            }
        }
        assertTrue("Should have frozen counter", frozenCounter)
    }

    @Test
    fun `export timestamps are in microseconds`() {
        val entries = listOf(entry(1000, state = "fg")) // 1000ms
        val json = TraceExporter.export(entries, { it }, listOf(1000L, 2000L))
        val obj = JSONObject(json)
        val events = obj.getJSONArray("traceEvents")
        for (i in 0 until events.length()) {
            val e = events.getJSONObject(i)
            if (e.getString("ph") == "X") {
                assertEquals(1000_000L, e.getLong("ts")) // 1000ms = 1000000us
                break
            }
        }
    }

    @Test
    fun `export empty input produces valid JSON`() {
        val json = TraceExporter.export(emptyList(), { it }, emptyList())
        val obj = JSONObject(json)
        assertTrue(obj.has("traceEvents"))
    }

    @Test
    fun `export multiple processes get separate pids`() {
        val entries = listOf(
            entry(1000, name = "com.a", uid = "u0a1", state = "fg"),
            entry(1000, name = "com.b", uid = "u0a2", state = "cch"),
        )
        val json = TraceExporter.export(entries, { it }, listOf(1000L, 2000L))
        val obj = JSONObject(json)
        val events = obj.getJSONArray("traceEvents")
        val pids = mutableSetOf<Int>()
        for (i in 0 until events.length()) {
            val e = events.getJSONObject(i)
            if (e.getString("ph") == "X") {
                pids.add(e.getInt("pid"))
            }
        }
        assertEquals("Two processes should have different pids", 2, pids.size)
    }
}
