"""Validate structural integrity of graph/topic/learning datasets, JS wrappers, and offline packaging."""

from __future__ import annotations

import argparse
import json
import re
import sys
import tempfile
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import package_graph

CANONICAL_SUBJECTS = ("刑法", "民法", "法理学", "宪法学", "法制史")
EXPECTED_QUESTION_COUNT = 1579
EXPECTED_TOPIC_COUNT = 80
EXPECTED_FORECAST_COUNT = 20
EXPECTED_PATHWAY_COUNT = 5


class DataValidationError(ValueError):
    """Raised when any corpus, graph, learning, or packaging invariant fails."""


def normalize_subject(subject: str) -> str:
    return "法制史" if subject == "中国法制史" else subject


def parse_js_global(js_path: Path, expected_prefix: str) -> dict:
    raw = js_path.read_text(encoding="utf-8").strip()
    pattern = rf"^window\.{re.escape(expected_prefix)}\s*=\s*(.+);$"
    match = re.match(pattern, raw, flags=re.DOTALL)
    if not match:
        raise DataValidationError(f"{js_path.name} missing expected assignment window.{expected_prefix} = ...;")
    try:
        return json.loads(match.group(1))
    except json.JSONDecodeError as exc:
        raise DataValidationError(f"{js_path.name} payload is not valid JSON: {exc}") from exc


