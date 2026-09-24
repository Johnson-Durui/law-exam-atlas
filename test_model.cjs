'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const requested = process.argv[2] || process.env.LAW_GRAPH_DATA;
const graphPath = path.resolve(requested || path.join(ROOT, 'data', 'graph.json'));

if (!fs.existsSync(graphPath)) {
  console.error(`真实图谱不存在：${graphPath}`);
  console.error('请先运行 build_graph.py，或把 graph.json 路径作为第一个参数传入。');
  process.exitCode = 2;
  return;
}

const LawGraphModel = require(path.join(ROOT, 'graph-model.js'));
const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));

assert.equal(LawGraphModel.validate(graph), true, '真实 graph.json 必须通过模型校验');
const model = LawGraphModel.create(graph);
const nodeIds = new Set(graph.nodes.map(node => node.uuid));

for (const edge of graph.edges) {
  assert.ok(nodeIds.has(edge.source_node_uuid), `关系 ${edge.uuid} 的起点不存在`);
  assert.ok(nodeIds.has(edge.target_node_uuid), `关系 ${edge.uuid} 的终点不存在`);
}

const allRelations = ['科目', '候选考点', '年份', '题型'];
const questions = model.questions;
assert.ok(questions.length > 0, '真实图谱应含 Question 节点');

const years = [...new Set(questions.map(node => Number(node.attributes.year)))].sort((a, b) => a - b);
const subjects = [...new Set(questions.map(node => node.attributes.subject))].sort();
assert.ok(years.length > 0 && years.every(Number.isFinite), '题目年份必须有效');
assert.ok(subjects.length > 0 && subjects.every(Boolean), '题目科目必须有效');

const testYear = years[Math.floor(years.length / 2)];
const yearResult = model.filter({ from: testYear, to: testYear, relations: allRelations });
const expectedYearCount = questions.filter(node => Number(node.attributes.year) === testYear).length;
assert.equal(yearResult.questions.length, expectedYearCount, '单年筛选数量应与真实题目一致');
assert.ok(yearResult.questions.every(node => Number(node.attributes.year) === testYear), '单年筛选不得混入其他年份');

const subjectCounts = subjects.map(subject => ({
  subject,
  count: questions.filter(node => node.attributes.subject === subject).length
})).sort((a, b) => b.count - a.count);
const canonicalSubjects = new Set(['刑法', '民法', '法理学', '宪法学', '法制史']);
const testedSubjectCount = subjectCounts.find(item => canonicalSubjects.has(item.subject)) || subjectCounts[0];
const testSubject = testedSubjectCount.subject;
const subjectResult = model.filter({ subject: testSubject, relations: allRelations });
assert.equal(subjectResult.questions.length, testedSubjectCount.count, '科目筛选数量应与真实题目一致');
assert.ok(subjectResult.questions.every(node => node.attributes.subject === testSubject), '科目筛选不得混入其他科目');

const candidateEdges = graph.edges.filter(edge => edge.name === '候选考点');
assert.ok(candidateEdges.length > 0, '真实图谱应含候选考点关系以验证搜索');
const searchableEdge = candidateEdges.find(edge => {
  const target = model.byId.get(edge.target_node_uuid);
  return target && target.name && target.name.trim().length >= 2;
});
assert.ok(searchableEdge, '应存在可按考点名称搜索的真实关系');
const searchableTopic = model.byId.get(searchableEdge.target_node_uuid);
const topicId = searchableTopic.attributes.topicId;
const searchResult = model.filter({ query: searchableTopic.name, relations: allRelations });
const expectedSearchIds = new Set(questions
  .filter(node => (node.attributes.topics || []).includes(topicId))
  .map(node => node.uuid));
assert.ok(searchResult.questions.length > 0, `搜索“${searchableTopic.name}”应命中真实题目`);
assert.deepEqual(new Set(searchResult.questions.map(node => node.uuid)), expectedSearchIds,
  '按完整考点名称搜索应返回标有该考点的题目');

const yearSearch = model.filter({ query: String(testYear), relations: allRelations });
assert.ok(yearSearch.questions.length >= expectedYearCount, '搜索年份文本应覆盖该年份题目');
assert.ok(yearSearch.questions.some(node => Number(node.attributes.year) === testYear));

