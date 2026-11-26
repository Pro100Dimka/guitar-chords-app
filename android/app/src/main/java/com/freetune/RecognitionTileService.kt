package com.freetune

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

class RecognitionTileService : TileService() {
    override fun onStartListening() {
        qsTile?.apply { label = getString(R.string.recognition_tile); state = Tile.STATE_INACTIVE; updateTile() }
    }
    override fun onClick() {
        unlockAndRun {
            val intent = recognitionIntent(this, true)
            if (Build.VERSION.SDK_INT >= 34) {
                startActivityAndCollapse(PendingIntent.getActivity(this, 1, intent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
            } else {
                @Suppress("DEPRECATION")
                startActivityAndCollapse(intent)
            }
        }
    }
    companion object {
        fun recognitionIntent(context: Context, autoStart: Boolean): Intent {
            val uri = Uri.parse("freetune://recognize/auto").buildUpon()
                .appendQueryParameter("autoStart", autoStart.toString())
            if (autoStart) uri.appendQueryParameter("requestId", System.nanoTime().toString())
            return Intent(Intent.ACTION_VIEW, uri.build(), context, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        }
    }
}
