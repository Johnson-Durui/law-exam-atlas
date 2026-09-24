"""Build the explainable 2027 study-forecast layer from verified local graph IDs.

Forecast wording is authored study guidance.  Evidence is selected only from the
existing automatic keyword links and remains explicitly a candidate relation.
"""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"


SCENARIOS = [
    {
        "id": "rotation",
        "name": "常规轮换",
        "summary": "设想核心制度再次出现时更换事实、切换题型或考查相邻规则；这是复习情景，不是命题概率。",
    },
    {
        "id": "revisit",
        "name": "补充覆盖",
        "summary": "把复习重心放到近年材料中容易被忽略的制度条件、例外和比较项；不能据此断言某章必考。",
    },
    {
        "id": "transfer",
        "name": "情境迁移",
        "summary": "把既有规则放入平台、数据、远程交易或公共治理等新事实中，先识别传统法律问题，再适用已掌握的规则。",
    },
]


PREDICTIONS = [
    {
        "id": "forecast-cr-01", "title": "故意、过失与认识错误的连续判断", "subject": "刑法", "scenarioId": "rotation",
        "topicIds": ["cr06", "cr07", "cr03"], "questionTypes": ["单选", "案例分析"],
        "rationale": "主观罪过、事实认识和结果归责可以在同一事实链上连续设问，适合考查分步判断能力。",
        "uncertainty": "也可能只拆成一个选择题；不得把三个考点同时出现理解为确定命题安排。",
        "steps": ["圈出行为人实际认识的对象、手段和结果。", "分别写下希望、放任、轻信避免或未预见。", "再查介入因素，避免以结果反推主观罪过。"],
        "practice": {"prompt": "原创拟题：甲误认包裹内容并交给自动设备处理，设备故障造成额外结果。分层判断甲的认识错误、主观罪过和结果归责。", "checkpoints": ["认识事实与实际事实分栏", "主观要素和因果关系分开", "写出不能仅凭结果归罪"]},
    },
    {
        "id": "forecast-cr-02", "title": "停止形态、共同犯罪与中途退出", "subject": "刑法", "scenarioId": "rotation",
        "topicIds": ["cr08", "cr09"], "questionTypes": ["多选", "案例分析"],
        "rationale": "着手、自动性、有效防止结果和共同犯罪中的退出责任形成清晰的时间线，便于用变体事实考查。",
        "uncertainty": "中途退出并非独立固定题型，具体结论取决于行为阶段、分工及是否有效消除影响。",
        "steps": ["按预备、着手、结果发生标时间点。", "逐人写行为、故意和分工。", "对退出者核对自动性以及是否有效阻止结果。"],
        "practice": {"prompt": "原创拟题：三人商议实施犯罪，一人在实行前反悔并发送警告，但其他人改变方案继续。分别判断各人的形态与责任范围。", "checkpoints": ["逐人判断", "标出着手点", "说明警告是否实际阻断因果链"]},
    },
    {
        "id": "forecast-cr-03", "title": "单位、身份与职务便利的责任分层", "subject": "刑法", "scenarioId": "revisit",
        "topicIds": ["cr10", "cr15", "cr12"], "questionTypes": ["单选", "简答", "案例分析"],
        "rationale": "组织意志、自然人身份、财物来源和处罚情节需要分层审查，适合补齐只背罪名而不看主体的薄弱点。",
        "uncertainty": "单位是否能成为主体及处罚方式必须以具体罪名的明文规定为准，不能套用统一模板。",
        "steps": ["先分单位行为与个人行为。", "核对身份、单位意志、单位利益及职务便利。", "定性后再处理自首、立功、累犯等量刑制度。"],
        "practice": {"prompt": "原创拟题：公司负责人以公司名义安排收付款，部分款项进入个人账户。列出单位与个人责任判断所需事实。", "checkpoints": ["主体不混同", "财物来源和去向明确", "定罪与量刑分开"]},
    },
    {
        "id": "forecast-cr-04", "title": "网络控制场景中的占有转移与罪数", "subject": "刑法", "scenarioId": "transfer",
        "topicIds": ["cr13", "cr11", "cr01"], "questionTypes": ["多选", "案例分析"],
        "rationale": "账号、远程控制和平台操作只是新事实外壳，核心仍是原占有、处分行为、取得机制及规范竞合。",
        "uncertainty": "情境迁移不等于预测新增罪名或新解释；作答必须回到题目提供的现行规则和事实。",
        "steps": ["先画财物或控制权限的原占有与转移路径。", "判断转移来自秘密取得、被害人处分还是代为保管后拒还。", "出现多个评价时再数行为、法益和罪名关系。"],
        "practice": {"prompt": "原创拟题：甲通过远程登录改变平台账户控制并转出虚拟化财产。只依据题给规则，比较不同占有转移结构。", "checkpoints": ["技术动作翻译成法律动作", "先占有后罪名", "罪数分析不得重复评价"]},
    },

    {
        "id": "forecast-cv-01", "title": "代理外观与法律行为效力链", "subject": "民法", "scenarioId": "rotation",
        "topicIds": ["cv03", "cv02", "cv07"], "questionTypes": ["单选", "案例分析"],
        "rationale": "代理权、权利外观、相对人状态与意思表示瑕疵经常需要按顺序判断，适合用同一交易连续追问。",
        "uncertainty": "表见代理、追认和可撤销事由各有独立条件，不能因结果相似而合并论证。",
        "steps": ["确认谁以谁的名义作出表示。", "先查真实代理权，再查权利外观和相对人善意无过失。", "最后另查欺诈、重大误解等效力瑕疵。"],
        "practice": {"prompt": "原创拟题：离职员工仍持有公司授权材料并与善意相对人签约，公司随后作出含混回复。分析效果归属和行为效力。", "checkpoints": ["代理权时间点", "善意无过失事实", "追认与撤销路径分开"]},
    },
    {
        "id": "forecast-cv-02", "title": "合同履行、保全与转让的先后顺序", "subject": "民法", "scenarioId": "revisit",
        "topicIds": ["cv08", "cv09", "cv10"], "questionTypes": ["多选", "案例分析"],
        "rationale": "成立、履行抗辩、债权保全和转让通知处于不同阶段，按时间轴组织可覆盖容易混淆的请求权路径。",
        "uncertainty": "题目可能只考一个环节；代位、撤销、抗辩与转让的条件不可相互替代。",
        "steps": ["先判断合同是否成立并生效。", "标明双方履行顺序和当前违约状态。", "再问债务人财产行为是否危及债权，最后处理转让及通知。"],
        "practice": {"prompt": "原创拟题：债务人未履行合同，又处分对第三人的债权；债权人随后将本债权转让。列出各阶段可主张的制度。", "checkpoints": ["成立与履行分开", "抗辩与保全分开", "通知对象和时间明确"]},
    },
    {
        "id": "forecast-cv-03", "title": "物权公示、担保竞合与保证责任", "subject": "民法", "scenarioId": "rotation",
        "topicIds": ["cv04", "cv11", "cv12"], "questionTypes": ["单选", "多选", "案例分析"],
        "rationale": "公示方式、担保设立、实现顺序和人的担保可以构成一条完整清偿链，适合比较题和案例题。",
        "uncertainty": "具体顺位和保证效果高度依赖题目给出的登记、交付、约定及期间事实。",
        "steps": ["逐项列财产、担保类型与公示时间。", "先判每项担保是否设立或可对抗。", "排物保顺位后，再单列保证方式、期间和抗辩。"],
        "practice": {"prompt": "原创拟题：同一设备先后设定不同担保，并由第三人提供保证。依据题给时间点画出受偿与保证责任路径。", "checkpoints": ["公示时间表", "物保与人保分栏", "保证期间不等同诉讼时效"]},
    },
    {
        "id": "forecast-cv-04", "title": "平台数据场景中的人格权与侵权归责", "subject": "民法", "scenarioId": "transfer",
        "topicIds": ["cv01", "cv15", "cv16"], "questionTypes": ["简答", "案例分析"],
        "rationale": "数据、画像或自动化服务可被翻译为具体权益、行为、损害、因果关系和责任主体问题，检验规则迁移能力。",
        "uncertainty": "不预设任何平台当然承担责任；必须依题给法律依据识别归责原则、免责事由和救济。",
        "steps": ["先写被侵害的具体人格权益。", "区分停止侵害等请求与损害赔偿要件。", "识别行为人、平台或危险来源后再匹配归责原则。"],
        "practice": {"prompt": "原创拟题：平台未经充分说明处理用户信息，第三方操作又造成现实损害。分别列人格权保护与侵权赔偿的审查清单。", "checkpoints": ["权益具体化", "请求权分层", "主体与因果关系逐项核对"]},
    },

    {
        "id": "forecast-ju-01", "title": "规则、原则与价值冲突的论证链", "subject": "法理学", "scenarioId": "rotation",
        "topicIds": ["ju03", "ju10", "ju05"], "questionTypes": ["单选", "分析", "论述"],
        "rationale": "从规则适用到原则权衡，再用解释方法校验结论，能够形成综合课材料题的完整论证。",
        "uncertainty": "原则不能脱离现行规范直接给出结论，材料题评价重点仍取决于题干设问。",
        "steps": ["先找可直接适用的规则及构成条件。", "规则不足时列冲突的价值及各自理由。", "用文义、体系、目的等方法检验解释边界。"],
        "practice": {"prompt": "原创拟题：某管理措施提升效率但限制个体选择。依据材料说明规则、原则与价值冲突的论证顺序。", "checkpoints": ["规则优先定位", "价值双方都写", "解释方法服务于结论"]},
    },
    {
        "id": "forecast-ju-02", "title": "法律渊源、效力冲突与立法程序", "subject": "法理学", "scenarioId": "revisit",
        "topicIds": ["ju04", "ju11", "ju01"], "questionTypes": ["单选", "简答", "分析"],
        "rationale": "制定机关、规范位阶、程序和效力冲突是可机械拆解的基础链条，适合作为补漏型复习单元。",
        "uncertainty": "特别法、新旧法等规则通常处理同位阶关系，不能越过位阶和权限审查。",
        "steps": ["识别规范名称、制定机关和制定权限。", "确认位阶与程序，再判断是否有效。", "仅在可比较的规范之间处理特别法或新旧法冲突。"],
        "practice": {"prompt": "原创拟题：不同机关先后发布内容不一致的规范文件。根据题给权限信息排列审查顺序。", "checkpoints": ["机关权限", "位阶先于新旧", "程序问题单列"]},
    },
    {
        "id": "forecast-ju-03", "title": "权利义务、责任与法律实施", "subject": "法理学", "scenarioId": "rotation",
        "topicIds": ["ju09", "ju06", "ju07"], "questionTypes": ["简答", "分析", "论述"],
        "rationale": "权利义务结构连接守法、执法、司法和责任承担，可把抽象概念转化为材料中的主体行为。",
        "uncertainty": "责任成立、责任形式与制裁方式应分别论证，不能看到违法就跳过归责条件。",
        "steps": ["从材料中找主体、权利、义务和法律事实。", "辨认属于守法、执法、司法或监督哪个环节。", "逐项核对责任条件、责任形式与制裁。"],
        "practice": {"prompt": "原创拟题：围绕一项公共服务纠纷，分析多主体的权利义务、实施环节及可能责任。", "checkpoints": ["主体对应关系", "实施环节准确", "责任与制裁不混用"]},
    },
    {
        "id": "forecast-ju-04", "title": "技术治理材料中的法治方法", "subject": "法理学", "scenarioId": "transfer",
        "topicIds": ["ju08", "ju15", "ju16"], "questionTypes": ["分析", "论述"],
        "rationale": "自动化治理或平台管理材料可回到依法行政、权力约束、权利保障和全面依法治国的既有框架。",
        "uncertainty": "情境新颖不表示需要自创新原则；只使用教材概念和材料明确给出的制度信息。",
        "steps": ["把技术措施翻译为实施主体、权限、程序与影响。", "分别审查合法性、合理性、程序和救济。", "回扣权力受约束与权利受保障的法治要求。"],
        "practice": {"prompt": "原创拟题：行政机关使用自动化工具辅助决定。根据材料分析权限、程序、说明理由和救济问题。", "checkpoints": ["技术词转法律关系", "权限程序救济齐全", "不编造材料外制度"]},
    },

    {
        "id": "forecast-co-01", "title": "基本权利限制与比例审查", "subject": "宪法学", "scenarioId": "rotation",
        "topicIds": ["co04", "co09", "co01"], "questionTypes": ["单选", "分析", "论述"],
        "rationale": "识别权利、限制依据、目的和手段后进行层次审查，是连接宪法效力与材料事实的稳定方法。",
        "uncertainty": "比例分析必须依托题给规范和事实，不能用抽象价值口号替代权限及法律依据审查。",
        "steps": ["写明受影响的具体基本权利。", "查限制主体、权限、法律依据和目的。", "依次审查适当性、必要性及利益衡量。"],
        "practice": {"prompt": "原创拟题：公共场所管理措施同时影响安全与个人自由。构造一份基本权利限制审查提纲。", "checkpoints": ["权利具体", "法律依据先行", "比例层次完整"]},
    },
    {
        "id": "forecast-co-02", "title": "宪法监督、备案审查与规范纠错", "subject": "宪法学", "scenarioId": "revisit",
        "topicIds": ["co10", "co11", "co02"], "questionTypes": ["单选", "简答", "分析"],
        "rationale": "监督主体、规范位阶、审查对象和处理方式容易混淆，适合用流程图补齐制度结构。",
        "uncertainty": "具体程序和权限须按教材及题给规范作答，不能仅凭“上位法优先”省略机关职权。",
        "steps": ["确定被审查规范的制定机关与位阶。", "匹配有权监督或审查的主体。", "按提出、审查、处理和反馈梳理流程。"],
        "practice": {"prompt": "原创拟题：某地方规范被认为与上位规范抵触。列出确定审查主体、对象及处理路径所需信息。", "checkpoints": ["位阶明确", "主体权限匹配", "审查与处理分开"]},
    },
    {
        "id": "forecast-co-03", "title": "中央与地方国家机关的权限程序", "subject": "宪法学", "scenarioId": "rotation",
        "topicIds": ["co11", "co12", "co15"], "questionTypes": ["单选", "多选", "简答"],
        "rationale": "同一事项可能涉及决定、执行、任免或公布等不同动作，按机关和程序分工能减少机械混记。",
        "uncertainty": "国家主席、人大及其常委会、国务院和地方机关的行为应逐项核对，不可用笼统的“国家机关”代替。",
        "steps": ["圈出题干中的决定、执行、任免、公布等动词。", "为每个动作匹配机关与权限来源。", "检查会议、任期或程序等附加条件。"],
        "practice": {"prompt": "原创拟题：围绕一项国家事务，材料列出决定、公布和执行三个环节。把各环节对应到机关与程序。", "checkpoints": ["动词驱动匹配", "中央地方不混", "决定与执行分开"]},
    },
    {
        "id": "forecast-co-04", "title": "数字化公共治理中的自治与权利保障", "subject": "宪法学", "scenarioId": "transfer",
        "topicIds": ["co08", "co04", "co12"], "questionTypes": ["分析", "论述"],
        "rationale": "线上议事、公共服务或社区治理等新场景仍可拆成自治主体、国家机关权限、参与程序和权利保障。",
        "uncertainty": "不得把平台功能等同于法定自治权，也不得假定技术参与自动满足民主程序。",
        "steps": ["识别是基层自治组织、行政机关还是技术服务方。", "区分自治事项与行政管理事项。", "核对参与、公开、监督和权利救济线索。"],
        "practice": {"prompt": "原创拟题：社区通过线上系统收集意见并形成公共事项方案。依材料分析主体性质、程序和权利保障。", "checkpoints": ["主体性质准确", "自治与行政分开", "参与程序有事实依据"]},
    },

    {
        "id": "forecast-lh-01", "title": "秦汉制度承继与法律儒家化", "subject": "法制史", "scenarioId": "revisit",
        "topicIds": ["lh03", "lh04"], "questionTypes": ["单选", "简答", "分析"],
        "rationale": "以秦汉承继和变化为轴，可以同时掌握制度名称、时代归属、变化原因及影响。",
        "uncertainty": "历史比较只说明制度演进，不把古代制度直接套用于现代法律结论。",
        "steps": ["先锁定朝代和制度名称。", "分别列秦制基础、汉代变化及时间顺序。", "用政治与思想背景解释变化，不只背结论。"],
        "practice": {"prompt": "原创拟题：给出数项秦汉司法和立法材料，按承继、调整、影响三栏整理。", "checkpoints": ["年代准确", "承继与创新分开", "背景只解释不替代史实"]},
    },
    {
        "id": "forecast-lh-02", "title": "唐律体系、身份秩序与婚姻继承", "subject": "法制史", "scenarioId": "rotation",
        "topicIds": ["lh06", "lh07", "lh01"], "questionTypes": ["单选", "简答", "分析"],
        "rationale": "唐律的法典结构、礼刑关系和身份制度可以从总则到具体婚姻继承制度形成纵向联系。",
        "uncertainty": "比较现代制度时只用于说明差异，不能用现代概念改写古代制度原义。",
        "steps": ["先辨制度属于总则、罪名刑罚还是婚姻继承。", "联系礼刑关系与身份秩序说明制度理由。", "如作今古比较，明确时代与价值基础不同。"],
        "practice": {"prompt": "原创拟题：以唐代身份关系材料为中心，说明其在律典原则和婚姻继承制度中的表现。", "checkpoints": ["总则与分则联系", "礼刑关系落到制度", "古今概念不混用"]},
    },
    {
        "id": "forecast-lh-03", "title": "宋至明清司法机关与会审机制", "subject": "法制史", "scenarioId": "rotation",
        "topicIds": ["lh08", "lh10", "lh11", "lh12"], "questionTypes": ["单选", "多选", "简答"],
        "rationale": "机关名称、职掌、案件类型和会审程序适合跨朝代横向比较，也能纠正常见名称混淆。",
        "uncertainty": "不同朝代同名或近似机关的职能可能不同，结论必须绑定具体时代。",
        "steps": ["给每个机关贴朝代标签。", "按审判、复核、监察或行政职掌分类。", "再标会审参与机关、适用案件与程序作用。"],
        "practice": {"prompt": "原创拟题：把宋、明、清若干司法机关和会审制度放入“朝代—职掌—程序功能”表。", "checkpoints": ["朝代先行", "机关与制度分开", "程序功能说清"]},
    },
    {
        "id": "forecast-lh-04", "title": "清末修律到近代宪制文件的制度转型", "subject": "法制史", "scenarioId": "transfer",
        "topicIds": ["lh13", "lh14", "lh15", "lh16"], "questionTypes": ["简答", "分析", "论述"],
        "rationale": "以时间线连接修律、司法改革、宪制文件及根据地立法，可观察制度移植、本土实践和价值转型。",
        "uncertainty": "近代文件的性质、效力与历史背景不同，不能把时间相近视为制度连续或内容相同。",
        "steps": ["按年份和政权背景排列材料。", "分别写文件性质、核心制度与实施条件。", "最后比较转型方向及历史局限。"],
        "practice": {"prompt": "原创拟题：选择清末、民国初年和根据地三组材料，制作制度目标、规范形式和实践效果对照表。", "checkpoints": ["时间线准确", "政权背景明确", "事实、评价与影响分层"]},
    },
]


