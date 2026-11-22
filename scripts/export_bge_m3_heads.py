"""Export BGE-M3 ColBERT and sparse heads to the sidecar binary format.

Weights are not stored in git. The script reads a local ``BAAI/bge-m3`` directory
that already contains ``colbert_linear.pt`` and ``sparse_linear.pt``.
"""

from __future__ import annotations

import argparse
import hashlib
import struct
from pathlib import Path


def export_linear(source: Path, destination: Path, magic: bytes) -> None:
    import torch

    state = torch.load(source, map_location="cpu")
    weight = state["weight"].detach().float().contiguous()
    bias = state["bias"].detach().float().contiguous()
    out_dim, in_dim = weight.shape
    payload = bytearray(magic)
    payload += struct.pack("<II", int(in_dim), int(out_dim))
    payload += weight.numpy().tobytes()
    payload += bias.numpy().tobytes()
    destination.write_bytes(payload)
    digest = hashlib.sha256(payload).hexdigest()
    rebuilt_in = struct.unpack_from("<I", payload, 8)[0]
    rebuilt_out = struct.unpack_from("<I", payload, 12)[0]
    if rebuilt_in != in_dim or rebuilt_out != out_dim:
        raise SystemExit("exported header does not match the tensor")
    print(f"{destination.name} sha256={digest} in={in_dim} out={out_dim}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--out-dir", type=Path, required=True)
    args = parser.parse_args()
    args.out_dir.mkdir(parents=True, exist_ok=True)
    export_linear(args.model_dir / "colbert_linear.pt", args.out_dir / "colbert_linear.bin", b"NMCB0001")
    export_linear(args.model_dir / "sparse_linear.pt", args.out_dir / "sparse_linear.bin", b"NMSP0001")


if __name__ == "__main__":
    main()
