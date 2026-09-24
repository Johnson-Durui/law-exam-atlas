'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const argv = process.argv.slice(2);

function option(name) {
  const inline = argv.find(value => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

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
      type,
      key: '',
      shiftKey: false,
      pointerId: 1,
      clientX: 0,
      clientY: 0,
      deltaY: 0,
      preventDefault() { this.defaultPrevented = true; },
      ...init
    };
    for (const handler of this.listeners.get(type) || []) handler(event);
    return event;
  }
}

function makeContext() {
  const calls = Object.create(null);
  const count = name => { calls[name] = (calls[name] || 0) + 1; };
  const methods = [
    'setTransform', 'fillRect', 'beginPath', 'arc', 'fill', 'stroke',
    'moveTo', 'quadraticCurveTo', 'setLineDash', 'fillText'
  ];
  const context = { calls, measureText: text => ({ width: String(text).length * 6 }) };
  methods.forEach(name => { context[name] = () => count(name); });
  return context;
}

class CanvasStub extends EventTargetStub {
  constructor() {
    super();
    this.style = {};
    this.parentNode = null;
    this.width = 0;
    this.height = 0;
    this.context = makeContext();
    this.attributes = new Map();
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getContext() { return this.context; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 960, height: 640 }; }
  setPointerCapture() {}
}

class ContainerStub {
  constructor() {
    this.clientWidth = 960;
    this.clientHeight = 640;
    this.child = null;
  }
  appendChild(child) { this.child = child; child.parentNode = this; }
  removeChild(child) {
    assert.equal(child, this.child);
    child.parentNode = null;
    this.child = null;
  }
  getBoundingClientRect() { return { width: this.clientWidth, height: this.clientHeight }; }
}

function installDomStub() {
  let rafId = 0;
  const frames = new Map();
  const windowTarget = new EventTargetStub();
  global.window = global;
  global.devicePixelRatio = 2;
  global.addEventListener = windowTarget.addEventListener.bind(windowTarget);
  global.removeEventListener = windowTarget.removeEventListener.bind(windowTarget);
  global.document = { createElement: tag => {
    assert.equal(tag, 'canvas');
    return new CanvasStub();
  } };
  global.ResizeObserver = class {
    constructor(callback) { this.callback = callback; this.disconnected = false; }
    observe() {}
    disconnect() { this.disconnected = true; }
  };
  global.requestAnimationFrame = callback => {
    const id = ++rafId;
    frames.set(id, callback);
    return id;
  };
  global.cancelAnimationFrame = id => frames.delete(id);
  return {
    frames,
    flush(limit = 300) {
      let rounds = 0;
      while (frames.size && rounds < limit) {
        const batch = [...frames.entries()];
        frames.clear();
        batch.forEach(([, callback]) => callback(Date.now()));
        rounds += 1;
      }
      assert.ok(rounds < limit, `RAF did not settle within ${limit} frames`);
      return rounds;
    }
  };
}

function fixture() {
  return {
    nodes: [
      { uuid: 'subject-criminal', name: '刑法', labels: ['Subject'], attributes: { subject: '刑法' } },
      { uuid: 'topic-crime', name: '犯罪构成', labels: ['Topic'], attributes: { subject: '刑法' } },
      { uuid: 'year-2024', name: '2024年', labels: ['Year'], attributes: { subject: '刑法', year: 2024 } },
      { uuid: 'question-1', name: '2024年刑法第1题', labels: ['Question'], attributes: { subject: '刑法', year: 2024 } },
      { uuid: 'type-single', name: '单项选择题', labels: ['Type'], attributes: { subject: '刑法' } },
      { uuid: 'question-1', name: '应被过滤的重复节点', labels: ['Question'] }
    ],
    edges: [
      { uuid: 'edge-topic', source_node_uuid: 'question-1', target_node_uuid: 'topic-crime', name: '考查考点', fact: '考查犯罪构成' },
      { uuid: 'edge-year', source_node_uuid: 'question-1', target_node_uuid: 'year-2024', name: '出题年份' },
      { uuid: 'edge-type', source_node_uuid: 'question-1', target_node_uuid: 'type-single', name: '题型' },
      { uuid: 'edge-auto', source_node_uuid: 'topic-crime', target_node_uuid: 'subject-criminal', name: '自动关联', attributes: { automatic: true } },
      { uuid: 'edge-invalid', source_node_uuid: 'missing', target_node_uuid: 'topic-crime', name: '非法端点' }
    ]
  };
}

function screenPoint(view, node) {
  return {
    x: node.x * view.camera.zoom + view.camera.x,
    y: node.y * view.camera.zoom + view.camera.y
  };
}

function findBlankPoint(view) {
  for (let y = 12; y < view.height; y += 34) {
    for (let x = 12; x < view.width; x += 34) {
      if (!view._hitNode(x, y)) return { x, y };
    }
  }
  throw new Error('Could not find a blank canvas point for pan verification.');
}

