"""
TranslateTV — Self-Hosted Real-time Whisper STT & Translation Server
Runs faster-whisper on GPU/CPU for instant audio speech-to-text.
"""

from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import shutil
import os
import tempfile

app = FastAPI(title="TranslateTV Whisper Engine", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

model = None

@app.on_event("startup")
def load_whisper():
    global model
    try:
        from faster_whisper import WhisperModel
        # Model sizes: 'tiny', 'base', 'small', 'medium'
        model_size = os.getenv("WHISPER_MODEL", "base")
        device = os.getenv("WHISPER_DEVICE", "cpu") # or 'cuda' if GPU available
        compute_type = os.getenv("WHISPER_COMPUTE", "int8") # 'float16' for GPU
        print(f"Loading faster-whisper ({model_size}) on {device}...")
        model = WhisperModel(model_size, device=device, compute_type=compute_type)
        print("Whisper model loaded successfully!")
    except Exception as e:
        print(f"Warning: faster-whisper not installed or failed to load: {e}")
        print("Install via: pip install faster-whisper")

@app.get("/health")
def health():
    return {"status": "ok", "engine": "faster-whisper", "loaded": model is not None}

@app.post("/transcribe")
async def transcribe_audio(audio: UploadFile = File(...)):
    """Transcribes English audio speech to text with timestamps"""
    if model is None:
        return {"error": "Whisper model not initialized on server"}

    with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
        shutil.copyfileobj(audio.file, tmp)
        tmp_path = tmp.name

    try:
        segments, info = model.transcribe(tmp_path, language="en", beam_size=5)
        text_parts = [segment.text.strip() for segment in segments]
        full_text = " ".join(text_parts)

        return {
            "success": True,
            "detected_language": info.language,
            "language_probability": info.language_probability,
            "text": full_text
        }
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=9000)
