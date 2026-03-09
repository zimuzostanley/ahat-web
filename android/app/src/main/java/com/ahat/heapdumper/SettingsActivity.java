package com.ahat.heapdumper;

import android.content.SharedPreferences;
import android.os.Bundle;
import android.widget.TextView;

import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.appcompat.app.AppCompatDelegate;

import com.google.android.material.switchmaterial.SwitchMaterial;

import java.io.File;
import java.util.List;

public class SettingsActivity extends AppCompatActivity {

    private SharedPreferences prefs;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_settings);

        prefs = getSharedPreferences("ahat_prefs", MODE_PRIVATE);

        findViewById(R.id.btnBack).setOnClickListener(v -> finish());

        // Theme
        updateThemeLabel();
        findViewById(R.id.themeRow).setOnClickListener(v -> showThemePicker());

        // Bitmaps toggle
        SwitchMaterial sw = findViewById(R.id.switchBitmaps);
        sw.setChecked(prefs.getBoolean("include_bitmaps", false));
        sw.setOnCheckedChangeListener((btn, checked) ->
                prefs.edit().putBoolean("include_bitmaps", checked).apply());

        // Clear dumps
        updateDumpsSize();
        findViewById(R.id.clearDumpsRow).setOnClickListener(v -> confirmClearDumps());
    }

    private void updateThemeLabel() {
        int mode = prefs.getInt("theme_mode", AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM);
        String label;
        switch (mode) {
            case AppCompatDelegate.MODE_NIGHT_NO: label = "Light"; break;
            case AppCompatDelegate.MODE_NIGHT_YES: label = "Dark"; break;
            default: label = "System default"; break;
        }
        ((TextView) findViewById(R.id.themeValue)).setText(label);
    }

    private void showThemePicker() {
        String[] options = {"System default", "Light", "Dark"};
        int current = prefs.getInt("theme_mode", AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM);
        int checked;
        switch (current) {
            case AppCompatDelegate.MODE_NIGHT_NO: checked = 1; break;
            case AppCompatDelegate.MODE_NIGHT_YES: checked = 2; break;
            default: checked = 0; break;
        }

        new AlertDialog.Builder(this)
                .setTitle("Theme")
                .setSingleChoiceItems(options, checked, (d, which) -> {
                    int mode;
                    switch (which) {
                        case 1: mode = AppCompatDelegate.MODE_NIGHT_NO; break;
                        case 2: mode = AppCompatDelegate.MODE_NIGHT_YES; break;
                        default: mode = AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM; break;
                    }
                    prefs.edit().putInt("theme_mode", mode).apply();
                    AppCompatDelegate.setDefaultNightMode(mode);
                    updateThemeLabel();
                    d.dismiss();
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    private void updateDumpsSize() {
        List<ShellHelper.HprofFile> dumps = ShellHelper.listDumps();
        long total = 0;
        for (ShellHelper.HprofFile d : dumps) total += d.size;
        String text = dumps.size() + " dump" + (dumps.size() != 1 ? "s" : "")
                + " \u2022 " + ShellHelper.formatSize(total);
        ((TextView) findViewById(R.id.dumpsSizeText)).setText(text);
    }

    private void confirmClearDumps() {
        List<ShellHelper.HprofFile> dumps = ShellHelper.listDumps();
        if (dumps.isEmpty()) return;

        new AlertDialog.Builder(this)
                .setTitle("Clear all dumps?")
                .setMessage("Delete " + dumps.size() + " heap dump" + (dumps.size() > 1 ? "s" : "") + "?")
                .setPositiveButton("Delete all", (d, w) -> {
                    for (ShellHelper.HprofFile dump : dumps) {
                        ShellHelper.deleteDump(dump.path);
                    }
                    updateDumpsSize();
                })
                .setNegativeButton("Cancel", null)
                .show();
    }
}
