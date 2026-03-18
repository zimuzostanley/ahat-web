package com.procstate.monitor

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
}
