package com.ahat.heapdumper;

import java.io.Serializable;

/** Parsed output from `dumpsys meminfo <pid>`. */
public class MemInfo implements Serializable {
    public long totalPssKb;
    public long totalRssKb;
    public long javaHeapKb;
    public long nativeHeapKb;
    public long codeKb;
    public long stackKb;
    public long graphicsKb;
    public long systemKb;
    public long totalSwapKb;
}
