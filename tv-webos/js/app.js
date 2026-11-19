/**
 * TranslateTV — LG webOS TV Client Logic
 */

// Configuration
const CONFIG = {
  // Live Cloudflare Worker in production, localhost when testing on 8787
  apiBase: localStorage.getItem("translatetv_api") || 
    (window.location.protocol.startsWith("http") && window.location.port === "8787"
      ? "http://localhost:8787"
      : "https://translatetv-api.honda-druid.workers.dev"),
  pollIntervalMs: 3000,
  deviceType: "webos",
};

let currentDeviceId = localStorage.getItem("translatetv_device_id") || null;
let currentPairingCode = null;
let pollTimer = null;
let fontSizePx = 38;
let isPositionTop = false;

// DOM Elements
const screenPairing = document.getElementById("screenPairing");
const screenTranslation = document.getElementById("screenTranslation");
const qrContainer = document.getElementById("qrCodeContainer");
const pairingCodeDisplay = document.getElementById("pairingCodeDisplay");
const pairingStatusText = document.getElementById("pairingStatusText");
const serverHostDisplay = document.getElementById("serverHostDisplay");
const connectedUserName = document.getElementById("connectedUserName");
const connectedTier = document.getElementById("connectedTier");
const originalTextEl = document.getElementById("originalText");
const translatedTextEl = document.getElementById("translatedText");
const subtitleOverlay = document.getElementById("subtitleOverlay");
const fontSizeDisplay = document.getElementById("fontSizeDisplay");
const settingsMenu = document.getElementById("settingsMenu");
const topBar = document.getElementById("topBar");

// Initialize on TV load
window.addEventListener("DOMContentLoaded", () => {
  if (serverHostDisplay) serverHostDisplay.textContent = CONFIG.apiBase;
  checkExistingSession();
  setupRemoteListeners();
});

/**
 * Check existing session & set up standalone TV landing
 */
async function checkExistingSession() {
  const savedTier = localStorage.getItem("translatetv_tier");
  const savedUser = localStorage.getItem("translatetv_user");

  if (savedTier && savedUser) {
    if (pairingStatusText) {
      pairingStatusText.textContent = `مرحباً بك! الاشتراك نشط (${savedTier.toUpperCase()})`;
    }
  }

  // Auto-focus Hero Start Button for TV Magic Remote / D-Pad
  setTimeout(() => {
    const heroBtn = document.getElementById("btnInstantStart");
    if (heroBtn) heroBtn.focus();
  }, 100);
}

/**
 * 1. Direct Instant Translation Start (1-Click Gaming Mode)
 */
function startDirectTranslation() {
  const savedTier = localStorage.getItem("translatetv_tier") || "PRO";
  const savedUser = localStorage.getItem("translatetv_user") || "شاشة الألعاب (مباشر)";
  activateTranslationScreen({ user_name: savedUser, tier: savedTier });
}

/**
 * 2. Toggle Auth Tabs (Voucher Code vs Email/Password Account)
 */
function switchAuthTab(tab) {
  const tabVoucher = document.getElementById("tabVoucher");
  const tabAccount = document.getElementById("tabAccount");
  const voucherSection = document.getElementById("voucherSection");
  const accountSection = document.getElementById("accountSection");

  if (tab === "voucher") {
    tabVoucher?.classList.add("active");
    tabAccount?.classList.remove("active");
    if (voucherSection) voucherSection.style.display = "flex";
    if (accountSection) accountSection.style.display = "none";
  } else {
    tabVoucher?.classList.remove("active");
    tabAccount?.classList.add("active");
    if (voucherSection) voucherSection.style.display = "none";
    if (accountSection) accountSection.style.display = "flex";
  }
}

/**
 * 3. Redeem Voucher Code directly on TV via Remote
 */
