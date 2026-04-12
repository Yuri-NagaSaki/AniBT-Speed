# AniBT-Speed

种群加速管理平台 — 基于 qBittorrent 的自动化做种加速系统。

## 功能特性

- 🖥️ **Web 管理面板** — React 19 + Tailwind CSS 现代化界面
- 🔄 **多实例管理** — 支持同时管理多个 qBittorrent 实例
- 📡 **RSS 自动订阅** — 自动下载 RSS 源中的新种子
- 💾 **智能空间管理** — 基于时间和分享率的自动删除策略
- ⏸️ **智能队列** — 无人下载自动暂停，有下载者自动恢复
- 🚦 **速率限制** — 基础限速 + 滑动窗口流量控制
- 🛡️ **反吸血保护** — PeerBanHelper 集成
- 📱 **Telegram 通知** — 关键事件推送 + 每日统计

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19, TypeScript, Vite, Tailwind CSS, Radix UI, TanStack (Router/Query/Table), Recharts |
| 后端 | FastAPI, Python 3.11, SQLite, APScheduler, qbittorrent-api |
| 部署 | Docker Compose, Nginx |
| 反吸血 | PeerBanHelper |

## 快速开始

### 前置条件

- Docker & Docker Compose
- 已运行的 qBittorrent 实例（需开启 WebUI API）

### 部署

```bash
# 克隆仓库
git clone git@github.com:Yuri-NagaSaki/AniBT-Speed.git
cd AniBT-Speed

# 配置环境变量
cp .env.example .env
# 编辑 .env 填入你的配置

# 启动服务
docker compose up -d
```

### 访问

- Web 管理面板: `http://your-server:3000`
- 后端 API: `http://your-server:8000/docs`

## 配置

所有策略参数均可通过 Web 管理面板在线调整，无需修改配置文件或重启服务。

## License

MIT
