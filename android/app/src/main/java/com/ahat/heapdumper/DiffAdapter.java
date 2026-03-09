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

    public static class DiffRow {
        public String name;
        public long oldValue;
        public long newValue;
        public long delta;
        public boolean onlyInA;  // removed in B
        public boolean onlyInB;  // new in B
    }

    private List<DiffRow> rows = new ArrayList<>();

    public void setRows(List<DiffRow> rows) {
        this.rows = new ArrayList<>(rows);
        notifyDataSetChanged();
    }

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
            holder.delta.setTextColor(0xFFef4444); // red
        } else if (row.onlyInA) {
            holder.oldValue.setText(ShellHelper.formatKb(row.oldValue));
            holder.newValue.setText("--");
            holder.delta.setText("removed");
            holder.delta.setTextColor(0xFF22c55e); // green
        } else {
            holder.oldValue.setText(ShellHelper.formatKb(row.oldValue));
            holder.newValue.setText(ShellHelper.formatKb(row.newValue));

            String sign = row.delta > 0 ? "+" : "";
            holder.delta.setText(sign + ShellHelper.formatKb(row.delta));

            if (row.delta > 0) {
                holder.delta.setTextColor(0xFFef4444); // red - memory grew
            } else if (row.delta < 0) {
                holder.delta.setTextColor(0xFF22c55e); // green - memory shrunk
            } else {
                holder.delta.setTextColor(0xFF9ca3af); // gray - no change
            }
        }
    }

    @Override
    public int getItemCount() { return rows.size(); }

    static class ViewHolder extends RecyclerView.ViewHolder {
        final TextView processName, oldValue, arrow, newValue, delta;

        ViewHolder(View v) {
            super(v);
            processName = v.findViewById(R.id.processName);
            oldValue = v.findViewById(R.id.oldValue);
            arrow = v.findViewById(R.id.arrow);
            newValue = v.findViewById(R.id.newValue);
            delta = v.findViewById(R.id.delta);
        }
    }
}
