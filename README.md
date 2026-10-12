# AniBT

AniBT 是从 AniBT 发布目录订阅资源、管理 qBittorrent 下载与做种、回传 MediaInfo、发送 Telegram 通知的原生 Worker。没有前端、HTTP 服务或监听端口；运行时由 systemd 管理，无需 Docker、Python 或 Node.js。

运行依赖：Linux、systemd 252+、`mediainfo`、`util-linux`、`coreutils`、系统 CA 证书。qBittorrent 使用支持结构化添加回执的 5.2 系列，仅通过 API key 认证。Worker 与 qB 可以采用不同的部署方式。

## 发布到完成

1. 定期更新字幕组目录，按组拉取 RSS。首次订阅只登记历史，之后使用 ETag/Last-Modified 条件请求。默认排除 `kirara-fantasia,ani,zzz123,pre-s,silent-workshop`，可通过配置调整。
2. 发布进入持久准备队列。验证来源身份、发布时间、季度接口与种子元数据，计算真实 infohash。源修正会撤销旧准备结果；已提交的操作先确认旧哈希。
3. 控制器读取 qB 增量快照，执行有限数量的队列、下载、清理和文件清单操作。空间不足时暂停新下载。添加请求先记为待确认，再按快照确认入队；分别记录下载完成、停滞、文件丢失和任务消失。
4. 已完成内容进入媒体队列。每次只读取一个样本，保存进度后让出执行机会；进程有超时、内存、输出和 I/O 限制。处理结果独立重试上传。集合时长只在全部媒体文件都分析完成时求和。
5. 做种池优先保护实际需求、近期完成和人工强制状态。冷种按上次暴露时间公平轮转，目标数量是软上限。
6. 回收仅处理已完成、超过保护时间、无下载者且归属明确的种子。删除前刷新 qB 状态，检查共享目录、文件清单、实际大小与安全路径；媒体领取与删除互斥。删除后等下一份快照确认。
7. 业务变化与 Telegram 发件箱同事务落库。429 遵守 `retry_after`，超时与重启后继续重试；每日摘要送达后才记完成。Telegram 不提供幂等发送键，因此响应丢失时可能重复通知，采用至少一次投递。

新下载路径：`QBT_DOWNLOAD_ROOT/<字幕组>/<季度>/<番剧>/<infohash>/...`。`ktnbytes` 使用 `<字幕组>/合集/<infohash>/...`。qB 分类保留 `AniBT`，字幕组进入标签。已有文件不会被迁移或改名。

## 配置

复制 [anibt.env.example](anibt.env.example) 并填写凭证。配置文件只接受 `ANIBT_*`，未知项直接报错；没有旧参数别名。环境变量可覆盖文件值。配置文件应为 `0600`，不要提交到仓库。

| 设置 | 含义 |
| --- | --- |
| `ANIBT_QBT_URL` / `ANIBT_QBT_API_KEY` | 直连 qB 的地址与 API key |
| `ANIBT_API_URL` / `ANIBT_API_TOKEN` | AniBT 来源与 MediaInfo 上传凭证 |
| `ANIBT_QBT_DOWNLOAD_ROOT` | qB 所见保存目录，生产为 `/media/AniBT` |
| `ANIBT_MEDIA_ROOT` | 同一目录在宿主机的位置，生产为 `/hdd/media/AniBT` |
| `ANIBT_STATE_DIR` | 本机持久状态目录，默认 `/var/lib/anibt` |
| `ANIBT_CONTROL_INTERVAL` / `ANIBT_CONTROL_BUDGET` | 控制间隔与每轮时限，默认 `30s` / `20s` |
| `ANIBT_CONTROL_COMMANDS` | 一轮初始快照之后的 qB HTTP 调用上限；开启清理时至少 5 |
| `ANIBT_POOL_TARGET` | 做种池软目标，默认 300 |
| `ANIBT_RETAIN_DAYS` | 默认 90 天；0 关闭按年龄回收 |
| `ANIBT_MEDIA_SAMPLES` | 媒体采样数，默认 6，范围 1–20 |
| `ANIBT_MAX_ATTEMPTS` | 单任务连续失败上限，默认 12；达到后进入 `blocked`，Telegram 持续重试 |
| `ANIBT_TELEGRAM_ENABLED` / `ANIBT_TELEGRAM_TOKEN` / `ANIBT_TELEGRAM_CHAT_ID` | Telegram 开关、Bot token 和接收者 |

