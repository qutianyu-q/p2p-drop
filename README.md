# 空投 · 点对点文件互传

一个**完全免费、可自部署**的熟人文件互传网站。文件数据通过 WebRTC 在两个浏览器之间直连，**不经过任何服务器**——你的服务器只需要托管静态页面，撮合走免费的 PeerJS 公共云。

在线演示：https://o3vrfdovswja2.ok.kimi.link

## 特性

- 6 位房间码配对，支持二维码 / 分享链接扫码直达
- 多文件队列、整文件夹发送、拖拽添加
- 64 KB 分块 + 高低水位背压，超大文件不占内存
- **断点续传**：进度存 IndexedDB，断网 / 刷新 / 关浏览器重开后从未完成的块接着传
- 实时进度与速度，暂停 / 继续 / 取消
- Chrome / Edge 接收端直写磁盘；Firefox / Safari 走 OPFS 兜底
- 零后端代码，零付费依赖

## 快速开始

```bash
git clone <你的仓库地址>
cd p2p-drop
npm install
npm run dev
```

打开终端里显示的地址（默认 `http://localhost:5173`）。本机测试开两个浏览器窗口：一个「创建房间」，另一个输入房间码「加入」。

```bash
npm test         # 单元测试
npm run build    # 产出 dist/ 纯静态文件
```

## 免费部署（三选一）

### 方式一：GitHub Pages（自带自动部署）

本仓库已内置 GitHub Actions 工作流（`.github/workflows/deploy-pages.yml`）：

1. 把代码推到 GitHub 仓库的 `main` 分支
2. 仓库 Settings → Pages → Source 选择 **GitHub Actions**
3. 每次 push 自动测试、构建、发布，访问 `https://<用户名>.github.io/<仓库名>/`

已配置 Vite `base: './'`，子路径部署无需改代码。

### 方式二：Cloudflare Pages

1. Cloudflare Dashboard → Pages → 连接你的 Git 仓库
2. 构建命令 `npm run build`，输出目录 `dist`
3. 用分配的 `https://<项目名>.pages.dev` 访问

### 方式三：自己的服务器 / 任意静态托管

`npm run build` 后把 `dist/` 丢给 Nginx、对象存储或任何静态托管即可。**必须启用 HTTPS**（WebRTC 强制要求安全上下文），免费证书可用 Let's Encrypt。

## 自托管撮合服务（可选）

默认使用 PeerJS 公共云，零配置。想完全自控：

```bash
npm install -g peer
peerjs --port 9000
```

然后修改 `src/net/signaling.ts` 中 `new Peer(...)` 的配置，加 `host` / `port` / `path` 指向你的服务。公共 STUN 已内置；TURN 默认不配置（严格 NAT 下直连失败会提示换网络），需要时在 Peer 配置的 `config.iceServers` 中自行添加——注意 TURN 流量走你的服务器，会产生带宽成本。

## 使用须知

- 双方必须**同时在线**，发送方保持页面打开直到对方下完
- 一个房间 = 一收一发；不支持离线暂存（那需要服务器存储，超出纯 P2P 范畴）
- 严格 NAT / 校园网 / 部分公司网可能连不上，换网络或开手机热点再试
- 超大文件（几十 GB）建议双方都用 Chrome / Edge

## 技术原理

```
发送方浏览器 ◄── 信令 ──► PeerJS 公共云 ◄── 信令 ──► 接收方浏览器
      └──────────────► WebRTC DataChannel（文件直连）◄──────────────┘
```

- 控制通道传 JSON 消息（元数据 / 进度位图 / 暂停继续 / 完成回执），每个文件一条独立数据通道传 64 KB 二进制块
- 发送方按 `bufferedAmount` 做 16 MB / 4 MB 高低水位背压
- 接收方逐块置位图并持久化；重连时回传位图，发送方只补缺失块

## 目录结构

```
src/core/       纯逻辑：房间码、分块编解码、进度位图、背压
src/net/        协议、PeerJS 撮合、发送/接收会话
src/storage/    IndexedDB 进度存储、文件落盘 Sink
src/ui/         首页与房间视图
tests/          Vitest 单元测试
docs/           设计与实现文档
```

## 贡献

欢迎 Issue 和 PR。提交前请确保 `npm test` 与 `npm run build` 通过。

## 许可

[MIT](./LICENSE)
