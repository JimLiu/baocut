#!/usr/bin/env python3
"""Lottie（bodymovin）语料特性普查。

ADR-M11 的前置任务（`docs/design/bcf/bcut-motion-render-upgrade-design.md` §7）：纯 Rust
子集渲染器该支持到哪儿，**由数据说了算**，不由直觉说了算。本脚本扫一个装满
`.json` / `.lottie` 的目录，统计每项特性出现在多少比例的文件里，再据此划子集
边界——出现率高的特性要么进首版，要么先上 ThorVG 逃生口；出现率低的直接
`lottie-unsupported-feature` fail-fast。

用法：

    python3 core/fixtures/lottie/census.py <语料目录> [--json out.json] [--per-file]

不联网、不写目录、只读。语料怎么收见同目录的 README.md。
"""

from __future__ import annotations

import argparse
import json
import sys
import zipfile
from collections import Counter
from pathlib import Path

# ── 被普查的特性 ───────────────────────────────────────────────────
#
# 前六项就是设计 §7 点名的那六个（`ef` / `t` / expressions / `tm` / `tt` / `mm`）：
# 它们各自决定"首版能不能不做"。后面几项是子集**规模**的度量——形状、渐变、
# precomp 的用量决定纯 Rust 那条路要写多少代码。
FEATURES = [
    ("effects", "ef 图层效果（首版不做，ADR-M11）"),
    ("text", "t 文字图层（首版不做）"),
    ("expressions", "表达式（x 字段；首版不做，且违背确定性）"),
    ("timeRemap", "tm 时间重映射"),
    ("mattes", "tt/td 轨道遮罩"),
    ("mergePaths", "mm 合并路径（首版不做）"),
    ("masks", "hasMask / masksProperties 图层遮罩"),
    ("gradients", "gf/gs 渐变填充与描边"),
    ("precomps", "预合成图层（ty 0）"),
    ("images", "位图图层（ty 2）+ 图片资源"),
    ("shapes", "形状图层（ty 4）"),
    ("solids", "纯色图层（ty 1）"),
    ("repeaters", "rp 重复器"),
    ("trimPaths", "tm 修剪路径（形状项，与图层 tm 不同）"),
    ("roundedCorners", "rd 圆角"),
    ("autoOrient", "ao 自动朝向"),
    ("blendModes", "bm 非 normal 混合模式"),
    ("markers", "markers 标记（segment 名）"),
    ("threeD", "3d 图层（ddd = 1）"),
]

# 形状项 ty → 记哪个特性
SHAPE_ITEM_FEATURE = {
    "gf": "gradients",
    "gs": "gradients",
    "mm": "mergePaths",
    "rp": "repeaters",
    "tm": "trimPaths",
    "rd": "roundedCorners",
}