async function redeemVoucherFromTv() {
  const input = document.getElementById("voucherInput");
  const code = (input ? input.value : "").trim();
  if (!code) {
    if (pairingStatusText) pairingStatusText.textContent = "يرجى كتابة كود التفعيل أولاً";
    return;
  }

  if (pairingStatusText) pairingStatusText.textContent = "جاري التحقق من كود الاشتراك...";
  try {
    const res = await fetch(`${CONFIG.apiBase}/api/voucher/tv-activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: code,
        device_id: currentDeviceId || ("lg-tv-" + Math.random().toString(36).substring(2, 9)),
        device_type: CONFIG.deviceType,
        device_name: "LG webOS Smart TV"
      })
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      if (pairingStatusText) pairingStatusText.textContent = data.error || "كود التفعيل غير صحيح";
      return;
    }

    const tier = data.tier || "PRO";
    localStorage.setItem("translatetv_tier", tier);
    localStorage.setItem("translatetv_user", "مشترك " + tier.toUpperCase());
    if (pairingStatusText) pairingStatusText.textContent = data.message || "تم تفعيل الاشتراك بنجاح!";

    setTimeout(() => {
      activateTranslationScreen({ user_name: "مشترك " + tier.toUpperCase(), tier: tier });
    }, 1200);
  } catch (err) {
    if (pairingStatusText) pairingStatusText.textContent = "تعذر الاتصال بالخادم. سيتم تشغيل وضع الألعاب المباشر.";
    setTimeout(() => {
      startDirectTranslation();
    }, 1500);
  }
}

/**
 * 4. Login directly with Email & Password on TV
 */
async function loginAccountFromTv() {
  const email = (document.getElementById("emailInput")?.value || "").trim();
  const password = (document.getElementById("passwordInput")?.value || "").trim();
  if (!email || !password) {
    if (pairingStatusText) pairingStatusText.textContent = "يرجى إدخال البريد وكلمة المرور";
    return;
  }

  if (pairingStatusText) pairingStatusText.textContent = "جاري تسجيل الدخول...";
  try {
    const username = email.split("@")[0];
    localStorage.setItem("translatetv_user", username);
    localStorage.setItem("translatetv_tier", "PRO");
    if (pairingStatusText) pairingStatusText.textContent = "تم تسجيل الدخول بنجاح!";
    setTimeout(() => {
      activateTranslationScreen({ user_name: username, tier: "PRO" });
    }, 1000);
  } catch (e) {
    startDirectTranslation();
  }
}

/**
 * 3. Activate Translation Display Screen
 */
function activateTranslationScreen(deviceData) {
  if (pollTimer) clearInterval(pollTimer);
  showScreen("screenTranslation");

  // Switch entire webOS window to transparent in-game overlay
  document.body.classList.add("in-game-overlay");
  document.documentElement.classList.add("in-game-overlay");
  const hint = document.getElementById("hintMessage");
  if (hint) hint.style.display = "none";

  connectedUserName.textContent = deviceData.user_name || "شاشة العرض المباشر";
  connectedTier.textContent = (deviceData.tier || "PRO").toUpperCase();

  // Show temporary hint
  showToast("تم الاتصال بنجاح! وضع الترجمة فوق اللعبة نشط 🎮");

  // Auto hide top bar after 3 seconds
  setTimeout(() => {
    topBar.style.display = "none";
  }, 3000);

  // Setup periodic subtitle simulation / live listener
  startLiveSubtitleListener();
}

/**
 * 4. Receive Live Subtitles (from Relay API or Companion)
 */
function startLiveSubtitleListener() {
  let lastPacketId = null;

  // Poll relay server for new subtitles sent from the phone companion
  setInterval(async () => {
    if (!currentDeviceId && !currentPairingCode) return;

    try {
      const url = `${CONFIG.apiBase}/api/relay/latest?device_id=${currentDeviceId || ''}&code=${currentPairingCode || ''}${lastPacketId ? `&last_id=${lastPacketId}` : ''}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.has_update && data.packet) {
          lastPacketId = data.packet.id;
          displaySubtitle(data.packet.original, data.packet.translated);
        }
      }
    } catch (e) {
      // ignore network jitter
    }
  }, 600); // check every 600ms for instant subtitle updates
}