def validate_graph_and_topics(graph: dict, topics: list[dict]) -> dict:
    if not isinstance(graph, dict) or not isinstance(graph.get("nodes"), list) or not isinstance(graph.get("edges"), list):
        raise DataValidationError("graph.json must contain nodes and edges lists")
    if not isinstance(topics, list):
        raise DataValidationError("topics.json must be a JSON array")

    if len(topics) != EXPECTED_TOPIC_COUNT:
        raise DataValidationError(f"Expected {EXPECTED_TOPIC_COUNT} topics, got {len(topics)}")

    topic_by_id: dict[str, dict] = {}
    topic_subject_counts: Counter[str] = Counter()
    for item in topics:
        tid = item.get("id")
        if not tid or tid in topic_by_id:
            raise DataValidationError(f"Duplicate or missing topic id in topics.json: {tid!r}")
        subj = normalize_subject(str(item.get("subject", "")))
        if subj not in CANONICAL_SUBJECTS:
            raise DataValidationError(f"Topic {tid} has invalid subject {subj!r}")
        if not item.get("keywords") or not isinstance(item["keywords"], list):
            raise DataValidationError(f"Topic {tid} must define a non-empty keywords list")
        topic_by_id[tid] = item
        topic_subject_counts[subj] += 1

    expected_per_subject = {subj: 16 for subj in CANONICAL_SUBJECTS}
    if dict(topic_subject_counts) != expected_per_subject:
        raise DataValidationError(f"Expected 16 topics per subject, got {dict(topic_subject_counts)}")

    for item in topics:
        for rel in item.get("related", []):
            ref_id = rel.get("id")
            if ref_id not in topic_by_id:
                raise DataValidationError(f"Topic {item['id']} references unknown related topic {ref_id!r}")

    node_by_id: dict[str, dict] = {}
    label_counts: Counter[str] = Counter()
    question_subjects: Counter[str] = Counter()
    extraction_counts: Counter[str] = Counter()

    for node in graph["nodes"]:
        uid = node.get("uuid")
        if not uid or not isinstance(uid, str) or uid in node_by_id:
            raise DataValidationError(f"Duplicate or invalid node uuid: {uid!r}")
        labels = node.get("labels")
        if not isinstance(labels, list) or not labels:
            raise DataValidationError(f"Node {uid} missing labels list")
        node_by_id[uid] = node
        kind = labels[0]
        label_counts[kind] += 1

        if kind == "Question":
            attrs = node.get("attributes") or {}
            year = attrs.get("year")
            if not isinstance(year, int) or not (2005 <= year <= 2026):
                raise DataValidationError(f"Question {uid} has out-of-range year {year!r}")
            source_file = str(attrs.get("sourceFile") or "")
            if not source_file or re.search(r"^(?:[a-z]+:|[\\/])|(?:^|[\\/])\.\.(?:[\\/]|$)", source_file, re.IGNORECASE):
                raise DataValidationError(f"Question {uid} has unsafe or missing sourceFile {source_file!r}")
            if not isinstance(attrs.get("sourcePage"), int) or attrs["sourcePage"] < 1:
                raise DataValidationError(f"Question {uid} has invalid sourcePage {attrs.get('sourcePage')!r}")
            question_subjects[str(attrs.get("subject") or "")] += 1
            extraction_counts[str(attrs.get("extractionStatus") or "")] += 1

    if label_counts["Question"] != EXPECTED_QUESTION_COUNT:
        raise DataValidationError(f"Expected {EXPECTED_QUESTION_COUNT} Question nodes, got {label_counts['Question']}")
    if label_counts["Topic"] != EXPECTED_TOPIC_COUNT:
        raise DataValidationError(f"Expected {EXPECTED_TOPIC_COUNT} Topic nodes, got {label_counts['Topic']}")

    for tid in topic_by_id:
        if f"topic-{tid}" not in node_by_id:
            raise DataValidationError(f"Topic node topic-{tid} missing from graph.json")
    for subj in CANONICAL_SUBJECTS:
        if f"subject-{subj}" not in node_by_id:
            raise DataValidationError(f"Subject node subject-{subj} missing from graph.json")
        if question_subjects[subj] <= 0:
            raise DataValidationError(f"Subject {subj} has zero extracted questions")

    edge_ids: set[str] = set()
    for edge in graph["edges"]:
        eid = edge.get("uuid")
        if not eid or eid in edge_ids:
            raise DataValidationError(f"Duplicate or missing edge uuid: {eid!r}")
        edge_ids.add(eid)
        src = edge.get("source_node_uuid")
        dst = edge.get("target_node_uuid")
        if src not in node_by_id or dst not in node_by_id:
            raise DataValidationError(f"Edge {eid} has dangling endpoint ({src!r} -> {dst!r})")

    meta = graph.get("meta") or {}
    if meta.get("questionCount") != len(graph["nodes"]) - (len(graph["nodes"]) - label_counts["Question"]):
        raise DataValidationError("meta.questionCount mismatch")
    if meta.get("questionCount") != EXPECTED_QUESTION_COUNT:
        raise DataValidationError(f"meta.questionCount != {EXPECTED_QUESTION_COUNT}")
    if meta.get("topicCount") != EXPECTED_TOPIC_COUNT:
        raise DataValidationError(f"meta.topicCount != {EXPECTED_TOPIC_COUNT}")
    if meta.get("nodeCount") != len(graph["nodes"]):
        raise DataValidationError("meta.nodeCount does not match len(nodes)")
    if meta.get("edgeCount") != len(graph["edges"]):
        raise DataValidationError("meta.edgeCount does not match len(edges)")

    return {
        "nodes": len(graph["nodes"]),
        "edges": len(graph["edges"]),
        "questions": label_counts["Question"],
        "topics": label_counts["Topic"],
        "questionSubjects": dict(question_subjects),
        "extractionStatus": dict(extraction_counts),
    }


