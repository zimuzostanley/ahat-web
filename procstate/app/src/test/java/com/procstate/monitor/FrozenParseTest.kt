package com.procstate.monitor

import com.procstate.monitor.data.ShellHelper
import org.junit.Assert.assertEquals
import org.junit.Test

class FrozenParseTest {

    @Test
    fun `parseLruOutput extracts UID from standard lines`() {
        val output = """
          #0: fg     T  29613:com.android.launcher3/u0a62 act:activities
          #1: cch    S  4567:com.example.cached/u0a200
        """.trimIndent()
        val result = ShellHelper.parseLruOutput(output)
        assertEquals(2, result.size)
        assertEquals("u0a62", result[0].uid)
        assertEquals("u0a200", result[1].uid)
    }

    @Test
    fun `parseLruOutput handles numeric UID`() {
        val output = "  #0: vis    T  1729:com.android.systemui/1000 act:activities"
        val result = ShellHelper.parseLruOutput(output)
        assertEquals(1, result.size)
        assertEquals("1000", result[0].uid)
    }

    @Test
    fun `parseLruOutput handles missing UID gracefully`() {
        // Some kernel processes might not have /uid suffix
        val output = "  #0: fg     S  1234:some.proc"
        val result = ShellHelper.parseLruOutput(output)
        // Should still parse (UID is optional)
        assertEquals(1, result.size)
        assertEquals("", result[0].uid)
    }

    @Test
    fun `parseLruOutput UID with extra text after`() {
        val output = "  #0: fg     T  29613:com.android.launcher3/u0a62 act:activities extra:stuff"
        val result = ShellHelper.parseLruOutput(output)
        assertEquals(1, result.size)
        assertEquals("u0a62", result[0].uid)
    }
}
