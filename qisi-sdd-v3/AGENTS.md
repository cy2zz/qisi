# 开发Agent实施约定｜qisi-3.0

## 开始前必读

README.md -> prd.md -> 自己的tasks.json任务卡 -> contracts/README.md及相关Schema -> acceptance/cases.json -> 对应prompts与fixtures。当前目录是规格包，不是应用；默认应用写到同级qisi-web。若已有代码先检查并适配，不清空目录。

唯一基线qisi-3.0。不要执行qisi-sdd或qisi-sdd-week1里的旧任务。三个POPO正文若版本落后，以本包版本和manifest为准，同时明确报告线上未同步，不假称已同步。

## 模式和角色

产品四Agent ≠ 开发并行Agent。收到明确开发授权才实现；给你A或B时只领取该owner就绪任务。若一个AI串行实施，按依赖交替A/B；未获授权不要另行启动子Agent。若发起人明确要求并行，两者需独立工作区或严格写集，不相互覆盖。

A拥有全局config/package/lock/src/shared、bank/media/input/assessment/report/history、AssessmentAgent。B拥有contracts、workflows、其余agents、tutor/teacher。B的agents/**写集永远排除agents/assessment/**，除D1空接口壳经A确认。共享变更先在handoffs提出，由owner合入。

## 每张卡的强制流程

1. 读取任务前置与相关AT；依赖未done时只做不依赖部分，不能假设接口已实现。
2. 建changes/[TaskID].md，写范围、输入输出、不变量、文件归属、失败测试计划。
3. 建失败测试并实际运行；模型/人工测试先写输入和oracle，不虚构执行结果。
4. 实现页面、服务端、存储和模型适配接线；任何状态变更先通过代码PolicyGate。
5. 运行typecheck/lint/test:task/test:e2e:task；需要真模型和人工判断的AT另外取证。
6. 将实际证据写artifacts/acceptance/ATxx.json；使用本包result-template，不能预填passed。
7. 填handoffs/[TaskID].md，列改动、命令、结果、迁移、风险和下张任务。另一位复核后才done。

## 永不破坏的不变量

随机池完整、失败不暗换题；confirmed输入才诊断；数学异解不因路线不同判错；模型不直接写状态；两探针稳定目标预算；实际帮助不可撤销；新任务首次计划/作答冻结；请求帮助和发出帮助不同；unknown不算正确；不流未校验内容；身份归属/Origin/CAS/幂等；删除与超时禁止迟到提交；不展示隐藏CoT。

## 测试诚实

FixtureProvider只作可控测试，不算真实模型。fixtures都是自拟，不是高考题/学生数据。静态schema验证不是应用测试/数学审题/学习效果证明。没有题库或key时相应项blocked_external，仍可做其它任务。不能让0测试的脚本退出成功冒充验收。

## 变更协议

缺字段或有矛盾先补changes说明，在唯一owner处同步Schema/PRD/fixture/测试和版本；保持向后迁移可追。不得靠修改期望值掩盖不符合需求的实现。外部依赖失败可以换库，但要保留同等能力和全部AT；不可静默删多Agent、手写、撤架、历史或故障恢复。

## 完成报告

任务ID、修改文件、实际命令及退出码、AT通过/失败/未执行、证据路径、真实模型/Mock标识、已知问题、下一任务。不要只说“已实现、测试通过”。

## 连续执行与复核状态

一张卡一个验证/交接检查点，不等于每张卡都必须停下来等用户说继续。授权开发后，在同一owner的前置就绪且不越界时继续下一卡；用implemented_waiting_review表示代码完成但未复核，用done表示规定复核/验收已完成。双人互审；单AI另开复核步骤记录self_review，不伪造另一开发者签字。P0范围变更、跨写集和无法取得的外部依赖需明确报告，不能自行放宽验收。
