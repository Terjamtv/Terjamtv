@echo off
chcp 65001 >nul
title TranslateTV — Production Cloudflare Deployment

echo ========================================================
echo        🚀 TranslateTV — النشر العالمي على Cloudflare
echo ========================================================
echo.

cd /d "%~dp0backend"

echo [1/3] فحص تسجيل الدخول إلى Cloudflare...
call npx wrangler whoami 2>nul
if %errorlevel% neq 0 (
    echo.
    echo ⚠️ يرجى تسجيل الدخول إلى حساب Cloudflare أولاً:
    call npx wrangler login
)

echo.
echo [2/3] بناء ونشر خادم الـ API على سحابة Cloudflare عالمياً...
call npx wrangler deploy

echo.
echo [3/3] إعادة بناء حزمة تلفزيون LG webOS (.ipk)...
cd /d "%~dp0"
python tools/build_ipk.py

echo.
echo ========================================================
echo ✅ تم النشر بنجاح على سحابة Cloudflare!
echo  - أصبح خادمك متاحاً عالمياً بسرعة فائقة وتكلفة شبه مجانية.
echo  - حزمة تلفزيون LG جاهزة: com.translatetv.app_1.0.0_all.ipk
echo ========================================================
echo.
pause