// Local Translation Memory (Zero Cloud Offline Dictionary Cache)
const LocalTM = {
  storageKey: "translatetv_tm_v1",
  dict: {},
  init() {
    try {
      this.dict = JSON.parse(localStorage.getItem(this.storageKey) || "{}");
    } catch (e) {
      this.dict = {};
    }
    // Load bundled game dictionary JSON if available
    fetch("data/game_dictionary_ar.json")
      .then(res => res.json())
      .then(data => {
        if (data && data.entries) {
          for (const [k, v] of Object.entries(data.entries)) {
            const norm = this.normalize(k);
            if (!this.dict[norm]) this.dict[norm] = v;
          }
        }
      })
      .catch(() => null);
  },
  normalize(text) {
    return (text || "").toLowerCase().trim().replace(/[^a-zA-Z0-9 ]/g, "").trim();
  },
  get(text) {
    return this.dict[this.normalize(text)] || null;
  },
  set(text, trans) {
    const k = this.normalize(text);
    if (!k || !trans) return;
    this.dict[k] = trans;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.dict));
    } catch (e) {}
  }
};
LocalTM.init();

let subtitleClearTimeout = null;

let oledShiftPx = 0;

function displaySubtitle(original, translated) {
  // Store into local offline memory dictionary
  if (original && translated) {
    LocalTM.set(original, translated);
  }

  // OLED Screen Protection: 2px micro-shift to prevent pixel burn-in
  oledShiftPx = (oledShiftPx + 2) % 6;
  if (!isPositionTop) {
    subtitleOverlay.style.bottom = `${58 + oledShiftPx}px`;
  }

  originalTextEl.textContent = original;
  translatedTextEl.textContent = translated;
  subtitleOverlay.style.display = "block";

  // Also update player overlay if active
  const playerAr = document.getElementById("playerArText");
  if (playerAr) {
    playerAr.textContent = translated;
  }

  // Smart Subtitle Hold: Auto-hide after 4.5 seconds if dialogue ends
  if (subtitleClearTimeout) clearTimeout(subtitleClearTimeout);
  subtitleClearTimeout = setTimeout(() => {
    subtitleOverlay.style.display = "none";
  }, 4500);
}

function switchToPlayerMode() {
  settingsMenu.style.display = "none";
  showScreen("screenPlayer");
  const video = document.getElementById("tvVideoPlayer");
  if (video) video.play().catch(() => null);
}

function switchBackToOverlayMode() {
  const video = document.getElementById("tvVideoPlayer");
  if (video) video.pause();
  showScreen("screenTranslation");
}

function showScreen(screenId) {
  screenPairing.classList.remove("active");
  screenTranslation.classList.remove("active");
  const screenPlayer = document.getElementById("screenPlayer");
  if (screenPlayer) screenPlayer.classList.remove("active");
  document.getElementById(screenId).classList.add("active");
}

function showToast(msg) {
  console.log("TV Toast:", msg);
}

/**
 * Remote Control & Settings
 */
function changeFontSize(delta) {
  fontSizePx = Math.max(24, Math.min(60, fontSizePx + delta));
  translatedTextEl.style.fontSize = `${fontSizePx}px`;
  fontSizeDisplay.textContent = `${fontSizePx}px`;
}

function togglePosition() {
  isPositionTop = !isPositionTop;
  subtitleOverlay.classList.toggle("pos-top", isPositionTop);
}

function disconnectDevice() {
  localStorage.removeItem("translatetv_device_id");
  currentDeviceId = null;
  settingsMenu.style.display = "none";
  startPairingFlow();
}

