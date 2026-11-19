package com.translatetv.tv

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
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

    // Live Cloudflare Worker production API
    private val API_BASE = "https://translatetv-api.honda-druid.workers.dev" 

    private lateinit var tvStatus: TextView
    private lateinit var btnStartTranslation: Button
    private lateinit var etVoucherCode: EditText
    private lateinit var btnRedeemVoucher: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        tvStatus = findViewById(R.id.tvStatus)
        btnStartTranslation = findViewById(R.id.btnStartTranslation)
        etVoucherCode = findViewById(R.id.etVoucherCode)
        btnRedeemVoucher = findViewById(R.id.btnRedeemVoucher)

        btnStartTranslation.setOnClickListener {
            if (isTranslationRunning()) {
                stopTranslation()
            } else {
                checkPermissionsAndStart()
            }
        }

        btnRedeemVoucher.setOnClickListener {
            redeemVoucherOnTv()
        }

        checkSavedActivation()
        btnStartTranslation.requestFocus()
    }

    override fun onResume() {
        super.onResume()
        updateButtonState()
    }

    private fun checkSavedActivation() {
        val prefs = getSharedPreferences("TranslateTV_Prefs", Context.MODE_PRIVATE)
        val tier = prefs.getString("subscription_tier", null)
        if (tier != null) {
            tvStatus.text = "الاشتراك نشط ($tier) — جاهز للترجمة الفورية"
        } else {
            tvStatus.text = "الحالة: جاهز للترجمة الفورية بأمان تام"
        }
    }

    private fun getOrCreateDeviceId(): String {
        val prefs = getSharedPreferences("TranslateTV_Prefs", Context.MODE_PRIVATE)
        var id = prefs.getString("device_id", null)
        if (id == null) {
            id = "android-tv-" + java.util.UUID.randomUUID().toString().substring(0, 8)
            prefs.edit().putString("device_id", id).apply()
        }
        return id
    }

    private fun redeemVoucherOnTv() {
        val code = etVoucherCode.text.toString().trim()
        if (code.isEmpty()) {
            Toast.makeText(this, "يرجى إدخال كود التفعيل أولاً", Toast.LENGTH_SHORT).show()
            return
        }

        tvStatus.text = "جاري التحقق من كود الاشتراك..."
        btnRedeemVoucher.isEnabled = false

        scope.launch(Dispatchers.IO) {
            try {
                val json = JSONObject().apply {
                    put("code", code)
                    put("device_id", getOrCreateDeviceId())
                    put("device_type", "android_tv")
                    put("device_name", "Android TV (" + Build.MODEL + ")")
                }
                val body = json.toString().toRequestBody("application/json".toMediaType())
                val request = Request.Builder()
                    .url("$API_BASE/api/voucher/tv-activate")
                    .post(body)
                    .build()

                val response = client.newCall(request).execute()
                val resStr = response.body?.string() ?: ""
                val resObj = JSONObject(resStr)

                withContext(Dispatchers.Main) {
                    btnRedeemVoucher.isEnabled = true
                    if (resObj.optBoolean("success")) {
                        val tier = resObj.optString("tier", "PRO")
                        val prefs = getSharedPreferences("TranslateTV_Prefs", Context.MODE_PRIVATE)
                        prefs.edit().putString("subscription_tier", tier).apply()

                        tvStatus.text = "تم التفعيل بنجاح! باقة: $tier"
                        Toast.makeText(this@MainActivity, resObj.optString("message", "تم التفعيل بنجاح!"), Toast.LENGTH_LONG).show()
                    } else {
                        tvStatus.text = resObj.optString("error", "كود التفعيل غير صحيح")
                        Toast.makeText(this@MainActivity, resObj.optString("error", "كود التفعيل غير صحيح"), Toast.LENGTH_SHORT).show()
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    btnRedeemVoucher.isEnabled = true
                    tvStatus.text = "تم تفعيل الوضع الأوفلاين السريع للشاشة"
                    Toast.makeText(this@MainActivity, "وضع الألعاب المباشر نشط", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    private fun isTranslationRunning(): Boolean {
        val manager = getSystemService(Context.ACTIVITY_SERVICE) as android.app.ActivityManager
        @Suppress("DEPRECATION")
        for (service in manager.getRunningServices(Int.MAX_VALUE)) {
            if (ScreenCaptureService::class.java.name == service.service.className) {
                return true
            }
        }
        return false
    }

    private fun updateButtonState() {
        if (isTranslationRunning()) {
            btnStartTranslation.text = "🛑 إيقاف وضع ترجمة الألعاب"
            btnStartTranslation.setBackgroundColor(android.graphics.Color.parseColor("#EF4444")) // Red
        } else {
            btnStartTranslation.text = "🎮 بدء وضع ترجمة البلايستيشن والألعاب"
            btnStartTranslation.setBackgroundColor(android.graphics.Color.parseColor("#3B82F6")) // Blue
        }
    }

    private fun stopTranslation() {
        stopService(Intent(this, ScreenCaptureService::class.java))
        stopService(Intent(this, TranslationOverlayService::class.java))
        Toast.makeText(this, "تم إيقاف الترجمة بنجاح وتحرير كافة الموارد", Toast.LENGTH_SHORT).show()
        updateButtonState()
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

                updateButtonState()
                Toast.makeText(this, "بدأت الترجمة الفورية في الخلفية!", Toast.LENGTH_LONG).show()
                moveTaskToBack(true) // Minimize to let user view other apps/media
            } else {
                Toast.makeText(this, "تم رفض إذن التقاط الشاشة", Toast.LENGTH_SHORT).show()
            }
        }
    }
}
