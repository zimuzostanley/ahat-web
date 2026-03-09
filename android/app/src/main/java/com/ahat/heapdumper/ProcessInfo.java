package com.ahat.heapdumper;

/** Minimal process info matching the TypeScript ProcessInfo shape. */
public class ProcessInfo {
    public final int pid;
    public final String name;
    public final String oomLabel;

    public ProcessInfo(int pid, String name, String oomLabel) {
        this.pid = pid;
        this.name = name;
        this.oomLabel = oomLabel;
    }
}
