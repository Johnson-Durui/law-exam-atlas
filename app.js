/* Local-only exam explorer. All visible counts come from the supplied corpus. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const fmt = n => Number(n).toLocaleString('zh-CN');
  const kinds = {Question:'真题',Topic:'候选考点',Year:'年份',Subject:'科目',Type:'题型',Forecast:'预测总览',Prediction:'2027 考向',Scenario:'备考情景',Pathway:'学习路线',Step:'审题步骤'};
  const label = n => n.labels[0];
  const badge = (text, warning) => el('span', 'badge' + (warning ? ' warning' : ''), text);
  let model, view, result, selected = null, listLimit = 80, catalogPage = 0, mode = $('workspace').dataset.mode || 'split', labels = true, timer;
  let learning, layer='exams', studyGraph=null, studyFocus='';
  const lookup=id=>learning?.byId.get(id)||model.byId.get(id);
  function button(text, callback, cls) { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', callback); return b; }
  function fail(error) { $('error-banner').hidden = false; $('error-banner').textContent = '图谱未能加载：' + error.message + '。请保留 data 文件夹与网页在一起后重新打开。'; }
  function sourceURL(file, page) {
    if (!file || /^(?:[a-z]+:|[\\/])|(?:^|[\\/])\.\.(?:[\\/]|$)/i.test(file)) return '';
    return '../' + file.split(/[\\/]/).map(encodeURIComponent).join('/') + (page ? '#page=' + Number(page) : '');
  }
  function sourceLink(file, page, title) {
    if (/^https?:$/.test(window.location?.protocol||'')) return el('span','source-link source-unavailable',(title||'原卷 PDF 第 '+page+' 页')+' · 网站未附原卷');
    const a = el('a', 'source-link', title || '打开原卷 PDF · 第 ' + page + ' 页');
    a.href = sourceURL(file, page); a.target = '_blank'; a.rel = 'noopener'; return a;
  }
  function heading(kicker, title, intro) {
    const root = $('detail-content'); root.replaceChildren(el('div','kicker',kicker), el('h2','',title));
    if (intro) root.append(el('p','intro',intro));
    $('detail').scrollTop = 0; return root;
  }
  function counts(root, pairs) { const box = el('div','fact-count'); for (const [value, text] of pairs) { const c=el('div'); c.append(el('strong','',fmt(value)),el('span','',text)); box.append(c); } root.append(box); }
  function metadata(root, pairs) { const box=el('div','metadata'); for (const [key,value] of pairs) box.append(el('span','',key),el('strong','',value)); root.append(box); }
  function activate(id) {
    if (!view.select(id)) { const n=lookup(id); if(n) showSelection({type:'node',data:n}); }
  }
  function yearBars(root, questions) {
    const byYear = new Map(); questions.forEach(n=>byYear.set(n.attributes.year,(byYear.get(n.attributes.year)||0)+1));
    const box = el('div','year-bars'); box.setAttribute('role','img'); box.setAttribute('aria-label','已提取题目年份分布：'+[...byYear].sort().map(([y,n])=>y+' 年 '+n+' 题').join('；')); const max = Math.max(1,...byYear.values());
    for (const y of model.data.meta.years) { const count=byYear.get(y)||0; const b=el('div','year-col'); b.style.height=(count?Math.max(3,70*count/max):2)+'px'; b.title=y+' 年：'+count+' 道'; b.setAttribute('aria-label',b.title); b.append(el('span','',String(y).slice(2))); box.append(b); }
    root.append(box);
  }
  function questionRows(root, rows, limit=15) {
    const holder=el('div'); root.append(holder); let shown=0;
    function add() {
      more.remove(); const end=Math.min(shown+limit,rows.length);
      for (;shown<end;shown++) { const n=rows[shown],a=n.attributes; const row=button('',()=>activate(n.uuid),'related-row'); row.append(el('strong','',n.name+' · '+a.subject),el('span','',a.questionType+' · PDF 第 '+a.sourcePage+' 页'),el('p','',n.summary)); holder.append(row); }
      if(shown<rows.length)holder.append(more);
    }
    const more=button('继续显示关联真题',add,'load-more'); add();
    if(!rows.length)holder.append(el('p','empty-copy','当前筛选范围内没有关联真题。可清除筛选后继续探索。'));
  }
  function overview() {
    selected=null;
    const root=heading('EXAM ATLAS / DETAIL','从题目进入知识网络','左侧浏览真题，中间寻找联系，右侧阅读原文。节点旁的文字取自题干；缩放后可看到更多题目标签。');
    counts(root,[[result.questions.length,'当前真题'],[result.nodes.filter(n=>label(n)==='Topic').length,'关联考点'],[result.edges.length,'可见连线']]);
    for(const [i,t] of ['先搜索一个熟悉的词，例如“正当防卫”，或按科目和年份缩小范围。','点击小节点看原题，点击考点看跨年份题目；选项中出现的词也可能形成候选连线。','遇到断句、乱码或旧法表述，沿 PDF 页码核对原卷。历史试题需结合当年法律背景理解。'].entries()){const s=el('div','tutorial-step');s.append(el('b','',String(i+1).padStart(2,'0')),el('p','',t));root.append(s);}
    root.append(el('h3','','当前题目分布')); yearBars(root,result.questions);
    const review=model.questions.filter(n=>n.attributes.extractionStatus!=='自动提取').length;
    root.append(el('p','notice','已提取 '+fmt(model.questions.length)+' 道，其中 '+fmt(review)+' 道提取待核对。部分年份未能读出题目；下方数量反映已提取内容，不代表历年考频或押题概率。'));
    root.append(button('查看全部来源与缺卷情况',showCoverage,'text-button'));
    $('selection-status').textContent='选择一个节点开始探索';
  }
  function questionDetail(n) {
    const a=n.attributes, root=heading('QUESTION / '+a.year,n.name+' · '+a.subject);
    root.append(badge(a.paper),badge(a.questionType),badge(a.extractionStatus,a.extractionStatus!=='自动提取'));
    root.append(el('div','question-text',n.summary));
    if(a.extractionStatus!=='自动提取')root.append(el('p','notice','本题存在提取质量问题，可能含乱码、缺字或双栏错序。请以原卷为准。'));
    metadata(root,[['科目归类',a.subjectMethod||'待核对'],['原卷页码','PDF 第 '+a.sourcePage+' 页'],['原始文件',a.sourceFile.split('/').pop()]]);
    root.append(sourceLink(a.sourceFile,a.sourcePage));
    const matches=model.neighbors(n.uuid).filter(x=>x.edge.attributes?.method==='keyword');
    root.append(el('h3','','候选考点 · '+matches.length));
    const chips=el('div','topic-chips'); matches.forEach(x=>chips.append(button(x.node.name,()=>activate(x.node.uuid)))); root.append(chips);
    if(!matches.length)root.append(el('p','empty-copy','本题未命中当前考点词表。这不表示本题没有考点。'));
    for(const x of matches){const d=el('div','evidence');d.append(el('strong','',x.node.name),el('p','','命中：“'+x.edge.attributes.keywords.join('、')+'”'),el('p','',x.edge.attributes.evidence));root.append(d);}
    if(matches.length)root.append(el('p','notice','词语命中可能来自错误选项或附带叙述；这些关联帮助检索，不等于考点定论或答案。'));
    const similar=new Map(); for(const x of matches)for(const q of model.relatedQuestions(x.node.uuid,result.questions))if(q.node.uuid!==n.uuid)similar.set(q.node.uuid,q.node);
    root.append(el('h3','','沿同一考点再看一题 · '+similar.size)); questionRows(root,[...similar.values()].sort((a,b)=>b.attributes.year-a.attributes.year),8);
  }
  function nodeDetail(n) {
    if(learning?.byId.has(n.uuid)){studyDetail(n);return;}
    if(label(n)==='Question'){questionDetail(n);return;}
    const root=heading(kinds[label(n)]+' / CONNECTIONS',n.name,n.summary);
    const qs=model.relatedQuestions(n.uuid,result.questions).map(x=>x.node);
    counts(root,[[qs.length,'当前关联真题'],[new Set(qs.map(q=>q.attributes.year)).size,'涉及年份']]);
    if(label(n)==='Topic'){
      root.append(badge(n.attributes.subject),badge(n.attributes.chapter));
      root.append(el('p','notice','以下试题与本考点存在关键词候选关联，包含题干和选项命中。仍需逐题核对。'));
      root.append(el('h3','','跨知识点连接'));
      const links=model.neighbors(n.uuid).filter(x=>x.edge.attributes?.method==='concept');
      for(const x of links){const row=button('',()=>activate(x.node.uuid),'related-row');row.append(el('strong','',x.node.name+' · '+x.edge.name),el('p','',x.edge.fact));root.append(row);}
      root.append(el('p','empty-copy','跨科连线表示学习上的比较或联系；不同法律规则不能互相替代，法制史只作历史比较。'));
      const forecasts=learning?.data.predictions.filter(p=>p.topicIds.includes(n.attributes.topicId))||[];
      if(forecasts.length){root.append(el('h3','','沿此考点看 2027 考向'));for(const p of forecasts)root.append(button(p.title,()=>openStudy(p.id),'related-row'));}
    }else if(label(n)==='Subject')root.append(el('p','notice','科目包含按题号推定的归类；遇到边界或综合材料题，请查看原卷。'));
    root.append(el('h3','','年份分布'));yearBars(root,qs);
    root.append(el('h3','','关联真题 · '+qs.length));questionRows(root,qs);
  }
  function edgeDetail(e) {
    const a=lookup(e.source_node_uuid),b=lookup(e.target_node_uuid);
    const root=heading('RELATIONSHIP / '+e.attributes.method,e.name);
    root.append(el('p','intro',a.name+' → '+b.name),el('div','evidence',e.fact));
    metadata(root,[['关联方式',({keyword:'关键词候选关联',concept:'整理的学习联系',learning:'建议的学习顺序',forecast:'备考假设关联'})[e.attributes.method]||'题卷元数据']]);
    if(e.attributes.method==='keyword')root.append(el('p','notice','关键词可能来自选项，包含错误选项。该线只代表候选关联，不能据此判定答案。'));
    const chips=el('div','topic-chips');chips.append(button('查看 '+a.name,()=>activate(a.uuid)),button('查看 '+b.name,()=>activate(b.uuid)));root.append(el('h3','','关系两端'),chips);
    const q=label(a)==='Question'?a:label(b)==='Question'?b:null;if(q)root.append(sourceLink(q.attributes.sourceFile,q.attributes.sourcePage));
  }
  function studyDetail(n){
    const a=n.attributes,kind=label(n),root=heading(kinds[kind],n.name,n.summary);
    if(kind==='Prediction'){
      root.append(badge('2027 复习假设',true),badge(a.subject),badge(learning.scenarios.get(a.scenarioId).name));
      root.append(el('h3','','可能怎么问'),el('p','intro',a.questionTypes.join(' / ')));
      root.append(el('h3','','为什么串在一起'),el('p','',a.rationale));
      root.append(el('h3','','从零开始怎么做'));
      const list=el('ol','study-steps');for(const step of a.steps)list.append(el('li','',step));root.append(list);
      root.append(el('h3','','需要串起来的知识点'));
      const chips=el('div','topic-chips');for(const id of a.topicIds){const t=lookup('topic-'+id);chips.append(button(t.name,()=>activate(t.uuid)));}root.append(chips);
      root.append(el('h3','','用一道拟题练习'),el('p','notice','以下为原创练习，未列入真题库。'),el('div','question-text',a.practice.prompt));
      const details=el('details','practice-check');details.append(el('summary','','展开自查要点'));const checks=el('ol','study-steps');a.practice.checkpoints.forEach(x=>checks.append(el('li','',x)));details.append(checks);root.append(details);
      root.append(el('h3','','已有真题中的词语线索'));
      root.append(el('p','notice','这些题与本分支命中相同词语，可能来自选项。历史出现不代表 2027 会考，也不构成命题概率。'));
      if(a.evidence.length){for(const e of a.evidence){const q=lookup(e.questionId);const b=button('',()=>activate(q.uuid),'related-row');b.append(el('strong','',q.name+' · '+q.attributes.subject),el('p','',e.evidence));root.append(b);}}
      else root.append(el('p','empty-copy','现有可靠提取题中尚无词语线索，按补充覆盖方向练习。'));
      root.append(el('h3','','这个假设的边界'),el('p','notice',a.uncertainty));
      const share=el('a','source-link','此分支的独立链接');share.href='#'+n.uuid;root.append(share);
    }else if(kind==='Step'){
      root.append(el('h3','','连接到具体考点'));for(const id of a.topicIds){const t=lookup('topic-'+id);if(t)root.append(button(t.name,()=>activate(t.uuid),'related-row'));}
      root.append(button('查看完整审题路线',()=>openStudy(a.pathwayId),'load-more'));
    }else if(kind==='Pathway'&&a.steps){
      root.append(el('p','notice','这是审题和复习的建议顺序；具体题型可以跳步，不同科目的规则不能互相替代。'));
      a.steps.forEach((s,i)=>{const b=button('',()=>activate(n.uuid+'-step-'+i),'related-row');b.append(el('strong','',(i+1)+'. '+s.title),el('p','',s.prompt));root.append(b);});
    }else{
      root.append(el('p','notice',learning.data.meta.notice));
      const rows=kind==='Scenario'?learning.data.predictions.filter(p=>p.scenarioId===a.scenarioId):layer==='forecast'?learning.data.predictions:learning.data.pathways;
      rows.forEach(p=>root.append(button(p.title||p.subject,()=>openStudy(p.id),'related-row')));
    }
  }
  function studyOverview(){
    const isForecast=layer==='forecast',root=heading(isForecast?'2027 / 备考假设':'知识 / 审题路线',isForecast?'把考向展开来看':'先知道问什么，再决定答什么',isForecast?'从情景进入分支，再串起知识点和已有真题。点击任意考向，查看复习步骤与练习。':'五科各有一条审题路线。点科目展开步骤，点知识点继续追踪真题与跨科联系。');
    root.append(el('p','notice',isForecast?learning.data.meta.notice:'箭头表示建议的阅读与判断顺序。跨科联系只作比较，不将历史规则直接套用到现行法。'));
    const rows=(studyGraph?.nodes||[]).filter(n=>isForecast?label(n)==='Prediction':label(n)==='Pathway'&&n.uuid!=='learning-root');
    rows.forEach(n=>{const b=button('',()=>openStudy(n.uuid),'related-row');b.append(el('strong','',n.name),el('p','',n.summary));root.append(b);});
    if(!rows.length)root.append(el('p','empty-copy','没有匹配内容。请清除搜索或调整科目。'));
  }
  function renderStudy(){
    const f={subject:$('study-subject').value,scenario:$('study-scenario').value,query:$('search').value,focus:studyFocus};
    studyGraph=layer==='forecast'?learning.forecast(f):learning.learning(f);
    view.setData(studyGraph);view.setLabels(labels);result=model.filter({});
    $('graph-empty').hidden=studyGraph.nodes.length!==0;
    if($('graph-empty').firstChild)$('graph-empty').firstChild.textContent='没有匹配的考向或学习路线。';
    $('study-back').hidden=!studyFocus;$('peek-card').hidden=true;
    $('summary').textContent=layer==='forecast'?'2027 · '+learning.data.predictions.length+' 个复习假设 · 3 种情景':'五科学习路线 · 点击步骤查看考点';
    $('study-context').textContent=studyFocus?(layer==='forecast'?'情景 → 考向 → 考点 → 真题词语线索':'审题顺序 → 知识点 → 真题'):(layer==='forecast'?'2027 复习假设 · 点击橙色分支展开':'学习顺序 · 点击科目展开');
    selected=null;studyOverview();renderCatalog();
    if(studyFocus)activate(studyFocus);
  }
  function setLayer(next){
    layer=next;studyFocus='';$('workspace').dataset.layer=next;closeOverlays();
    $('search').value='';$('full-search').value='';
    for(const name of ['exams','learning','forecast'])$('layer-'+name).setAttribute('aria-pressed',String(name===next));
    $('study-controls').hidden=next==='exams';$('study-context').hidden=next==='exams';$('study-scenario').hidden=next!=='forecast';
    $('graph-title').textContent=next==='forecast'?'2027 考向':next==='learning'?'知识逻辑':'真题关系网';
    $('catalog-title').textContent=next==='forecast'?'考向分支':next==='learning'?'学习路线':'真题目录';
    $('search').placeholder=$('full-search').placeholder=next==='exams'?'搜索题干、考点或年份':'搜索考向、知识点或科目';
    if(next==='exams'){$('graph-empty').firstChild && ($('graph-empty').firstChild.textContent='没有符合筛选条件的真题。');apply();}
    else {if(mode==='list')setMode('split');renderStudy();}
  }
  function openStudy(id){
    const n=learning.byId.get(id);if(!n)return;
    const target=label(n)==='Prediction'?'forecast':'learning';
    if(layer!==target)setLayer(target);studyFocus=id;renderStudy();
    if(window.history?.replaceState)window.history.replaceState(null,'','#'+id);
  }
  function showSelection(item) {
    if(!item){overview();return;}
    if(item.type==='node'&&label(item.data)==='Prediction'&&studyFocus!==item.data.uuid){openStudy(item.data.uuid);return;}
    if(item.type==='node'&&label(item.data)==='Pathway'&&item.data.attributes.steps&&studyFocus!==item.data.uuid){openStudy(item.data.uuid);return;}
    selected=item;
    if(item.type==='edge')edgeDetail(item.data);else nodeDetail(item.data);
    $('selection-status').textContent=(item.type==='edge'?'关系：':'已选：')+item.data.name;
    const n=item.data;
    if($('peek-card')){
      $('peek-card').hidden=false;
      $('peek-title').textContent=item.type==='edge'?'Relationship · '+n.name:(kinds[label(n)]||'节点')+' · '+n.name;
      $('peek-body').textContent=item.type==='edge'?n.fact:(n.summary||n.name);
    }
    if(layer!=='exams'&&mode==='graph'){const changed=$('workspace').dataset.detail!=='open';$('workspace').dataset.detail='open';$('peek-card').hidden=true;if(changed)requestAnimationFrame(()=>requestAnimationFrame(()=>view.fit()));}
    renderCatalog();
    if(mode==='list')renderList();
  }
  function filters() {
    return {query:$('search').value,subject:$('subject').value,from:$('from').value,to:$('to').value,type:$('type').value,relations:[...document.querySelectorAll('[data-relation]:checked')].map(n=>n.dataset.relation)};
  }
  function apply() {
    if(layer!=='exams'){renderStudy();return;}
    result=model.filter(filters());view.setData(result);view.setLabels(labels);listLimit=80;catalogPage=0;
    $('summary').textContent='已提取 '+fmt(model.questions.length)+' 道真题 · 当前 '+fmt(result.questions.length)+' 道 · '+$('from').value+'—'+$('to').value;
    $('graph-empty').hidden=result.questions.length!==0;
    if($('peek-card'))$('peek-card').hidden=true;
    overview(); renderCatalog(); if(mode==='list')renderList();
  }
  function clear() { $('search').value='';if($('full-search'))$('full-search').value='';$('subject').value='';$('type').value='';$('from').value=model.data.meta.yearFrom;$('to').value=model.data.meta.yearTo;studyFocus='';$('study-subject').value='';$('study-scenario').value='';apply(); }
  function sortedQuestions(){return [...result.questions].sort((a,b)=>b.attributes.year-a.attributes.year||a.attributes.paper.localeCompare(b.attributes.paper)||a.attributes.number-b.attributes.number);}
  function renderCatalog(){
    const holder=$('catalog-list');if(!holder)return;
    if(layer!=='exams'){
      holder.replaceChildren();const rows=(studyGraph?.nodes||[]).filter(n=>layer==='forecast'?label(n)==='Prediction':label(n)==='Pathway'&&n.uuid!=='learning-root');
      const candidates=rows;
      for(const n of candidates){const b=button('',()=>openStudy(n.uuid),'catalog-row');b.append(el('strong','',n.name),el('span','',n.attributes.subject||''),el('small','',layer==='forecast'?'复习假设 · 点击展开':'审题顺序 · 点击展开'));holder.append(b);}
      if(!candidates.length)holder.append(el('p','empty-copy','暂无匹配内容'));
      $('catalog-count').textContent=candidates.length+' 条';$('catalog-page').textContent='目录';$('catalog-prev').disabled=true;$('catalog-next').disabled=true;return;
    }
    holder.replaceChildren();const rows=sortedQuestions(),pages=Math.max(1,Math.ceil(rows.length/40));
    catalogPage=Math.max(0,Math.min(catalogPage,pages-1));
    for(const n of rows.slice(catalogPage*40,catalogPage*40+40)){
      const a=n.attributes,stem=n.summary.replace(/^\s*\d+[.、．]?\s*/,'').replace(/\s+/g,' ').slice(0,44);
      const b=button('',()=>activate(n.uuid),'catalog-row');
      b.append(el('strong','',stem),el('span','',n.name+' · '+a.subject+' · '+a.questionType),el('small','',a.extractionStatus==='自动提取'?'原卷第 '+a.sourcePage+' 页':'提取待核对 · 原卷第 '+a.sourcePage+' 页'));
      b.setAttribute('aria-current',String(selected?.data.uuid===n.uuid));holder.append(b);
    }
    if(!rows.length)holder.append(el('p','empty-copy','暂无匹配真题'));
    $('catalog-count').textContent=fmt(rows.length)+' / '+fmt(model.questions.length);
    $('catalog-page').textContent=(catalogPage+1)+' / '+pages;
    $('catalog-prev').disabled=catalogPage===0;$('catalog-next').disabled=catalogPage===pages-1;
  }
  function renderList() {
    const holder=$('question-list');holder.replaceChildren();
    const rows=sortedQuestions();
    for(const n of rows.slice(0,listLimit)) { const row=button('',()=>activate(n.uuid),'list-row');row.append(el('strong','',n.name),el('span','',n.attributes.subject),el('span','',n.summary));row.setAttribute('aria-current',String(selected?.data.uuid===n.uuid));holder.append(row); }
    if(!rows.length)holder.append(el('p','empty-copy','没有符合条件的题目。'));
    $('list-count').textContent=fmt(rows.length)+' 道';$('load-more').hidden=listLimit>=rows.length;
  }
  function setMode(next) {
    if(next==='list'&&layer!=='exams')setLayer('exams');
    const changed=mode!==next;mode=next;$('workspace').dataset.mode=mode;$('list-panel').hidden=mode!=='list';
    if(changed)closeOverlays();
    document.querySelectorAll('[data-mode]').forEach(b=>{if(b.tagName==='BUTTON')b.setAttribute('aria-pressed',String(b.dataset.mode===mode));});
    if(mode==='list')renderList();
    else if(changed)requestAnimationFrame(()=>requestAnimationFrame(()=>view.fit()));
  }
  function closeOverlays(){
    const changed=$('workspace').dataset.detail==='open';
    $('workspace').dataset.filters='closed';$('workspace').dataset.detail='closed';
    if($('graph-filters'))$('graph-filters').setAttribute('aria-expanded','false');
    if(changed&&view)requestAnimationFrame(()=>requestAnimationFrame(()=>view.fit()));
  }
  function fullscreenState(){
    if(!$('fullscreen'))return;
    const active=Boolean(document.fullscreenElement);
    $('fullscreen').textContent=active?'退出全屏':'进入全屏';$('fullscreen').setAttribute('aria-pressed',String(active));
    requestAnimationFrame(()=>requestAnimationFrame(()=>view.fit()));
  }
  async function toggleFullscreen(){
    setMode('graph');$('fullscreen-status').hidden=true;
    try {
      if(document.fullscreenElement)await document.exitFullscreen();
      else if(document.documentElement?.requestFullscreen)await document.documentElement.requestFullscreen();
      else throw Error('Fullscreen API unavailable');
      fullscreenState();
    } catch(error) {
      $('fullscreen-status').textContent='当前浏览器未允许系统全屏，关系网已铺满窗口。';$('fullscreen-status').hidden=false;
      fullscreenState();
    }
  }
  function showCoverage() {
    const root=$('coverage-content');root.replaceChildren();
    root.append(el('p','intro','共 '+model.data.sources.length+' 条来源记录。合订本的题量为该册合计；0 题表示没有可用题目入库。网站仅附提取题文和来源信息；离线版可在原目录打开 PDF。'));
    for(const s of model.data.sources){const row=el('div','source-row');const info=el('div');info.append(sourceLink(s.file,null,(s.year||'2005—2009')+' · '+s.paper+' · '+s.kind),el('small','',s.notes||''));row.append(info,el('span','',s.extractedCount+' 题'),el('span','',s.status));root.append(row);}
    const dialog=$('coverage-dialog');if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');
  }
  function downloadGraph() {
    const blob=new Blob([view.exportSVG()],{type:'image/svg+xml;charset=utf-8'}),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download='法硕真题关系网.svg';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  try {
    model=LawGraphModel.create(window.LAW_GRAPH);
    learning=LawLearningModel.create(window.LAW_LEARNING_DATA,model);
    $('selection-status').setAttribute('role','status');
    for(const id of ['from','to'])for(const y of model.data.meta.years){const o=el('option','',String(y));o.value=y;$(id).append(o);}
    for(const [id,values] of [['subject',model.data.meta.subjects],['type',model.data.meta.types]])for(const v of values){const o=el('option','',v);o.value=v;$(id).append(o);}
    $('from').value=model.data.meta.yearFrom;$('to').value=model.data.meta.yearTo;
    for(const p of learning.data.pathways){const o=el('option','',p.subject);o.value=p.subject;$('study-subject').append(o);}
    for(const s of learning.data.scenarios){const o=el('option','',s.name);o.value=s.id;$('study-scenario').append(o);}
    view=new LawGraphView($('graph-host'),{presentation:'dense',onSelect:showSelection,onStatus:s=>{$('graph-stats').textContent=fmt(s.nodes)+' 节点 / '+fmt(s.edges)+' 连线 · '+Math.round(s.zoom*100)+'%';}});
    document.querySelectorAll('button[data-mode]').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.mode)));
    document.querySelectorAll('[data-relation]').forEach(c=>c.addEventListener('change',apply));
    $('search').addEventListener('input',()=>{studyFocus='';if(layer!=='exams')closeOverlays();if($('full-search'))$('full-search').value=$('search').value;clearTimeout(timer);timer=setTimeout(apply,180);});
    if($('full-search'))$('full-search').addEventListener('input',()=>{studyFocus='';if(layer!=='exams')closeOverlays();$('search').value=$('full-search').value;clearTimeout(timer);timer=setTimeout(apply,180);});
    for(const id of ['subject','type'])$(id).addEventListener('change',apply);
    for(const id of ['from','to'])$(id).addEventListener('change',()=>{if(+$('from').value>+$('to').value)$(id==='from'?'to':'from').value=$(id).value;apply();});
    $('clear').addEventListener('click',clear);$('empty-clear').addEventListener('click',clear);
    for(const name of ['exams','learning','forecast'])$('layer-'+name).addEventListener('click',()=>setLayer(name));
    for(const id of ['study-subject','study-scenario'])$(id).addEventListener('change',()=>{studyFocus='';closeOverlays();renderStudy();});
    $('study-back').addEventListener('click',()=>{studyFocus='';closeOverlays();renderStudy();if(window.history?.replaceState)window.history.replaceState(null,'',window.location.pathname);});
    $('fit').addEventListener('click',()=>view.fit());$('reset').addEventListener('click',apply);
    $('labels').addEventListener('click',()=>{labels=!labels;view.setLabels(labels);$('labels').setAttribute('aria-pressed',String(labels));});
    $('export').addEventListener('click',downloadGraph);$('coverage-button').addEventListener('click',showCoverage);
    $('close-dialog').addEventListener('click',()=>{const d=$('coverage-dialog');if(d.close)d.close();else d.removeAttribute('open');});
    $('load-more').addEventListener('click',()=>{listLimit+=80;renderList();});
    if($('catalog-prev'))$('catalog-prev').addEventListener('click',()=>{catalogPage--;renderCatalog();$('catalog-list').scrollTop=0;});
    if($('catalog-next'))$('catalog-next').addEventListener('click',()=>{catalogPage++;renderCatalog();$('catalog-list').scrollTop=0;});
    if($('peek-close'))$('peek-close').addEventListener('click',()=>{$('peek-card').hidden=true;});
    if($('peek-open'))$('peek-open').addEventListener('click',()=>{if(mode==='graph'){$('workspace').dataset.detail='open';$('peek-card').hidden=true;}else setMode('split');$('detail').focus();});
    if($('fullscreen'))$('fullscreen').addEventListener('click',toggleFullscreen);
    if($('back-workbench'))$('back-workbench').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();}catch(error){/* Keep the workbench reachable if the host prevents exiting. */}setMode('split');$('fullscreen-status').hidden=true;});
    if($('graph-filters'))$('graph-filters').addEventListener('click',()=>{const open=$('workspace').dataset.filters!=='open';$('workspace').dataset.filters=open?'open':'closed';$('graph-filters').setAttribute('aria-expanded',String(open));if(open)$('search').focus();});
    if($('graph-detail-close'))$('graph-detail-close').addEventListener('click',()=>{$('workspace').dataset.detail='closed';requestAnimationFrame(()=>requestAnimationFrame(()=>view.fit()));});
    if(document.addEventListener){document.addEventListener('fullscreenchange',fullscreenState);document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('coverage-dialog').open){closeOverlays();$('peek-card').hidden=true;}});}
    window.addEventListener('pagehide',event=>{if(!event.persisted){clearTimeout(timer);view.destroy();}});
    $('labels').setAttribute('aria-pressed','true');
    $('corpus-status').textContent=model.data.meta.yearFrom+'—'+model.data.meta.yearTo+' 原卷 · 部分缺卷 / 自动提取';
    apply();
    setLayer('forecast');
    const requested=(window.location?.hash||'').slice(1);if(learning.byId.get(requested)?.attributes?.topicIds||learning.data.pathways.some(p=>p.id===requested))openStudy(requested);
    setMode(mode);
  } catch (error) { fail(error); }
})();
