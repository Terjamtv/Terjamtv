# 📺 TerjamTV — منصة الترجمة الفورية الذكية لشاشات التلفزيون (بالعامية السعودية 🇸🇦)

> **Real-Time Smart TV Translation Platform for LG webOS & Android TV with Colloquial Saudi Arabic AI Translation.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![webOS](https://img.shields.io/badge/LG%20webOS-5.0+-red.svg)](https://webostv.developer.lge.com/)
[![Android TV](https://img.shields.io/badge/Android%20TV-8.0+-green.svg)](https://developer.android.com/tv)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers%20AI-orange.svg)](https://workers.cloudflare.com/)

---

## 🌟 نبذة عن المشروع (About)

**TerjamTV** هي منصة SaaS متكاملة لترجمة ما يظهر ويقال على شاشات التلفزيون الذكية في الوقت الحقيقي وبث الترجمة مباشرة باللغة العربية **(بالعامية السعودية الدارجة العفوية)** لمسلسلات وأفلام هوليوود، والمسلسلات التركية، والدراما الكورية، والأنمي.

يعتمد المشروع على ربط الشاشة بالجوال عبر مسح رمز **QR Code** واحد، مع لوحة تحكم لإدارة المشتركين ونظام كروت الشحن المسبقة الدفع للبيع النقدي (كاش / تحويلات محلية).

---

## 🚀 المميزات الرئيسية (Features)

- 📺 **دعم شاشات LG webOS:** تطبيق مخصص بصيغة `.ipk` يدعم أجهزة التحكم Magic Remote ومشغل الفيديو المدمج.
- 🤖 **دعم Android TV & Google TV:** تطبيق أندرويد متكامل مع خاصية التقاط الشاشة المباشر (MediaProjection) ومحرك التعرف على النصوص OCR.
- 📱 **مساعد الجوال الفوري (PWA):** بدون الحاجة لتثبيت أي تطبيقات، يفتح الجوال فور مسح الـ QR للاستماع الصوتي وبث الترجمة للشاشة.
- 🇸🇦 **ترجمة حصرية بالعامية السعودية:** مدعومة بنماذج الذكاء الاصطناعي (LLaMA 3.1) لتحويل الحوارات المعقدة لكلام سعودي عفوي وطبيعي.
- 🌍 **دعم لغات متعددة:** ترجمة من الإنجليزية، التركية (مسلسلات)، الكورية (K-Drama)، اليابانية (أنمي)، والإسبانية إلى العربية.
- 💵 **نظام الدفع النقدي وكروت التفعيل:** لوحة تحكم لتوليد كروت الشحن وطباعتها وتفعيل المشتركين نقدياً.
- 🎬 **مترجم ملفات SRT المستقل:** أداة لرفع ملفات الترجمة الإنجليزية وتحميلها مترجمة بالعامية السعودية فوراً.

---

## 📁 هيكلية المشروع (Project Layout)

```text
Terjamtv/
├── backend/                       # خادم Cloudflare Workers API بنظام TypeScript
│   ├── src/
│   │   ├── routes/translate.ts    # محرك الترجمة والذكاء الاصطناعي
│   │   ├── routes/pair.ts         # نظام الاقتران بالـ QR
│   │   ├── routes/relay.ts        # خادم بث الترحيل اللحظي للشاشة
│   │   ├── routes/voucher.ts      # نظام بطاقات التفعيل النقدية
│   │   └── lib/saudi.ts           # خوارزمية العامية السعودية
│   └── test-api.mjs               # جناح الاختبارات الآلية (12/12 ناجح)
│
├── tv-webos/                      # تطبيق شاشات LG webOS الرسمي
│   ├── appinfo.json
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
├── com.translatetv.app_1.0.0_all.ipk # حزمة التثبيت الرسمية لشاشة LG
│
├── tv-android/                    # مشروع Android TV (Kotlin + ML Kit OCR)
├── mobile/                        # تطبيق الهاتف الأصلي (Native Android Companion)
├── mobile-web/                    # مساعد الويب السريع للجوال (PWA)
│
├── admin/                         # لوحة تحكم المشرف لإدارة الكروت والمبيعات
│   ├── index.html
│   └── voucher-print.html         # قالب طباعة كروت التفعيل المقصوصة A4
│
├── website/                       # الموقع التسويقي بالريال السعودي
│   ├── index.html
│   └── srt-tool.html              # أداة ترجمة ملفات الـ SRT
│
├── supabase/                      # مخططات قاعدة البيانات PostgreSQL
│   ├── migrations/001_initial_schema.sql
│   ├── migrations/002_vouchers.sql
│   └── seed.sql
│
├── server-whisper/                # خادم تفريغ الصوت الذاتي (اختياري)
├── docker-compose.yml             # ملف التشغيل المستقل عبر Docker
├── start_demo.bat                 # تشغيل تجريبي محلي بنقرة واحدة
└── deploy-production.bat          # سكريبت النشر السحابي العالمي
```

---

## 🚫 المبادئ الصارمة للنظام (Core Engineering Constraints)

> [!IMPORTANT]
> **قاعدة صارمة وغير قابلة للتفاوض:**
> 1. **نظام برمجيات خالص 100% (Pure Software-Only):**
>    - يُمنع منعاً باتاً اعتماد أو إلزام أي قطعة عتاد خارجية (No External Hardware / No Dongles / No Capture Cards / No HDMI Splitters).
>    - يجب أن تعمل كافة المزايا برمجياً بالكامل ومباشرة على أجهزة المستخدم المتوفرة لديه (شاشة التلفاز الذكية، أو هاتفه، أو حاسوبه الشخصي).
> 2. **صفر استهلاك وتكلفة سحابية (Zero-Cloud & Zero-Subscription):**
>    - الأولوية المطلقة لتشغيل الترجمة والتعرف الضوئي محلياً على عتاد الجهاز نفسه (On-Device ML Kit / WebAssembly / Local Translation Memory) لضمان عدم وجود أي تكاليف أو اشتراكات شهرية على المستخدم.
> 3. **حماية تجربة اللاعب وسلاسة الفريمات (Zero FPS Drop):**
>    - لا يُسمح بأي معالجة تستهلك المعالج أو تسبب بطء في الصورة أو Input Lag أثناء اللعب.

---

## ⚡ التشغيل السريع (Quickstart)

### 1. تشغيل المنظومة محلياً (Windows):
فقط اضغط مرتين على:
```cmd
start_demo.bat
```
سيقوم بتشغيل خادم الـ API على المنفذ `8787`، وتشغيل شاشة التلفزيون ولوحة التحكم في المتصفح تلقائياً.

### 2. تثبيت الحزمة على شاشة LG webOS:
1. افتح برنامج **webOS Dev Manager** على كمبيوترك.
2. اتصل بالشاشة عبر IP ومفتاح المرور من تطبيق Developer Mode.
3. اسحب ملف `com.translatetv.app_1.0.0_all.ipk` وأفلته في البرنامج للتثبيت المباشر.

---

## 🧪 الاختبارات الآلية (Automated Tests)

لتشغيل جناح فحص نقاط الاتصال والتحقق من سلامة كافة الـ Endpoints:
```bash
cd backend
npm test
```

---

## 📄 التراخيص والتوثيق (Docs)
- دليل التشغيل الشامل: [`docs/SETUP_GUIDE.md`](docs/SETUP_GUIDE.md)
- دليل تثبيت شاشات Android TV: [`docs/ANDROID_TV_GUIDE.md`](docs/ANDROID_TV_GUIDE.md)
- دليل الموزعين والمبيعات النقدية في السعودية: [`docs/RESELLER_GUIDE.md`](docs/RESELLER_GUIDE.md)

---
© 2026 TerjamTV. جميع الحقوق محفوظة.
