package com.freetune

internal object SongFingerprint {
    init {
        System.loadLibrary("freetune_song_fingerprint")
    }

    external fun fingerprint(samples: ShortArray): String
}
