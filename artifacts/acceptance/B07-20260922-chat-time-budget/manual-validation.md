# 本次修复验证

## 前提
本补丁在 `D:/math/qisi-dashboard` 的 `develop-B-v0.1` 工作树中，尚未提交/合入。
当前浏览器5173/API3000进程来自 `D:/math/develop/qisi-dashboard`，不会自动加载这份修改。
先经用户授权把本次定向补丁合入实际运行分支，再由用户重启对应后端；不要同时从两份仓库占用同一端口。

## 确定性验证（无需真key、无需业务数据库）
在 `D:/math/qisi-dashboard` 执行：
```
npm --prefix server test -- src/features/analysis/problem-analysis.service.spec.ts src/features/analysis/problem-analysis.controller.spec.ts src/features/analysis/problem-analysis.timeout.integration.spec.ts
```
42个用例覆盖成功、超时、取消、迟到、准备包超时、HTTP/SSE输出；不增加测试时间阈值。

## 界面联调（未在本轮实际执行）
1. 进入已登录学习页，选题/恢复有效会话，输入一步作答并发送。
2. Network 中检查 POST `/api/problems/chat` 的 EventStream。
3. 正常：status 后出现 chunk 和 done，页面展示已校验反馈，刷新后能恢复。
4. 超时：event:error 包含 MODEL_NODE_TIMEOUT 或 TURN_DEADLINE_EXCEEDED 以及中文提示；没有 chunk/done，不出现未经校验的答案，不无限等待。
5. 重试时发起新 requestId；不要在 DevTools 用同一个已失败的幂等ID反复重放来规避预算。
6. 处理中点击停止/离开页面，不应展示迟到反馈；最终事务若已开始，其并发安全仍依赖既有事务检查。

不把fixture成功当真模型时延证明。25秒节点/90秒整轮边界仍在，慢provider可能仍明确失败，需要另做真实时延评测。
