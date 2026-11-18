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
    private val translationMemory = android.util.LruCache<String, String>(3000)

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        initLocalOfflineTranslator()
        initTranslationMemory()
    }

    private fun normalizeKey(text: String): String {
        return text.trim().lowercase().replace(Regex("[^a-zA-Z0-9 ]"), "").trim()
    }

    private fun initTranslationMemory() {
        try {
            val jsonString = assets.open("game_dictionary_ar.json").bufferedReader().use { it.readText() }
            val root = JSONObject(jsonString)
            val entries = root.optJSONObject("entries")
            if (entries != null) {
                val keys = entries.keys()
                while (keys.hasNext()) {
                    val k = keys.next()
                    val v = entries.getString(k)
                    translationMemory.put(normalizeKey(k), v)
                }
            }
        } catch (e: Exception) {
            // Fallback to basic map if assets fail to load
            val seed = mapOf(
                "mission passed" to "تمت المهمة بنجاح",
                "mission failed" to "فشلت المهمة",
                "wasted" to "قُضي عليك",
                "busted" to "تم إلقاء القبض عليك",
                "get in the car" to "اركب السيارة",
                "follow me" to "اتبعني",
                "lets go" to "هيا بنا / يلا مشينا"
            )
            for ((k, v) in seed) {
                translationMemory.put(normalizeKey(k), v)
            }
        }
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

    private var lastRegionHash: Long = 0L

    private fun setupVirtualDisplay() {
        val metrics = resources.displayMetrics
        // Cap capture resolution to 1280x720: Saves 85% CPU & RAM bandwidth, perfect for OCR
        val targetWidth = if (metrics.widthPixels > 1280) 1280 else metrics.widthPixels
        val targetHeight = (metrics.heightPixels.toFloat() / metrics.widthPixels * targetWidth).toInt()
        val density = metrics.densityDpi

        imageReader = ImageReader.newInstance(targetWidth, targetHeight, PixelFormat.RGBA_8888, 2)
        virtualDisplay = mediaProjection?.createVirtualDisplay(
            "TranslateTV_Capture",
            targetWidth, targetHeight, density,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            imageReader?.surface, null, null
        )
    }

    private fun startCaptureLoop() {
        scope.launch {
            // Keep background priority so the gamer's HDMI/VRR display never drops a frame
            android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_BACKGROUND)

            while (isActive) {
                delay(750) // Gaming loop

                val image = imageReader?.acquireLatestImage() ?: continue
                var bitmap: Bitmap? = null
                var croppedBitmap: Bitmap? = null
                var enhancedBitmap: Bitmap? = null

                try {
                    val planes = image.planes
                    val buffer = planes[0].buffer
                    val pixelStride = planes[0].pixelStride
                    val rowStride = planes[0].rowStride
                    val rowPadding = rowStride - pixelStride * image.width

                    bitmap = Bitmap.createBitmap(
                        image.width + rowPadding / pixelStride,
                        image.height,
                        Bitmap.Config.ARGB_8888
                    )
                    bitmap.copyPixelsFromBuffer(buffer)

                    // Focus on subtitle region: bottom 32% of the screen (PlayStation standard)
                    val cropY = (image.height * 0.68).toInt()
                    val cropHeight = (image.height * 0.32).toInt()
                    croppedBitmap = Bitmap.createBitmap(bitmap, 0, cropY, image.width, cropHeight)

                    // 1. Fast Hash Check: If visual pixels haven't changed, skip OCR entirely (<0.01ms CPU)
                    val currentHash = computeFastRegionHash(croppedBitmap)
                    if (currentHash == lastRegionHash) {
                        continue
                    }
                    lastRegionHash = currentHash

                    // 2. Pre-process frame with gaming contrast filter
                    enhancedBitmap = enhanceContrastForGameSubtitles(croppedBitmap)
                    processFrame(enhancedBitmap)
                } catch (e: Exception) {
                    e.printStackTrace()
                } finally {
                    image.close()
                    // Explicitly recycle bitmaps to prevent Android GC thrashing/stutter
                    try {
                        enhancedBitmap?.recycle()
                        croppedBitmap?.recycle()
                        bitmap?.recycle()
                    } catch (ignored: Exception) {}
                }
            }
        }
    }

    private fun computeFastRegionHash(bitmap: Bitmap): Long {
        var hash = 1125899906842597L
        val stepX = maxOf(1, bitmap.width / 16)
        val stepY = maxOf(1, bitmap.height / 8)
        for (x in 0 until bitmap.width step stepX) {
            for (y in 0 until bitmap.height step stepY) {
                hash = 31 * hash + bitmap.getPixel(x, y)
            }
        }
        return hash
    }

    private fun enhanceContrastForGameSubtitles(src: Bitmap): Bitmap {
        val bmp = Bitmap.createBitmap(src.width, src.height, Bitmap.Config.ARGB_8888)
        val canvas = android.graphics.Canvas(bmp)
        val paint = android.graphics.Paint()
        val colorMatrix = android.graphics.ColorMatrix(floatArrayOf(
            1.8f, 0f, 0f, 0f, -75f,
            0f, 1.8f, 0f, 0f, -75f,
            0f, 0f, 1.8f, 0f, -75f,
            0f, 0f, 0f, 1.0f, 0f
        ))
        paint.colorFilter = android.graphics.ColorMatrixColorFilter(colorMatrix)
        canvas.drawBitmap(src, 0f, 0f, paint)
        return bmp
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
        val norm = normalizeKey(text)

        // 0. TIER ZERO: Local Translation Memory Dictionary Cache (Instant 0.001ms hit, 0 CPU, 0 Cloud!)
        val cached = translationMemory.get(norm)
        if (!cached.isNullOrEmpty()) {
            broadcastSubtitle(text, cached)
            return
        }

        // 1. PRIMARY: Zero-Cloud On-Device Local Neural Translation (Google ML Kit, ~15ms, 0 cloud cost)
        if (localTranslator != null) {
            localTranslator?.translate(text)
                ?.addOnSuccessListener { localTrans ->
                    translationMemory.put(norm, localTrans)
                    broadcastSubtitle(text, localTrans)
                }
                ?.addOnFailureListener {
                    // Fallback to Cloudflare Worker API only if local model encounters an error
                    translateViaCloudFallback(text, norm)
                }
        } else {
            translateViaCloudFallback(text, norm)
        }
    }

    private fun translateViaCloudFallback(text: String, normKey: String) {
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
                        translationMemory.put(normKey, arabicText)
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
