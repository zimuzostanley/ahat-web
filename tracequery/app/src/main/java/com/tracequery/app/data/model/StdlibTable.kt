package com.tracequery.app.data.model

import android.content.Context
import org.json.JSONArray

/** A column in a stdlib table. */
data class StdlibColumn(
    val name: String,
    val type: String,
    val desc: String,
)

/** A table/view from the Perfetto SQL stdlib. */
data class StdlibTable(
    val name: String,
    val moduleName: String,
    val desc: String,
    val summaryDesc: String,
    val type: String, // "table" or "view"
    val importance: String?, // "high", "mid", "low", or null
    val columns: List<StdlibColumn>,
) {
    /** The INCLUDE PERFETTO MODULE statement needed before querying this table. */
    val includeStatement: String
        get() = "INCLUDE PERFETTO MODULE $moduleName;"

    /** Generate a SELECT * query for this table. */
    fun selectQuery(limit: Int = 100): String {
        return "$includeStatement\nSELECT * FROM $name LIMIT $limit;"
    }
}

/** A function from the Perfetto SQL stdlib (scalar or table function). */
data class StdlibFunction(
    val name: String,
    val moduleName: String,
    val desc: String,
    val isTableFunction: Boolean,
    val args: List<StdlibColumn>,
    val returnType: String?,
    val returnColumns: List<StdlibColumn>, // for table functions
)

/** Parsed stdlib docs — all packages, modules, tables, functions. */
data class StdlibDocs(
    val tables: List<StdlibTable>,
    val functions: List<StdlibFunction>,
) {
    companion object {
        fun loadFromAssets(context: Context): StdlibDocs {
            val json = context.assets.open("stdlib_docs.json")
                .bufferedReader().use { it.readText() }
            return parse(json)
        }

        fun parse(json: String): StdlibDocs {
            val tables = mutableListOf<StdlibTable>()
            val functions = mutableListOf<StdlibFunction>()

            val packages = JSONArray(json)
            for (p in 0 until packages.length()) {
                val pkg = packages.getJSONObject(p)
                val modules = pkg.getJSONArray("modules")

                for (m in 0 until modules.length()) {
                    val mod = modules.getJSONObject(m)
                    val moduleName = mod.getString("module_name")

                    // Parse tables/views (data_objects)
                    val dataObjects = mod.getJSONArray("data_objects")
                    for (d in 0 until dataObjects.length()) {
                        val obj = dataObjects.getJSONObject(d)
                        val cols = obj.getJSONArray("cols")
                        val columns = (0 until cols.length()).map { i ->
                            val col = cols.getJSONObject(i)
                            StdlibColumn(
                                name = col.getString("name"),
                                type = col.optString("type", ""),
                                desc = col.optString("desc", ""),
                            )
                        }
                        tables.add(StdlibTable(
                            name = obj.getString("name"),
                            moduleName = moduleName,
                            desc = obj.optString("desc", ""),
                            summaryDesc = obj.optString("summary_desc", ""),
                            type = obj.optString("type", "table"),
                            importance = obj.optString("importance", null)
                                .takeIf { it != "null" && it.isNotEmpty() },
                            columns = columns,
                        ))
                    }

                    // Parse functions
                    val funcs = mod.getJSONArray("functions")
                    for (f in 0 until funcs.length()) {
                        val fn = funcs.getJSONObject(f)
                        val args = fn.getJSONArray("args")
                        functions.add(StdlibFunction(
                            name = fn.getString("name"),
                            moduleName = moduleName,
                            desc = fn.optString("desc", ""),
                            isTableFunction = false,
                            args = (0 until args.length()).map { i ->
                                val a = args.getJSONObject(i)
                                StdlibColumn(a.getString("name"), a.optString("type", ""), a.optString("desc", ""))
                            },
                            returnType = fn.optString("return_type", null),
                            returnColumns = emptyList(),
                        ))
                    }

                    // Parse table functions
                    val tableFuncs = mod.getJSONArray("table_functions")
                    for (f in 0 until tableFuncs.length()) {
                        val fn = tableFuncs.getJSONObject(f)
                        val args = fn.getJSONArray("args")
                        val retCols = fn.getJSONArray("cols")
                        functions.add(StdlibFunction(
                            name = fn.getString("name"),
                            moduleName = moduleName,
                            desc = fn.optString("desc", ""),
                            isTableFunction = true,
                            args = (0 until args.length()).map { i ->
                                val a = args.getJSONObject(i)
                                StdlibColumn(a.getString("name"), a.optString("type", ""), a.optString("desc", ""))
                            },
                            returnType = null,
                            returnColumns = (0 until retCols.length()).map { i ->
                                val c = retCols.getJSONObject(i)
                                StdlibColumn(c.getString("name"), c.optString("type", ""), c.optString("desc", ""))
                            },
                        ))
                    }
                }
            }

            return StdlibDocs(
                tables = tables.sortedWith(
                    compareByDescending<StdlibTable> {
                        when (it.importance) { "high" -> 2; "mid" -> 1; else -> 0 }
                    }.thenBy { it.name }
                ),
                functions = functions.sortedBy { it.name },
            )
        }
    }
}
