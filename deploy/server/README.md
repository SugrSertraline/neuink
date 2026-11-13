# NeuInk Java 同步后端（alpha）

后端唯一入口为 `apps/server`：Java 21、Spring Boot 3.5.16、PostgreSQL、JDBC/HikariCP、Flyway。桌面和本地同步队列仍是 Rust。旧 Rust 服务已移出 Cargo workspace，本机恢复副本在 target/server-migration，不进入版本库。

后端与 Workspace 双向同步、首次预览和冲突界面已接入，真实 HTTPS 契约已验证；原生验收和日常 portable 更新仍未完成。故障验收只使用隔离资料目录。

## 代码结构

| 模块 | 职责 |
| --- | --- |
| AuthController / AuthService / SecurityConfig | 邀请注册、登录、会话、密码及设备管理、鉴权 |
| SyncController / SyncService | 私有库、对象版本、增量分页、历史、请求幂等 |
| BlobController / BlobService / FileManifest | 分块续传、完整性校验、取消、文件引用验证 |
| ServerIdentity / AdminCommand | 服务身份、恢复代际、就绪检查、管理员初始化 |
| db/migration | Flyway 顺序迁移，已执行的迁移不再修改 |

账号表为 users/invites/sessions/reset_tokens/auth_limits；同步表为 libraries/objects/changes/operations；文件清单为 blobs/uploads；服务器身份为 server_identity。正文使用 JSONB，大文件落磁盘。V2 增加配额、上传偏移、删除状态约束及查询索引。

## 构建和部署

仓库根目录执行 `mvn -B -ntp -f apps/server/pom.xml package`，要求 Java 21、Maven 3.9。普通构建只运行协议单元测试，真实数据库测试显式开启。

Docker：进入 deploy/server，将 .env.example 复制为 .env，设置独立随机数据库密码，执行 `docker compose up -d --build`。默认应用只发布到主机 127.0.0.1:8790，数据库不发布主机端口。Dockerfile 使用 Maven 构建、JRE 运行，应用以非 root、只读根文件系统运行，临时及附件目录可写。正式部署应固定已验证镜像摘要。

通过安全终端设置 NEUINK_ADMIN_USERNAME、NEUINK_ADMIN_PASSWORD（至少 12 字符），然后执行：

```sh
docker compose run --rm -e NEUINK_ADMIN_USERNAME -e NEUINK_ADMIN_PASSWORD app --spring.main.web-application-type=none --neuink.command=create-admin
docker compose run --rm app --spring.main.web-application-type=none --neuink.command=invite
```

无默认密码。邀请码限时单次使用，仅交给受邀用户，不放共享日志。初始化后清除密码环境变量。

直接运行 jar 需要 NEUINK_DATABASE_URL=jdbc:postgresql://主机:5432/库名、NEUINK_DATABASE_USER、NEUINK_DATABASE_PASSWORD、NEUINK_SERVER_STORAGE。可选 NEUINK_SERVER_ADDRESS、NEUINK_SERVER_PORT 默认 127.0.0.1:8790。/health 检查存活，/ready 检查数据库。

## 已挂载磁盘

将 jar 命名为 neuink-server.jar，用 Dockerfile.java-prebuilt 构建镜像。将 compose.bind.yaml 复制为独立部署目录的 compose.yaml，配置镜像、密码、UID/GID、已存在的存储目录。使用 start-mounted.py 指定 project、db-mount/db-uuid、attachment-mount/attachment-uuid 后启动。脚本核对实际磁盘 UUID，数据库必须在 ext4，附件可用挂载后的 NTFS；缺少磁盘时拒绝启动，避免写入系统盘。

挂载部署禁用容器自动重启，主机挂载依赖及开机恢复仍需验收。Ubuntu 验收实例应用监听回环 18790，使用隔离数据库/文件目录。暂复用已缓存的 Maven Java 21 镜像以减少 Docker 分区占用，正式运行应换精简 JRE 镜像。

## 网络与 Windows 代理

### 当前入口：局域网 HTTPS（2026-11-08 更新）

