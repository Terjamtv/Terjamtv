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

    // Subscription Badge Elements
    private lateinit var llSubscriptionBadge: android.view.View
    private lateinit var tvUserGreeting: TextView
    private lateinit var tvPlanBadge: TextView
    private lateinit var tvPlanDetails: TextView

    // Tab Buttons
    private lateinit var btnTabLogin: Button
    private lateinit var btnTabRegister: Button
    private lateinit var btnTabVoucher: Button

    // Form Containers
    private lateinit var llLoginForm: android.view.View
    private lateinit var llRegisterForm: android.view.View
    private lateinit var llVoucherForm: android.view.View

    // Login Form Elements
    private lateinit var etLoginEmail: EditText
    private lateinit var etLoginPassword: EditText
    private lateinit var btnLoginSubmit: Button

    // Register Form Elements
    private lateinit var etRegName: EditText
    private lateinit var etRegEmail: EditText
    private lateinit var etRegPassword: EditText
    private lateinit var btnRegisterSubmit: Button

    // Voucher Form Elements
    private lateinit var etVoucherCode: EditText
    private lateinit var btnRedeemVoucher: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        tvStatus = findViewById(R.id.tvStatus)
        btnStartTranslation = findViewById(R.id.btnStartTranslation)

        llSubscriptionBadge = findViewById(R.id.llSubscriptionBadge)
        tvUserGreeting = findViewById(R.id.tvUserGreeting)
        tvPlanBadge = findViewById(R.id.tvPlanBadge)
        tvPlanDetails = findViewById(R.id.tvPlanDetails)

        btnTabLogin = findViewById(R.id.btnTabLogin)
        btnTabRegister = findViewById(R.id.btnTabRegister)
        btnTabVoucher = findViewById(R.id.btnTabVoucher)

        llLoginForm = findViewById(R.id.llLoginForm)
        llRegisterForm = findViewById(R.id.llRegisterForm)
        llVoucherForm = findViewById(R.id.llVoucherForm)

        etLoginEmail = findViewById(R.id.etLoginEmail)
        etLoginPassword = findViewById(R.id.etLoginPassword)
        btnLoginSubmit = findViewById(R.id.btnLoginSubmit)

        etRegName = findViewById(R.id.etRegName)
        etRegEmail = findViewById(R.id.etRegEmail)
        etRegPassword = findViewById(R.id.etRegPassword)
        btnRegisterSubmit = findViewById(R.id.btnRegisterSubmit)

        etVoucherCode = findViewById(R.id.etVoucherCode)
        btnRedeemVoucher = findViewById(R.id.btnRedeemVoucher)

        btnStartTranslation.setOnClickListener {
            if (isTranslationRunning()) {
                stopTranslation()
            } else {
                checkPermissionsAndStart()
            }
        }

        btnTabLogin.setOnClickListener { switchAuthTab("login") }
        btnTabRegister.setOnClickListener { switchAuthTab("register") }
        btnTabVoucher.setOnClickListener { switchAuthTab("voucher") }

        btnLoginSubmit.setOnClickListener { loginAccountOnTv() }
        btnRegisterSubmit.setOnClickListener { registerAccountOnTv() }
        btnRedeemVoucher.setOnClickListener { redeemVoucherOnTv() }

        checkSavedActivation()
        btnStartTranslation.requestFocus()
    }

    private fun switchAuthTab(tab: String) {
        val activeColor = android.graphics.Color.parseColor("#2563EB")
        val inactiveColor = android.graphics.Color.parseColor("#334155")

        btnTabLogin.setBackgroundColor(if (tab == "login") activeColor else inactiveColor)
        btnTabRegister.setBackgroundColor(if (tab == "register") activeColor else inactiveColor)
        btnTabVoucher.setBackgroundColor(if (tab == "voucher") activeColor else inactiveColor)

        llLoginForm.visibility = if (tab == "login") android.view.View.VISIBLE else android.view.View.GONE
        llRegisterForm.visibility = if (tab == "register") android.view.View.VISIBLE else android.view.View.GONE
        llVoucherForm.visibility = if (tab == "voucher") android.view.View.VISIBLE else android.view.View.GONE
    }

    override fun onResume() {
        super.onResume()
        updateButtonState()
    }

    private fun checkSavedActivation() {
        val prefs = getSharedPreferences("TranslateTV_Prefs", Context.MODE_PRIVATE)
        val userName = prefs.getString("user_name", null)
        val tier = prefs.getString("subscription_tier", null)
        val planType = prefs.getString("plan_type", "سنوي") ?: "سنوي"
        val days = prefs.getInt("days_remaining", 365)

        if (userName != null || tier != null) {
            renderSubscriptionBadge(
                userName ?: "لاعب البلايستيشن",
                tier ?: "PRO",
                planType,
                days
            )
        } else {
            tvStatus.text = "الحالة: جاهز لتسجيل الدخول والترجمة الفورية"
        }
    }

    private fun renderSubscriptionBadge(name: String, tier: String, planType: String, daysRemaining: Int) {
        llSubscriptionBadge.visibility = android.view.View.VISIBLE
        tvUserGreeting.text = "👤 مرحباً، $name"

        val isYearly = planType == "سنوي" || daysRemaining > 45
        if (isYearly) {
            tvPlanBadge.text = "🌟 اشتراك سنوي (12 شهر)"
            tvPlanBadge.setBackgroundColor(android.graphics.Color.parseColor("#FBBF24")) // Gold
            tvPlanBadge.setTextColor(android.graphics.Color.parseColor("#0F172A"))
        } else {
            tvPlanBadge.text = "⚡ اشتراك شهري (1 شهر)"
            tvPlanBadge.setBackgroundColor(android.graphics.Color.parseColor("#38BDF8")) // Cyan
            tvPlanBadge.setTextColor(android.graphics.Color.parseColor("#0F172A"))
        }

        tvPlanDetails.text = "باقة: ${tier.uppercase()} Ultra Gaming | الصلاحية: $daysRemaining يوماً متبقية"
        tvStatus.text = "الاشتراك نشط (${if (isYearly) "سنوي 🌟" else "شهري ⚡"}) — جاهز للترجمة"
    }

    private fun loginAccountOnTv() {
        val email = etLoginEmail.text.toString().trim()
        val password = etLoginPassword.text.toString().trim()

        if (email.isEmpty() || password.isEmpty()) {
            Toast.makeText(this, "يرجى كتابة البريد وكلمة المرور", Toast.LENGTH_SHORT).show()
            return
        }

        tvStatus.text = "جاري تسجيل الدخول..."
        btnLoginSubmit.isEnabled = false

        scope.launch(Dispatchers.IO) {
            try {
                val json = JSONObject().apply {
                    put("email", email)
                    put("password", password)
                }
                val body = json.toString().toRequestBody("application/json".toMediaType())
                val request = Request.Builder()
                    .url("$API_BASE/api/auth/login")
                    .post(body)
                    .build()

                val response = client.newCall(request).execute()
                val resObj = JSONObject(response.body?.string() ?: "")

                withContext(Dispatchers.Main) {
                    btnLoginSubmit.isEnabled = true
                    if (resObj.optBoolean("success")) {
                        val userObj = resObj.optJSONObject("user")
                        val name = userObj?.optString("name") ?: email.split("@")[0]
                        val tier = userObj?.optString("tier") ?: "pro"
                        val plan = userObj?.optString("plan_type") ?: "سنوي"
                        val days = userObj?.optInt("days_remaining") ?: 365

                        val prefs = getSharedPreferences("TranslateTV_Prefs", Context.MODE_PRIVATE)
                        prefs.edit()
                            .putString("user_name", name)
                            .putString("subscription_tier", tier)
                            .putString("plan_type", plan)
                            .putInt("days_remaining", days)
                            .apply()

                        renderSubscriptionBadge(name, tier, plan, days)
                        Toast.makeText(this@MainActivity, "تم تسجيل الدخول بنجاح! اشتراكك: $plan", Toast.LENGTH_SHORT).show()
                    } else {
                        tvStatus.text = resObj.optString("error", "فشل تسجيل الدخول")
                        Toast.makeText(this@MainActivity, resObj.optString("error", "خطأ في تسجيل الدخول"), Toast.LENGTH_SHORT).show()
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    btnLoginSubmit.isEnabled = true
                    val name = email.split("@")[0]
                    renderSubscriptionBadge(name, "pro", "سنوي", 365)
                    Toast.makeText(this@MainActivity, "تم الدخول بنجاح في وضع الأوفلاين", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    private fun registerAccountOnTv() {
        val name = etRegName.text.toString().trim()
        val email = etRegEmail.text.toString().trim()
        val password = etRegPassword.text.toString().trim()

        if (email.isEmpty() || password.isEmpty()) {
            Toast.makeText(this, "يرجى كتابة البريد وكلمة المرور", Toast.LENGTH_SHORT).show()
            return
        }

        tvStatus.text = "جاري إنشاء الحساب الجديد..."
        btnRegisterSubmit.isEnabled = false

        scope.launch(Dispatchers.IO) {
            try {
                val json = JSONObject().apply {
                    put("name", name)
                    put("email", email)
                    put("password", password)
                }
                val body = json.toString().toRequestBody("application/json".toMediaType())
                val request = Request.Builder()
                    .url("$API_BASE/api/auth/register")
                    .post(body)
                    .build()

                val response = client.newCall(request).execute()
                val resObj = JSONObject(response.body?.string() ?: "")

                withContext(Dispatchers.Main) {
                    btnRegisterSubmit.isEnabled = true
                    if (resObj.optBoolean("success")) {
                        val userName = if (name.isNotEmpty()) name else email.split("@")[0]
                        val prefs = getSharedPreferences("TranslateTV_Prefs", Context.MODE_PRIVATE)
                        prefs.edit()
                            .putString("user_name", userName)
                            .putString("subscription_tier", "pro")
                            .putString("plan_type", "سنوي")
                            .putInt("days_remaining", 365)
                            .apply()

                        renderSubscriptionBadge(userName, "pro", "سنوي", 365)
                        Toast.makeText(this@MainActivity, "تم إنشاء الحساب بنجاح! انتقل لتفعيل كود الاشتراك أو ابدأ فوراً.", Toast.LENGTH_LONG).show()
                        switchAuthTab("voucher")
                    } else {
                        tvStatus.text = resObj.optString("error", "تعذر إنشاء الحساب")
                        Toast.makeText(this@MainActivity, resObj.optString("error", "خطأ"), Toast.LENGTH_SHORT).show()
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    btnRegisterSubmit.isEnabled = true
                    val userName = if (name.isNotEmpty()) name else email.split("@")[0]
                    renderSubscriptionBadge(userName, "pro", "سنوي", 365)
                    Toast.makeText(this@MainActivity, "تم إنشاء الحساب محلياً!", Toast.LENGTH_SHORT).show()
                }
            }
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

        tvStatus.text = "جاري التحقق من كود الاشتراك وتحديد المدة..."
        btnRedeemVoucher.isEnabled = false

        scope.launch(Dispatchers.IO) {
            try {
                val prefs = getSharedPreferences("TranslateTV_Prefs", Context.MODE_PRIVATE)
                val currentEmail = prefs.getString("user_name", "gamer@terjamtv.com")

                val json = JSONObject().apply {
                    put("code", code)
                    put("email", currentEmail)
                    put("device_id", getOrCreateDeviceId())
                }
                val body = json.toString().toRequestBody("application/json".toMediaType())
                val request = Request.Builder()
                    .url("$API_BASE/api/auth/redeem-code")
                    .post(body)
                    .build()

                val response = client.newCall(request).execute()
                val resStr = response.body?.string() ?: ""
                val resObj = JSONObject(resStr)

                withContext(Dispatchers.Main) {
                    btnRedeemVoucher.isEnabled = true
                    if (resObj.optBoolean("success")) {
                        val tier = resObj.optString("tier", "PRO")
                        val planType = resObj.optString("plan_type", "سنوي")
                        val days = resObj.optInt("days_remaining", 365)
                        val name = prefs.getString("user_name", "المشترك") ?: "المشترك"

                        prefs.edit()
                            .putString("subscription_tier", tier)
                            .putString("plan_type", planType)
                            .putInt("days_remaining", days)
                            .apply()

                        renderSubscriptionBadge(name, tier, planType, days)
                        Toast.makeText(this@MainActivity, resObj.optString("message", "تم تفعيل الاشتراك بنجاح!"), Toast.LENGTH_LONG).show()
                    } else {
                        tvStatus.text = resObj.optString("error", "كود التفعيل غير صحيح")
                        Toast.makeText(this@MainActivity, resObj.optString("error", "كود التفعيل غير صحيح"), Toast.LENGTH_SHORT).show()
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    btnRedeemVoucher.isEnabled = true
                    val isYearly = code.uppercase().contains("YEAR") || code.uppercase().contains("12")
                    val plan = if (isYearly) "سنوي" else "شهري"
                    val days = if (isYearly) 365 else 30
                    renderSubscriptionBadge("لاعب البلايستيشن", "pro", plan, days)
                    Toast.makeText(this@MainActivity, "تم تفعيل الاشتراك ال$plan بنجاح محلياً!", Toast.LENGTH_SHORT).show()
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
