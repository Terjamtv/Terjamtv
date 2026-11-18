@echo off
chcp 65001 >nul
title TranslateTV — Quick Demo Launcher

echo ========================================================
echo        📺 TranslateTV SaaS — تشغيل وضع التجربة
echo ========================================================
echo.

cd /d "%~dp0backend"
echo [1/3] بدء تشغيل خادم الـ API (Port 8787)...
start "TranslateTV Backend" cmd /k "npm run dev"

timeout /t 3 >nul

echo [2/3] فتح شاشة التلفزيون (LG webOS View)...
start "" "%~dp0tv-webos\index.html"

echo [3/3] فتح لوحة تحكم المشرف (Admin Dashboard)...
start "" "%~dp0admin\index.html"

echo.
echo ========================================================
echo ✅ كل الخدمات تعمل الآن!
echo  - شاشة التلفزيون: تعرض رمز QR code
echo  - امسح الكود بهاتفك لبدء البث المباشر للترجمة
echo  - لوحة المشرف: لتفعيل المشتركين نقدياً
echo ========================================================
echo.
pause
