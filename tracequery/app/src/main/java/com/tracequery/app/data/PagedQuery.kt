package com.tracequery.app.data

import com.tracequery.app.data.model.ColumnInfo
import com.tracequery.app.data.model.QueryResult

/**
 * Scroll-driven LIMIT/OFFSET pagination for large query results.
 *
 * Only rows the user scrolls to are fetched from trace_processor.
 * Pages are cached with LRU eviction — bounded memory regardless of table size.
 *
 * Usage:
 *   val paged = PagedQuery.create(session, "SELECT * FROM slice")
 *   // paged.totalRows = 5_000_000
 *   // LazyColumn(items = paged.totalRows) { index ->
 *   //   val row = paged.getRow(index) // null if not loaded
 *   //   if (row == null) LaunchedEffect { paged.fetchPage(index / pageSize) }
 *   // }
 */
class PagedQuery(
    private val session: TraceProcessorSession,
    private val innerSql: String,  // SQL without LIMIT/OFFSET/semicolons
    val columns: List<ColumnInfo>,
    val totalRows: Long,
    val pageSize: Int = PAGE_SIZE,
    val executionTimeMs: Long = 0,
    val error: String? = null,
) {
    companion object {
        const val PAGE_SIZE = 500
        const val MAX_CACHED_PAGES = 30 // 500 * 30 = 15K rows in memory max

        /** Extract INCLUDE statements (must stay top-level, not in subquery). */
        private fun splitIncludes(sql: String): Pair<String, String> {
            val clean = sql.trimEnd().removeSuffix(";").trim()
            val includes = mutableListOf<String>()
            val queryLines = mutableListOf<String>()
            for (line in clean.lines()) {
                val t = line.trim()
                if (t.uppercase().startsWith("INCLUDE PERFETTO MODULE")) {
                    includes.add(t.removeSuffix(";"))
                } else if (t.isNotEmpty()) {
                    queryLines.add(line)
                }
            }
            val prefix = if (includes.isNotEmpty()) includes.joinToString(";\n") + ";\n" else ""
            return prefix to queryLines.joinToString("\n").trim()
        }

        suspend fun create(session: TraceProcessorSession, sql: String): PagedQuery {
            val startMs = System.currentTimeMillis()
            val (includePrefix, selectSql) = splitIncludes(sql)

            // Wrap user's query as subquery — respects any user LIMIT
            // Get columns from LIMIT 0
            val metaSql = "${includePrefix}SELECT * FROM ($selectSql) LIMIT 0;"
            val metaResult = session.query(metaSql)
            if (metaResult.isError) {
                return PagedQuery(
                    session = session, innerSql = selectSql,
                    columns = emptyList(), totalRows = 0,
                    executionTimeMs = System.currentTimeMillis() - startMs,
                    error = metaResult.error,
                )
            }

            // Count — wraps user query, respects their LIMIT if any
            val countSql = "${includePrefix}SELECT COUNT(*) FROM ($selectSql);"
            val countResult = session.query(countSql)
            val total = if (!countResult.isError && countResult.rows.isNotEmpty()) {
                countResult.rows[0].firstOrNull()?.toLongOrNull() ?: 0L
            } else 0L

            val elapsed = System.currentTimeMillis() - startMs

            val pq = PagedQuery(
                session = session, innerSql = selectSql,
                columns = metaResult.columns, totalRows = total,
                executionTimeMs = elapsed,
            )
            // Prefetch first page
            pq.fetchPage(0)
            return pq
        }
    }

    // LRU page cache: page number → rows
    private val cache = LinkedHashMap<Int, List<List<String>>>(MAX_CACHED_PAGES + 1, 0.75f, true)
    @Volatile private var fetchingPages = mutableSetOf<Int>()

    /** Version counter — incremented on every cache change to trigger recomposition. */
    @Volatile var version = 0L
        private set

    val isError: Boolean get() = error != null

    /** Get row at absolute index. Returns null if page not yet loaded. */
    fun getRow(index: Int): List<String>? {
        val page = index / pageSize
        val offset = index % pageSize
        return cache[page]?.getOrNull(offset)
    }

    /** Check if a row's page is loaded. */
    fun isPageLoaded(pageNum: Int): Boolean = cache.containsKey(pageNum)

    /** Fetch a page from trace_processor. Thread-safe, idempotent. */
    suspend fun fetchPage(pageNum: Int): Boolean {
        if (cache.containsKey(pageNum)) return true
        synchronized(fetchingPages) {
            if (fetchingPages.contains(pageNum)) return false
            fetchingPages.add(pageNum)
        }

        try {
            val offset = pageNum.toLong() * pageSize
            if (offset >= totalRows) return false

            // Wrap user query in subquery, apply pagination LIMIT/OFFSET outside
            val sql = "SELECT * FROM ($innerSql) LIMIT $pageSize OFFSET $offset;"
            val result = session.query(sql)

            if (!result.isError) {
                synchronized(cache) {
                    cache[pageNum] = result.rows
                    while (cache.size > MAX_CACHED_PAGES) {
                        val oldest = cache.keys.first()
                        cache.remove(oldest)
                    }
                }
                version++
                return true
            }
        } finally {
            synchronized(fetchingPages) { fetchingPages.remove(pageNum) }
        }
        return false
    }

    /** Pages needed for a visible range, not yet cached. */
    fun neededPages(firstVisible: Int, lastVisible: Int): List<Int> {
        val startPage = maxOf(0, (firstVisible - pageSize)) / pageSize
        val endPage = minOf(totalRows.toInt() - 1, lastVisible + pageSize) / pageSize
        return (startPage..endPage).filter { !cache.containsKey(it) }
    }
}
