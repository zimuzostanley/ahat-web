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
        assertEquals(85432 - 5678, info.totalPssKb) // PSS minus System
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
    fun `parseMemInfoOutput full dumpsys output with MEMINFO table and App Summary`() {
        val output = """Applications Memory Usage (in Kilobytes):
Uptime: 529296826 Realtime: 744273467

** MEMINFO in pid 4795 [com.android.systemui] **
                   Pss  Private  Private  SwapPss      Rss     Heap     Heap     Heap
                 Total    Dirty    Clean    Dirty    Total     Size    Alloc     Free
                ------   ------   ------   ------   ------   ------   ------   ------
  Native Heap    97565    92496     5068    62305   101072   348668   129056   214617
  Dalvik Heap   117594   117440       88      159   124364   262144   114450   147694
 Dalvik Other    12748     6520      152       88    19380
        Stack     2864     2756      108     2000     2868
       Ashmem      560      552        0        0     2396
    Other dev      149        4      144        0      520
     .so mmap      713      124       36      628    45912
    .jar mmap     1110        0       44        0    56284
    .apk mmap    14382        0      464        0    41548
    .ttf mmap      539        0      232        0     1820
    .dex mmap    13957      124    13832        0    14912
    .oat mmap       81        0        0        0    13028
    .art mmap     1900     1400      428        0    24780
   Other mmap      249        4      172        0     1448
   EGL mtrack    70920    70920        0        0    70920
    GL mtrack    30256    30256        0        0    30256
        Memfd      306        0        0        0      612
      Unknown    17130     9840     7288     1597    18084
        TOTAL   449800   332436    28056    66777   570204   610812   243506   362311

 App Summary
                       Pss(KB)                        Rss(KB)
                        ------                         ------
           Java Heap:   119268                         149144
         Native Heap:    92496                         101072
                Code:    15216                         186020
               Stack:     2756                           2868
            Graphics:   101176                         101176
       Private Other:    29580
              System:    89308
             Unknown:                                   29924

           TOTAL PSS:   449800            TOTAL RSS:   570204       TOTAL SWAP PSS:    66777"""

        val info = ShellHelper.parseMemInfoOutput(output)
        assertEquals("Graphics from App Summary", 101176, info.graphicsKb)
        assertEquals(119268, info.javaHeapKb)
        assertEquals(92496, info.nativeHeapKb)
        assertEquals(15216, info.codeKb)
        assertEquals(2756, info.stackKb)
        assertEquals(89308, info.systemKb)
        assertEquals(449800 - 89308, info.totalPssKb) // PSS minus System
        assertEquals(570204, info.totalRssKb)
        assertEquals(66777, info.totalSwapKb)
    }

    @Test
    fun `parseMemInfoOutput exact user output`() {
        // Exact copy-paste from user's device — do NOT modify whitespace
        val output = "App Summary\n" +
            "                       Pss(KB)                        Rss(KB)\n" +
            "                        ------                         ------\n" +
            "           Java Heap:   128116                         158040\n" +
            "         Native Heap:    97252                         106732\n" +
            "                Code:    16264                         186504\n" +
            "               Stack:     2892                           3020\n" +
            "            Graphics:    99256                          99256\n" +
            "       Private Other:    30272\n" +
            "              System:    84015\n" +
            "             Unknown:                                   29472\n" +
            "\n" +
            "           TOTAL PSS:   458067            TOTAL RSS:   583024       TOTAL SWAP PSS:    61829\n"

        val info = ShellHelper.parseMemInfoOutput(output)
        assertEquals("Graphics should be 99256", 99256, info.graphicsKb)
        assertEquals(128116, info.javaHeapKb)
        assertEquals(97252, info.nativeHeapKb)
        assertEquals(458067 - 84015, info.totalPssKb) // PSS minus System
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
        assertEquals(458067 - 84015, info.totalPssKb) // PSS minus System
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
        assertEquals(19331 - 6666, info.totalPssKb) // PSS minus System
        assertEquals(30000, info.totalRssKb)
    }
}
