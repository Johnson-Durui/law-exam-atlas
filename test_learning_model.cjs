/* Pure data and topology checks for authored learning and forecast graphs. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=__dirname;
const examData=JSON.parse(fs.readFileSync(path.join(root,'data/graph.json'),'utf8'));
const learningData=JSON.parse(fs.readFileSync(path.join(root,'data/learning.json'),'utf8'));
const examModel=require('./graph-model.js').create(examData);
const model=require('./learning-model.js').create(learningData,examModel);

assert.equal(learningData.meta.targetYear,2027);
assert.equal(learningData.predictions.length,20);
assert.equal(learningData.pathways.length,5);
assert.equal(new Set(learningData.predictions.map(p=>p.id)).size,20);
assert.deepEqual([...new Set(learningData.predictions.map(p=>p.subject))].sort(),['刑法','民法','法制史','法理学','宪法学'].sort());

function verifyGraph(result,name){
  const ids=new Set(result.nodes.map(n=>n.uuid));
  assert.equal(ids.size,result.nodes.length,name+' node ids must be unique');
  assert.equal(new Set(result.edges.map(e=>e.uuid)).size,result.edges.length,name+' edge ids must be unique');
  for(const n of result.nodes){
    assert(n.attributes&&n.attributes.layout,name+' node lacks fixed layout: '+n.uuid);
    assert(Number.isFinite(n.attributes.layout.x)&&Number.isFinite(n.attributes.layout.y),name+' node has invalid layout: '+n.uuid);
  }
  for(const e of result.edges){
    assert(ids.has(e.source_node_uuid),name+' missing edge source '+e.source_node_uuid);
    assert(ids.has(e.target_node_uuid),name+' missing edge target '+e.target_node_uuid);
  }
  assert.equal(result.nodes.some(n=>n.labels[0]==='Question'&&n.attributes.year===2027),false,name+' must not fabricate a 2027 Question');
}

verifyGraph(model.forecast(),'forecast overview');
verifyGraph(model.learning(),'learning overview');
for(const p of learningData.predictions){
  const result=model.forecast({focus:p.id});verifyGraph(result,p.id);
  assert(result.nodes.some(n=>n.uuid===p.id),p.id+' focus missing prediction node');
  for(const topicId of p.topicIds)assert(result.nodes.some(n=>n.uuid==='topic-'+topicId),p.id+' focus missing topic '+topicId);
  for(const evidence of p.evidence){
    const q=examModel.byId.get(evidence.questionId);
    assert(q,p.id+' evidence id missing: '+evidence.questionId);
    assert.equal(q.labels[0],'Question');
    assert.equal(q.attributes.extractionStatus,'自动提取',p.id+' evidence must use a reliable extracted question');
    assert.equal(q.attributes.subject,p.subject,p.id+' evidence subject mismatch');
    assert(result.nodes.some(n=>n.uuid===evidence.questionId),p.id+' focus omits evidence node');
    assert(p.topicIds.includes(evidence.topicId),p.id+' evidence references a topic outside the branch');
  }
}
for(const p of learningData.pathways){
  const result=model.learning({focus:p.id});verifyGraph(result,p.id);
  assert(result.nodes.some(n=>n.uuid===p.id),p.id+' focus missing pathway node');
  p.steps.forEach((_step,i)=>assert(result.nodes.some(n=>n.uuid===p.id+'-step-'+i),p.id+' missing step '+i));
}

const noForecast=model.forecast({query:'ZZZ_NO_SUCH_FORECAST'});
const noLearning=model.learning({query:'ZZZ_NO_SUCH_PATHWAY'});
assert.equal(noForecast.nodes.length,0);assert.equal(noForecast.edges.length,0);
assert.equal(noLearning.nodes.length,0);assert.equal(noLearning.edges.length,0);
const criminalRotation=model.forecast({subject:'刑法',scenario:'rotation'});
assert.equal(criminalRotation.nodes.filter(n=>n.labels[0]==='Prediction').length,learningData.predictions.filter(p=>p.subject==='刑法'&&p.scenarioId==='rotation').length);

console.log(JSON.stringify({ok:true,predictions:learningData.predictions.length,pathways:learningData.pathways.length,checks:['edge-endpoints','fixed-layout','filters','evidence-status','evidence-subject','no-fake-2027-question']},null,2));
