/*
 * LawGraphView - offline Canvas knowledge-graph renderer.
 * Data contract follows the public MiroFish graph payload shape, but this
 * renderer is an independent clean-room implementation and contains no
 * copied MiroFish source code.
 */
(function (global) {
  'use strict';

  const SUBJECT_COLORS = {
    '刑法': '#bb633d',
    '民法': '#345c99',
    '法理学': '#6c658e',
    '宪法学': '#747780',
    '法制史': '#9a6479',
    '综合': '#66727a'
  };
  const LABEL_COLORS = {
    Subject: '#f06f43', Topic: '#174f7d', Year: '#6f638d',
    Question: '#536069', Type: '#9b765b', Entity: '#65737b',
    Forecast: '#182f44', Scenario: '#69717a', Prediction: '#e56f3f',
    Step: '#1d4f78', Pathway: '#4e5d6a'
  };
  const LABEL_RADII = {
    Subject: 8, Topic: 5.2, Year: 6.2, Question: 2.25, Type: 4.5, Entity: 3.5,
    Forecast: 10, Scenario: 7, Prediction: 7.5, Step: 6.5, Pathway: 7
  };
  const TAU = Math.PI * 2;

  function hash(text) {
    let h = 2166136261;
    const value = String(text || '');
    for (let i = 0; i < value.length; i += 1) {
      h ^= value.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function firstLabel(node) {
    const labels = Array.isArray(node.labels) ? node.labels : [];
    return labels.find(label => LABEL_RADII[label]) || labels[0] || 'Entity';
  }
  function subjectOf(node) {
    const attrs = node.attributes && typeof node.attributes === 'object' ? node.attributes : {};
    return attrs.subject || attrs.discipline || (firstLabel(node) === 'Subject' ? node.name : '') || '综合';
  }
  function relationIsInferred(edge) {
    const a = edge.attributes && typeof edge.attributes === 'object' ? edge.attributes : {};
    return Boolean(a.inferred || a.automatic || a.auto || a.historical || a.predicted ||
      /推断|自动|历史|预测|inferred|auto|historic|predict/i.test(`${edge.name || ''} ${edge.fact_type || ''}`));
  }

  function denseQuestionLabel(node) {
    const attrs = node && node.attributes && typeof node.attributes === 'object' ? node.attributes : {};
    let value = String((node && (node.summary || node.text)) || attrs.text || attrs.question || (node && node.name) || '');
    value = value
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^\s*[•·▪‣◦]\s*/, '')
      .replace(/^\s*(?:第\s*)?[（(]?\d{1,3}[）)]?\s*[、.．:：)）-]?\s*/, '')
      .replace(/^\s*\d{4}\s*年[^·。；;]{0,16}[·:：]\s*/, '')
      .replace(/^\s*[A-DＡ-Ｄ]\s*[.．、:：]\s*/i, '')
      .trim();
    const han = (value.match(/[\u3400-\u9fff]/g) || []).length;
    const latin = (value.match(/[A-Za-z]/g) || []).length;
    const suspicious = /�|\u0000/.test(value) || (value.length > 12 && (han / value.length < 0.2 || latin > han * 1.5));
    if (suspicious) return `${String((node && node.name) || '真题').replace(/\s+/g, ' ').trim()} · 待核对`;
    if (!value) value = String((node && node.name) || '真题');
    const chars = Array.from(value);
    return chars.length > 18 ? `${chars.slice(0, 18).join('')}…` : chars.join('');
  }

  class LawGraphView {
    constructor(container, options = {}) {
      if (!container || typeof container.appendChild !== 'function') {
        throw new TypeError('LawGraphView requires a DOM container element.');
      }
      this.container = container;
      this.options = options || {};
      this.presentation = options.presentation === 'dense' ? 'dense' : 'default';
      this.onSelect = typeof options.onSelect === 'function' ? options.onSelect : function () {};
      this.onStatus = typeof options.onStatus === 'function' ? options.onStatus : function () {};
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'law-graph-view';
      this.canvas.tabIndex = 0;
      this.canvas.setAttribute('role', 'application');
      this.canvas.setAttribute('aria-label', '法硕真题知识关系网');
      this.canvas.setAttribute('aria-description', '方向键平移，加减号缩放，Home适配，N选择下一个节点，Shift加N上一个节点，E选择下一条关系。也可切换题库视图浏览。');
      Object.assign(this.canvas.style, {
        display: 'block', width: '100%', height: '100%', touchAction: 'none',
        userSelect: 'none', cursor: 'grab'
      });
      this.container.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d', { alpha: false, desynchronized: true });
      this.nodes = [];
      this.edges = [];
      this.nodeById = new Map();
      this.edgeById = new Map();
      this.incident = new Map();
      this.selected = null;
      this.showLabels = true;
      this.camera = { x: 0, y: 0, zoom: 1 };
      this.width = 1;
      this.height = 1;
      this.dpr = 1;
      this._dirty = true;
      this._destroyed = false;
      this._frame = 0;
      this._ticksLeft = 0;
      this._listeners = [];
      this._pointer = null;
      this._hover = null;
      this._denseLabelRegions = [];
      this._denseLabelCamera = '';
      this._logicLabelRegions = [];
      this._logicLabelCamera = '';
      this.layout = null;
      this._lastStatus = '';
      this._bindEvents();
      this._resize();
      if (typeof ResizeObserver === 'function') {
        this._resizeObserver = new ResizeObserver(() => this._resize());
        this._resizeObserver.observe(container);
      } else {
        this._listen(global, 'resize', () => this._resize(), { passive: true });
      }
      this._requestFrame();
    }

    setData(payload) {
      const rawNodes = payload && Array.isArray(payload.nodes) ? payload.nodes : [];
      const rawEdges = payload && Array.isArray(payload.edges) ? payload.edges : [];
      this.layout = payload && payload.layout === 'logic' ? 'logic' : null;
      const seen = new Set();
      const subjects = [];
      this.nodes = [];
      this.edges = [];
      this.nodeById.clear();
      this.edgeById.clear();
      this.incident.clear();

      rawNodes.forEach((original, index) => {
        if (!original || original.uuid == null) return;
        const id = String(original.uuid).trim();
        if (!id || seen.has(id)) return;
        seen.add(id);
        const label = firstLabel(original);
        const subject = subjectOf(original);
        if (subject && !subjects.includes(subject)) subjects.push(subject);
        const seed = hash(id);
        const dense = this.presentation === 'dense' && this.layout !== 'logic';
        const denseRadius = label === 'Question' ? 1.3 : label === 'Subject' ? 4.8 : label === 'Topic' ? 3 : label === 'Year' ? 3.7 : 2.8;
        const subjectColor = SUBJECT_COLORS[subject] || LABEL_COLORS[label] || LABEL_COLORS.Entity;
        const internal = {
          id, original, index, label, subject,
          name: String(original.name || original.title || id),
          displayName: dense && label === 'Question' ? denseQuestionLabel(original) : String(original.name || original.title || id),
          x: 0, y: 0, vx: 0, vy: 0,
          r: dense ? denseRadius : (LABEL_RADII[label] || LABEL_RADII.Entity),
          color: dense && label === 'Question' && seed % 6 !== 0 ? '#26343c' : subjectColor,
          fixed: false
        };
        this.nodes.push(internal);
        this.nodeById.set(id, internal);
        this.incident.set(id, []);
        internal._seed = seed;
      });

      if (this.layout === 'logic') {
        this.nodes.forEach((node, index) => {
          const attrs = node.original && node.original.attributes && typeof node.original.attributes === 'object'
            ? node.original.attributes : {};
          const point = attrs.layout && typeof attrs.layout === 'object' ? attrs.layout : {};
          const column = index % 5;
          const row = Math.floor(index / 5);
          node.x = Number.isFinite(Number(point.x)) ? Number(point.x) : column * 230;
          node.y = Number.isFinite(Number(point.y)) ? Number(point.y) : row * 120;
          node.cx = node.x; node.cy = node.y; node.vx = 0; node.vy = 0;
          node.r = LABEL_RADII[node.label] || LABEL_RADII.Entity;
          node.color = node.label === 'Topic'
            ? (SUBJECT_COLORS[node.subject] || LABEL_COLORS.Topic)
            : (LABEL_COLORS[node.label] || LABEL_COLORS.Entity);
        });
      } else if (this.presentation === 'dense') {
        this._initDenseLayout();
      } else {
        const clusterNames = subjects.length ? subjects : ['综合'];
        const centers = new Map();
        const orbit = Math.max(180, 75 * Math.sqrt(clusterNames.length));
        clusterNames.forEach((name, i) => {
          const angle = (i / clusterNames.length) * TAU - Math.PI / 2;
          centers.set(name, { x: Math.cos(angle) * orbit, y: Math.sin(angle) * orbit });
        });
        this.nodes.forEach(node => {
          const center = centers.get(node.subject) || centers.get('综合') || { x: 0, y: 0 };
          const angle = ((node._seed % 10000) / 10000) * TAU;
          const ring = 24 + (((node._seed >>> 8) % 1000) / 1000) * 210;
          const hierarchy = node.label === 'Subject' ? 0.08 : node.label === 'Topic' ? 0.48 : node.label === 'Year' ? 0.68 : 1;
          node.cx = center.x;
          node.cy = center.y;
          node.x = center.x + Math.cos(angle) * ring * hierarchy;
          node.y = center.y + Math.sin(angle) * ring * hierarchy;
        });
      }

      const pairCounts = new Map();
      rawEdges.forEach((original, index) => {
        if (!original) return;
        const sourceId = String(original.source_node_uuid == null ? '' : original.source_node_uuid).trim();
        const targetId = String(original.target_node_uuid == null ? '' : original.target_node_uuid).trim();
        const source = this.nodeById.get(sourceId);
        const target = this.nodeById.get(targetId);
        if (!source || !target) return;
        let id = String(original.uuid == null ? `edge-${index}` : original.uuid).trim() || `edge-${index}`;
        if (this.edgeById.has(id)) id = `${id}-${index}`;
        const pairKey = sourceId < targetId ? `${sourceId}\u0000${targetId}` : `${targetId}\u0000${sourceId}`;
        const parallel = pairCounts.get(pairKey) || 0;
        pairCounts.set(pairKey, parallel + 1);
        const edge = { id, original, source, target, parallel, pairKey, inferred: relationIsInferred(original) };
        this.edges.push(edge);
        this.edgeById.set(id, edge);
        this.incident.get(sourceId).push(edge);
        if (sourceId !== targetId) this.incident.get(targetId).push(edge);
      });
      const totals = new Map();
      this.edges.forEach(edge => totals.set(edge.pairKey, (totals.get(edge.pairKey) || 0) + 1));
      this.edges.forEach(edge => { edge.curve = edge.parallel - ((totals.get(edge.pairKey) || 1) - 1) / 2; });

      this.selected = null;
      this._hover = null;
      this._denseLabelRegions = [];
      this._denseLabelCamera = '';
      this._logicLabelRegions = [];
      this._logicLabelCamera = '';
      this._autoFit = true;
      this._ticksLeft = this.layout === 'logic' ? 0 : this.presentation === 'dense'
        ? (this.nodes.length > 700 ? 54 : 80)
        : (this.nodes.length > 1800 ? 75 : this.nodes.length > 700 ? 120 : 190);
      this._denseTickTotal = this._ticksLeft;
      for (let i = 0; i < Math.min(6, this._ticksLeft); i += 1) this._tickLayout();
      this.fit();
      this._emitStatus(true);
      this._requestFrame();
      return this;
    }

    select(id) {
      const key = String(id == null ? '' : id);
      let item = this.nodeById.get(key);
      if (item) {
        this.selected = { type: 'node', item };
        this._safeCall(this.onSelect, { type: 'node', data: item.original });
      } else {
        item = this.edgeById.get(key);
        if (!item) return false;
        this.selected = { type: 'edge', item };
        this._safeCall(this.onSelect, { type: 'edge', data: item.original });
      }
      this._dirty = true;
      this._requestFrame();
      return true;
    }

    reset() {
      this.selected = null;
      this._hover = null;
      this.fit();
      return this;
    }

    fit() {
      if (!this.nodes.length) {
        this.camera = { x: this.width / 2, y: this.height / 2, zoom: 1 };
      } else if (this.layout === 'logic') {
        this._fitLogic();
      } else {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        this.nodes.forEach(node => {
          minX = Math.min(minX, node.x - node.r); minY = Math.min(minY, node.y - node.r);
          maxX = Math.max(maxX, node.x + node.r); maxY = Math.max(maxY, node.y + node.r);
        });
        const graphWidth = Math.max(1, maxX - minX);
        const graphHeight = Math.max(1, maxY - minY);
        const zoom = clamp(Math.min((this.width - 80) / graphWidth, (this.height - 80) / graphHeight), 0.08, 3.5);
        this.camera.zoom = zoom;
        this.camera.x = this.width / 2 - ((minX + maxX) / 2) * zoom;
        this.camera.y = this.height / 2 - ((minY + maxY) / 2) * zoom;
      }
      this._dirty = true;
      this._emitStatus(true);
      this._requestFrame();
      return this;
    }

    _fitLogic() {
      const margin = 34;
      const boundsAt = zoom => {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        this.nodes.forEach(node => {
          const label = this._logicLabelLayout(node, zoom, 0, 0);
          minX = Math.min(minX, (node.x - node.r) * zoom, label.l);
          maxX = Math.max(maxX, (node.x + node.r) * zoom, label.r);
          minY = Math.min(minY, (node.y - node.r) * zoom, label.t);
          maxY = Math.max(maxY, (node.y + node.r) * zoom, label.b);
        });
        return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
      };
      const availableWidth = Math.max(1, this.width - margin * 2);
      const availableHeight = Math.max(1, this.height - margin * 2);
      let low = 0.04, high = 3.5;
      for (let i = 0; i < 42; i += 1) {
        const mid = (low + high) / 2;
        const bounds = boundsAt(mid);
        if (bounds.width <= availableWidth && bounds.height <= availableHeight) low = mid;
        else high = mid;
      }
      const zoom = clamp(this.width < 520 ? Math.max(low, 0.55) : low, 0.04, 3.5);
      const bounds = boundsAt(zoom);
      this.camera.zoom = zoom;
      this.camera.x = this.width / 2 - (bounds.minX + bounds.maxX) / 2;
      this.camera.y = this.height / 2 - (bounds.minY + bounds.maxY) / 2;
    }

    setLabels(value) {
      this.showLabels = Boolean(value);
      this._dirty = true;
      this._requestFrame();
      return this;
    }

    exportSVG() {
      const width = Math.max(1, Math.round(this.width));
      const height = Math.max(1, Math.round(this.height));
      const camera = this.camera;
      const selected = this._selectionSets();
      const visibleLabels = new Set(this._labelNodes(selected).map(n => n.id));
      const logic = this.layout === 'logic';
      const dense = this.presentation === 'dense' && !logic;
      const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`];
      if (logic) {
        parts.push('<defs><marker id="logic-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#66717a"/></marker></defs>');
        parts.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`);
      } else if (dense) {
        parts.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`);
      } else {
        parts.push('<defs><pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.8" fill="#d9dee1"/></pattern></defs>');
        parts.push(`<rect width="${width}" height="${height}" fill="#fbfcfc"/><rect width="${width}" height="${height}" fill="url(#dots)"/>`);
      }
      parts.push(`<g transform="translate(${camera.x.toFixed(3)} ${camera.y.toFixed(3)}) scale(${camera.zoom.toFixed(5)})">`);
      this.edges.forEach(edge => {
        const geometry = this._edgeGeometry(edge);
        const active = !selected.active || selected.edges.has(edge.id);
        const stroke = selected.active && active ? '#ef744a' : (dense ? '#aeb7bb' : '#9ba6ab');
        const opacity = selected.active ? (active ? 0.82 : (dense ? 0.025 : logic ? 0.28 : 0.075)) : (dense ? 0.12 : 0.26);
        const dash = edge.inferred ? ' stroke-dasharray="5 5"' : '';
        const widthValue = dense ? (active ? 0.78 : 0.42) : (active ? 1.2 : 0.65);
        const marker = logic && !geometry.loop ? ' marker-end="url(#logic-arrow)"' : '';
        parts.push(`<path d="${geometry.svg}" fill="none" stroke="${stroke}" stroke-width="${widthValue / camera.zoom}" opacity="${opacity}"${dash}${marker}/>`);
        if (logic && this._logicEdgeLabelVisible(edge, selected)) {
          const point = this._edgeLabelPoint(geometry);
          const name = this._logicEdgeText(edge);
          parts.push(`<text x="${point.x.toFixed(2)}" y="${point.y.toFixed(2)}" text-anchor="middle" font-family="Arial,'Microsoft YaHei',sans-serif" font-size="${10.5 / camera.zoom}" fill="#66717a" opacity="${active ? 0.9 : 0.16}">${esc(name)}</text>`);
        }
      });
      this.nodes.forEach(node => {
        const active = !selected.active || selected.nodes.has(node.id);
        const opacity = selected.active ? (active ? 1 : (dense ? 0.09 : logic ? 0.68 : 0.15)) : (dense ? 0.9 : 0.94);
        parts.push(`<circle cx="${node.x.toFixed(2)}" cy="${node.y.toFixed(2)}" r="${node.r}" fill="${node.color}" opacity="${opacity}"/>`);
        if (this.showLabels && visibleLabels.has(node.id)) {
          const labelSize = logic ? 13.5 : dense ? 5.8 : 10;
          const labelOpacity = selected.active ? (active ? 0.96 : logic ? 0.72 : 0.04) : (dense ? 0.82 : opacity);
          if (logic) {
            const label = this._logicLabelLayout(node);
            label.lines.forEach((line, index) => {
              const worldX = (label.x - camera.x) / camera.zoom;
              const worldY = (label.lineY(index) - camera.y) / camera.zoom;
              const weight = this.selected && this.selected.type === 'node' && this.selected.item === node ? ' font-weight="600"' : '';
              parts.push(`<text x="${worldX.toFixed(2)}" y="${worldY.toFixed(2)}" font-family="Arial,'Microsoft YaHei',sans-serif" font-size="${labelSize / camera.zoom}" fill="#26343c" opacity="${labelOpacity}"${weight}>${esc(line)}</text>`);
            });
          } else {
            parts.push(`<text x="${(node.x + node.r + (dense ? 2.2 : 4) / camera.zoom).toFixed(2)}" y="${(node.y + 2.5 / camera.zoom).toFixed(2)}" font-family="Arial,'Microsoft YaHei',sans-serif" font-size="${labelSize / camera.zoom}" fill="${dense ? '#36434a' : '#4d585e'}" opacity="${labelOpacity}">${esc(node.displayName || node.name)}</text>`);
          }
        }
      });
      parts.push('</g></svg>');
      return parts.join('');
    }

    destroy() {
      if (this._destroyed) return;
      this._destroyed = true;
      if (this._frame) cancelAnimationFrame(this._frame);
      if (this._resizeObserver) this._resizeObserver.disconnect();
      this._listeners.forEach(entry => entry.target.removeEventListener(entry.type, entry.handler, entry.options));
      this._listeners.length = 0;
      if (this.canvas.parentNode === this.container) this.container.removeChild(this.canvas);
      this.nodes.length = 0;
      this.edges.length = 0;
      this.nodeById.clear();
      this.edgeById.clear();
    }

    _listen(target, type, handler, options) {
      target.addEventListener(type, handler, options);
      this._listeners.push({ target, type, handler, options });
    }

    _bindEvents() {
      this._listen(this.canvas, 'keydown', event => {
        const key = event.key.toLowerCase();
        if (!['arrowleft','arrowright','arrowup','arrowdown','+','=','-','home','n','e','enter'].includes(key)) return;
        event.preventDefault(); this._autoFit = false;
        if (key === 'home') { this.fit(); return; }
        if (key === 'n' || key === 'e' || key === 'enter') {
          const items = key === 'e' ? this.edges : this.nodes;
          if (!items.length) return;
          const current = this.selected ? items.indexOf(this.selected.item) : -1;
          const index = (current + (event.shiftKey ? -1 : 1) + items.length) % items.length;
          this.select(items[index].id); return;
        }
        if (key.startsWith('arrow')) {
          this.camera.x += key === 'arrowleft' ? 35 : key === 'arrowright' ? -35 : 0;
          this.camera.y += key === 'arrowup' ? 35 : key === 'arrowdown' ? -35 : 0;
        } else {
          const before = this._screenToWorld(this.width/2, this.height/2);
          this.camera.zoom = clamp(this.camera.zoom * (key === '-' ? 0.85 : 1.18), 0.06, 6);
          this.camera.x = this.width/2 - before.x * this.camera.zoom;
          this.camera.y = this.height/2 - before.y * this.camera.zoom;
        }
        this._dirty = true; this._emitStatus(false); this._requestFrame();
      });
      this._listen(this.canvas, 'pointerdown', event => {
        this._autoFit = false;
        const point = this._eventPoint(event);
        const node = this._hitNode(point.x, point.y);
        this.canvas.setPointerCapture(event.pointerId);
        this._pointer = {
          id: event.pointerId, startX: point.x, startY: point.y,
          lastX: point.x, lastY: point.y, moved: false, node
        };
        if (node) {
          node.fixed = true;
          this.canvas.style.cursor = 'grabbing';
        } else {
          this.canvas.style.cursor = 'grabbing';
        }
      });
      this._listen(this.canvas, 'pointermove', event => {
        const point = this._eventPoint(event);
        if (this._pointer && this._pointer.id === event.pointerId) {
          const p = this._pointer;
          const dx = point.x - p.lastX;
          const dy = point.y - p.lastY;
          if (Math.hypot(point.x - p.startX, point.y - p.startY) > 3) p.moved = true;
          if (p.node) {
            const world = this._screenToWorld(point.x, point.y);
            p.node.x = world.x; p.node.y = world.y; p.node.vx = 0; p.node.vy = 0;
            if (this.layout !== 'logic') this._ticksLeft = Math.max(this._ticksLeft, 24);
          } else {
            this.camera.x += dx; this.camera.y += dy;
          }
          p.lastX = point.x; p.lastY = point.y;
          this._dirty = true;
          this._requestFrame();
          return;
        }
        const hover = this._hitNode(point.x, point.y);
        if (hover !== this._hover) {
          this._hover = hover;
          this.canvas.style.cursor = hover ? 'pointer' : 'grab';
          this._dirty = true;
          this._requestFrame();
        }
      });
      const release = event => {
        if (!this._pointer || this._pointer.id !== event.pointerId) return;
        const p = this._pointer;
        const point = this._eventPoint(event);
        if (p.node) p.node.fixed = false;
        if (!p.moved) {
          const node = this._hitNode(point.x, point.y);
          if (node) this.select(node.id);
          else {
            const edge = this._hitEdge(point.x, point.y);
            if (edge) this.select(edge.id);
            else { this.selected = null; this._dirty = true; }
          }
        }
        this._pointer = null;
        this.canvas.style.cursor = this._hover ? 'pointer' : 'grab';
        this._requestFrame();
      };
      this._listen(this.canvas, 'pointerup', release);
      this._listen(this.canvas, 'pointercancel', release);
      this._listen(this.canvas, 'wheel', event => {
        this._autoFit = false;
        event.preventDefault();
        const point = this._eventPoint(event);
        const before = this._screenToWorld(point.x, point.y);
        const factor = Math.exp(-event.deltaY * 0.0012);
        this.camera.zoom = clamp(this.camera.zoom * factor, 0.06, 6);
        this.camera.x = point.x - before.x * this.camera.zoom;
        this.camera.y = point.y - before.y * this.camera.zoom;
        this._dirty = true;
        this._emitStatus(false);
        this._requestFrame();
      }, { passive: false });
      this._listen(this.canvas, 'dblclick', event => {
        if (!this._hitNode(this._eventPoint(event).x, this._eventPoint(event).y)) this.fit();
      });
    }

    _eventPoint(event) {
      const rect = this.canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }
    _screenToWorld(x, y) {
      return { x: (x - this.camera.x) / this.camera.zoom, y: (y - this.camera.y) / this.camera.zoom };
    }

    _resize() {
      if (this._destroyed) return;
      const rect = this.container.getBoundingClientRect();
      const oldWidth = this.width;
      const oldHeight = this.height;
      this.width = Math.max(1, rect.width || this.container.clientWidth || 1);
      this.height = Math.max(1, rect.height || this.container.clientHeight || 1);
      this.dpr = clamp(global.devicePixelRatio || 1, 1, 2.5);
      this.canvas.width = Math.round(this.width * this.dpr);
      this.canvas.height = Math.round(this.height * this.dpr);
      if (oldWidth > 1 && oldHeight > 1) {
        this.camera.x += (this.width - oldWidth) / 2;
        this.camera.y += (this.height - oldHeight) / 2;
      } else {
        this.camera.x = this.width / 2;
        this.camera.y = this.height / 2;
      }
      this._dirty = true;
      this._requestFrame();
    }

    _requestFrame() {
      if (!this._frame && !this._destroyed) this._frame = requestAnimationFrame(() => this._animate());
    }

    _animate() {
      this._frame = 0;
      if (this._destroyed) return;
      if (this._ticksLeft > 0) {
        const rounds = this.nodes.length < 650 ? 2 : 1;
        for (let i = 0; i < rounds && this._ticksLeft > 0; i += 1) this._tickLayout();
        if (this._ticksLeft === 0 && this._autoFit) { this._autoFit = false; this.fit(); }
        this._dirty = true;
      }
      if (this._dirty) {
        this._draw();
        this._dirty = false;
      }
      if (this._ticksLeft > 0) this._requestFrame();
    }

    _initDenseLayout() {
      const questions = this.nodes.filter(node => node.label === 'Question');
      const primary = this.nodes.filter(node => node.label !== 'Question');
      const radiusX = Math.max(760, Math.sqrt(Math.max(1, questions.length)) * 31);
      const radiusY = Math.max(360, radiusX * 0.5);
      const golden = Math.PI * (3 - Math.sqrt(5));
      questions.forEach((node, index) => {
        const angle = index * golden + (node._seed % 97) * 0.0018;
        const radial = Math.sqrt((index + 0.64) / Math.max(1, questions.length));
        const organicX = 0.92 + 0.08 * Math.sin(angle * 3 + (node._seed % 19));
        const organicY = 0.9 + 0.1 * Math.cos(angle * 4 - (node._seed % 23));
        const x = Math.cos(angle) * radiusX * radial * organicX + Math.sin(angle * 2.2) * 15;
        const y = Math.sin(angle) * radiusY * radial * organicY + Math.cos(angle * 2.8) * 9;
        node.cx = x; node.cy = y; node.x = x; node.y = y;
      });
      primary.forEach((node, index) => {
        const unit = ((node._seed % 100000) + 0.5) / 100000;
        const angle = (index * golden * 1.7 + unit * TAU) % TAU;
        const band = node.label === 'Subject' ? 0.48 : node.label === 'Topic' ? 0.78 : node.label === 'Year' ? 0.91 : 0.66;
        const wobble = (((node._seed >>> 9) % 1000) / 1000 - 0.5) * 0.14;
        const x = Math.cos(angle) * radiusX * clamp(band + wobble, 0.28, 0.95);
        const y = Math.sin(angle) * radiusY * clamp(band + wobble * 0.7, 0.25, 0.94);
        node.cx = x; node.cy = y; node.x = x; node.y = y;
      });
      this._denseBounds = { radiusX, radiusY };
    }

    _tickDenseLayout() {
      if (!this.nodes.length) { this._ticksLeft = 0; return; }
      const cellSize = 23;
      const grid = new Map();
      this.nodes.forEach(node => {
        const key = `${Math.floor(node.x / cellSize)},${Math.floor(node.y / cellSize)}`;
        let bucket = grid.get(key);
        if (!bucket) { bucket = []; grid.set(key, bucket); }
        bucket.push(node);
      });
      this.nodes.forEach(node => {
        if (node.fixed) return;
        const gx = Math.floor(node.x / cellSize), gy = Math.floor(node.y / cellSize);
        for (let ox = -1; ox <= 1; ox += 1) {
          for (let oy = -1; oy <= 1; oy += 1) {
            const bucket = grid.get(`${gx + ox},${gy + oy}`);
            if (!bucket) continue;
            for (const other of bucket) {
              if (other === node) continue;
              let dx = node.x - other.x, dy = node.y - other.y;
              let distance2 = dx * dx + dy * dy;
              if (distance2 < 0.01) {
                dx = ((node._seed & 7) - 3) * 0.08;
                dy = (((node._seed >>> 4) & 7) - 3) * 0.08;
                distance2 = dx * dx + dy * dy + 0.02;
              }
              if (distance2 > 540) continue;
              const minimum = node.label === 'Question' && other.label === 'Question' ? 8 : 12;
              const force = minimum / distance2;
              node.vx += dx * force;
              node.vy += dy * force;
            }
          }
        }
        const anchor = node.label === 'Question' ? 0.022 : 0.032;
        node.vx += (node.cx - node.x) * anchor;
        node.vy += (node.cy - node.y) * anchor;
      });
      const edgeStep = Math.max(1, Math.ceil(this.edges.length / 9000));
      for (let i = 0; i < this.edges.length; i += edgeStep) {
        const edge = this.edges[i];
        if (edge.source === edge.target) continue;
        const dx = edge.target.x - edge.source.x, dy = edge.target.y - edge.source.y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const force = Math.min(0.035, Math.max(0, distance - 90) * 0.000045);
        const fx = dx / distance * force, fy = dy / distance * force;
        if (!edge.source.fixed) { edge.source.vx += fx; edge.source.vy += fy; }
        if (!edge.target.fixed) { edge.target.vx -= fx; edge.target.vy -= fy; }
      }
      this.nodes.forEach(node => {
        if (node.fixed) return;
        node.vx *= 0.72; node.vy *= 0.72;
        node.x += clamp(node.vx, -3.5, 3.5);
        node.y += clamp(node.vy, -3.5, 3.5);
      });
      this._ticksLeft -= 1;
    }

    _tickLayout() {
      if (this.layout === 'logic') { this._ticksLeft = 0; return; }
      if (this.presentation === 'dense') { this._tickDenseLayout(); return; }
      if (!this.nodes.length) { this._ticksLeft = 0; return; }
      const progress = clamp(this._ticksLeft / (this.nodes.length > 1800 ? 75 : this.nodes.length > 700 ? 120 : 190), 0, 1);
      const cellSize = 44;
      const grid = new Map();
      this.nodes.forEach(node => {
        const gx = Math.floor(node.x / cellSize), gy = Math.floor(node.y / cellSize);
        const key = `${gx},${gy}`;
        let bucket = grid.get(key);
        if (!bucket) { bucket = []; grid.set(key, bucket); }
        bucket.push(node);
      });
      this.nodes.forEach(node => {
        if (node.fixed) return;
        const gx = Math.floor(node.x / cellSize), gy = Math.floor(node.y / cellSize);
        for (let ox = -1; ox <= 1; ox += 1) {
          for (let oy = -1; oy <= 1; oy += 1) {
            const bucket = grid.get(`${gx + ox},${gy + oy}`);
            if (!bucket) continue;
            const step = Math.max(1, Math.ceil(bucket.length / 28));
            for (let i = 0; i < bucket.length; i += step) {
              const other = bucket[i];
              if (other === node) continue;
              let dx = node.x - other.x, dy = node.y - other.y;
              let dist2 = dx * dx + dy * dy;
              if (dist2 < 0.1) { dx = ((node._seed & 7) - 3) * 0.1; dy = (((node._seed >>> 3) & 7) - 3) * 0.1; dist2 = dx * dx + dy * dy + 0.1; }
              if (dist2 > 2500) continue;
              const force = (10 + node.r + other.r) / dist2;
              node.vx += dx * force; node.vy += dy * force;
            }
          }
        }
        node.vx += (node.cx - node.x) * 0.0018;
        node.vy += (node.cy - node.y) * 0.0018;
      });
      const edgeStep = Math.max(1, Math.ceil(this.edges.length / 18000));
      for (let i = 0; i < this.edges.length; i += edgeStep) {
        const edge = this.edges[i];
        if (edge.source === edge.target) continue;
        const dx = edge.target.x - edge.source.x, dy = edge.target.y - edge.source.y;
        const distance = Math.max(0.01, Math.hypot(dx, dy));
        const desired = edge.source.label === 'Question' || edge.target.label === 'Question' ? 28 : 58;
        const force = (distance - desired) * 0.0028 * (0.55 + progress * 0.45);
        const fx = dx / distance * force, fy = dy / distance * force;
        if (!edge.source.fixed) { edge.source.vx += fx; edge.source.vy += fy; }
        if (!edge.target.fixed) { edge.target.vx -= fx; edge.target.vy -= fy; }
      }
      this.nodes.forEach(node => {
        if (node.fixed) return;
        node.vx *= 0.82; node.vy *= 0.82;
        node.x += clamp(node.vx, -8, 8); node.y += clamp(node.vy, -8, 8);
      });
      this._ticksLeft -= 1;
    }

    _draw() {
      const ctx = this.ctx;
      if (!ctx) return;
      const dpr = this.dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const logic = this.layout === 'logic';
      ctx.fillStyle = logic || this.presentation === 'dense' ? '#ffffff' : '#fbfcfc';
      ctx.fillRect(0, 0, this.width, this.height);
      if (this.presentation !== 'dense' && !logic) {
        ctx.fillStyle = '#d9dee1';
        const spacing = 22;
        const startX = ((this.camera.x % spacing) + spacing) % spacing;
        const startY = ((this.camera.y % spacing) + spacing) % spacing;
        for (let x = startX; x < this.width; x += spacing) {
          for (let y = startY; y < this.height; y += spacing) {
            ctx.beginPath(); ctx.arc(x, y, 0.75, 0, TAU); ctx.fill();
          }
        }
      }
      ctx.setTransform(dpr * this.camera.zoom, 0, 0, dpr * this.camera.zoom, dpr * this.camera.x, dpr * this.camera.y);
      const selection = this._selectionSets();
      if (this.layout === 'logic' && this.showLabels) this._labelNodes(selection);
      this._drawEdges(ctx, selection);
      this._drawNodes(ctx, selection);
    }

    _drawEdges(ctx, selection) {
      const z = this.camera.zoom;
      const logic = this.layout === 'logic';
      const dense = this.presentation === 'dense' && !logic;
      const baseWidth = (dense ? 0.4 : 0.62) / z;
      this.edges.forEach(edge => {
        const active = !selection.active || selection.edges.has(edge.id);
        ctx.globalAlpha = selection.active ? (active ? 0.84 : (dense ? 0.025 : logic ? 0.28 : 0.06)) : (dense ? 0.12 : 0.25);
        ctx.strokeStyle = selection.active && active ? '#ef744a' : (dense ? '#aeb7bb' : '#929da3');
        ctx.lineWidth = active ? (dense ? 0.78 : 1.05) / z : baseWidth;
        ctx.setLineDash(edge.inferred ? [4 / z, 4 / z] : []);
        const g = this._edgeGeometry(edge);
        ctx.beginPath();
        if (g.loop) ctx.arc(g.cx, g.cy, g.radius, g.start, g.end);
        else { ctx.moveTo(g.x1, g.y1); ctx.quadraticCurveTo(g.cx, g.cy, g.x2, g.y2); }
        ctx.stroke();
        if (logic && !g.loop) this._drawLogicArrow(ctx, edge, g, active, z);
        if (logic && this._logicEdgeLabelVisible(edge, selection)) {
          const point = this._edgeLabelPoint(g);
          ctx.globalAlpha = selection.active ? (active ? 0.92 : 0.12) : 0.76;
          ctx.fillStyle = '#66717a';
          ctx.font = `${10.5 / z}px Arial, "Microsoft YaHei", sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(this._logicEdgeText(edge), point.x, point.y - 4 / z);
        }
      });
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    _drawNodes(ctx, selection) {
      const z = this.camera.zoom;
      const logic = this.layout === 'logic';
      const dense = this.presentation === 'dense' && !logic;
      const viewport = {
        left: -this.camera.x / z - 20 / z,
        top: -this.camera.y / z - 20 / z,
        right: (this.width - this.camera.x) / z + 20 / z,
        bottom: (this.height - this.camera.y) / z + 20 / z
      };
      this.nodes.forEach(node => {
        if (node.x < viewport.left || node.x > viewport.right || node.y < viewport.top || node.y > viewport.bottom) return;
        const active = !selection.active || selection.nodes.has(node.id);
        ctx.globalAlpha = selection.active ? (active ? 1 : (dense ? 0.09 : logic ? 0.68 : 0.13)) : (dense ? 0.9 : 0.96);
        ctx.fillStyle = node.color;
        ctx.beginPath(); ctx.arc(node.x, node.y, node.r, 0, TAU); ctx.fill();
        const highlighted = (this.selected && this.selected.type === 'node' && this.selected.item === node) || this._hover === node;
        if (highlighted) {
          ctx.strokeStyle = highlighted && this.selected && this.selected.item === node ? '#ef744a' : '#213b4d';
          ctx.lineWidth = 2 / z;
          ctx.beginPath(); ctx.arc(node.x, node.y, node.r + 4 / z, 0, TAU); ctx.stroke();
        }
      });
      if (this.showLabels) {
        ctx.textBaseline = 'middle';
        ctx.font = `${(logic ? 13.5 : dense ? 5.8 : 10) / z}px Arial, "Microsoft YaHei", sans-serif`;
        this._labelNodes(selection).forEach(node => {
          const active = !selection.active || selection.nodes.has(node.id);
          const chosen = this.selected && this.selected.type === 'node' && this.selected.item === node;
          ctx.globalAlpha = selection.active ? (active ? 0.96 : (dense ? 0.03 : logic ? 0.72 : 0.06)) : (dense ? 0.82 : 0.78);
          ctx.fillStyle = dense ? '#36434a' : '#445158';
          if (dense && chosen) ctx.font = `600 ${9.2 / z}px Arial, "Microsoft YaHei", sans-serif`;
          else if (dense) ctx.font = `${5.8 / z}px Arial, "Microsoft YaHei", sans-serif`;
          else if (logic && chosen) ctx.font = `600 ${13.5 / z}px Arial, "Microsoft YaHei", sans-serif`;
          else if (logic) ctx.font = `${13.5 / z}px Arial, "Microsoft YaHei", sans-serif`;
          ctx.textAlign = 'left';
          if (logic) {
            const label = this._logicLabelLayout(node);
            const worldX = (label.x - this.camera.x) / z;
            label.lines.forEach((line, index) => ctx.fillText(line, worldX, (label.lineY(index) - this.camera.y) / z));
          } else {
            ctx.fillText(node.displayName || node.name, node.x + node.r + (dense ? 2.2 : 4) / z, node.y);
          }
        });
      }
      ctx.globalAlpha = 1;
    }

    _labelEligible(node, active) {
      if (!active && this.selected) return false;
      if (this.selected && this.selected.type === 'node' && this.selected.item === node) return true;
      if (node.label !== 'Question') return true;
      return this.camera.zoom > 0.78 || this.nodes.length < 550;
    }

    _labelNodes(selection) {
      if (!this.showLabels) return [];
      if (this.layout === 'logic') return this._logicLabelNodes(selection);
      if (this.presentation === 'dense') return this._denseLabelNodes(selection);
      const priority = { Subject: 1, Topic: 2, Year: 3, Type: 4, Question: 5 };
      const boxes = [], visible = [], z = this.camera.zoom;
      const chosen = this.selected && this.selected.type === 'node' ? this.selected.item : null;
      const ordered = [...this.nodes].sort((a,b) => (a===chosen?-1:priority[a.label]||6)-(b===chosen?-1:priority[b.label]||6));
      for (const n of ordered) {
        if (!this._labelEligible(n, !selection.active || selection.nodes.has(n.id))) continue;
        const x=n.x*z+this.camera.x+n.r*z+4, y=n.y*z+this.camera.y;
        const width=[...n.name].reduce((s,c)=>s+(c.charCodeAt(0)>255?10:5.7),0);
        const box={l:x-2,r:x+width+3,t:y-7,b:y+7};
        if(box.l<0||box.t<0||box.r>this.width||box.b>this.height)continue;
        if(n!==chosen&&boxes.some(b=>box.l<b.r&&box.r>b.l&&box.t<b.b&&box.b>b.t))continue;
        boxes.push(box);visible.push(n);
        if(visible.length>=400)break;
      }
      return visible;
    }

    _logicLabelNodes(selection) {
      const chosen = this.selected && this.selected.type === 'node' ? this.selected.item : null;
      const ordered = [...this.nodes].sort((a, b) => (a === chosen ? -1 : b === chosen ? 1 : a.index - b.index));
      const visible = [], regions = [], occupied = [];
      for (const node of ordered) {
        const label = this._logicLabelLayout(node);
        const box = { l: label.l, r: label.r, t: label.t, b: label.b };
        if (box.l < 2 || box.r > this.width - 2 || box.t < 2 || box.b > this.height - 2) continue;
        const collision = occupied.some(other => box.l < other.r + 3 && box.r + 3 > other.l && box.t < other.b + 3 && box.b + 3 > other.t);
        if (collision && node !== chosen) continue;
        occupied.push(box); visible.push(node); regions.push({ node, ...box, lines: label.lines });
      }
      this._logicLabelRegions = regions;
      this._logicLabelCamera = `${this.camera.x}/${this.camera.y}/${this.camera.zoom}`;
      return visible;
    }

    _logicTextWidth(text, fontSize = 13.5) {
      return Array.from(String(text)).reduce((sum, char) => sum + (char.charCodeAt(0) > 255 ? fontSize : fontSize * 0.57), 0);
    }

    _logicLabelLines(node, fontSize = 13.5) {
      const leafPrediction = node.label === 'Prediction' && !this.edges.some(edge => edge.source === node);
      const maxWidth = this.width < 520 ? 112 : this.width < 900 ? 142 : leafPrediction ? 320 : 190;
      const lines = [];
      let line = '', width = 0;
      Array.from(String(node.name)).forEach(char => {
        const charWidth = this._logicTextWidth(char, fontSize);
        if (line && width + charWidth > maxWidth) { lines.push(line); line = char; width = charWidth; }
        else { line += char; width += charWidth; }
      });
      if (line || !lines.length) lines.push(line);
      return lines;
    }

    _logicLabelLayout(node, zoom = this.camera.zoom, cameraX = this.camera.x, cameraY = this.camera.y) {
      const fontSize = 13.5, lineHeight = 16.5;
      const lines = this._logicLabelLines(node, fontSize);
      const width = Math.max(...lines.map(line => this._logicTextWidth(line, fontSize)));
      const height = lines.length * lineHeight;
      const x = node.x * zoom + cameraX + node.r * zoom + 7;
      const centerY = node.y * zoom + cameraY;
      const top = centerY - height / 2;
      return {
        x, lines, width, height,
        l: x - 2, r: x + width + 3, t: top - 1, b: top + height + 1,
        lineY: index => top + lineHeight * (index + 0.72)
      };
    }

    _logicEdgeText(edge) {
      const value = String((edge.original && (edge.original.name || edge.original.fact_type)) || '关联').trim();
      const chars = Array.from(value);
      return chars.length > 10 ? `${chars.slice(0, 10).join('')}…` : value;
    }

    _logicEdgeLabelVisible(edge, selection) {
      return this._logicVisibleEdgeLabels(selection).has(edge.id);
    }

    _logicVisibleEdgeLabels(selection) {
      if (this.edges.length > 90 && !selection.active) return new Set();
      let candidates = selection.active
        ? this.edges.filter(edge => selection.edges.has(edge.id))
        : this.edges.filter(edge => {
          const name = this._logicEdgeText(edge);
          return this.edges.find(candidate => candidate.source.id === edge.source.id && this._logicEdgeText(candidate) === name) === edge;
        });
      const selectedEdge = this.selected && this.selected.type === 'edge' ? this.selected.item : null;
      if (selectedEdge) candidates = [...candidates].sort((a, b) => (a === selectedEdge ? -1 : b === selectedEdge ? 1 : 0));
      const occupied = this.showLabels ? this._logicLabelRegions.map(region => ({
        l: region.l, r: region.r, t: region.t, b: region.b
      })) : [];
      const visible = new Set();
      const overlaps = (a, b, padding) => a.l < b.r + padding && a.r + padding > b.l && a.t < b.b + padding && a.b + padding > b.t;
      candidates.forEach(edge => {
        const geometry = this._edgeGeometry(edge);
        const point = this._edgeLabelPoint(geometry);
        const text = this._logicEdgeText(edge);
        const x = point.x * this.camera.zoom + this.camera.x;
        const y = point.y * this.camera.zoom + this.camera.y - 4;
        const width = Array.from(text).reduce((sum, char) => sum + (char.charCodeAt(0) > 255 ? 10.5 : 6), 0);
        const box = { l: x - width / 2, r: x + width / 2, t: y - 13, b: y + 2 };
        if (box.l < 2 || box.r > this.width - 2 || box.t < 2 || box.b > this.height - 2) return;
        if (occupied.some(other => overlaps(box, other, 4))) return;
        occupied.push(box);
        visible.add(edge.id);
      });
      return visible;
    }

    _edgeLabelPoint(geometry) {
      if (geometry.loop) return { x: geometry.cx, y: geometry.cy - geometry.radius };
      return {
        x: 0.25 * geometry.x1 + 0.5 * geometry.cx + 0.25 * geometry.x2,
        y: 0.25 * geometry.y1 + 0.5 * geometry.cy + 0.25 * geometry.y2
      };
    }

    _drawLogicArrow(ctx, edge, geometry, active, zoom) {
      const angle = Math.atan2(geometry.y2 - geometry.cy, geometry.x2 - geometry.cx);
      const inset = edge.target.r + 3 / zoom;
      const tipX = geometry.x2 - Math.cos(angle) * inset;
      const tipY = geometry.y2 - Math.sin(angle) * inset;
      const size = 6 / zoom;
      ctx.globalAlpha = active ? 0.84 : 0.3;
      ctx.fillStyle = active && this.selected ? '#ef744a' : '#66717a';
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.quadraticCurveTo(
        tipX - Math.cos(angle - Math.PI / 5) * size,
        tipY - Math.sin(angle - Math.PI / 5) * size,
        tipX - Math.cos(angle) * size * 0.78,
        tipY - Math.sin(angle) * size * 0.78
      );
      ctx.quadraticCurveTo(
        tipX - Math.cos(angle + Math.PI / 5) * size,
        tipY - Math.sin(angle + Math.PI / 5) * size,
        tipX,
        tipY
      );
      ctx.fill();
    }

    _denseLabelNodes(selection) {
      const z = this.camera.zoom;
      const chosen = this.selected && this.selected.type === 'node' ? this.selected.item : null;
      const maxLabels = z < 0.28 ? 260 : z < 0.45 ? 480 : z < 0.7 ? 760 : 1100;
      const priority = { Subject: 0, Topic: 1, Year: 2, Type: 3, Question: 4 };
      const ordered = [...this.nodes].sort((a, b) => {
        if (a === chosen) return -1;
        if (b === chosen) return 1;
        const aActive = selection.nodes.has(a.id) ? -8 : 0;
        const bActive = selection.nodes.has(b.id) ? -8 : 0;
        const rank = (aActive + (priority[a.label] || 4)) - (bActive + (priority[b.label] || 4));
        return rank || ((a._seed % 104729) - (b._seed % 104729));
      });
      const bins = new Map(), visible = [], regions = [];
      const cell = 28;
      const overlaps = box => {
        const x0 = Math.floor(box.l / cell), x1 = Math.floor(box.r / cell);
        const y0 = Math.floor(box.t / cell), y1 = Math.floor(box.b / cell);
        for (let x = x0; x <= x1; x += 1) {
          for (let y = y0; y <= y1; y += 1) {
            const bucket = bins.get(`${x},${y}`);
            if (bucket && bucket.some(b => box.l < b.r && box.r > b.l && box.t < b.b && box.b > b.t)) return true;
          }
        }
        return false;
      };
      const remember = box => {
        const x0 = Math.floor(box.l / cell), x1 = Math.floor(box.r / cell);
        const y0 = Math.floor(box.t / cell), y1 = Math.floor(box.b / cell);
        for (let x = x0; x <= x1; x += 1) {
          for (let y = y0; y <= y1; y += 1) {
            const key = `${x},${y}`;
            let bucket = bins.get(key);
            if (!bucket) { bucket = []; bins.set(key, bucket); }
            bucket.push(box);
          }
        }
      };
      for (const node of ordered) {
        const active = !selection.active || selection.nodes.has(node.id);
        if (!active) continue;
        const selectedNeighbor = selection.active && selection.nodes.has(node.id);
        if (node.label === 'Question' && node !== chosen && !selectedNeighbor) {
          const sample = z < 0.28 ? 0.38 : z < 0.45 ? 0.62 : z < 0.7 ? 0.86 : 1;
          if ((node._seed % 1000) / 1000 > sample) continue;
        }
        const text = node.displayName || node.name;
        const fontSize = node === chosen ? 9.2 : 5.8;
        const x = node.x * z + this.camera.x + node.r * z + 2.2;
        const y = node.y * z + this.camera.y;
        const width = Array.from(text).reduce((sum, char) => sum + (char.charCodeAt(0) > 255 ? fontSize : fontSize * 0.56), 0);
        const box = { l: x - 1, r: x + width + 2, t: y - fontSize * 0.58, b: y + fontSize * 0.58 };
        if (box.l < 1 || box.t < 1 || box.r > this.width - 1 || box.b > this.height - 1) continue;
        if (node !== chosen && overlaps(box)) continue;
        remember(box); visible.push(node); regions.push({ node, ...box });
        if (visible.length >= maxLabels) break;
      }
      this._denseLabelRegions = regions;
      this._denseLabelCamera = `${this.camera.x}/${this.camera.y}/${this.camera.zoom}`;
      return visible;
    }

    _selectionSets() {
      const nodes = new Set(), edges = new Set();
      if (!this.selected) return { active: false, nodes, edges };
      if (this.selected.type === 'node') {
        const node = this.selected.item;
        nodes.add(node.id);
        (this.incident.get(node.id) || []).forEach(edge => {
          edges.add(edge.id); nodes.add(edge.source.id); nodes.add(edge.target.id);
        });
      } else {
        const edge = this.selected.item;
        edges.add(edge.id); nodes.add(edge.source.id); nodes.add(edge.target.id);
      }
      return { active: true, nodes, edges };
    }

    _edgeGeometry(edge) {
      const a = edge.source, b = edge.target;
      if (a === b) {
        const radius = a.r + 10 + Math.abs(edge.curve) * 5;
        return { loop: true, cx: a.x + radius, cy: a.y - radius, radius, start: Math.PI * 0.65, end: Math.PI * 2.35,
          svg: `M ${(a.x + radius + Math.cos(Math.PI * 0.65) * radius).toFixed(2)} ${(a.y - radius + Math.sin(Math.PI * 0.65) * radius).toFixed(2)} A ${radius.toFixed(2)} ${radius.toFixed(2)} 0 1 1 ${(a.x + radius + Math.cos(Math.PI * 2.35) * radius).toFixed(2)} ${(a.y - radius + Math.sin(Math.PI * 2.35) * radius).toFixed(2)}` };
      }
      const dx = b.x - a.x, dy = b.y - a.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const bend = edge.curve * Math.min(38, distance * 0.18) + (edge.curve === 0 ? ((hash(edge.id) % 5) - 2) * 1.3 : 0);
      const cx = (a.x + b.x) / 2 - dy / distance * bend;
      const cy = (a.y + b.y) / 2 + dx / distance * bend;
      return { loop: false, x1: a.x, y1: a.y, x2: b.x, y2: b.y, cx, cy,
        svg: `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} Q ${cx.toFixed(2)} ${cy.toFixed(2)} ${b.x.toFixed(2)} ${b.y.toFixed(2)}` };
    }

    _hitNode(screenX, screenY) {
      const labelCamera = `${this.camera.x}/${this.camera.y}/${this.camera.zoom}`;
      if (this.layout === 'logic' && this.showLabels && this._logicLabelCamera === labelCamera && this._logicLabelRegions.length) {
        for (let i = this._logicLabelRegions.length - 1; i >= 0; i -= 1) {
          const region = this._logicLabelRegions[i];
          if (screenX >= region.l && screenX <= region.r && screenY >= region.t && screenY <= region.b) return region.node;
        }
      }
      if (this.presentation === 'dense' && this.showLabels && this._denseLabelCamera === labelCamera && this._denseLabelRegions.length) {
        for (let i = this._denseLabelRegions.length - 1; i >= 0; i -= 1) {
          const region = this._denseLabelRegions[i];
          if (screenX >= region.l && screenX <= region.r && screenY >= region.t && screenY <= region.b) return region.node;
        }
      }
      const point = this._screenToWorld(screenX, screenY);
      const minimum = 6 / this.camera.zoom;
      let nearest = null, best = Infinity;
      for (let i = this.nodes.length - 1; i >= 0; i -= 1) {
        const node = this.nodes[i];
        const distance = Math.hypot(point.x - node.x, point.y - node.y);
        const hitRadius = Math.max(node.r + 2 / this.camera.zoom, minimum);
        if (distance <= hitRadius && distance < best) { nearest = node; best = distance; }
      }
      return nearest;
    }

    _hitEdge(screenX, screenY) {
      const p = this._screenToWorld(screenX, screenY);
      const threshold = 7 / this.camera.zoom;
      let bestEdge = null, best = threshold;
      this.edges.forEach(edge => {
        const g = this._edgeGeometry(edge);
        if (g.loop) {
          const distance = Math.abs(Math.hypot(p.x - g.cx, p.y - g.cy) - g.radius);
          if (distance < best) { best = distance; bestEdge = edge; }
          return;
        }
        let previous = { x: g.x1, y: g.y1 };
        for (let step = 1; step <= 9; step += 1) {
          const t = step / 9, mt = 1 - t;
          const current = { x: mt * mt * g.x1 + 2 * mt * t * g.cx + t * t * g.x2,
            y: mt * mt * g.y1 + 2 * mt * t * g.cy + t * t * g.y2 };
          const distance = this._segmentDistance(p, previous, current);
          if (distance < best) { best = distance; bestEdge = edge; }
          previous = current;
        }
      });
      return bestEdge;
    }

    _segmentDistance(p, a, b) {
      const dx = b.x - a.x, dy = b.y - a.y;
      if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y);
      const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy), 0, 1);
      return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    }

    _emitStatus(force) {
      const status = { nodes: this.nodes.length, edges: this.edges.length, zoom: Number(this.camera.zoom.toFixed(3)) };
      const key = `${status.nodes}/${status.edges}/${status.zoom}`;
      if (force || key !== this._lastStatus) {
        this._lastStatus = key;
        this._safeCall(this.onStatus, status);
      }
    }

    _safeCall(callback, value) {
      try { callback(value); } catch (error) { setTimeout(() => { throw error; }, 0); }
    }
  }

  global.LawGraphView = LawGraphView;
})(typeof window !== 'undefined' ? window : globalThis);
