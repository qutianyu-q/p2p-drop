import Peer, { type DataConnection } from 'peerjs';

/** PeerJS 公共云撮合：免费、无需自建后端。房间码即发送方 Peer ID。 */
export interface RoomCallbacks {
  onOpen(): void;
  onControl(conn: DataConnection): void;
  onData(conn: DataConnection): void;
  onError(error: Error): void;
}

export function peerIdForRoom(code: string): string {
  return `room-${code}`;
}

export function createRoom(code: string, cb: RoomCallbacks): Peer {
  const peer = new Peer(peerIdForRoom(code), { debug: 1 });
  peer.on('open', () => cb.onOpen());
  peer.on('connection', (conn) => {
    if (conn.label === 'control') cb.onControl(conn);
    else cb.onData(conn);
  });
  peer.on('error', (e) => cb.onError(e));
  peer.on('disconnected', () => {
    // 与撮合云断开不影响已建立的 P2P 连接，尝试重连以便后续新配对
    if (!peer.destroyed) peer.reconnect();
  });
  return peer;
}

export function joinRoom(code: string): Promise<{ peer: Peer; control: DataConnection }> {
  return new Promise((resolve, reject) => {
    const peer = new Peer({ debug: 1 });
    const timeout = setTimeout(() => {
      peer.destroy();
      reject(new Error('连接超时：房间不存在或对方不在线'));
    }, 20000);

    peer.on('error', (e) => {
      clearTimeout(timeout);
      peer.destroy();
      reject(e instanceof Error ? e : new Error(String(e)));
    });
    peer.on('open', () => {
      const control = peer.connect(peerIdForRoom(code), { label: 'control', reliable: true });
      control.on('open', () => {
        clearTimeout(timeout);
        resolve({ peer, control });
      });
    });
  });
}

/** 接收方为某个文件主动发起一条数据通道，label 为 file-<id> */
export function openDataChannel(peer: Peer, code: string, fileId: number): Promise<DataConnection> {
  return new Promise((resolve, reject) => {
    const conn = peer.connect(peerIdForRoom(code), { label: `file-${fileId}` });
    const timeout = setTimeout(() => reject(new Error('数据通道建立超时')), 20000);
    conn.on('open', () => {
      clearTimeout(timeout);
      resolve(conn);
    });
    conn.on('error', (e) => {
      clearTimeout(timeout);
      reject(e);
    });
  });
}