function assertNodesVisible(view, nodes, message) {
  for (const node of nodes) {
    const point = screenPoint(view, node);
    const radius = node.r * view.camera.zoom;
    assert.ok(point.x - radius >= -0.01 && point.x + radius <= view.width + 0.01
      && point.y - radius >= -0.01 && point.y + radius <= view.height + 0.01,
    `${message}: ${node.id} at ${point.x.toFixed(1)},${point.y.toFixed(1)}`);
  }
}

function runCoreAssertions(LawGraphView, scheduler) {
  const selections = [];
  const statuses = [];
  const container = new ContainerStub();
  const view = new LawGraphView(container, {
    onSelect: value => selections.push(value),
    onStatus: value => statuses.push(value)
  });
  const data = fixture();
  view.setData(data);
  const layoutFrames = scheduler.flush();

  assert.equal(view.nodes.length, 5, 'duplicate nodes should be filtered');
  assert.equal(view.edges.length, 4, 'dangling edges should be filtered');
  assert.deepEqual(statuses.at(-1), { nodes: 5, edges: 4, zoom: statuses.at(-1).zoom });
  assert.ok(container.child.context.calls.fillRect > 0, 'Canvas should be painted');
  assert.ok(container.child.context.calls.quadraticCurveTo > 0, 'Edges should be painted as curves');
  assert.match(container.child.attributes.get('aria-description'), /方向键.*Home.*N.*E/,
    'Canvas should expose keyboard instructions');
  assert.equal(view._autoFit, false, 'automatic fit should complete when layout settles');
  assertNodesVisible(view, view.nodes.filter(node => node.label !== 'Question'),
    'settled layout should auto-fit every primary node');

  assert.equal(view.select('question-1'), true);
  assert.equal(selections.at(-1).type, 'node');
  assert.equal(selections.at(-1).data, data.nodes[3], 'selection returns original node object');
  assert.equal(view.select('edge-topic'), true);
  assert.equal(selections.at(-1).type, 'edge');
  assert.equal(selections.at(-1).data, data.edges[0], 'selection returns original edge object');
  assert.equal(view.select('does-not-exist'), false);

  let keyboardEvent = container.child.dispatch('keydown', { key: 'N' });
  assert.equal(keyboardEvent.defaultPrevented, true, 'handled keyboard commands should prevent default');
  assert.equal(view.selected.type, 'node');
  assert.equal(view.selected.item, view.nodes[0], 'N should select the first node from an edge selection');
  container.child.dispatch('keydown', { key: 'n' });
  assert.equal(view.selected.item, view.nodes[1], 'N should select the next node');
  container.child.dispatch('keydown', { key: 'N', shiftKey: true });
  assert.equal(view.selected.item, view.nodes[0], 'Shift+N should select the previous node');
  container.child.dispatch('keydown', { key: 'e' });
  assert.equal(view.selected.type, 'edge');
  assert.equal(view.selected.item, view.edges[0], 'E should select the first edge');
  container.child.dispatch('keydown', { key: 'E' });
  assert.equal(view.selected.item, view.edges[1], 'E should select the next edge');
  container.child.dispatch('keydown', { key: 'Enter' });
  assert.equal(view.selected.type, 'node', 'Enter should advance node selection');

  const keyboardPanStart = { x: view.camera.x, y: view.camera.y };
  container.child.dispatch('keydown', { key: 'ArrowLeft' });
  container.child.dispatch('keydown', { key: 'ArrowDown' });
  assert.equal(view.camera.x, keyboardPanStart.x + 35, 'ArrowLeft should pan the graph right');
  assert.equal(view.camera.y, keyboardPanStart.y - 35, 'ArrowDown should pan the graph up');
  const keyboardZoomStart = view.camera.zoom;
  container.child.dispatch('keydown', { key: '+' });
  assert.ok(view.camera.zoom > keyboardZoomStart, '+ should zoom in');
  container.child.dispatch('keydown', { key: '-' });
  assert.ok(view.camera.zoom < keyboardZoomStart * 1.01, '- should zoom out');
  container.child.dispatch('keydown', { key: 'Home' });
  assertNodesVisible(view, view.nodes.filter(node => node.label !== 'Question'),
    'Home should fit every primary node');

  view.setData(data);
  container.child.dispatch('keydown', { key: 'ArrowRight' });
  const cameraAfterUserInput = { ...view.camera };
  assert.equal(view._autoFit, false, 'keyboard interaction should cancel pending automatic fit');
  scheduler.flush();
  assert.deepEqual(view.camera, cameraAfterUserInput,
    'settling layout must not override the camera after user interaction');
  view.fit();

  const svg = view.exportSVG();
  assert.match(svg, /^<svg\b/);
  assert.match(svg, /2024年刑法第1题/);
  assert.match(svg, /stroke-dasharray="5 5"/, 'automatic edges should export as dashed paths');
  assert.ok((svg.match(/<circle /g) || []).length >= 5);

  const zoomBefore = view.camera.zoom;
  const wheel = container.child.dispatch('wheel', { clientX: 480, clientY: 320, deltaY: -180 });
  assert.equal(wheel.defaultPrevented, true);
  assert.ok(view.camera.zoom > zoomBefore, 'wheel should zoom around the pointer');
  scheduler.flush();

  const blank = findBlankPoint(view);
  const cameraBefore = { x: view.camera.x, y: view.camera.y };
  container.child.dispatch('pointerdown', { pointerId: 7, clientX: blank.x, clientY: blank.y });
  container.child.dispatch('pointermove', { pointerId: 7, clientX: blank.x + 37, clientY: blank.y + 23 });
  container.child.dispatch('pointerup', { pointerId: 7, clientX: blank.x + 37, clientY: blank.y + 23 });
  assert.equal(Math.round(view.camera.x - cameraBefore.x), 37, 'empty-canvas drag should pan X');
  assert.equal(Math.round(view.camera.y - cameraBefore.y), 23, 'empty-canvas drag should pan Y');

  const draggedNode = view.nodeById.get('topic-crime');
  const nodeBefore = { x: draggedNode.x, y: draggedNode.y };
  const start = screenPoint(view, draggedNode);
  container.child.dispatch('pointerdown', { pointerId: 8, clientX: start.x, clientY: start.y });
  container.child.dispatch('pointermove', { pointerId: 8, clientX: start.x + 42, clientY: start.y + 18 });
  container.child.dispatch('pointerup', { pointerId: 8, clientX: start.x + 42, clientY: start.y + 18 });
  assert.ok(Math.hypot(draggedNode.x - nodeBefore.x, draggedNode.y - nodeBefore.y) > 5, 'node should be draggable');
  scheduler.flush();

  view.setData({ nodes: [], edges: [] });
  scheduler.flush();
  assert.equal(view.nodes.length, 0);
  assert.equal(view.edges.length, 0);
  assert.match(view.exportSVG(), /^<svg\b/);
  assert.deepEqual(statuses.at(-1), { nodes: 0, edges: 0, zoom: 1 });

  const canvas = container.child;
  view.destroy();
  assert.equal(container.child, null, 'destroy should remove the canvas');
  assert.equal(canvas.parentNode, null);
  assert.equal(scheduler.frames.size, 0, 'destroy should leave no queued animation frame');
  for (const listeners of canvas.listeners.values()) assert.equal(listeners.size, 0, 'destroy should remove event listeners');

  return { layoutFrames, callbacks: selections.length, keyboard: 'ok', autoFit: 'ok', canvasCalls: canvas.context.calls };
}

