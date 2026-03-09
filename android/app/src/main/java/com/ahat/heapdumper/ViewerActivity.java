package com.ahat.heapdumper;

import android.annotation.SuppressLint;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.appcompat.app.AppCompatActivity;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;

/**
 * Opens the ahat-web viewer in a WebView and injects the .hprof file
 * so the user doesn't have to manually pick it.
 */
public class ViewerActivity extends AppCompatActivity {

    private static final String AHAT_WEB_URL = "https://zimuzostanley.github.io/ahat-web/";
    private String hprofPath;
    private String processName;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_viewer);

        hprofPath = getIntent().getStringExtra("hprof_path");
        processName = getIntent().getStringExtra("process_name");

        WebView webView = findViewById(R.id.webView);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);

        webView.addJavascriptInterface(new HprofBridge(), "AhatBridge");
        webView.setWebChromeClient(new WebChromeClient());

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                // Inject the hprof file after the page loads
                injectHprofFile(view);
            }
        });

        webView.loadUrl(AHAT_WEB_URL);
    }

    /**
     * After the ahat-web page loads, use JS to read the file via our bridge
     * and feed it to the page's file input or drop handler.
     */
    private void injectHprofFile(WebView webView) {
        if (hprofPath == null) return;

        // JavaScript that reads the file from our bridge and creates a synthetic
        // file drop / input event on the page
        String js = "(function() {" +
                "  try {" +
                "    var b64 = AhatBridge.getFileBase64();" +
                "    if (!b64) return;" +
                "    var binary = atob(b64);" +
                "    var bytes = new Uint8Array(binary.length);" +
                "    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);" +
                "    var blob = new Blob([bytes], {type: 'application/octet-stream'});" +
                "    var name = AhatBridge.getFileName();" +
                "    var file = new File([blob], name, {type: 'application/octet-stream'});" +
                // Try to find and use the file input
                "    var input = document.querySelector('input[type=file]');" +
                "    if (input) {" +
                "      var dt = new DataTransfer();" +
                "      dt.items.add(file);" +
                "      input.files = dt.files;" +
                "      input.dispatchEvent(new Event('change', {bubbles: true}));" +
                "    }" +
                "  } catch(e) { console.error('ahat inject error:', e); }" +
                "})();";

        webView.evaluateJavascript(js, null);
    }

    /** JavaScript interface to pass the hprof file data to the WebView. */
    class HprofBridge {
        @JavascriptInterface
        public String getFileBase64() {
            if (hprofPath == null) return null;
            File f = new File(hprofPath);
            if (!f.exists()) return null;
            try (FileInputStream fis = new FileInputStream(f)) {
                byte[] data = new byte[(int) f.length()];
                int read = 0;
                while (read < data.length) {
                    int n = fis.read(data, read, data.length - read);
                    if (n < 0) break;
                    read += n;
                }
                return Base64.encodeToString(data, Base64.NO_WRAP);
            } catch (IOException e) {
                return null;
            }
        }

        @JavascriptInterface
        public String getFileName() {
            String name = processName != null ? processName : "heap";
            return name + ".hprof";
        }
    }
}
