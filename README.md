# Claude Code Skill Manager

一个独立的桌面应用，用于管理 [Claude Code](https://claude.ai/code) 中安装在本地的 skill。支持查看 skill 详细指令、实时启用/禁用 skill（项目级 + 全局级），自动检测本地所有 skill 目录。

## ✨ 核心功能

- **Skill 浏览与搜索** — 卡片式网格布局，实时搜索筛选，按来源/启用状态分类
- **指令快速查看** — 点击任意 skill 即可在右侧详情面板中查看完整的 SKILL.md 渲染内容
- **一键启用/禁用** — 项目级（`.claude/skills/`）和全局级（`~/.claude/skills/`）独立控制
- **多来源自动检测** — 自动扫描 `~/.claude/skills/`、`~/.agents/skills/`、插件市场目录，也支持手动添加自定义目录
- **目录扫描预览** — 可扫描任意本地文件夹，预览其中包含的 skill 后再决定是否添加为来源
- **暗色主题 UI** — 简洁现代的暗色界面，原生浏览器渲染

## 🚀 快速开始

### 方式一：Electron 桌面应用

```bash
npm install
npm start
```

### 方式二：CLI 服务器模式

```bash
npm run start:cli
# 或指定端口和项目路径
node skill-manager.js --port 3000 --project C:\Users\me\my-project
```

浏览器会自动打开 `http://localhost:<port>`。

## 📦 构建安装包

```bash
npm run build
```

构建产物输出到 `dist/` 目录，生成 Windows 便携版 `.exe` 文件，无需安装即可运行。

## 🏗️ 项目结构

```
├── main.js                  # Electron 主进程入口
├── skill-manager.js          # CLI 入口（纯 Node.js，无需 Electron）
├── start.bat                 # Windows 一键启动脚本
├── package.json              # 项目元数据，零运行时依赖
├── lib/
│   ├── server.js             # HTTP 服务器 + REST API + 静态文件服务
│   ├── skill-store.js        # Skill 扫描引擎（YAML 解析、去重、缓存、状态检测）
│   ├── skill-actions.js      # 启用/禁用操作（符号链接 → junction → 拷贝三级回退）
│   └── config-store.js       # 配置加载/持久化 + 常量定义
└── public/
    └── index.html            # 完整 SPA 前端（HTML + CSS + vanilla JS，零框架）
```

## 🔧 技术要点

| 特性 | 实现 |
|------|------|
| 后端 | Node.js 内置模块（`http`, `fs`, `path`, `os`），零 npm 运行时依赖 |
| 前端 | 单 HTML 文件 SPA，原生 JS + CSS，无构建工具 |
| Skill 发现 | 递归扫描最大深度 3，YAML frontmatter 解析，MD 去重 |
| 启用机制 | 符号链接 → Windows Junction (`mklink /J`) → 目录拷贝 三级回退 |
| 并发安全 | 每个 skill 一个 Promise 互斥锁，串行化同名操作 |
| 桌面打包 | Electron + electron-builder，Windows 便携版 |

## 📋 API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/skills` | 列出所有 skill（支持 `?search=&source=&status=`） |
| GET | `/api/skills/:name` | 获取 skill 详情 + SKILL.md 全文 |
| POST | `/api/skills/:name/enable` | 启用 skill，body: `{scope: "user"\|"project"}` |
| POST | `/api/skills/:name/disable` | 禁用 skill |
| GET | `/api/sources` | 列出已配置的来源目录 |
| POST | `/api/sources/add` | 添加自定义来源 |
| DELETE | `/api/sources/:index` | 移除来源 |
| POST | `/api/scan-directory` | 扫描任意本地文件夹 |
| POST | `/api/scan` | 重新扫描所有来源 |
| GET/PUT | `/api/config` | 获取/更新配置 |

## 🖥️ 系统要求

- Windows 10+（主要支持平台）
- Node.js 18+（CLI 模式）
- 如需创建符号链接：Windows 开发者模式（可选，失败时自动回退到拷贝）

## 🐛 调试

```bash
# CLI 模式直接查看控制台输出
node skill-manager.js --no-browser

# Electron 模式打开 DevTools
# 启动后按 F12 或 Ctrl+Shift+I
```
