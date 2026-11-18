/* Unit and virtual-DOM integration checks for quick jump, bookmarks, review progress, and storage fallback. */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');

const ROOT = path.resolve(__dirname, '..');
const graphData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'graph.json'), 'utf8'));
const learningData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'learning.json'), 'utf8'));
const LawGraphModel = require(path.join(ROOT, 'graph-model.js'));
const LawLearningModel = require(path.join(ROOT, 'learning-model.js'));

function makeMemoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
  };
}

function testStorageFallbacks() {
  const examModel = LawGraphModel.create(graphData);

  // 1. Explicit null storage (strict file:// / headless)
  const noStorageModel = LawLearningModel.create(learningData, examModel, { storage: null });
  assert.equal(noStorageModel.progress.stats().persistent, false);
  assert.equal(noStorageModel.progress.toggleBookmark('forecast-cr-01'), true);
  assert.equal(noStorageModel.progress.isBookmarked('forecast-cr-01'), true);
  assert.equal(noStorageModel.progress.stats().forecastBookmarked, 1);

  // 2. Storage that throws SecurityError on every method
  const throwingStorage = {
    getItem() { throw new Error('SecurityError: storage disabled'); },
    setItem() { throw new Error('SecurityError: storage disabled'); },
    removeItem() { throw new Error('SecurityError: storage disabled'); },
  };
  const guardedModel = LawLearningModel.create(learningData, examModel, { storage: throwingStorage });
  assert.equal(guardedModel.progress.stats().persistent, false);
  assert.equal(guardedModel.progress.toggleReviewed('forecast-cv-01'), true);
  assert.equal(guardedModel.progress.isReviewed('forecast-cv-01'), true);

  // 3. Storage that fails mid-session with QuotaExceededError
  let allowWrites = true;
  const quotaStorage = {
    data: {},
    getItem(k) { return Object.prototype.hasOwnProperty.call(this.data, k) ? this.data[k] : null; },
    setItem(k, v) {
      if (!allowWrites) throw new Error('QuotaExceededError');
      this.data[k] = String(v);
    },
    removeItem(k) { delete this.data[k]; },
  };
  const quotaModel = LawLearningModel.create(learningData, examModel, { storage: quotaStorage });
  assert.equal(quotaModel.progress.stats().persistent, true);
  allowWrites = false;
  assert.doesNotThrow(() => quotaModel.progress.toggleBookmark('topic-cr01'));
  assert.equal(quotaModel.progress.isBookmarked('topic-cr01'), true);
  assert.equal(quotaModel.progress.stats().persistent, false);

  // 4. Corrupted JSON in storage should be ignored safely
  const corruptedStorage = makeMemoryStorage({
    [LawLearningModel.STORAGE_KEY]: '{not-valid-json',
  });
  const recovered = LawLearningModel.create(learningData, examModel, { storage: corruptedStorage });
  assert.equal(recovered.progress.stats().totalBookmarked, 0);
  assert.equal(recovered.progress.stats().totalReviewed, 0);
}

