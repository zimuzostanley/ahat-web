package com.procstate.monitor

import com.procstate.monitor.data.ProcessKey
import com.procstate.monitor.data.ProcessKeyWithTransitions
import com.procstate.monitor.data.STATE_PRIORITY
import com.procstate.monitor.data.SnapshotWithCounts
import com.procstate.monitor.ui.TimeRange
import com.procstate.monitor.ui.CaptureInterval
import com.procstate.monitor.ui.StopAfter
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class EntitiesTest {

    @Test
    fun `SnapshotWithCounts totalProcesses sums all states`() {
        val swc = SnapshotWithCounts(
            id = 1,
            timestamp = 1000L,
            stateCounts = mapOf("Cached" to 50, "Foreground" to 3, "FG Service" to 7),
        )
        assertEquals(60, swc.totalProcesses)
    }

    @Test
    fun `SnapshotWithCounts empty counts`() {
        val swc = SnapshotWithCounts(id = 1, timestamp = 1000L, stateCounts = emptyMap())
        assertEquals(0, swc.totalProcesses)
    }

    @Test
    fun `TimeRange values are correct`() {
        assertEquals(5 * 60_000L, TimeRange.MIN_5.millis)
        assertEquals(24 * 60 * 60_000L, TimeRange.HOUR_24.millis)
        assertEquals(7 * 24 * 60 * 60_000L, TimeRange.DAY_7.millis)
        assertEquals(30L * 24 * 60 * 60_000L, TimeRange.DAY_30.millis)
    }

    @Test
    fun `CaptureInterval values are correct`() {
        assertEquals(100L, CaptureInterval.MS_100.millis)
        assertEquals(500L, CaptureInterval.MS_500.millis)
        assertEquals(10_000L, CaptureInterval.SEC_10.millis)
        assertEquals(30_000L, CaptureInterval.SEC_30.millis)
        assertEquals(60_000L, CaptureInterval.MIN_1.millis)
        assertEquals(300_000L, CaptureInterval.MIN_5.millis)
        assertEquals(900_000L, CaptureInterval.MIN_15.millis)
    }

    @Test
    fun `StopAfter NEVER is 0 minutes`() {
        assertEquals(0, StopAfter.NEVER.minutes)
    }

    @Test
    fun `StopAfter values are correct`() {
        assertEquals(5, StopAfter.MIN_5.minutes)
        assertEquals(60, StopAfter.HOUR_1.minutes)
        assertEquals(1440, StopAfter.HOUR_24.minutes)
    }

    // ── STATE_PRIORITY tests ─────────────────────────────────────────────────

    @Test
    fun `STATE_PRIORITY foreground is higher than cached`() {
        assertTrue(STATE_PRIORITY["fg"]!! > STATE_PRIORITY["cch"]!!)
    }

    @Test
    fun `STATE_PRIORITY sys is highest`() {
        val max = STATE_PRIORITY.values.max()
        assertEquals(max, STATE_PRIORITY["sys"])
    }

    @Test
    fun `STATE_PRIORITY covers all canonical states`() {
        val expected = setOf("ntv", "sys", "pers", "psvc", "fg", "vis", "prcp", "prcm", "prcl",
            "bkup", "hvy", "svc", "home", "prev", "svcb", "cch", "frzn", "fgs")
        assertEquals(expected, STATE_PRIORITY.keys)
    }

    @Test
    fun `STATE_PRIORITY order is correct`() {
        // fg > vis > prcp > cch
        assertTrue(STATE_PRIORITY["fg"]!! > STATE_PRIORITY["vis"]!!)
        assertTrue(STATE_PRIORITY["vis"]!! > STATE_PRIORITY["prcp"]!!)
        assertTrue(STATE_PRIORITY["prcp"]!! > STATE_PRIORITY["cch"]!!)
    }

    // ── Sort by last change tests ────────────────────────────────────────────

    @Test
    fun `sort by lastChangeMs descending puts most recent first`() {
        val a = ProcessKeyWithTransitions(ProcessKey("com.a", "u1"), 5, 0, 0, lastChangeMs = 1000, lastChangePriority = 3)
        val b = ProcessKeyWithTransitions(ProcessKey("com.b", "u2"), 2, 0, 0, lastChangeMs = 5000, lastChangePriority = 3)
        val sorted = listOf(a, b).sortedByDescending { it.lastChangeMs }
        assertEquals("com.b", sorted[0].key.name)
    }

    @Test
    fun `sort tie-breaks by priority descending`() {
        val a = ProcessKeyWithTransitions(ProcessKey("com.a", "u1"), 5, 0, 0,
            lastChangeMs = 5000, lastChangePriority = STATE_PRIORITY["cch"]!!)
        val b = ProcessKeyWithTransitions(ProcessKey("com.b", "u2"), 2, 0, 0,
            lastChangeMs = 5000, lastChangePriority = STATE_PRIORITY["fg"]!!)
        val sorted = listOf(a, b)
            .sortedWith(compareByDescending<ProcessKeyWithTransitions> { it.lastChangeMs }
                .thenByDescending { it.lastChangePriority })
        assertEquals("com.b", sorted[0].key.name) // fg > cch at same timestamp
    }

    @Test
    fun `process with no state change has lastChangeMs 0 and sorts last`() {
        val changed = ProcessKeyWithTransitions(ProcessKey("com.a", "u1"), 1, 0, 0, lastChangeMs = 5000, lastChangePriority = 3)
        val unchanged = ProcessKeyWithTransitions(ProcessKey("com.b", "u2"), 0, 0, 0, lastChangeMs = 0, lastChangePriority = 0)
        val sorted = listOf(unchanged, changed).sortedByDescending { it.lastChangeMs }
        assertEquals("com.a", sorted[0].key.name)
    }
}
