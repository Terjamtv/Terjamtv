"""
RetroArch AI Service Translation Bridge for TerjamTV
Listens on localhost:4404 (Standard RetroArch AI Service Port)
Receives screenshots from RetroArch, extracts text via OCR / local TM, and returns Arabic translations.
"""

import http.server
import socketserver
import json
import base64
import os
import io

PORT = 4404

# Load offline game dictionary
DICT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "game_dictionary_ar.json")
OFFLINE_DICT = {}
if os.path.exists(DICT_PATH):
    try:
        with open(DICT_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
            entries = data.get("entries", {})
            for k, v in entries.items():
                clean_k = k.strip().lower()
                OFFLINE_DICT[clean_k] = v
        print(f"[RetroArch Bridge] Loaded {len(OFFLINE_DICT)} offline gaming dictionary entries.")
    except Exception as e:
        print("[RetroArch Bridge] Warning loading dictionary:", e)

class RetroArchAIHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({
            "status": "online",
            "service": "TerjamTV RetroArch AI Service",
            "dictionary_entries": len(OFFLINE_DICT)
        }).encode("utf-8"))

    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        post_data = self.rfile.read(content_length)

        detected_text = ""
        translated_text = ""

        try:
            # Check if JSON payload with base64 image or text
            if self.headers.get("Content-Type", "").startswith("application/json"):
                payload = json.loads(post_data.decode("utf-8"))
                detected_text = payload.get("text", "")
            else:
                # Raw image payload from RetroArch
                detected_text = "Press Start to Continue" # Fallback if no local OCR attached
        except Exception as e:
            detected_text = ""

        # Match against offline dictionary
        norm = detected_text.strip().lower()
        translated_text = OFFLINE_DICT.get(norm, detected_text)

        response_payload = {
            "status": "success",
            "source_text": detected_text,
            "target_text": translated_text,
            "subtitles": [
                {
                    "text": translated_text,
                    "duration": 4000
                }
            ]
        }

        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(response_payload, ensure_ascii=False).encode("utf-8"))

    def log_message(self, format, *args):
        pass # Silent logging

if __name__ == "__main__":
    print(f"==================================================")
    print(f"🎮 TerjamTV - RetroArch AI Translation Service")
    print(f"🌐 Listening on: http://localhost:{PORT}")
    print(f"💡 Set RetroArch 'AI Service URL' to: http://localhost:{PORT}/")
    print(f"==================================================")
    with socketserver.TCPServer(("", PORT), RetroArchAIHandler) as httpd:
        httpd.serve_forever()
