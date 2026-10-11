# AniBT-Speed

AniBT-Speed 是 AniBT 的下载、做种与媒体信息 Worker。单个进程管理一个 qBittorrent 实例，通过 API Key 访问 qB，订阅 AniBT 字幕组 RSS，并将完成种子的 MediaInfo 推送到 AniBT。

版本 1.0 完全移除了 Web 前端、HTTP 服务、多实例面板和旧调度器。进程不监听端口。运行状态写入本地文件，通过命令行读取。

## 调度设计

| 工作循环 | 职责 | 负载限制 |
| --- | --- | --- |
| 控制 | 增量读取 qB 状态、记录流量、规划队列与清理、提交下载、读取媒体文件清单 | 每 30 秒一轮，20 秒预算，每轮最多 8 个后续 qB 操作 |
| 订阅 | 同步字幕组目录、并发抓取 RSS、保存下载意图 | 每 5 分钟，最多 3 个并发请求，每轮有截止时间 |
| 下载准备 | 获取种子文件、计算原始 info 字典的哈希、确定保存目录 | 每轮最多 4 个条目；失败持久退避 |
| 媒体信息 | 从只读下载卷采样、执行 MediaInfo、推送 AniBT | 单并发；默认最多 6 个样本，每个进程 25 秒、256 MiB 地址空间上限 |

只有控制循环访问 qB。每轮调用一次 `/api/v2/sync/maindata`，后续使用 `rid` 获取变化；所有策略共享同一份快照。qB 不可用时停止本轮写操作，并按指数退避重试。请求不会自动降级为 HTTP、探测账号或重复提交。

每个循环最多执行一轮，不积累补跑队列。RSS、媒体信息和通知不会占住控制循环。SQLite 使用 WAL，网络请求与子进程均在数据库事务之外执行。数据库操作放到线程执行，避免阻塞异步调度。

## 下载与做种规则

- 默认排除 `kirara-fantasia`、`ani`、`zzz123`、`pre-s`、`silent-workshop`。通过 `ANIBT_EXCLUDED_GROUP_SLUGS` 修改；配置为空表示不排除字幕组。排除只影响新订阅和新下载，不自动删除已有种子。
- 发布 ID 与精确种子哈希用于去重；标题不参与身份判断。添加请求返回成功后，还必须在后续快照中观察到目标哈希，才记为下载已确认。超时产生的模糊结果先等待确认，再退避重试。
- 新订阅首次启动时可标记现有条目为历史；该状态持久保存，重启不会重新吞掉停机期间的新发布。每次检查完整的 RSS 返回窗口，不只截取前 5 项。超过窗口或超过 `RSS_MAX_AGE_HOURS` 的停机积压不保证补全。
- 新下载使用 `{DOWNLOAD_ROOT}/{字幕组}/{季度}/{番剧}/{infohash}`；`ktnbytes` 使用 `{字幕组}/合集/{infohash}`。独立哈希目录防止不同种子共用文件。已有种子的路径保持不动。
- 做种池默认目标为 300 个。实际上传、有下载者、完成后的热窗口和人工强制做种受到保护，因此这是软上限。空闲种子按持久保存的最近暴露时间轮转，每次默认 10 个，间隔至少 3 分钟，每个新暴露时段至少 10 分钟。
- 自动管理仅作用于指定分类、下载根目录内且无排除标签的种子。清理只处理已完成、已知完成时间、没有当前需求的种子；强制状态、缺文件状态及共享或嵌套内容路径受到保护。
- 空间不足时每轮先删除一个符合条件的种子，下轮重新观察真实空闲容量。保留期默认 90 天，设置 `RETAIN_DAYS=0` 关闭按年龄清理。已移除旧的标题关键词删除规则。
- 流量使用 qB 的累计字节计数差值，不再将瞬时速度乘以固定分钟数。计数重置不会产生负流量。

## 集成媒体信息

控制循环发现完成种子后，只读取尚未处理种子的文件清单。采集循环使用同一下载路径的只读挂载，不再独立轮询 qB 或通过 SSH 执行命令。

每个样本只执行一次 JSON 采集，并从结构化结果生成可读文本。合集包含文件清单与采样范围；没有解析全部媒体文件时，不推算总时长。采集使用低 CPU 与磁盘优先级，I/O 压力超过阈值时暂缓新采集。已生成的推送内容持久保存，网络重试不重复读盘。

