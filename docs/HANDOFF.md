# 法硕关系网快速交接

更新：2026-11-18。此文件让新窗口快速定位工作；产品规则以 [DESIGN.md](DESIGN.md) 为准，材料与开源边界见 [../NOTICE.md](../NOTICE.md) 与 [../LICENSE](../LICENSE)，当前用户的新要求优先。

## 一分钟了解项目

- 产品：法硕关系网，原生 HTML / CSS / JavaScript 静态应用，没有打包构建器或后端服务器。
- 仓库：[Johnson-Durui/law-exam-atlas](https://github.com/Johnson-Durui/law-exam-atlas)；[在线页面](https://johnson-durui.github.io/law-exam-atlas/)。根目录直接发布到 GitHub Pages（含 `.nojekyll`、`index.html`、`study/index.html`、`assets/`、`data/`）。
- 三个内容入口：真题全网、知识逻辑、2027 考向；三个展示方式：全景（`graph`）、工作台（`split`）、题库（`list`）。首页默认“2027 考向 + 全景”。
- 个人复习辅助：全局快速跳转面板（`/` 或 `Ctrl+K`，覆盖考向/考点/路线/真题与缩写匹配）及本地复习标记（`★ 重点收藏`、`✓ 已复盘`、状态筛选与 JSON 导入/导出，安全包裹 `localStorage` 并支持无存储降级）。
- 当前数据：1,579 道真题、80 考点；5 条学习路线、27 步；20 个考向分支、3 种情景。544 道提取待核对，材料覆盖不完整。
- 视觉：不使用绿色，保持白底、黑灰、深蓝（`#345c99`）与暖橙（`#b85e32` / `#e56f3f`）。公开名称不强调“（非法学）”，保留真实来源名称。
- 内容：关键词是候选关联；预测是复习假设；原创练习不计入真题。不宣称命题概率、必考或验证过的命中率。

## 从哪里改

| 修改目标 | 文件 |
| --- | --- |
| 页面结构 / 样式 | `index.html` / `style.css` |
| 页面交互、快搜弹窗、进度面板、详情、深链 | `app.js` |
| Canvas 图形、文字、点击区域、SVG | `graph-view.js` |
| 真题查询 / 学习子图、快搜索引、本地进度存储 | `graph-model.js` / `learning-model.js` |
| 考向和学习路线正文 | `build_learning.py`，随后重新生成 learning |
| 考点词表 / 关联逻辑 | `data/topics.json` / `build_graph.py` |
| 原卷提取 | `build_corpus.py`，需要本地 PDF 和 pypdf |
| README 同步、资源指纹、离线 HTML / ZIP | `package_graph.py`（`--sync-only` 或 `--output-dir dist`） |
| 数据结构完整性与打包冒烟校验 | `scripts/validate_data.py`、`tests/test_data_pipeline.py` |
| JS 自动化测试套件与统一运行器 | `tests/run_all.cjs`、`tests/test_*.cjs` |
| 产品依据 / 来源说明 / 许可说明 | `docs/DESIGN.md` / `NOTICE.md` / `LICENSE` |

脚本加载顺序：`data/graph.js` → `data/learning.js` → `graph-model.js` → `learning-model.js` → `graph-view.js` → `app.js`。保持数据与依赖在使用前就绪。

## 运行与构建

直接打开 `index.html` 可离线运行。修改前端资源或 README 模板后，在仓库根目录执行：

```powershell
# 改过考向或学习路线正文后重新生成 learning.json / learning.js
python build_learning.py

# 仅更新 index.html 资源指纹与同步 README.md（不在工作区遗留单文件产物）
python package_graph.py --sync-only

# 生成内嵌数据的单文件 HTML 与离线 ZIP 到指定目录
python package_graph.py --output-dir dist
```

## 验证命令

```powershell
# 一键运行全部 8 套 Node.js 测试（模型、渲染器、快速跳转、复习进度与虚拟 DOM 集成）
node tests/run_all.cjs

# 运行 Python 数据完整性校验与临时目录单文件打包冒烟测试
python scripts/validate_data.py --check-package
pytest tests/test_data_pipeline.py
ruff check .
```

重点回归：零结果不能显示全量题库；点击分支应展开并显示详情；`/` 与 `Ctrl+K` 快速跳转直达正确层与节点；无 `localStorage` 时收藏与复盘不抛错；Canvas 与 SVG 文字布局一致；GitHub Pages 根目录公开 URL 不变。

## 最新交接记录

| 项目 | 记录 |
| --- | --- |
| 日期 / 任务 | 2026-11-18；仓库架构整理、工程化校验流水线与本地学习效率升级 |
| 目录与工程化 | 内部设计文档归档至 `docs/`，7 套原有 JS 测试迁入 `tests/` 并新增 `tests/run_all.cjs` 与零依赖 `package.json`；新增 `scripts/validate_data.py` 与 `tests/test_data_pipeline.py`；补充与 `NOTICE.md` 一致的 `LICENSE`；清理全部 Python 脚本 `ruff` 告警 |
| 功能升级 | `learning-model.js` 与 `app.js` 新增毫秒级全局快速跳转（`/` 或 `Ctrl+K`，支持编号、关键词与缩写子序列搜索）及本地重点收藏/已复盘进度管理（含状态筛选、JSON 导入导出与无 `localStorage` 自动内存降级） |
| 兼容性保障 | 保持 `index.html`、`study/index.html`、`assets/`、`data/`、`.nojekyll` 公开路径与离线 `file://` 运行完全兼容；`package_graph.py` 支持 `--output-dir` 与 `--sync-only` 避免污染工作区 |
