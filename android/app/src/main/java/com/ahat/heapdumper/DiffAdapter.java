package com.ahat.heapdumper;

import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import java.util.ArrayList;
import java.util.List;

/**
 * RecyclerView adapter for the diff view. Shows per-process memory comparison
 * with colored deltas: red for increase, green for decrease.
 */
public class DiffAdapter extends RecyclerView.Adapter<DiffAdapter.ViewHolder> {

    public interface OnRowClickListener { void onClick(DiffRow row); }

    public static class DiffRow {
        public String name;
        public long oldValue;
        public long newValue;
        public long delta;
        public boolean onlyInA;  // removed in B
        public boolean onlyInB;  // new in B
        public String oldState;  // OOM label in A
        public String newState;  // OOM label in B
        public Snapshot.ProcessSnapshot procA;  // full data for detail view
        public Snapshot.ProcessSnapshot procB;
    }

    private List<DiffRow> rows = new ArrayList<>();
    private OnRowClickListener rowClickListener;

    public void setRows(List<DiffRow> rows) {
        this.rows = new ArrayList<>(rows);
        notifyDataSetChanged();
    }

    public void setOnRowClickListener(OnRowClickListener l) { this.rowClickListener = l; }

    @NonNull
    @Override
    public ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View v = LayoutInflater.from(parent.getContext())
                .inflate(R.layout.item_diff_row, parent, false);
        return new ViewHolder(v);
    }

    @Override
    public void onBindViewHolder(@NonNull ViewHolder holder, int position) {
        DiffRow row = rows.get(position);

        holder.processName.setText(row.name);

        if (row.onlyInB) {
            holder.oldValue.setText("--");
            holder.newValue.setText(ShellHelper.formatKb(row.newValue));
            holder.delta.setText("new");
            holder.delta.setTextColor(0xFFef4444);
        } else if (row.onlyInA) {
            holder.oldValue.setText(ShellHelper.formatKb(row.oldValue));
            holder.newValue.setText("--");
            holder.delta.setText("removed");
            holder.delta.setTextColor(0xFF22c55e);
        } else {
            holder.oldValue.setText(ShellHelper.formatKb(row.oldValue));
            holder.newValue.setText(ShellHelper.formatKb(row.newValue));

            String sign = row.delta > 0 ? "+" : "";
            holder.delta.setText(sign + ShellHelper.formatKb(row.delta));

            if (row.delta > 0) {
                holder.delta.setTextColor(0xFFef4444);
            } else if (row.delta < 0) {
                holder.delta.setTextColor(0xFF22c55e);
            } else {
                holder.delta.setTextColor(0xFF9ca3af);
            }
        }

        // State change indicator
        if (row.oldState != null && row.newState != null && !row.oldState.equals(row.newState)) {
            holder.stateChange.setText(row.oldState + " \u2192 " + row.newState);
            holder.stateChange.setTextColor(0xFFf59e0b); // amber
            holder.stateChange.setVisibility(View.VISIBLE);
        } else if (row.onlyInB && row.newState != null) {
            holder.stateChange.setText(row.newState);
            holder.stateChange.setTextColor(0xFF9ca3af);
            holder.stateChange.setVisibility(View.VISIBLE);
        } else if (row.onlyInA && row.oldState != null) {
            holder.stateChange.setText(row.oldState);
            holder.stateChange.setTextColor(0xFF9ca3af);
            holder.stateChange.setVisibility(View.VISIBLE);
        } else {
            holder.stateChange.setVisibility(View.GONE);
        }

        holder.itemView.setOnClickListener(v -> {
            if (rowClickListener != null) rowClickListener.onClick(row);
        });
    }

    @Override
    public int getItemCount() { return rows.size(); }

    static class ViewHolder extends RecyclerView.ViewHolder {
        final TextView processName, oldValue, arrow, newValue, delta, stateChange;

        ViewHolder(View v) {
            super(v);
            processName = v.findViewById(R.id.processName);
            oldValue = v.findViewById(R.id.oldValue);
            arrow = v.findViewById(R.id.arrow);
            newValue = v.findViewById(R.id.newValue);
            delta = v.findViewById(R.id.delta);
            stateChange = v.findViewById(R.id.stateChange);
        }
    }
}
