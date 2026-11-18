package com.translatetv.tv

import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Build
import android.os.IBinder
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView

class TranslationOverlayService : Service() {

    private lateinit var windowManager: WindowManager
    private var overlayView: View? = null
    private lateinit var tvTranslated: TextView
    private lateinit var tvOriginal: TextView

    companion object {
        const val ACTION_UPDATE_SUBTITLE = "com.translatetv.tv.ACTION_UPDATE_SUBTITLE"
        const val EXTRA_ORIGINAL = "EXTRA_ORIGINAL"
        const val EXTRA_TRANSLATED = "EXTRA_TRANSLATED"
    }

    private val subtitleReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == ACTION_UPDATE_SUBTITLE) {
                val orig = intent.getStringExtra(EXTRA_ORIGINAL) ?: ""
                val trans = intent.getStringExtra(EXTRA_TRANSLATED) ?: ""
                updateText(orig, trans)
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        createOverlayView()

        val filter = IntentFilter(ACTION_UPDATE_SUBTITLE)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(subtitleReceiver, filter, RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(subtitleReceiver, filter)
        }
    }

    private fun createOverlayView() {
        val layoutType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            WindowManager.LayoutParams.TYPE_PHONE
        }

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            layoutType,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                    WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                    WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
            y = 60 // 60px padding from the bottom
        }

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#D90B1120")) // 85% transparent dark
            setPadding(40, 20, 40, 24)
        }

        tvOriginal = TextView(this).apply {
            textSize = 18f
            setTextColor(Color.parseColor("#94A3B8"))
            gravity = Gravity.CENTER
            textDirection = View.TEXT_DIRECTION_LTR
            visibility = View.VISIBLE
        }

        tvTranslated = TextView(this).apply {
            textSize = 28f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            textDirection = View.TEXT_DIRECTION_RTL
            paint.isFakeBoldText = true
            setShadowLayer(4f, 0f, 2f, Color.BLACK)
        }

        container.addView(tvOriginal)
        container.addView(tvTranslated)

        overlayView = container
        windowManager.addView(overlayView, params)
    }

    fun updateText(original: String, translated: String) {
        tvOriginal.text = original
        tvTranslated.text = translated
    }

    override fun onDestroy() {
        super.onDestroy()
        unregisterReceiver(subtitleReceiver)
        if (overlayView != null) {
            windowManager.removeView(overlayView)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
