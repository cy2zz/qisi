import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const palette = { blue: ['#dae8fc', '#6c8ebf'], green: ['#d5e8d4', '#82b366'], yellow: ['#fff2cc', '#d6b656'], red: ['#f8cecc', '#b85450'], purple: ['#e1d5e7', '#9673a6'], gray: ['#f5f5f5', '#666666'] };
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll('\n', '&#xa;');
function diagram(name, title, width, height, build) {
  const cells = [];
  let count = 0;
  const node = (id, label, x, y, nodeWidth, nodeHeight, color = 'blue', extra = '') => {
    const [fill, stroke] = palette[color];
    cells.push('<mxCell id="' + id + '" value="' + escape(label) + '" style="rounded=1;whiteSpace=wrap;html=0;fontFamily=Microsoft YaHei;fontSize=20;spacing=14;fillColor=' + fill + ';strokeColor=' + stroke + ';strokeWidth=2;' + extra + '" vertex="1" parent="1"><mxGeometry x="' + x + '" y="' + y + '" width="' + nodeWidth + '" height="' + nodeHeight + '" as="geometry"/></mxCell>');
  };
  const text = (id, label, x, y, nodeWidth, nodeHeight, size = 20) => node(id, label, x, y, nodeWidth, nodeHeight, 'gray', 'fillColor=none;strokeColor=none;align=left;fontSize=' + size + ';');
  const edge = (source, target, label = '', extra = '', points = []) => {
    const geometry = points.length ? '<Array as="points">' + points.map(([x, y]) => '<mxPoint x="' + x + '" y="' + y + '"/>').join('') + '</Array>' : '';
    cells.push('<mxCell id="edge' + (++count) + '" value="' + escape(label) + '" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=0;fontFamily=Microsoft YaHei;fontSize=17;labelBackgroundColor=#ffffff;strokeWidth=2;endArrow=block;endFill=1;' + extra + '" edge="1" parent="1" source="' + source + '" target="' + target + '"><mxGeometry relative="1" as="geometry">' + geometry + '</mxGeometry></mxCell>');
  };
  text('title', title, 30, 10, width - 60, 60, 28);
  build({ node, text, edge });
  const xml = '<?xml version="1.0" encoding="UTF-8"?><mxfile host="app.diagrams.net"><diagram name="' + escape(title) + '" id="' + name + '"><mxGraphModel dx="' + width + '" dy="' + height + '" grid="1" page="1" pageScale="1" pageWidth="' + width + '" pageHeight="' + height + '"><root><mxCell id="0"/><mxCell id="1" parent="0"/>' + cells.join('') + '</root></mxGraphModel></diagram></mxfile>';
  writeFileSync(join(directory, name + '.drawio'), xml, 'utf8');
}
const down = 'exitX=0.5;exitY=1;entryX=0.5;entryY=0;';
const up = 'exitX=0.5;exitY=0;entryX=0.5;entryY=1;';
const across = 'exitX=1;exitY=0.5;entryX=0;entryY=0.5;';

diagram('architecture', '启思 qisi-3.1｜当前架构与实现边界 · 2026-09-23', 1380, 1210, ({ node, text, edge }) => {
  node('web', 'React / Vite 学生端\n题库与 BankFlow · 手写确认 · 独立检验 · 报告 · 历史', 60, 110, 1260, 90);
  node('mainApi', '主入口 /study\nPOST problems/analyze\nPOST problems/chat（SSE）', 60, 290, 380, 120);
  node('tutorApi', 'B 入口 /learn/:sessionId\nPOST tutor/turn 已注册\n初始 GET /session/:id 缺失', 500, 290, 380, 120, 'yellow');
  node('assessmentApi', '独立检验 /check、/report\nassessment / reports / history\nA 主责', 940, 290, 380, 120);
  node('mainRoles', 'ProblemAnalysisService\n诊断 → 策略 → 表达 → 审核\n可选：异解备课复核', 60, 500, 380, 130, 'purple');
  node('tutorRoles', 'WorkflowOrchestrator\n显式、有界的角色顺序\nroute_review 生产接线未完成', 500, 500, 380, 130, 'purple');
  node('assessRoles', 'AssessmentService\n冻结计划 / 答案\nAssessment → Guard', 940, 500, 380, 130, 'purple');
  node('commit', 'A 的 LearningSessionService / 数据事务门面\nowner · Origin · version/CAS · 幂等 · lease · deadline · 取消/删除\n模型仅产候选；PolicyGate + 最终事务才授权结果', 60, 730, 1260, 120, 'green');
  node('database', 'MySQL 权威事实（19 份表 SQL）\n题库 / 会话 / 消息 / 首次计划 / 评分 / 曝光 / runs / node_runs / events', 60, 930, 810, 100, 'green', 'shape=cylinder3;boundedLbl=1;size=15;');
  node('model', '统一 ModelPort → 配置的模型\n当前 fetch HTTP；无 LangGraph / AI SDK 依赖\n4 个教学 Agent + 2 个辅助角色', 930, 930, 390, 130, 'purple');
  node('gaps', '尚未完整装配：教师模块与页面；worker 崩溃后自动续跑。数据库记录不等于恢复已完成。', 60, 1100, 1260, 65, 'red', 'dashed=1;');
  edge('web', 'mainApi', '', down); edge('web', 'tutorApi', '', down); edge('web', 'assessmentApi', '', down);
  edge('mainApi', 'mainRoles', '', down); edge('tutorApi', 'tutorRoles', '', down); edge('assessmentApi', 'assessRoles', '', down);
  edge('mainRoles', 'commit', '', down); edge('tutorRoles', 'commit', '', down); edge('assessRoles', 'commit', '', down);
  edge('commit', 'database', '正式持久化', down);
  text('legend', '蓝：页面/API   紫：模型与编排   绿：权威提交/数据   黄：入口缺口   红虚线：未完成', 60, 200, 1260, 55, 18);
});

