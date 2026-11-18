/* Authored learning paths, speculative forecast branches, quick search, and local study progress. */
(function (root) {
  'use strict';

  const STORAGE_KEY = 'law_exam_atlas_study_v1';

  function isSubsequence(needle, haystack) {
    if (!needle) return true;
    if (!haystack || needle.length > haystack.length) return false;
    let i = 0;
    for (let j = 0; j < haystack.length && i < needle.length; j += 1) {
      if (needle[i] === haystack[j]) i += 1;
    }
    return i === needle.length;
  }

  function resolveStorage(explicit) {
    if (explicit === null) return { backend: null, persistent: false };
    if (explicit && typeof explicit.getItem === 'function' && typeof explicit.setItem === 'function') {
      try {
        const probe = '__law_atlas_probe__';
        explicit.setItem(probe, '1');
        if (typeof explicit.removeItem === 'function') explicit.removeItem(probe);
        return { backend: explicit, persistent: true };
      } catch (_err) {
        return { backend: null, persistent: false };
      }
    }
    try {
      const ls = root && root.localStorage;
      if (ls && typeof ls.getItem === 'function' && typeof ls.setItem === 'function') {
        const probe = '__law_atlas_probe__';
        ls.setItem(probe, '1');
        if (typeof ls.removeItem === 'function') ls.removeItem(probe);
        return { backend: ls, persistent: true };
      }
    } catch (_err) {
      /* Graceful fallback for strict file://, sandboxed webviews, or headless tests. */
    }
    return { backend: null, persistent: false };
  }

  function createStudyStore(options = {}) {
    const storageKey = options.storageKey || STORAGE_KEY;
    const forecastIds = options.forecastIds ? new Set(options.forecastIds) : null;
    const topicIds = options.topicIds ? new Set(options.topicIds) : null;
    const resolved = resolveStorage(options.storage);
    let backend = resolved.backend;
    let persistent = resolved.persistent;

    const bookmarked = new Set();
    const reviewed = new Set();
    const listeners = new Set();

    function normalizeId(raw) {
      if (typeof raw !== 'string') return '';
      const trimmed = raw.trim();
      if (!trimmed) return '';
      if (!forecastIds && !topicIds) return trimmed;
      if (forecastIds && forecastIds.has(trimmed)) return trimmed;
      if (topicIds && topicIds.has(trimmed)) return trimmed;
      if (topicIds && topicIds.has('topic-' + trimmed)) return 'topic-' + trimmed;
      return '';
    }

    function loadInitial() {
      if (!backend) return;
      try {
        const raw = backend.getItem(storageKey);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return;
        if (Array.isArray(parsed.bookmarked)) {
          for (const id of parsed.bookmarked) {
            const norm = normalizeId(id);
            if (norm) bookmarked.add(norm);
          }
        }
        if (Array.isArray(parsed.reviewed)) {
          for (const id of parsed.reviewed) {
            const norm = normalizeId(id);
            if (norm) reviewed.add(norm);
          }
        }
      } catch (_err) {
        /* Ignore corrupted storage payloads rather than blocking startup. */
      }
    }

    function persist() {
      if (!backend) return;
      try {
        const payload = JSON.stringify({
          version: 1,
          updatedAt: new Date().toISOString(),
          bookmarked: [...bookmarked],
          reviewed: [...reviewed],
        });
        backend.setItem(storageKey, payload);
      } catch (_err) {
        backend = null;
        persistent = false;
      }
    }

    function notify() {
      const snapshot = stats();
      for (const fn of listeners) {
        try { fn(snapshot); } catch (_err) { /* Keep UI subscribers isolated */ }
      }
    }

    function isBookmarked(id) {
      const norm = normalizeId(id);
      return Boolean(norm && bookmarked.has(norm));
    }

    function isReviewed(id) {
      const norm = normalizeId(id);
      return Boolean(norm && reviewed.has(norm));
    }

    function setBookmark(id, flag) {
      const norm = normalizeId(id);
      if (!norm) return false;
      const next = Boolean(flag);
      const changed = next ? !bookmarked.has(norm) : bookmarked.has(norm);
      if (next) bookmarked.add(norm); else bookmarked.delete(norm);
      if (changed) { persist(); notify(); }
      return next;
    }

    function setReviewed(id, flag) {
      const norm = normalizeId(id);
      if (!norm) return false;
      const next = Boolean(flag);
      const changed = next ? !reviewed.has(norm) : reviewed.has(norm);
      if (next) reviewed.add(norm); else reviewed.delete(norm);
      if (changed) { persist(); notify(); }
      return next;
    }

    function toggleBookmark(id) {
      return setBookmark(id, !isBookmarked(id));
    }

    function toggleReviewed(id) {
      return setReviewed(id, !isReviewed(id));
    }

    function matchesFilter(id, status = '') {
      if (!status || status === 'all') return true;
      if (status === 'bookmarked') return isBookmarked(id);
      if (status === 'reviewed') return isReviewed(id);
      if (status === 'unreviewed') return !isReviewed(id);
      return true;
    }

    function stats() {
      let forecastBookmarked = 0;
      let forecastReviewed = 0;
      let topicBookmarked = 0;
      let topicReviewed = 0;
      for (const id of bookmarked) {
        if (forecastIds ? forecastIds.has(id) : id.startsWith('forecast-')) forecastBookmarked += 1;
        else if (topicIds ? topicIds.has(id) : id.startsWith('topic-')) topicBookmarked += 1;
      }
      for (const id of reviewed) {
        if (forecastIds ? forecastIds.has(id) : id.startsWith('forecast-')) forecastReviewed += 1;
        else if (topicIds ? topicIds.has(id) : id.startsWith('topic-')) topicReviewed += 1;
      }
      return {
        forecastTotal: forecastIds ? forecastIds.size : 20,
        forecastBookmarked,
        forecastReviewed,
        topicTotal: topicIds ? topicIds.size : 80,
        topicBookmarked,
        topicReviewed,
        totalBookmarked: bookmarked.size,
        totalReviewed: reviewed.size,
        persistent,
      };
    }

    function exportData() {
      return {
        app: 'law-exam-atlas',
        version: 1,
        exportedAt: new Date().toISOString(),
        bookmarked: [...bookmarked],
        reviewed: [...reviewed],
      };
    }

    function exportJSON() {
      return JSON.stringify(exportData(), null, 2);
    }

    function importJSON(raw, opts = {}) {
      let parsed = raw;
      if (typeof raw === 'string') {
        try {
          parsed = JSON.parse(raw);
        } catch (_err) {
          throw Error('学习进度文件不是有效的 JSON');
        }
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw Error('学习进度文件格式无效');
      }
      const hasBookmarks = Array.isArray(parsed.bookmarked);
      const hasReviewed = Array.isArray(parsed.reviewed);
      if (!hasBookmarks && !hasReviewed) {
        throw Error('学习进度文件缺少 bookmarked 或 reviewed 数组');
      }
      if (parsed.bookmarked !== undefined && !hasBookmarks) {
        throw Error('bookmarked 字段必须为数组');
      }
      if (parsed.reviewed !== undefined && !hasReviewed) {
        throw Error('reviewed 字段必须为数组');
      }
      if (!opts.merge) {
        bookmarked.clear();
        reviewed.clear();
      }
      if (hasBookmarks) {
        for (const item of parsed.bookmarked) {
          const norm = normalizeId(item);
          if (norm) bookmarked.add(norm);
        }
      }
      if (hasReviewed) {
        for (const item of parsed.reviewed) {
          const norm = normalizeId(item);
          if (norm) reviewed.add(norm);
        }
      }
      persist();
      notify();
      return stats();
    }

    function clear() {
      const hadAny = bookmarked.size > 0 || reviewed.size > 0;
      bookmarked.clear();
      reviewed.clear();
      persist();
      if (hadAny) notify();
      return stats();
    }

    function onChange(listener) {
      if (typeof listener !== 'function') return function () {};
      listeners.add(listener);
      return function () { listeners.delete(listener); };
    }

    loadInitial();

    return {
      isBookmarked,
      isReviewed,
      setBookmark,
      setReviewed,
      toggleBookmark,
      toggleReviewed,
      matchesFilter,
      listBookmarked: () => [...bookmarked],
      listReviewed: () => [...reviewed],
      stats,
      exportData,
      exportJSON,
      importJSON,
      clear,
      onChange,
    };
  }

  function compactStem(text, maxLen = 54) {
    const cleaned = String(text || '')
      .replace(/^\s*\d+[.、．]?\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned.length > maxLen ? cleaned.slice(0, maxLen) + '…' : cleaned;
  }

  function create(data, exams, options = {}) {
    if (!data || !Array.isArray(data.predictions) || !Array.isArray(data.pathways)) {
      throw Error('学习路径数据缺失');
    }
    const byId = new Map();
    const scenarios = new Map(data.scenarios.map(s => [s.id, s]));
    function node(id, name, kind, summary, attributes = {}) {
      const n = { uuid: id, name, labels: [kind], summary, attributes };
      byId.set(id, n);
      return n;
    }
    node('forecast-2027', '2027 考向', 'Forecast', data.meta.notice);
    node('learning-root', '从题目到结论', 'Pathway', '先定位问题，再找条件、例外与结论。连线表示建议的学习顺序，不是法律上的推导定理。');
    for (const s of data.scenarios) {
      node('scenario-' + s.id, s.name, 'Scenario', s.summary, { scenarioId: s.id });
    }
    for (const p of data.predictions) {
      if (byId.has(p.id) || !scenarios.has(p.scenarioId)) throw Error('考向 ID 或情景无效：' + p.id);
      for (const t of p.topicIds) if (!exams.byId.has('topic-' + t)) throw Error('未知考点：' + t);
      for (const e of p.evidence) if (!exams.byId.has(e.questionId)) throw Error('未知证据题：' + e.questionId);
      node(p.id, p.title, 'Prediction', p.rationale, p);
    }
    for (const p of data.pathways) {
      node(p.id, p.subject + ' · 审题路线', 'Pathway', p.title, p);
      p.steps.forEach((s, i) => node(
        p.id + '-step-' + i,
        (i + 1) + '. ' + s.title,
        'Step',
        s.prompt,
        { ...s, subject: p.subject, pathwayId: p.id, order: i }
      ));
    }

    const topicNodes = exams.data.nodes.filter(n => n.labels && n.labels[0] === 'Topic');
    const forecastIds = new Set(data.predictions.map(p => p.id));
    const topicIds = new Set(topicNodes.map(n => n.uuid));
    const progress = options.store || createStudyStore({
      storage: options.storage,
      storageKey: options.storageKey,
      forecastIds,
      topicIds,
    });

    function graph() {
      const nodes = new Map();
      const edges = [];
      return {
        put(n, x, y) {
          if (n && !nodes.has(n.uuid)) {
            nodes.set(n.uuid, { ...n, attributes: { ...n.attributes, layout: { x, y } } });
          }
          return n;
        },
        link(a, b, name, fact, method = 'learning') {
          if (!a || !b) return;
          const uuid = 'learn-edge-' + a.uuid + '-' + b.uuid;
          if (!edges.some(e => e.uuid === uuid)) {
            edges.push({ uuid, source_node_uuid: a.uuid, target_node_uuid: b.uuid, name, fact, attributes: { method } });
          }
        },
        done() {
          return { nodes: [...nodes.values()], edges, layout: 'logic' };
        },
      };
    }

    const topic = id => exams.byId.get('topic-' + id);

    function forecast({ subject = '', scenario = '', query = '', focus = '', status = '' } = {}) {
      const g = graph();
      const p = data.predictions.find(x => x.id === focus);
      if (p) {
        const start = g.put(byId.get('scenario-' + p.scenarioId), 0, 0);
        const center = g.put(byId.get(p.id), 310, 0);
        g.link(start, center, '假设分支', scenarios.get(p.scenarioId).summary, 'forecast');
        const topics = p.topicIds.map(topic);
        topics.forEach((t, i) => {
          g.put(t, 650, (i - (topics.length - 1) / 2) * 180);
          g.link(center, t, '建议复习', '此考向的复习范围；不是确定命题范围。', 'forecast');
        });
        const evidence = [...new Map(p.evidence.map(e => [e.questionId, e])).values()];
        evidence.forEach((e, i) => g.put(exams.byId.get(e.questionId), 1030, (i - (evidence.length - 1) / 2) * 150));
        p.evidence.forEach(e => {
          const t = topics.find(item => item.attributes.topicId === e.topicId);
          if (t) g.link(t, exams.byId.get(e.questionId), '词语线索', e.evidence, 'keyword');
        });
      } else {
        const q = query.trim().toLowerCase();
        const rows = data.predictions.filter(item =>
          (!subject || item.subject === subject)
          && (!scenario || item.scenarioId === scenario)
          && (!status || progress.matchesFilter(item.id, status))
          && (!q || [item.title, item.rationale, item.subject, ...item.topicIds.map(id => topic(id).name)].join(' ').toLowerCase().includes(q))
        );
        if (rows.length) {
          const center = g.put(byId.get('forecast-2027'), 0, 0);
          let offset = -(rows.length - 1) * 38;
          for (const s of data.scenarios) {
            const group = rows.filter(item => item.scenarioId === s.id);
            if (!group.length) continue;
            const middle = offset + (group.length - 1) * 38;
            const sn = g.put(byId.get('scenario-' + s.id), 290, middle);
            g.link(center, sn, '情景假设', s.summary, 'forecast');
            group.forEach(item => {
              const pn = g.put(byId.get(item.id), 660, offset);
              g.link(sn, pn, '备考方向', item.rationale, 'forecast');
              offset += 76;
            });
            offset += 36;
          }
        }
      }
      return g.done();
    }

    function learning({ subject = '', query = '', focus = '' } = {}) {
      const g = graph();
      const p = data.pathways.find(x => x.id === focus);
      if (p) {
        let previous = g.put(byId.get(p.id), 0, 0);
        p.steps.forEach((s, i) => {
          const sn = g.put(byId.get(p.id + '-step-' + i), 280 + i * 290, 0);
          g.link(previous, sn, i ? '接着判断' : '从这里开始', s.prompt);
          previous = sn;
          s.topicIds.forEach((id, j) => {
            const t = topic(id);
            if (t) {
              g.put(t, 280 + i * 290, 150 + j * 90);
              g.link(sn, t, '用到的考点', s.prompt);
            }
          });
        });
      } else {
        const q = query.trim().toLowerCase();
        const paths = data.pathways.filter(item =>
          (!subject || item.subject === subject)
          && (!q || [item.title, item.subject, ...item.steps.flatMap(s => [s.title, s.prompt, ...s.topicIds.map(id => topic(id)?.name || '')])].join(' ').toLowerCase().includes(q))
        );
        if (paths.length) {
          const start = g.put(byId.get('learning-root'), 0, 0);
          paths.forEach((item, i) => {
            const y = (i - (paths.length - 1) / 2) * 250;
            const pn = g.put(byId.get(item.id), 300, y);
            g.link(start, pn, '按科目定位', item.title);
            item.steps.slice(0, 3).forEach((s, j) => {
              const sn = g.put(byId.get(item.id + '-step-' + j), 650, y + (j - 1) * 65);
              g.link(pn, sn, j ? '判断步骤' : '先问自己', s.prompt);
            });
          });
        }
      }
      return g.done();
    }

    const searchIndex = [];
    for (const p of data.predictions) {
      const scenarioName = scenarios.get(p.scenarioId)?.name || '';
      const topicNames = p.topicIds.map(id => topic(id)?.name || '').filter(Boolean);
      searchIndex.push({
        id: p.id,
        rawCode: p.id.toLowerCase(),
        kind: 'Prediction',
        badge: '2027 考向',
        subject: p.subject,
        title: p.title,
        subtitle: p.subject + ' · ' + scenarioName + ' · ' + topicNames.join(' / '),
        titleLower: p.title.toLowerCase(),
        primaryLower: [p.id, p.title, p.subject, scenarioName, ...p.topicIds, ...topicNames].join(' ').toLowerCase(),
        bodyLower: [p.rationale, ...(p.steps || []), p.practice?.prompt || ''].join(' ').toLowerCase(),
        fuzzyTargets: [p.title.toLowerCase(), p.id.toLowerCase(), ...topicNames.map(s => s.toLowerCase())],
        rankBase: 42,
      });
    }
    for (const p of data.pathways) {
      const title = p.subject + ' · ' + p.title;
      const stepTitles = p.steps.map(s => s.title);
      searchIndex.push({
        id: p.id,
        rawCode: p.id.toLowerCase(),
        kind: 'Pathway',
        badge: '审题路线',
        subject: p.subject,
        title,
        subtitle: p.steps.map((s, idx) => (idx + 1) + '.' + s.title).join(' → '),
        titleLower: title.toLowerCase(),
        primaryLower: [p.id, p.subject, '审题路线', '知识逻辑', p.title, ...stepTitles].join(' ').toLowerCase(),
        bodyLower: p.steps.map(s => s.prompt).join(' ').toLowerCase(),
        fuzzyTargets: [title.toLowerCase(), p.id.toLowerCase(), ...stepTitles.map(s => s.toLowerCase())],
        rankBase: 38,
      });
    }
    for (const t of topicNodes) {
      const a = t.attributes || {};
      const keywords = Array.isArray(a.keywords) ? a.keywords : [];
      searchIndex.push({
        id: t.uuid,
        rawCode: String(a.topicId || '').toLowerCase(),
        kind: 'Topic',
        badge: '考点',
        subject: a.subject || '',
        title: t.name,
        subtitle: (a.subject || '') + (a.chapter ? ' · ' + a.chapter : '') + ' · 关联 ' + (a.questionCount || 0) + ' 题',
        titleLower: t.name.toLowerCase(),
        primaryLower: [t.uuid, a.topicId || '', t.name, a.subject || '', a.chapter || '', ...keywords].join(' ').toLowerCase(),
        bodyLower: String(t.summary || '').toLowerCase(),
        fuzzyTargets: [t.name.toLowerCase(), String(a.topicId || '').toLowerCase(), ...keywords.map(k => String(k).toLowerCase())],
        rankBase: 32,
      });
    }
    for (const q of exams.questions) {
      const a = q.attributes || {};
      const qTopicNames = (a.topics || []).map(id => topic(id)?.name || '').filter(Boolean);
      const title = q.name + ' · ' + a.subject;
      searchIndex.push({
        id: q.uuid,
        rawCode: q.uuid.toLowerCase(),
        kind: 'Question',
        badge: a.questionType || '真题',
        subject: a.subject || '',
        title,
        subtitle: compactStem(q.summary),
        titleLower: title.toLowerCase(),
        primaryLower: [q.uuid, q.name, a.year, a.paper || '', a.subject || '', a.questionType || '', ...qTopicNames].join(' ').toLowerCase(),
        bodyLower: String(q.summary || '').toLowerCase(),
        fuzzyTargets: null,
        rankBase: 14 + Math.min(10, Math.max(0, (Number(a.year) || 2005) - 2016)),
      });
    }

    function toResult(entry, score) {
      return {
        id: entry.id,
        kind: entry.kind,
        badge: entry.badge,
        subject: entry.subject,
        title: entry.title,
        subtitle: entry.subtitle,
        bookmarked: progress.isBookmarked(entry.id),
        reviewed: progress.isReviewed(entry.id),
        score,
      };
    }

    function quickSearch(rawQuery = '', opts = {}) {
      const limit = Math.max(1, Number(opts.limit) || 18);
      const allowKinds = Array.isArray(opts.kinds) && opts.kinds.length ? new Set(opts.kinds) : null;
      const cleaned = String(rawQuery || '').trim().replace(/^#+/, '').toLowerCase();

      if (!cleaned) {
        const defaults = [];
        const seen = new Set();
        const pushEntry = entry => {
          if (!entry || seen.has(entry.id) || (allowKinds && !allowKinds.has(entry.kind))) return;
          seen.add(entry.id);
          defaults.push(toResult(entry, entry.rankBase + (progress.isBookmarked(entry.id) ? 100 : 0)));
        };
        for (const entry of searchIndex) {
          if (progress.isBookmarked(entry.id)) pushEntry(entry);
          if (defaults.length >= limit) return defaults;
        }
        for (const entry of searchIndex) {
          if (entry.kind === 'Pathway' || entry.kind === 'Prediction') pushEntry(entry);
          if (defaults.length >= limit) return defaults;
        }
        for (const entry of searchIndex) {
          if (entry.kind === 'Topic') pushEntry(entry);
          if (defaults.length >= limit) return defaults;
        }
        return defaults;
      }

      const tokens = cleaned.split(/\s+/).filter(Boolean);
      const canFuzzy = tokens.length === 1 && cleaned.length >= 2 && cleaned.length <= 14;
      const matches = [];

      for (const entry of searchIndex) {
        if (allowKinds && !allowKinds.has(entry.kind)) continue;
        let score = 0;
        if (entry.id.toLowerCase() === cleaned || entry.rawCode === cleaned || entry.titleLower === cleaned) {
          score = 1200;
        } else if (entry.id.toLowerCase().startsWith(cleaned) || entry.rawCode.startsWith(cleaned)) {
          score = 1050;
        } else if (entry.titleLower.startsWith(cleaned)) {
          score = 920;
        } else if (entry.titleLower.includes(cleaned)) {
          score = 800;
        } else if (tokens.length > 1 && tokens.every(tok => entry.primaryLower.includes(tok))) {
          score = 680;
        } else if (entry.primaryLower.includes(cleaned)) {
          score = 620;
        } else if (tokens.length > 1 && tokens.every(tok => entry.primaryLower.includes(tok) || entry.bodyLower.includes(tok))) {
          score = 440;
        } else if (entry.bodyLower.includes(cleaned)) {
          score = 340;
        } else if (canFuzzy && entry.fuzzyTargets && entry.fuzzyTargets.some(target => isSubsequence(cleaned, target))) {
          score = 220;
        }

        if (score > 0) {
          const totalScore = score + entry.rankBase + (progress.isBookmarked(entry.id) ? 15 : 0);
          matches.push({ entry, totalScore });
        }
      }

      matches.sort((a, b) =>
        b.totalScore - a.totalScore
        || a.entry.title.length - b.entry.title.length
        || a.entry.id.localeCompare(b.entry.id)
      );

      return matches.slice(0, limit).map(m => toResult(m.entry, m.totalScore));
    }

    return { data, byId, scenarios, forecast, learning, progress, quickSearch };
  }

  root.LawLearningModel = { create, createStudyStore, isSubsequence, STORAGE_KEY };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.LawLearningModel;
})(typeof window !== 'undefined' ? window : globalThis);