function testProgressPersistenceAndFilters() {
  const examModel = LawGraphModel.create(graphData);
  const sharedStorage = makeMemoryStorage();

  const first = LawLearningModel.create(learningData, examModel, { storage: sharedStorage });
  assert.equal(first.progress.stats().persistent, true);
  assert.equal(first.progress.stats().forecastTotal, 20);
  assert.equal(first.progress.stats().topicTotal, 80);

  // Bookmark & review forecasts and topics (including bare topicId normalization)
  first.progress.toggleBookmark('forecast-cr-01');
  first.progress.toggleBookmark('cr04'); // normalizes to topic-cr04
  first.progress.toggleReviewed('forecast-cr-01');
  first.progress.toggleReviewed('forecast-ju-02');
  first.progress.toggleReviewed('topic-cv03');

  // Unknown or prototype keys must be rejected
  assert.equal(first.progress.setBookmark('forecast-unknown-99', true), false);
  assert.equal(first.progress.setReviewed('__proto__', true), false);
  assert.equal(first.progress.setBookmark('', true), false);

  const s1 = first.progress.stats();
  assert.equal(s1.forecastBookmarked, 1);
  assert.equal(s1.topicBookmarked, 1);
  assert.equal(s1.totalBookmarked, 2);
  assert.equal(s1.forecastReviewed, 2);
  assert.equal(s1.topicReviewed, 1);
  assert.equal(s1.totalReviewed, 3);
  assert.equal(first.progress.isBookmarked('topic-cr04'), true);
  assert.equal(first.progress.isBookmarked('cr04'), true);

  // Forecast status filters
  const bookmarkedGraph = first.forecast({ status: 'bookmarked' });
  assert.equal(bookmarkedGraph.nodes.filter(n => n.labels[0] === 'Prediction').length, 1);
  assert.equal(bookmarkedGraph.nodes.find(n => n.labels[0] === 'Prediction').uuid, 'forecast-cr-01');

  const reviewedGraph = first.forecast({ status: 'reviewed' });
  assert.equal(reviewedGraph.nodes.filter(n => n.labels[0] === 'Prediction').length, 2);

  const unreviewedGraph = first.forecast({ status: 'unreviewed' });
  assert.equal(unreviewedGraph.nodes.filter(n => n.labels[0] === 'Prediction').length, 18);

  // Reload from same storage verifies persistence
  const reloaded = LawLearningModel.create(learningData, examModel, { storage: sharedStorage });
  assert.deepEqual(reloaded.progress.stats(), s1);

  // Export & Import JSON (replace + merge + validation)
  const exported = reloaded.progress.exportJSON();
  const parsedExport = JSON.parse(exported);
  assert.equal(parsedExport.app, 'law-exam-atlas');
  assert.equal(parsedExport.version, 1);

  const fresh = LawLearningModel.create(learningData, examModel, { storage: null });
  fresh.progress.toggleBookmark('forecast-lh-01');
  fresh.progress.importJSON(exported, { merge: false });
  assert.equal(fresh.progress.isBookmarked('forecast-lh-01'), false);
  assert.equal(fresh.progress.isBookmarked('forecast-cr-01'), true);
  assert.equal(fresh.progress.isReviewed('forecast-ju-02'), true);

  fresh.progress.importJSON(JSON.stringify({
    bookmarked: ['forecast-lh-04', 'invalid-id'],
    reviewed: ['forecast-co-01'],
  }), { merge: true });
  assert.equal(fresh.progress.isBookmarked('forecast-cr-01'), true);
  assert.equal(fresh.progress.isBookmarked('forecast-lh-04'), true);
  assert.equal(fresh.progress.stats().forecastReviewed, 3);

  assert.throws(() => fresh.progress.importJSON('not json'), /JSON/);
  assert.throws(() => fresh.progress.importJSON('{}'), /bookmarked|reviewed/);
}

function testQuickSearch() {
  const examModel = LawGraphModel.create(graphData);
  const learning = LawLearningModel.create(learningData, examModel, { storage: null });

  const t0 = performance.now();
  const defaultList = learning.quickSearch('');
  assert.ok(defaultList.length > 0 && defaultList.length <= 18);

  // Exact hash / ID jump
  const byHash = learning.quickSearch('#forecast-cr-01');
  assert.equal(byHash[0].id, 'forecast-cr-01');
  assert.equal(byHash[0].kind, 'Prediction');

  const byTopicCode = learning.quickSearch('cr04');
  assert.equal(byTopicCode[0].id, 'topic-cr04');
  assert.equal(byTopicCode[0].title, '正当防卫');

  // Exact/substring concept search
  const byConcept = learning.quickSearch('正当防卫');
  assert.equal(byConcept[0].id, 'topic-cr04');

  // Keyword inside topic vocabulary
  const byKeyword = learning.quickSearch('善意取得');
  assert.ok(byKeyword.some(item => item.id === 'topic-cv04'), 'keyword search should find 物权变动与公示');

  // Fuzzy subsequence search
  const fuzzyDefense = learning.quickSearch('正防');
  assert.ok(fuzzyDefense.some(item => item.id === 'topic-cr04'), 'fuzzy subsequence 正防 should match 正当防卫');

  const fuzzyAgency = learning.quickSearch('表代');
  assert.ok(fuzzyAgency.some(item => item.id === 'topic-cv03'), 'fuzzy subsequence 表代 should match 表见代理 -> 代理制度');

  // Subject pathway search
  const routeHits = learning.quickSearch('刑法 审题路线');
  assert.equal(routeHits[0].id, 'path-cr');
  assert.equal(routeHits[0].kind, 'Pathway');

  // Past question ID and multi-token search
  const qHits = learning.quickSearch('q-2025-base-57');
  assert.equal(qHits[0].id, 'q-2025-base-57');
  assert.equal(qHits[0].kind, 'Question');

  const elapsedMs = performance.now() - t0;
  assert.ok(elapsedMs < 250, `quickSearch batch should complete rapidly, took ${elapsedMs.toFixed(1)}ms`);
}