PATHWAYS = [
    {"id": "path-cr", "subject": "刑法", "title": "从事实到罪责的六步链", "steps": [
        {"title": "拆事实", "prompt": "按主体、行为、对象、时间、结果写成一句话事实链。", "topicIds": ["cr02"]},
        {"title": "查客观归责", "prompt": "核对行为、结果、因果关系及可能的介入因素。", "topicIds": ["cr03"]},
        {"title": "查主观要素", "prompt": "区分故意、过失、认识错误与意外事件。", "topicIds": ["cr06", "cr07"]},
        {"title": "排除与阶段", "prompt": "再看正当化事由、着手点和停止原因。", "topicIds": ["cr04", "cr05", "cr08"]},
        {"title": "多人多罪", "prompt": "逐人判断分工，再数行为、法益和罪名关系。", "topicIds": ["cr09", "cr11"]},
        {"title": "责任与处罚", "prompt": "定性后核对主体身份及刑罚裁量制度。", "topicIds": ["cr10", "cr12", "cr15"]},
    ]},
    {"id": "path-cv", "subject": "民法", "title": "从请求到责任的六步链", "steps": [
        {"title": "定主体与请求", "prompt": "先写谁向谁请求什么，目标是权利确认、履行、返还还是赔偿。", "topicIds": ["cv01", "cv05"]},
        {"title": "找关系来源", "prompt": "识别法律行为、代理、合同、物权、身份或侵权关系。", "topicIds": ["cv02", "cv03", "cv08"]},
        {"title": "判权利变动", "prompt": "核对表示、登记、交付、通知等关键事实和时间。", "topicIds": ["cv04", "cv07", "cv10"]},
        {"title": "列抗辩与顺位", "prompt": "处理履行先后、时效、担保顺位及保证抗辩。", "topicIds": ["cv06", "cv09", "cv11", "cv12"]},
        {"title": "查责任构成", "prompt": "按行为、损害、因果关系和归责原则核对。", "topicIds": ["cv15", "cv16"]},
        {"title": "写结论与救济", "prompt": "每个请求分别给成立或不成立、责任主体及救济方式。", "topicIds": ["cv01", "cv15"]},
    ]},
    {"id": "path-ju", "subject": "法理学", "title": "从概念到材料论证的五步链", "steps": [
        {"title": "准确定义", "prompt": "先写核心概念的对象、特征和边界。", "topicIds": ["ju01", "ju02"]},
        {"title": "分清规则结构", "prompt": "定位权利义务、行为模式、法律后果及原则作用。", "topicIds": ["ju03", "ju09"]},
        {"title": "确定规范效力", "prompt": "审查渊源、位阶、权限、程序与冲突规则。", "topicIds": ["ju04", "ju11"]},
        {"title": "选择解释与实施", "prompt": "用解释方法联系守法、执法、司法和监督环节。", "topicIds": ["ju05", "ju07", "ju12"]},
        {"title": "权衡并落结论", "prompt": "列出价值冲突、责任与法治要求，回扣材料事实。", "topicIds": ["ju06", "ju08", "ju10", "ju16"]},
    ]},
    {"id": "path-co", "subject": "宪法学", "title": "从规范到权力与权利的五步链", "steps": [
        {"title": "定位宪法规范", "prompt": "确认原则、效力、渊源和规范层级。", "topicIds": ["co01", "co02"]},
        {"title": "辨机关和动作", "prompt": "将决定、执行、监督、任免等动作对应到具体机关。", "topicIds": ["co11", "co12", "co13", "co14", "co15"]},
        {"title": "辨国家结构与自治", "prompt": "区分中央地方、民族自治、特别行政区和基层自治。", "topicIds": ["co03", "co06", "co07", "co08"]},
        {"title": "审权利限制", "prompt": "写明具体权利、限制依据、目的和比例审查层次。", "topicIds": ["co04", "co09"]},
        {"title": "查监督与程序", "prompt": "确定解释监督主体、审查对象和处理程序。", "topicIds": ["co05", "co10", "co16"]},
    ]},
    {"id": "path-lh", "subject": "法制史", "title": "从年代到制度沿革的五步链", "steps": [
        {"title": "锁定年代", "prompt": "先判朝代、政权和先后顺序。", "topicIds": ["lh02", "lh03", "lh04"]},
        {"title": "识别制度", "prompt": "写准法典、机关、刑罚、婚姻继承或宪制文件的名称。", "topicIds": ["lh06", "lh07", "lh12"]},
        {"title": "解释功能", "prompt": "说明制度解决何种治理、司法或身份秩序问题。", "topicIds": ["lh01", "lh08", "lh10", "lh11"]},
        {"title": "比较沿革", "prompt": "按承继、变化、原因和影响连接前后制度。", "topicIds": ["lh05", "lh09", "lh13"]},
        {"title": "限定历史评价", "prompt": "结合时代背景评价，不把古代规则直接套用于现代。", "topicIds": ["lh14", "lh15", "lh16"]},
    ]},
]


