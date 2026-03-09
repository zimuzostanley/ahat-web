package com.ahat.heapdumper;

import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Process detail screen: shows `dumpsys meminfo <pid>` breakdown,
 * with buttons to dump heap (with or without bitmaps).
 */
public class DetailActivity extends AppCompatActivity {

    private ProcessInfo process;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_detail);

        process = (ProcessInfo) getIntent().getSerializableExtra("process");
        if (process == null) { finish(); return; }

        TextView nameView = findViewById(R.id.detailName);
        TextView pidView = findViewById(R.id.detailPid);
        TextView badge = findViewById(R.id.detailBadge);

        nameView.setText(process.name);
        pidView.setText("PID " + process.pid + " \u2022 " + process.oomLabel);
        badge.setText(process.oomLabel);

        int badgeColor = ProcessAdapter.getBadgeColor(process.oomLabel);
        GradientDrawable bg = new GradientDrawable();
        bg.setShape(GradientDrawable.RECTANGLE);
        bg.setCornerRadius(8f);
        bg.setColor(badgeColor);
        badge.setPadding(16, 6, 16, 6);
        badge.setBackground(bg);

        findViewById(R.id.btnBack).setOnClickListener(v -> finish());
        findViewById(R.id.btnDump).setOnClickListener(v -> startDump(false));
        findViewById(R.id.btnDumpBitmap).setOnClickListener(v -> startDump(true));

        loadMemInfo();
    }

    private void loadMemInfo() {
        executor.execute(() -> {
            try {
                MemInfo info = ShellHelper.getMemInfo(process.pid);
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    showMemInfo(info);
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    TextView loading = findViewById(R.id.meminfoLoading);
                    loading.setText("Failed: " + e.getMessage());
                });
            }
        });
    }

    private void showMemInfo(MemInfo info) {
        findViewById(R.id.meminfoLoading).setVisibility(View.GONE);
        LinearLayout grid = findViewById(R.id.meminfoGrid);
        grid.setVisibility(View.VISIBLE);

        addRow(grid, "Total PSS", ShellHelper.formatKb(info.totalPssKb));
        if (info.totalRssKb > 0) addRow(grid, "Total RSS", ShellHelper.formatKb(info.totalRssKb));
        addRow(grid, "Java Heap", ShellHelper.formatKb(info.javaHeapKb));
        addRow(grid, "Native Heap", ShellHelper.formatKb(info.nativeHeapKb));
        addRow(grid, "Code", ShellHelper.formatKb(info.codeKb));
        addRow(grid, "Stack", ShellHelper.formatKb(info.stackKb));
        addRow(grid, "Graphics", ShellHelper.formatKb(info.graphicsKb));
        if (info.systemKb > 0) addRow(grid, "System", ShellHelper.formatKb(info.systemKb));
        if (info.totalSwapKb > 0) addRow(grid, "Swap PSS", ShellHelper.formatKb(info.totalSwapKb));
    }

    private void addRow(LinearLayout parent, String label, String value) {
        View row = LayoutInflater.from(this).inflate(R.layout.item_meminfo_row, parent, false);
        ((TextView) row.findViewById(R.id.rowLabel)).setText(label);
        ((TextView) row.findViewById(R.id.rowValue)).setText(value);
        parent.addView(row);
    }

    private void startDump(boolean withBitmaps) {
        LinearLayout buttons = (LinearLayout) findViewById(R.id.btnDump).getParent();
        buttons.setVisibility(View.GONE);
        FrameLayout progress = findViewById(R.id.progressContainer);
        TextView progressText = findViewById(R.id.progressText);
        progress.setVisibility(View.VISIBLE);
        progressText.setText("Starting dump\u2026");

        executor.execute(() -> {
            try {
                String path = ShellHelper.dumpHeap(process.pid, withBitmaps,
                        msg -> runOnUiThread(() -> {
                            if (!(isFinishing() || isDestroyed())) progressText.setText(msg);
                        }));

                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    progress.setVisibility(View.GONE);
                    Intent intent = new Intent(this, ViewerActivity.class);
                    intent.putExtra("hprof_path", path);
                    intent.putExtra("process_name", process.name);
                    startActivity(intent);
                    finish();
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    progress.setVisibility(View.GONE);
                    buttons.setVisibility(View.VISIBLE);
                    new AlertDialog.Builder(this)
                            .setTitle("Dump failed")
                            .setMessage(e.getMessage())
                            .setPositiveButton("OK", null)
                            .show();
                });
            }
        });
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        executor.shutdownNow();
    }
}
