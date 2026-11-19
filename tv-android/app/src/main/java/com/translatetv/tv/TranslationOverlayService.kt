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

    private var hideRunnable: Runnable? = null
    private val mainHandler = android.os.Handler(android.os.Looper.getMainLooper())

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
            y = 70 // 70px padding from the bottom
        }

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            // Semi-transparent rounded backdrop for PlayStation gaming HUD
            val shape = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#CC0B0F19")) // 80% dark slate
                cornerRadius = 24f
            }
            background = shape
            setPadding(48, 18, 48, 22)
            visibility = View.GONE // Hidden by default until subtitles appear
        }

        tvOriginal = TextView(this).apply {
            textSize = 17f
            setTextColor(Color.parseColor("#94A3B8")) // Subtle grey for original English
            gravity = Gravity.CENTER
            textDirection = View.TEXT_DIRECTION_LTR
            visibility = View.VISIBLE
            setShadowLayer(3f, 0f, 1f, Color.BLACK)
        }

        tvTranslated = TextView(this).apply {
            textSize = 30f
            setTextColor(Color.parseColor("#FDE047")) // High-contrast gaming yellow (GTA/Rockstar style)
            gravity = Gravity.CENTER
            textDirection = View.TEXT_DIRECTION_RTL
            paint.isFakeBoldText = true
            setShadowLayer(6f, 0f, 3f, Color.BLACK)
        }

        container.addView(tvOriginal)
        container.addView(tvTranslated)

        overlayView = container
        windowManager.addView(overlayView, params)
    }

    private var pixelShiftOffset = 0

    fun updateText(original: String, translated: String) {
        if (original.isBlank() && translated.isBlank()) return

        tvOriginal.text = original
        tvTranslated.text = translated
        overlayView?.visibility = View.VISIBLE

        // OLED Burn-in Protection: 2px micro-shift on each dialogue update
        try {
            pixelShiftOffset = (pixelShiftOffset + 2) % 6
            val params = overlayView?.layoutParams as? WindowManager.LayoutParams
            if (params != null) {
                params.y = 70 + pixelShiftOffset
                windowManager.updateViewLayout(overlayView, params)
            }
        } catch (ignored: Exception) {}

        // Auto-fade / Auto-hide subtitle after 4.5s if dialogue ends (Rockstar / GTA style)
        hideRunnable?.let { mainHandler.removeCallbacks(it) }
        hideRunnable = Runnable {
            overlayView?.visibility = View.GONE
        }
        mainHandler.postDelayed(hideRunnable!!, 4500)
    }

    override fun onDestroy() {
        super.onDestroy()
        hideRunnable?.let { mainHandler.removeCallbacks(it) }
        unregisterReceiver(subtitleReceiver)
        if (overlayView != null) {
            windowManager.removeView(overlayView)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
