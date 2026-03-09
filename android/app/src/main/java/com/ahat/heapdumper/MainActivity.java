package com.ahat.heapdumper;

import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends AppCompatActivity {

    private ProcessAdapter adapter;
    private SwipeRefreshLayout swipeRefresh;
    private TextView statusText;
    private FrameLayout progressContainer;
    private TextView progressText;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        swipeRefresh = findViewById(R.id.swipeRefresh);
        statusText = findViewById(R.id.statusText);
        progressContainer = findViewById(R.id.progressContainer);
        progressText = findViewById(R.id.progressText);

        RecyclerView list = findViewById(R.id.processList);
        list.setLayoutManager(new LinearLayoutManager(this));
        adapter = new ProcessAdapter();
        list.setAdapter(adapter);

        adapter.setOnClickListener(this::onProcessClick);
        swipeRefresh.setOnRefreshListener(this::loadProcesses);
        swipeRefresh.setColorSchemeColors(0xFF3b82f6);

        loadProcesses();
    }

    private void loadProcesses() {
        swipeRefresh.setRefreshing(true);
        statusText.setText("Loading processes...");

        executor.execute(() -> {
            try {
                List<ProcessInfo> list = ShellHelper.getProcessList();
                runOnUiThread(() -> {
                    adapter.setProcesses(list);
                    statusText.setText(list.size() + " processes \u2022 pull to refresh");
                    swipeRefresh.setRefreshing(false);
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    statusText.setText("Error: " + e.getMessage());
                    swipeRefresh.setRefreshing(false);
                });
            }
        });
    }

    private void onProcessClick(ProcessInfo process) {
        new AlertDialog.Builder(this, com.google.android.material.R.style.ThemeOverlay_MaterialComponents_Dialog)
                .setTitle("Dump heap?")
                .setMessage(process.name + " (PID " + process.pid + ")")
                .setPositiveButton("Dump", (d, w) -> startDump(process))
                .setNegativeButton("Cancel", null)
                .show();
    }

    private void startDump(ProcessInfo process) {
        progressContainer.setVisibility(View.VISIBLE);
        progressText.setText("Starting dump...");

        executor.execute(() -> {
            try {
                String path = ShellHelper.dumpHeap(process.pid, msg ->
                        runOnUiThread(() -> progressText.setText(msg)));

                runOnUiThread(() -> {
                    progressContainer.setVisibility(View.GONE);
                    // Open viewer with the hprof file path
                    Intent intent = new Intent(this, ViewerActivity.class);
                    intent.putExtra("hprof_path", path);
                    intent.putExtra("process_name", process.name);
                    startActivity(intent);
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    progressContainer.setVisibility(View.GONE);
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
