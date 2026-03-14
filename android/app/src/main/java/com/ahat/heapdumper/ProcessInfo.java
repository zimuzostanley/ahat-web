package com.ahat.heapdumper;

import java.io.Serializable;

/** Process info from dumpsys activity lru, optionally enriched with meminfo. */
public class ProcessInfo implements Serializable {
    public final int pid;
    public final String name;
    public final String oomLabel;

    /** Timestamp of last fetch (millis). */
    public long lastSeenMs;
    /** Timestamp of last OOM state change (millis). 0 = first seen this session. */
    public long lastChangedMs;

    // Enriched by background meminfo (0 = not yet loaded)
    public long pssKb;
    public long rssKb;
    public long javaHeapKb;
    public long nativeHeapKb;
    public long codeKb;
    public long graphicsKb;
    public boolean enriched;

    public ProcessInfo(int pid, String name, String oomLabel) {
        this.pid = pid;
        this.name = name;
        this.oomLabel = oomLabel;
    }

    /** Apply meminfo data from background enrichment. */
    public void applyMemInfo(MemInfo info) {
        this.pssKb = info.totalPssKb;
        this.rssKb = info.totalRssKb;
        this.javaHeapKb = info.javaHeapKb;
        this.nativeHeapKb = info.nativeHeapKb;
        this.codeKb = info.codeKb;
        this.graphicsKb = info.graphicsKb;
        this.enriched = true;
    }
}
