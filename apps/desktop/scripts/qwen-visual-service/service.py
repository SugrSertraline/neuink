#!/usr/bin/env python3
"""Local Qwen3-VL-Embedding-2B service for NeuInk's visual retrieval channel.

Contract (one JSON object per request, all responses JSON):

    GET  /health                 -> {"ready","model","dimensions","identity"}
    POST /embed                  <- {"texts":["..."],"images":["<base64>"]}
                                 -> {"vectors":[[float,...],...]}   texts first
    POST /embed_pages            <- {"pdf_path":"...","pages":[0,1],"regions":true}
                                 -> {"vectors":[{"page":0,"region":null,"vector":[...]},
                                                {"page":0,"region":0,"vector":[...]}, ...]}

The model is Qwen3-VL-Embedding-2B run with transformers; PDF rasterization uses
PyMuPDF. Both live here on purpose: the desktop app then needs no PDF renderer and no
4 GB runtime, and a machine without this service simply reports `model_unavailable`.

`--stub` returns deterministic vectors without loading anything. It exists so the whole
product chain (backfill -> prepare -> dual-channel query) can be tested offline.

Environment:
    NEUINK_QWEN_VL_MODEL   model directory containing scripts/qwen3_vl_embedding.py
    NEUINK_EMBED_DIM       output dimensions, default 2048
    NEUINK_PDF_DPI         rasterization DPI, default 110
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DEFAULT_DIM = int(os.environ.get("NEUINK_EMBED_DIM", "2048"))
PDF_DPI = int(os.environ.get("NEUINK_PDF_DPI", "110"))
REGION_COUNT = 4


def stub_vector(key: str, dimensions: int) -> list[float]:
    """Deterministic unit vector from a key. Same key, same vector, any process."""
    seed = hashlib.blake2b(key.encode("utf-8"), digest_size=32).digest()
    raw = bytearray()
    counter = 0
    while len(raw) < dimensions:
        raw.extend(hashlib.blake2b(seed + counter.to_bytes(4, "little"), digest_size=32).digest())
        counter += 1
    values = [((byte / 255.0) - 0.5) for byte in raw[:dimensions]]
    norm = sum(value * value for value in values) ** 0.5 or 1.0
    return [value / norm for value in values]


class StubEncoder:
    dimensions = DEFAULT_DIM
    identity = "stub-visual-v1"
    model_name = "stub"

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        return [stub_vector(f"text:{text}", self.dimensions) for text in texts]

    def embed_images(self, images: list[bytes]) -> list[list[float]]:
        return [
            stub_vector(f"image:{hashlib.sha256(image).hexdigest()}", self.dimensions)
            for image in images
        ]

    def embed_pages(self, pdf_path: str, pages: list[int], regions: bool) -> list[dict]:
        out = []
        for page in pages:
            out.append(
                {
                    "page": page,
                    "region": None,
                    "vector": stub_vector(f"page:{pdf_path}:{page}", self.dimensions),
                }
            )
            if regions:
                for crop in range(REGION_COUNT):
                    out.append(
                        {
                            "page": page,
                            "region": crop,
                            "vector": stub_vector(f"page:{pdf_path}:{page}:r{crop}", self.dimensions),
                        }
                    )
        return out


class QwenEncoder:
    """Real embedding path: transformers model + PyMuPDF rasterization."""

    def __init__(self, model_dir: Path) -> None:
        import fitz  # noqa: F401 - imported here so --stub needs no PyMuPDF
        sys.path.insert(0, str(model_dir / "scripts"))
        from qwen3_vl_embedding import Qwen3VLEmbedder  # type: ignore

        self._fitz = fitz
        self._embedder = Qwen3VLEmbedder(str(model_dir), min_pixels=256, max_pixels=65536)
        self.dimensions = DEFAULT_DIM
        self.model_name = model_dir.name
        # Identity covers every inference input, so replaced weights invalidate vectors.
        hasher = hashlib.blake2b(digest_size=32)
        for name in ("model.safetensors", "config.json", "tokenizer.json", "preprocessor_config.json"):
            path = model_dir / name
            if path.is_file():
                hasher.update(name.encode())
                hasher.update(path.read_bytes())
        self.identity = hasher.hexdigest()

    def _process(self, items: list[dict]) -> list[list[float]]:
        import torch

        vectors = []
        for start in range(0, len(items), 2):  # batch 2, as measured
            batch = self._embedder.process(items[start : start + 2])
            vectors.extend(batch.detach().float().cpu().tolist())
        return vectors

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        return self._process([{"text": text, "image": None} for text in texts])

    def embed_images(self, images: list[bytes]) -> list[list[float]]:
        from PIL import Image

        decoded = [Image.open(io.BytesIO(image)).convert("RGB") for image in images]
        return self._process([{"text": None, "image": image} for image in decoded])

    def embed_pages(self, pdf_path: str, pages: list[int], regions: bool) -> list[dict]:
        document = self._fitz.open(pdf_path)
        out = []
        for page in pages:
            pixmap = document.load_page(page).get_pixmap(dpi=PDF_DPI)
            from PIL import Image

            page_image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
            out.append({"page": page, "region": None, "vector": self.embed_images([self._png(page_image)])[0]})
            if regions:
                for crop, box in enumerate(self._crops(page_image.size)):
                    out.append(
                        {
                            "page": page,
                            "region": crop,
                            "vector": self.embed_images([self._png(page_image.crop(box))])[0],
                        }
                    )
        return out

    @staticmethod
    def _crops(size: tuple[int, int]) -> list[tuple[int, int, int, int]]:
        width, height = size
        return [
            (0, 0, width, height // 2),
            (0, height // 2, width, height),
            (0, 0, width // 2, height),
            (width // 2, 0, width, height),
        ]

    @staticmethod
    def _png(image) -> bytes:
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        return buffer.getvalue()


class Handler(BaseHTTPRequestHandler):
    encoder = None
    lock = threading.Lock()

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def log_message(self, *args) -> None:  # keep the console quiet
        pass

    def do_GET(self) -> None:  # noqa: N802 - http.server API
        if self.path != "/health":
            self._json(404, {"error": "not found"})
            return
        encoder = self.encoder
        self._json(
            200,
            {
                "ready": True,
                "model": encoder.model_name,
                "dimensions": encoder.dimensions,
                "identity": encoder.identity,
            },
        )

    def do_POST(self) -> None:  # noqa: N802 - http.server API
        try:
            body = self._read_body()
            with self.lock:
                if self.path == "/embed":
                    self._embed(body)
                elif self.path == "/embed_pages":
                    self._embed_pages(body)
                else:
                    self._json(404, {"error": "not found"})
        except Exception as error:  # noqa: BLE001 - the client turns any failure into a fixed code
            self._json(500, {"error": str(error)})

    def _embed(self, body: dict) -> None:
        texts = [str(text) for text in body.get("texts") or []]
        images = [base64.b64decode(image) for image in body.get("images") or []]
        vectors = self.encoder.embed_texts(texts) + self.encoder.embed_images(images)
        self._json(200, {"vectors": vectors})

    def _embed_pages(self, body: dict) -> None:
        pdf_path = str(body.get("pdf_path") or "")
        pages = [int(page) for page in body.get("pages") or []]
        regions = bool(body.get("regions"))
        if not pdf_path or not pages:
            self._json(400, {"error": "pdf_path and pages are required"})
            return
        self._json(200, {"vectors": self.encoder.embed_pages(pdf_path, pages, regions)})


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--stub", action="store_true", help="deterministic vectors, no model")
    args = parser.parse_args()

    if args.stub:
        Handler.encoder = StubEncoder()
    else:
        model_dir = os.environ.get("NEUINK_QWEN_VL_MODEL")
        if not model_dir:
            print("NEUINK_QWEN_VL_MODEL is required unless --stub is used", file=sys.stderr)
            return 2
        Handler.encoder = QwenEncoder(Path(model_dir))

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(
        f"visual service on http://{args.host}:{args.port} "
        f"model={Handler.encoder.model_name} dimensions={Handler.encoder.dimensions}",
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
