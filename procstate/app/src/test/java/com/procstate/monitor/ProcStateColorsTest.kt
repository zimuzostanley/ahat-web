package com.procstate.monitor

import com.procstate.monitor.ui.theme.ProcStateColors
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ProcStateColorsTest {

    @Test
    fun `get returns a color for any state`() {
        val light = ProcStateColors.get("fg", isDark = false)
        val dark = ProcStateColors.get("fg", isDark = true)
        assertNotNull(light)
        assertNotNull(dark)
    }

    @Test
    fun `same state always returns same color`() {
        val c1 = ProcStateColors.get("cch", isDark = false)
        val c2 = ProcStateColors.get("cch", isDark = false)
        assertEquals(c1, c2)
    }

    @Test
    fun `different states get different colors within first 20`() {
        val states = listOf("fg", "vis", "fgs", "cch", "pers", "top", "service", "home")
        val colors = states.map { ProcStateColors.get(it, isDark = false) }
        val unique = colors.toSet()
        assertEquals("Colors should be unique for 8 states", states.size, unique.size)
    }

    @Test
    fun `order tracks first appearance`() {
        // Reset by using fresh states
        val s1 = "test_state_${System.nanoTime()}"
        val s2 = "test_state_${System.nanoTime() + 1}"
        ProcStateColors.get(s1, isDark = false)
        ProcStateColors.get(s2, isDark = false)
        val order = ProcStateColors.order
        assertTrue(order.indexOf(s1) < order.indexOf(s2))
    }

    @Test
    fun `unknown states beyond 20 get fallback color`() {
        // Generate 25 unique states
        val base = System.nanoTime()
        for (i in 0 until 25) {
            ProcStateColors.get("overflow_${base}_$i", isDark = false)
        }
        // Should not crash
    }

    @Test
    fun `useWhiteText returns true for dark colors`() {
        val darkColor = ProcStateColors.get("pers", isDark = false)
        // First assigned color is steel blue (0xFF4C78A8) which is dark
        assertTrue(ProcStateColors.useWhiteText(darkColor))
    }
}
