package com.procstate.monitor

import com.procstate.monitor.data.ShellHelper
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ShellHelperParseTest {

    private val REAL_LRU_OUTPUT = """
        ACTIVITY MANAGER LRU PROCESSES (dumpsys activity lru)
          Activities:
          #0: fg     T  29613:com.android.launcher3/u0a62 act:activities
          #1: vis    T  1729:com.android.systemui/1000 act:activities
          #2: fgs    S  3456:com.google.android.gms.persistent/u0a120
          #3: cch+1  S  4567:com.example.cached/u0a200
          #4: bfgs   S  5678:com.android.inputmethod/u0a50
          #5: pers   S  891:com.android.phone/1001
          #6: top    T  12345:com.example.topapp/u0a300 act:activities
          #7: home   T  2345:com.android.launcher3home/u0a62
    """.trimIndent()

    @Test
    fun `parseLruOutput extracts raw state labels`() {
        val result = ShellHelper.parseLruOutput(REAL_LRU_OUTPUT)
        assertTrue(result.size >= 7)

        assertEquals("com.android.launcher3", result[0].name)
        assertEquals("fg", result[0].procState)
        assertEquals(29613, result[0].pid)
        assertEquals("u0a62", result[0].uid)

        assertEquals("com.android.systemui", result[1].name)
        assertEquals("vis", result[1].procState)
        assertEquals("1000", result[1].uid)

        assertEquals("com.google.android.gms.persistent", result[2].name)
        assertEquals("fgs", result[2].procState)
        assertEquals("u0a120", result[2].uid)

        assertEquals("com.example.cached", result[3].name)
        assertEquals("cch", result[3].procState) // +1 suffix stripped

        assertEquals("com.android.inputmethod", result[4].name)
        assertEquals("bfgs", result[4].procState)

        assertEquals("com.android.phone", result[5].name)
        assertEquals("pers", result[5].procState)

        assertEquals("com.example.topapp", result[6].name)
        assertEquals("top", result[6].procState)
    }

    @Test
    fun `parseLruOutput deduplicates by PID`() {
        val output = """
          #0: fg     T  1234:com.example.app/u0a100
          #1: cch    S  1234:com.example.app/u0a100
        """.trimIndent()
        val result = ShellHelper.parseLruOutput(output)
        assertEquals(1, result.size)
        assertEquals("fg", result[0].procState)
    }

    @Test
    fun `parseLruOutput handles empty input`() {
        assertEquals(0, ShellHelper.parseLruOutput("").size)
    }

    @Test
    fun `parseLruOutput strips plus suffix`() {
        val output = """
          #0: cch+1  S  5678:com.example.cached/u0a200
          #1: fgs+2  S  9012:com.example.fgs/u0a201
        """.trimIndent()
        val result = ShellHelper.parseLruOutput(output)
        assertEquals(2, result.size)
        assertEquals("cch", result[0].procState)
        assertEquals("fgs", result[1].procState)
    }

    @Test
    fun `parseLruOutput handles all common states`() {
        val states = listOf("fg", "vis", "fgs", "bfgs", "cch", "pers", "top",
            "service", "btop", "impfg", "impbg", "home", "prev", "heavy",
            "backup", "receiver", "native", "sys", "frzn", "svcb")
        for ((i, state) in states.withIndex()) {
            val output = "  #$i: $state    S  ${1000 + i}:test.proc/u0a${100 + i}"
            val result = ShellHelper.parseLruOutput(output)
            assertEquals("State '$state' should parse", 1, result.size)
            assertEquals(state, result[0].procState)
        }
    }

    @Test
    fun `parseLruOutput handles device-specific states like psvc prcl`() {
        val output = """
          #0: psvc   S  1234:com.example.psvc/u0a100
          #1: prcl   S  5678:com.example.prcl/u0a200
        """.trimIndent()
        val result = ShellHelper.parseLruOutput(output)
        assertEquals(2, result.size)
        assertEquals("psvc", result[0].procState)
        assertEquals("prcl", result[1].procState)
    }

    @Test
    fun `parseLruOutput extracts UID`() {
        val output = "  #0: fg     T  29613:com.android.launcher3/u0a62 act:activities"
        val result = ShellHelper.parseLruOutput(output)
        assertEquals(1, result.size)
        assertEquals("u0a62", result[0].uid)
    }

    @Test
    fun `parseLruOutput handles missing UID`() {
        val output = "  #0: fg     S  1234:some.proc"
        val result = ShellHelper.parseLruOutput(output)
        assertEquals(1, result.size)
        assertEquals("", result[0].uid)
    }

    @Test
    fun `parseLruOutput large realistic output`() {
        val states = listOf("fg", "vis", "fgs", "bfgs", "cch", "pers", "top", "service")
        val lines = (0 until 200).map { i ->
            val state = states[i % states.size]
            "  #$i: $state    S  ${1000 + i}:com.example.proc$i/u0a${100 + i}"
        }
        val result = ShellHelper.parseLruOutput(lines.joinToString("\n"))
        assertEquals(200, result.size)
    }
}
