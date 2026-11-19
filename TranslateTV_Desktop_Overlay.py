import sys
import os
import io
import time
import json
import threading
import urllib.request
import urllib.parse

from PyQt6.QtWidgets import (
    QApplication, QWidget, QLabel, QVBoxLayout, QHBoxLayout, 
    QLineEdit, QPushButton, QFrame
)
from PyQt6.QtCore import Qt, QTimer, QPoint, pyqtSignal, QObject, QBuffer, QIODevice
from PyQt6.QtGui import QFont, QColor

import ctypes

# Windows API constants for click-through transparency
GWL_EXSTYLE = -20
WS_EX_TRANSPARENT = 0x00000020
WS_EX_LAYERED = 0x00080000

class OCRSignals(QObject):
    subtitle_ready = pyqtSignal(str, str) # original, translated

class GameSubtitleOverlay(QWidget):
    def __init__(self):
        super().__init__()
        
        # Configuration
        self.api_base = "https://translatetv-api.honda-druid.workers.dev"
        self.device_code = "K95AL6"
        self.last_packet_id = None
        self.is_click_through = False
        self.drag_position = QPoint()
        
        # OCR Mode State
        self.ocr_enabled = False
        self.last_ocr_text = ""
        self.ocr_lock = threading.Lock()
        self.translation_cache = {}
        # Pre-seed offline game dictionary for instant 0ms hits
        dict_path = os.path.join(os.path.dirname(__file__), "data", "game_dictionary_ar.json")
        if os.path.exists(dict_path):
            try:
                with open(dict_path, "r", encoding="utf-8") as f:
                    d = json.load(f)
                    for k, v in d.get("entries", {}).items():
                        self.translation_cache[k.lower().strip()] = v
            except Exception as e:
                pass
        
        # Communication signals for thread-safe UI updates
        self.signals = OCRSignals()
        self.signals.subtitle_ready.connect(self.on_subtitle_ready)

        self.init_ui()
        self.init_timers()

    def init_ui(self):
        # Frameless, transparent, always on top
        self.setWindowFlags(
            Qt.WindowType.WindowStaysOnTopHint | 
            Qt.WindowType.FramelessWindowHint | 
            Qt.WindowType.Tool
        )
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        
        # Geometry: centered at bottom of screen
        screen = QApplication.primaryScreen().geometry()
        width = min(1120, int(screen.width() * 0.85))
        height = 150
        x = (screen.width() - width) // 2
        y = screen.height() - height - 40
        self.setGeometry(x, y, width, height)

        # Layout
        root_layout = QVBoxLayout(self)
        root_layout.setContentsMargins(0, 0, 0, 0)

        self.card = QFrame(self)
        self.card.setStyleSheet("""
            QFrame {
                background-color: rgba(9, 13, 24, 215);
                border-radius: 16px;
                border: 1px solid rgba(59, 130, 246, 0.4);
            }
        """)
        card_layout = QVBoxLayout(self.card)
        card_layout.setContentsMargins(18, 10, 18, 12)
        card_layout.setSpacing(4)

        # Control Bar
        self.control_bar = QHBoxLayout()
        self.control_bar.setSpacing(8)

        self.lbl_brand = QLabel("🎮 TranslateTV Gaming HUD")
        self.lbl_brand.setStyleSheet("color: #60a5fa; font-weight: 800; font-size: 12px;")
        self.control_bar.addWidget(self.lbl_brand)

        # OCR Mode Toggle
        self.btn_ocr = QPushButton("📸 تفعيل قراءة الشاشة (OCR)")
        self.btn_ocr.setStyleSheet("background: #0284c7; color: white; font-weight: bold; font-size: 11px; border-radius: 6px; padding: 4px 10px;")
        self.btn_ocr.clicked.connect(self.toggle_ocr_mode)
        self.control_bar.addWidget(self.btn_ocr)

        # Relay Code Input
        self.code_input = QLineEdit(self.device_code)
        self.code_input.setPlaceholderText("كود الشاشة")
        self.code_input.setMaxLength(8)
        self.code_input.setFixedWidth(75)
        self.code_input.setStyleSheet("""
            background: #1e293b; color: #fbbf24; font-weight: bold; font-size: 11px;
            border: 1px solid #334155; border-radius: 6px; padding: 2px 4px; text-align: center;
        """)
        self.control_bar.addWidget(self.code_input)

        self.btn_save_code = QPushButton("ربط الجوال")
        self.btn_save_code.setFixedWidth(65)
        self.btn_save_code.setStyleSheet("background: #2563eb; color: white; font-size: 11px; font-weight: bold; border-radius: 6px; padding: 3px;")
        self.btn_save_code.clicked.connect(self.update_code)
        self.control_bar.addWidget(self.btn_save_code)

        self.control_bar.addStretch()

        # Click-Through Toggle
        self.btn_lock = QPushButton("🔒 قفل وتمرير النقرات للعبة")
        self.btn_lock.setStyleSheet("background: #059669; color: white; font-weight: 800; font-size: 11px; border-radius: 6px; padding: 4px 12px;")
        self.btn_lock.clicked.connect(self.toggle_click_through)
        self.control_bar.addWidget(self.btn_lock)

        self.btn_close = QPushButton("✕")
        self.btn_close.setFixedWidth(26)
        self.btn_close.setStyleSheet("background: #ef4444; color: white; font-size: 12px; font-weight: bold; border-radius: 6px;")
        self.btn_close.clicked.connect(self.close)
        self.control_bar.addWidget(self.btn_close)

        card_layout.addLayout(self.control_bar)

        # Original Subtitle (English)
        self.lbl_original = QLabel("Original game dialogue appears here...")
        self.lbl_original.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.lbl_original.setStyleSheet("color: #94a3b8; font-size: 14px; font-weight: 600;")
        card_layout.addWidget(self.lbl_original)

        # Translated Subtitle (Saudi Dialect Arabic)
        self.lbl_translated = QLabel("جاهز لترجمة حوارات اللعبة بالعامية السعودية 🇸🇦")
        self.lbl_translated.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.lbl_translated.setStyleSheet("""
            color: #ffffff;
            font-size: 24px;
            font-weight: 800;
            font-family: 'Cairo', 'Segoe UI', sans-serif;
        """)
        card_layout.addWidget(self.lbl_translated)

        root_layout.addWidget(self.card)

    def init_timers(self):
        # 1. Timer for Cloudflare / Phone Relay Subtitles (every 350ms)
        self.relay_timer = QTimer(self)
        self.relay_timer.timeout.connect(self.fetch_relay_subtitles)
        self.relay_timer.start(350)

        # 2. Timer for In-Game Screen OCR (every 280ms)
        self.ocr_timer = QTimer(self)
        self.ocr_timer.timeout.connect(self.capture_and_ocr)

    def toggle_ocr_mode(self):
        self.ocr_enabled = not self.ocr_enabled
        if self.ocr_enabled:
            self.btn_ocr.setText("🟢 قراءة الشاشة (OCR) نشطة")
            self.btn_ocr.setStyleSheet("background: #10b981; color: #000; font-weight: 800; font-size: 11px; border-radius: 6px; padding: 4px 10px;")
            self.lbl_translated.setText("جاري قراءة ترجمة اللعبة مباشرة من الشاشة في أجزاء من الثانية...")
            self.ocr_timer.start(280)
        else:
            self.btn_ocr.setText("📸 تفعيل قراءة الشاشة (OCR)")
            self.btn_ocr.setStyleSheet("background: #0284c7; color: white; font-weight: bold; font-size: 11px; border-radius: 6px; padding: 4px 10px;")
            self.ocr_timer.stop()

    def capture_and_ocr(self):
        if not self.ocr_enabled:
            return

        screen = QApplication.primaryScreen()
        if not screen:
            return

        geom = screen.geometry()
        # Subtitle area: Bottom 25% of the screen center
        sub_w = int(geom.width() * 0.70)
        sub_h = int(geom.height() * 0.22)
        sub_x = (geom.width() - sub_w) // 2
        sub_y = int(geom.height() * 0.70)

        # Temporarily hide overlay from capture or grab directly
        pix = screen.grabWindow(0, sub_x, sub_y, sub_w, sub_h)
        if pix.isNull():
            return

        buf = QBuffer()
        buf.open(QIODevice.OpenModeFlag.ReadWrite)
        pix.save(buf, "BMP")
        bytes_data = bytes(buf.data())

        # Offload OCR to background thread so GUI remains at 120 FPS
        threading.Thread(target=self._process_ocr_bytes, args=(bytes_data,), daemon=True).start()

    def _process_ocr_bytes(self, img_bytes):
        if not self.ocr_lock.acquire(blocking=False):
            return

        try:
            import winrt.windows.media.ocr as ocr
            import winrt.windows.globalization as glob
            import winrt.windows.graphics.imaging as imaging
            import winrt.windows.storage.streams as streams

            writer = streams.DataWriter()
            writer.write_bytes(img_bytes)
            ibuffer = writer.detach_buffer()

            mem_stream = streams.InMemoryRandomAccessStream()
            mem_stream.write_async(ibuffer).get()
            mem_stream.seek(0)

            decoder = imaging.BitmapDecoder.create_async(mem_stream).get()
            s_bitmap = decoder.get_software_bitmap_async().get()

            lang = glob.Language("en-US")
            engine = ocr.OcrEngine.try_create_from_language(lang)
            res = engine.recognize_async(s_bitmap).get()
            
            raw_text = res.text.strip() if res and res.text else ""
            # Filter noise / short text
            if len(raw_text) >= 4 and raw_text != self.last_ocr_text:
                self.last_ocr_text = raw_text
                
                # Check local cache or translate
                if raw_text in self.translation_cache:
                    trans = self.translation_cache[raw_text]
                else:
                    trans = self.translate_to_saudi(raw_text)
                    self.translation_cache[raw_text] = trans

                self.signals.subtitle_ready.emit(raw_text, trans)
        except Exception:
            pass
        finally:
            self.ocr_lock.release()

    def translate_to_saudi(self, text):
        try:
            req_data = json.dumps({
                "text": text,
                "source_lang": "en",
                "target_lang": "ar"
            }).encode("utf-8")

            req = urllib.request.Request(
                f"{self.api_base}/api/translate",
                data=req_data,
                headers={
                    "Content-Type": "application/json",
                    "User-Agent": "TranslateTV-Desktop/1.0"
                }
            )
            with urllib.request.urlopen(req, timeout=2.0) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return data.get("translated_text") or data.get("translation") or text
        except Exception:
            return text

    def on_subtitle_ready(self, orig, trans):
        self.lbl_original.setText(orig)
        self.lbl_translated.setText(trans)

    def update_code(self):
        self.device_code = self.code_input.text().strip().upper()
        self.lbl_translated.setText(f"تم ربط الكود: {self.device_code} ✅")

    def fetch_relay_subtitles(self):
        if self.ocr_enabled:
            return # Prioritize instant screen OCR when active

        code = self.code_input.text().strip().upper() or "DEMO-TV-DEVICE"
        url = f"{self.api_base}/api/relay/latest?code={code}"
        if self.last_packet_id:
            url += f"&last_id={self.last_packet_id}"

        try:
            req = urllib.request.Request(url, headers={"User-Agent": "TranslateTV-Desktop/1.0"})
            with urllib.request.urlopen(req, timeout=1.0) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                if data.get("has_update") and data.get("packet"):
                    packet = data["packet"]
                    self.last_packet_id = packet.get("id")
                    orig = packet.get("original", "")
                    trans = packet.get("translated", "")
                    if orig or trans:
                        self.on_subtitle_ready(orig, trans)
        except Exception:
            pass

    def toggle_click_through(self):
        hwnd = int(self.winId())
        user32 = ctypes.windll.user32

        if not self.is_click_through:
            # Enable click-through: mouse clicks pass directly into the game!
            ex_style = user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
            user32.SetWindowLongW(hwnd, GWL_EXSTYLE, ex_style | WS_EX_TRANSPARENT | WS_EX_LAYERED)
            self.is_click_through = True
            self.btn_lock.setText("🔓 فك القفل للتحريك")
            self.btn_lock.setStyleSheet("background: #d97706; color: white; font-weight: 800; font-size: 11px; border-radius: 6px; padding: 4px 12px;")
            self.card.setStyleSheet("""
                QFrame {
                    background-color: rgba(5, 8, 16, 195);
                    border-radius: 16px;
                    border: 1px solid rgba(16, 185, 129, 0.6);
                }
            """)
        else:
            ex_style = user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
            user32.SetWindowLongW(hwnd, GWL_EXSTYLE, ex_style & ~WS_EX_TRANSPARENT)
            self.is_click_through = False
            self.btn_lock.setText("🔒 قفل وتمرير النقرات للعبة")
            self.btn_lock.setStyleSheet("background: #059669; color: white; font-weight: 800; font-size: 11px; border-radius: 6px; padding: 4px 12px;")
            self.card.setStyleSheet("""
                QFrame {
                    background-color: rgba(9, 13, 24, 215);
                    border-radius: 16px;
                    border: 1px solid rgba(59, 130, 246, 0.4);
                }
            """)

    def mousePressEvent(self, event):
        if not self.is_click_through and event.button() == Qt.MouseButton.LeftButton:
            self.drag_position = event.globalPosition().toPoint() - self.frameGeometry().topLeft()
            event.accept()

    def mouseMoveEvent(self, event):
        if not self.is_click_through and event.buttons() == Qt.MouseButton.LeftButton:
            self.move(event.globalPosition().toPoint() - self.drag_position)
            event.accept()

if __name__ == "__main__":
    app = QApplication(sys.argv)
    overlay = GameSubtitleOverlay()
    overlay.show()
    sys.exit(app.exec())
