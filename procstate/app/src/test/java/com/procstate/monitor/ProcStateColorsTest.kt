package com.procstate.monitor

import com.procstate.monitor.ui.theme.ProcStateColors
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ProcStateColorsTest {

    @Test
    fun `all expected states have colors`() {
        val expected = listOf(
            "System", "Persistent", "Top", "Foreground", "Visible",
            "FG Service", "Bound FG", "Bound Top", "Perceptible",
            "Imp FG", "Imp BG", "Previous", "Home", "Service",
            "Service B", "Svc Restart", "Receiver", "Backup",
            "Heavy", "Last Activity", "Cached", "Frozen", "Native",
        )
        for (state in expected) {
            assertNotNull("Missing color for: $state", ProcStateColors.palette[state])
        }
    }

    @Test
    fun `order contains all states`() {
        assertEquals(ProcStateColors.palette.size, ProcStateColors.order.size)
        for (state in ProcStateColors.palette.keys) {
            assertTrue("Missing in order: $state", state in ProcStateColors.order)
        }
    }

    @Test
    fun `get returns fallback for unknown state in both modes`() {
        val lightColor = ProcStateColors.get("unknown_state_xyz", isDark = false)
        val darkColor = ProcStateColors.get("unknown_state_xyz", isDark = true)
        assertNotNull(lightColor)
        assertNotNull(darkColor)
    }

    @Test
    fun `light and dark colors are different for each state`() {
        for ((state, dual) in ProcStateColors.palette) {
            assertTrue(
                "Light and dark should differ for $state",
                dual.light != dual.dark,
            )
        }
    }

    @Test
    fun `all light colors are unique`() {
        val colors = ProcStateColors.palette.values.map { it.light }
        val unique = colors.toSet()
        assertEquals("Duplicate light colors found", colors.size, unique.size)
    }

    @Test
    fun `all dark colors are unique`() {
        val colors = ProcStateColors.palette.values.map { it.dark }
        val unique = colors.toSet()
        assertEquals("Duplicate dark colors found", colors.size, unique.size)
    }

    @Test
    fun `useWhiteText returns true for dark colors`() {
        // A very dark color should need white text
        val darkColor = ProcStateColors.get("System", isDark = false)
        assertTrue(ProcStateColors.useWhiteText(darkColor))
    }
}
