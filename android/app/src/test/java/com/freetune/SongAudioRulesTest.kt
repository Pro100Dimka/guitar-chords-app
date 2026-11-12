package com.freetune

import java.io.File
import java.nio.file.Files
import org.junit.Assert.*
import org.junit.Test

class SongAudioRulesTest {
    @Test fun actualSignaturesOverrideTheFilename() {
        assertEquals(Pair("wav", "audio/wav"), SongAudioRules.format("RIFF0000WAVE0000".toByteArray(), 16))
        assertEquals(Pair("m4a", "audio/mp4"), SongAudioRules.format("0000ftypM4A 0000".toByteArray(), 16))
        assertEquals(Pair("mp3", "audio/mpeg"), SongAudioRules.format("ID30000000000000".toByteArray(), 16))
        val mp3 = ByteArray(16).apply { this[0] = 0xff.toByte(); this[1] = 0xfb.toByte() }
        assertEquals("mp3", SongAudioRules.format(mp3, mp3.size)?.first)
        val rawAac = ByteArray(16).apply { this[0] = 0xff.toByte(); this[1] = 0xf1.toByte() }
        assertNull(SongAudioRules.format(rawAac, rawAac.size))
        assertNull(SongAudioRules.format("RIFF0000AVI 0000".toByteArray(), 16))
        assertNull(SongAudioRules.format("ID3".toByteArray(), 3))
        assertNull(SongAudioRules.format(ByteArray(16), 16))
    }

    @Test fun importedAudioPathsStayInsideTheLibrary() {
        val directory = Files.createTempDirectory("freetune-audio-test").toFile()
        try {
            val name = "a".repeat(64) + ".mp3"
            val expected = File(directory, name).canonicalFile
            assertEquals(expected, SongAudioRules.file(directory, name))
            assertEquals(expected, SongAudioRules.file(directory, expected.absolutePath))
            assertEquals(expected, SongAudioRules.file(directory, expected.toURI().toString().replace("file:/", "file:///")))
            for (value in listOf("../$name", "${directory.parent}/$name", "song.mp3", "${"a".repeat(64)}.exe")) {
                assertThrows(IllegalArgumentException::class.java) { SongAudioRules.file(directory, value) }
            }
            val external = Files.createTempDirectory("freetune-audio-outside").toFile()
            try {
                val outside = File(external, name).apply { writeText("fixture") }
                Files.createSymbolicLink(expected.toPath(), outside.toPath())
                assertThrows(IllegalArgumentException::class.java) { SongAudioRules.file(directory, name) }
            } finally { external.deleteRecursively() }
        } finally { directory.deleteRecursively() }
    }

    @Test fun loopsKeepOriginalMillisecondsAndRejectInvalidIntervals() {
        assertEquals(Pair(4237, 7811), SongAudioRules.loop(4237.0, 7811.0, 120000))
        assertEquals(Pair(0, 120000), SongAudioRules.loop(0.0, 120000.0, 120000))
        assertNull(SongAudioRules.loop(null, null, 120000))
        val invalid = listOf(Pair(null, 1000.0), Pair(0.0, null), Pair(-1.0, 1000.0),
            Pair(2000.0, 1000.0), Pair(0.0, 120001.0), Pair(1000.0, 1099.0),
            Pair(Double.NaN, 1000.0), Pair(0.0, Double.POSITIVE_INFINITY))
        for ((start, end) in invalid) {
            assertThrows(IllegalArgumentException::class.java) { SongAudioRules.loop(start, end, 120000) }
        }
    }

    @Test fun reimportRepairsDamagedCopiesWithoutDeletingGoodFilesOnCancel() {
        val directory = Files.createTempDirectory("freetune-relink-test").toFile()
        try {
            val staging = File(directory, "copy.part").apply { writeText("original audio fixture") }
            val sha = SongAudioRules.checksum(staging)
            val destination = File(directory, "$sha.wav").apply { writeText("corrupt") }
            SongAudioRules.commitCopy(staging, destination, sha)
            assertEquals(sha, SongAudioRules.checksum(destination))
            assertFalse(staging.exists())
            // Same-length corruption also has to be checked, rather than accepted by size.
            staging.writeBytes(destination.readBytes())
            destination.writeBytes(ByteArray(staging.length().toInt()) { 42 })
            SongAudioRules.commitCopy(staging, destination, sha)
            assertEquals(sha, SongAudioRules.checksum(destination))
            staging.writeBytes(destination.readBytes())
            assertThrows(IllegalStateException::class.java) {
                SongAudioRules.commitCopy(staging, destination, sha) { error("Canceled") }
            }
            assertEquals(sha, SongAudioRules.checksum(destination))
            assertTrue(staging.exists())
        } finally { directory.deleteRecursively() }
    }
}
