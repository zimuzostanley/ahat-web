package com.ahat.heapdumper;

import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * RecyclerView adapter for the snapshot history list.
 * Supports multi-select (max 2) for diff comparison.
 */
public class SnapshotAdapter extends RecyclerView.Adapter<SnapshotAdapter.ViewHolder> {

    public interface OnClickListener { void onClick(Snapshot snapshot); }
    public interface OnLongClickListener { void onLongClick(Snapshot snapshot); }
    public interface OnSelectionChangedListener { void onSelectionChanged(int count); }

    private List<Snapshot> snapshots = new ArrayList<>();
    private final Set<Long> selectedTimestamps = new HashSet<>();
    private OnClickListener clickListener;
    private OnLongClickListener longClickListener;
    private OnSelectionChangedListener selectionListener;

    public void setOnClickListener(OnClickListener l) { this.clickListener = l; }
    public void setOnLongClickListener(OnLongClickListener l) { this.longClickListener = l; }
    public void setOnSelectionChangedListener(OnSelectionChangedListener l) { this.selectionListener = l; }

    public void setSnapshots(List<Snapshot> list) {
        this.snapshots = new ArrayList<>(list);
        selectedTimestamps.clear();
        notifyDataSetChanged();
        if (selectionListener != null) selectionListener.onSelectionChanged(0);
    }

    public boolean isSelected(Snapshot s) {
        return selectedTimestamps.contains(s.timestamp);
    }

    public void toggleSelection(Snapshot s) {
        if (selectedTimestamps.contains(s.timestamp)) {
            selectedTimestamps.remove(s.timestamp);
        } else {
            if (selectedTimestamps.size() >= 2) {
                // Remove the oldest selection
                selectedTimestamps.clear();
            }
            selectedTimestamps.add(s.timestamp);
        }
        notifyDataSetChanged();
        if (selectionListener != null) selectionListener.onSelectionChanged(selectedTimestamps.size());
    }

    public List<Snapshot> getSelectedSnapshots() {
        List<Snapshot> result = new ArrayList<>();
        for (Snapshot s : snapshots) {
            if (selectedTimestamps.contains(s.timestamp)) result.add(s);
        }
        return result;
    }

    @NonNull
    @Override
    public ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View v = LayoutInflater.from(parent.getContext())
                .inflate(R.layout.item_snapshot, parent, false);
        return new ViewHolder(v);
    }

    @Override
    public void onBindViewHolder(@NonNull ViewHolder holder, int position) {
        Snapshot s = snapshots.get(position);
        boolean selected = selectedTimestamps.contains(s.timestamp);

        SimpleDateFormat sdf = new SimpleDateFormat("MMM d, HH:mm", Locale.US);
        holder.timestamp.setText(sdf.format(new Date(s.timestamp)));

        // Compute total PSS
        long totalPss = 0;
        for (Snapshot.ProcessSnapshot p : s.processes) totalPss += p.pssKb;
        String detail = s.processes.size() + " processes \u2022 PSS: "
                + ShellHelper.formatKb(totalPss) + " total";
        holder.detail.setText(detail);

        // Selection indicator: blue left bar
        holder.selectionBar.setBackgroundColor(selected ? 0xFF3b82f6 : 0x00000000);

        holder.itemView.setOnClickListener(v -> {
            if (clickListener != null) clickListener.onClick(s);
        });
        holder.itemView.setOnLongClickListener(v -> {
            if (longClickListener != null) {
                longClickListener.onLongClick(s);
                return true;
            }
            return false;
        });
    }

    @Override
    public int getItemCount() { return snapshots.size(); }

    static class ViewHolder extends RecyclerView.ViewHolder {
        final View selectionBar;
        final TextView timestamp, detail;

        ViewHolder(View v) {
            super(v);
            selectionBar = v.findViewById(R.id.selectionBar);
            timestamp = v.findViewById(R.id.snapshotTimestamp);
            detail = v.findViewById(R.id.snapshotDetail);
        }
    }
}
