# qisi-3.1本地变更提示（2026-09-16）

本目录既有成功发布记录只对应qisi-3.0。本轮未发布POPO；当前状态见local-revision-status.json。当前package-verification.json验证新qisi-3.1 ZIP，旧包核验保存在package-verification-qisi-3.0.json和Git e54ec4a。

下面内容是历史发布流程说明；其中既有IDs/回读记录不能当作新版本已发布的证据。再次发布需用户明确授权、读取popo-doc技能、写前并发检查及回读验证。不要现在执行sync-publish。

---

# POPO发布说明

本规格包是固定的qisi-3.0交付快照，不把可变的线上状态写进不可变ZIP。publication-status.json仅定义发布目标；实际回读结果保存在发布工作区的live-publication-status.json和publication-verification.json（两者不随ZIP打包），并在最终交付说明中报告。不能仅凭原链接、CLI退出码或本包存在判断同步成功。

三个文档沿用原ID：
- 设计 a3ceafa9c4ac4a1ebab7ebd04068a9c2 → design-v6.md
- 规划 98264ae3b38941a5aaf1b62e59abc31c → plan.md
- PRD 0de4566fcbef4f9ebd7f9e474cf4b718 → prd.md

发布流程：读取原文并检查新增编辑；将Markdown转换为POPO自定义HTML；上传ZIP取得真实附件URL与文件大小；更新原文档ID和标题；回读核验正文、标题、表格、代码、链接、附件。不得另建重复文档，不得将本地路径当附件URL。

manifest.json记录固定交付文件哈希，包外package-verification.json记录ZIP哈希。所有自动检查都是规格检查，不是应用测试、真实模型评测或学生学习效果验证。
