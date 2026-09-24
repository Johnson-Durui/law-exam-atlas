#!/usr/bin/env python3
"""Extract traceable questions from the local JM (non-law) past-paper PDFs.

The script is deliberately conservative: it only admits a question after a
monotone question-number chain has started at 1.  Scanned/unreadable originals
remain in the source report, and a commentary PDF is used only when it contains
extractable question text; those questions are labelled ``解析替代``.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = ROOT / "09.法硕非法学历年真题"
DATA_DIR = Path(__file__).resolve().parent / "data"
CACHE_DIR = ROOT / "analysis_tmp" / "corpus_cache"

YEAR_RE = re.compile(r"(200[5-9]|201\d|202[0-6])\s*年")
QUESTION_RE = re.compile(
    r"(?m)^[ \t]*(?P<num>\d{1,2}|[12][lI])\s*[\.．、]\s*(?P<body>.*)$"
)
SECTION_RE = re.compile(
    r"(?m)^[^\n]{0,18}?(单项选择题|多项选择题|简答题|辨析题|法条分析题|案例分析题|材料分析题|分析题|论述题)[^\n]*$"
)
SUBJECT_RE = re.compile(r"(?m)^[ \t]*(刑法学|民法学|法理学|宪法学|中国法制史)[ \t]*$")
ANSWER_BREAK_RE = re.compile(
    r"(?m)^\s*(?:参考答案|答案(?:与解析)?|试题答案|参考答案及解析|【?答案】?|"
    r"法律硕士(?:专业)?(?:基础|综合)[^\n]*答案[^\n]*)\s*[:：]?\s*$"
)
EXAM_ANSWER_START_RE = re.compile(r"(?m)^\s*20(?:0\d|1\d|2[0-6])\s*年全国硕士研究生招生考试\s*$")
MARKETING_NOISE_RE = re.compile(
    r"(?m)^\s*(?:添加秋北[:：].*|公众号/小红书[:：].*|\d+\s*/\s*\d+|"
    r"专业(?:基础|综合)课|20\d{2}\s*年法硕[^\n]*第\s*\d+\s*页[^\n]*)\s*$"
)
PAGE_NOISE_RE = re.compile(
    r"(?m)^\s*(?:专业(?:基础|综合)课\s*[·•]?\s*第\s*\d+\s*页[^\n]*|"
    r"\d{4}\s*年全国法律硕士[^\n]*(?:真题试卷|联考真题)[^\n]*|"
    r"第\s*\d+\s*页\s*\(?共\s*\d+\s*页\)?)[ \t]*$"
)


@dataclass
class SourceSpec:
    path: Path
    paper: str
    kind: str = "原卷"
    fixed_year: int | None = None


def rel(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def infer_paper(path: Path) -> str:
    text = str(path)
    return "基础课" if "基础" in text else "综合课"


def original_sources() -> list[SourceSpec]:
    specs: list[SourceSpec] = []
    for path in SOURCE_ROOT.rglob("*.pdf"):
        path_text = str(path)
        name = path.name
        if "解析" in path_text or "答案解析" in path_text:
            continue
        is_bundle = name.startswith("2005-2009年全国法律硕士")
        is_year_paper = "真题" in name or ("招生考试" in name and "非法学" in name)
        if not (is_bundle or is_year_paper):
            continue
        m = YEAR_RE.search(name)
        fixed_year = None if is_bundle else (int(m.group(1)) if m else None)
        specs.append(SourceSpec(path=path, paper=infer_paper(path), fixed_year=fixed_year))
    return sorted(specs, key=lambda s: (s.fixed_year or 2004, s.paper, rel(s.path)))


def fallback_for(year: int, paper: str) -> Path | None:
    candidates = []
    for path in SOURCE_ROOT.rglob("*.pdf"):
        text = str(path)
        if str(year) not in path.name or "解析" not in text:
            continue
        if infer_paper(path) == paper:
            candidates.append(path)
    return sorted(candidates, key=lambda p: (len(str(p)), str(p)))[0] if candidates else None


def extract_pages(path: Path) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    reader = PdfReader(str(path))
    pages: list[str] = []
    year_match = YEAR_RE.search(path.name)
    year = int(year_match.group(1)) if year_match else None
    two_column_original = (
        year is not None and 2010 <= year <= 2021
        and "真题" in path.name and "解析" not in str(path)
    )
    layouts: list[str] | None = None
    gutter = 105
    if two_column_original:
        layouts = []
        for page in reader.pages:
            try:
                layouts.append(page.extract_text(extraction_mode="layout") or "")
            except Exception:
                layouts.append(page.extract_text() or "")

        def rebuild(split_at: int) -> list[str]:
            rebuilt = []
            for layout in layouts or []:
                lines = layout.splitlines()
                left = "\n".join(line[:split_at] for line in lines)
                right = "\n".join(line[split_at:] for line in lines)
                rebuilt.append(normalize_text(left + "\n" + right))
            return rebuilt

        def chain_score(rebuilt: list[str]) -> tuple[int, int]:
            text = "\n".join(rebuilt)
            nums = [int(m.group("num").replace("l", "1").replace("I", "1")) for m in QUESTION_RE.finditer(text)]
            last = 0
            count = 0
            for number in nums:
                if last == 0 and number == 1:
                    last, count = 1, 1
                elif last and last < number <= last + 2:
                    last, count = number, count + 1
            return last, count

        choices = [(chain_score(rebuild(pos)), pos) for pos in range(70, 181, 5)]
        gutter = max(choices)[1]
        errors.append(f"双栏逻辑顺序重建，gutter={gutter}")

    for index, page in enumerate(reader.pages, 1):
        try:
            # The ordinary extractor preserves logical reading order better for
            # this collection; layout mode splits many two-column question
            # numbers away from their stems.
            if two_column_original:
                layout = (layouts or [""])[index - 1]
                lines = layout.splitlines()
                # These papers are imposed as two columns.  pypdf's ordinary
                # reading order interleaves them (8,1,9,2...).  The layout text
                # has a stable gutter around character 105, so rebuild the
                # logical order as left column then right column for each page.
                left = "\n".join(line[:gutter] for line in lines)
                right = "\n".join(line[gutter:] for line in lines)
                text = left + "\n" + right
            else:
                text = page.extract_text() or ""
        except Exception as exc:
            errors.append(f"第{index}页普通提取失败: {type(exc).__name__}")
            try:
                text = page.extract_text(extraction_mode="layout") or ""
            except Exception as fallback_exc:
                errors.append(f"第{index}页layout失败: {type(fallback_exc).__name__}")
                text = ""
        pages.append(normalize_text(text))
    return pages, errors


def normalize_text(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    text = text.replace("\u00a0", " ").replace("\r", "")
    # Several 2010-2021 PDFs contain a broken duplicate font layer.  Retain
    # Chinese, ASCII, common CJK punctuation and enclosed numerals while
    # dropping control and private/extended glyph noise from that layer.
    text = "".join(
        ch for ch in text
        if ch in "\n\t"
        or 0x20 <= ord(ch) <= 0x7E
        or 0x2460 <= ord(ch) <= 0x24FF
        or 0x3000 <= ord(ch) <= 0x303F
        or 0x3400 <= ord(ch) <= 0x9FFF
        or 0xFF00 <= ord(ch) <= 0xFFEF
    )
    text = re.sub(r"(?m)^\s*([12])[lI]\s*([.、])", lambda m: f"{m.group(1)}1{m.group(2)}", text)
    text = PAGE_NOISE_RE.sub("", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def stream_pages(pages: list[str], start_page: int = 1, end_page: int | None = None) -> tuple[str, list[tuple[int, int]]]:
    end_page = end_page or len(pages)
    chunks: list[str] = []
    offsets: list[tuple[int, int]] = []
    cursor = 0
    for page_no in range(start_page, end_page + 1):
        chunk = pages[page_no - 1]
        offsets.append((cursor, page_no))
        chunks.append(chunk)
        cursor += len(chunk) + 2
    return "\n\n".join(chunks), offsets


def page_for(offset: int, offsets: list[tuple[int, int]]) -> int:
    page = offsets[0][1]
    for start, current in offsets:
        if start > offset:
            break
        page = current
    return page


def bundle_segments(pages: list[str], paper: str) -> list[tuple[int, int, int]]:
    starts: list[tuple[int, int]] = []
    for page_no, text in enumerate(pages, 1):
        for year in range(2005, 2010):
            if re.search(fr"{year}\s*年法律硕士.*专业{paper[:2]}.*真题", text[:500], re.S):
                starts.append((page_no, year))
                break
    starts = sorted(set(starts))
    segments: list[tuple[int, int, int]] = []
    for idx, (start_page, year) in enumerate(starts):
        end_page = starts[idx + 1][0] - 1 if idx + 1 < len(starts) else len(pages)
        segments.append((year, start_page, end_page))
    return segments


def nearest_label(text: str, offset: int, pattern: re.Pattern[str]) -> str | None:
    value = None
    for match in pattern.finditer(text, 0, offset):
        value = match.group(1)
    return value


def map_type(section: str | None) -> str:
    if not section:
        return "待核对"
    if "单项" in section:
        return "单选"
    if "多项" in section:
        return "多选"
    if "简答" in section:
        return "简答"
    if "法条" in section:
        return "法条分析"
    if "案例" in section:
        return "案例分析"
    if "论述" in section:
        return "论述"
    if "辨析" in section or "分析" in section:
        return "分析"
    return "待核对"


def number_question_type(year: int, paper: str, number: int) -> str | None:
    """Return the verified modern-paper type layout, when it is stable."""
    if year < 2022:
        return None
    if 1 <= number <= 40:
        return "单选"
    if 41 <= number <= 50:
        return "多选"
    if paper == "基础课":
        if 51 <= number <= 54:
            return "简答"
        if 55 <= number <= 56:
            return "法条分析"
        if 57 <= number <= 58:
            return "案例分析"
    else:
        if 51 <= number <= 53:
            return "简答"
        if 54 <= number <= 56:
            return "分析"
        if 57 <= number <= 58:
            return "论述"
    return None


def number_subject(year: int, paper: str, number: int) -> str:
    """Fallback only; document subject headings take precedence."""
    if paper == "基础课":
        if year >= 2010:
            if number <= 20 or 41 <= number <= 45 or number in {51, 52, 55, 57}:
                return "刑法"
            return "民法"
        return "刑法" if number <= 30 else "民法"
    if year >= 2022:
        if 1 <= number <= 14 or 41 <= number <= 44 or number in {51, 54, 57}:
            return "法理学"
        if 15 <= number <= 28 or 45 <= number <= 47 or number in {52, 55, 58}:
            return "宪法学"
        if 29 <= number <= 40 or 48 <= number <= 50 or number in {53, 56}:
            return "中国法制史"
    # Older comprehensive structures vary; unknown is safer than silently
    # assigning a wrong subject.
    return "待核对"


def clean_question(text: str) -> str:
    breaks = [m.start() for pattern in (ANSWER_BREAK_RE, EXAM_ANSWER_START_RE) if (m := pattern.search(text))]
    if breaks:
        text = text[: min(breaks)]
    text = PAGE_NOISE_RE.sub("", text)
    text = MARKETING_NOISE_RE.sub("", text)
    text = SECTION_RE.sub("", text)
    text = SUBJECT_RE.sub("", text)
    text = re.sub(r"\n[ \t]+", "\n", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def suspicious(text: str) -> list[str]:
    issues = []
    if len(text) < 15:
        issues.append("题干过短")
    if "�" in text:
        issues.append("含替换字符")
    if len(re.findall(r"[A-D][.、．]", text)) == 1:
        issues.append("选项可能不完整")
    if len(text) > 8000:
        issues.append("题干异常过长")
    return issues


def parse_questions(
    *, text: str, offsets: list[tuple[int, int]], year: int, paper: str,
    source_file: Path, extraction_status: str
) -> tuple[list[dict], dict]:
    candidates = []
    for match in QUESTION_RE.finditer(text):
        raw = match.group("num")
        number = int(raw.replace("l", "1").replace("I", "1"))
        if 1 <= number <= 80:
            candidates.append((match.start(), match.end(), number, match.group(0)))

    selected = []
    last = 0
    for candidate in candidates:
        number = candidate[2]
        if last == 0:
            if number != 1:
                continue
            selected.append(candidate)
            last = 1
            continue
        if number == last + 1:
            selected.append(candidate)
            last = number
        elif last >= 1 and last < number <= last + 2:
            # Admit a single OCR-missing question but flag the continuity gap.
            selected.append(candidate)
            last = number

    questions: list[dict] = []
    seen_numbers: set[int] = set()
    continuity_gaps: list[int] = []
    previous = 0
    for index, candidate in enumerate(selected):
        start, _, number, _ = candidate
        end = selected[index + 1][0] if index + 1 < len(selected) else len(text)
        body = clean_question(text[start:end])
        if not body:
            continue
        fallback_lead = re.sub(r"\s+", "", body[:300])
        if extraction_status == "解析替代" and re.search(r"答案|详解|解析", fallback_lead):
            # An answer-only entry does not reproduce the original question.
            # Keeping it would violate the corpus' traceability promise.
            continue
        if previous and number != previous + 1:
            continuity_gaps.extend(range(previous + 1, number))
        previous = number
        if number in seen_numbers:
            continue
        seen_numbers.add(number)
        section = nearest_label(text, start, SECTION_RE)
        subject_heading = nearest_label(text, start, SUBJECT_RE)
        subject = subject_heading.replace("学", "") if subject_heading else number_subject(year, paper, number)
        method = "标题识别" if subject_heading else ("题号推定" if subject != "待核对" else "待核对")
        flags = suspicious(body)
        status = extraction_status
        if flags and status == "自动提取":
            status = "提取待核对"
        questions.append({
            "id": f"q-{year}-{('base' if paper == '基础课' else 'comprehensive')}-{number}",
            "year": year,
            "paper": paper,
            "number": number,
            "subject": subject,
            "subjectMethod": method,
            "questionType": number_question_type(year, paper, number) or map_type(section),
            "text": body,
            "sourceFile": rel(source_file),
            "sourcePage": page_for(start, offsets),
            "extractionStatus": status,
        })

    # A few missing OCR numbers can leave otherwise usable individual items,
    # but several gaps in one paper make the reconstructed order unreliable.
    # Keep those items available while preventing the UI from presenting the
    # whole paper as automatically verified.
    if extraction_status == "自动提取" and len(continuity_gaps) >= 3:
        for question in questions:
            question["extractionStatus"] = "提取待核对"

    diagnostics = {
        "candidateCount": len(candidates),
        "selectedCount": len(questions),
        "firstNumber": questions[0]["number"] if questions else None,
        "lastNumber": questions[-1]["number"] if questions else None,
        "missingNumbers": continuity_gaps,
        "shortQuestions": [q["number"] for q in questions if len(q["text"]) < 15],
    }
    return questions, diagnostics


def source_record(spec: SourceSpec, pages: list[str], errors: list[str]) -> dict:
    total_chars = sum(len(page) for page in pages)
    readable_pages = sum(len(page) >= 100 for page in pages)
    return {
        "file": rel(spec.path),
        "year": spec.fixed_year,
        "paper": spec.paper,
        "kind": spec.kind,
        "pages": len(pages),
        "extractedCount": 0,
        "status": "可提取" if readable_pages else "原卷无可用文本层",
        "notes": f"文本字符{total_chars}；可读页{readable_pages}/{len(pages)}"
        + (f"；{'；'.join(errors)}" if errors else ""),
    }


def write_cache(path: Path, pages: Iterable[str]) -> None:
    digest = hashlib.sha1(rel(path).encode("utf-8")).hexdigest()[:10]
    target = CACHE_DIR / f"{path.stem}_{digest}.txt"
    content = []
    for number, page in enumerate(pages, 1):
        content.append(f"\n===== PDF PAGE {number} =====\n{page}")
    target.write_text("\n".join(content), encoding="utf-8")


def main() -> int:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    all_questions: list[dict] = []
    sources: list[dict] = []
    diagnostics: list[dict] = []

    for spec in original_sources():
        pages, errors = extract_pages(spec.path)
        write_cache(spec.path, pages)
        record = source_record(spec, pages, errors)
        source_questions: list[dict] = []
        is_bundle = spec.fixed_year is None

        if is_bundle:
            segments = bundle_segments(pages, spec.paper)
            if not segments:
                record["status"] = "合订本未识别年份边界"
            for year, start_page, end_page in segments:
                text, offsets = stream_pages(pages, start_page, end_page)
                questions, diag = parse_questions(
                    text=text, offsets=offsets, year=year, paper=spec.paper,
                    source_file=spec.path, extraction_status="自动提取"
                )
                source_questions.extend(questions)
                diagnostics.append({"year": year, "paper": spec.paper, "sourceFile": rel(spec.path), **diag})
        else:
            text, offsets = stream_pages(pages)
            readable = sum(len(page) for page in pages) >= 500
            extraction_path = spec.path
            extraction_kind = "自动提取"
            fallback_record = None
            if not readable:
                fallback = fallback_for(spec.fixed_year, spec.paper)
                if fallback:
                    fallback_pages, fallback_errors = extract_pages(fallback)
                    write_cache(fallback, fallback_pages)
                    fallback_record = source_record(
                        SourceSpec(fallback, spec.paper, "解析替代", spec.fixed_year),
                        fallback_pages, fallback_errors
                    )
                    fallback_record["status"] = "解析卷复现题目，作为不可读原卷的替代来源"
                    sources.append(fallback_record)
                    text, offsets = stream_pages(fallback_pages)
                    extraction_path = fallback
                    extraction_kind = "解析替代"
                    record["notes"] += f"；题目改由{rel(fallback)}提取"
                else:
                    record["status"] = "原卷不可读且无可用替代"
            original_status = (
                "提取待核对"
                if 2010 <= spec.fixed_year <= 2021 and "真题" in spec.path.name
                else extraction_kind
            )
            questions, diag = parse_questions(
                text=text, offsets=offsets, year=spec.fixed_year, paper=spec.paper,
                source_file=extraction_path, extraction_status=original_status
            )
            if fallback_record is not None:
                fallback_record["extractedCount"] = len(questions)
                if not questions:
                    fallback_record["status"] = "解析卷未完整复现题面，不纳入题库"
            source_questions.extend(questions)
            diagnostics.append({"year": spec.fixed_year, "paper": spec.paper, "sourceFile": rel(extraction_path), **diag})

        record["extractedCount"] = len(source_questions)
        if not source_questions and record["status"] == "可提取":
            record["status"] = "有文本但未形成可靠题号链"
        sources.append(record)
        all_questions.extend(source_questions)

    # Exact-text deduplication protects against source aliases without merging
    # genuinely repeated exam questions that differ by year or wording.
    unique_questions: list[dict] = []
    fingerprints: dict[str, str] = {}
    duplicates: list[dict] = []
    ids: set[str] = set()
    for question in sorted(all_questions, key=lambda q: (q["year"], q["paper"], q["number"])):
        normalized = re.sub(r"\s+", "", question["text"])
        fingerprint = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
        if question["id"] in ids:
            duplicates.append({"id": question["id"], "reason": "重复ID", "sourceFile": question["sourceFile"]})
            continue
        if fingerprint in fingerprints:
            duplicates.append({"id": question["id"], "reason": "题干完全重复", "sameAs": fingerprints[fingerprint]})
            continue
        fingerprints[fingerprint] = question["id"]
        ids.add(question["id"])
        unique_questions.append(question)

    status_counts = Counter(q["extractionStatus"] for q in unique_questions)
    year_counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for question in unique_questions:
        year_counts[str(question["year"])][question["paper"]] += 1

    generated_at = datetime.now(timezone.utc).isoformat()
    corpus = {
        "questions": unique_questions,
        "sources": sorted(sources, key=lambda s: (s.get("year") or 0, s["paper"], s["kind"], s["file"])),
        "meta": {
            "title": "法律硕士（非法学）历年真题可追溯语料库",
            "generatedAt": generated_at,
            "yearRange": [min((q["year"] for q in unique_questions), default=None), max((q["year"] for q in unique_questions), default=None)],
            "questionCount": len(unique_questions),
            "sourceCount": len(sources),
            "statusCounts": dict(status_counts),
            "method": "本地PDF文本层抽取；题号连续性校验；不可读原卷仅使用明确复现题目的解析替代",
        },
    }
    report = {
        "generatedAt": generated_at,
        "totals": {
            "questions": len(unique_questions),
            "sources": len(sources),
            "duplicatesRemoved": len(duplicates),
            "byStatus": dict(status_counts),
        },
        "byYearPaper": {year: dict(sorted(papers.items())) for year, papers in sorted(year_counts.items())},
        "diagnostics": diagnostics,
        "duplicates": duplicates,
        "limitations": [
            "PDF文本层可能含OCR错字；标为“提取待核对”的题目应回看sourceFile与sourcePage。",
            "2024原卷无可用文本层，同年解析卷未完整复现题面，因此未纳入2024题目。",
            "2020两卷、2021综合课未形成可靠题号链，来源仍保留在sources中说明缺口。",
            "2022、2023、2025、2026综合课按已核对的题号结构推定学科；旧卷标题缺失时保守标为“待核对”。",
            "语料库只保存题面，不把答案解析段落当作题目。",
        ],
    }

    json_text = json.dumps(corpus, ensure_ascii=False, indent=2)
    (DATA_DIR / "corpus.json").write_text(json_text + "\n", encoding="utf-8")
    (DATA_DIR / "corpus.js").write_text("window.LAW_CORPUS = " + json_text + ";\n", encoding="utf-8")
    (DATA_DIR / "extraction_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report["totals"], ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
