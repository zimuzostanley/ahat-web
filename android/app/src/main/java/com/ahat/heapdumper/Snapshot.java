package com.ahat.heapdumper;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.List;

/** A point-in-time memory snapshot of all processes. */
public class Snapshot implements Serializable {
    public final long timestamp;
    public final List<ProcessSnapshot> processes;

    public Snapshot(long timestamp, List<ProcessSnapshot> processes) {
        this.timestamp = timestamp;
        this.processes = processes;
    }

    /** Create a snapshot from enriched ProcessInfo entries (ignores non-enriched). */
    public static Snapshot fromProcessList(List<ProcessInfo> list) {
        List<ProcessSnapshot> procs = new ArrayList<>();
        for (ProcessInfo pi : list) {
            if (pi.enriched) {
                procs.add(new ProcessSnapshot(
                        pi.name, pi.oomLabel, pi.pid,
                        pi.pssKb, pi.rssKb, pi.javaHeapKb,
                        pi.nativeHeapKb, pi.codeKb, pi.graphicsKb));
            }
        }
        return new Snapshot(System.currentTimeMillis(), procs);
    }

    /** Per-process memory data within a snapshot. */
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

        public ProcessSnapshot(String name, String oomLabel, int pid,
                               long pssKb, long rssKb, long javaHeapKb,
                               long nativeHeapKb, long codeKb, long graphicsKb) {
            this.name = name;
            this.oomLabel = oomLabel;
            this.pid = pid;
            this.pssKb = pssKb;
            this.rssKb = rssKb;
            this.javaHeapKb = javaHeapKb;
            this.nativeHeapKb = nativeHeapKb;
            this.codeKb = codeKb;
            this.graphicsKb = graphicsKb;
        }
    }
}
