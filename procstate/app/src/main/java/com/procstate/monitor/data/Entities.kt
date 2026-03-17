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
        Index("name", "uid"),
        Index("snapshotId", "procState", "name"),
    ],
)
data class ProcessEntryEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val snapshotId: Long,
    val pid: Int,
    val name: String,
    val uid: String = "",
    val procState: String,
    val frozen: Boolean = false,
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
    val pid: Int = 0,
    val uid: String = "",
    val procState: String,
    val frozen: Boolean = false,
)

/** Frozen count per snapshot. */
data class SnapshotFrozenRow(
    val id: Long,
    val frozenCount: Int,
)

/**
 * Composite key for pinning: identifies a unique process across restarts.
 * Serialized as "name|uid" for persistence.
 */
@Immutable
data class ProcessKey(val name: String, val uid: String) {
    /** Short display name (last component of package). */
    val shortName: String get() = name.substringAfterLast('.')

    fun serialize(): String = "$name|$uid"

    companion object {
        fun deserialize(s: String): ProcessKey {
            val parts = s.split("|", limit = 2)
            return ProcessKey(parts[0], parts.getOrElse(1) { "" })
        }
    }
}

/** Grouped snapshot with its state counts (built in ViewModel from SnapshotStateRow). */
@Immutable
data class SnapshotWithCounts(
    val id: Long,
    val timestamp: Long,
    val stateCounts: Map<String, Int>,
    val frozenCount: Int = 0,
) {
    val totalProcesses: Int get() = stateCounts.values.sum()
}
