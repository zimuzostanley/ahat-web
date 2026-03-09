package com.ahat.heapdumper;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Shell-based process listing and heap dumping — mirrors the TypeScript
 * AdbConnection logic from src/adb/capture.ts but runs on-device.
 */
public class ShellHelper {

    // Same regex as TypeScript: LRU_LINE = /^\s*#\d+:\s+(\S+)\s+.*?\s(\d+):([^\s/]+)/
    private static final Pattern LRU_LINE =
            Pattern.compile("^\\s*#\\d+:\\s+(\\S+)\\s+.*?\\s(\\d+):([^\\s/]+)");

    // OOM label map — same as TypeScript OOM_LABEL_MAP
    private static final Map<String, String> OOM_LABEL_MAP = new HashMap<>();
    static {
        OOM_LABEL_MAP.put("pers", "Persistent");
        OOM_LABEL_MAP.put("top", "Top");
        OOM_LABEL_MAP.put("bfgs", "Bound FG");
        OOM_LABEL_MAP.put("btop", "Bound Top");
        OOM_LABEL_MAP.put("fgs", "FG Service");
        OOM_LABEL_MAP.put("fg", "Foreground");
        OOM_LABEL_MAP.put("impfg", "Imp FG");
        OOM_LABEL_MAP.put("impbg", "Imp BG");
        OOM_LABEL_MAP.put("backup", "Backup");
        OOM_LABEL_MAP.put("service", "Service");
        OOM_LABEL_MAP.put("service-rs", "Svc Restart");
        OOM_LABEL_MAP.put("receiver", "Receiver");
        OOM_LABEL_MAP.put("heavy", "Heavy");
        OOM_LABEL_MAP.put("home", "Home");
        OOM_LABEL_MAP.put("lastact", "Last Activity");
        OOM_LABEL_MAP.put("cached", "Cached");
        OOM_LABEL_MAP.put("cch", "Cached");
        OOM_LABEL_MAP.put("frzn", "Frozen");
        OOM_LABEL_MAP.put("native", "Native");
        OOM_LABEL_MAP.put("sys", "System");
        OOM_LABEL_MAP.put("fore", "Foreground");
        OOM_LABEL_MAP.put("vis", "Visible");
        OOM_LABEL_MAP.put("percep", "Perceptible");
        OOM_LABEL_MAP.put("svcb", "Service B");
        OOM_LABEL_MAP.put("svcrst", "Svc Restart");
        OOM_LABEL_MAP.put("prev", "Previous");
        OOM_LABEL_MAP.put("lstact", "Last Activity");
    }

    private static String mapOomLabel(String raw) {
        // Strip trailing digits: "cch1" -> "cch", strip "+N" suffix: "cch+75" -> "cch"
        String base = raw.replaceAll("\\+\\d+$", "").replaceAll("\\d+$", "");
        String mapped = OOM_LABEL_MAP.get(base);
        return mapped != null ? mapped : raw;
    }

    /** Run a shell command and return stdout. */
    public static String exec(String... cmd) throws Exception {
        ProcessBuilder pb = new ProcessBuilder(cmd);
        pb.redirectErrorStream(true);
        Process proc = pb.start();
        StringBuilder sb = new StringBuilder();
        try (BufferedReader br = new BufferedReader(new InputStreamReader(proc.getInputStream()))) {
            String line;
            while ((line = br.readLine()) != null) {
                sb.append(line).append('\n');
            }
        }
        proc.waitFor();
        return sb.toString();
    }

    /**
     * Parse `dumpsys activity lru` output — same logic as TypeScript parseLruProcesses.
     */
    public static List<ProcessInfo> parseLruProcesses(String output) {
        List<ProcessInfo> results = new ArrayList<>();
        Set<Integer> seen = new HashSet<>();

        for (String line : output.split("\n")) {
            Matcher m = LRU_LINE.matcher(line);
            if (!m.find()) continue;
            int pid;
            try {
                pid = Integer.parseInt(m.group(2));
            } catch (NumberFormatException e) {
                continue;
            }
            if (seen.contains(pid)) continue;
            seen.add(pid);

            String oomRaw = m.group(1).replaceAll("\\+\\d+$", "");
            results.add(new ProcessInfo(pid, m.group(3), mapOomLabel(oomRaw)));
        }
        return results;
    }

    /** Get Java process list from dumpsys activity lru. */
    public static List<ProcessInfo> getProcessList() throws Exception {
        String output = exec("dumpsys", "activity", "lru");
        List<ProcessInfo> list = parseLruProcesses(output);

        // Add pinned system processes if not already present
        Set<Integer> pids = new HashSet<>();
        for (ProcessInfo p : list) pids.add(p.pid);

        for (String name : new String[]{"system_server", "com.android.systemui"}) {
            try {
                String pidStr = exec("pidof", name).trim();
                if (pidStr.isEmpty()) continue;
                int pid = Integer.parseInt(pidStr.split("\\s+")[0]);
                if (!pids.contains(pid)) {
                    list.add(0, new ProcessInfo(pid, name, "System"));
                }
            } catch (Exception ignored) {}
        }
        return list;
    }

    /**
     * Trigger heap dump and wait for it to complete.
     * Same approach as TypeScript: am dumpheap, then poll file size until stable.
     *
     * @return path to the .hprof file on device
     */
    public static String dumpHeap(int pid, ProgressCallback callback) throws Exception {
        String ts = String.valueOf(System.currentTimeMillis());
        String remotePath = "/data/local/tmp/ahat_" + pid + "_" + ts + ".hprof";

        // Trigger dump
        callback.onProgress("Dumping heap for PID " + pid + "...");
        exec("am", "dumpheap", pid + "", remotePath);

        // Poll file size until stable (same logic as TypeScript)
        long lastSize = -1;
        int stableCount = 0;
        for (int i = 0; i < 120; i++) {
            Thread.sleep(500);
            callback.onProgress("Waiting for dump... " + (i / 2) + "s");

            long size;
            try {
                String out = exec("stat", "-c", "%s", remotePath);
                size = Long.parseLong(out.trim());
            } catch (Exception e) {
                size = -1;
            }

            if (size <= 0) {
                stableCount = 0;
                lastSize = -1;
                continue;
            }

            if (size == lastSize) {
                stableCount++;
                if (stableCount >= 3) break; // 1.5s stable = done
            } else {
                stableCount = 0;
                lastSize = size;
            }
        }

        if (lastSize <= 0) {
            throw new Exception("Heap dump failed: file not created");
        }

        callback.onProgress("Dump complete (" + (lastSize / 1024) + " KB)");
        return remotePath;
    }

    public interface ProgressCallback {
        void onProgress(String message);
    }
}
