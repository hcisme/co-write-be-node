const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const { internalRequest, handleConnection } = require('./utils');

const server = http.createServer();
const wss = new WebSocket.Server({ server });

wss.on('connection', async (conn, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const docId = url.pathname.slice(1);
  const userId = url.searchParams.get('userId');
  const token = url.searchParams.get('token');

  try {
    const authRes = await internalRequest.post(
      '/doc/check-permission',
      { docId, userId },
      { headers: { token } }
    );

    if (authRes.data.code === 200) {
      const role = authRes.data.data.role;
      console.log(`用户已授权进入文档: ${docId}`);
      handleConnection(conn, req, docId, token, role);
    } else {
      console.warn('鉴权失败');
      conn.close(1008, 'Unauthorized');
    }
  } catch (err) {
    console.error('连接到 Kotlin 鉴权接口失败:', err.message);
    conn.close(1011, 'Internal Server Error');
  }
});

server.listen(3000, () => console.log('Node.js Server at 3000'));
