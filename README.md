# AT Pet

面向个人注意力主权的纯本地浏览器扩展与伴生数字宠物。通过“投喂”交互收集你的审美偏好，在 **B 站 / 小红书 / 抖音** 网页版信息流中，结合 **BGM/元数据规则 + 本地 WebGPU/WASM 语义向量 + 正负样本纠偏**，实时拦截 AI 批量水货与同质化洗稿内容。

详细设计见 [docs/design.md](docs/design.md)。

## 架构特点

* **零后端安装**：基于 WXT + Chrome MV3 `Offscreen Document` + `Transformers.js`（WebGPU 优先，自动回退 WASM）+ `IndexedDB`，纯浏览器端离线运行。
* **被动 API 拦截优先**：在 Main World 轻量读取平台原生推荐流响应，零额外请求、不触发风控。
* **正负样本对抗边界**：投喂写入负样本，误杀点“吐出”写入正样本白库并降权对应负样本，避免同主题优质内容被一刀切误杀。
* **严格 Fail-Open 降级**：模型加载中或推理超时（> 500ms）时静默放行原网页卡片，绝不阻塞刷流。

## 快速开始

```bash
# 安装依赖
pnpm install

# 运行单元测试
pnpm test

# 类型检查
pnpm typecheck

# 本地开发（Chrome/Edge）
pnpm dev

# 构建生产包（输出在 .output/chrome-mv3）
pnpm build
```

构建完成后，在 Chrome / Edge 打开 `chrome://extensions`，开启「开发者模式」，点击「加载已解压的扩展程序」并选择 `.output/chrome-mv3` 目录即可。

## 目录结构

```text
├── docs/design.md                       # 技术设计文档（v2.0）
├── src/
│   ├── adapters/                        # 站点适配器（Phase 1: B 站）
│   ├── engine/                          # L1 规则/BGM 加权、L2 正负样本向量、Fail-Open 管线
│   ├── entrypoints/
│   │   ├── background.ts                # MV3 Service Worker 调度与 Offscreen 管理
│   │   ├── bilibili-hook.content.ts     # Main World 被动 API 拦截
│   │   ├── bilibili.content.ts          # B 站卡片遮罩与 Undo Toast
│   │   ├── offscreen/                   # 本地 WebGPU/WASM 推理与 IndexedDB 存储
│   │   └── popup/                       # 宠物状态与阈值设置弹窗
│   ├── storage/db.ts                    # Dexie IndexedDB 数据表定义
│   └── types/                           # 统一 Schema 与 RPC 消息类型
└── tests/engine.test.ts                 # 核心过滤引擎单元测试
```
