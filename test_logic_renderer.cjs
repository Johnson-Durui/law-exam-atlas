'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;

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
  dispatch(type, init = {}) {
    const event = {
      type, key: '', shiftKey: false, pointerId: 1, clientX: 0, clientY: 0, deltaY: 0,
      preventDefault() { this.defaultPrevented = true; },
      ...init
    };
    for (const handler of this.listeners.get(type) || []) handler(event);
    return event;
  }
}

function makeContext() {
  const calls = Object.create(null);
  const texts = [];
  const methods = [
    'setTransform', 'fillRect', 'beginPath', 'arc', 'fill', 'stroke',
    'moveTo', 'quadraticCurveTo', 'setLineDash'
  ];
  const context = {
    calls,
    texts,
    measureText: text => ({ width: Array.from(String(text)).length * 12 }),
    fillText(text) { calls.fillText = (calls.fillText || 0) + 1; texts.push(String(text)); }
  };
  methods.forEach(name => { context[name] = () => { calls[name] = (calls[name] || 0) + 1; }; });
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
  getBoundingClientRect() { return { left: 0, top: 0, width: 1200, height: 760 }; }
  setPointerCapture() {}
}

class ContainerStub {
  constructor() { this.clientWidth = 1200; this.clientHeight = 760; this.child = null; }
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
        const batch = [...frames.values()];
        frames.clear();
        batch.forEach(callback => callback(Date.now()));
        rounds += 1;
      }
      assert.ok(rounds < limit, 'logic renderer RAF should settle');
      return rounds;
    }
  };
}

function fixture() {
  const node = (uuid, name, label, x, y, subject) => ({
    uuid, name, labels: [label], attributes: { subject: subject || '综合', layout: { x, y } }
  });
  return {
    layout: 'logic',
    nodes: [
      node('forecast', '2027 法硕考向', 'Forecast', 0, 0),
      node('scenario', '常规轮换情景', 'Scenario', 250, -125),
      node('prediction', '行为效力与责任衔接', 'Prediction', 525, -125, '民法'),
      node('topic', '民事法律行为效力', 'Topic', 800, -125, '民法'),
      node('pathway', '零基础作答路径', 'Pathway', 250, 145),
      node('step', '先找主体、行为与时间', 'Step', 525, 145)
    ],
    edges: [
      { uuid: 'e1', source_node_uuid: 'forecast', target_node_uuid: 'scenario', name: '分为情景' },
      { uuid: 'e2', source_node_uuid: 'scenario', target_node_uuid: 'prediction', name: '推导考向', attributes: { predicted: true } },
      { uuid: 'e3', source_node_uuid: 'prediction', target_node_uuid: 'topic', name: '关联考点' },
      { uuid: 'e4', source_node_uuid: 'forecast', target_node_uuid: 'pathway', name: '进入学习' },
      { uuid: 'e5', source_node_uuid: 'pathway', target_node_uuid: 'step', name: '第一步' }
    ]
  };
}

const scheduler = installDom();
require(path.join(ROOT, 'graph-view.js'));

const selections = [];
const container = new ContainerStub();
const view = new global.LawGraphView(container, {
  presentation: 'dense',
  onSelect: selection => selections.push(selection)
});
const data = fixture();
view.setData(data);
scheduler.flush();

assert.equal(view.layout, 'logic');
assert.equal(view._ticksLeft, 0, 'logic coordinates must not enter force simulation');
for (const expected of data.nodes) {
  const rendered = view.nodeById.get(expected.uuid);
  assert.equal(rendered.x, expected.attributes.layout.x, `${expected.uuid} should keep authored x`);
  assert.equal(rendered.y, expected.attributes.layout.y, `${expected.uuid} should keep authored y`);
  assert.equal(rendered.displayName, expected.name, 'logic nodes should display the authored name without truncation');
}
assert.equal(view.nodeById.get('prediction').color, '#e56f3f', 'prediction nodes use warm orange');
assert.equal(view.nodeById.get('step').color, '#1d4f78', 'learning steps use deep blue');
assert.equal(view.nodeById.get('topic').color, '#345c99', 'topic nodes retain their subject color');
assert.ok(container.child.context.calls.quadraticCurveTo > data.edges.length,
  'logic edges should include directional arrow geometry');
assert.ok(container.child.context.texts.includes('推导考向'), 'overview should render short relation labels');

const forecastRegion = view._logicLabelRegions.find(region => region.node.id === 'forecast');
assert.ok(forecastRegion, 'logic node labels should expose clickable screen rectangles');
const click = {
  pointerId: 7,
  clientX: (forecastRegion.l + forecastRegion.r) / 2,
  clientY: (forecastRegion.t + forecastRegion.b) / 2
};
container.child.dispatch('pointerdown', click);
container.child.dispatch('pointerup', click);
assert.equal(view.selected.item.id, 'forecast', 'clicking a logic label selects its node');
assert.equal(selections.at(-1).data.uuid, 'forecast');
scheduler.flush();

const beforeDrag = { x: view.nodeById.get('step').x, y: view.nodeById.get('step').y };
const step = view.nodeById.get('step');
const screen = { x: step.x * view.camera.zoom + view.camera.x, y: step.y * view.camera.zoom + view.camera.y };
container.child.dispatch('pointerdown', { pointerId: 8, clientX: screen.x, clientY: screen.y });
container.child.dispatch('pointermove', { pointerId: 8, clientX: screen.x + 35, clientY: screen.y + 18 });
container.child.dispatch('pointerup', { pointerId: 8, clientX: screen.x + 35, clientY: screen.y + 18 });
scheduler.flush();
assert.ok(Math.hypot(step.x - beforeDrag.x, step.y - beforeDrag.y) > 5, 'logic nodes remain draggable');
assert.equal(view._ticksLeft, 0, 'dragging a logic node must not restart force simulation');

view.selected = null;
view.fit();
const svg = view.exportSVG().replace(/(<svg\b[^>]*>)/,
  '$1<!-- Renderer fixture: structural logic mode contract, not production forecast data. -->');
assert.match(svg, /fill="#ffffff"/);
assert.match(svg, /id="logic-arrow"/);
assert.match(svg, /marker-end="url\(#logic-arrow\)"/);
assert.match(svg, /推导考向/);
assert.ok(svg.replace(/<[^>]+>/g, '').includes('行为效力与责任衔接'));
assert.doesNotMatch(svg, /#61988a|#848968|#459687/i, 'retired green palette must not leak into logic output');

const snapshot = path.join(ROOT, 'snapshots', '逻辑关系网.svg');
fs.mkdirSync(path.dirname(snapshot), { recursive: true });
fs.writeFileSync(snapshot, svg, 'utf8');
assert.ok(fs.statSync(snapshot).size > 2500, 'logic renderer fixture snapshot should contain nodes, labels and edges');

view.setData({ nodes: data.nodes, edges: data.edges });
assert.equal(view.layout, null, 'omitting payload.layout restores the existing presentation behavior');
assert.ok(view._ticksLeft > 0, 'legacy dense layout should still schedule its normal simulation');
view.destroy();

console.log(JSON.stringify({
  ok: true,
  nodes: data.nodes.length,
  edges: data.edges.length,
  arrowPaths: container.child === null ? 'verified-before-destroy' : container.child.context.calls.quadraticCurveTo,
  relationLabels: ['分为情景', '推导考向', '关联考点', '进入学习', '第一步'],
  snapshot,
  note: 'Snapshot uses a renderer fixture; production forecast data is supplied by the application layer.'
}, null, 2));
