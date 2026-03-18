package com.procstate.monitor.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(
    entities = [SnapshotEntity::class, ProcessEntryEntity::class, MemorySnapshotEntity::class],
    version = 5,
    exportSchema = false,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun snapshotDao(): SnapshotDao

    companion object {
        @Volatile private var instance: AppDatabase? = null

        private val MIGRATION_4_5 = object : Migration(4, 5) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_snapshots_timestamp` ON `snapshots` (`timestamp`)")
            }
        }

        fun get(context: Context): AppDatabase =
            instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "procstate.db",
                )
                    .addMigrations(MIGRATION_4_5)
                    .build()
                    .also { instance = it }
            }
    }
}
