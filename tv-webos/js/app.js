/**
 * TranslateTV — LG webOS TV Client Logic
 */

// Configuration
const CONFIG = {
  // In production, point to your Cloudflare Worker domain:
  // e.g. "https://api.translatetv.app"
  apiBase: localStorage.getItem("translatetv_api") || "http://localhost:8787",
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
    if (!currentDeviceId) return;

    try {
      const res = await fetch(`${CONFIG.apiBase}/api/pair/status?device_id=${currentDeviceId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.paired) {
          clearInterval(pollTimer);
          activateTranslationScreen(data);
        }
      }
    } catch (err) {
      console.warn("Polling error:", err);
    }
  }, CONFIG.pollIntervalMs);
}

/**
 * 3. Activate Translation Display Screen
 */
function activateTranslationScreen(deviceData) {
  showScreen("screenTranslation");

  connectedUserName.textContent = deviceData.user_name || "المستخدم";
  connectedTier.textContent = (deviceData.tier || "FREE").toUpperCase();

  // Show temporary hint
  showToast("تم الاقتران بنجاح! جاهز لعرض الترجمة");

  // Auto hide top bar after 6 seconds
  setTimeout(() => {
    topBar.style.opacity = "0.2";
  }, 6000);

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
    if (!currentDeviceId) return;

    try {
      const url = `${CONFIG.apiBase}/api/relay/latest?device_id=${currentDeviceId}${lastPacketId ? `&last_id=${lastPacketId}` : ''}`;
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
  }, 750); // check every 750ms for instant subtitle updates
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

function setupRemoteListeners() {
  window.addEventListener("keydown", (e) => {
    // webOS Remote keycodes
    const KEY_ENTER = 13;
    const KEY_BACK = 461; // webOS back key
    const KEY_MENU = 18;

    if (e.keyCode === KEY_ENTER) {
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