def validate_learning(learning: dict, topics: list[dict], graph: dict) -> dict:
    if not isinstance(learning, dict):
        raise DataValidationError("learning.json must be a JSON object")
    if (learning.get("meta") or {}).get("targetYear") != 2027:
        raise DataValidationError("learning.meta.targetYear must be 2027")

    scenarios = learning.get("scenarios") or []
    predictions = learning.get("predictions") or []
    pathways = learning.get("pathways") or []

    scenario_ids = {s.get("id") for s in scenarios}
    if scenario_ids != {"rotation", "revisit", "transfer"}:
        raise DataValidationError(f"Unexpected scenarios: {scenario_ids}")

    if len(predictions) != EXPECTED_FORECAST_COUNT:
        raise DataValidationError(f"Expected {EXPECTED_FORECAST_COUNT} forecast branches, got {len(predictions)}")
    if len(pathways) != EXPECTED_PATHWAY_COUNT:
        raise DataValidationError(f"Expected {EXPECTED_PATHWAY_COUNT} subject pathways, got {len(pathways)}")

    topic_by_id = {item["id"]: item for item in topics}
    node_by_id = {item["uuid"]: item for item in graph["nodes"]}

    seen_pred_ids: set[str] = set()
    pred_subjects: Counter[str] = Counter()
    evidence_total = 0

    for pred in predictions:
        pid = pred.get("id")
        if not pid or pid in seen_pred_ids:
            raise DataValidationError(f"Duplicate or missing prediction id: {pid!r}")
        seen_pred_ids.add(pid)
        if pred.get("scenarioId") not in scenario_ids:
            raise DataValidationError(f"Prediction {pid} has invalid scenarioId {pred.get('scenarioId')!r}")
        subj = pred.get("subject")
        if subj not in CANONICAL_SUBJECTS:
            raise DataValidationError(f"Prediction {pid} has invalid subject {subj!r}")
        pred_subjects[subj] += 1

        tids = pred.get("topicIds") or []
        if not tids:
            raise DataValidationError(f"Prediction {pid} has empty topicIds")
        for tid in tids:
            if tid not in topic_by_id:
                raise DataValidationError(f"Prediction {pid} references unknown topic {tid!r}")
            if normalize_subject(topic_by_id[tid]["subject"]) != subj:
                raise DataValidationError(f"Prediction {pid} topic {tid} subject mismatch")

        evidence = pred.get("evidence") or []
        if len(evidence) > 3:
            raise DataValidationError(f"Prediction {pid} exceeds 3 evidence items")
        for ev in evidence:
            evidence_total += 1
            qid = ev.get("questionId")
            qnode = node_by_id.get(qid)
            if not qnode or qnode.get("labels") != ["Question"]:
                raise DataValidationError(f"Prediction {pid} references missing Question {qid!r}")
            qattrs = qnode["attributes"]
            if ev.get("topicId") not in tids:
                raise DataValidationError(f"Prediction {pid} evidence topicId {ev.get('topicId')!r} outside branch")
            if normalize_subject(qattrs.get("subject", "")) != subj:
                raise DataValidationError(f"Prediction {pid} evidence question {qid} subject mismatch")
            if qattrs.get("extractionStatus") != "自动提取":
                raise DataValidationError(f"Prediction {pid} evidence question {qid} must have 自动提取 status")
            if qattrs.get("year") not in {2022, 2023, 2025, 2026}:
                raise DataValidationError(f"Prediction {pid} evidence question {qid} unexpected year {qattrs.get('year')}")

    expected_preds = {subj: 4 for subj in CANONICAL_SUBJECTS}
    if dict(pred_subjects) != expected_preds:
        raise DataValidationError(f"Expected 4 predictions per subject, got {dict(pred_subjects)}")

    step_total = 0
    pathway_subjects: set[str] = set()
    for path in pathways:
        psubj = path.get("subject")
        if psubj not in CANONICAL_SUBJECTS or psubj in pathway_subjects:
            raise DataValidationError(f"Invalid or duplicate pathway subject {psubj!r}")
        pathway_subjects.add(psubj)
        steps = path.get("steps") or []
        if not (4 <= len(steps) <= 6):
            raise DataValidationError(f"Pathway {path.get('id')} must have 4..6 steps, got {len(steps)}")
        step_total += len(steps)
        for step in steps:
            for tid in step.get("topicIds") or []:
                if tid not in topic_by_id or normalize_subject(topic_by_id[tid]["subject"]) != psubj:
                    raise DataValidationError(f"Pathway {path.get('id')} step references invalid topic {tid!r}")

    return {
        "predictions": len(predictions),
        "pathways": len(pathways),
        "steps": step_total,
        "evidenceLinks": evidence_total,
    }


def validate_asset_hashes(root: Path = ROOT) -> None:
    html = (root / "index.html").read_text(encoding="utf-8")
    for asset in package_graph.ASSETS:
        expected = package_graph.asset_digest(root / asset)
        match = re.search(rf'"{re.escape(asset)}\?v=([a-f0-9]+)"', html)
        if not match:
            raise DataValidationError(f"index.html missing versioned reference for {asset}")
        if match.group(1) != expected:
            raise DataValidationError(
                f"index.html stale hash for {asset}: got {match.group(1)}, expected {expected} (run package_graph.py --sync-only)"
            )


