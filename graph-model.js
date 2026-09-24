/* Offline graph data/query helpers. No framework or network dependencies. */
(function(root){
  'use strict';
  function validate(data){
    if(!data||!Array.isArray(data.nodes)||!Array.isArray(data.edges))throw Error('图谱需要 nodes 和 edges 数组。');
    const ids=new Set();
    for(const n of data.nodes){if(!n.uuid||ids.has(n.uuid))throw Error('节点 ID 缺失或重复。');ids.add(n.uuid);}
    const eids=new Set();
    for(const e of data.edges){if(!e.uuid||eids.has(e.uuid))throw Error('关系 ID 缺失或重复。');eids.add(e.uuid);if(!ids.has(e.source_node_uuid)||!ids.has(e.target_node_uuid))throw Error('关系端点不存在。');}
    return true;
  }
  function create(data){
    validate(data);
    const byId=new Map(data.nodes.map(n=>[n.uuid,n]));
    const adjacent=new Map(data.nodes.map(n=>[n.uuid,[]]));
    for(const e of data.edges){adjacent.get(e.source_node_uuid).push(e);adjacent.get(e.target_node_uuid).push(e);}
    const questions=data.nodes.filter(n=>n.labels[0]==='Question');
    function filter(f={}){
      const query=(f.query||'').trim().toLowerCase();
      const qs=questions.filter(n=>{const a=n.attributes;return (!f.subject||a.subject===f.subject)&&(!f.from||a.year>=+f.from)&&(!f.to||a.year<=+f.to)&&(!f.type||a.questionType===f.type)&&(!query||[n.name,n.summary,a.year,a.subject,a.questionType,...(a.topics||[]).map(id=>byId.get('topic-'+id)?.name||'')].join(' ').toLowerCase().includes(query));});
      const ids=new Set(qs.map(n=>n.uuid));
      const edges=[];const enabled=new Set(f.relations||['科目','候选考点']);
      for(const e of data.edges){if(ids.has(e.source_node_uuid)&&enabled.has(e.name)){edges.push(e);}}
      for(const e of edges){ids.add(e.source_node_uuid);ids.add(e.target_node_uuid);}
      for(const e of data.edges){if(f.concepts!==false&&e.attributes?.method==='concept'&&ids.has(e.source_node_uuid)&&ids.has(e.target_node_uuid))edges.push(e);}
      return {nodes:data.nodes.filter(n=>ids.has(n.uuid)),edges,questions:qs};
    }
    function neighbors(id){return (adjacent.get(id)||[]).map(e=>({edge:e,node:byId.get(e.source_node_uuid===id?e.target_node_uuid:e.source_node_uuid)}));}
    function relatedQuestions(id,eligible){const allow=eligible?new Set(eligible.map(n=>n.uuid)):null;return neighbors(id).filter(x=>x.node.labels[0]==='Question'&&(!allow||allow.has(x.node.uuid))).sort((a,b)=>b.node.attributes.year-a.node.attributes.year||a.node.attributes.number-b.node.attributes.number);}
    return {data,byId,questions,filter,neighbors,relatedQuestions};
  }
  root.LawGraphModel={validate,create};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.LawGraphModel;
})(typeof window!=='undefined'?window:globalThis);
