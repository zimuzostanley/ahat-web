package com.ahat.heapdumper;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** Persists Snapshot objects as JSON files in app internal storage. */
public class SnapshotStore {
    private static final String DIR_NAME = "snapshots";

    private static File dir(Context ctx) {
        File d = new File(ctx.getFilesDir(), DIR_NAME);
        if (!d.exists()) d.mkdirs();
        return d;
    }

    private static File fileFor(Context ctx, long timestamp) {
        return new File(dir(ctx), "snapshot_" + timestamp + ".json");
    }

    /** Save a snapshot to disk. */
    public static void save(Context ctx, Snapshot snapshot) throws JSONException, IOException {
        JSONObject root = new JSONObject();
        root.put("timestamp", snapshot.timestamp);
        root.put("enriched", snapshot.enriched);
        if (snapshot.memTotalKb > 0) {
            root.put("memTotalKb", snapshot.memTotalKb);
            root.put("memAvailableKb", snapshot.memAvailableKb);
            root.put("memFreeKb", snapshot.memFreeKb);
            root.put("swapTotalKb", snapshot.swapTotalKb);
            root.put("swapFreeKb", snapshot.swapFreeKb);
        }
        JSONArray procs = new JSONArray();
        for (Snapshot.ProcessSnapshot ps : snapshot.processes) {
            JSONObject obj = new JSONObject();
            obj.put("name", ps.name);
            obj.put("oomLabel", ps.oomLabel);
            obj.put("pid", ps.pid);
            obj.put("pssKb", ps.pssKb);
            obj.put("rssKb", ps.rssKb);
            obj.put("javaHeapKb", ps.javaHeapKb);
            obj.put("nativeHeapKb", ps.nativeHeapKb);
            obj.put("codeKb", ps.codeKb);
            obj.put("graphicsKb", ps.graphicsKb);
            obj.put("enriched", ps.enriched);
            if (ps.lastSeenMs > 0) obj.put("lastSeenMs", ps.lastSeenMs);
            if (ps.lastChangedMs > 0) obj.put("lastChangedMs", ps.lastChangedMs);
            procs.put(obj);
        }
        root.put("processes", procs);

        byte[] data = root.toString().getBytes(StandardCharsets.UTF_8);
        try (FileOutputStream fos = new FileOutputStream(fileFor(ctx, snapshot.timestamp))) {
            fos.write(data);
        }
    }

    /** Load metadata (timestamp + process count) for all snapshots, newest first. */
    public static List<Snapshot> loadAll(Context ctx) {
        List<Snapshot> result = new ArrayList<>();
        File[] files = dir(ctx).listFiles();
        if (files == null) return result;

        for (File f : files) {
            if (!f.getName().startsWith("snapshot_") || !f.getName().endsWith(".json")) continue;
            try {
                JSONObject root = readJson(f);
                result.add(parseSnapshot(root));
            } catch (JSONException | IOException e) {
                // Skip corrupt files
            }
        }
        Collections.sort(result, (a, b) -> Long.compare(b.timestamp, a.timestamp));
        return result;
    }

    /** Load a full snapshot by timestamp. Returns null if not found. */
    public static Snapshot load(Context ctx, long timestamp) {
        File f = fileFor(ctx, timestamp);
        if (!f.exists()) return null;
        try {
            JSONObject root = readJson(f);
            return parseSnapshot(root);
        } catch (JSONException | IOException e) {
            return null;
        }
    }

    /** Delete a single snapshot. */
    public static void delete(Context ctx, long timestamp) {
        File f = fileFor(ctx, timestamp);
        if (f.exists()) f.delete();
    }

    /** Delete all snapshots. */
    public static void deleteAll(Context ctx) {
        File[] files = dir(ctx).listFiles();
        if (files == null) return;
        for (File f : files) f.delete();
    }

    /** Count snapshots on disk. */
    public static int count(Context ctx) {
        File[] files = dir(ctx).listFiles();
        return files != null ? files.length : 0;
    }

    private static JSONObject readJson(File f) throws IOException, JSONException {
        byte[] data;
        try (FileInputStream fis = new FileInputStream(f)) {
            data = new byte[(int) f.length()];
            fis.read(data);
        }
        return new JSONObject(new String(data, StandardCharsets.UTF_8));
    }

    private static Snapshot parseSnapshot(JSONObject root) throws JSONException {
        long ts = root.getLong("timestamp");
        boolean enriched = root.optBoolean("enriched", true); // backwards compat
        JSONArray arr = root.getJSONArray("processes");
        List<Snapshot.ProcessSnapshot> procs = new ArrayList<>();
        for (int i = 0; i < arr.length(); i++) {
            JSONObject obj = arr.getJSONObject(i);
            procs.add(new Snapshot.ProcessSnapshot(
                    obj.getString("name"),
                    obj.optString("oomLabel", ""),
                    obj.getInt("pid"),
                    obj.getLong("pssKb"),
                    obj.getLong("rssKb"),
                    obj.getLong("javaHeapKb"),
                    obj.getLong("nativeHeapKb"),
                    obj.getLong("codeKb"),
                    obj.getLong("graphicsKb"),
                    obj.optBoolean("enriched", true),
                    obj.optLong("lastSeenMs", 0),
                    obj.optLong("lastChangedMs", 0)));
        }
        Snapshot snap = new Snapshot(ts, enriched, procs);
        snap.memTotalKb = root.optLong("memTotalKb", 0);
        snap.memAvailableKb = root.optLong("memAvailableKb", 0);
        snap.memFreeKb = root.optLong("memFreeKb", 0);
        snap.swapTotalKb = root.optLong("swapTotalKb", 0);
        snap.swapFreeKb = root.optLong("swapFreeKb", 0);
        return snap;
    }
}
