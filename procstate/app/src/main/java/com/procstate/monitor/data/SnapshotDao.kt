package com.procstate.monitor.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query
import androidx.room.Transaction
import kotlinx.coroutines.flow.Flow

@Dao
interface SnapshotDao {

    @Insert
    suspend fun insertSnapshot(snapshot: SnapshotEntity): Long

    @Insert
    suspend fun insertEntries(entries: List<ProcessEntryEntity>)

    @Transaction
    suspend fun insertSnapshotWithEntries(snapshot: SnapshotEntity, entries: List<ProcessEntryEntity>): Long {
        val id = insertSnapshot(snapshot)
        val withId = entries.map { it.copy(snapshotId = id) }
        insertEntries(withId)
        return id
    }

    @Query("""
        SELECT s.id, s.timestamp, pe.procState, COUNT(*) as count
        FROM snapshots s
        JOIN process_entries pe ON s.id = pe.snapshotId
        WHERE s.id IN (
            SELECT id FROM snapshots WHERE timestamp >= :start
            ORDER BY timestamp DESC LIMIT 500
        )
        GROUP BY s.id, pe.procState
        ORDER BY s.timestamp DESC
    """)
    fun getSnapshotStateCounts(start: Long): Flow<List<SnapshotStateRow>>

    @Query("""
        SELECT s.id, COUNT(*) as frozenCount
        FROM snapshots s
        JOIN process_entries pe ON s.id = pe.snapshotId
        WHERE pe.frozen = 1 AND s.id IN (
            SELECT id FROM snapshots WHERE timestamp >= :start
            ORDER BY timestamp DESC LIMIT 500
        )
        GROUP BY s.id
    """)
    fun getSnapshotFrozenCounts(start: Long): Flow<List<SnapshotFrozenRow>>

    @Query("SELECT * FROM process_entries WHERE snapshotId = :snapshotId ORDER BY procState, name")
    suspend fun getEntriesForSnapshot(snapshotId: Long): List<ProcessEntryEntity>

    /** Process timeline with snapshotId for memory enrichment. */
    @Query("""
        SELECT s.timestamp, s.id as snapshotId, pe.name, pe.pid, pe.uid, pe.procState, pe.frozen
        FROM snapshots s
        JOIN process_entries pe ON s.id = pe.snapshotId
        WHERE pe.name IN (:names) AND s.id IN (
            SELECT id FROM snapshots WHERE timestamp >= :start
            ORDER BY timestamp DESC LIMIT 500
        )
        ORDER BY s.timestamp ASC
    """)
    fun getProcessTimeline(names: List<String>, start: Long): Flow<List<ProcessTimelineRow>>

    @Query("SELECT DISTINCT name, uid FROM process_entries ORDER BY name")
    fun getDistinctProcessKeys(): Flow<List<ProcessKeyRow>>

    @Query("""
        SELECT timestamp FROM snapshots WHERE timestamp >= :start
        ORDER BY timestamp DESC LIMIT 500
    """)
    fun getSnapshotTimestamps(start: Long): Flow<List<Long>>

    @Query("""
        SELECT s.timestamp, 0 as snapshotId, pe.name, pe.pid, pe.uid, pe.procState, pe.frozen
        FROM snapshots s
        JOIN process_entries pe ON s.id = pe.snapshotId
        WHERE s.timestamp >= :start
        ORDER BY pe.name, pe.uid, s.timestamp
    """)
    suspend fun getAllEntriesForExport(start: Long): List<ProcessTimelineRow>

    @Query("SELECT timestamp FROM snapshots WHERE timestamp >= :start ORDER BY timestamp")
    suspend fun getAllTimestampsForExport(start: Long): List<Long>

    /** All entries in range for transition counting (lightweight: just name, uid, pid, procState, timestamp). */
    @Query("""
        SELECT s.timestamp, 0 as snapshotId, pe.name, pe.pid, pe.uid, pe.procState, pe.frozen
        FROM snapshots s
        JOIN process_entries pe ON s.id = pe.snapshotId
        WHERE s.timestamp >= :start
        ORDER BY pe.name, pe.uid, s.timestamp
    """)
    fun getAllEntriesInRange(start: Long): Flow<List<ProcessTimelineRow>>