diagram('learning-flow', '从选题到独立证据｜按 ① ↓ ② ↑ ③ ↓ 阅读', 1620, 1370, ({ node, text, edge }) => {
  text('lane1', '① 选题与输入 ↓', 50, 90, 420, 50, 24);
  text('lane2', '② 单轮教学与核对 ↑', 570, 90, 420, 50, 24);
  text('lane3', '③ 撤去帮助后检验 ↓', 1090, 90, 420, 50, 24);
  node('select', '登录 → 筛选 / 随机选题\n服务端按 questionId 取真实题目', 50, 170, 420, 120);
  node('analyze', 'POST /problems/analyze\n题图必要时先转写\n公开读题 + 私有备课可并行', 50, 390, 420, 120);
  node('prepare', 'Preparation → 结构校验 → Guard\n产出参考解 / 决策路线 / 检验候选', 50, 610, 420, 120, 'purple');
  node('ready', '绑定 packetVersion 并建会话\n未 ready 也可能建会话，但受限\n不换简单题，不伪称准备成功', 50, 830, 420, 120, 'yellow');
  node('input', '学生输入自己的思路\n文字 / 公式 / 语音 / 手写\n手写必须先确认当前 revision', 50, 1050, 420, 120);
  node('reserve', 'POST /problems/chat → reserveTurn\n身份 / Origin / 幂等 / version\n取得有效 lease 与 deadline', 570, 1050, 420, 120, 'green');
  node('diagnosis', 'Diagnosis：有证据地定位卡点\n必要时 Preparation 异解复核\n再由 route Guard 审核', 570, 830, 420, 120, 'purple');
  node('strategy', 'Strategy：决定下一小步\n结合帮助深度、曝光与探针余量\n同一目标最多两个探针', 570, 610, 420, 120, 'purple');
  node('render', 'Renderer → Guard → PolicyGate\n只表达获准内容\n拒绝则中性提示或错误，不乱发答案', 570, 390, 420, 120, 'purple');
  node('commit', 'commitTurn 最终事务复查\n保存消息 / 曝光 / 探针 / 状态\n成功后才发 chunk + done(version)', 570, 170, 420, 120, 'green');
  node('original', '继续讨论或 finish_problem 核对\n正确 / 不正确 / 不确定\n原题做对 ≠ 独立学会', 1090, 170, 420, 120, 'yellow');
  node('newtask', 'start / reassess：未见新任务\n候选或受控生成 → Guard\n过滤已见与近重复任务', 1090, 390, 420, 120);
  node('freeze', '首次计划 → lockPlan\n随后作答 → freezeAnswer\n请求帮助、实际曝光分别记账', 1090, 610, 420, 120, 'green');
  node('assess', 'Assessment → Guard\n规划 / 执行分别评分\n不可靠则 unknown，不下掌握结论', 1090, 830, 420, 120, 'purple');
  node('report', '代码计算本次独立通过 → 报告\n首次见 + 近迁移 + 无求助/曝光 + 有效\n规划与执行都正确；历史 / owner删除', 1090, 1050, 420, 120, 'green');
  for (const [source, target] of [['select','analyze'],['analyze','prepare'],['prepare','ready'],['ready','input'],['original','newtask'],['newtask','freeze'],['freeze','assess'],['assess','report']]) edge(source, target, source === 'original' ? '可进入检验时' : '', down);
  edge('input','reserve','提交',across);
  for (const [source,target] of [['reserve','diagnosis'],['diagnosis','strategy'],['strategy','render'],['render','commit']]) edge(source,target,'',up);
  edge('commit','original','展示',across);
  edge('report','newtask','补学后换题重测','exitX=1;exitY=0.5;entryX=1;entryY=0.5;',[[1570,1110],[1570,450]]);
  text('note','下一轮学生回答，重复②；失败保留输入、不推进版本。独立检验未通过时回流补学，再换题重测。',50,1200,1460,60,20);
  text('legend','蓝：学生动作/业务   紫：模型角色   绿：持久证据/事务   黄：状态边界。当前主链图，不替代完整AT/ST验收。',50,1270,1460,60,18);
});

