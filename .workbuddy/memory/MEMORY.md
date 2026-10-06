# 项目长期约定（MEMORY）

## heq-portal（个人服务导航页）
- 定位：个人非商用引导页，仅用于个人作品 / 兴趣 / 工具类内容的跳转。
- 硬性约束：禁止放入任何带盈利 / 经营性质的服务（如云盘、网盘、电商、付费会员等）。
- 架构：v2.0 起为纯静态站点，服务列表写在 `services.config.js`（`window.HEQ_SERVICES`），前端直接读取，无后端注册/心跳机制。`server.js` 仅为可选本地静态服务器。
- 部署拓扑：引导页（静态站）与多个前后端分离的服务**同机不同端口**，经 nginx 反代统一到一个域名。跳转走 `gateway.html?service=slug` → 前端读 config 跳 `targetUrl`（纯浏览器端重定向，nginx 不参与跳转）。
- 反代约定：用户接受「每新增一个服务就在 nginx 加一段 location 反代」（未采用 map 写法优化）。前端 API baseURL 必须填公网可达地址（域名/反代路径），**不能用 localhost/127.0.0.1**（浏览器侧解析会连到访客本机）。参考模板：`nginx.example.conf`。
- **线上真实部署参数（2026-10-06 核实）**：真实域名即 `638rember.me`（不是占位）。nginx 站点配置在 `/etc/nginx/sites-available/default`，由 `sites-enabled/default` 软链启用；引导页部署目录（root）为 `/opt/heq-portal`（index.html / services.config.js 在此）；HTTPS 证书由 Certbot 管理（`/etc/letsencrypt/live/638rember.me/`）。排查注意：`sites-enabled` 是软链，`grep -r sites-enabled` 不跟随软链，要 grep `sites-available`。新增服务反代段加在 638rember.me 的 443 server 块内、与 `location /` 同级。
