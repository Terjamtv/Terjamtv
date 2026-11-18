package com.translatetv.mobile

import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.google.zxing.integration.android.IntentIntegrator
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

    private lateinit var tvStatus: TextView
    private lateinit var etPairingCode: EditText
    private lateinit var btnScanQr: Button
    private lateinit var btnManualPair: Button

    private val client = OkHttpClient()
    private val scope = CoroutineScope(Dispatchers.Main + Job())

    // In production, your Cloudflare Worker URL
    private val API_BASE = "http://10.0.2.2:8787"

    // Mock/Demo user token (In production, obtain via Supabase Auth login)
    private var userJwtToken: String = "Bearer DEMO_USER_TOKEN"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        tvStatus = findViewById(R.id.tvStatus)
        etPairingCode = findViewById(R.id.etPairingCode)
        btnScanQr = findViewById(R.id.btnScanQr)
        btnManualPair = findViewById(R.id.btnManualPair)

        btnScanQr.setOnClickListener {
            val integrator = IntentIntegrator(this)
            integrator.setPrompt("وجّه الكاميرا نحو رمز QR على شاشة التلفزيون")
            integrator.setBeepEnabled(true)
            integrator.setOrientationLocked(true)
            integrator.initiateScan()
        }

        btnManualPair.setOnClickListener {
            val code = etPairingCode.text.toString().trim()
            if (code.isNotEmpty()) {
                claimTvPairing(code)
            } else {
                Toast.makeText(this, "يرجى كتابة رمز الاقتران", Toast.LENGTH_SHORT).show()
            }
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        val result = IntentIntegrator.parseActivityResult(requestCode, resultCode, data)
        if (result != null) {
            if (result.contents != null) {
                try {
                    // Try parsing as JSON payload from TV
                    val qrJson = JSONObject(result.contents)
                    val code = qrJson.optString("code")
                    if (code.isNotEmpty()) {
                        claimTvPairing(code)
                    } else {
                        claimTvPairing(result.contents)
                    }
                } catch (e: Exception) {
                    // Plain code string fallback
                    claimTvPairing(result.contents)
                }
            }
        } else {
            super.onActivityResult(requestCode, resultCode, data)
        }
    }

    private fun claimTvPairing(code: String) {
        tvStatus.text = "جاري ربط التلفزيون..."

        scope.launch(Dispatchers.IO) {
            try {
                val json = JSONObject().apply {
                    put("pairing_code", code.uppercase())
                }

                val body = json.toString().toRequestBody("application/json".toMediaType())
                val request = Request.Builder()
                    .url("$API_BASE/api/pair/claim")
                    .addHeader("Authorization", userJwtToken)
                    .post(body)
                    .build()

                val response = client.newCall(request).execute()
                val resStr = response.body?.string() ?: ""
                val resObj = JSONObject(resStr)

                withContext(Dispatchers.Main) {
                    if (response.isSuccessful) {
                        tvStatus.text = "✅ تم ربط التلفزيون بنجاح! الترجمة نشطة الآن على الشاشة."
                        Toast.makeText(this@MainActivity, "تم الاقتران بنجاح!", Toast.LENGTH_LONG).show()
                    } else {
                        val errMsg = resObj.optString("error", "فشل الاقتران")
                        tvStatus.text = "❌ خطأ: $errMsg"
                        Toast.makeText(this@MainActivity, errMsg, Toast.LENGTH_LONG).show()
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    tvStatus.text = "تعذر الاتصال بالخادم: ${e.message}"
                }
            }
        }
    }
}