diagram('orchestration', 'Agent 编排对照｜两条入口不能互相替代验收', 1570, 1530, ({ node, text, edge }) => {
  text('left','主链：BankFlow → /problems/chat',50,90,660,50,24);
  text('right','B链：SessionPage → /tutor/turn',850,90,660,50,24);
  const rows = [180,370,560,750,940,1130];
  node('mainStart','reserveTurn → 恢复题目 / ready包或受限fallback\nTurnTimeBudget：节点25秒 / 全轮90秒',50,rows[0],660,110,'green');
  node('mainDiag','Diagnosis：确认的证据 → 判断 / 卡点 / 复核请求',50,rows[1],660,100,'purple');
  node('mainRoute','可选：Preparation(route_review) → route Guard\n审核学生异解，保留合格路线补丁',50,rows[2],660,100,'purple');
  node('mainStrategy','Strategy → Renderer\n决定干预、台阶、获准事实，再组织学生话术',50,rows[3],660,100,'purple');
  node('mainGuard','Guard → gateTurn（确定性 PolicyGate）\n边界不合格：中性拒绝 / 错误，不无限重写',50,rows[4],660,100,'yellow');
  node('mainCommit','A commitTurn 最终事务 → SSE chunk / done\n节点审计 ≠ 提交；禁止先流出未检查模型文本',50,rows[5],660,110,'green');
  node('bStart','初始化 GET /session/:id 缺失；POST自身已接线\nA reserveTurn → LearningTurnStore → Orchestrator',850,rows[0],660,110,'yellow');
  node('bDiag','Diagnosis.runChecked\nBudgetLedger + BudgetedModelPort 受控模型调用',850,rows[1],660,100,'purple');
  node('bRoute','生产接线 routeReviewInput = null\n异解 / skip / reveal 等未完整接入',850,rows[2],660,100,'red','dashed=1;');
  node('bStrategy','Strategy.runChecked → Renderer → Guard\n需要时最多一次表达重写，再 Guard',850,rows[3],660,100,'purple');
  node('bGuard','gateTurn → StorePort.commitChecked\n安全 StudentView，不是原始模型输出',850,rows[4],660,100,'yellow');
  node('bCommit','LearningTurnStore → A commitTurn → JSON\nclaimRecovery明确未实现；并非自动崩溃续跑',850,rows[5],660,110,'green');
  const mainIds = ['mainStart','mainDiag','mainRoute','mainStrategy','mainGuard','mainCommit'];
  for(let index=0;index<mainIds.length-1;index++) edge(mainIds[index],mainIds[index+1],index===1 ? '需要复核时；否则跳过' : '',down);
  edge('bStart','bDiag','',down);
  edge('bDiag','bRoute','未接分支',down+'dashed=1;');
  edge('bDiag','bStrategy','直接进入策略','exitX=0;exitY=0.5;entryX=0;entryY=0.5;',[[800,420],[800,800]]);
  edge('bStrategy','bGuard','',down);
  edge('bGuard','bCommit','',down);
  node('assessment','独立检验是另一阶段：新任务 → 冻结首次计划/答案 → Assessment → Guard → 代码算独立性\n真实实现：A 的 AssessmentService；不是聊天每轮都调用，也不是一个统一 LangGraph 已包办所有阶段',50,1310,1460,110,'purple');
  text('legend','紫：模型角色/编排   绿：事务/证据   黄：代码门禁或入口限制   红虚线：生产未接。当前没有自由群聊、无限循环或真实StateGraph。',50,1440,1460,60,18);
});
