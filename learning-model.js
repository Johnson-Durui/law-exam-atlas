/* Authored learning paths and explicitly speculative forecast branches. */
(function (root) {
  'use strict';
  function create(data, exams) {
    if (!data || !Array.isArray(data.predictions) || !Array.isArray(data.pathways)) throw Error('学习路径数据缺失');
    const byId = new Map(), scenarios = new Map(data.scenarios.map(s => [s.id, s]));
    function node(id, name, kind, summary, attributes = {}) {
      const n = {uuid:id, name, labels:[kind], summary, attributes}; byId.set(id,n); return n;
    }
    node('forecast-2027','2027 考向','Forecast',data.meta.notice);
    node('learning-root','从题目到结论','Pathway','先定位问题，再找条件、例外与结论。连线表示建议的学习顺序，不是法律上的推导定理。');
    for (const s of data.scenarios) node('scenario-'+s.id,s.name,'Scenario',s.summary,{scenarioId:s.id});
    for (const p of data.predictions) {
      if (byId.has(p.id) || !scenarios.has(p.scenarioId)) throw Error('考向 ID 或情景无效：'+p.id);
      for (const t of p.topicIds) if (!exams.byId.has('topic-'+t)) throw Error('未知考点：'+t);
      for (const e of p.evidence) if (!exams.byId.has(e.questionId)) throw Error('未知证据题：'+e.questionId);
      node(p.id,p.title,'Prediction',p.rationale,p);
    }
    for (const p of data.pathways) {
      node(p.id,p.subject+' · 审题路线','Pathway',p.title,p);
      p.steps.forEach((s,i)=>node(p.id+'-step-'+i,(i+1)+'. '+s.title,'Step',s.prompt,{...s,subject:p.subject,pathwayId:p.id,order:i}));
    }
    function graph() {
      const nodes=new Map(),edges=[];
      return {put(n,x,y){if(n&&!nodes.has(n.uuid))nodes.set(n.uuid,{...n,attributes:{...n.attributes,layout:{x,y}}});return n;},
        link(a,b,name,fact,method='learning'){if(!a||!b)return;const uuid='learn-edge-'+a.uuid+'-'+b.uuid;if(!edges.some(e=>e.uuid===uuid))edges.push({uuid,source_node_uuid:a.uuid,target_node_uuid:b.uuid,name,fact,attributes:{method}});},
        done(){return {nodes:[...nodes.values()],edges,layout:'logic'};}};
    }
    const topic = id => exams.byId.get('topic-'+id);
    function forecast({subject='',scenario='',query='',focus=''}={}) {
      const g=graph(), p=data.predictions.find(x=>x.id===focus);
      if(p){
        const start=g.put(byId.get('scenario-'+p.scenarioId),0,0),center=g.put(byId.get(p.id),310,0);
        g.link(start,center,'假设分支',scenarios.get(p.scenarioId).summary,'forecast');
        const topics=p.topicIds.map(topic);topics.forEach((t,i)=>{g.put(t,650,(i-(topics.length-1)/2)*180);g.link(center,t,'建议复习','此考向的复习范围；不是确定命题范围。','forecast');});
        const evidence=[...new Map(p.evidence.map(e=>[e.questionId,e])).values()];
        evidence.forEach((e,i)=>g.put(exams.byId.get(e.questionId),1030,(i-(evidence.length-1)/2)*150));
        p.evidence.forEach(e=>{const t=topics.find(t=>t.attributes.topicId===e.topicId);if(t)g.link(t,exams.byId.get(e.questionId),'词语线索',e.evidence,'keyword');});
      } else {
        const q=query.trim().toLowerCase();
        const rows=data.predictions.filter(p=>(!subject||p.subject===subject)&&(!scenario||p.scenarioId===scenario)&&(!q||[p.title,p.rationale,p.subject,...p.topicIds.map(id=>topic(id).name)].join(' ').toLowerCase().includes(q)));
        if(rows.length){const center=g.put(byId.get('forecast-2027'),0,0);let offset=-(rows.length-1)*38;
          for(const s of data.scenarios){const group=rows.filter(p=>p.scenarioId===s.id);if(!group.length)continue;const middle=offset+(group.length-1)*38;const sn=g.put(byId.get('scenario-'+s.id),290,middle);g.link(center,sn,'情景假设',s.summary,'forecast');
            group.forEach(p=>{const pn=g.put(byId.get(p.id),660,offset);g.link(sn,pn,'备考方向',p.rationale,'forecast');offset+=76;});offset+=36;}
        }
      }
      return g.done();
    }
    function learning({subject='',query='',focus=''}={}) {
      const g=graph(),p=data.pathways.find(x=>x.id===focus);
      if(p){
        let previous=g.put(byId.get(p.id),0,0);
        p.steps.forEach((s,i)=>{const sn=g.put(byId.get(p.id+'-step-'+i),280+i*290,0);g.link(previous,sn,i?'接着判断':'从这里开始',s.prompt);previous=sn;
          s.topicIds.forEach((id,j)=>{const t=topic(id);if(t){g.put(t,280+i*290,150+j*90);g.link(sn,t,'用到的考点',s.prompt);}});
        });
      } else {
        const q=query.trim().toLowerCase();const paths=data.pathways.filter(p=>(!subject||p.subject===subject)&&(!q||[p.title,p.subject,...p.steps.flatMap(s=>[s.title,s.prompt,...s.topicIds.map(id=>topic(id)?.name||'')])].join(' ').toLowerCase().includes(q)));
        if(paths.length){const start=g.put(byId.get('learning-root'),0,0);paths.forEach((p,i)=>{const y=(i-(paths.length-1)/2)*250;const pn=g.put(byId.get(p.id),300,y);g.link(start,pn,'按科目定位',p.title);
          p.steps.slice(0,3).forEach((s,j)=>{const sn=g.put(byId.get(p.id+'-step-'+j),650,y+(j-1)*65);g.link(pn,sn,j?'判断步骤':'先问自己',s.prompt);});});}
      }
      return g.done();
    }
    return {data,byId,scenarios,forecast,learning};
  }
  root.LawLearningModel={create};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.LawLearningModel;
})(typeof window!=='undefined'?window:globalThis);
