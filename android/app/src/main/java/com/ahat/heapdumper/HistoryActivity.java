package com.ahat.heapdumper;

import android.content.Intent;
import android.os.Bundle;
import android.widget.TextView;

import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

public class HistoryActivity extends AppCompatActivity {

    private SnapshotAdapter adapter;
    private TextView btnCompare;
    private final List<Snapshot> snapshots = new ArrayList<>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_history);

        findViewById(R.id.btnBack).setOnClickListener(v -> finish());

        btnCompare = findViewById(R.id.btnCompare);
        btnCompare.setEnabled(false);
        btnCompare.setAlpha(0.4f);
        btnCompare.setOnClickListener(v -> openDiff());

        RecyclerView recycler = findViewById(R.id.recyclerView);
        recycler.setLayoutManager(new LinearLayoutManager(this));

        adapter = new SnapshotAdapter();
        adapter.setOnClickListener(this::viewSnapshot);
        adapter.setOnLongClickListener(this::showOptions);
        adapter.setOnSelectionChangedListener(count -> {
            btnCompare.setEnabled(count == 2);
            btnCompare.setAlpha(count == 2 ? 1.0f : 0.4f);
            btnCompare.setText("Compare (" + count + ")");
        });
        recycler.setAdapter(adapter);

        loadSnapshots();
    }

    @Override
    protected void onResume() {
        super.onResume();
        loadSnapshots();
    }

    private void loadSnapshots() {
        snapshots.clear();
        snapshots.addAll(SnapshotStore.loadAll(this));
        adapter.setSnapshots(snapshots);

        TextView statusText = findViewById(R.id.statusText);
        statusText.setText(snapshots.size() + " snapshot" + (snapshots.size() != 1 ? "s" : ""));
    }

    private void viewSnapshot(Snapshot snapshot) {
        Intent intent = new Intent(this, MainActivity.class);
        intent.putExtra("snapshot_timestamp", snapshot.timestamp);
        startActivity(intent);
    }

    private void showOptions(Snapshot snapshot) {
        boolean isSelected = adapter.isSelected(snapshot);
        String toggleLabel = isSelected ? "Deselect" : "Select for diff";
        new AlertDialog.Builder(this)
                .setItems(new String[]{toggleLabel, "Delete"}, (d, which) -> {
                    if (which == 0) {
                        adapter.toggleSelection(snapshot);
                    } else {
                        confirmDelete(snapshot);
                    }
                })
                .show();
    }

    private void confirmDelete(Snapshot snapshot) {
        SimpleDateFormat sdf = new SimpleDateFormat("MMM d, HH:mm", Locale.US);
        new AlertDialog.Builder(this)
                .setTitle("Delete snapshot?")
                .setMessage(sdf.format(new Date(snapshot.timestamp)))
                .setPositiveButton("Delete", (d, w) -> {
                    SnapshotStore.delete(this, snapshot.timestamp);
                    loadSnapshots();
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    private void openDiff() {
        List<Snapshot> selected = adapter.getSelectedSnapshots();
        if (selected.size() != 2) return;
        Snapshot a = selected.get(0).timestamp < selected.get(1).timestamp
                ? selected.get(0) : selected.get(1);
        Snapshot b = selected.get(0).timestamp < selected.get(1).timestamp
                ? selected.get(1) : selected.get(0);

        Intent intent = new Intent(this, DiffActivity.class);
        intent.putExtra("timestamp_a", a.timestamp);
        intent.putExtra("timestamp_b", b.timestamp);
        startActivity(intent);
    }
}
