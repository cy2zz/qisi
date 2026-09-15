# 启思 AI（Qisi AI）

面向高中数学学习的 AI 思维教练。系统从高考真题和学生作答出发，分别判断答案与思路，结合学习记忆定位卡点，通过多轮提示、举一反三和延迟复测帮助学生真正掌握知识点。

## 工程结构

```text
qisi-ai/
├── frontend/  React + Vite + react-markdown
├── backend/   Java 17 + Spring Boot 3 + MyBatis
└── README.md
```

## 本地开发

### 前端

```bash
cd frontend
npm install
npm run dev
```

前端默认地址：`http://localhost:5173`，`/api` 会代理到后端 `http://localhost:8080`。

### 后端

Spring Boot 3 需要 Java 17 或更高版本。

```bash
cd backend
mvn spring-boot:run
```

后端默认地址：`http://localhost:8080`。

可用接口：

- `GET /api/health`：健康检查；
- `GET /api/questions/1`：获取初始化的 Mock 真题。

## 构建与测试

```bash
cd frontend && npm run build
cd backend && mvn test
```

## MVP 主流程

```text
学生输入真题与思路
→ 答案 × 思路初判
→ 读取学习记忆
→ 定位第一个思维卡点
→ 多轮提示与学生回应
→ 学生选择巩固 / 举一反三 / 讲解 / 同伴学习
→ 记录掌握点与薄弱点
→ 掌握判断与延迟复测
```

## 后续开发建议

1. 建立 Question、Attempt、LearningSession、ConceptMemory 等核心数据模型；
2. 接入 Markdown / LaTeX 编辑与渲染；
3. 接入手写图片上传、OCR 和公式识别；
4. 实现答案与思路四象限初判；
5. 实现 Agent Prompt 编排、多轮干预与题型模型；
6. 接入数学答案和变式题校验；
7. 实现作答历史、知识画像、奖励与复测调度。

## 说明

当前初始化使用 H2 内存数据库和一条 Mock 题目数据，便于快速启动。正式开发时可替换为 MySQL，并通过 MyBatis XML 或注解完善数据访问层。
