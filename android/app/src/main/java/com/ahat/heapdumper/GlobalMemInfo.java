package com.ahat.heapdumper;

import java.io.BufferedReader;
import java.io.FileReader;
import java.io.IOException;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** System-wide memory info from /proc/meminfo. No permissions needed. */
public class GlobalMemInfo {
    public long memTotalKb;
    public long memFreeKb;
    public long memAvailableKb;
    public long buffersKb;
    public long cachedKb;
    public long swapTotalKb;
    public long swapFreeKb;

    public long usedKb() { return memTotalKb - memFreeKb; }
    public long swapUsedKb() { return swapTotalKb - swapFreeKb; }
    public int usedPercent() {
        return memTotalKb > 0 ? (int) ((usedKb() * 100) / memTotalKb) : 0;
    }

    /** Read /proc/meminfo directly — no shell, no permissions. */
    public static GlobalMemInfo read() {
        try (BufferedReader br = new BufferedReader(new FileReader("/proc/meminfo"))) {
            return parse(br);
        } catch (IOException e) {
            return new GlobalMemInfo();
        }
    }

    /** Parse from a BufferedReader — testable with StringReader. */
    static GlobalMemInfo parse(BufferedReader br) throws IOException {
        GlobalMemInfo info = new GlobalMemInfo();
        Pattern p = Pattern.compile("^(\\w+):\\s+(\\d+)\\s+kB");
        String line;
        while ((line = br.readLine()) != null) {
            Matcher m = p.matcher(line);
            if (!m.find()) continue;
            long val = Long.parseLong(m.group(2));
            switch (m.group(1)) {
                case "MemTotal":     info.memTotalKb = val; break;
                case "MemFree":      info.memFreeKb = val; break;
                case "MemAvailable": info.memAvailableKb = val; break;
                case "Buffers":      info.buffersKb = val; break;
                case "Cached":       info.cachedKb = val; break;
                case "SwapTotal":    info.swapTotalKb = val; break;
                case "SwapFree":     info.swapFreeKb = val; break;
            }
        }
        // MemAvailable was added in Linux 3.14; approximate if missing
        if (info.memAvailableKb == 0 && info.memTotalKb > 0) {
            info.memAvailableKb = info.memFreeKb + info.buffersKb + info.cachedKb;
        }
        return info;
    }

    /** Compact summary string for display. */
    public String summary() {
        StringBuilder sb = new StringBuilder();
        sb.append("RAM: ").append(formatGb(usedKb())).append(" / ").append(formatGb(memTotalKb));
        sb.append(" (").append(usedPercent()).append("%)");
        sb.append("  Avail: ").append(formatGb(memAvailableKb));
        if (swapTotalKb > 0) {
            sb.append("  Swap: ").append(formatGb(swapUsedKb()))
              .append(" / ").append(formatGb(swapTotalKb));
        }
        return sb.toString();
    }

    private static String formatGb(long kb) {
        if (kb < 1024) return kb + " KB";
        if (kb < 1024 * 1024) return String.format("%.0f MB", kb / 1024.0);
        return String.format("%.1f GB", kb / (1024.0 * 1024.0));
    }
}
