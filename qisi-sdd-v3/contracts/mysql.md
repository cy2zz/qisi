# MySQL 8.4运行与迁移契约｜qisi-3.1

选型依据ADR-001、机器配置stack.json/runtime.json。A负责实现mysql2 promise连接池、迁移器、容器和所有DDL，B通过共享门面接入checkpoint。当前SQL是待执行规格，不是已验证迁移。

## 连接与数据类型

MySQL Community 8.4 LTS，InnoDB，utf8mb4。数据库/账号名配置由服务端环境读取，不是用户输入。开发与生产用同版本线；不用H2/SQLite替代集成测试。连接池上限10，有限等待及连接超时；每连接初始化time_zone='+00:00'及READ COMMITTED。mysql2 UTC转换显式配置，DATETIME(3)读写在边界转ISO8601 UTC，不能依赖机器本地时区。

ID、哈希采用ASCII二进制比较，区分大小写；正文/数学字符为utf8mb4。JSON字段使用原生JSON，不能先转SQL字符串拼接；参数化execute/query。数据库约束不能替代严格Zod/语义验证。MySQL数字/布尔/JSON/date解码必须有往返测试。禁止SQL拼接学生输入及开启multipleStatements处理外来数据。

使用支持默认caching_sha2_password的驱动；不为旧教程默认开启mysql_native_password。生产远程连接校验证书，禁止rejectUnauthorized=false；数据库仅私网可达，应用账号无全局权限。迁移账号与运行账号分离，凭据不进Git/日志/浏览器。MYSQL_REQUIRE_TLS仅本地环回开发可关闭；生产远程连接必须开启。

## 迁移和启动（A01实现脚本）

1. docker compose up -d mysql，健康检查通过；或连接指定MySQL8.4测试/部署实例。镜像锁具体8.4.x和digest，不用latest。
2. npm run db:migrate：先检查SELECT VERSION()为8.4.x；读取migrations排序版本与校验和；单迁移进程/命名锁；应用显式DDL并登记schema_migrations。
3. MySQL DDL不能按普通业务事务回滚理解。失败记录、停止启动，不自动继续；使用向前修复迁移，破坏性迁移前备份；禁止启动时自动清库/重建。
4. npm run db:seed:fixture：只在显式fixture开发模式幂等导入自拟数据，不冒充官方题库；生产不自动seed。
5. npm run dev或npm run build && npm start；应用只接收已迁移schema。健康检查区分进程存活与数据库就绪，不返回连接串。

数据库不可用时报告明确失败/恢复状态，不自动换内存库；已经成功commit的请求从requests恢复，未成功的不能假装已显示。

## 事务/约束

session版本CAS+行锁、UNIQUE(owner_id,request_id)、唯一任务首测、事件seq、两探针CHECK、FK级联是存储底线。模型调用放事务外。固定锁顺序与迟到提交规则见workflow-persistence.md；请求payload冲突不是数据库重试理由。

schema_migrations + 原16业务表 + workflow_checkpoints/workflow_writes，共19张表。有些时间/枚举规则由应用验证，不能把SQL结构校验当全部产品实现。数据库初始化SQL用于空库；升级已有数据库必须单独迁移，不对存量重复执行CREATE TABLE。

## 验证命令与诚实边界

规格静态：python qisi-sdd-v3/scripts/validate_spec.py；不执行SQL。
独立MySQL DDL冒烟：python qisi-sdd-v3/scripts/validate_mysql.py。需mysql CLI（可配置MYSQL_TEST_CLI）、MYSQL_TEST_DATABASE（必须qisi_spec_前缀、已有且空）、MYSQL_TEST_HOST/PORT/USER和外部安全登录配置（mysql_config_editor或临时MYSQL_PWD）。脚本只写指定空测试库，明确QISI_MYSQL_SPEC_TEST=1才执行；结束清理仅自己创建的表。认证字符串不写报告。
应用集成：npm run test:db和npm run test:stack，由A01实现，要求真实8.4。ST用例存在但未执行不得计通过。MySQL smoke只证明DDL和有限约束，不证明LangGraph恢复、事务竞态或学习效果。

## 部署与备份

一个Next.js业务容器、一个MySQL服务、私有媒体卷。首版只一个Node恢复器；DB服务不能公网直接访问。不依赖容器可写层持久化MySQL或手写图片。D7测试数据库备份/恢复+媒体映射一致性；D10在干净环境重新部署并重跑。备份包含个人数据也必须私有、限期删除，不导出到Git；恢复后重新应用删除/TTL策略，不能借备份复活已删除数据。
