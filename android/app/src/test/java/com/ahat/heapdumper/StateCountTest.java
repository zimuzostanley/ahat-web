package com.ahat.heapdumper;

import org.junit.Test;
import static org.junit.Assert.*;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.ArrayList;

public class StateCountTest {

    @Test
    public void basicCounts() {
        List<ProcessInfo> procs = Arrays.asList(
                new ProcessInfo(1, "a", "Top"),
                new ProcessInfo(2, "b", "Top"),
                new ProcessInfo(3, "c", "Cached"),
                new ProcessInfo(4, "d", "Cached"),
                new ProcessInfo(5, "e", "Cached"),
                new ProcessInfo(6, "f", "FG Service"));

        LinkedHashMap<String, Integer> counts =
                ProcessAdapter.computeStateCounts(procs, "");

        assertEquals(Integer.valueOf(3), counts.get("Cached"));
        assertEquals(Integer.valueOf(2), counts.get("Top"));
        assertEquals(Integer.valueOf(1), counts.get("FG Service"));
    }

    @Test
    public void sortedByCountDescending() {
        List<ProcessInfo> procs = Arrays.asList(
                new ProcessInfo(1, "a", "Top"),
                new ProcessInfo(2, "b", "Cached"),
                new ProcessInfo(3, "c", "Cached"),
                new ProcessInfo(4, "d", "Cached"),
                new ProcessInfo(5, "e", "FG Service"),
                new ProcessInfo(6, "f", "FG Service"));

        LinkedHashMap<String, Integer> counts =
                ProcessAdapter.computeStateCounts(procs, "");

        // First entry should be highest count
        String firstKey = counts.keySet().iterator().next();
        assertEquals("Cached", firstKey);
    }

    @Test
    public void textFilterApplied() {
        List<ProcessInfo> procs = Arrays.asList(
                new ProcessInfo(1, "com.google.app", "Top"),
                new ProcessInfo(2, "com.google.maps", "Cached"),
                new ProcessInfo(3, "com.example.app", "Cached"));

        LinkedHashMap<String, Integer> counts =
                ProcessAdapter.computeStateCounts(procs, "google");

        // Only 2 processes match "google"
        int total = 0;
        for (int c : counts.values()) total += c;
        assertEquals(2, total);
        assertEquals(Integer.valueOf(1), counts.get("Top"));
        assertEquals(Integer.valueOf(1), counts.get("Cached"));
    }

    @Test
    public void textFilterByPid() {
        List<ProcessInfo> procs = Arrays.asList(
                new ProcessInfo(1234, "com.app", "Top"),
                new ProcessInfo(5678, "com.other", "Cached"));

        LinkedHashMap<String, Integer> counts =
                ProcessAdapter.computeStateCounts(procs, "1234");

        assertEquals(1, counts.size());
        assertEquals(Integer.valueOf(1), counts.get("Top"));
    }

    @Test
    public void textFilterByOomLabel() {
        List<ProcessInfo> procs = Arrays.asList(
                new ProcessInfo(1, "a", "Top"),
                new ProcessInfo(2, "b", "Cached"),
                new ProcessInfo(3, "c", "Cached"));

        LinkedHashMap<String, Integer> counts =
                ProcessAdapter.computeStateCounts(procs, "cached");

        assertEquals(1, counts.size());
        assertEquals(Integer.valueOf(2), counts.get("Cached"));
    }

    @Test
    public void emptyListReturnsEmptyMap() {
        LinkedHashMap<String, Integer> counts =
                ProcessAdapter.computeStateCounts(new ArrayList<>(), "");
        assertTrue(counts.isEmpty());
    }

    @Test
    public void nullFilterTreatedAsEmpty() {
        List<ProcessInfo> procs = Arrays.asList(
                new ProcessInfo(1, "a", "Top"));

        LinkedHashMap<String, Integer> counts =
                ProcessAdapter.computeStateCounts(procs, null);

        assertEquals(Integer.valueOf(1), counts.get("Top"));
    }
}
