package com.ahat.heapdumper;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.List;

/** A point-in-time memory snapshot of all processes. */
public class Snapshot implements Serializable {
    public final long timestamp;
    public final boolean enriched;
    public final List<ProcessSnapshot> processes;

    public Snapshot(long timestamp, boolean enriched, List<ProcessSnapshot> processes) {
        this.timestamp = timestamp;
        this.enriched = enriched;
        this.processes = processes;
    }

    /** Create a snapshot from enriched ProcessInfo entries only (ignores non-enriched). */
    public static Snapshot fromProcessList(List<ProcessInfo> list) {
        List<ProcessSnapshot> procs = new ArrayList<>();
        for (ProcessInfo pi : list) {
            if (pi.enriched) {
                procs.add(ProcessSnapshot.from(pi));
            }
        }
        return new Snapshot(System.currentTimeMillis(), true, procs);
    }

    /** Create a lightweight snapshot of ALL processes (enriched or not). */
    public static Snapshot fromProcessListAll(List<ProcessInfo> list) {
        List<ProcessSnapshot> procs = new ArrayList<>();
        for (ProcessInfo pi : list) {
            procs.add(ProcessSnapshot.from(pi));
        }
        boolean hasEnriched = false;
        for (ProcessInfo pi : list) {
            if (pi.enriched) { hasEnriched = true; break; }
        }
        return new Snapshot(System.currentTimeMillis(), hasEnriched, procs);
    }

    /** Per-process data within a snapshot. */
    public static class ProcessSnapshot implements Serializable {
        public final String name;
        public final String oomLabel;
        public final int pid;
        public final long pssKb;
        public final long rssKb;
        public final long javaHeapKb;
        public final long nativeHeapKb;
        public final long codeKb;
        public final long graphicsKb;
        public final boolean enriched;
        public final long lastSeenMs;
        public final long lastChangedMs;

        public ProcessSnapshot(String name, String oomLabel, int pid,
                               long pssKb, long rssKb, long javaHeapKb,
                               long nativeHeapKb, long codeKb, long graphicsKb,
                               boolean enriched, long lastSeenMs, long lastChangedMs) {
            this.name = name;
            this.oomLabel = oomLabel;
            this.pid = pid;
            this.pssKb = pssKb;
            this.rssKb = rssKb;
            this.javaHeapKb = javaHeapKb;
            this.nativeHeapKb = nativeHeapKb;
            this.codeKb = codeKb;
            this.graphicsKb = graphicsKb;
            this.enriched = enriched;
            this.lastSeenMs = lastSeenMs;
            this.lastChangedMs = lastChangedMs;
        }

        /** Convenience constructor (no timestamps, assumes enriched). */
        public ProcessSnapshot(String name, String oomLabel, int pid,
                               long pssKb, long rssKb, long javaHeapKb,
                               long nativeHeapKb, long codeKb, long graphicsKb,
                               boolean enriched) {
            this(name, oomLabel, pid, pssKb, rssKb, javaHeapKb,
                    nativeHeapKb, codeKb, graphicsKb, enriched, 0, 0);
        }

        /** Convenience constructor for backwards compat (assumes enriched). */
        public ProcessSnapshot(String name, String oomLabel, int pid,
                               long pssKb, long rssKb, long javaHeapKb,
                               long nativeHeapKb, long codeKb, long graphicsKb) {
            this(name, oomLabel, pid, pssKb, rssKb, javaHeapKb,
                    nativeHeapKb, codeKb, graphicsKb, true, 0, 0);
        }

        static ProcessSnapshot from(ProcessInfo pi) {
            return new ProcessSnapshot(pi.name, pi.oomLabel, pi.pid,
                    pi.pssKb, pi.rssKb, pi.javaHeapKb,
                    pi.nativeHeapKb, pi.codeKb, pi.graphicsKb, pi.enriched,
                    pi.lastSeenMs, pi.lastChangedMs);
        }

        /** Convert back to ProcessInfo for display in main view. */
        public ProcessInfo toProcessInfo() {
            ProcessInfo p = new ProcessInfo(pid, name, oomLabel);
            p.lastSeenMs = lastSeenMs;
            p.lastChangedMs = lastChangedMs;
            if (enriched) {
                p.pssKb = pssKb;
                p.rssKb = rssKb;
                p.javaHeapKb = javaHeapKb;
                p.nativeHeapKb = nativeHeapKb;
                p.codeKb = codeKb;
                p.graphicsKb = graphicsKb;
                p.enriched = true;
            }
            return p;
        }
    }
}
