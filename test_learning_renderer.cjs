'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const NODE = path.join(ROOT, 'graph-model.js');
const LEARNING = path.join(ROOT, 'learning-model.js');

class EventTargetStub {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
  }
  removeEventListener(type, handler) {
    const bucket = this.listeners.get(type);
    if (bucket) bucket.delete(handler);
  }
}

function makeContext() {
  const calls = Object.create(null);
  const texts = [];
  const context = {
    calls, texts,
    measureText: text => ({ width: Array.from(String(text)).length * 12 }),
    fillText(text) { calls.fillText = (calls.fillText || 0) + 1; texts.push(String(text)); }
  };
  [
    'setTransform', 'fillRect', 'beginPath', 'arc', 'fill', 'stroke',
    'moveTo', 'quadraticCurveTo', 'setLineDash'
  ].forEach(name => { context[name] = () => { calls[name] = (calls[name] || 0) + 1; }; });
  return context;
}

class CanvasStub extends EventTargetStub {
  constructor() {
    super();
    this.style = {};
    this.parentNode = null;
    this.context = makeContext();
    this.attributes = new Map();
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getContext() { return this.context; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 1600, height: 1000 }; }
  setPointerCapture() {}
}

class ContainerStub {
  constructor() { this.clientWidth = 1600; this.clientHeight = 1000; this.child = null; }
  appendChild(child) { this.child = child; child.parentNode = this; }
  removeChild(child) { assert.equal(child, this.child); this.child = null; child.parentNode = null; }
  getBoundingClientRect() { return { width: this.clientWidth, height: this.clientHeight }; }
}

function installDom() {
  let nextId = 0;
  const frames = new Map();
  const windowTarget = new EventTargetStub();
  global.window = global;
  global.devicePixelRatio = 2;
  global.addEventListener = windowTarget.addEventListener.bind(windowTarget);
  global.removeEventListener = windowTarget.removeEventListener.bind(windowTarget);
  global.document = { createElement: tag => { assert.equal(tag, 'canvas'); return new CanvasStub(); } };
  global.ResizeObserver = class { observe() {} disconnect() {} };
  global.requestAnimationFrame = callback => { const id = ++nextId; frames.set(id, callback); return id; };
  global.cancelAnimationFrame = id => frames.delete(id);
  return {
    flush(limit = 30) {
      let rounds = 0;
      while (frames.size && rounds < limit) {
        const callbacks = [...frames.values()];
        frames.clear();
        callbacks.forEach(callback => callback(Date.now()));
        rounds += 1;
      }
      assert.ok(rounds < limit, 'learning renderer RAF should settle');
      return rounds;
    }
  };
}

function intersects(a, b, padding = 0) {
  return a.l < b.r + padding && a.r + padding > b.l && a.t < b.b + padding && a.b + padding > b.t;
}

function relationBoxes(view) {
  const selection = view._selectionSets();
  return view.edges.filter(edge => view._logicEdgeLabelVisible(edge, selection)).map(edge => {
    const point = view._edgeLabelPoint(view._edgeGeometry(edge));
    const text = view._logicEdgeText(edge);
    const x = point.x * view.camera.zoom + view.camera.x;
    const y = point.y * view.camera.zoom + view.camera.y - 4;
    const width = Array.from(text).reduce((sum, char) => sum + (char.charCodeAt(0) > 255 ? 10.5 : 6), 0);
    return { edge, text, l: x - width / 2, r: x + width / 2, t: y - 13, b: y + 2 };
  });
}