时间参数使用 `30s`、`5m`、`12h` 等带单位格式。容量使用 GiB，速率使用 MiB/s。完整默认值以示例文件为准。

## 构建与部署

构建需要 [go.mod](go.mod) 指定的 Go 工具链；构建和部署脚本额外需要 Python 3。

```bash
./test.sh
./scripts/build.sh amd64
./scripts/build.sh arm64
```

`dist/linux-<架构>/` 包含静态 Worker、systemd 模板、版本清单和 SHA256SUMS。先在目标主机安装运行依赖，再以 root 执行：

```bash
apt-get install mediainfo util-linux coreutils ca-certificates
python3 scripts/deploy.py apply dist/linux-amd64 --config /root/anibt.env
```

安装位置为 `/opt/anibt/releases/<revision>`，`/opt/anibt/current` 指向当前版本。服务以独立用户 `anibt` 运行，通过 systemd credentials 读取配置；只有状态目录可写，媒体目录只读，禁止进程绑定端口。使用 `systemctl status anibt` 和 `journalctl -u anibt` 管理运行状态。

部署前会备份数据库、配置、单元文件和版本指针。部署结果会给出备份路径。回滚命令：

```bash
python3 scripts/deploy.py rollback /opt/anibt/backups/<备份目录>
```

激活前可完整恢复快照。激活后同模式回滚保留实时数据库，避免重复执行已发出的下载或删除；首次从 Docker 迁入后不能自动回滚到旧状态，需修复原生版本或执行明确的反向状态迁移。备份包含凭证，应限制访问。

### 从 v1 迁移

先停止旧 Worker，使用 SQLite backup API 制作一致性快照。转换工具只用于这一次迁移，不参与正常运行。目标状态目录必须为空。

```bash
python3 scripts/convert-v1-config.py /旧目录/worker.env /root/anibt.env
./anibt --config /root/anibt.env import-v1 /备份/v1.sqlite3
python3 scripts/deploy.py apply dist/linux-amd64 --config /root/anibt.env
```

导入保留订阅初始化、发布历史、下载意图、做种暴露和成功媒体凭证。旧的错误来源拒绝不会导入为全局成功记录。确认新服务运行后，删除旧 Worker 容器和旧 mediainfo-agent 服务；保留受限备份。qBittorrent 无需迁出 Docker。

## 无界面运维

以下命令以 root 在生产主机执行，`--config` 必须位于子命令之前。

```bash
/opt/anibt/current/anibt --config /opt/anibt/current/worker.env status
/opt/anibt/current/anibt --config /opt/anibt/current/worker.env check
/opt/anibt/current/anibt --config /opt/anibt/current/worker.env queue media
/opt/anibt/current/anibt --config /opt/anibt/current/worker.env retry media:<infohash>
/opt/anibt/current/anibt --config /opt/anibt/current/worker.env cancel media:<infohash>
/opt/anibt/current/anibt --config /opt/anibt/current/worker.env replay <release-id>
/opt/anibt/current/anibt --config /opt/anibt/current/worker.env diagnose --hash <infohash> --probe
```

`queue` 最多显示 200 个任务，包含阶段、次数、下次运行时间与错误，不输出凭证和完整载荷。`retry` 保留去重语义；`replay` 明确重新准备一个仍保留来源信息的发布。正在领取或等待外部结果确认的任务不能直接覆盖。`cancel` 记录人工取消，不能撤销已发出的外部操作。

对 qB 的「丢失文件」，先用 `diagnose` 检查文件存在性、大小、路径和共享关系。`--probe` 只分析一个实际媒体文件，不上传。缺失、大小冲突或共享所有权没有解决前，不自动删除或重下。文件已恢复后，停止 Worker 再执行：

```bash
/opt/anibt/current/anibt --config /opt/anibt/current/worker.env recover --hash <infohash> --recheck
systemctl start anibt
```

`recover` 重新核验文件后只请求 qB 校验，不移动、覆盖或删除数据。

## 验证与设计

[领域术语](CONTEXT.md)、[架构决定](docs/adr/0001-native-worker.md)、[重构验证记录](docs/validation.md)。测试覆盖任务领取竞争、SQLite 取消、RSS 修正与条件请求、哈希去重、流量缺口、Telegram 重试、媒体进度、qB 协议和部署回滚。
