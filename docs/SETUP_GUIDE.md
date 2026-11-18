# 📺 دليل التشغيل والتنفيذ الكامل — TranslateTV SaaS

مشروع منصة SaaS لترجمة شاشات التلفزيون (EN → AR) لأنظمة **LG webOS** و **Android TV** مع التحكم ومسح الـ **QR Code** من الهاتف، ولوحة تحكم لإدارة الاشتراكات والدفع النقدي.

---

## 📁 هيكلية المشروع في المجلد `d:\Trans`

```text
d:\Trans\
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql    # جداول قاعدة البيانات + سياسات الأمان RLS + الكاش
├── backend/                          # خادم Cloudflare Workers API
│   ├── src/
│   │   ├── lib/supabase.ts           # عميل Supabase
│   │   ├── routes/translate.ts       # محرك الترجمة (Workers AI + كاش + فحص الباقة)
│   │   ├── routes/pair.ts            # نظام الاقتران برمز الـ QR
│   │   ├── routes/admin.ts           # لوحة تحكم الاشتراكات والدفع النقدي
│   │   └── index.ts                  # Hono App + CORS
│   ├── cloudflare.config.ts          # إعدادات الـ Worker
│   └── .dev.vars.example             # المتغيرات البيئية المطلوبة
├── admin/
│   └── index.html                    # لوحة تحكم المشرف (جاهزة فورياً بالمتصفح)
├── tv-webos/                         # تطبيق تلفزيون LG webOS (HTML5/JS)
│   ├── appinfo.json                  # ملف تعريف تطبيق webOS
│   ├── index.html                    # شاشة الـ QR + شريط الترجمة الفورية
│   ├── css/style.css                 # تصميم 1080p/4K مخصص للشاشة الكبيرة
│   └── js/app.js                     # منطق الاقتران + دعم ريموت LG Magic Remote
├── tv-android/                       # تطبيق Android TV
│   └── app/src/main/
│       ├── AndroidManifest.xml
│       └── java/com/translatetv/tv/
│           ├── MainActivity.kt               # شاشة الـ QR والاقتران
│           ├── ScreenCaptureService.kt       # التقاط الشاشة (MediaProjection) + ML Kit OCR
│           └── TranslationOverlayService.kt  # شريط الترجمة العائم (SYSTEM_ALERT_WINDOW)
└── mobile/                           # تطبيق الهاتف Companion
    └── app/src/main/
        ├── AndroidManifest.xml
        └── java/com/translatetv/mobile/
            └── MainActivity.kt       # كاميرا مسح الـ QR والاقتران الفوري
```

---

## 1️⃣ إعداد قاعدة البيانات (Supabase)

