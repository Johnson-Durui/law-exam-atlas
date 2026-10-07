# 法硕关系网快速交接

更新：2026-10-07。此文件让新窗口快速定位工作；产品规则以 [DESIGN.md](DESIGN.md) 为准，当前用户的新要求优先。

## 一分钟了解项目

- 产品：法硕关系网，原生 HTML / CSS / JavaScript 静态应用，没有 npm 构建或后端。
- 仓库：[Johnson-Durui/law-exam-atlas](https://github.com/Johnson-Durui/law-exam-atlas)；[在线页面](https://johnson-durui.github.io/law-exam-atlas/)。本地 Git 根目录是 `法硕知识图谱`，它的上一级是材料目录。
- 三个内容入口：真题全网、知识逻辑、2027 考向；三个展示方式：关系网、工作台、题库。首页默认“2027 考向 + 关系网”。
- 当前数据：1,579 道真题、80 考点；5 条学习路线、27 步；20 个考向分支、3 种情景。544 道提取待核对，材料覆盖不完整。
- 视觉：不出现绿色，白底、黑灰、蓝和橙，克制、清楚。公开名称不强调“（非法学）”，保留真实来源名称。README 已有两张关系网示意图。
- 内容：关键词是候选关联；预测是复习假设；原创练习不计入真题。不宣称命题概率、必考或验证过的命中率。
- 用户已同意公开提取题文与图谱数据；不公开整个材料目录、原卷 PDF 或凭据。

## 从哪里改

| 修改目标 | 文件 |
| --- | --- |
| 页面结构 / 样式 | `index.html` / `style.css` |
| 页面交互、筛选、详情、hash、全屏 | `app.js` |
| Canvas 图形、文字、点击区域、SVG | `graph-view.js` |
| 真题查询 / 学习子图与布局 | `graph-model.js` / `learning-model.js` |
| 考向和学习路线正文 | `build_learning.py`，随后重新生成 learning |
| 考点词表 / 关联逻辑 | `data/topics.json` / `build_graph.py` |
| 原卷提取 | `build_corpus.py`，需要本地 PDF 和 pypdf |
| README、离线 HTML、ZIP | `package_graph.py`；README 是生成文件 |
| 公开关系网示意图 | `assets/relationship-network.png`、`assets/forecast-branch.png` |
| 产品依据 / 来源说明 | `DESIGN.md` / `NOTICE.md` |

脚本加载顺序：`graph.js` → `learning.js` → `graph-model.js` → `learning-model.js` → `graph-view.js` → `app.js`。保持数据与依赖在使用前就绪。

## 每个窗口开始时

1. 读本文件、`DESIGN.md` 相关部分及仓库 `AGENTS.md`。
2. 在 Git 根目录查看 `git status --short`、`git log -5 --oneline`、`git remote -v`；不要把旧交接记录当作当前提交。
3. 保护其他窗口未提交的修改，确认本次拥有的文件与任务范围。
4. 对照实际代码确认当前行为，再执行小范围修改；产品规则变化时同步档案。

## 运行与构建

直接打开 `index.html` 可离线运行；在线版见上方链接。浏览器自动化仍服从当前环境的访问策略，不能通过换地址绕过明确拒绝。

下面命令均在仓库根目录执行。若系统找不到 Node/Python，可用 Codex 的 `load_workspace_dependencies` 查询内置运行时；本机绝对路径另记在材料目录的 `产品设计档案入口.md`，不写入公开仓库。

```powershell
# 改过考向或学习路线正文后
python build_learning.py

# 更新资源指纹，生成 README 和离线包
python package_graph.py
```

只有修改原卷、提取或词表时，才按依赖运行完整链路：

```text
build_corpus.py → build_graph.py → build_learning.py → package_graph.py
```

公开克隆没有原 PDF 和 corpus，不能直接重跑完整提取。生成的三个离线 HTML、ZIP、`snapshots/`、`verification.json`、corpus 和提取报告都被忽略；在线运行所需的 graph / learning 数据已纳入 Git。

## 按修改范围验证

| 修改范围 | 最小验证 |
| --- | --- |
| 仅文档 | 相对链接和图片存在；README 模板同步；`git diff --check` |
| 基础数据、筛选、邻居 | `node test_model.cjs`；影响学习引用时再跑学习模型测试 |
| 学习/考向模型与内容 | `node test_learning_model.cjs`；布局改变再跑对应渲染测试 |
| 页面交互 | `node test_app.cjs`；打包后 `node test_app.cjs --fullscreen` |
| 密集图渲染 | `node test_renderer.cjs`、`node test_dense_renderer.cjs` |
| 逻辑图/学习图渲染 | `node test_logic_renderer.cjs`、`node test_learning_renderer.cjs` |
| 发布交互变更 | 上述相关检查 + 具体提交的 Pages 状态、线上资源和实际浏览器交互 |

页面与渲染测试使用替身，不能代替真实浏览器。渲染测试写入 `snapshots/`，不是自动更新公开 `assets/` 的 PNG。第一次克隆运行全屏产物测试前，先执行打包。

重点回归：零结果不能显示全量题库；点击分支应展开并显示详情；返回全览正常；搜索同步；深链能打开目标分支；小屏可点选；Canvas 与 SVG 的文字布局、点击区域一致。

## 发布与回退

当本次任务包含发布时：确认相关文件与测试 → 提交 → 普通推送 `main` → 核对 Pages 对应提交的构建 → 核对线上结果。Pages 来源为 `main` 的根目录，存在 `.nojekyll`，无需另换托管平台。

可以用 `gh run list --repo Johnson-Durui/law-exam-atlas` 查看部署，必要时用 `gh run watch <运行ID>` 等待具体运行；推送成功本身不能证明页面已更新。GitHub 登录通过已有凭据管理，不把 token 写到代码或文档。

回退优先针对具体提交创建 revert 提交并重新部署，不强推覆盖其他窗口的工作。仅整理文档时，不顺手重提取题库或改产品功能。

## 最新交接记录

| 项目 | 记录 |
| --- | --- |
| 日期 / 任务 | 2026-10-07；建立跨窗口产品设计档案 |
| 开始状态 | 整理开始时，本地、远程 `main` 均为 `a15b4bd`，工作区干净；Pages 为 built |
| 本次变更 | 更新 DESIGN；新增 HANDOFF、仓库 AGENTS；旧设计文档改为索引；README 及生成模板增加档案导航；材料目录新增本机入口 |
| 功能范围 | 不改变页面行为、真题数据或预测内容 |
| 验证记录 | 本次实际结果见下方“本次验证”；历史验证不能替代新变更的检查 |
| 交接后的工作 | 没有本轮遗留的产品功能需求；候选改进见 DESIGN 第 13 节，新任务自行确定优先级 |

### 本次验证

- `node test_model.cjs`：通过，1,579 题、1,692 节点、6,025 条关系，筛选与邻居检查通过。
- `node test_learning_model.cjs`：通过，20 个考向、5 条路线，引用状态、科目、端点与无伪造 2027 真题检查通过。
- `python package_graph.py`：通过，重新生成 README 和离线包；档案导航保留，在线页面源文件无差异。
- 文档检查：19 个本地 Markdown 链接或图片路径有效；两个旧设计文档已改为索引；`git diff --check` 通过。
- 独立只读复核：核对了统计、接口、生成关系和内容边界；本轮为文档修改，没有重跑浏览器交互测试。

提交与发布状态以当前 `git log`、远程状态和 Pages 构建为准，避免档案自引用提交号失真。

### 历史节点

- `16adbaa`（2026-09-24）：初始交互学习与考向图。
- `40e93ef`：收窄标签、保留选中分支的上下文。
- `ae5baed`：静态资源指纹。
- `a15b4bd`：去掉公开类别强调，README 增加关系网示意图。

本地 `verification.json` 记录的是 2026-09-24 验证，不代表之后每个提交都已通过。

## 给另一个对话的开场语

> 请接手法硕关系网。先进入仓库，阅读 AGENTS.md、HANDOFF.md、DESIGN.md，再查看 git status 和最近提交。继续任务：【填写本次修改】。保留不使用绿色、真题与预测分开、对外不强调考试类别等既定要求，保护其他窗口的修改。按变更范围验证，完成后更新交接记录；发布按本次任务的授权执行。

## 后续交接怎么更新

每次完成有意义的修改，替换“最新交接记录”，保留必要的历史节点即可，不要无限追加对话过程。可使用这个模板：

```text
日期 / 接手时提交：
本次目标与范围：
已修改文件、结果与关键决策：
执行的验证及结果：
未验证项或具体阻塞：
提交 / 发布状态：
尚未完成事项及下一步：
```

产品决策写入 DESIGN，操作与当前状态写入 HANDOFF，对外说明同时改 README 生成模板。不要在交接中记录凭据、整段聊天或与本项目无关的个人文件。
