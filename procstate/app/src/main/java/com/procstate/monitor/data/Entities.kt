package com.procstate.monitor.data

import androidx.compose.runtime.Immutable
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(tableName = "snapshots")
data class SnapshotEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val timestamp: Long,
)

@Entity(
    tableName = "process_entries",
    foreignKeys = [ForeignKey(
        entity = SnapshotEntity::class,
        parentColumns = ["id"],
        childColumns = ["snapshotId"],
        onDelete = ForeignKey.CASCADE,
    )],
    indices = [
        Index("snapshotId"),
        Index("name"),
        Index("snapshotId", "procState", "name"),  // composite for ORDER BY
    ],
)
data class ProcessEntryEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val snapshotId: Long,
    val pid: Int,
    val name: String,
    val procState: String,
)

/** Row from the snapshot+state-count JOIN query. */
data class SnapshotStateRow(
    val id: Long,
    val timestamp: Long,
    val procState: String,
    val count: Int,
)

/** Row from the process timeline query. */
data class ProcessTimelineRow(
    val timestamp: Long,
    val name: String,
    val procState: String,
)

/** Grouped snapshot with its state counts (built in ViewModel from SnapshotStateRow). */
@Immutable
data class SnapshotWithCounts(
    val id: Long,
    val timestamp: Long,
    val stateCounts: Map<String, Int>,
) {
    val totalProcesses: Int get() = stateCounts.values.sum()
}
