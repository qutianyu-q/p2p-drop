# 零成本 P2P 文件互传网站 实现计划

> 执行方式：本会话内联执行（不使用子代理），按任务顺序逐个完成，每个任务结束后提交 git。

**Goal:** 做出可本地运行、可免费部署的熟人 P2P 文件互传网站，支持超大文件分块、背压、断点续传。

**Architecture:** Vite+TS 单页应用；PeerJS 公共云做撮合；两条 DataConnection（control + 每文件 data）；接收端 File System Access / OPFS 落盘，进度存 IndexedDB。

**Tech Stack:** TypeScript, Vite, Vitest, peerjs, idb, qrcode；测试 DOM 存储用 fake-indexeddb。

## Global Constraints

- 全部依赖必须免费、可 npm 安装；不引入任何付费服务
- 纯前端仓库，无自建后端代码
- 中文 UI
- 房间码：6 位，字符集去掉 0/O/1/I
- 数据块 64 KB；背压高水位 16 MB、低水位 4 MB
- `npm run dev` 必须能转发 `--host/--port` 参数（Vite 默认支持）

## 文件结构

```
index.html, package.json, tsconfig.json, vite.config.ts
src/main.ts                  入口与路由（首页/房间页）
src/style.css                全部样式
src/core/roomCode.ts         房间码生成/规范化/校验
src/core/chunks.ts           块大小、块数、块二进制编解码、文件指纹
src/core/bitmap.ts           接收进度位图
src/core/backpressure.ts     背压控制
src/net/protocol.ts          控制消息类型与编解码
src/net/signaling.ts         PeerJS 封装（创建/加入房间）
src/net/sender.ts            发送会话（队列、切片、背压、补发）
src/net/receiver.ts          接收会话（写盘、位图、续传）
src/storage/receiveStore.ts  IndexedDB 进度持久化
src/storage/sink.ts          文件写入 Sink（FS Access / OPFS）
src/ui/home.ts               首页视图
src/ui/room.ts               房间视图（发送方/接收方共用骨架）
tests/*.test.ts              Vitest 单测
```

---

### Task 1: 工程骨架

**Files:** package.json, tsconfig.json, vite.config.ts, index.html, src/main.ts（占位）, src/style.css（占位）
**Produces:** `npm run dev/build/test` 可用。

- [ ] 写 package.json：deps `peerjs@^1.5`, `idb@^8`, `qrcode@^1.5`；devDeps `vite@^5`, `typescript@^5`, `vitest@^2`, `fake-indexeddb@^6`, `@types/qrcode`；scripts `dev: vite`, `build: tsc --noEmit && vite build`, `test: vitest run`, `preview: vite preview`
- [ ] tsconfig：target ES2022, module ESNext, moduleResolution bundler, strict, lib ES2022+DOM+DOM.Iterable, types vitest/globals 不需要（用显式 import）
- [ ] vite.config.ts：`export default defineConfig({ server: { host: true } })`
- [ ] index.html：`<div id="app">`，引 `/src/main.ts`
- [ ] `npm install` 后 `npm run build` 通过
- [ ] 提交 `chore: 工程骨架`

### Task 2: 房间码 roomCode.ts（TDD）

**Produces:** `generateRoomCode(): string`；`normalizeRoomCode(s: string): string`；`isValidRoomCode(s: string): boolean`
字符集 `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`（32 字符）。

- [ ] 失败测试 tests/roomCode.test.ts：

```ts
import { describe, it, expect } from 'vitest';
import { generateRoomCode, normalizeRoomCode, isValidRoomCode } from '../src/core/roomCode';

describe('roomCode', () => {
  it('生成 6 位合法房间码', () => {
    for (let i = 0; i < 100; i++) {
      const c = generateRoomCode();
      expect(c).toHaveLength(6);
      expect(isValidRoomCode(c)).toBe(true);
    }
  });
  it('拒绝易混淆字符与非法长度', () => {
    expect(isValidRoomCode('ABCD0O')).toBe(false);
    expect(isValidRoomCode('ABC')).toBe(false);
  });
  it('规范化小写与空白', () => {
    expect(normalizeRoomCode(' ab-cd ef ')).toBe('ABCDEF');
  });
});
```

