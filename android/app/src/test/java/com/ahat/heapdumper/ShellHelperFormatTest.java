package com.ahat.heapdumper;

import org.junit.Test;
import static org.junit.Assert.*;

public class ShellHelperFormatTest {

    // ── formatKb ────────────────────────────────────────────────────────────────

    @Test
    public void formatKbZero() {
        assertEquals("0 KB", ShellHelper.formatKb(0));
    }

    @Test
    public void formatKbSmallValue() {
        assertEquals("512 KB", ShellHelper.formatKb(512));
    }

    @Test
    public void formatKbBoundary() {
        assertEquals("1023 KB", ShellHelper.formatKb(1023));
    }

    @Test
    public void formatKbExactlyOneMb() {
        assertEquals("1.0 MB", ShellHelper.formatKb(1024));
    }

    @Test
    public void formatKbLargeValue() {
        assertEquals("256.0 MB", ShellHelper.formatKb(262144)); // 256 * 1024
    }

    @Test
    public void formatKbFractionalMb() {
        assertEquals("1.5 MB", ShellHelper.formatKb(1536)); // 1.5 * 1024
    }

    @Test
    public void formatKbNegativeSmall() {
        assertEquals("-500 KB", ShellHelper.formatKb(-500));
    }

    @Test
    public void formatKbNegativeLarge() {
        // Bug fix verification: -2048 KB = -2.0 MB, not "-2048 KB"
        assertEquals("-2.0 MB", ShellHelper.formatKb(-2048));
    }

    @Test
    public void formatKbNegativeBoundary() {
        assertEquals("-1023 KB", ShellHelper.formatKb(-1023));
        assertEquals("-1.0 MB", ShellHelper.formatKb(-1024));
    }

    @Test
    public void formatKbOne() {
        assertEquals("1 KB", ShellHelper.formatKb(1));
    }

    // ── formatSize ──────────────────────────────────────────────────────────────

    @Test
    public void formatSizeZeroBytes() {
        assertEquals("0 B", ShellHelper.formatSize(0));
    }

    @Test
    public void formatSizeSmallBytes() {
        assertEquals("100 B", ShellHelper.formatSize(100));
    }

    @Test
    public void formatSizeBoundaryBytes() {
        assertEquals("1023 B", ShellHelper.formatSize(1023));
    }

    @Test
    public void formatSizeExactlyOneKb() {
        assertEquals("1.0 KB", ShellHelper.formatSize(1024));
    }

    @Test
    public void formatSizeKb() {
        assertEquals("512.0 KB", ShellHelper.formatSize(524288)); // 512 * 1024
    }

    @Test
    public void formatSizeBoundaryKb() {
        // 1024 * 1024 - 1 = 1048575
        assertEquals("1024.0 KB", ShellHelper.formatSize(1048575));
    }

    @Test
    public void formatSizeExactlyOneMb() {
        assertEquals("1.0 MB", ShellHelper.formatSize(1048576));
    }

    @Test
    public void formatSizeLargeMb() {
        assertEquals("182.5 MB", ShellHelper.formatSize(191365120L)); // 182.5 * 1024 * 1024
    }

    @Test
    public void formatSizeOneGbInMb() {
        assertEquals("1024.0 MB", ShellHelper.formatSize(1073741824L)); // 1 GB
    }
}
