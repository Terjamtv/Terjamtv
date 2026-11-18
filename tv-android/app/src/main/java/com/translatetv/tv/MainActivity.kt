package com.translatetv.tv

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.google.zxing.BarcodeFormat
import com.journeyapps.barcodescanner.BarcodeEncoder
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

class MainActivity : AppCompatActivity() {

    private val REQUEST_OVERLAY_PERMISSION = 1001
    private val REQUEST_MEDIA_PROJECTION = 1002

    private val client = OkHttpClient()
    private val scope = CoroutineScope(Dispatchers.Main + Job())

    // Replace with your Cloudflare API url in production
    private val API_BASE = "http://10.0.2.2:8787" 

    private lateinit var ivQrCode: ImageView
    private lateinit var tvPairingCode: TextView
    private lateinit var tvStatus: TextView
    private lateinit var btnStartTranslation: Button

    private var deviceId: String? = null
    private var isPaired = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        ivQrCode = findViewById(R.id.ivQrCode)
        tvPairingCode = findViewById(R.id.tvPairingCode)
        tvStatus = findViewById(R.id.tvStatus)
        btnStartTranslation = findViewById(R.id.btnStartTranslation)

        btnStartTranslation.setOnClickListener {
            checkPermissionsAndStart()
        }

        initializePairing()
    }

    private fun initializePairing() {
        tvStatus.text = "جاري إنشاء رمز الاقتران..."

        scope.launch(Dispatchers.IO) {
            try {
                val json = JSONObject().apply {
                    put("device_type", "android_tv")
                    put("device_name", "Android TV (" + Build.MODEL + ")")
                    put("device_model", Build.DEVICE)
                }

                val body = json.toString().toRequestBody("application/json".toMediaType())
                val request = Request.Builder()
                    .url("$API_BASE/api/pair/init")
                    .post(body)
                    .build()

                val response = client.newCall(request).execute()
                val responseStr = response.body?.string() ?: ""
                val resObj = JSONObject(responseStr)

                deviceId = resObj.optString("device_id")
                val pairingCode = resObj.optString("pairing_code")
                val qrPayload = resObj.optString("qr_payload")

                // Generate QR Bitmap
                val barcodeEncoder = BarcodeEncoder()
                val bitmap: Bitmap = barcodeEncoder.encodeBitmap(qrPayload, BarcodeFormat.QR_CODE, 400, 400)

                withContext(Dispatchers.Main) {
                    tvPairingCode.text = pairingCode
                    ivQrCode.setImageBitmap(bitmap)
                    tvStatus.text = "في انتظار مسح رمز الـ QR من تطبيق الهاتف..."
                    startStatusPolling()
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    tvStatus.text = "تعذر الاتصال بالخادم: ${e.message}"
                }
            }
        }
    }

    private fun startStatusPolling() {
        scope.launch(Dispatchers.IO) {
            while (isActive && !isPaired) {
                delay(3000)
                if (deviceId == null) continue

                try {
                    val request = Request.Builder()
                        .url("$API_BASE/api/pair/status?device_id=$deviceId")
                        .get()
                        .build()

                    val response = client.newCall(request).execute()
                    val resObj = JSONObject(response.body?.string() ?: "")

                    if (resObj.optBoolean("paired")) {
                        isPaired = true
                        val userName = resObj.optString("user_name")
                        val tier = resObj.optString("tier")

                        withContext(Dispatchers.Main) {
                            tvStatus.text = "تم الاقتران بنجاح! مرحباً $userName ($tier)"
                            btnStartTranslation.isEnabled = true
                            Toast.makeText(this@MainActivity, "تم ربط التلفزيون بنجاح!", Toast.LENGTH_SHORT).show()
                        }
                    }
                } catch (e: Exception) {
                    // ignore network retry
                }
            }
        }
    }

    private fun checkPermissionsAndStart() {
        // 1. Check Floating Window (Overlay) Permission
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) {
            val intent = Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:$packageName")
            )
            startActivityForResult(intent, REQUEST_OVERLAY_PERMISSION)
            Toast.makeText(this, "يرجى منح إذن الظهور فوق التطبيقات لعرض شريط الترجمة", Toast.LENGTH_LONG).show()
            return
        }

        // 2. Request MediaProjection (Screen Capture) Permission
        val mediaProjectionManager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        startActivityForResult(mediaProjectionManager.createScreenCaptureIntent(), REQUEST_MEDIA_PROJECTION)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)

        if (requestCode == REQUEST_OVERLAY_PERMISSION) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && Settings.canDrawOverlays(this)) {
                checkPermissionsAndStart()
            } else {
                Toast.makeText(this, "الإذن مطلوب لعرض الترجمة!", Toast.LENGTH_SHORT).show()
            }
        } else if (requestCode == REQUEST_MEDIA_PROJECTION) {
            if (resultCode == Activity.RESULT_OK && data != null) {
                // Start Overlay Service
                val overlayIntent = Intent(this, TranslationOverlayService::class.java)
                startService(overlayIntent)

                // Start Screen Capture Service
                val captureIntent = Intent(this, ScreenCaptureService::class.java).apply {
                    putExtra("RESULT_CODE", resultCode)
                    putExtra("DATA", data)
                    putExtra("API_BASE", API_BASE)
                    putExtra("DEVICE_ID", deviceId)
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    startForegroundService(captureIntent)
                } else {
                    startService(captureIntent)
                }

                Toast.makeText(this, "بدأت الترجمة الفورية في الخلفية!", Toast.LENGTH_LONG).show()
                moveTaskToBack(true) // Minimize to let user view other apps/media
            } else {
                Toast.makeText(this, "تم رفض إذن التقاط الشاشة", Toast.LENGTH_SHORT).show()
            }
        }
    }
}
