package com.procstate.monitor

import com.procstate.monitor.ui.formatTimestamp
import org.junit.Assert.assertTrue
import org.junit.Test

class FormatTimestampTest {

    @Test
    fun `recent timestamp shows time only`() {
        val now = System.currentTimeMillis()
        val result = formatTimestamp(now - 5000) // 5 seconds ago
        // Should be HH:mm:ss format
        assertTrue("Expected time format, got: $result", result.matches(Regex("\\d{2}:\\d{2}:\\d{2}")))
    }

    @Test
    fun `old timestamp shows date and time`() {
        val now = System.currentTimeMillis()
        val twoDaysAgo = now - 2 * 24 * 60 * 60_000L
        val result = formatTimestamp(twoDaysAgo)
        // Should be MMM dd HH:mm format
        assertTrue("Expected date format, got: $result", result.matches(Regex("[A-Z][a-z]{2} \\d{2} \\d{2}:\\d{2}")))
    }

    @Test
    fun `current timestamp formats without error`() {
        val result = formatTimestamp(System.currentTimeMillis())
        assertTrue(result.isNotEmpty())
    }
}