def load(path: Path) -> dict | None:
    """读一个 `.json` 或 `.lottie`（后者是装着 `animations/*.json` 的 zip）。"""
    try:
        if path.suffix.lower() == ".lottie":
            with zipfile.ZipFile(path) as zf:
                names = [n for n in zf.namelist() if n.endswith(".json") and "manifest" not in n]
                if not names:
                    return None
                with zf.open(sorted(names)[0]) as fh:
                    return json.load(fh)
        with path.open(encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        print(f"跳过 {path.name}：{error}", file=sys.stderr)
        return None


def walk(node, hit) -> None:
    """递归整棵文档树。刻意按**键名**判定而不是按 schema 走位——bodymovin 各版本
    的层级不一致，漏一层就把统计做低了，而做低正是这份普查最不能犯的错。"""
    if isinstance(node, list):
        for item in node:
            walk(item, hit)
        return
    if not isinstance(node, dict):
        return

    if node.get("ef"):
        hit("effects")
    if "x" in node and isinstance(node.get("x"), str):
        hit("expressions")  # 属性上的表达式字符串
    if node.get("hasMask") or node.get("masksProperties"):
        hit("masks")
    if node.get("tt") is not None or node.get("td") is not None:
        hit("mattes")
    if node.get("ddd") == 1:
        hit("threeD")
    if isinstance(node.get("bm"), int) and node["bm"] != 0:
        hit("blendModes")
    if node.get("ao") == 1:
        hit("autoOrient")

    ty = node.get("ty")
    if "ks" in node or "ip" in node:  # 像个图层
        if ty == 0:
            hit("precomps")
        elif ty == 1:
            hit("solids")
        elif ty == 2:
            hit("images")
        elif ty == 4:
            hit("shapes")
        elif ty == 5:
            hit("text")
        if "tm" in node:
            hit("timeRemap")
    if isinstance(ty, str) and ty in SHAPE_ITEM_FEATURE:
        hit(SHAPE_ITEM_FEATURE[ty])
    if node.get("t") and isinstance(node.get("t"), dict) and "d" in node["t"]:
        hit("text")  # 文字图层的 t.d 文档

    for value in node.values():
        walk(value, hit)


def census_one(doc: dict) -> set[str]:
    found: set[str] = set()
    walk(doc, found.add)
    if doc.get("markers"):
        found.add("markers")
    if any(asset.get("p") and asset.get("u") is not None for asset in doc.get("assets", []) if isinstance(asset, dict)):
        found.add("images")
    return found


def refine_one(doc: dict) -> dict:
    """细化信号：重议 ADR-M11 时毛占比不够用——mm=1 只是拼接、ef ty=5 是
    表达式控制器组（无表达式时是死数据），二者都不该按"不支持"计。"""
    st = {"mm_modes": Counter(), "ef_types": Counter(), "expr": False, "text": False}

    def walk_refined(node) -> None:
        if isinstance(node, list):
            for item in node:
                walk_refined(item)
            return
        if not isinstance(node, dict):
            return
        if isinstance(node.get("x"), str) and node["x"].strip():
            st["expr"] = True
        if ("ks" in node or "ip" in node):
            if node.get("ty") == 5:
                st["text"] = True
            if isinstance(node.get("ef"), list):
                for e in node["ef"]:
                    if isinstance(e, dict) and e.get("ty") is not None:
                        st["ef_types"][e["ty"]] += 1
        if node.get("ty") == "mm":
            st["mm_modes"][node.get("mm")] += 1
        for value in node.values():
            walk_refined(value)

    walk_refined(doc)
    return st


def blocked_refined(st: dict) -> set[str]:
    """细化边界下这个文件仍被拦的原因（空集 = strict 子集可完整渲染）。"""
    why: set[str] = set()
    if st["text"]:
        why.add("text")
    if st["expr"]:
        why.add("expressions")
    if any(mode != 1 for mode in st["mm_modes"]):
        why.add("mergePaths(bool)")
    if any(ty != 5 for ty in st["ef_types"]):
        why.add("effects(raster)")
    return why


def main() -> int:
    parser = argparse.ArgumentParser(description="Lottie 语料特性普查（ADR-M11 前置任务）")
    parser.add_argument("corpus", type=Path, help="装着 .json / .lottie 的目录")
    parser.add_argument("--json", type=Path, help="把结果同时写成 JSON")
    parser.add_argument("--per-file", action="store_true", help="逐文件列出命中的特性")
    args = parser.parse_args()

    if not args.corpus.is_dir():
        print(f"不是目录：{args.corpus}", file=sys.stderr)
        return 2

    files = sorted(
        p for p in args.corpus.rglob("*") if p.suffix.lower() in {".json", ".lottie"}
    )
    if not files:
        print(f"{args.corpus} 里没有 .json / .lottie", file=sys.stderr)
        return 1

    counts: Counter[str] = Counter()
    per_file: dict[str, list[str]] = {}
    parsed = 0
    mm_modes: Counter = Counter()
    ef_types: Counter = Counter()
    refined_combos: Counter[str] = Counter()
    raw_blocked = 0
    refined_blocked = 0
    for path in files:
        doc = load(path)
        if doc is None:
            continue
        if not isinstance(doc, dict):
            print(f"跳过（顶层不是对象，不像 Lottie 文档）：{path}", file=sys.stderr)
            continue
        parsed += 1
        found = census_one(doc)
        counts.update(found)
        per_file[str(path.relative_to(args.corpus))] = sorted(found)
        st = refine_one(doc)
        mm_modes.update(st["mm_modes"])
        ef_types.update(st["ef_types"])
        raw_why = found & {"effects", "text", "expressions", "mergePaths"}
        if raw_why:
            raw_blocked += 1
        why = blocked_refined(st)
        if why:
            refined_blocked += 1
            refined_combos["+".join(sorted(why))] += 1

    if parsed == 0:
        print("一个文件都没解析成功", file=sys.stderr)
        return 1

    print(f"语料 {parsed} 个文件（{args.corpus}）\n")
    width = max(len(name) for name, _ in FEATURES)
    print(f"{'特性'.ljust(width)}  {'命中':>5}  {'占比':>7}   说明")
    print("─" * (width + 60))
    for name, note in FEATURES:
        n = counts[name]
        pct = 100.0 * n / parsed
        print(f"{name.ljust(width)}  {n:>5}  {pct:>6.1f}%   {note}")

    # 子集边界的判据：首版不做的四项一旦占比高，ADR-M11 的先后顺序就该重议
    blockers = [n for n in ("effects", "text", "expressions", "mergePaths") if counts[n] / parsed >= 0.2]
    print()
    if blockers:
        print(f"⚠ 首版不支持的特性占比 ≥20%：{', '.join(blockers)}")
        print("  → 按设计 §14 的「仍开放」条目重议 ADR-M11 的先后顺序（可先 ThorVG）。")
    else:
        print("✓ 首版不支持的四项特性占比都 <20%，纯 Rust 子集先行的排序成立。")

    # 细化统计：毛占比触发判据时，重议要靠这组数字
    ef_names = {5: "控制器组(无表达式时是死数据)", 20: "tint", 21: "fill", 22: "stroke",
                23: "tritone", 24: "pro-levels", 25: "drop-shadow", 26: "radial-wipe",
                27: "displacement", 28: "matte3", 29: "gaussian-blur"}
    print("\n细化统计：")
    print(f"  毛边界（四项全拦）strict 完整可渲染：{parsed - raw_blocked}/{parsed}"
          f" = {100.0 * (parsed - raw_blocked) / parsed:.0f}%")
    print(f"  细化边界（mm=1 拼接可支持、ef ty=5 无表达式时可忽略）："
          f"{parsed - refined_blocked}/{parsed}"
          f" = {100.0 * (parsed - refined_blocked) / parsed:.0f}%")
    if mm_modes:
        print("  mergePaths mm 模式（1=拼接，2–5 需布尔运算）："
              + ", ".join(f"mm={mode}×{n}" for mode, n in mm_modes.most_common()))
    if ef_types:
        print("  图层效果 ef.ty："
              + ", ".join(f"ty={ty}({ef_names.get(ty, '?')})×{n}" for ty, n in ef_types.most_common()))
    if refined_combos:
        print("  细化边界下剩余拦截组合："
              + ", ".join(f"{k}×{n}" for k, n in refined_combos.most_common()))

    if args.json:
        payload = {
            "corpus": str(args.corpus),
            "files": parsed,
            "counts": {name: counts[name] for name, _ in FEATURES},
            "ratios": {name: round(counts[name] / parsed, 4) for name, _ in FEATURES},
            "blockers": blockers,
            "refined": {
                "rawStrictCoverage": round((parsed - raw_blocked) / parsed, 4),
                "refinedStrictCoverage": round((parsed - refined_blocked) / parsed, 4),
                "mmModes": {str(mode): n for mode, n in mm_modes.items()},
                "efTypes": {str(ty): n for ty, n in ef_types.items()},
                "blockedCombos": dict(refined_combos),
            },
        }
        if args.per_file:
            payload["perFile"] = per_file
        args.json.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        print(f"\nJSON → {args.json}")

    if args.per_file:
        print()
        for name, found in sorted(per_file.items()):
            print(f"  {name}: {', '.join(found) or '（无命中）'}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
