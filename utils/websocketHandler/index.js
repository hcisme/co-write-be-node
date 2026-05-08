const Y = require('yjs');
const sync = require('y-protocols/dist/sync.cjs');
const awareness = require('y-protocols/dist/awareness.cjs');
const encoding = require('lib0/dist/encoding.cjs');
const decoding = require('lib0/dist/decoding.cjs');
const { internalRequest } = require('../internalRequest');

// 内存中的文档集合
const docs = new Map();

/**
 * 处理新的 WebSocket 连接
 */
const handleConnection = async (conn, req, docId, token) => {
  conn.binaryType = 'arraybuffer';

  // 1. 获取或创建 Y.Doc
  let doc = docs.get(docId);
  if (!doc) {
    doc = new Y.Doc();
    // 可以在这里扩展 doc 对象，记录连接数
    doc.conns = new Map();
    doc.awareness = new awareness.Awareness(doc);

    try {
      const res = await internalRequest.get(`/doc/getLastSnapshot`, {
        params: { docId },
        headers: { token }
      });
      if (res?.data?.data?.binaryState) {
        // 将 Base64 恢复为 Uint8Array 并载入 Y.Doc
        const buffer = Buffer.from(res.data.data.binaryState, 'base64');
        const uint8Array = new Uint8Array(buffer);
        Y.applyUpdate(doc, uint8Array);
        console.log(`文档 ${docId} 数据加载成功`);
      }
    } catch (err) {
      console.error(`加载文档 ${docId} 初始数据失败:`, err.message);
    }

    docs.set(docId, doc);
  }

  // 2. 将当前连接加入文档的连接池
  doc.conns.set(conn, new Set());

  // 3. 监听客户端发来的消息
  conn.on('message', (message) => {
    const decoder = decoding.createDecoder(new Uint8Array(message));
    const messageType = decoding.readVarUint(decoder);
    const encoder = encoding.createEncoder();

    switch (messageType) {
      case 0: // messageSync: 核心数据同步
        encoding.writeVarUint(encoder, 0);
        sync.readSyncMessage(decoder, encoder, doc, conn);
        if (encoding.length(encoder) > 1) {
          conn.send(encoding.toUint8Array(encoder));
        }
        break;
      case 1: // messageAwareness: 光标/状态同步
        awareness.applyAwarenessUpdate(doc.awareness, decoding.readVarUint8Array(decoder), conn);
        break;
    }
  });

  // 4. 监听文档更新并广播给其他用户
  const updateHandler = (update, origin) => {
    if (origin !== conn) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 0);
      sync.writeUpdate(encoder, update);
      conn.send(encoding.toUint8Array(encoder));
    }
  };
  doc.on('update', updateHandler);

  // 5. 监听光标更新并广播
  const awarenessHandler = ({ added, updated, removed }, origin) => {
    const changedClients = added.concat(updated).concat(removed);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 1);
    encoding.writeVarUint8Array(
      encoder,
      awareness.encodeAwarenessUpdate(doc.awareness, changedClients)
    );
    conn.send(encoding.toUint8Array(encoder));
  };
  doc.awareness.on('update', awarenessHandler);

  // 6. 连接断开时的清理
  conn.on('close', () => {
    doc.off('update', updateHandler);
    doc.awareness.off('update', awarenessHandler);
    doc.conns.delete(conn);
    if (doc.conns.size === 0) {
      // 可以在这里执行“延迟销毁”或“保存到 Kotlin”
      // docs.delete(docName);
    }
  });

  // 7. 握手第一步：发送 Sync Step 1
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 0);
  sync.writeSyncStep1(encoder, doc);
  conn.send(encoding.toUint8Array(encoder));
};

setInterval(
  async () => {
    for (const [docId, doc] of docs.entries()) {
      // 如果没人在线，可以不保存或者降低频率
      if (doc.conns.size === 0) continue;

      // 1. 序列化为二进制
      const stateUpdate = Y.encodeStateAsUpdate(doc);
      const base64State = Buffer.from(stateUpdate).toString('base64');

      // 2. 序列化为 JSON 字符串 (方便 Kotlin 存储 content 字段)
      const ytext = doc.getText('quill').toString();

      // 3. 发送给 Kotlin 接口
      try {
        await internalRequest.post('/doc/saveSnapshot', {
          docId,
          content: ytext,
          binaryState: base64State,
          creatorId: 'SYSTEM_SYNC'
        });
        console.log(`文档 ${docId} 快照自动保存成功`);
      } catch (err) {
        console.error(`保存文档 ${docId} 失败:`, err.message);
      }
    }
  },
  1000 * 60 * 1
);

module.exports = { handleConnection };
