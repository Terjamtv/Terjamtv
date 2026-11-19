@echo off
chcp 65001 >nul
title TerjamTV - RetroArch AI Translation Bridge
echo ======================================================================
echo       🎮 TerjamTV - جسر ترجمة ألعاب ومحاكيات RetroArch بالذكاء الاصطناعي
echo ======================================================================
echo.
echo [1] تشغيل الجسر المحلي على المنفذ 4404...
echo [2] في إعدادات RetroArch -> AI Service:
echo     - AI Service URL: http://localhost:4404/
echo     - AI Service Output: Image Mode أو Text-To-Speech
echo ======================================================================
echo.
python "%~dp0tools\RetroArch_AI_Bridge.py"
pause