设置 `MEDIAINFO_ENABLED=true` 和 `ANIBT_API_TOKEN` 后启用。Token 必须由 AniBT 媒体信息接收端授权。接口为 `PUT {ANIBT_API_URL}/api/releases/mediainfo`。

## 部署

需要 Docker Compose、qBittorrent 5.2 或更高版本，以及与 qB 保存路径一致的只读媒体卷。

1. 复制配置：`cp worker.env.example worker.env`。
2. 填写 `QBT_URL`、`QBT_API_KEY` 与 AniBT 设置，并执行 `chmod 600 worker.env`。
3. 确认 Compose 媒体卷。默认将宿主机 `/hdd/media` 只读挂载到 `/media`。可通过部署环境变量 `MEDIA_HOST_PATH`、`MEDIA_CONTAINER_PATH` 调整。
4. 运行 `./deploy.sh`。本地构建使用 `BUILD_LOCAL=1 ./deploy.sh`。
5. 执行 `docker exec anibt-speed python -m app status`，确认控制循环成功时间、各队列状态与镜像修订号。

同机 qB 建议直接访问 `http://host.docker.internal:8181`，避免经过公网反向代理。实际端口以 qB 配置为准。AniBT-Speed 不发布任何端口。

部署脚本在构建完成后停止旧 Worker，并通过 SQLite backup API 保存状态。新镜像启动失败时恢复旧镜像；备份存放于 `backups/`。版本 1.0 的首次迁移必须按下节操作，不能用旧参数直接启动。

## 一次性迁移

新版没有旧配置别名、旧数据库双写或旧 Agent 调用链。旧运行数据只通过显式导入命令读取。

1. 备份旧 AniBT-Speed 配置与 SQLite，并备份旧媒体采集程序、systemd 单元、配置和成功记录库。
2. 停止旧 Worker 和独立媒体采集服务，确保没有重复控制与采集。
3. 挂载只读备份目录，运行 `python -m app migrate --rss-history /backup/anibt_speed.db --media-history /backup/processed.db`。命令可重复执行；只导入发布处理凭证与成功的媒体推送记录。
4. 使用全新的 `worker.env` 启动 Worker，检查 `status` 和日志，并验证一次真实采集与推送。
5. 验证后禁用并移除旧媒体采集 systemd 单元及程序目录。保留备份用于回滚。

旧的失败次数和永久跳过记录不会迁入新媒体队列。失败条目按新策略重新尝试。

## 运维

```bash
docker exec anibt-speed python -m app status
docker exec anibt-speed python -m app status --live
docker logs --since 10m anibt-speed
docker exec anibt-speed python -m app inspect
```

`status` 在依赖故障或控制状态过期时返回非零值。`status --live` 只检查进程心跳，用于容器健康检查，避免 qB 暂时不可用导致重启风暴。两者均读取状态文件，不发起 qB 请求。

`inspect` 执行一次只读 qB 增量协议检查。`inspect --output /app/data/snapshot.json` 可保存本机诊断快照，文件包含种子路径和名称，应作为私有运维资料保管。

`DRY_RUN=true` 禁止 qB 写操作和媒体推送；旁路验证应使用独立 `STATE_DIR`。同一状态目录有进程锁，拒绝启动第二个 Worker。SIGTERM 会取消当前网络请求、终止媒体子进程并写入停止状态。

完整设置及默认值见 [配置定义](backend/app/config.py)。未知的 `worker.env` 配置键会在启动时报错，防止旧参数被悄悄忽略。

## 开发与验证

```bash
./test.sh
docker build -t anibt-speed:test .
uv run --directory backend python benchmarks/runtime.py --samples 3 --output /tmp/anibt-qbt-benchmark.json
```

Python 3.14；依赖版本锁定在 `backend/uv.lock`。测试覆盖超时与取消、单写入者、增量合并、下载确认与去重、重启恢复、队列公平轮转、清理保护和媒体推送重试。CI 通过后构建 amd64 与 arm64 镜像。

基准脚本只读访问 qB，交替比较完整列表与增量同步，单独记录首次完整同步开销。它测量接口传输与解析，不代表整机磁盘吞吐或 BT 上传速率的提升；遇到请求失败立即结束采样。

MIT License。
