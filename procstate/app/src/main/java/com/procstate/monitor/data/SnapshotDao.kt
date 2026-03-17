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

    /** Atomic insert of snapshot + entries in a single transaction. */
    @Transaction
    suspend fun insertSnapshotWithEntries(snapshot: SnapshotEntity, entries: List<ProcessEntryEntity>): Long {
        val id = insertSnapshot(snapshot)
        val withId = entries.map { it.copy(snapshotId = id) }
        insertEntries(withId)
        return id
    }

    /**
     * Snapshots with per-state counts since a start time.
     * No upper bound — Room's InvalidationTracker re-emits on every insert,
     * so new snapshots appear immediately without needing a ticker.
     * Limited to 500 most recent to prevent OOM.
     */
    @Query("""
        SELECT s.id, s.timestamp, pe.procState, COUNT(*) as count
        FROM snapshots s
        JOIN process_entries pe ON s.id = pe.snapshotId
        WHERE s.id IN (
            SELECT id FROM snapshots
            WHERE timestamp >= :start
            ORDER BY timestamp DESC
            LIMIT 500
        )
        GROUP BY s.id, pe.procState
        ORDER BY s.timestamp DESC
    """)
    fun getSnapshotStateCounts(start: Long): Flow<List<SnapshotStateRow>>

    /** All process entries for a single snapshot (for expanded breakdown). */
    @Query("SELECT * FROM process_entries WHERE snapshotId = :snapshotId ORDER BY procState, name")
    suspend fun getEntriesForSnapshot(snapshotId: Long): List<ProcessEntryEntity>

    /**
     * Process state timeline for specific process names since a start time.
     * Limited to 500 most recent snapshots.
     */
    @Query("""
        SELECT s.timestamp, pe.name, pe.procState
        FROM snapshots s
        JOIN process_entries pe ON s.id = pe.snapshotId
        WHERE pe.name IN (:names) AND s.id IN (
            SELECT id FROM snapshots
            WHERE timestamp >= :start
            ORDER BY timestamp DESC
            LIMIT 500
        )
        ORDER BY s.timestamp ASC
    """)
    fun getProcessTimeline(names: List<String>, start: Long): Flow<List<ProcessTimelineRow>>

    /** All distinct process names ever seen (for search/selection). */
    @Query("SELECT DISTINCT name FROM process_entries ORDER BY name")
    fun getDistinctProcessNames(): Flow<List<String>>

    /** Total snapshot count (for stats display). */
    @Query("SELECT COUNT(*) FROM snapshots")
    fun getSnapshotCount(): Flow<Int>

    /** Delete old snapshots before a cutoff timestamp. */
    @Query("DELETE FROM snapshots WHERE timestamp < :cutoff")
    suspend fun deleteOlderThan(cutoff: Long)

    /** Delete all data. */
    @Query("DELETE FROM snapshots")
    suspend fun deleteAll()
}
