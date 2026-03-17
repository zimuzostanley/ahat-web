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

    /** Snapshots with per-state counts. Limited to 500 most recent. */
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

    /** Frozen count per snapshot. */
    @Query("""
        SELECT s.id, COUNT(*) as frozenCount
        FROM snapshots s
        JOIN process_entries pe ON s.id = pe.snapshotId
        WHERE pe.frozen = 1 AND s.id IN (
            SELECT id FROM snapshots
            WHERE timestamp >= :start
            ORDER BY timestamp DESC
            LIMIT 500
        )
        GROUP BY s.id
    """)
    fun getSnapshotFrozenCounts(start: Long): Flow<List<SnapshotFrozenRow>>

    /** All process entries for a single snapshot. */
    @Query("SELECT * FROM process_entries WHERE snapshotId = :snapshotId ORDER BY procState, name")
    suspend fun getEntriesForSnapshot(snapshotId: Long): List<ProcessEntryEntity>

    /**
     * Process state timeline filtered by names. UID filtering done in Kotlin
     * since Room doesn't support composite IN clauses.
     */
    @Query("""
        SELECT s.timestamp, pe.name, pe.pid, pe.uid, pe.procState, pe.frozen
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

    /** All distinct process name+uid pairs ever seen. */
    @Query("SELECT DISTINCT name, uid FROM process_entries ORDER BY name")
    fun getDistinctProcessKeys(): Flow<List<ProcessKeyRow>>

    @Query("SELECT COUNT(*) FROM snapshots")
    fun getSnapshotCount(): Flow<Int>

    @Query("DELETE FROM snapshots WHERE timestamp < :cutoff")
    suspend fun deleteOlderThan(cutoff: Long)

    @Query("DELETE FROM snapshots")
    suspend fun deleteAll()
}

/** Raw row from getDistinctProcessKeys. */
data class ProcessKeyRow(val name: String, val uid: String)
