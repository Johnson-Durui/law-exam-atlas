"""将可追溯题库与考点词表转换为离线 MiroFish-compatible 图谱。"""
from pathlib import Path
from collections import Counter
import json
import re

ROOT = Path(__file__).resolve().parent

def build(corpus, topics):
    normalize_subject=lambda s: '法制史' if s=='中国法制史' else s
    questions = [dict(q,subject=normalize_subject(q['subject'])) for q in corpus['questions']]
    topics = [dict(t,subject=normalize_subject(t['subject'])) for t in topics]
    assert len({q['id'] for q in questions}) == len(questions), '题目ID重复'
    assert len({t['id'] for t in topics}) == len(topics), '考点ID重复'
    known_topics = {t['id'] for t in topics}
    nodes, edges = [], []
    def node(uid, name, label, summary='', **attrs):
        nodes.append(dict(uuid=uid, name=name, labels=[label], summary=summary, attributes=attrs))
    def edge(a, b, name, fact, **attrs):
        edges.append(dict(uuid=f'e-{len(edges)+1}', source_node_uuid=a, target_node_uuid=b,
                          name=name, fact_type=name, fact=fact, attributes=attrs))
    years=sorted({q['year'] for q in questions})
    subjects=sorted({q['subject'] for q in questions})
    types=sorted({q['questionType'] for q in questions})
    for y in years:node(f'year-{y}',str(y)+'年','Year',year=y)
    for s in subjects:node('subject-'+s,s,'Subject',subject=s)
    for t in types:node('type-'+t,t,'Type',questionType=t)
    for t in topics:
        node('topic-'+t['id'],t['name'],'Topic',t.get('prompt',''),
             subject=t['subject'],chapter=t.get('chapter',''),keywords=t['keywords'],topicId=t['id'])
    topic_counts=Counter()
    for q in questions:
        label=f"{q['year']} {'基础' if q['paper']=='基础课' else '综合'}·{q['number']:02}"
        attrs=dict(q)
        attrs['topics']=[]
        node(q['id'],label,'Question',q['text'],**attrs)
        edge(q['id'],f"year-{q['year']}",'年份',f"来源试卷标注年份：{q['year']}。",method='metadata')
        edge(q['id'],'subject-'+q['subject'],'科目',f"科目归类方式：{q.get('subjectMethod','题号推定')}。",method='metadata')
        edge(q['id'],'type-'+q['questionType'],'题型',f"题型：{q['questionType']}；以原卷题型标题核对。",method='metadata')
        compact=re.sub(r'\s+','',q['text'])
        for t in topics:
            if q['subject']!='待核对' and q['subject']!=t['subject']:continue
            if q['subject']=='待核对':
                if q['paper']=='基础课' and t['subject'] not in ['刑法','民法']:continue
                if q['paper']=='综合课' and t['subject'] in ['刑法','民法']:continue
            hits=[k for k in t['keywords'] if len(k)>=2 and k in compact]
            if not hits:continue
            keyword=max(hits,key=len); pos=compact.find(keyword)
            snippet=compact[max(0,pos-18):pos+len(keyword)+35]
            attrs['topics'].append(t['id']); topic_counts[t['id']]+=1
            edge(q['id'],'topic-'+t['id'],'候选考点',
                 f'题干或选项命中“{keyword}”：{snippet}。这是关键词关联，需结合原题核对。',
                 method='keyword',automatic=True,keywords=hits,evidence=snippet,subject=q['subject'])
    related_seen=set()
    for t in topics:
        for rel in t.get('related',[]):
            if rel['id'] not in known_topics:raise ValueError(f"失效考点引用：{rel['id']}")
            key=tuple(sorted([t['id'],rel['id']]))
            if key in related_seen:continue
            related_seen.add(key)
            edge('topic-'+t['id'],'topic-'+rel['id'],rel['relation'],rel['reason'],method='concept')
    for n in nodes:
        if n['labels']==['Topic']:n['attributes']['questionCount']=topic_counts[n['attributes']['topicId']]
    ids={n['uuid'] for n in nodes}
    assert all(e['source_node_uuid'] in ids and e['target_node_uuid'] in ids for e in edges)
    assert len(ids)==len(nodes)
    stats={'questionCount':len(questions),'topicCount':len(topics),'nodeCount':len(nodes),'edgeCount':len(edges),
           'yearFrom':min(years),'yearTo':max(years),'matchedQuestionCount':sum(bool(n['attributes'].get('topics')) for n in nodes if n['labels']==['Question']),
           'years':years,'subjects':subjects,'types':types,'questionsByYear':dict(Counter(q['year'] for q in questions)),
           'relationsByType':dict(Counter(e['name'] for e in edges))}
    return {'nodes':nodes,'edges':edges,'meta':stats,'sources':corpus['sources'],
            'notes':['考点是题干/选项关键词自动匹配的候选关系，不代表人工确定的考点或标准答案。',
                     '跨科联系是学习关系，不表示不同法律规则可以互相替代；法制史仅作历史比较。',
                     '未采用此前生成的押题卷；PDF 自动提取的断行、页码与科目归类仍建议核对原卷。']}

if __name__=='__main__':
    corpus=json.loads((ROOT/'data/corpus.json').read_text(encoding='utf-8'))
    topics=json.loads((ROOT/'data/topics.json').read_text(encoding='utf-8'))
    if isinstance(topics,dict):topics=topics['topics']
    graph=build(corpus,topics)
    data=json.dumps(graph,ensure_ascii=False,separators=(',',':'))
    (ROOT/'data/graph.json').write_text(data,encoding='utf-8')
    (ROOT/'data/graph.js').write_text('window.LAW_GRAPH='+data+';\n',encoding='utf-8')
    print(json.dumps(graph['meta'],ensure_ascii=True,indent=2))