function verifyFirstFrame(view, payload, title) {
  assert.equal(view.layout, 'logic', `${title}: model output should request logic layout`);
  assert.equal(view._ticksLeft, 0, `${title}: authored layout should remain still`);
  assert.equal(view._logicLabelRegions.length, payload.nodes.length,
    `${title}: every branch label should be present on the first frame`);
  for (const region of view._logicLabelRegions) {
    assert.ok(region.l >= 0 && region.r <= view.width && region.t >= 0 && region.b <= view.height,
      `${title}: long label should fit viewport (${region.node.name})`);
  }
  const relationLabels = relationBoxes(view);
  for (const relation of relationLabels) {
    for (const nodeLabel of view._logicLabelRegions) {
      assert.equal(intersects(relation, nodeLabel, 2), false,
        `${title}: relation label overlaps node label (${relation.text}/${nodeLabel.node.name})`);
    }
  }
  for (let i = 0; i < relationLabels.length; i += 1) {
    for (let j = i + 1; j < relationLabels.length; j += 1) {
      assert.equal(intersects(relationLabels[i], relationLabels[j], 2), false,
        `${title}: relation labels overlap (${relationLabels[i].text}/${relationLabels[j].text})`);
    }
  }
  return relationLabels;
}

const scheduler = installDom();
const graphModel = require(NODE);
const learningModel = require(LEARNING);
require(path.join(ROOT, 'graph-view.js'));

const graph = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'graph.json'), 'utf8'));
const learningData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'learning.json'), 'utf8'));
const exams = graphModel.create(graph);
const learning = learningModel.create(learningData, exams);
const firstPathway = learningData.pathways[0].id;

const cases = [
  { title: '2027考向总览', payload: learning.forecast(), required: ['2027 考向', '常规轮换'] },
  { title: '2027考向分支', payload: learning.forecast({ focus: 'forecast-cr-01' }), required: ['故意、过失与认识错误的连续判断'] },
  { title: '知识逻辑总览', payload: learning.learning(), required: ['从题目到结论', '刑法 · 审题路线'] },
  { title: '知识逻辑路线', payload: learning.learning({ focus: firstPathway }), required: ['刑法 · 审题路线', '1. 拆事实'] }
];

const container = new ContainerStub();
const view = new global.LawGraphView(container, { presentation: 'dense' });
const snapshots = [];

for (const item of cases) {
  view.setData(item.payload);
  scheduler.flush();
  const relationLabels = verifyFirstFrame(view, item.payload, item.title);
  const svg = view.exportSVG();
  assert.match(svg, /id="logic-arrow"/, `${item.title}: arrows should be exported`);
  assert.doesNotMatch(svg, /#367e96|#61988a|#848968|#459687/i, `${item.title}: old green or cyan palette should not return`);
  for (const name of item.required) assert.ok(svg.includes(name), `${item.title}: missing ${name}`);
  const output = path.join(ROOT, 'snapshots', `${item.title}.svg`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, svg, 'utf8');
  assert.ok(fs.statSync(output).size > 2500, `${item.title}: SVG should contain the real model output`);
  snapshots.push({
    title: item.title,
    nodes: item.payload.nodes.length,
    edges: item.payload.edges.length,
    visibleLabels: view._logicLabelRegions.length,
    relationLabels: relationLabels.length,
    zoom: Number(view.camera.zoom.toFixed(3)),
    bytes: fs.statSync(output).size,
    output
  });
}

const overviewPredictions = cases[0].payload.nodes.filter(node => node.labels.includes('Prediction'));
assert.equal(learningData.predictions.length, 20, 'the authored dataset should contain twenty prediction branches');
assert.equal(overviewPredictions.length, learningData.predictions.length,
  'forecast overview should expose every authored prediction branch');
const overviewVisibleIds = new Set(cases[0].payload.nodes.map(node => node.uuid));
for (const prediction of learningData.predictions) {
  assert.ok(overviewVisibleIds.has(prediction.id), `forecast overview should include ${prediction.id}`);
}
assert.ok(cases[1].payload.nodes.some(node => node.labels.includes('Question')),
  'focused forecast should connect its branch to real exam evidence');
assert.ok(cases[3].payload.nodes.filter(node => node.labels.includes('Step')).length >= 4,
  'focused learning route should expose its full step sequence');

view.destroy();
console.log(JSON.stringify({ ok: true, pathway: firstPathway, snapshots }, null, 2));
