/* Integration checks using a virtual DOM, not a browser preview. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=__dirname,fullEntry=process.argv.includes('--fullscreen');
const html=fs.readFileSync(path.join(root,fullEntry?'法硕真题关系网_全屏版.html':'index.html'),'utf8');
const graph=JSON.parse(fs.readFileSync(path.join(root,'data/graph.json'),'utf8'));
const learningData=JSON.parse(fs.readFileSync(path.join(root,'data/learning.json'),'utf8'));

class Element {
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.listeners={};this.attributes={};this.dataset={};this.style={};this.hidden=false;this.disabled=false;this.value='';this.className='';this._text='';}
  set textContent(value){this._text=String(value);this.children=[];}
  get textContent(){return this._text+this.children.map(x=>x.textContent||'').join('');}
  get firstChild(){return this.children[0]||null;}
  setAttribute(k,v){this.attributes[k]=String(v);}
  removeAttribute(k){delete this.attributes[k];}
  append(...nodes){nodes.forEach(n=>{this.children.push(n);n.parent=this;});}
  replaceChildren(...nodes){this.children=[];this._text='';this.append(...nodes);}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);}
  addEventListener(k,f){(this.listeners[k]??=[]).push(f);}
  fire(k,event={}){for(const f of this.listeners[k]||[])f({target:this,...event});}
  click(){this.fire('click');}
  showModal(){this.open=true;} close(){this.open=false;}
  focus(){this.focused=true;}
}
const allElements=n=>[n,...n.children.flatMap(allElements)];
const label=n=>n.labels[0];

function boot({protocol='file:',hash=''}={}){
  const ids={};
  for(const m of html.matchAll(/<([a-z][\w-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/g)){
    const e=new Element(m[1]);e.hidden=/\bhidden\b/.test(m[2]);e.className=(m[2].match(/\bclass="([^"]*)"/)||[])[1]||'';ids[m[3]]=e;
  }
  ids.workspace.dataset.mode=(html.match(/<main id="workspace" data-mode="([^"]+)"/)||[])[1]||'split';
  for(const id of ['catalog-list','catalog-next','catalog-prev','catalog-page','peek-card','peek-open','peek-close','layer-exams','layer-learning','layer-forecast','study-subject','study-scenario','study-back'])assert(ids[id],'missing workbench element: '+id);
  const modes=['graph','split','list'].map(mode=>{const e=new Element('button');e.dataset.mode=mode;return e;});
  const relations=['候选考点','科目','年份','题型'].map((relation,i)=>{const e=new Element('input');e.dataset.relation=relation;e.checked=i<2;return e;});
  let view;
  class View {
    constructor(host,opts){assert(host);this.opts=opts;view=this;}
    setData(data){this.data=data;this.opts.onStatus({nodes:data.nodes.length,edges:data.edges.length,zoom:1});}
    setLabels(value){this.labels=value;}
    select(id){const n=this.data.nodes.find(n=>n.uuid===id),e=this.data.edges.find(e=>e.uuid===id);if(!n&&!e)return false;this.opts.onSelect({type:n?'node':'edge',data:n||e});return true;}
    fit(){this.fits=(this.fits||0)+1;} destroy(){this.destroyed=true;} exportSVG(){return '<svg/>';}
  }
  const timers=new Map();let nextTimer=0;
  const location={protocol,hash,pathname:'/index.html'};
  const history={replaceState(_state,_title,url){if(String(url).startsWith('#'))location.hash=String(url);else{location.pathname=String(url);location.hash='';}}};
  const document={
    getElementById:id=>ids[id]||null,
    createElement:tag=>new Element(tag),
    querySelectorAll:q=>q==='button[data-mode]'?modes:q==='[data-mode]'?[ids.workspace,...modes]:q==='[data-relation]:checked'?relations.filter(x=>x.checked):q==='[data-relation]'?relations:[],
    addEventListener(){},
  };
  const context={window:null,document,location,history,LawGraphView:View,LawGraphModel:require('./graph-model.js'),LawLearningModel:require('./learning-model.js'),LAW_GRAPH:graph,LAW_LEARNING_DATA:learningData,addEventListener(){},requestAnimationFrame(f){f();return 1;},setTimeout(f){timers.set(++nextTimer,f);return nextTimer;},clearTimeout(id){timers.delete(id);},Blob,URL,console};
  context.window=context;
  vm.runInNewContext(fs.readFileSync(path.join(root,'app.js'),'utf8'),context,{filename:'app.js'});
  function flush(){for(const fn of [...timers.values()])fn();timers.clear();}
  return {ids,modes,relations,view,context,location,flush};
}

function countKind(view,kind){return view.data.nodes.filter(n=>label(n)===kind).length;}

async function verifyMain(){
  const {ids,modes,view,context,location,flush}=boot({protocol:'file:'});
  assert.equal(ids.workspace.dataset.mode,'graph');
  assert.equal(ids.workspace.dataset.layer,'forecast');
  assert(ids['error-banner'].hidden,ids['error-banner'].textContent);
  assert.equal(countKind(view,'Prediction'),learningData.predictions.length);
  assert.equal(learningData.predictions.length,20);
  assert.equal(ids['catalog-list'].children.length,20);
  assert(ids.summary.textContent.includes('20 个复习假设'));

  const prediction=view.data.nodes.find(n=>label(n)==='Prediction');
  view.select(prediction.uuid);
  assert.equal(ids['study-back'].hidden,false);
  assert.equal(location.hash,'#'+prediction.uuid);
  assert(ids['detail-content'].textContent.includes('从零开始怎么做'));
  assert(ids['detail-content'].textContent.includes('原创练习'));
  assert(ids['detail-content'].textContent.includes('这个假设的边界'));
  assert(countKind(view,'Topic')>0);
  assert(countKind(view,'Question')>0);
  ids['study-back'].click();
  assert.equal(ids['study-back'].hidden,true);
  assert.equal(location.hash,'');
  assert.equal(countKind(view,'Prediction'),20);

  ids['layer-learning'].click();
  assert.equal(ids.workspace.dataset.layer,'learning');
  assert.equal(countKind(view,'Pathway'),learningData.pathways.length+1);
  const pathway=view.data.nodes.find(n=>label(n)==='Pathway'&&n.uuid!=='learning-root');
  view.select(pathway.uuid);
  assert(ids['detail-content'].textContent.includes('建议顺序'));
  const stepButton=allElements(ids['detail-content']).find(n=>n.tagName==='BUTTON'&&/^2\./.test(n.textContent));
  assert(stepButton,'pathway detail should expose a step connected to a forecast topic');stepButton.click();
  assert(ids['detail-content'].textContent.includes('连接到具体考点'));
  const topicButton=allElements(ids['detail-content']).find(n=>n.tagName==='BUTTON'&&n.className==='related-row');
  assert(topicButton,'step should link to a concrete topic');topicButton.click();
  assert(ids['detail-content'].textContent.includes('沿此考点看 2027 考向'));
  const forecastButton=allElements(ids['detail-content']).find(n=>n.tagName==='BUTTON'&&learningData.predictions.some(p=>p.title===n.textContent));
  assert(forecastButton,'topic should link onward to a 2027 branch');forecastButton.click();
  assert.equal(ids.workspace.dataset.layer,'forecast');
  assert(ids['detail-content'].textContent.includes('2027 复习假设'));

  ids['study-back'].click();
  ids['study-subject'].value='刑法';ids['study-subject'].fire('change');
  const expectedSubject=learningData.predictions.filter(p=>p.subject==='刑法').length;
  assert.equal(countKind(view,'Prediction'),expectedSubject);
  ids['study-scenario'].value='rotation';ids['study-scenario'].fire('change');
  const expectedIntersection=learningData.predictions.filter(p=>p.subject==='刑法'&&p.scenarioId==='rotation').length;
  assert.equal(countKind(view,'Prediction'),expectedIntersection);
  ids['study-subject'].value='';ids['study-scenario'].value='';ids['study-subject'].fire('change');
  ids.search.value='ZZZ_THIS_QUERY_IS_NOT_IN_THE_FORECAST';ids.search.fire('input');flush();
  assert.equal(view.data.nodes.length,0);
  assert.equal(ids['graph-empty'].hidden,false);
  assert.equal(ids['catalog-list'].children.length,1,'no-result catalog should show one empty-state message, not all forecasts');
  assert(ids['catalog-list'].textContent.includes('暂无匹配内容'));
  ids['empty-clear'].click();
  assert.equal(countKind(view,'Prediction'),20);
  assert.equal(ids['graph-empty'].hidden,true);

  ids['layer-exams'].click();
  assert.equal(ids.workspace.dataset.layer,'exams');
  assert.equal(view.data.questions.length,graph.meta.questionCount);
  assert.equal(view.opts.presentation,'dense');
  assert.equal(ids['catalog-list'].children.length,40);
  const first=ids['catalog-list'].children[0].textContent;
  ids['catalog-next'].click();assert.notEqual(ids['catalog-list'].children[0].textContent,first);
  ids['catalog-prev'].click();assert.equal(ids['catalog-list'].children[0].textContent,first);
  const q=view.data.questions.find(q=>q.attributes.topics.length);
  view.select(q.uuid);
  assert(ids['detail-content'].textContent.includes(q.summary));
  if(ids['peek-card']){assert(!ids['peek-card'].hidden);assert(ids['peek-body'].textContent.includes(q.summary));ids['peek-close'].click();assert(ids['peek-card'].hidden);}
  const source=allElements(ids['detail-content']).find(n=>n.className.includes('source-link'));
  assert.equal(source.tagName,'A');assert(source.href.startsWith('../'));assert(source.href.endsWith('#page='+q.attributes.sourcePage));
  const oldTopicButton=allElements(ids['detail-content']).find(n=>n.tagName==='BUTTON'&&n.parent.className==='topic-chips');oldTopicButton.click();
  assert(ids['detail-content'].textContent.includes('跨知识点连接'));
  modes[2].click();assert(!ids['list-panel'].hidden);assert.equal(ids['question-list'].children.length,80);
  ids['load-more'].click();assert.equal(ids['question-list'].children.length,160);
  ids.subject.value='刑法';ids.subject.fire('change');assert(view.data.questions.every(q=>q.attributes.subject==='刑法'));
  ids.from.value='2025';ids.from.fire('change');assert(view.data.questions.every(q=>q.attributes.year>=2025));
  ids.search.value='ZZZ_THIS_QUERY_IS_NOT_IN_THE_CORPUS';ids.search.fire('input');flush();
  assert.equal(view.data.questions.length,0);assert(!ids['graph-empty'].hidden);
  ids['empty-clear'].click();assert.equal(view.data.questions.length,graph.meta.questionCount);
  ids['coverage-button'].click();assert(ids['coverage-dialog'].open);assert.equal(ids['coverage-content'].children.length,graph.sources.length+1);
  ids['close-dialog'].click();assert(!ids['coverage-dialog'].open);
  const edge=view.data.edges.find(e=>e.attributes.method==='keyword');view.select(edge.uuid);assert(ids['detail-content'].textContent.includes(edge.fact));
  modes[0].click();view.select(q.uuid);assert.equal(ids.workspace.dataset.mode,'graph');
  if(ids['peek-open']){ids['peek-open'].click();assert.equal(ids.workspace.dataset.detail,'open');assert(ids.detail.focused);ids['graph-detail-close'].click();assert.equal(ids.workspace.dataset.detail,'closed');}
  ids['graph-filters'].click();assert.equal(ids.workspace.dataset.filters,'open');ids['graph-filters'].click();assert.equal(ids.workspace.dataset.filters,'closed');
  ids['full-search'].value='正当防卫';ids['full-search'].fire('input');flush();assert.equal(ids.search.value,'正当防卫');assert(view.data.questions.length>0);ids.clear.click();
  ids.labels.click();assert.equal(view.labels,false);

  await ids.fullscreen.listeners.click[0]();assert(!ids['fullscreen-status'].hidden);assert.equal(ids.workspace.dataset.mode,'graph');
  context.document.documentElement={requestFullscreen:async()=>{throw Error('Denied');}};
  await ids.fullscreen.listeners.click[0]();assert(!ids['fullscreen-status'].hidden);assert.equal(ids['error-banner'].hidden,true);
  context.document.documentElement.requestFullscreen=async()=>{context.document.fullscreenElement=context.document.documentElement;};
  context.document.exitFullscreen=async()=>{context.document.fullscreenElement=null;};
  await ids.fullscreen.listeners.click[0]();assert.equal(ids.fullscreen.attributes['aria-pressed'],'true');assert(ids['fullscreen-status'].hidden);
  await ids.fullscreen.listeners.click[0]();assert.equal(ids.fullscreen.attributes['aria-pressed'],'false');
  await ids.fullscreen.listeners.click[0]();await ids['back-workbench'].listeners.click[0]();assert.equal(ids.workspace.dataset.mode,'split');assert.equal(context.document.fullscreenElement,null);assert.equal(view.labels,false);
}

function verifyHosted(){
  const {ids,view}=boot({protocol:'https:'});
  ids['layer-exams'].click();
  const q=view.data.questions.find(q=>q.attributes.topics.length);view.select(q.uuid);
  const source=allElements(ids['detail-content']).find(n=>n.className.includes('source-link'));
  assert(source,'hosted question should explain source availability');
  assert.equal(source.tagName,'SPAN');
  assert(source.textContent.includes('网站未附原卷'));
  assert.equal(allElements(ids['detail-content']).some(n=>n.tagName==='A'&&String(n.href||'').startsWith('../')),false);
}

function verifyDeepLink(){
  const target=learningData.predictions[3];
  const {ids,view,location}=boot({protocol:'https:',hash:'#'+target.id});
  assert.equal(ids.workspace.dataset.layer,'forecast');
  assert.equal(ids['study-back'].hidden,false);
  assert.equal(location.hash,'#'+target.id);
  assert.equal(countKind(view,'Prediction'),1);
  assert(ids['detail-content'].textContent.includes(target.title));
  assert(ids['detail-content'].textContent.includes('此分支的独立链接'));
}

verifyMain().then(()=>{
  verifyHosted();verifyDeepLink();
  console.log(JSON.stringify({ok:true,entry:fullEntry?'fullscreen':'workbench',questions:graph.meta.questionCount,predictions:learningData.predictions.length,checks:['forecast-default','forecast-expand','study-back','pathway-step-topic-forecast','study-filters','study-empty-clear','exam-regression','source-file-link','hosted-source-suppression','deep-link','list-pagination','catalog-pagination','fullscreen-enter-exit']},null,2));
}).catch(error=>{console.error(error);process.exitCode=1;});
