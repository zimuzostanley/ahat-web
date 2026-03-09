package com.ahat.heapdumper;

import android.graphics.Color;
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
    private OnProcessClickListener listener;

    public interface OnProcessClickListener {
        void onClick(ProcessInfo process);
    }

    public void setOnClickListener(OnProcessClickListener listener) {
        this.listener = listener;
    }

    public void setProcesses(List<ProcessInfo> list) {
        this.processes = list;
        notifyDataSetChanged();
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

        // Color-code the badge based on state
        int badgeColor;
        switch (p.oomLabel) {
            case "Top":
            case "Foreground":
                badgeColor = 0xFF166534; // green
                break;
            case "Bound FG":
            case "FG Service":
            case "Bound Top":
            case "Visible":
                badgeColor = 0xFF1e40af; // blue
                break;
            case "System":
            case "Persistent":
                badgeColor = 0xFF7c2d12; // amber
                break;
            default:
                badgeColor = 0xFF374151; // gray for cached etc.
                break;
        }
        GradientDrawable bg = new GradientDrawable();
        bg.setShape(GradientDrawable.RECTANGLE);
        bg.setCornerRadius(8f);
        bg.setColor(badgeColor);
        bg.setPadding(12, 4, 12, 4);
        holder.state.setBackground(bg);

        holder.itemView.setOnClickListener(v -> {
            if (listener != null) listener.onClick(p);
        });
    }

    @Override
    public int getItemCount() {
        return processes.size();
    }

    static class ViewHolder extends RecyclerView.ViewHolder {
        final TextView name, pid, state;

        ViewHolder(View v) {
            super(v);
            name = v.findViewById(R.id.processName);
            pid = v.findViewById(R.id.processPid);
            state = v.findViewById(R.id.processState);
        }
    }
}