function testAppDomIntegration() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  class Element {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.listeners = {};
      this.attributes = {};
      this.dataset = {};
      this.style = {};
      this.hidden = false;
      this.disabled = false;
      this.value = '';
      this.className = '';
      this._text = '';
    }
    set textContent(value) { this._text = String(value); this.children = []; }
    get textContent() { return this._text + this.children.map(x => x.textContent || '').join(''); }
    get firstChild() { return this.children[0] || null; }
    setAttribute(k, v) { this.attributes[k] = String(v); }
    removeAttribute(k) { delete this.attributes[k]; }
    append(...nodes) { nodes.forEach(n => { this.children.push(n); n.parent = this; }); }
    replaceChildren(...nodes) { this.children = []; this._text = ''; this.append(...nodes); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this); }
    addEventListener(k, f) { (this.listeners[k] ??= []).push(f); }
    fire(k, event = {}) { for (const f of this.listeners[k] || []) f({ target: this, ...event }); }
    click() { this.fire('click'); }
    showModal() { this.open = true; }
    close() { this.open = false; }
    focus() { this.focused = true; }
  }
  const allElements = n => [n, ...n.children.flatMap(allElements)];

  const ids = {};
  for (const m of html.matchAll(/<([a-z][\w-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const e = new Element(m[1]);
    e.hidden = /\bhidden\b/.test(m[2]);
    e.className = (m[2].match(/\bclass="([^"]*)"/) || [])[1] || '';
    ids[m[3]] = e;
  }
  ids.workspace.dataset.mode = 'split';
  const modes = ['graph', 'split', 'list'].map(m => { const e = new Element('button'); e.dataset.mode = m; return e; });
  const relations = ['候选考点', '科目', '年份', '题型'].map((r, i) => { const e = new Element('input'); e.dataset.relation = r; e.checked = i < 2; return e; });
  const docListeners = {};
  let view;
  class View {
    constructor(host, opts) { assert(host); this.opts = opts; view = this; }
    setData(data) { this.data = data; this.opts.onStatus({ nodes: data.nodes.length, edges: data.edges.length, zoom: 1 }); }
    setLabels(v) { this.labels = v; }
    select(id) {
      const n = this.data.nodes.find(x => x.uuid === id);
      const e = this.data.edges.find(x => x.uuid === id);
      if (!n && !e) return false;
      this.opts.onSelect({ type: n ? 'node' : 'edge', data: n || e });
      return true;
    }
    fit() {}
    destroy() {}
    exportSVG() { return '<svg/>'; }
  }
  const storage = makeMemoryStorage();
  const document = {
    getElementById: id => ids[id] || null,
    createElement: tag => new Element(tag),
    querySelectorAll: q => q === 'button[data-mode]' ? modes : q === '[data-mode]' ? [ids.workspace, ...modes] : q === '[data-relation]:checked' ? relations.filter(x => x.checked) : q === '[data-relation]' ? relations : [],
    addEventListener(k, fn) { (docListeners[k] ??= []).push(fn); },
  };
  const location = { protocol: 'file:', hash: '', pathname: '/index.html' };
  const history = { replaceState(_s, _t, url) { location.hash = String(url).startsWith('#') ? String(url) : ''; } };
  const context = {
    window: null,
    document,
    location,
    history,
    localStorage: storage,
    LawGraphView: View,
    LawGraphModel,
    LawLearningModel,
    LAW_GRAPH: graphData,
    LAW_LEARNING_DATA: learningData,
    addEventListener() {},
    requestAnimationFrame(fn) { fn(); return 1; },
    setTimeout() { return 1; },
    clearTimeout() {},
    Blob,
    URL,
    console,
  };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8'), context, { filename: 'app.js' });

  // Verify '/' shortcut opens quick-jump dialog
  for (const fn of docListeners.keydown || []) {
    fn({ key: '/', target: { tagName: 'BODY' }, preventDefault() {} });
  }
  assert.equal(ids['quick-jump-dialog'].open, true);
  assert.equal(ids['quick-jump-input'].focused, true);

  // Type '正当防卫' and press Enter to jump straight to topic-cr04 in exams layer
  ids['quick-jump-input'].value = '正当防卫';
  ids['quick-jump-input'].fire('input');
  assert.ok(ids['quick-jump-list'].children.length > 0);
  ids['quick-jump-input'].fire('keydown', { key: 'Enter', preventDefault() {} });
  assert.equal(ids['quick-jump-dialog'].open, false);
  assert.equal(ids.workspace.dataset.layer, 'exams');
  assert.ok(ids['detail-content'].textContent.includes('正当防卫'));

  // Bookmark topic-cr04 right from its detail panel
  const topicBookmarkBtn = allElements(ids['detail-content']).find(n => n.dataset && n.dataset.studyAction === 'bookmark');
  assert.ok(topicBookmarkBtn, 'topic detail should expose bookmark button');
  topicBookmarkBtn.click();
  assert.equal(topicBookmarkBtn.attributes['aria-pressed'], 'true');
  assert.ok(ids['progress-button'].textContent.includes('★1'));

  // Jump via Ctrl+K to forecast-cr-01
  for (const fn of docListeners.keydown || []) {
    fn({ key: 'k', ctrlKey: true, target: { tagName: 'INPUT' }, preventDefault() {} });
  }
  assert.equal(ids['quick-jump-dialog'].open, true);
  ids['quick-jump-input'].value = 'forecast-cr-01';
  ids['quick-jump-input'].fire('input');
  ids['quick-jump-input'].fire('keydown', { key: 'Enter', preventDefault() {} });
  assert.equal(ids.workspace.dataset.layer, 'forecast');
  assert.equal(location.hash, '#forecast-cr-01');

  // Bookmark & mark reviewed on forecast-cr-01
  const predBookmarkBtn = allElements(ids['detail-content']).find(n => n.dataset && n.dataset.studyAction === 'bookmark');
  const predReviewBtn = allElements(ids['detail-content']).find(n => n.dataset && n.dataset.studyAction === 'review');
  assert.ok(predBookmarkBtn && predReviewBtn);
  predBookmarkBtn.click();
  predReviewBtn.click();
  assert.ok(ids['progress-button'].textContent.includes('已复盘 1/20'));
  assert.ok(ids['progress-button'].textContent.includes('★2'));

  // Return to overview and filter by bookmarked in workbench
  ids['study-back'].click();
  ids['study-status'].value = 'bookmarked';
  ids['study-status'].fire('change');
  assert.equal(ids['catalog-list'].children.length, 1);
  assert.ok(ids['catalog-list'].textContent.includes('★ 重点收藏'));

  // Export, clear, and re-import via LawAtlasApp
  ids['progress-button'].click();
  assert.equal(ids['progress-dialog'].open, true);
  const backup = context.LawAtlasApp.exportProgressJSON();
  ids['clear-progress'].click();
  assert.equal(ids['progress-button'].textContent, '已复盘 0/20');
  assert.equal(context.LawAtlasApp.importProgressText(backup), true);
  assert.ok(ids['progress-button'].textContent.includes('已复盘 1/20'));
}

testStorageFallbacks();
testProgressPersistenceAndFilters();
testQuickSearch();
testAppDomIntegration();

console.log(JSON.stringify({
  ok: true,
  checks: [
    'storage-null-fallback',
    'storage-security-error-fallback',
    'storage-quota-fallback',
    'storage-corrupted-json-recovery',
    'bookmark-and-review-counts',
    'forecast-status-filter',
    'export-import-json',
    'quick-search-exact-fuzzy-route-question',
    'app-dom-shortcuts-and-progress-dialog',
  ],
}, null, 2));
