package com.ahat.heapdumper;

import android.graphics.drawable.GradientDrawable;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

public class ProcessAdapter extends RecyclerView.Adapter<ProcessAdapter.ViewHolder> {

    public enum SortField { NAME, PID, STATE, MEM }
    public enum MemColumn {
        PSS("PSS"), JAVA("Java"), NATIVE("Native"), CODE("Code"), GRAPHICS("Graphics"), RSS("RSS");
        public final String label;
        MemColumn(String label) { this.label = label; }
    }

    private List<ProcessInfo> allProcesses = new ArrayList<>();
    private List<ProcessInfo> processes = new ArrayList<>();
    private OnProcessClickListener clickListener;
    private OnProcessLongClickListener longClickListener;
    private String filterText = "";
    private SortField sortField = SortField.NAME;
    private boolean sortAscending = true;
    private MemColumn memColumn = MemColumn.PSS;

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
        this.allProcesses = new ArrayList<>(list);
        applyFilterAndSort();
    }

    public void setFilter(String text) {
        this.filterText = text.toLowerCase(Locale.ROOT);
        applyFilterAndSort();
    }

    public void setSort(SortField field) {
        if (this.sortField == field) {
            sortAscending = !sortAscending;
        } else {
            this.sortField = field;
            sortAscending = (field == SortField.MEM) ? false : true;
        }
        applyFilterAndSort();
    }

    public void setMemColumn(MemColumn col) {
        this.memColumn = col;
        if (sortField == SortField.MEM) {
            applyFilterAndSort();
        } else {
            notifyDataSetChanged();
        }
    }

    public SortField getSortField() { return sortField; }
    public boolean isSortAscending() { return sortAscending; }
    public MemColumn getMemColumn() { return memColumn; }

    private long getMemValue(ProcessInfo p) {
        switch (memColumn) {
            case JAVA:     return p.javaHeapKb;
            case NATIVE:   return p.nativeHeapKb;
            case CODE:     return p.codeKb;
            case GRAPHICS: return p.graphicsKb;
            case RSS:      return p.rssKb;
            default:       return p.pssKb;
        }
    }

    private void applyFilterAndSort() {
        List<ProcessInfo> filtered = new ArrayList<>();
        for (ProcessInfo p : allProcesses) {
            if (filterText.isEmpty()
                    || p.name.toLowerCase(Locale.ROOT).contains(filterText)
                    || String.valueOf(p.pid).contains(filterText)
                    || p.oomLabel.toLowerCase(Locale.ROOT).contains(filterText)) {
                filtered.add(p);
            }
        }

        Comparator<ProcessInfo> cmp;
        switch (sortField) {
            case PID:   cmp = Comparator.comparingInt(p -> p.pid); break;
            case STATE: cmp = Comparator.comparing(p -> p.oomLabel); break;
            case MEM:   cmp = Comparator.comparingLong(this::getMemValue); break;
            default:    cmp = Comparator.comparing(p -> p.name); break;
        }
        if (!sortAscending) cmp = cmp.reversed();
        Collections.sort(filtered, cmp);

        this.processes = filtered;
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

        // Show selected memory column if enriched
        if (p.enriched) {
            long val = getMemValue(p);
            holder.meminfo.setVisibility(View.VISIBLE);
            holder.meminfo.setText(memColumn.label + " " + ShellHelper.formatKb(val));
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
