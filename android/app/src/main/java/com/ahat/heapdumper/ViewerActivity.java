package com.ahat.heapdumper;

import android.annotation.SuppressLint;
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
 * Opens the ahat-web viewer in a WebView and sends the .hprof file
 * via postMessage using the protocol:
 *   window.postMessage({ type: "open-hprof", name: "...", buffer: ArrayBuffer })
 *
 * The ahat-web page listens for this on mount and loads the buffer directly.
 */
public class ViewerActivity extends AppCompatActivity {

    private static final String AHAT_WEB_URL = "https://zimuzostanley.github.io/ahat-web/";
    private String hprofPath;
    private String processName;
    private boolean injected = false;

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
                if (!injected) {
                    injected = true;
                    injectViaPostMessage(view);
                }
            }
        });

        webView.loadUrl(AHAT_WEB_URL);
    }

    /**
     * Use the postMessage API that ahat-web already supports:
     * window.postMessage({ type: "open-hprof", name: "...", buffer: ArrayBuffer })
     *
     * Since the file can be large, we read it via the JS bridge in chunks
     * and reconstruct the ArrayBuffer in JS, then postMessage it.
     */
    private void injectViaPostMessage(WebView webView) {
        if (hprofPath == null) return;

        // JS that:
        // 1. Waits briefly for the app to mount and register the message listener
        // 2. Reads the file as base64 from our bridge
        // 3. Converts to ArrayBuffer
        // 4. Posts it via window.postMessage with the open-hprof protocol
        String js = "(function() {" +
                "  function send() {" +
                "    try {" +
                "      var b64 = AhatBridge.getFileBase64();" +
                "      if (!b64) return;" +
                "      var binary = atob(b64);" +
                "      var buf = new ArrayBuffer(binary.length);" +
                "      var view = new Uint8Array(buf);" +
                "      for (var i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);" +
                "      var name = AhatBridge.getFileName();" +
                "      window.postMessage({ type: 'open-hprof', name: name, buffer: buf }, '*');" +
                "    } catch(e) { console.error('ahat inject error:', e); }" +
                "  }" +
                // Wait for the ahat-web message listener to be registered (it registers on mount)
                "  setTimeout(send, 500);" +
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
