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
    fun `parseLruOutput extracts processes with mapped labels`() {
        val result = ShellHelper.parseLruOutput(REAL_LRU_OUTPUT)
        assertTrue(result.size >= 7)

        assertEquals("com.android.launcher3", result[0].name)
        assertEquals("Foreground", result[0].procState)
        assertEquals(29613, result[0].pid)
        assertEquals("u0a62", result[0].uid)

        assertEquals("com.android.systemui", result[1].name)
        assertEquals("Visible", result[1].procState)
        assertEquals("1000", result[1].uid)

        assertEquals("com.google.android.gms.persistent", result[2].name)
        assertEquals("FG Service", result[2].procState)
        assertEquals("u0a120", result[2].uid)

        assertEquals("com.example.cached", result[3].name)
        assertEquals("Cached", result[3].procState)

        assertEquals("com.android.inputmethod", result[4].name)
        assertEquals("Bound FG", result[4].procState)

        assertEquals("com.android.phone", result[5].name)
        assertEquals("Persistent", result[5].procState)

        assertEquals("com.example.topapp", result[6].name)
        assertEquals("Top", result[6].procState)
    }

    @Test
    fun `parseLruOutput deduplicates by PID`() {
        val output = """
          #0: fg     T  1234:com.example.app/u0a100
          #1: cch    S  1234:com.example.app/u0a100
        """.trimIndent()
        val result = ShellHelper.parseLruOutput(output)
        assertEquals(1, result.size)
        assertEquals("Foreground", result[0].procState)
    }

    @Test
    fun `parseLruOutput handles empty input`() {
        assertEquals(0, ShellHelper.parseLruOutput("").size)
    }

    @Test
    fun `parseLruOutput handles non-matching lines`() {
        val output = """
          ACTIVITY MANAGER LRU PROCESSES (dumpsys activity lru)
            Activities:
            Some random text here
        """.trimIndent()
        assertEquals(0, ShellHelper.parseLruOutput(output).size)
    }

    @Test
    fun `parseLruOutput handles oom labels with numeric suffix`() {
        val output = """
          #0: cch+1  S  5678:com.example.cached/u0a200
          #1: fgs+2  S  9012:com.example.fgs/u0a201
        """.trimIndent()
        val result = ShellHelper.parseLruOutput(output)
        assertEquals(2, result.size)
        assertEquals("Cached", result[0].procState)
        assertEquals("FG Service", result[1].procState)
    }

    @Test
    fun `parseLruOutput handles service states`() {
        val output = """
          #0: service S  3456:com.example.svc/u0a160
          #1: svcb    S  4567:com.example.svcb/u0a161
          #2: service-rs S  5678:com.example.svcrst/u0a162
        """.trimIndent()
        val result = ShellHelper.parseLruOutput(output)
        assertEquals(3, result.size)
        assertEquals("Service", result[0].procState)
        assertEquals("Service B", result[1].procState)
        assertEquals("Svc Restart", result[2].procState)
    }

    @Test
    fun `parseLruOutput handles btop and impfg`() {
        val output = """
          #0: btop   T  1111:com.example.btop/u0a170
          #1: impfg  S  2222:com.example.impfg/u0a171
          #2: impbg  S  3333:com.example.impbg/u0a172
        """.trimIndent()
        val result = ShellHelper.parseLruOutput(output)
        assertEquals(3, result.size)
        assertEquals("Bound Top", result[0].procState)
        assertEquals("Imp FG", result[1].procState)
        assertEquals("Imp BG", result[2].procState)
    }

    @Test
    fun `parseLruOutput handles frozen and native`() {
        val output = """
          #0: frzn   S  4444:com.example.frozen/u0a180
          #1: native S  5555:some.native.proc/u0a181
        """.trimIndent()
        val result = ShellHelper.parseLruOutput(output)
        assertEquals(2, result.size)
        assertEquals("Frozen", result[0].procState)
        assertEquals("Native", result[1].procState)
    }

    @Test
    fun `parseLruOutput handles heavy and backup`() {
        val output = """
          #0: heavy  S  6666:com.example.heavy/u0a190
          #1: backup S  7777:com.example.backup/u0a191
        """.trimIndent()
        val result = ShellHelper.parseLruOutput(output)
        assertEquals(2, result.size)
        assertEquals("Heavy", result[0].procState)
        assertEquals("Backup", result[1].procState)
    }

    @Test
    fun `parseLruOutput handles home and previous`() {
        val output = """
          #0: home   T  8888:com.example.home/u0a192
          #1: prev   T  9999:com.example.prev/u0a193
        """.trimIndent()
        val result = ShellHelper.parseLruOutput(output)
        assertEquals(2, result.size)
        assertEquals("Home", result[0].procState)
        assertEquals("Previous", result[1].procState)
    }

    @Test
    fun `parseLruOutput handles unknown state gracefully`() {
        val output = "  #0: xyzzy  S  1234:com.example.unknown/u0a200"
        val result = ShellHelper.parseLruOutput(output)
        assertEquals(1, result.size)
        assertEquals("xyzzy", result[0].procState)
    }

    @Test
    fun `parseLruOutput handles receiver state`() {
        val output = "  #0: receiver S  1234:com.example.receiver/u0a205"
        val result = ShellHelper.parseLruOutput(output)
        assertEquals(1, result.size)
        assertEquals("Receiver", result[0].procState)
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

    @Test
    fun `parseLruOutput maps all known labels`() {
        val labels = mapOf(
            "pers" to "Persistent", "top" to "Top", "bfgs" to "Bound FG",
            "btop" to "Bound Top", "fgs" to "FG Service", "fg" to "Foreground",
            "impfg" to "Imp FG", "impbg" to "Imp BG", "backup" to "Backup",
            "service" to "Service", "receiver" to "Receiver", "heavy" to "Heavy",
            "home" to "Home", "cached" to "Cached", "cch" to "Cached",
            "frzn" to "Frozen", "native" to "Native", "sys" to "System",
            "fore" to "Foreground", "vis" to "Visible", "percep" to "Perceptible",
            "perceptible" to "Perceptible", "svcb" to "Service B",
            "svcrst" to "Svc Restart", "prev" to "Previous",
            "lastact" to "Last Activity", "lstact" to "Last Activity",
            "service-rs" to "Svc Restart",
        )
        for ((raw, expected) in labels) {
            val output = "  #0: $raw    S  1234:test.proc/u0a100"
            val result = ShellHelper.parseLruOutput(output)
            assertEquals("Label mapping failed for '$raw'", 1, result.size)
            assertEquals("Label mapping failed for '$raw'", expected, result[0].procState)
        }
    }
}
