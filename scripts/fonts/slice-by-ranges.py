#!/usr/bin/env python3
"""Slice one font into woff2 pieces that match an existing @font-face unicode-range set.

This is how 朱雀仿宋 joins Reed: the Noto Serif SC 700 faces in
public/fonts/fonts-local.css already partition the CJK space into small
unicode-range slices. We reuse those exact ranges, subset the source font to
each range, skip ranges with no matching glyph, and emit a matching CSS
fragment. Font files are data only; nothing from the source is executed.

Usage (python must run isolated so no user site-packages leak in):

  python -I scripts/fonts/slice-by-ranges.py ^
    --input "%TEMP%\\reed-fonts\\ZhuqueFangsong-Regular.ttf" ^
    --ranges public/fonts/fonts-local.css ^
    --range-family "Noto Serif SC" ^
    --range-weight 700 ^
    --family "Zhuque Fangsong" ^
    --weight 400 ^
    --style normal ^
    --prefix zhuque-fangsong ^
    --output-dir public/fonts/files ^
    --output-css public/fonts/zhuque-fangsong.css

Output CSS uses url(files/<name>.woff2), so it belongs in public/fonts/ next to
fonts-templates.css. The script only writes files it generates; re-running is
safe and byte-stable for the same source and fontTools version.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

FONTTOOLS_SITE = Path(r"C:\Users\15877\AppData\Roaming\Python\Python314\site-packages")
if FONTTOOLS_SITE.is_dir():
    sys.path.insert(0, str(FONTTOOLS_SITE))

from fontTools import subset  # noqa: E402
from fontTools.ttLib import TTFont  # noqa: E402

FACE_RE = re.compile(r"@font-face\s*\{([^}]+)\}", re.S)


def parse_ranges(css_path: Path, family: str, weight: str) -> list[tuple[str, str]]:
    """Return (range string, source filename hint) in stylesheet order."""
    rules: list[tuple[str, str]] = []
    for body in FACE_RE.findall(css_path.read_text(encoding="utf-8")):
        found_family = re.search(r"font-family:\s*['\"]?([^;'\"\n]+)", body)
        found_weight = re.search(r"font-weight:\s*([^;]+)", body)
        found_range = re.search(r"unicode-range:\s*([^;]+)", body)
        if not found_family or not found_weight or not found_range:
            continue
        if found_family.group(1).strip() != family or found_weight.group(1).strip() != weight:
            continue
        rules.append((found_range.group(1).strip(), body))
    if not rules:
        raise SystemExit(f"no @font-face for {family} {weight} in {css_path}")
    return rules


def parse_codepoints(value: str) -> set[int]:
    points: set[int] = set()
    for part in value.split(","):
        token = part.strip().replace("U+", "").replace("u+", "")
        if not token:
            continue
        if "?" in token:
            lo = int(token.replace("?", "0"), 16)
            hi = int(token.replace("?", "f"), 16)
        elif "-" in token:
            lo_s, hi_s = token.split("-", 1)
            lo, hi = int(lo_s, 16), int(hi_s, 16)
        else:
            lo = hi = int(token, 16)
        points.update(range(lo, hi + 1))
    return points


def slice_font(source: Path, points: set[int], out: Path, style: str) -> None:
    font = TTFont(str(source), lazy=True)
    options = subset.Options()
    options.flavor = "woff2"
    options.desubroutinize = True
    options.drop_tables += ["STAT", "DSIG"]
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    options.name_legacy = True
    options.name_languages = ["*"]
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=points)
    subsetter.subset(font)
    out.parent.mkdir(parents=True, exist_ok=True)
    font.save(str(out))
    font.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--ranges", required=True, type=Path)
    parser.add_argument("--range-family", required=True)
    parser.add_argument("--range-weight", required=True)
    parser.add_argument("--family", required=True)
    parser.add_argument("--weight", required=True)
    parser.add_argument("--style", default="normal", choices=("normal", "italic"))
    parser.add_argument("--prefix", required=True)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--output-css", required=True, type=Path)
    args = parser.parse_args()

    cmap = TTFont(str(args.input), lazy=True).getBestCmap()
    source_points = set(cmap)
    ranges = parse_ranges(args.ranges, args.range_family, args.range_weight)
    emitted: list[tuple[str, str]] = []
    skipped = 0
    for index, (range_text, _body) in enumerate(ranges, start=1):
        points = parse_codepoints(range_text) & source_points
        if not points:
            skipped += 1
            continue
        name = f"{args.prefix}-{index}-{args.weight}-{args.style}.woff2"
        slice_font(args.input, points, args.output_dir / name, args.style)
        emitted.append((range_text, name))

    family = args.family.replace("'", "\\'")
    blocks = [
        "/* Generated by scripts/fonts/slice-by-ranges.py; ranges from "
        f"{args.ranges.as_posix()} ({args.range_family} {args.range_weight}). */\n"
    ]
    for range_text, name in emitted:
        blocks.append(
            "@font-face {\n"
            f"  font-family: '{family}';\n"
            f"  font-style: {args.style};\n"
            "  font-display: swap;\n"
            f"  font-weight: {args.weight};\n"
            f"  src: url(files/{name}) format('woff2');\n"
            f"  unicode-range: {range_text};\n"
            "}\n"
        )
    args.output_css.write_text("\n".join(blocks), encoding="utf-8")
    print(f"wrote {len(emitted)} slices, skipped {skipped} empty ranges; {args.output_css}")


if __name__ == "__main__":
    main()