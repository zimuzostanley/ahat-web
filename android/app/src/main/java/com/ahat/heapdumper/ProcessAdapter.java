package com.ahat.heapdumper;

import android.graphics.drawable.GradientDrawable;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import java.util.ArrayList;
import java.util.List;

public class ProcessAdapter extends RecyclerView.Adapter<ProcessAdapter.ViewHolder> {

    private List<ProcessInfo> processes = new ArrayList<>();
    private OnProcessClickListener clickListener;
    private OnProcessLongClickListener longClickListener;

    public interface OnProcessClickListener {
        void onClick(ProcessInfo process);
    }

    public interface OnProcessLongClickListener {
        void onLongClick(ProcessInfo process);
    }

    public void setOnClickListener(OnProcessClickListener listener) {
        this.clickListener = listener;
    }

    public void setOnLongClickListener(OnProcessLongClickListener listener) {
        this.longClickListener = listener;
    }

    public void setProcesses(List<ProcessInfo> list) {
        this.processes = list;
        notifyDataSetChanged();
    }

    /** Notify that a specific process was enriched with meminfo. */
    public void notifyProcessEnriched(int pid) {
        for (int i = 0; i < processes.size(); i++) {
            if (processes.get(i).pid == pid) {
                notifyItemChanged(i);
                return;
            }
        }
    }

    @NonNull
    @Override
    public ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View v = LayoutInflater.from(parent.getContext())
                .inflate(R.layout.item_process, parent, false);
        return new ViewHolder(v);
    }

    @Override
    public void onBindViewHolder(@NonNull ViewHolder holder, int position) {
        ProcessInfo p = processes.get(position);
        holder.name.setText(p.name);
        holder.pid.setText("PID " + p.pid);
        holder.state.setText(p.oomLabel);

        // Show meminfo if enriched
        if (p.enriched) {
            holder.meminfo.setVisibility(View.VISIBLE);
            holder.meminfo.setText(" \u2022 PSS " + ShellHelper.formatKb(p.pssKb)
                    + " \u2022 Java " + ShellHelper.formatKb(p.javaHeapKb)
                    + " \u2022 Native " + ShellHelper.formatKb(p.nativeHeapKb));
        } else {
            holder.meminfo.setVisibility(View.GONE);
        }

        int badgeColor = getBadgeColor(p.oomLabel);
        GradientDrawable bg = new GradientDrawable();
        bg.setShape(GradientDrawable.RECTANGLE);
        bg.setCornerRadius(8f);
        bg.setColor(badgeColor);
        holder.state.setPadding(16, 6, 16, 6);
        holder.state.setBackground(bg);

        holder.itemView.setOnClickListener(v -> {
            if (clickListener != null) clickListener.onClick(p);
        });
        holder.itemView.setOnLongClickListener(v -> {
            if (longClickListener != null) {
                longClickListener.onLongClick(p);
                return true;
            }
            return false;
        });
    }

    static int getBadgeColor(String label) {
        switch (label) {
            case "Top":
            case "Foreground":
                return 0xFF166534;
            case "Bound FG":
            case "FG Service":
            case "Bound Top":
            case "Visible":
                return 0xFF1e40af;
            case "System":
            case "Persistent":
                return 0xFF7c2d12;
            default:
                return 0xFF374151;
        }
    }

    @Override
    public int getItemCount() {
        return processes.size();
    }

    static class ViewHolder extends RecyclerView.ViewHolder {
        final TextView name, pid, state, meminfo;

        ViewHolder(View v) {
            super(v);
            name = v.findViewById(R.id.processName);
            pid = v.findViewById(R.id.processPid);
            state = v.findViewById(R.id.processState);
            meminfo = v.findViewById(R.id.processMeminfo);
        }
    }
}
