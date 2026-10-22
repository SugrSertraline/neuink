"""Build the bundled single-word dictionary from a pinned ECDICT CSV.

Source: https://github.com/skywind3000/ECDICT at
bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b (MIT license).
The source CSV is not committed; pass its local path as the sole argument.
"""

import csv
import hashlib
import json
import re
import sys
from pathlib import Path


SOURCE_SHA256 = "1a6947e04785db63613a92e14903cdae7954f7e84860b10e68e5c7cbb3f9c3cf"
FREQUENCY_LIMIT = 50_000
WORD_PATTERN = re.compile(r"[a-z]{2,40}\Z")
TECHNICAL_LINE = re.compile(r"^\[(?:计|数|物|化|生|医|统|地|电|机|天|经)\]")
OUTPUT = Path(__file__).resolve().parents[1] / "src/modules/reader/translation/localEnglishDictionary"


def translation_summary(raw: str) -> str | None:
    regular: list[str] = []
    technical: list[str] = []
    for source_line in raw.replace("\\n", "\n").splitlines():
        line = " ".join(source_line.strip().split())
        if not line or "\ufffd" in line or "http" in line.lower() or line.startswith("[网络]"):
            continue
        if not any("\u3400" <= char <= "\u9fff" for char in line):
            continue
        if TECHNICAL_LINE.match(line):
            technical.append(line)
        elif len(regular) < 2:
            regular.append(line)
    selected = regular[:2] + technical[:2]
    if not selected:
        return None
    summary = "；".join(selected)
    if len(summary) > 180:
        summary = summary[:180].rsplit("；", 1)[0] or summary[:180]
    return summary


def selected_row(row: dict[str, str]) -> bool:
    try:
        frequency = int(row["frq"] or 0)
        corpus_rank = int(row["bnc"] or 0)
    except ValueError:
        return False
    return (
        0 < frequency <= FREQUENCY_LIMIT
        or 0 < corpus_rank <= FREQUENCY_LIMIT
        or row["oxford"] == "1"
    )


def main(source: Path) -> None:
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    if digest != SOURCE_SHA256:
        raise SystemExit(f"ECDICT CSV SHA256 mismatch: {digest}")

    words: dict[str, str] = {}
    exchanges: dict[str, str] = {}
    with source.open(encoding="utf-8-sig", newline="") as csv_file:
        for row in csv.DictReader(csv_file):
            word = row["word"]
            if not WORD_PATTERN.fullmatch(word) or not selected_row(row):
                continue
            translation = translation_summary(row["translation"])
            if not translation:
                continue
            words[word] = translation
            exchanges[word] = row["exchange"]

    # Use the dictionary's explicit inflection table. Guessing stems from a
    # suffix alone can turn unrelated words into misleading translations.
    forms: dict[str, str] = {}
    for base, exchange in exchanges.items():
        for part in exchange.split("/"):
            marker, separator, form = part.partition(":")
            if separator and marker in {"s", "p", "d", "i", "3", "r", "t"}:
                if WORD_PATTERN.fullmatch(form) and form not in words and form != base:
                    forms.setdefault(form, base)

    OUTPUT.mkdir(parents=True, exist_ok=True)
    for letter in "abcdefghijklmnopqrstuvwxyz":
        shard = {
            "words": {key: words[key] for key in sorted(words) if key.startswith(letter)},
            "forms": {key: forms[key] for key in sorted(forms) if key.startswith(letter)},
        }
        (OUTPUT / f"{letter}.json").write_text(
            json.dumps(shard, ensure_ascii=False, separators=(",", ":")) + "\n",
            encoding="utf-8",
        )
    print(f"Wrote {len(words)} words and {len(forms)} inflected forms to {OUTPUT}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python build-local-english-lexicon.py ecdict.csv")
    main(Path(sys.argv[1]))