function maybeExportRealGraph(LawGraphView, scheduler) {
  const requested = option('--data') || process.env.LAW_GRAPH_DATA;
  const defaultGraph = path.join(ROOT, 'data', 'graph.json');
  const source = requested ? path.resolve(requested) : defaultGraph;
  if (!fs.existsSync(source)) return null;
  const graph = JSON.parse(fs.readFileSync(source, 'utf8'));
  assert.ok(Array.isArray(graph.nodes), 'real graph must contain nodes[]');
  assert.ok(Array.isArray(graph.edges), 'real graph must contain edges[]');
  const container = new ContainerStub();
  const view = new LawGraphView(container);
  const started = performance.now();
  view.setData(graph);
  scheduler.flush(500);
  const primaryNodes = view.nodes.filter(node => node.label !== 'Question');
  assertNodesVisible(view, primaryNodes, 'real graph auto-fit should keep every primary node visible');
  const elapsedMs = Math.round(performance.now() - started);
  const output = path.resolve(option('--svg') || process.env.LAW_GRAPH_SVG || path.join(ROOT, 'snapshots', '真实试题关系网.svg'));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, view.exportSVG(), 'utf8');
  const result = {
    source,
    output,
    inputNodes: graph.nodes.length,
    inputEdges: graph.edges.length,
    renderedNodes: view.nodes.length,
    renderedEdges: view.edges.length,
    visiblePrimaryNodes: primaryNodes.length,
    svgBytes: fs.statSync(output).size,
    elapsedMs
  };
  view.destroy();
  return result;
}

const scheduler = installDomStub();
require(path.join(ROOT, 'graph-view.js'));
assert.equal(typeof global.LawGraphView, 'function', 'graph-view.js should expose window.LawGraphView');

const core = runCoreAssertions(global.LawGraphView, scheduler);
const realGraph = maybeExportRealGraph(global.LawGraphView, scheduler);
console.log(JSON.stringify({ ok: true, core, realGraph }, null, 2));