1. افتح مشروعك في [Supabase Dashboard](https://supabase.com).
2. ادخل على **SQL Editor**.
3. انسخ محتوى الملف `supabase/migrations/001_initial_schema.sql` والصقه هناك ثم اضغط **Run**.
4. احصل على المفاتيح من **Project Settings > API**:
   - `Project URL`
   - `anon public key`
   - `service_role secret key`

---

## 2️⃣ تشغيل خادم الـ API (Cloudflare Workers)

ادخل لمجلد الـ backend وأنشئ ملف `.dev.vars` وضع فيه مفاتيح Supabase:

```bash
cd d:\Trans\backend
copy .dev.vars.example .dev.vars
```

عدل ملف `.dev.vars`:
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOi...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...
ADMIN_SECRET_KEY=translatetv-admin-secret-2026
```

لتشغيله محلياً:
```bash
npm run dev
```

للرفع إلى سحابة Cloudflare عالمياً:
```bash
npm run deploy
```

---

## 3️⃣ تثبيت التطبيق على تلفزيون LG webOS

تم بالفعل بناء وتجهيز حزمة التثبيت الرسمية للشاشة:
📦 **[com.translatetv.app_1.0.0_all.ipk](file:///d:/Trans/com.translatetv.app_1.0.0_all.ipk)**

### طريقة التثبيت على الشاشة:
1. حمّل وافتح برنامج **[webOS Dev Manager](https://github.com/webosbrew/dev-manager/releases)** على الكمبيوتر.
2. اتصل بالشاشة عبر عنوان IP التلفزيون ومفتاح المرور من تطبيق **Developer Mode** على التلفزيون.
3. اسحب ملف `com.translatetv.app_1.0.0_all.ipk` إلى البرنامج وسيقوم بتثبيته على التلفزيون فوراً!

*(لو عدلت أي ملف في `tv-webos` وتريد بناء ملف `.ipk` جديد، فقط شغّل أداة: `python tools/build_ipk.py`)*

---

## ⚡ التشغيل التجريبي السريع بضغطة زر واحدة (One-Click Demo)

يمكنك اختبار كامل دورة عمل المشروع (الخادم + شاشة التلفزيون + لوحة التحكم) محلياً على جهازك الآن:
- فقط اضغط مرتين على الملف:
  🚀 **[start_demo.bat](file:///d:/Trans/start_demo.bat)**

سيقوم بفتح خادم الـ API، وتشغيل شاشة تلفزيون الـ LG، ولوحة المشرف معاً في ثوانٍ!

---

## 🧪 فحص واختبار جميع مسارات الـ API تلقائياً

للتأكد من سلامة جميع نقاط الاتصال (الاقتران، الترجمة، لوحة التحكم، ترحيل الترجمات):
```bash
cd d:\Trans\backend
npm test
```
سيقوم بتشغيل اختبار آلي شامل يختبر 10 مسارات بنجاح ويؤكد جاهزية الخادم.

---

## 🎙️ خادم تفريغ الصوت الذاتي (اختياري — Self-Hosted Whisper)
إذا أردت تشغيل محرك تحويل صوت التلفزيون إلى نص (Speech-to-Text) محلياً بالكامل على خادمك الخاص دون الاعتماد على أي واجهات سحابية:
- ادخل لمجلد `server-whisper/` وشغل:
```bash
pip install -r requirements.txt
python main.py
```
أو عبر Docker بضغطة واحدة:
```bash
docker build -t translatetv-whisper .
docker run -p 9000:9000 translatetv-whisper
```

---

## 4️⃣ استخدام لوحة تحكم المشرف (الدفع النقدي وبطاقات التفعيل)

1. افتح الملف `d:\Trans\admin\index.html` في أي متصفح (Chrome, Edge).
2. أدخل رابط الـ API (مثال: `http://localhost:8787` أو رابط الـ Worker بعد الرفع).
3. أدخل الـ Admin Secret.
4. تتوفر لك طريقتان للبيع النقدي:
   - **الطريقة المباشرة (Direct Activation):**
     - اضغط على **"💵 تفعيل / تجديد"** بجانب اسم المشترك.
     - اختر الباقة (أساسي، برو، عائلي) والمدة (شهر، 3 شهور، سنة)، ثم اضغط **"تأكيد واستلام المبلغ"**.
   - **طريقة كروت التفعيل المسبقة الدفع (Voucher / Scratch Cards):**
     - ادخل على تبويب **"🎟️ كروت وبطاقات التفعيل النقدية"**.
     - اختر الباقة والمدة والعدد (مثلاً: 10 كروت باقة PRO لمدة شهر).
     - اضغط **"⚡ توليد الكروت الآن"**.
     - يمكنك طباعة أو بيع هذه الأكواد في المتاجر أو عبر الرسائل؛ وعندما يُدخل العميل الكود في صفحة `mobile-web`، يتفعل حسابه فوراً دون الحاجة لتواصله معك!

---

## 🐳 التشغيل الذاتي الكامل عبر Docker Compose (اختياري)
إذا أردت تشغيل بيئة محلية مستقلة بالكامل (Whisper + LibreTranslate + Nginx):
```bash
cd d:\Trans
docker-compose up -d
```

---

## 5️⃣ تشغيل تطبيق Android TV وتطبيق الهاتف

### الخيار A (بدون تثبيت أي تطبيق — Zero-Install Web Remote) ⭐
بمجرد مسح رمز الـ QR من كاميرا أي هاتف (iPhone أو Android):
1. يُفتح متصفح الهاتف فوراً على صفحة التحكم: `mobile-web/index.html`.
2. يضغط المستخدم على **"🎙️ بدء الاستماع وترجمة الشاشة"**.
3. يستمع ميكروفون الهاتف لصوت الحوار الإنجليزي من سماعات التلفزيون.
4. تتم ترجمته بالذكاء الاصطناعي وبث الترجمة العربية فورياً على شاشة التلفزيون (LG webOS أو Android TV)!

### الخيار B (تطبيقات Native الأصلية)
- افتح مجلد `tv-android` في **Android Studio** لعمل Build للـ APK الخاص بأجهزة Android TV مع خاصية التقاط الشاشة المباشر (MediaProjection + ML Kit OCR).
- افتح مجلد `mobile` في **Android Studio** لعمل Build لتطبيق مسح الـ QR الخاص بالهاتف.
