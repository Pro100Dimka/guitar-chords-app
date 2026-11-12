package com.freetune

import java.io.File
import java.net.URI
import java.security.MessageDigest

/** Pure validation shared by Android import and native JVM regression tests. */
internal object SongAudioRules {
    fun file(directory: File, value: String): File {
        val candidate = when {
            value.startsWith("file://") -> File(URI(value))
            value.contains('/') -> File(value)
            else -> File(directory, value)
        }.canonicalFile
        require(candidate.parentFile == directory.canonicalFile &&
            candidate.name.matches(Regex("[0-9a-f]{64}\\.(mp3|wav|m4a)")))
        return candidate
    }

    fun format(header: ByteArray, size: Int): Pair<String, String>? {
        if (size < 12 || header.size < 12) return null
        return when {
            String(header, 0, 4, Charsets.US_ASCII) == "RIFF" &&
                String(header, 8, 4, Charsets.US_ASCII) == "WAVE" -> Pair("wav", "audio/wav")
            String(header, 4, 4, Charsets.US_ASCII) == "ftyp" -> Pair("m4a", "audio/mp4")
            String(header, 0, 3, Charsets.US_ASCII) == "ID3" ||
                ((header[0].toInt() and 255) == 255 && (header[1].toInt() and 224) == 224 &&
                    (header[1].toInt() and 6) != 0 && (header[1].toInt() and 24) != 8) -> Pair("mp3", "audio/mpeg")
            else -> null
        }
    }

    fun loop(start: Double?, end: Double?, duration: Int): Pair<Int, Int>? {
        if (start == null && end == null) return null
        require(start != null && end != null && start.isFinite() && end.isFinite() &&
            start >= 0 && end <= duration && end - start >= 100)
        return Pair(start.toInt(), end.toInt())
    }

    fun checksum(file: File, checkpoint: () -> Unit = {}): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(128 * 1024)
            while (true) {
                checkpoint()
                val count = input.read(buffer)
                if (count < 0) break
                digest.update(buffer, 0, count)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    /** Commit only a fully validated copy; a filename alone is not deduplication proof. */
    fun commitCopy(staging: File, destination: File, sha: String, checkpoint: () -> Unit = {}) {
        require(staging.canonicalFile.parentFile == destination.canonicalFile.parentFile)
        val reusable = destination.isFile && destination.length() == staging.length() &&
            checksum(destination, checkpoint) == sha
        checkpoint()
        if (reusable) staging.delete()
        // Both files are in one app-private directory: Android's rename replaces
        // a damaged previous copy atomically, with no delete-before-rename gap.
        else check(staging.renameTo(destination)) { "Cannot save the recording" }
    }
}
