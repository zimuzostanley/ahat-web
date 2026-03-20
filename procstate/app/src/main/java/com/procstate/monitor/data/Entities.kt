package com.procstate.monitor.data

import androidx.compose.runtime.Immutable
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "snapshots",
    indices = [Index("timestamp"), Index("sessionId")],
)
data class SnapshotEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val timestamp: Long,
    val sessionId: String = "",
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
        Index("timestamp", "name", "uid"),
    ],
)
data class ProcessEntryEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val snapshotId: Long,
    val timestamp: Long = 0,
    val pid: Int,
    val name: String,
    val uid: String = "",
    val procState: String,
    val frozen: Boolean = false,
)

@Entity(
    tableName = "memory_snapshots",
    indices = [
        Index("name", "uid"),
        Index("timestamp"),
        Index("pid"),
    ],
)
data class MemorySnapshotEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val timestamp: Long,
    val pid: Int,
    val name: String,
    val uid: String = "",
    val totalPssKb: Long = 0,
    val totalRssKb: Long = 0,
    val javaHeapKb: Long = 0,
    val nativeHeapKb: Long = 0,
    val codeKb: Long = 0,
    val stackKb: Long = 0,
    val graphicsKb: Long = 0,
    val systemKb: Long = 0,
    val totalSwapKb: Long = 0,
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
    val snapshotId: Long = 0,
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

@Immutable
data class ProcessKey(val name: String, val uid: String) {
    val shortName: String get() = name.substringAfterLast('.')

    fun serialize(): String = "$name|$uid"

    companion object {
        fun deserialize(s: String): ProcessKey {
            val parts = s.split("|", limit = 2)
            return ProcessKey(parts[0], parts.getOrElse(1) { "" })
        }
    }
}

@Immutable
data class SnapshotWithCounts(
    val id: Long,
    val timestamp: Long,
    val stateCounts: Map<String, Int>,
    val frozenCount: Int = 0,
) {
    val totalProcesses: Int get() = stateCounts.values.sum()
}

/** Process key with transition stats for the picker. */
/** OOM adj priority: higher = more important (user-facing). Based on Android ProcessList. */
val STATE_PRIORITY = mapOf(
    "sys" to 18, "pers" to 17, "psvc" to 16, "fg" to 15, "fgs" to 14,
    "vis" to 13, "prcp" to 12, "prcm" to 11, "prcl" to 10,
    "bkup" to 9, "hvy" to 8, "svc" to 7, "home" to 6, "prev" to 5,
    "svcb" to 4, "cch" to 3, "frzn" to 2, "ntv" to 1,
)

data class ProcessKeyWithTransitions(
    val key: ProcessKey,
    val transitions: Int,
    val starts: Int,
    val frozenCount: Int,
    val lastChangeMs: Long = 0,
    val lastChangePriority: Int = 0,
)

data class MemoryDotKey(
    val timestamp: Long,
    val name: String,
    val uid: String,
)

data class MemoryStatsAggregate(
    val count: Int,
    val minPss: Long, val maxPss: Long, val avgPss: Double,
    val minRss: Long, val maxRss: Long, val avgRss: Double,
    val minJavaHeap: Long, val maxJavaHeap: Long, val avgJavaHeap: Double,
    val minNativeHeap: Long, val maxNativeHeap: Long, val avgNativeHeap: Double,
    val minCode: Long, val maxCode: Long, val avgCode: Double,
    val minStack: Long, val maxStack: Long, val avgStack: Double,
    val minGraphics: Long, val maxGraphics: Long, val avgGraphics: Double,
    val minSystem: Long, val maxSystem: Long, val avgSystem: Double,
    val minSwap: Long, val maxSwap: Long, val avgSwap: Double,
)