    @Query("SELECT COUNT(*) FROM snapshots")
    fun getSnapshotCount(): Flow<Int>

    @Query("DELETE FROM snapshots WHERE timestamp < :cutoff")
    suspend fun deleteSnapshotsOlderThan(cutoff: Long)

    @Query("DELETE FROM memory_snapshots WHERE timestamp < :cutoff")
    suspend fun deleteMemoryOlderThan(cutoff: Long)

    @Transaction
    suspend fun deleteOlderThan(cutoff: Long) {
        deleteMemoryOlderThan(cutoff)
        deleteSnapshotsOlderThan(cutoff)
    }

    @Query("DELETE FROM snapshots")
    suspend fun deleteAllSnapshots()

    @Query("DELETE FROM memory_snapshots")
    suspend fun deleteAllMemory()

    @Transaction
    suspend fun deleteAll() {
        deleteAllMemory()
        deleteAllSnapshots()
    }

    // ── Memory snapshots ────────────────────────────────────────────────────

    @Insert
    suspend fun insertMemorySnapshot(snapshot: MemorySnapshotEntity): Long

    /** Get memory for a specific process at a timestamp (within 5s window). */
    @Query("""
        SELECT * FROM memory_snapshots
        WHERE name = :name AND uid = :uid AND pid = :pid
            AND ABS(timestamp - :timestamp) < 5000
        ORDER BY ABS(timestamp - :timestamp)
        LIMIT 1
    """)
    suspend fun getMemoryForDot(name: String, uid: String, pid: Int, timestamp: Long): MemorySnapshotEntity?

    /** Timestamps+name+uid that have memory data (for dot border rendering). */
    @Query("""
        SELECT DISTINCT timestamp, name, uid FROM memory_snapshots
        WHERE timestamp >= :start
    """)
    fun getMemoryEnrichedDots(start: Long): Flow<List<MemoryDotKey>>

    /** Memory summary stats for a process, from start up to a specific timestamp. */
    @Query("""
        SELECT
            COUNT(*) as count,
            MIN(totalPssKb) as minPss, MAX(totalPssKb) as maxPss, AVG(totalPssKb) as avgPss,
            MIN(totalRssKb) as minRss, MAX(totalRssKb) as maxRss, AVG(totalRssKb) as avgRss,
            MIN(javaHeapKb) as minJavaHeap, MAX(javaHeapKb) as maxJavaHeap, AVG(javaHeapKb) as avgJavaHeap,
            MIN(nativeHeapKb) as minNativeHeap, MAX(nativeHeapKb) as maxNativeHeap, AVG(nativeHeapKb) as avgNativeHeap,
            MIN(codeKb) as minCode, MAX(codeKb) as maxCode, AVG(codeKb) as avgCode,
            MIN(stackKb) as minStack, MAX(stackKb) as maxStack, AVG(stackKb) as avgStack,
            MIN(graphicsKb) as minGraphics, MAX(graphicsKb) as maxGraphics, AVG(graphicsKb) as avgGraphics,
            MIN(systemKb) as minSystem, MAX(systemKb) as maxSystem, AVG(systemKb) as avgSystem,
            MIN(totalSwapKb) as minSwap, MAX(totalSwapKb) as maxSwap, AVG(totalSwapKb) as avgSwap
        FROM memory_snapshots
        WHERE name = :name AND uid = :uid AND timestamp >= :start AND timestamp <= :end
    """)
    suspend fun getMemoryStats(name: String, uid: String, start: Long, end: Long): MemoryStatsAggregate?

    /** All memory snapshots for export. */
    @Query("""
        SELECT * FROM memory_snapshots
        WHERE timestamp >= :start
        ORDER BY name, uid, timestamp
    """)
    suspend fun getAllMemoryForExport(start: Long): List<MemorySnapshotEntity>
}

data class ProcessKeyRow(val name: String, val uid: String)