def validate_packaging_smoke(root: Path = ROOT) -> dict:
    with tempfile.TemporaryDirectory(prefix="law_exam_atlas_pkg_") as tmp:
        tmp_dir = Path(tmp)
        result = package_graph.package_all(
            root,
            output_dir=tmp_dir,
            update_index=False,
            update_readme=False,
            build_bundles=True,
            create_zip=True,
        )
        for key in ("singleHtml", "workbenchHtml", "fullscreenHtml", "zip"):
            artifact = Path(result["outputs"][key])
            if not artifact.exists() or artifact.stat().st_size == 0:
                raise DataValidationError(f"Packaged artifact missing or empty: {key}")

        single_text = Path(result["outputs"]["singleHtml"]).read_text(encoding="utf-8")
        workbench_text = Path(result["outputs"]["workbenchHtml"]).read_text(encoding="utf-8")
        fullscreen_text = Path(result["outputs"]["fullscreenHtml"]).read_text(encoding="utf-8")

        if '<link rel="stylesheet"' in single_text or "<script src=" in single_text:
            raise DataValidationError("Standalone HTML still contains external stylesheet or script references")
        for marker in (
            "window.LAW_GRAPH",
            "window.LAW_LEARNING_DATA",
            "LawGraphModel",
            "LawLearningModel",
            "LawGraphView",
            'id="quick-jump-dialog"',
            'id="progress-dialog"',
            'id="download-data"',
        ):
            if marker not in single_text:
                raise DataValidationError(f"Standalone HTML missing expected embedded marker: {marker}")

        if 'id="workspace" data-mode="split"' not in workbench_text:
            raise DataValidationError("Workbench standalone HTML did not set data-mode=split")
        if "<title>法硕真题关系网 · 全屏版</title>" not in fullscreen_text:
            raise DataValidationError("Fullscreen standalone HTML missing fullscreen title")

        return {
            "singleBytes": len(single_text.encode("utf-8")),
            "zipBytes": result["zipBytes"],
        }


def validate_repository(root: Path = ROOT, *, check_package: bool = True, check_hashes: bool = True) -> dict:
    data_dir = root / "data"
    graph = json.loads((data_dir / "graph.json").read_text(encoding="utf-8"))
    topics = json.loads((data_dir / "topics.json").read_text(encoding="utf-8"))
    learning = json.loads((data_dir / "learning.json").read_text(encoding="utf-8"))

    graph_js = parse_js_global(data_dir / "graph.js", "LAW_GRAPH")
    if graph_js != graph:
        raise DataValidationError("data/graph.js payload diverges from data/graph.json")

    learning_js = parse_js_global(data_dir / "learning.js", "LAW_LEARNING_DATA")
    if learning_js != learning:
        raise DataValidationError("data/learning.js payload diverges from data/learning.json")

    graph_report = validate_graph_and_topics(graph, topics)
    learning_report = validate_learning(learning, topics, graph)

    if check_hashes:
        validate_asset_hashes(root)

    pkg_report = validate_packaging_smoke(root) if check_package else None
    return {
        "ok": True,
        "graph": graph_report,
        "learning": learning_report,
        "packaging": pkg_report,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check-package",
        action="store_true",
        default=True,
        help="Verify single-file HTML and ZIP packaging in an isolated temp directory (default: true).",
    )
    parser.add_argument(
        "--no-check-package",
        action="store_false",
        dest="check_package",
        help="Skip packaging smoke test.",
    )
    parser.add_argument(
        "--no-check-hashes",
        action="store_false",
        dest="check_hashes",
        default=True,
        help="Skip index.html ?v= SHA-256 hash verification.",
    )
    args = parser.parse_args(argv)
    report = validate_repository(
        ROOT,
        check_package=args.check_package,
        check_hashes=args.check_hashes,
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