- [ ] 跑测试确认失败；实现；跑测试通过
- [ ] 提交 `feat: 房间码`

### Task 3: 分块 chunks.ts（TDD）

**Produces:**
`CHUNK_SIZE = 65536`；
`chunkCount(size: number): number`（ceil，0 字节返回 0）；
`encodeChunk(fileId: number, index: number, data: Uint8Array): ArrayBuffer`（头 12B：u32 fileId + u32 index + u32 dataLen）；
`decodeChunk(buf: ArrayBuffer): { fileId: number; index: number; data: Uint8Array }`；
`fileFingerprint(name: string, size: number, lastModified: number): string`（`${name}:${size}:${lastModified}` 的同步 djb2 hex）。

- [ ] 失败测试：块数（0/1/65536/65537/1e10）；编解码往返一致；指纹同名不同 size 不同
- [ ] 实现并过测试；提交 `feat: 分块编解码`

### Task 4: 进度位图 bitmap.ts（TDD）

**Produces:** `class ChunkBitmap`
`constructor(count: number)`；`set(i)`；`has(i): boolean`；`receivedCount(): number`；`complete(): boolean`；`missing(): number[]`（升序）；`toBase64(): string`；`static fromBase64(s: string, count: number): ChunkBitmap`。

- [ ] 失败测试：新位图全缺；set 后 receivedCount/missing/complete；base64 往返（含 1000 块随机）
- [ ] 实现并过测试；提交 `feat: 进度位图`

### Task 5: 背压 backpressure.ts（TDD）

**Produces:** `HIGH_WATER = 16*1024*1024`，`LOW_WATER = 4*1024*1024`；
`class Backpressure { private blocked = false; update(bufferedAmount: number): boolean /* 当前是否应暂停发送 */ }`
逻辑：未阻塞且 ≥HIGH → 阻塞；阻塞且 ≤LOW → 解除；其余保持。
`waitForDrain(dc: { bufferedAmount: number; addEventListener: Function }): Promise<void>` 用 25ms 轮询 bufferedAmount ≤LOW 后 resolve。

- [ ] 失败测试：状态机迁移序列（0→false，16MB→true，8MB→true，4MB→false）
- [ ] 实现并过测试；提交 `feat: 背压控制`

### Task 6: 控制协议 protocol.ts（TDD）

**Produces:** 判别联合 `ControlMessage`：
`{t:'hello', role:'sender'|'receiver', version:1}`
`{t:'offer', files: FileMeta[]}`（FileMeta = {id:number,name:string,path:string,size:number,lastModified:number,fingerprint:string}）
`{t:'resume', fileId:number, bitmap:string}`
`{t:'want', fileId:number}`（接收方请求某文件）
`{t:'progress', fileId:number, bitmap:string}`
`{t:'done', fileId:number}` `{t:'pause', fileId:number}` `{t:'cancel', fileId:number}`
`{t:'error', message:string}`
`encodeMsg(m): string` / `decodeMsg(s): ControlMessage`（JSON + 形状校验，非法抛错）。

- [ ] 失败测试：每种消息往返；非法 JSON 抛错
- [ ] 实现并过测试；提交 `feat: 控制协议`

### Task 7: 撮合 signaling.ts

**Files:** src/net/signaling.ts
**Consumes:** roomCode.ts
**Produces:**
`createRoom(code: string, cb: { onControl(conn: DataConnection): void; onData(conn: DataConnection): void; onError(e: Error): void }): Peer`
（`new Peer('room-'+code, {debug:1})`，监听 connection，按 `conn.label` 分流到 onControl/onData）
`joinRoom(code: string): Promise<{ peer: Peer; control: DataConnection }>`
（随机 ID Peer，open 后 `peer.connect('room-'+code, {label:'control', reliable:true})`，等待 control open）
`openDataChannel(peer: Peer, code: string, fileId: number): Promise<DataConnection>`（label `file-<id>`）
发送方数据通道由接收方按需发起，发送方在 onData 回调里收到。
无单测（依赖外部服务），由 Task 11 手工联调覆盖。
- [ ] 实现；`npm run build` 通过；提交 `feat: PeerJS 撮合`

