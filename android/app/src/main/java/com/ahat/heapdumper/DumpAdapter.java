package com.ahat.heapdumper;

import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageButton;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

public class DumpAdapter extends RecyclerView.Adapter<DumpAdapter.ViewHolder> {

    private List<ShellHelper.HprofFile> dumps = new ArrayList<>();
    private OnDumpActionListener listener;

    public interface OnDumpActionListener {
        void onOpen(ShellHelper.HprofFile dump);
        void onShare(ShellHelper.HprofFile dump);
        void onDelete(ShellHelper.HprofFile dump);
    }

    public void setListener(OnDumpActionListener listener) {
        this.listener = listener;
    }

    public void setDumps(List<ShellHelper.HprofFile> list) {
        this.dumps = new ArrayList<>(list);
        notifyDataSetChanged();
    }

    @NonNull
    @Override
    public ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View v = LayoutInflater.from(parent.getContext())
                .inflate(R.layout.item_dump, parent, false);
        return new ViewHolder(v);
    }

    @Override
    public void onBindViewHolder(@NonNull ViewHolder holder, int position) {
        ShellHelper.HprofFile d = dumps.get(position);

        // Extract process name from filename: ahat_<pid>_<ts>.hprof
        String displayName = d.name.replace("ahat_", "").replace(".hprof", "");
        holder.name.setText(displayName);

        String date = new SimpleDateFormat("MMM dd HH:mm", Locale.US).format(new Date(d.lastModified));
        holder.info.setText(ShellHelper.formatSize(d.size) + " \u2022 " + date);

        holder.itemView.setOnClickListener(v -> { if (listener != null) listener.onOpen(d); });
        holder.btnShare.setOnClickListener(v -> { if (listener != null) listener.onShare(d); });
        holder.btnDelete.setOnClickListener(v -> { if (listener != null) listener.onDelete(d); });
    }

    @Override
    public int getItemCount() {
        return dumps.size();
    }

    static class ViewHolder extends RecyclerView.ViewHolder {
        final TextView name, info;
        final ImageButton btnShare, btnDelete;

        ViewHolder(View v) {
            super(v);
            name = v.findViewById(R.id.dumpName);
            info = v.findViewById(R.id.dumpInfo);
            btnShare = v.findViewById(R.id.btnShare);
            btnDelete = v.findViewById(R.id.btnDelete);
        }
    }
}
