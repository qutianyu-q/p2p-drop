# 空投 · 点对点文件互传

熟人之间的纯 P2P 文件互传网站：文件数据通过 WebRTC 在两个浏览器之间直连，**不经过任何服务器**。支持多文件、整文件夹、几十 GB 超大文件、断点续传。

## 本地运行

```bash
npm install
npm run dev -- --port 7100
```

打开 `http://localhost:7100/`。本机测试可开两个浏览器窗口：一个「创建房间」，另一个输入 6 位房间码「加入」。

```bash
npm test    # 20 个单元测试
npm run build
```

## 用法

1. 发送方点「创建房间」，把 6 位房间码（或二维码/链接）发给熟人
2. 发送方拖入文件或选择文件夹
3. 接收方输入房间码加入，点「接收」选择保存位置
4. 中断也没关系：接收方重新加入同一房间码、点「继续接收」，从未完成的块接着传

**双方必须同时在线，发送方保持页面打开直到对方下完。**

## 零成本部署（全免费）

| 项目 | 免费方案 |
|---|---|
| 静态托管 | Cloudflare Pages / GitHub Pages |
| 域名 + HTTPS | 平台送的子域名（如 `*.pages.dev`），自带 HTTPS |
| 撮合 signaling | PeerJS 公共云（默认配置，零改动） |
| STUN | PeerJS 内置公共 STUN |
| TURN | 不配置；严格 NAT 下直连失败时提示换网络 |

Cloudflare Pages 部署步骤：

1. 把本仓库推到 GitHub
2. Cloudflare Dashboard → Pages → 连接仓库
3. 构建命令 `npm run build`，输出目录 `dist`
4. 完成。用分配的 `https://<项目名>.pages.dev` 访问即可

## 升级路径（以后需要时再做）

- **自托管撮合**：`npm i -g peer` 后 `peerjs --port 9000` 即可跑开源 PeerJS 服务端（可放 Oracle Cloud 永久免费虚机），前端在 `src/net/signaling.ts` 给 `new Peer(...)` 加 `host/port/path` 配置即可切换
- **TURN 兜底**：自建 coturn 后在 Peer 配置的 `config.iceServers` 里加 TURN 条目。注意 TURN 流量走你的服务器，会产生带宽成本

## 已知限制

- 严格 NAT / 校园网 / 部分公司网下可能连不上（无 TURN），换网络或开手机热点再试
- 超大文件直写磁盘依赖 Chrome / Edge 的 File System Access API；Firefox / Safari 走 OPFS 暂存 + 完成后导出，超大文件能力受限
- 一个房间对应一收一发；不支持离线暂存（发完即走需要服务器存储，超出纯 P2P 范畴）

## 技术要点

- 64 KB 分块 + 12 字节二进制块头；发送方按 `bufferedAmount` 做 16MB/4MB 高低水位背压
- 接收方逐块置位图，位图持久化到 IndexedDB；重连时发送位图，发送方只补缺失块
- 设计文档：`docs/superpowers/specs/2026-11-07-p2p-file-transfer-design.md`