const noMatchQuery = '__LAW_GRAPH_TEST_NO_MATCH_9f734c8e__';
const noMatch = model.filter({ query: noMatchQuery, relations: allRelations });
assert.equal(noMatch.questions.length, 0, '无匹配搜索应返回零题');
assert.equal(noMatch.nodes.length, 0, '无匹配搜索应返回空节点集');
assert.equal(noMatch.edges.length, 0, '无匹配搜索应返回空关系集');

const noRelations = model.filter({ relations: [], concepts: false });
assert.equal(noRelations.questions.length, questions.length, '关闭关系不应删除题目');
assert.equal(noRelations.nodes.length, questions.length, '关闭关系时只保留题目节点');
assert.equal(noRelations.edges.length, 0, '关闭全部关系应无可见连线');

const relationStats = {};
for (const relation of allRelations) {
  const result = model.filter({ relations: [relation], concepts: false });
  assert.ok(result.edges.every(edge => edge.name === relation), `仅开启“${relation}”时不得出现其他关系`);
  assert.ok(result.edges.every(edge => result.nodes.some(node => node.uuid === edge.source_node_uuid)
    && result.nodes.some(node => node.uuid === edge.target_node_uuid)), `“${relation}”结果的端点必须可见`);
  if (relation !== '候选考点' || candidateEdges.length) assert.ok(result.edges.length > 0, `“${relation}”应有真实关系`);
  relationStats[relation] = result.edges.length;
}

const combined = model.filter({ relations: allRelations });
const combinedIds = new Set(combined.nodes.map(node => node.uuid));
assert.ok(combined.edges.every(edge => combinedIds.has(edge.source_node_uuid) && combinedIds.has(edge.target_node_uuid)),
  '组合筛选后的每条关系都必须保留两个端点');
assert.equal(new Set(combined.edges.map(edge => edge.uuid)).size, combined.edges.length,
  '组合筛选不得重复加入同一关系');

const topicNodes = graph.nodes.filter(node => node.labels && node.labels[0] === 'Topic');
let topicsWithQuestions = 0;
let relatedQuestionCount = 0;
for (const topic of topicNodes) {
  const related = model.relatedQuestions(topic.uuid);
  if (!related.length) continue;
  topicsWithQuestions += 1;
  relatedQuestionCount += related.length;
  const ids = related.map(item => item.node.uuid);
  assert.equal(new Set(ids).size, ids.length, `考点“${topic.name}”的关联题不得重复`);
  assert.ok(related.every(item => item.node.labels[0] === 'Question'));
  for (let index = 1; index < related.length; index += 1) {
    const previous = related[index - 1].node.attributes;
    const current = related[index].node.attributes;
    assert.ok(previous.year > current.year || previous.year === current.year && previous.number <= current.number,
      `考点“${topic.name}”的关联题排序应为年份降序、题号升序`);
  }
  const eligible = related.filter((_, index) => index % 2 === 0).map(item => item.node);
  const eligibleIds = new Set(eligible.map(node => node.uuid));
  const restricted = model.relatedQuestions(topic.uuid, eligible);
  assert.ok(restricted.every(item => eligibleIds.has(item.node.uuid)), 'eligible 参数必须限制关联题范围');
  assert.equal(new Set(restricted.map(item => item.node.uuid)).size, restricted.length,
    '限制范围后的关联题仍不得重复');
}
assert.ok(topicsWithQuestions > 0, '至少一个真实考点应有关联题');

console.log(JSON.stringify({
  ok: true,
  graphPath,
  nodes: graph.nodes.length,
  edges: graph.edges.length,
  questions: questions.length,
  years: [years[0], years.at(-1)],
  testedYear: { year: testYear, questions: yearResult.questions.length },
  testedSubject: { subject: testSubject, questions: subjectResult.questions.length },
  testedSearch: { query: searchableTopic.name, questions: searchResult.questions.length },
  relationStats,
  topicsWithQuestions,
  relatedQuestionCount
}, null, 2));
