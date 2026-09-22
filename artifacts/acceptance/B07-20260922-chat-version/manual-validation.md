# 连续chat版本修复：界面复验

1. 先复制刚才未成功发送的作答（409请求可能尚未入库，不保证刷新后保留）。
2. 刷新页面，重新打开原会话；GET会话详情会恢复服务器当前版本。
3. 粘贴作答并点击「发送」。查看POST /api/problems/chat使用的expectedVersion，应等于刚恢复的record.version。
4. 成功后EventStream最后应有done.version；不刷新，再输入下一步并发送。
5. 下一次expectedVersion必须等于上一轮done.version，而不是固定为1。若从新会话开始，通常依次为1、2、3。
6. 页面刷新后应仍保留已提交回复，继续聊天仍携带恢复的版本。

修复只是客户端同步服务端版本，不移除CAS；另一标签/设备真实并发修改依然可以被409拒绝。不要在Network中手工猜版本或重放旧requestId。
当前localhost:5173及localhost:3000/api/health均在最终只读检查中200，不需要另起一套服务。HMR可能保留旧React状态，因此当前已冲突页面仍需上述一次刷新。