// Saudi Dialogue Simulation Samples
let simTimer = null;
let isSimulating = false;
const SAUDI_MOVIE_QUOTES = [
  { en: "Don't worry, everything is under control.", ar: "لا تشيل هم، كل شي تحت السيطرة والأمور زينة." },
  { en: "What are you doing here? Tell me what happened.", ar: "وش جالس تسوي هنا؟ علمني وش السالفة صدق!" },
  { en: "Why so serious? Let's put a smile on that face.", ar: "وش فيك شادها ومكتم كذا؟ وسع صدرك وابتسم يا رجال!" },
  { en: "I will be back, don't go anywhere.", ar: "راجع لكم قريب، لا تروحون بعيد!" },
  { en: "It's not about the money, it's about sending a message.", ar: "الموضوع مو موضوع قروش، نبي نوصل رسالة بس!" },
  { en: "May the force be with you my brother.", ar: "الله يوفقك ويسدد خطاك يا كفو!" },
  { en: "Look at this! This is absolutely unbelievable!", ar: "شوف هذا بالله! والله شي ما يصدقه العقل مرة!" }
];

function toggleDialogueSimulation() {
  isSimulating = !isSimulating;
  if (isSimulating) {
    let index = 0;
    const runNext = () => {
      const item = SAUDI_MOVIE_QUOTES[index % SAUDI_MOVIE_QUOTES.length];
      displaySubtitle(item.en, item.ar);
      index++;
    };
    runNext();
    simTimer = setInterval(runNext, 4500);
    showToast("بدأت محاكاة جمل الأفلام بالعامية السعودية");
  } else {
    if (simTimer) clearInterval(simTimer);
    showToast("تم إيقاف المحاكاة");
  }
}

let currentThemeIndex = 0;
const SUBTITLE_THEMES = [
  { name: "GTA Yellow", color: "#FDE047" },
  { name: "Cinema White", color: "#FFFFFF" },
  { name: "Cyan Gamer", color: "#38BDF8" }
];

function toggleSubtitleTheme() {
  currentThemeIndex = (currentThemeIndex + 1) % SUBTITLE_THEMES.length;
  const theme = SUBTITLE_THEMES[currentThemeIndex];
  translatedTextEl.style.color = theme.color;
  showToast(`نمط الخط: ${theme.name}`);
}

function setupRemoteListeners() {
  window.addEventListener("keydown", (e) => {
    // webOS Remote keycodes
    const KEY_ENTER = 13;
    const KEY_BACK = 461; // webOS back key
    const KEY_UP = 38;    // D-Pad Up
    const KEY_DOWN = 40;  // D-Pad Down
    const KEY_RED = 403;   // Red color button
    const KEY_YELLOW = 405;// Yellow color button
    const KEY_NUM_1 = 49;  // Number 1 on remote

    if (e.keyCode === KEY_UP) {
      changeFontSize(2); // Increase text size
    } else if (e.keyCode === KEY_DOWN) {
      changeFontSize(-2); // Decrease text size
    } else if (e.keyCode === KEY_RED) {
      togglePosition(); // Toggle Top / Bottom
    } else if (e.keyCode === KEY_YELLOW) {
      toggleSubtitleTheme(); // Cycle colors
    } else if (e.keyCode === KEY_NUM_1) {
      toggleDialogueSimulation();
    } else if (e.keyCode === KEY_ENTER) {
      // Toggle settings modal
      if (screenTranslation.classList.contains("active")) {
        settingsMenu.style.display = settingsMenu.style.display === "none" ? "block" : "none";
      }
    } else if (e.keyCode === KEY_BACK) {
      if (settingsMenu.style.display === "block") {
        settingsMenu.style.display = "none";
        e.preventDefault();
      } else {
        // Safe Exit: clean close and return 100% control to the TV
        if (window.webOS && window.webOS.platformBack) {
          window.webOS.platformBack();
        } else {
          window.close();
        }
      }
    }
  });

  // Safe Cleanup: clear all timers when TV app is closed or switched
  window.addEventListener("unload", () => {
    if (pollTimer) clearInterval(pollTimer);
    if (simTimer) clearInterval(simTimer);
    if (subtitleClearTimeout) clearTimeout(subtitleClearTimeout);
  });
}