### Task 8: 进度存储 receiveStore.ts（TDD，fake-indexeddb）

**Produces:** `class ReceiveStore`
`async load(fingerprint: string): Promise<{bitmap: string; name: string; size: number} | null>`
`async save(fingerprint: string, rec: {bitmap: string; name: string; size: number}): Promise<void>`
`async remove(fingerprint: string): Promise<void>`
`async list(): Promise<Array<{fingerprint: string; name: string; size: number; bitmap: string}>>`
IndexedDB 库名 `p2p-receive`，store `files`，keyPath fingerprint。
- [ ] 测试文件首行 `import 'fake-indexeddb/auto';`；测存取/删除/列表/不存在返回 null
- [ ] 实现并过测试；提交 `feat: 接收进度存储`

### Task 9: 落盘 sink.ts

**Produces:** `interface FileSink { write(offset: number, data: Uint8Array): Promise<void>; finalize(): Promise<void>; abort(): Promise<void> }`
`async function createSink(meta: FileMeta): Promise<{sink: FileSink; mode: 'fs-access'|'opfs'}>`
- fs-access（`window.showSaveFilePicker` 存在时）：用户选位置，`createWritable()`，`write({type:'write', position:offset, data})`，finalize 时 `close()`
- opfs 兜底：`navigator.storage.getDirectory()` 下以 fingerprint 为名建文件，`createSyncAccessHandle` 不可用则用 `createWritable({keepExistingData:true})` 按 offset write；finalize 后触发 `<a download>` 导出
无单测（浏览器 API），Task 11 联调覆盖。
- [ ] 实现；build 通过；提交 `feat: 文件落盘`

### Task 10: 收发会话 sender.ts / receiver.ts

**Consumes:** Tasks 2–9 全部接口
**sender.ts** `class SenderSession`
- `constructor(peer: Peer, code: string)`，内部调 createRoom
- `addFiles(files: Array<{file: File; path: string}>): FileMeta[]`（分配 id、算指纹、入队）
- 收 control：hello→回 offer；want(fileId)→若无 resume 先等 resume；resume(fileId,bitmap)→从缺失块开始发；pause/cancel→停
- 发送循环：`file.slice(index*CHUNK_SIZE, ...).arrayBuffer()` → encodeChunk → conn.send → `bp.update(conn.dataChannel.bufferedAmount)` 为 true 时 `await waitForDrain(...)`
- 事件回调 `onProgress(fileId, sent, total)`、`onState(state)` 暴露给 UI
**receiver.ts** `class ReceiverSession`
- `static async join(code)` → signaling.joinRoom；hello(role receiver)；收 offer 存文件列表
- `accept(fileId)`：查 ReceiveStore 有记录则带位图续传；createSink；openDataChannel；发 want + resume；收块 decodeChunk→sink.write→bitmap.set→节流回 progress；complete→finalize→done→store.remove
- 掉线：PeerJS 断开后 UI 提示「对方掉线」，重新 join 同房间码即续传（位图在 IndexedDB）
- [ ] 实现；build 通过；提交 `feat: 收发会话`

### Task 11: UI + 联调

**Files:** src/ui/home.ts, src/ui/room.ts, src/main.ts, src/style.css
- 首页：创建/加入两个按钮，加入输入框自动 normalizeRoomCode
- 发送方房间页：房间码 + 复制按钮 + qrcode 生成二维码 canvas；`<input type="file" multiple>` 与 `webkitdirectory` 两个入口 + 拖拽区；队列表格（名称/大小/进度条/速度/暂停/继续）
- 接收方房间页：文件列表，逐项「接收/继续接收」，进度条；连接状态横幅
- [ ] `npm run build` 通过
- [ ] `npm run dev -- --port 7100` 起本地服务，两个浏览器窗口走完「创建→加入→传小文件→中途刷新接收方→续传成功」
- [ ] 提交 `feat: 界面`

### Task 12: 收尾

- [ ] `npm test` 全绿、`npm run build` 通过
- [ ] README：零成本部署步骤（Cloudflare Pages 托管 dist；PeerJS 公共云默认配置；自托管升级路径；已知限制）
- [ ] 提交 `docs: 部署文档`