def compact(text: str, limit: int = 180) -> str:
    text = " ".join(str(text or "").split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def load_json(name: str):
    return json.loads((DATA / name).read_text(encoding="utf-8"))


def same_subject(left: str, right: str) -> bool:
    aliases = {"中国法制史": "法制史", "法制史": "法制史"}
    return aliases.get(left, left) == aliases.get(right, right)


def select_evidence(graph: dict, topic_ids: list[str], subject: str) -> list[dict]:
    nodes = {node["uuid"]: node for node in graph["nodes"]}
    candidates: list[dict] = []
    allowed_years = {2022, 2023, 2025, 2026}
    for edge in graph["edges"]:
        if edge.get("name") != "候选考点":
            continue
        topic_id = edge.get("target_node_uuid", "").removeprefix("topic-")
        if topic_id not in topic_ids:
            continue
        question = nodes.get(edge.get("source_node_uuid"))
        attrs = (question or {}).get("attributes", {})
        edge_attrs = edge.get("attributes", {})
        if (
            not question
            or attrs.get("year") not in allowed_years
            or attrs.get("extractionStatus") != "自动提取"
            or not same_subject(attrs.get("subject"), subject)
            or not same_subject(edge_attrs.get("subject"), subject)
        ):
            continue
        candidates.append({
            "questionId": question["uuid"],
            "topicId": topic_id,
            "keywords": list(edge_attrs.get("keywords") or []),
            "evidence": compact(edge_attrs.get("evidence") or question.get("summary") or ""),
            "_year": attrs["year"],
        })
    candidates.sort(key=lambda item: (-item["_year"], topic_ids.index(item["topicId"]), item["questionId"]))
    chosen: list[dict] = []
    seen_questions: set[str] = set()
    # First pass spreads evidence across listed topics; second pass fills remaining slots.
    for topic_id in topic_ids:
        match = next((item for item in candidates if item["topicId"] == topic_id and item["questionId"] not in seen_questions), None)
        if match:
            chosen.append(match)
            seen_questions.add(match["questionId"])
        if len(chosen) == 3:
            break
    for item in candidates:
        if len(chosen) == 3:
            break
        if item["questionId"] not in seen_questions:
            chosen.append(item)
            seen_questions.add(item["questionId"])
    for item in chosen:
        item.pop("_year", None)
    return chosen


def validate(data: dict, topics: list[dict], graph: dict) -> None:
    topic_by_id = {item["id"]: item for item in topics}
    node_by_id = {item["uuid"]: item for item in graph["nodes"]}
    assert len(data["predictions"]) == 20
    assert len({item["id"] for item in data["predictions"]}) == 20
    assert {item["scenarioId"] for item in data["predictions"]} <= {item["id"] for item in data["scenarios"]}
    counts: dict[str, int] = {}
    for prediction in data["predictions"]:
        counts[prediction["subject"]] = counts.get(prediction["subject"], 0) + 1
        for topic_id in prediction["topicIds"]:
            assert topic_id in topic_by_id, (prediction["id"], topic_id)
            assert same_subject(topic_by_id[topic_id]["subject"], prediction["subject"]), (prediction["id"], topic_id)
        assert len(prediction["evidence"]) <= 3
        for evidence in prediction["evidence"]:
            question = node_by_id[evidence["questionId"]]["attributes"]
            assert evidence["topicId"] in prediction["topicIds"]
            assert same_subject(question["subject"], prediction["subject"])
            assert question["year"] in {2022, 2023, 2025, 2026}
            assert question["extractionStatus"] == "自动提取"
    assert counts == {"刑法": 4, "民法": 4, "法理学": 4, "宪法学": 4, "法制史": 4}, counts
    assert len(data["pathways"]) == 5
    for pathway in data["pathways"]:
        assert 4 <= len(pathway["steps"]) <= 6
        for step in pathway["steps"]:
            for topic_id in step["topicIds"]:
                assert topic_id in topic_by_id
                assert same_subject(topic_by_id[topic_id]["subject"], pathway["subject"])


def main() -> None:
    topics = load_json("topics.json")
    graph = load_json("graph.json")
    predictions = []
    for source in PREDICTIONS:
        item = dict(source)
        item["evidence"] = select_evidence(graph, item["topicIds"], item["subject"])
        predictions.append(item)
    data = {
        "meta": {
            "targetYear": 2027,
            "notice": "本层为基于知识结构设计的复习情景，不是命题概率或官方信息。真题证据仅来自自动关键词匹配，属于候选关联，须结合原题复核。",
        },
        "scenarios": SCENARIOS,
        "predictions": predictions,
        "pathways": PATHWAYS,
    }
    validate(data, topics, graph)
    rendered = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    (DATA / "learning.json").write_text(rendered, encoding="utf-8")
    (DATA / "learning.js").write_text(
        "window.LAW_LEARNING_DATA = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    evidence_count = sum(len(item["evidence"]) for item in predictions)
    print(f"predictions={len(predictions)} pathways={len(PATHWAYS)} evidence={evidence_count}")


if __name__ == "__main__":
    main()