用户改为局域网账号密码登录后，当前服务入口为 `https://SERVER_IP:18793`，原回环 HTTP 端口和客户端 SSH 转发已停用。SSH 仅用于服务器维护，出站代理隧道与客户端登录无关。采用 Spring Boot 原生 TLS，参见[官方 SSL 配置](https://docs.spring.io/spring-boot/how-to/webserver.html)。

可复用 compose.lan.yaml：指定 NEUINK_LAN_ADDRESS、NEUINK_PORT、NEUINK_TLS_DIR，证书目录包含 server.crt 和 server.key，私钥仅保留服务器并只读挂载。沿用 start-mounted.py 的磁盘验证。当前证书 SAN 为服务器 IP，有效期一年；本机已信任该服务器证书，没有关闭证书或主机名校验。其他设备需先安装并核对证书；更换 IP 或证书后重新配置。证书及私钥不提交仓库，备份数据库和附件时还应独立保护 TLS 配置与私钥。

账户页面默认地址为空，用户填写并验证连接后才能登录，用户名、密码和个人信息不预填；注册仍使用一次性邀请码。校园不同网段若隔离，账号密码不能解决路由问题，需网络侧放通 TCP 18793 或使用可达的私有网络。当前只验证了本机到服务器，未验证所有校园 Wi-Fi。

运行 `start-windows-proxy.ps1 -Server 用户名@服务器 -IdentityFile 私钥路径`：Windows 127.0.0.1:7890 经 SSH 转发至 Ubuntu 127.0.0.1:17890，不修改全局代理。日志/PID 在 target/server-deploy。服务器用 curl --proxy http://127.0.0.1:17890 验证；Maven 用独立 settings.xml，本次构建容器通过 host 网络访问宿主回环。同步服务运行不依赖代理。Windows 睡眠或代理/SSH 断开后需要重连。

## 验证与限制

真实测试用独立 PostgreSQL，设置 NEUINK_INTEGRATION=true 和上述数据库/文件目录环境变量，执行 `mvn -B -ntp -f apps/server/pom.xml verify`。server-validation.yml 提供一次性 PostgreSQL 的 GitHub 验证，不发布服务；新增工作流尚未在线执行。

Rust 单元测试：`cargo test -p neuink-sync-protocol -p neuink-sync`。跨语言测试设置 NEUINK_CONTRACT_URL、NEUINK_CONTRACT_USERNAME、NEUINK_CONTRACT_PASSWORD，执行 `cargo test -p neuink-sync --test java_contract -- --ignored`。会创建隔离资料库和临时 SQLite 队列，不访问 portable/data。

详见[同步与文件协议](../../docs/design/sync-wire-protocol.md)。当前不自动合并正文，冲突保留后由客户端确认。刷新请求带持久化 request_id 时支持 120 秒内重放丢失的响应；过期上传每五分钟分批清理。管理员可查询账号、调整配额、禁用账号并撤销会话，账号变更写入审计表；已有独立管理网页，审计不是所有操作的完整审计。桌面资料投影和冲突界面已接入，跨 Wi-Fi 与原生人工验收仍未完成。旧 SQLx 数据库迁移未经验证，不能自动 baseline 跳过检查。

## 备份与隔离恢复

在使用 compose.bind.yaml 的部署目录运行 `python3 /脚本路径/backup.py backup /新备份目录 --project 项目名 --db-uuid 数据库磁盘UUID --files-uuid 附件磁盘UUID`。脚本核对挂载后暂停应用，保存 PostgreSQL 逻辑备份及附件，逐文件校验 SHA256，最后恢复应用。期间不要通过其他进程直接修改数据库或附件。备份目录含用户资料，应保持私有权限；不能只复制运行中的数据库目录。

`python3 /脚本路径/backup.py verify /备份目录` 可独立校验。恢复时先准备一个新的 Compose 项目、空数据库与附件目录，再运行 `python3 /脚本路径/backup.py restore /备份目录 --project 新项目名 --db-uuid 数据库磁盘UUID --files-uuid 附件磁盘UUID`。工具拒绝覆盖已有容器或非空目录，要求原镜像摘要仍可用；跨机器迁移需另行保留对应镜像。恢复后保留服务器身份、轮换 epoch、撤销所有旧会话，客户端必须重新核对同步基线。失败留下隔离目录供排查，不自动删除资料。

2026-11-08 已在 Ubuntu 独立目录完成备份、完整恢复和数据库数量核验；验证服务器身份保留、epoch 变化、旧会话撤销。恢复验收容器已停止并移除，备份和隔离数据保留。尚未配置定时备份、保留周期和主机重启后的自动启动。


## 2026-11-10 管理页面与备份轮转（alpha，待安装到现有部署）

服务同源 `/admin` 提供独立管理员页面。15 分钟短期会话写入 HttpOnly/Secure/SameSite=Strict Cookie，前端仅保留会话绑定的 CSRF 值；不使用 localStorage 保存令牌。普通账号、缺少 CSRF 的写请求和已撤销会话均拒绝。支持分页账号查询与筛选、配额、启停、注册上限、一次性邀请与密码重置、实际空间明细和审计。邀请与重置凭据仅在当前页面显示，不写日志。

`backup.py` 的新备份使用版本 2 清单，包含部署 `/tls` 挂载目录并校验，继续可读取版本 1 备份。恢复带 TLS 的备份必须使用空 TLS 目录，不覆盖现有证书。`backup_rotation.py` 复用一致性备份，保留最近 7 个不同日期和 4 个不同 ISO 周的最新成功备份；未完成/损坏记录保留供检查，轮转前重新校验，拒绝符号链接及越界目录。

安装时先为此部署创建专用空备份目录，再带 `--initialize`、`--project`、`--db-uuid`、`--files-uuid` 初始化。使用提供的 `neuink-backup.service`、`neuink-backup.timer` 模板，按实际部署修改 WorkingDirectory、脚本位置和 `/etc/neuink/backup.env`。环境文件包含 `BACKUP_ROOT`、`COMPOSE_PROJECT`、`DB_UUID`、`FILES_UUID`、`BACKUP_STATUS`，无需账号密码。定时器每日 03:00 加最多 15 分钟随机延迟，错过的执行会补跑；每次仍核对磁盘 UUID。首次应手工运行并验证后再启用 timer。

将 `BACKUP_STATUS` 放在独立、只含脱敏运行状态的操作目录，使用 `compose.operations.yaml` 只读挂载该目录到 `/ops`，设置 `NEUINK_OPERATIONS_DIR`。禁止把备份根目录挂入应用容器。后台未配置时明确显示“尚未配置”，不把脚本存在当作备份成功。本轮只完成隔离自动测试，未宣称定时备份已上线或已经具备异地容灾。


## 2026-11-10 现有部署已升级

现有服务已应用追加的 V7 迁移，使用 `neuink-sync:atomic-delete-20261110`（镜像摘要见 dev-plan）。升级前备份保留于服务器 NeuInk 根目录的 `pre-retention-20261110` 和 `pre-atomic-delete-20261110`，含数据库、附件、TLS 及镜像摘要；原环境配置另存为部署目录 `.env.before-retention-20261110` / `.env.before-atomic-delete-20261110`，均保持私有权限。

普通用户 `sugr` 的 crontab 已安装每日 03:00（主机 CST +0800）的轮转备份，以及开机后的挂载核对启动。运行器位于用户家目录 `.local/share/neuink-operations`，不依赖数据盘先挂载；最多等待 30 次，每次 60 秒，缺盘仍拒绝启动。没有获取 root 权限，没有改变其他服务。首次轮转备份已手工执行并校验，V7 数据及 TLS 已恢复到独立空目录验证，旧会话全部撤销且 epoch 改变；并非异地备份，也未实际重启整台服务器。

`run-user-operations.py` 使用无凭据配置文件调度 `start-mounted.py` / `backup_rotation.py`，备份状态只读挂载给管理后台；证书距到期不足 30 天使运维执行失败并写入私有任务日志。当前只配置日志提示，不宣称已接入外部告警。

应用回退：先暂停客户端同步并停止 app，保留当前数据库及附件备份，将部署 `.env` 中镜像改回已记录的旧镜像，再通过 `start-mounted.py` 启动；不回退已执行迁移，不删除卷。旧服务不支持整组删除/快照新接口，客户端会停止相关操作，不能当作功能兼容交付。需要回退数据库时使用备份工具恢复到独立空目录验证，再安排切换；恢复轮换 epoch，客户端必须预览并确认重新核对。不要在现有非空数据库目录覆盖恢复。


## 内测注册模式（2026-11-10）

`NEUINK_INVITE_REQUIRED` 默认 true，自建仍须一次性邀请码；设为 false 时允许省略或留空 invite，但输入非空邀请码仍需有效。当前内测部署已按用户要求在 compose.override.yaml 显式设为 false，使用 `neuink-sync:open-registration-20261110`。人数上限、密码规则、账号内配额和权限保持原规则。重新启用邀请只影响新注册，不禁用已有账号。升级前备份在 `pre-open-registration-20261110`，原部署环境及 override 单独保留供回退。

## 新电脑的信任与发布说明（2026-11-12）

Windows 应用签名与同步服务器 HTTPS 证书是两套信任。缺少 Authenticode 签名不妨碍生成普通 EXE/NSIS 安装程序，但 Windows 可能显示未知发布者、SmartScreen 提示，部分设备策略可能阻止运行；不要承诺所有电脑无提示安装。MSIX 的签名规则不同。发布脚本和 main 来源检查仍须修复及验证，不能把失败归因于没有签名证书。

正式部署建议使用稳定域名和系统已信任的 CA 签发的 HTTPS 证书，证书名称匹配连接域名。服务仍可通过校园网路由和防火墙限制访问；域名证书不要求把同步数据服务开放给公网。证书续期、完整证书链和客户端可达性需单独验收。

当前 IP / 自签证书的测试部署：由管理员通过可信渠道提供不含私钥的公开证书和 SHA-256 指纹，在新电脑核对指纹、有效期与地址后，再决定信任。Windows 当前用户可通过证书导入向导导入已核验的信任锚到“受信任的根证书颁发机构”；学校管理设备应优先由 IT 通过组策略统一下发。不要从未验证连接自动下载并信任证书，不要分发 server.key/PFX 私钥，不要关闭证书或主机名校验。证书轮换需要重新核验，IP 必须出现在证书 SAN 中。

当前程序尚未提供应用内证书导入/指纹确认功能，本次没有修改系统信任库或线上证书。后续如保留自签部署，应实现按服务器保存的应用专用信任及明确的换证确认，避免悄悄修改整机信任。

参考：[Windows 应用签名选项](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)、[SmartScreen 信誉](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)、[组策略分发证书](https://learn.microsoft.com/en-us/windows-server/identity/ad-cs/distribute-certificates-group-policy)。
