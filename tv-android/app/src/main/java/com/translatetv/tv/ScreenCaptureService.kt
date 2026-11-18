package com.translatetv.tv

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.google.mlkit.nl.translate.TranslateLanguage
import com.google.mlkit.nl.translate.Translation
import com.google.mlkit.nl.translate.Translator
import com.google.mlkit.nl.translate.TranslatorOptions
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

class ScreenCaptureService : Service() {

    private val CHANNEL_ID = "TranslateTV_ScreenCapture"
    private val NOTIF_ID = 101

    private var mediaProjection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null

    private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    private var localTranslator: Translator? = null

    private val httpClient = OkHttpClient()
    private val scope = CoroutineScope(Dispatchers.IO + Job())

    private var apiBase: String = "https://translatetv-api.honda-druid.workers.dev"
    private var deviceId: String? = null
    private var lastRecognizedText: String = ""

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        initLocalOfflineTranslator()
    }

    private fun initLocalOfflineTranslator() {
        val options = TranslatorOptions.Builder()
            .setSourceLanguage(TranslateLanguage.ENGLISH)
            .setTargetLanguage(TranslateLanguage.ARABIC)
            .build()
        localTranslator = Translation.getClient(options)
        localTranslator?.downloadModelIfNeeded()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = createNotification()
        startForeground(NOTIF_ID, notification)

        val resultCode = intent?.getIntExtra("RESULT_CODE", 0) ?: 0
        val data = intent?.getParcelableExtra<Intent>("DATA")
        apiBase = intent?.getStringExtra("API_BASE") ?: apiBase
        deviceId = intent?.getStringExtra("DEVICE_ID")

        if (resultCode != 0 && data != null) {
            val projectionManager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            mediaProjection = projectionManager.getMediaProjection(resultCode, data)
            setupVirtualDisplay()
            startCaptureLoop()
        }

        return START_STICKY
    }

    private fun setupVirtualDisplay() {
        val metrics = resources.displayMetrics
        val width = metrics.widthPixels
        val height = metrics.heightPixels
        val density = metrics.densityDpi

        imageReader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2)
        virtualDisplay = mediaProjection?.createVirtualDisplay(
            "TranslateTV_Capture",
            width, height, density,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            imageReader?.surface, null, null
        )
    }

    private fun startCaptureLoop() {
        scope.launch {
            while (isActive) {
                delay(1500) // Capture frame every 1.5 seconds

                val image = imageReader?.acquireLatestImage() ?: continue
                try {
                    val planes = image.planes
                    val buffer = planes[0].buffer
                    val pixelStride = planes[0].pixelStride
                    val rowStride = planes[0].rowStride
                    val rowPadding = rowStride - pixelStride * image.width

                    val bitmap = Bitmap.createBitmap(
                        image.width + rowPadding / pixelStride,
                        image.height,
                        Bitmap.Config.ARGB_8888
                    )
                    bitmap.copyPixelsFromBuffer(buffer)

                    // Focus on subtitle region: bottom 35% of the screen
                    val cropY = (image.height * 0.65).toInt()
                    val cropHeight = (image.height * 0.35).toInt()
                    val croppedBitmap = Bitmap.createBitmap(bitmap, 0, cropY, image.width, cropHeight)

                    processFrame(croppedBitmap)
                } catch (e: Exception) {
                    e.printStackTrace()
                } finally {
                    image.close()
                }
            }
        }
    }

    private fun processFrame(bitmap: Bitmap) {
        val inputImage = InputImage.fromBitmap(bitmap, 0)
        recognizer.process(inputImage)
            .addOnSuccessListener { visionText ->
                val detectedText = visionText.text.trim().replace("\n", " ")

                // Check if text is non-empty and not a duplicate/minor jitter of previous text
                if (detectedText.length > 3 && !isSimilarToLast(detectedText, lastRecognizedText)) {
                    lastRecognizedText = detectedText
                    translateAndBroadcast(detectedText)
                }
            }
    }

    private fun isSimilarToLast(newText: String, lastText: String): Boolean {
        if (lastText.isEmpty()) return false
        if (newText.equals(lastText, ignoreCase = true)) return true
        val maxLen = maxOf(newText.length, lastText.length)
        if (maxLen == 0) return true
        val distance = computeLevenshteinDistance(newText, lastText)
        val similarity = 1.0 - (distance.toDouble() / maxLen.toDouble())
        return similarity >= 0.80 // 80% similar = identical game dialogue line (saves 85% redundant compute)
    }

    private fun computeLevenshteinDistance(s1: String, s2: String): Int {
        val dp = Array(s1.length + 1) { IntArray(s2.length + 1) }
        for (i in 0..s1.length) dp[i][0] = i
        for (j in 0..s2.length) dp[0][j] = j
        for (i in 1..s1.length) {
            for (j in 1..s2.length) {
                val cost = if (s1[i - 1].equals(s2[j - 1], ignoreCase = true)) 0 else 1
                dp[i][j] = minOf(
                    dp[i - 1][j] + 1,
                    dp[i][j - 1] + 1,
                    dp[i - 1][j - 1] + cost
                )
            }
        }
        return dp[s1.length][s2.length]
    }

    private fun translateAndBroadcast(text: String) {
        // 1. PRIMARY: Zero-Cloud On-Device Local Neural Translation (Google ML Kit, ~15ms, 0 cloud cost)
        if (localTranslator != null) {
            localTranslator?.translate(text)
                ?.addOnSuccessListener { localTrans ->
                    broadcastSubtitle(text, localTrans)
                }
                ?.addOnFailureListener {
                    // Fallback to Cloudflare Worker API only if local model encounters an error
                    translateViaCloudFallback(text)
                }
        } else {
            translateViaCloudFallback(text)
        }
    }

    private fun translateViaCloudFallback(text: String) {
        scope.launch {
            try {
                val json = JSONObject().apply {
                    put("text", text)
                    put("source_lang", "en")
                    put("target_lang", "ar")
                    if (deviceId != null) put("device_id", deviceId)
                }
                val body = json.toString().toRequestBody("application/json".toMediaType())
                val request = Request.Builder()
                    .url("$apiBase/api/translate")
                    .post(body)
                    .build()

                val response = httpClient.newCall(request).execute()
                if (response.isSuccessful) {
                    val resJson = JSONObject(response.body?.string() ?: "")
                    val arabicText = resJson.optString("translated_text")
                    if (!arabicText.isNullOrEmpty()) {
                        broadcastSubtitle(text, arabicText)
                    }
                }
            } catch (e: Exception) {
                // Network issue or offline
            }
        }
    }

    private fun broadcastSubtitle(original: String, translated: String) {
        val intent = Intent(TranslationOverlayService.ACTION_UPDATE_SUBTITLE).apply {
            putExtra(TranslationOverlayService.EXTRA_ORIGINAL, original)
            putExtra(TranslationOverlayService.EXTRA_TRANSLATED, translated)
        }
        sendBroadcast(intent)
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "TranslateTV Screen Service",
                NotificationManager.IMPORTANCE_LOW
            )
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun createNotification(): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("TranslateTV نشط")
            .setContentText("جاري التقاط وترجمة ما يظهر على الشاشة للعربية...")
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    override fun onDestroy() {
        super.onDestroy()
        virtualDisplay?.release()
        mediaProjection?.stop()
        imageReader?.close()
        localTranslator?.close()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
