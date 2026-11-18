"""Unit and integration tests for corpus/graph/learning data validation and standalone HTML packaging."""

from __future__ import annotations

import copy
import json
import sys
import zipfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import package_graph
from scripts import validate_data


@pytest.fixture(scope="module")
def datasets() -> tuple[dict, list[dict], dict]:
    data_dir = ROOT / "data"
    graph = json.loads((data_dir / "graph.json").read_text(encoding="utf-8"))
    topics = json.loads((data_dir / "topics.json").read_text(encoding="utf-8"))
    learning = json.loads((data_dir / "learning.json").read_text(encoding="utf-8"))
    return graph, topics, learning


def test_full_repository_validation_passes() -> None:
    report = validate_data.validate_repository(ROOT, check_package=False, check_hashes=True)
    assert report["ok"] is True
    assert report["graph"]["questions"] == 1579
    assert report["graph"]["topics"] == 80
    assert report["graph"]["nodes"] == 1692
    assert report["graph"]["edges"] == 6025
    assert report["graph"]["extractionStatus"] == {"自动提取": 1035, "提取待核对": 544}
    assert report["learning"]["predictions"] == 20
    assert report["learning"]["pathways"] == 5
    assert report["learning"]["steps"] == 27


def test_js_wrappers_match_json_payloads(datasets: tuple[dict, list[dict], dict]) -> None:
    graph, _topics, learning = datasets
    graph_js = validate_data.parse_js_global(ROOT / "data/graph.js", "LAW_GRAPH")
    learning_js = validate_data.parse_js_global(ROOT / "data/learning.js", "LAW_LEARNING_DATA")
    assert graph_js == graph
    assert learning_js == learning


def test_detects_dangling_edge_and_duplicate_ids(datasets: tuple[dict, list[dict], dict]) -> None:
    graph, topics, _learning = datasets

    bad_edge_graph = copy.deepcopy(graph)
    bad_edge_graph["edges"][0]["target_node_uuid"] = "missing-node-id"
    with pytest.raises(validate_data.DataValidationError, match="dangling endpoint"):
        validate_data.validate_graph_and_topics(bad_edge_graph, topics)

    dup_node_graph = copy.deepcopy(graph)
    dup_node_graph["nodes"].append(copy.deepcopy(dup_node_graph["nodes"][0]))
    with pytest.raises(validate_data.DataValidationError, match="Duplicate or invalid node uuid"):
        validate_data.validate_graph_and_topics(dup_node_graph, topics)


def test_detects_invalid_forecast_topic_or_fabricated_year(datasets: tuple[dict, list[dict], dict]) -> None:
    graph, topics, learning = datasets

    bad_learning = copy.deepcopy(learning)
    bad_learning["predictions"][0]["topicIds"].append("nonexistent_topic")
    with pytest.raises(validate_data.DataValidationError, match="unknown topic"):
        validate_data.validate_learning(bad_learning, topics, graph)

    bad_year_graph = copy.deepcopy(graph)
    first_question = next(n for n in bad_year_graph["nodes"] if n["labels"] == ["Question"])
    first_question["attributes"]["year"] = 2027
    with pytest.raises(validate_data.DataValidationError, match="out-of-range year"):
        validate_data.validate_graph_and_topics(bad_year_graph, topics)


def test_package_graph_into_temp_directory_leaves_repo_clean(tmp_path: Path) -> None:
    before_root_files = {p.name for p in ROOT.iterdir()}

    summary = package_graph.package_all(
        ROOT,
        output_dir=tmp_path,
        update_index=False,
        update_readme=False,
        build_bundles=True,
        create_zip=True,
    )

    assert summary["questions"] == 1579
    single_html = Path(summary["outputs"]["singleHtml"])
    workbench_html = Path(summary["outputs"]["workbenchHtml"])
    fullscreen_html = Path(summary["outputs"]["fullscreenHtml"])
    zip_path = Path(summary["outputs"]["zip"])

    for artifact in (single_html, workbench_html, fullscreen_html, zip_path):
        assert artifact.parent == tmp_path
        assert artifact.exists()
        assert artifact.stat().st_size > 100_000

    content = single_html.read_text(encoding="utf-8")
    assert '<link rel="stylesheet"' not in content
    assert "<script src=" not in content
    assert 'id="quick-jump-dialog"' in content
    assert 'id="progress-dialog"' in content
    assert "createStudyStore" in content

    with zipfile.ZipFile(zip_path) as zf:
        names = set(zf.namelist())
        assert f"{ROOT.name}/index.html" in names
        assert f"{ROOT.name}/法硕真题关系网_全屏版.html" in names
        assert f"{ROOT.name}/法硕真题关系网_工作台版.html" in names

    after_root_files = {p.name for p in ROOT.iterdir()}
    assert before_root_files == after_root_files
