@echo off
chcp 65001 >nul
title TranslateTV - تشغيل بث البلايستيشن 5 مع شريط الترجمة الفورية
cd /d "%~dp0"
echo ========================================================
echo   TranslateTV x PlayStation 5 (Chiaki Stream + Overlay)
echo ========================================================
echo.
echo [1/2] جاري تشغيل شريط الترجمة الشفاف...
start "" python TranslateTV_Desktop_Overlay.py

echo [2/2] جاري تشغيل عميل بث البلايستيشن (Chiaki-ng)...
start "" "%~dp0tools\Chiaki\chiaki-ng-Win\chiaki.exe"

echo.
echo ========================================================
echo   تم تشغيل البلايستيشن مع الترجمة بنجاح!
echo   (الترجمة تعمل محلياً 100%% بصفر استهلاك سحابي وبدون اشتراك)
echo ========================================================
timeout /t 5 >nul
exit