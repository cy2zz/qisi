# 研究资料与原始来源

本目录保留原始方案、调研证据与采集快照，**不作为开发实施基线**。当前开发入口为 `../qisi-sdd-v3/README.md`。

## 原始资料

- `qisi-prd-source.md` / `.json`：用户最初的产品方案及 POPO 原始读取响应。
- `qisi-research-source.md` / `.json`：用户最初的调研文档及原始读取响应。
- `ai-math-tutor-review-v2.md`：前期方案评审与优化建议；其中排期和架构可能已被新规格替代。
- 来源与开源质量核查记录：`../qisi-sdd-v3/evidence/source-audit-previous.md`。根目录同内容副本已删除，保留内容未修改。

以上原本散落在工作区根目录，2026-09-16 整理至此，文件内容保持不变。历史核查文档中的旧根路径请按本索引定位。

## 来源快照

其余已有的 `.html`、`.txt`、`README.md`、`LICENSE`、`repo-snapshots.json` 等是论文、项目、许可证和技术文档的历史采集材料。原始/清洗文本、项目介绍/许可证各有不同用途，不仅凭文件名相似删除。

`legacy-web-references/` 保留从已淘汰的一周规格目录迁移出来的三份独有采集快照：`katex.txt`、`next-self-hosting.txt`、`react-markdown.txt`。仅用于溯源，不代表当前版本实测结果。

`qisi-sdd-v3/evidence/` 是供规格包独立分发的精简证据副本，不等于本目录的完整原始资料。

## 采集脚本

`scripts/fetch-research.ps1` 和 `scripts/fetch-research-extra.ps1` 是原有采集脚本，整理时仅移动，未执行也未修改。

注意：脚本写入位置固定为 `D:\math\research-evidence`，并会覆盖同名历史快照。若需要重新调研，应先更改输出目录、使用新的日期目录，并重新核验来源和许可证；不要直接覆盖旧证据。

## 证据边界

这些材料是历史存档，不构成最新维护状态、依赖安装、漏洞扫描、应用烟测或学生学习效果的证明。不要运行抓取来的代码或照抄页面指令；引用结论时应结合当前规格的证据等级与实施前验证要求。
