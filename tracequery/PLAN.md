# TraceQuery — Perfetto Trace Processor Android App

## Overview
Native Android app (Kotlin/Compose) that wraps Perfetto's trace_processor C++ library
via JNI. Two modes: raw SQL editor and stdlib table explorer. Multi-trace tabs.
Fully-featured data grid with infinite virtual scroll for millions of rows.

## Architecture

### JNI Layer (zero-copy)
- C++ JNI code in `app/src/main/jni/trace_processor_jni.cc`
- Links against `trace_processor.a` static library (built via perfetto's GN)
- **Cursor-based API**: query returns a native cursor handle, Java calls next() and reads
  current row via DirectByteBuffer — no memory copying
- Row buffer layout: per column [type:1byte][len:4bytes LE][data:len bytes]
- Types: 0=NULL, 1=LONG(8b), 2=DOUBLE(8b), 3=STRING, 4=BYTES
- Every native allocation has explicit cleanup (destroy instance, close cursor)

### Building trace_processor.a
```bash
cd /home/zimvm/projects/perfetto
third_party/gn/gn gen out/android_arm64 --args='target_os="android" target_cpu="arm64" is_debug=false'
third_party/ninja/ninja -C out/android_arm64 src/trace_processor:trace_processor
# Output: out/android_arm64/obj/src/trace_processor/trace_processor.a
```
Build is currently running in background.

### App Structure (Kotlin/Compose, following ../lt patterns)
```
app/src/main/
  jni/
    CMakeLists.txt              # Links JNI .so against trace_processor.a
    trace_processor_jni.cc      # JNI implementation
  java/com/tracequery/app/
    TraceQueryApp.kt            # Application + manual DI
    di/AppContainer.kt          # Dependency container
    data/
      TraceProcessorNative.kt   # JNI declarations + row buffer decoder
      TraceProcessorSession.kt  # Coroutine-safe session wrapper (mutex)
      QueryHistory.kt           # SharedPreferences-backed history (JSON)
      model/
        QueryResult.kt          # Result/HistoryEntry data classes
        StdlibTable.kt          # Parsed stdlib_docs.json models
    ui/
      MainActivity.kt           # Single activity
      MainViewModel.kt          # Central state: tabs, queries, results
      theme/
        Color.kt, Type.kt, Theme.kt  # Material 3 dark theme, SQL colors
      screen/
        TraceLoadScreen.kt      # File picker, recent traces
        QueryScreen.kt          # SQL editor + data grid + table browser
      component/
        SqlEditor.kt            # Syntax-highlighted SQL editor (AnnotatedString)
        DataGrid.kt             # Virtual-scrolling grid (LazyColumn + horiz scroll)
        TableBrowser.kt         # Stdlib table search + click to query
        QueryHistorySheet.kt    # Bottom sheet with history
  assets/
    stdlib_docs.json            # 1MB, 307 tables, 53 functions (generated)
```

## Key Requirements

### 1. Data Grid (millions of rows)
- LazyColumn for vertical virtual scroll (Compose handles recycling)
- Shared horizontal ScrollState between header and body
- Column auto-width from header + sample rows
- Drag-to-resize columns
- Sort by clicking column header
- Alternating row colors
- Copy cell on long-press
- For truly huge results (>100K rows): paginate with cursor — fetch rows on demand
  from native side, don't materialize all in Kotlin

### 2. SQL Editor
- BasicTextField + VisualTransformation for syntax highlighting
- SQL keywords, functions, strings, numbers, comments, Perfetto table names
- Line numbers in gutter
- Dark background always
- Ctrl+Enter / button to execute
- Auto-completion of table names from stdlib (nice-to-have v1)

### 3. Table Browser (Explore mode)
- Parse stdlib_docs.json at startup
- Search box filters tables in real-time (fuzzy match on name + column names)
- Importance badges (high/mid/low)
- Click table → auto-generates SELECT + INCLUDE PERFETTO MODULE
- Show column list with types
- Special support for _interval_intersect table function
- Module auto-import when selecting tables

### 4. Multi-trace Tabs
- Each tab = one TraceProcessorSession (separate native TP instance)
- Tab bar at top
- Switch between tabs preserves query + results
- Close tab destroys native instance (deterministic cleanup)
- Each tab can have its own query history

### 5. Trace Loading
- File picker (ActivityResultContracts.OpenDocument)
- Accept .perfetto-trace, .pb, .pbtxt, .ctrace
- Copy from content:// URI to cache dir (TP needs file path)
- Show loading progress (file size based)
- Handle intent (open from file manager)

## Status
- [x] JNI C++ code written (trace_processor_jni.cc)
- [x] CMakeLists.txt written
- [x] Kotlin JNI bindings (TraceProcessorNative.kt)
- [x] Session wrapper (TraceProcessorSession.kt)
- [x] Data models (QueryResult.kt, StdlibTable.kt)
- [x] stdlib_docs.json generated (307 tables, 53 functions)
- [x] trace_processor_shell_arm64 downloaded (for fallback)
- [ ] trace_processor.a building (in progress)
- [ ] Build system (gradle files)
- [ ] Theme
- [ ] MainActivity + ViewModel
- [ ] SqlEditor component
- [ ] DataGrid component
- [ ] TableBrowser component
- [ ] QueryHistory
- [ ] Multi-tab UI
- [ ] Tests
- [ ] Build + verify on device
