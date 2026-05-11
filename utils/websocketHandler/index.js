const Y = require('yjs');
const sync = require('y-protocols/dist/sync.cjs');
const awareness = require('y-protocols/dist/awareness.cjs');
const encoding = require('lib0/dist/encoding.cjs');
const decoding = require('lib0/dist/decoding.cjs');
const { internalRequest } = require('../internalRequest');

const docs = new Map();

// 将保存逻辑抽离，方便手动调用和定时调用
async function saveToKotlin(docId, doc) {
  try {
    const stateUpdate = Y.encodeStateAsUpdate(doc);
    const base64State = Buffer.from(stateUpdate).toString('base64');

    // TipTap 默认共享类型为 'default' (XmlFragment)
    const content = doc.getXmlFragment('default').toString();

    await internalRequest.post('/doc/saveSnapshot', {
      docId,
      content: content,
      binaryState: base64State,
      creatorId: 'SYSTEM_SYNC'
    });
    console.log(`[Snapshot] ${docId} saved.`);
    doc.isDirty = false;
  } catch (err) {
    console.error(`[Snapshot] ${docId} save failed:`, err.message);
  }
}

const handleConnection = async (conn, req, docId, token, role) => {
  conn.binaryType = 'arraybuffer';

  let doc = docs.get(docId);
  if (!doc) {
    doc = new Y.Doc();
    doc.conns = new Map();
    doc.isDirty = false;
    doc.awareness = new awareness.Awareness(doc);

    // 加载初始数据
    try {
      const res = await internalRequest.get(`/doc/getLastSnapshot`, {
        params: { docId },
        headers: { token }
      });
      if (res?.data?.data?.binaryState) {
        const buffer = Buffer.from(res.data.data.binaryState, 'base64');
        Y.applyUpdate(doc, new Uint8Array(buffer));
      }
    } catch (err) {
      console.error(`Initial load failed for ${docId}:`, err.message);
    }
    docs.set(docId, doc);
  }

  doc.conns.set(conn, new Set());

  // 消息处理逻辑保持不变...
  conn.on('message', (message) => {
    const decoder = decoding.createDecoder(new Uint8Array(message));
    const messageType = decoding.readVarUint(decoder);

    switch (messageType) {
      case 0:
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, 0);

        if (role === 2) {
          sync.readSyncMessage(decoder, encoder, doc, {
            // 伪造一个不具备写入权限的 context
            readonly: true
          });
        } else {
          sync.readSyncMessage(decoder, encoder, doc, conn);
        }

        if (encoding.length(encoder) > 1) {
          conn.send(encoding.toUint8Array(encoder));
        }
        break;
      case 1: // awareness
        awareness.applyAwarenessUpdate(doc.awareness, decoding.readVarUint8Array(decoder), conn);
        break;
    }
  });

  const updateHandler = (update, origin) => {
    doc.isDirty = true; // 标记需要保存
    if (origin !== conn) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 0);
      sync.writeUpdate(encoder, update);
      conn.send(encoding.toUint8Array(encoder));
    }
  };
  doc.on('update', updateHandler);

  // Awareness 广播保持不变...
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

  conn.on('close', () => {
    doc.off('update', updateHandler);
    doc.awareness.off('update', awarenessHandler);
    doc.conns.delete(conn);
    if (doc.conns.size === 0) {
      setTimeout(() => {
        if (doc.conns.size === 0 && docs.has(docId)) {
          saveToKotlin(docId, doc).then(() => docs.delete(docId));
        }
      }, 10000);
    }
  });

  // Sync Step 1
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 0);
  sync.writeSyncStep1(encoder, doc);
  conn.send(encoding.toUint8Array(encoder));
};

// 定时任务只处理脏数据
setInterval(
  async () => {
    for (const [docId, doc] of docs.entries()) {
      if (doc.isDirty && doc.conns.size > 0) {
        await saveToKotlin(docId, doc);
      }
    }
  },
  1000 * 60 * 1
);

module.exports = { handleConnection };
