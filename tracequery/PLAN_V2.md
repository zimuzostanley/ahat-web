# TraceQuery v2 — Proper UI Architecture

## Problems with current UI
1. Random buttons (Settings, +, History) floating in TopAppBar — no structure
2. No drawer navigation — traces and settings should be in side drawer
3. DataGrid has no cell/column interaction (no filtering, no aggregation)
4. Run button looks amateur (SmallFloatingActionButton is wrong component)
5. Mode toggle (SQL/Explore) uses FilterChips — should be proper tabs
6. Artificial 100K row limit — user should get what they query
7. No app icon
8. No column long-press menu

## Architecture

### Navigation: ModalNavigationDrawer
- Drawer contains:
  - Header: "TraceQuery" branding
  - "Open Trace" button
  - Loaded traces list (tap to switch, swipe to close)
  - Divider
  - "Settings" item
  - "About" item
- Hamburger icon in TopAppBar opens drawer
- Back button in Settings returns to query

### Main Screen Layout
```
┌──────────────────────────────────┐
│ ☰  trace_name.perfetto-trace    │  ← TopAppBar with hamburger
├────────┬─────────────────────────┤
│  SQL   │  Explore Tables         │  ← TabRow (2 tabs)
├────────┴─────────────────────────┤
│ 1│ SELECT * FROM slice           │  ← SQL Editor (dark bg)
│ 2│ WHERE dur > 1000000           │
│ 3│ LIMIT 100;                    │
├──────────────────────────────────┤
│ ▶ Run          12,345 rows • 42ms│  ← Action bar (Run = text button)
├──────────────────────────────────┤
│ id │ ts      │ dur    │ name    │  ← DataGrid header (tap=sort)
│────┼─────────┼────────┼─────────│
│  1 │ 1234567 │ 500000 │ measure │  ← Rows (tap cell = menu)
│  2 │ 2345678 │ 120000 │ draw    │
│ ...│         │        │         │  ← LazyColumn virtual scroll
└──────────────────────────────────┘
```

### DataGrid Interactions (Perfetto-level)

**Cell tap** → DropdownMenu:
- Copy value
- Filter: equals this value → generates new query with WHERE clause
- Filter: not equals
- Filter: > / >= / < / <= (for numbers)
- Filter: is null / is not null
- All filter actions generate a new SQL with WHERE appended

**Column header tap** → Sort (cycle ASC/DESC/none)

**Column header long-press** → DropdownMenu:
- Sort ascending
- Sort descending
- Clear sort
- ---
- Filter (text input → WHERE clause)
- ---
- Aggregate: COUNT, SUM, AVG, MIN, MAX
  → Generates GROUP BY query in new tab
- ---
- Hide column (remove from SELECT)

### Row Limit
- REMOVE the 100K limit entirely
- If user writes SELECT * on a huge table, we materialize it all
- LazyColumn handles rendering
- Show row count in status bar as rows stream in

### Run Button
- Simple `TextButton` or `OutlinedButton` with play icon
- NOT a FAB — those are for primary creation actions
- Consistent height with the status text

### Theme
- Clean Material 3 with proper elevation hierarchy
- Dark mode SQL editor always
- Grid uses theme colors (light/dark)
