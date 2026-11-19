@echo off
chcp 65001 >nul
title TranslateTV - تثبيت التطبيق على شاشة LG webOS
cd /d "%~dp0"
echo ========================================================
echo   TranslateTV - تثبيت تطبيق الترجمة على شاشة LG webOS
echo ========================================================
echo.
echo [تعليمات هامة على شاشة التلفزيون]:
echo 1. تأكد أن اللابتوب والتلفزيون متصلان على نفس شبكة الواي فاي (Wi-Fi).
echo 2. على التلفزيون: افتح تطبيق (Developer Mode).
echo 3. تأكد أن (Dev Mode Status: ON) وأن (Key Server: ON).
echo 4. ستجد بيانات واضحة أمامك على شاشة التلفزيون:
echo    - IP Address (مثال: 192.168.1.50)
echo    - Passphrase (كود سري مكون من 6 حروف وأرقام)
echo.
set /p TV_IP="اكتب الـ IP Address الظاهر على التلفزيون: "

echo.
echo [1/3] جاري إضافة التلفزيون...
call ares-setup-device -r lgtv >nul 2>&1
call ares-setup-device -a lgtv -i "username=prisoner" -i "host=%TV_IP%" -i "port=9922"

echo.
echo [2/3] جاري الحصول على مفتاح الاتصال من التلفزيون...
echo (اكتب كود الـ Passphrase المكون من 6 حروف عندما يطلبه البرنامج):
call ares-novacom --device lgtv --getkey

echo.
echo [3/4] جاري رفع وتثبيت تطبيق الترجمة com.translatetv.app_1.0.0_all.ipk...
call ares-install --device lgtv com.translatetv.app_1.0.0_all.ipk

echo.
echo [4/5] هل ترغب في تثبيت أداة التقاط HDMI المباشر (PicCap) لشاشات LG؟
echo اضغط Y للتثبيت أو أي زر آخر للمتابعة:
set /p INSTALL_PICCAP="[Y/N]: "
if /i "%INSTALL_PICCAP%"=="Y" (
    echo جاري تثبيت PicCap على شاشة LG...
    call ares-install --device lgtv tools\org.webosbrew.piccap_0.5.3_all.ipk
)

echo.
echo [5/5] هل ترغب في تثبيت متجر Homebrew Channel (لتشغيل التطبيقات بشكل دائم وتفادي مهلة الـ 50 ساعة)؟
set /p INSTALL_HB="[Y/N]: "
if /i "%INSTALL_HB%"=="Y" (
    echo جاري تثبيت Homebrew Channel على شاشة LG...
    call ares-install --device lgtv tools\org.webosbrew.hbchannel_0.7.3_all.ipk
)

echo.
echo جاري إطلاق التطبيق على التلفزيون...
call ares-launch --device lgtv com.translatetv.app

echo.
echo ========================================================
echo   تم التثبيت والتشغيل بنجاح على شاشة LG webOS!
echo ========================================================
pause
