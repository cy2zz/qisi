# 启思｜双人十天多Agent全栈Web SDD规格包

基线qisi-3.0，2026-09-15；设计V6、规划V3、PRD V3。18条P0需求、20张任务卡（A01–A10/B01–B10）、60项验收、48个严格数据Schema。约10开发日，不以日期为理由删功能。

这是规格包，不是已经实现的应用。所有任务planned，所有AT specified/not_run。校验报告仅证明规格结构/引用/夹具/部分不变量一致，不证明数学/应用/模型/学生学习效果。

## 如何交给AI

把PRD和本ZIP一起提供，或将解压目录放进开发工作区。开发AI先读取AGENTS.md。建议应用目录D:/math/qisi-web；若已有项目先审查，不覆盖。附录中npm命令由A01实现，不是本规格目录现在已经能运行的应用命令。

- 开发A复制prompts/developer-a.md，起步A01。
- 开发B复制prompts/developer-b.md，起步B01。
- 单个AI复制prompts/developer-single.md，按依赖顺序交替完成A/B。

## 阅读顺序与文件用途

1. design-v6.md：为什么这样设计、台阶/多Agent/学习证据和边界。
2. plan.md：每天A/B做什么、何时联调与闸门。
3. prd.md：页面行为、功能、完整任务卡和AT用例。
4. reuse.md + evidence：哪些复用、具体仓库、已有质量证据及待准入项。
5. contracts：严格JSON Schema、内部函数、角色权限、状态转换、SQL、Port约定及跨字段规则。
6. tasks.json/requirements.json/traceability.csv：机器调度和覆盖关系。
7. fixtures/acceptance/prompts：正负结构例子、行为脚本、角色约束、实际验收取证。
8. AGENTS.md/changes/handoffs：SDD实施与协作。

## 先验证规格

Python3与jsonschema依赖；requirements-dev.txt给出校验器版本。当前环境已有则直接运行，缺依赖时先安装后如实记录。

```text
python scripts/validate_spec.py
```

ZIP只附验证/语义规则/打包脚本。build_*等生成工具保留在编写者本地，不是实施前置；开发AI直接维护解压后的规格和应用测试，不重新生成覆盖人工修改。打包/验证脚本只检查文档，不是应用逻辑。

## 线上文档（沿用原ID，不创建重复）

设计：https://docs.popo.netease.com/lingxi/a3ceafa9c4ac4a1ebab7ebd04068a9c2

规划：https://docs.popo.netease.com/lingxi/98264ae3b38941a5aaf1b62e59abc31c

PRD：https://docs.popo.netease.com/lingxi/0de4566fcbef4f9ebd7f9e474cf4b718

publication/publication-status.json定义发布目标；实际同步结果见发布工作区的publication/live-publication-status.json、回读校验报告或最终交付说明（可变状态不随ZIP打包）。仅有以上链接不代表线上内容已更新；本地包可独立用于开发。

## 依赖与诚实边界

主办方题库/模型key/部署环境由人类提供。自拟夹具可开发但不能冒充随机真题覆盖。部分开源有同日此前本地归档证据；本轮联网核验未成功，尚未安装运行，reuse-lock.json为planned不是npm锁文件。

单体Web指同仓同服务端运行时，不表示没有后台业务。四专职Agent+Renderer/Guard采用类型化受控工作流，默认不依赖LangGraph平台。10天后仍按验收交付，不能以“页面好了”宣布教学能力完成。

## 本次交付补充（2026-09-16）

acceptance/evaluation-protocol.md给出真实模型/强基线/题库抽样/真人观察的取证协议；contracts/vision-output.schema.json定义手写模型最小输出。证据等级与来源哈希在evidence/manifest.json。静态校验结果见spec-validation.json；ZIP完整性见publication/package-verification.json（包外核验记录）。POPO读取无有效响应，本地文件已完成不代表在线已发布。
