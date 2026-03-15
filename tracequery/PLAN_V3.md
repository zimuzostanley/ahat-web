# TraceQuery v3 — Complete audit and fix plan

## Every issue reported, categorized

### THEME (broken)
1. System default doesn't work — shows light when device is dark
2. Dark mode not consistent across all components
3. SQL editor is always dark even in light mode — INTENTIONAL (like Perfetto/VS Code)
   but needs a subtle border to separate it from the light background
4. Fix: ThemeMode persistence + reading system theme properly

### NAVIGATION (broken)
5. Can't go back from Settings — back exits the app
6. Need proper back handling in Settings

### BUTTONS & SHAPES (ugly)
7. Buttons too rounded everywhere
8. Drawer items too rounded
9. Fix: Override shape in theme to use smaller corner radii

### DATA GRID — MISSING FEATURES
10. Can't add/remove columns — need column visibility toggle
11. Missing filter chips showing active filters (removable)
12. Missing: COUNT DISTINCT
13. Missing: GLOB, CONTAINS, NOT CONTAINS, NOT GLOB filters
14. Numbers should use actual numeric values for filter SQL, not quoted strings

### TABLE BROWSER — MISSING FEATURES
15. JOIN support (LEFT JOIN, INNER JOIN between two tables)
16. _interval_intersect support in explore mode
17. Need to read perfetto code for how joins/interval_intersect work

### APP ICON
18. Need a proper vector drawable icon

## Fix order (by impact)

1. Theme fixes (system default, consistency)
2. Navigation (settings back)
3. Shapes (less rounded)
4. App icon
5. Filter chips in grid
6. Extended filter options (GLOB, CONTAINS, COUNT DISTINCT)
7. Column add/remove
8. JOIN support in table browser
9. _interval_intersect in table browser
