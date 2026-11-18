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
  serverHostDisplay.textContent = CONFIG.apiBase;
  checkExistingSession();
  setupRemoteListeners();
});

/**
 * Check if TV is already paired
 */
async function checkExistingSession() {
  if (currentDeviceId) {
    try {
      const res = await fetch(`${CONFIG.apiBase}/api/pair/status?device_id=${currentDeviceId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.paired) {
          activateTranslationScreen(data);
          return;
        }
      }
    } catch (e) {
      console.warn("Could not verify existing session, re-initializing pairing:", e);
    }
  }

  // Not paired or session expired -> Start pairing flow
  startPairingFlow();
}

/**
 * 1. Request Pairing Code and QR from Backend
 */
async function startPairingFlow() {
  showScreen("screenPairing");
  pairingStatusText.textContent = "جاري إنشاء رمز الاقتران...";

  try {
    const res = await fetch(`${CONFIG.apiBase}/api/pair/init`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_type: CONFIG.deviceType,
        device_name: "LG webOS Smart TV",
        device_model: navigator.userAgent
      })
    });

    if (!res.ok) throw new Error("Failed to initialize pairing");

    const data = await res.json();
    currentDeviceId = data.device_id;
    currentPairingCode = data.pairing_code;
    localStorage.setItem("translatetv_device_id", currentDeviceId);

    // Display Pairing Code
    pairingCodeDisplay.textContent = currentPairingCode;

    // Render QR Code
    qrContainer.innerHTML = "";
    new QRCode(qrContainer, {
      text: data.qr_payload,
      width: 320,
      height: 320,
      colorDark: "#000000",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.M
    });

    pairingStatusText.textContent = "في انتظار مسح الرمز من تطبيق الهاتف...";

    // Start polling status
    startPollingPairingStatus();
  } catch (err) {
    pairingStatusText.textContent = "تعذر الاتصال بالخادم. يرجى التأكد من تشغيل الـ API.";
    console.error("Pairing init error:", err);
  }
}

/**
 * 2. Poll pairing status until mobile claims it
 */
function startPollingPairingStatus() {
  if (pollTimer) clearInterval(pollTimer);

  pollTimer = setInterval(async () => {
    if (!currentDeviceId && !currentPairingCode) return;

    try {
      // 1. Check pairing status
      const res = await fetch(`${CONFIG.apiBase}/api/pair/status?device_id=${currentDeviceId || ''}&code=${currentPairingCode || ''}`);
      if (res.ok) {
        const data = await res.json();
        if (data.paired) {
          clearInterval(pollTimer);
          activateTranslationScreen(data);
          return;
        }
      }

      // 2. Also check if subtitles are arriving for this device from mobile
      const relayRes = await fetch(`${CONFIG.apiBase}/api/relay/latest?device_id=${currentDeviceId || ''}&code=${currentPairingCode || ''}`);
      if (relayRes.ok) {
        const rData = await relayRes.json();
        if (rData.has_update && rData.packet) {
          clearInterval(pollTimer);
          activateTranslationScreen({ user_name: "الهاتف المقترن", tier: "PRO" });
          displaySubtitle(rData.packet.original, rData.packet.translated);
          return;
        }
      }
    } catch (err) {
      console.warn("Polling error:", err);
    }
  }, 1500);
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

function displaySubtitle(original, translated) {
  originalTextEl.textContent = original;
  translatedTextEl.textContent = translated;
  subtitleOverlay.style.display = "block";

  // Also update player overlay if active
  const playerAr = document.getElementById("playerArText");
  if (playerAr) {
    playerAr.textContent = translated;
  }
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

function setupRemoteListeners() {
  window.addEventListener("keydown", (e) => {
    // webOS Remote keycodes
    const KEY_ENTER = 13;
    const KEY_BACK = 461; // webOS back key
    const KEY_MENU = 18;
    const KEY_NUM_1 = 49; // Number 1 on remote

    if (e.keyCode === KEY_NUM_1) {
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
      }
    }
  });
}
