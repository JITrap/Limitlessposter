"""Stimme – lokaler Sprach-Server für Limitless OS.

Ein kleiner HTTP-Server (nur 127.0.0.1), der Text in deutsche Sprache verwandelt.
Motor 1: Chatterbox Multilingual (Resemble AI, MIT) – natürliche Stimme, eigene
Stimme per Referenz-WAV möglich, braucht am besten eine Grafikkarte.
Motor 2: Piper (MIT) – läuft auf jeder CPU, Stimme "thorsten" (Deutsch).

Start:  python server.py [--port 4243] [--engine auto|chatterbox|piper]
Pfade:  --voices-dir  Ordner mit eigenen Referenz-Stimmen (*.wav, 10–30 s, sauber)
        --data-dir    Ordner für heruntergeladene Modelle

Endpunkte:
  GET  /status   → {ok, engine, cuda, model_loaded, voices, fehler, python}
  POST /speak    ← {text, voice, language, speed, emotion}
                 → {ok, engine, wav_base64, sample_rate, duration, segments, text}
  POST /shutdown
Keine Schlüssel, keine Cloud, nichts verlässt den Rechner.
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import os
import struct
import subprocess
import sys
import threading
import time
import traceback
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HIER = Path(__file__).resolve().parent
sys.path.insert(0, str(HIER))
from vorverarbeitung import normalisieren, saetze  # noqa: E402

PAUSE_SATZ = 0.32
PAUSE_ABSATZ = 0.65
PIPER_STIMME = "de_DE-thorsten-high"


def _stille(sekunden: float, sr: int) -> bytes:
    return b"\x00\x00" * int(sekunden * sr)


def _wav_bytes(pcm: bytes, sr: int) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm)
    return buf.getvalue()


def _float_zu_int16(samples) -> bytes:
    out = bytearray()
    for s in samples:
        v = max(-1.0, min(1.0, float(s)))
        out += struct.pack("<h", int(v * 32767))
    return bytes(out)


class Engine:
    def __init__(self, voices_dir: Path, data_dir: Path, wunsch: str = "auto"):
        self.voices_dir = voices_dir
        self.data_dir = data_dir
        self.wunsch = wunsch
        self.engine: str | None = None
        self.model = None
        self.cuda = False
        self.sr = 22050
        self.fehler: list[str] = []
        self.lock = threading.Lock()
        self.loading = False

    # ---------- Stimmen ----------
    def voices(self) -> list[dict]:
        out = [{"id": "thorsten", "art": "eingebaut", "engine": "piper"}]
        if self.voices_dir.is_dir():
            for p in sorted(self.voices_dir.glob("*.wav")):
                out.append({"id": p.stem, "art": "eigene", "engine": "chatterbox",
                            "datei": str(p)})
        return out

    def _referenz(self, voice: str) -> Path | None:
        p = self.voices_dir / f"{voice}.wav"
        return p if p.is_file() else None

    # ---------- Laden ----------
    def load(self) -> None:
        """Lädt den Motor. Läuft gerade ein Ladevorgang (--preload), wartet der Aufrufer auf ihn."""
        with self.lock:
            if self.model is not None:
                return
            self.loading = True
            self.fehler = []
            try:
                if self.wunsch in ("auto", "chatterbox"):
                    try:
                        self._load_chatterbox()
                        return
                    except Exception as e:  # noqa: BLE001
                        self.fehler.append(f"chatterbox: {type(e).__name__}: {e}")
                        if self.wunsch == "chatterbox":
                            return
                try:
                    self._load_piper()
                except Exception as e:  # noqa: BLE001
                    self.fehler.append(f"piper: {type(e).__name__}: {e}")
            finally:
                self.loading = False

    def _load_chatterbox(self) -> None:
        import torch  # type: ignore
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS  # type: ignore

        self.cuda = bool(torch.cuda.is_available())
        device = "cuda" if self.cuda else "cpu"
        self.model = ChatterboxMultilingualTTS.from_pretrained(device=device)
        self.sr = int(getattr(self.model, "sr", 24000))
        self.engine = "chatterbox"

    def _piper_modell(self) -> tuple[Path, Path]:
        ordner = self.data_dir / "piper"
        onnx = ordner / f"{PIPER_STIMME}.onnx"
        cfg = ordner / f"{PIPER_STIMME}.onnx.json"
        if not (onnx.is_file() and cfg.is_file()):
            ordner.mkdir(parents=True, exist_ok=True)
            subprocess.run(
                [sys.executable, "-m", "piper.download_voices", "--data-dir", str(ordner),
                 PIPER_STIMME],
                check=True, timeout=900,
            )
        return onnx, cfg

    def _load_piper(self) -> None:
        from piper import PiperVoice  # type: ignore

        onnx, cfg = self._piper_modell()
        self.model = PiperVoice.load(str(onnx), config_path=str(cfg))
        self.sr = int(self.model.config.sample_rate)
        self.engine = "piper"

    # ---------- Sprechen ----------
    def _speak_piper(self, text: str, speed: float) -> bytes:
        from piper import SynthesisConfig  # type: ignore

        cfg = SynthesisConfig(length_scale=1.0 / max(0.5, min(2.0, speed)))
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            self.model.synthesize_wav(text, w, syn_config=cfg)
        buf.seek(0)
        with wave.open(buf, "rb") as r:
            return r.readframes(r.getnframes())

    def _speak_chatterbox(self, text: str, voice: str, emotion: float) -> bytes:
        ref = self._referenz(voice)
        kw = {"language_id": "de", "exaggeration": max(0.0, min(1.0, emotion)),
              "cfg_weight": 0.5}
        if ref:
            kw["audio_prompt_path"] = str(ref)
        wav = self.model.generate(text, **kw)
        samples = wav.squeeze().detach().cpu().numpy().tolist()
        return _float_zu_int16(samples)

    def speak(self, text: str, voice: str = "thorsten", speed: float = 1.0,
              emotion: float = 0.5) -> dict:
        if self.model is None:
            self.load()
        if self.model is None:
            raise RuntimeError("Kein Sprachmotor geladen: " + "; ".join(self.fehler))
        klar = normalisieren(text)
        teile = saetze(klar)
        pcm = bytearray()
        segments = []
        pos = 0.0
        for s in teile:
            if s == "":
                pcm += _stille(PAUSE_ABSATZ, self.sr)
                pos += PAUSE_ABSATZ
                continue
            if self.engine == "piper":
                daten = self._speak_piper(s, speed)
            else:
                daten = self._speak_chatterbox(s, voice, emotion)
                if abs(speed - 1.0) > 0.05:
                    daten = _tempo(daten, speed)
            dauer = len(daten) / 2 / self.sr
            segments.append({"text": s, "start": round(pos, 3), "end": round(pos + dauer, 3)})
            pcm += daten
            pos += dauer
            pcm += _stille(PAUSE_SATZ, self.sr)
            pos += PAUSE_SATZ
        return {
            "ok": True,
            "engine": self.engine,
            "wav_base64": base64.b64encode(_wav_bytes(bytes(pcm), self.sr)).decode("ascii"),
            "sample_rate": self.sr,
            "duration": round(pos, 3),
            "segments": segments,
            "text": klar,
        }


def _tempo(pcm: bytes, speed: float) -> bytes:
    """Grobe Tempo-Anpassung durch Resampling (nur für kleine Abweichungen)."""
    n = len(pcm) // 2
    werte = struct.unpack(f"<{n}h", pcm)
    ziel = int(n / speed)
    out = bytearray()
    for i in range(ziel):
        q = i * speed
        j = int(q)
        if j + 1 >= n:
            out += struct.pack("<h", werte[-1])
            continue
        f = q - j
        v = werte[j] * (1 - f) + werte[j + 1] * f
        out += struct.pack("<h", int(v))
    return bytes(out)


ENGINE: Engine | None = None
SERVER: ThreadingHTTPServer | None = None


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # leise
        pass

    def _json(self, code: int, body: dict) -> None:
        raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):  # noqa: N802
        if self.path.startswith("/status"):
            e = ENGINE
            self._json(200, {
                "ok": True,
                "engine": e.engine if e else None,
                "cuda": e.cuda if e else False,
                "model_loaded": bool(e and e.model is not None),
                "loading": bool(e and e.loading),
                "voices": e.voices() if e else [],
                "fehler": e.fehler if e else [],
                "python": sys.version.split()[0],
            })
            return
        self._json(404, {"ok": False, "fehler": "unbekannter Pfad"})

    def do_POST(self):  # noqa: N802
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b"{}"
        try:
            body = json.loads(raw.decode("utf-8") or "{}")
        except Exception:  # noqa: BLE001
            self._json(400, {"ok": False, "fehler": "kein gültiges JSON"})
            return
        if self.path.startswith("/shutdown"):
            self._json(200, {"ok": True})
            threading.Thread(target=lambda: SERVER and SERVER.shutdown(), daemon=True).start()
            return
        if not self.path.startswith("/speak"):
            self._json(404, {"ok": False, "fehler": "unbekannter Pfad"})
            return
        text = str(body.get("text") or "").strip()
        if not text:
            self._json(400, {"ok": False, "fehler": "text fehlt"})
            return
        try:
            res = ENGINE.speak(
                text,
                voice=str(body.get("voice") or "thorsten"),
                speed=float(body.get("speed") or 1.0),
                emotion=float(body.get("emotion") if body.get("emotion") is not None else 0.5),
            )
            self._json(200, res)
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            self._json(500, {"ok": False, "fehler": f"{type(e).__name__}: {e}",
                             "engine": ENGINE.engine if ENGINE else None})


def main() -> int:
    global ENGINE, SERVER
    ap = argparse.ArgumentParser(description="Stimme – lokaler Sprach-Server")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=int(os.environ.get("STIMME_PORT") or 4243))
    ap.add_argument("--voices-dir", default=os.environ.get("STIMME_VOICES") or str(HIER / "stimmen"))
    ap.add_argument("--data-dir", default=os.environ.get("STIMME_DATA") or str(HIER / "data"))
    ap.add_argument("--engine", default=os.environ.get("STIMME_ENGINE") or "auto",
                    choices=["auto", "chatterbox", "piper"])
    ap.add_argument("--preload", action="store_true", help="Modell sofort laden")
    a = ap.parse_args()

    ENGINE = Engine(Path(a.voices_dir), Path(a.data_dir), a.engine)
    if a.preload:
        threading.Thread(target=ENGINE.load, daemon=True).start()
    SERVER = ThreadingHTTPServer((a.host, a.port), Handler)
    print(f"Stimme hört auf http://{a.host}:{a.port} (engine={a.engine})", flush=True)
    try:
        SERVER.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
