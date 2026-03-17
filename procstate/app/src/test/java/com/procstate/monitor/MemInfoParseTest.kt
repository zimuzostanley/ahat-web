package com.procstate.monitor

import com.procstate.monitor.data.ShellHelper
import org.junit.Assert.assertEquals
import org.junit.Test

class MemInfoParseTest {

    @Test
    fun `parseMemInfoOutput parses App Summary section`() {
        val output = """
            Applications Memory Usage (in Kilobytes):
            Uptime: 123456789 Realtime: 123456789

                       Pss  Private  Private  SwapPss      Rss     Heap     Heap     Heap
                     Total    Dirty    Clean    Dirty    Total     Size    Alloc     Free
                    ------   ------   ------   ------   ------   ------   ------   ------
              TOTAL   85432    72345     1234      567   123456    98765    87654    11111

             App Summary
                           Pss(KB)                        Rss(KB)
                            ------                         ------
               Java Heap:    12345                          34567
             Native Heap:    45678                          56789
                    Code:     3456                           4567
                   Stack:      789                            890
                Graphics:    23456                          34567
                  System:     5678
                 TOTAL PSS:    85432
                 TOTAL RSS:   123456
            TOTAL SWAP PSS:      567
        """.trimIndent()

        val info = ShellHelper.parseMemInfoOutput(output)
        assertEquals(12345, info.javaHeapKb)
        assertEquals(45678, info.nativeHeapKb)
        assertEquals(3456, info.codeKb)
        assertEquals(789, info.stackKb)
        assertEquals(23456, info.graphicsKb)
        assertEquals(5678, info.systemKb)
        assertEquals(85432, info.totalPssKb)
        assertEquals(123456, info.totalRssKb)
        assertEquals(567, info.totalSwapKb)
    }

    @Test
    fun `parseMemInfoOutput handles Graphics correctly from App Summary`() {
        // This test specifically verifies Graphics isn't 0
        // (the old parser would pick up a 0 from the detail table)
        val output = """
            Pss  Private  Private  SwapPss      Rss
          Total    Dirty    Clean    Dirty    Total
         ------   ------   ------   ------   ------
           TOTAL   50000    40000     1000      100    60000

             App Summary
                           Pss(KB)
                            ------
               Java Heap:     5000
             Native Heap:    10000
                    Code:     2000
                   Stack:      500
                Graphics:    15000
                  System:     3000
                 TOTAL PSS:    50000
        """.trimIndent()

        val info = ShellHelper.parseMemInfoOutput(output)
        assertEquals(15000, info.graphicsKb)
    }

    @Test
    fun `parseMemInfoOutput handles empty output`() {
        val info = ShellHelper.parseMemInfoOutput("")
        assertEquals(0, info.totalPssKb)
        assertEquals(0, info.graphicsKb)
    }

    @Test
    fun `parseMemInfoOutput uses TOTAL fallback when no TOTAL PSS line`() {
        val output = """
               TOTAL   42000    30000     1000      100    50000
        """.trimIndent()

        val info = ShellHelper.parseMemInfoOutput(output)
        assertEquals(42000, info.totalPssKb)
    }

    @Test
    fun `parseMemInfoOutput parses TOTAL SWAP PSS`() {
        val output = """
             App Summary
                           Pss(KB)
                            ------
               Java Heap:     1000
                 TOTAL PSS:    10000
                 TOTAL RSS:    20000
            TOTAL SWAP PSS:     500
        """.trimIndent()

        val info = ShellHelper.parseMemInfoOutput(output)
        assertEquals(500, info.totalSwapKb)
    }

    @Test
    fun `parseMemInfoOutput real device output with Graphics`() {
        val output = """ App Summary
                       Pss(KB)                        Rss(KB)
                        ------                         ------
           Java Heap:   128116                         158040
         Native Heap:    97252                         106732
                Code:    16264                         186504
               Stack:     2892                           3020
            Graphics:    99256                          99256
       Private Other:    30272
              System:    84015
             Unknown:                                   29472

           TOTAL PSS:   458067            TOTAL RSS:   583024       TOTAL SWAP PSS:    61829"""

        val info = ShellHelper.parseMemInfoOutput(output)
        assertEquals(99256, info.graphicsKb)
        assertEquals(128116, info.javaHeapKb)
        assertEquals(97252, info.nativeHeapKb)
        assertEquals(16264, info.codeKb)
        assertEquals(2892, info.stackKb)
        assertEquals(84015, info.systemKb)
        assertEquals(458067, info.totalPssKb)
        assertEquals(583024, info.totalRssKb)
        assertEquals(61829, info.totalSwapKb)
    }

    @Test
    fun `parseMemInfoOutput all categories from App Summary`() {
        val output = """
             App Summary
                           Pss(KB)
                            ------
               Java Heap:     1111
             Native Heap:     2222
                    Code:     3333
                   Stack:      444
                Graphics:     5555
                  System:     6666
                 TOTAL PSS:    19331
                 TOTAL RSS:    30000
        """.trimIndent()

        val info = ShellHelper.parseMemInfoOutput(output)
        assertEquals(1111, info.javaHeapKb)
        assertEquals(2222, info.nativeHeapKb)
        assertEquals(3333, info.codeKb)
        assertEquals(444, info.stackKb)
        assertEquals(5555, info.graphicsKb)
        assertEquals(6666, info.systemKb)
        assertEquals(19331, info.totalPssKb)
        assertEquals(30000, info.totalRssKb)
    }
}
