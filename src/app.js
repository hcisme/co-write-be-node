const http = require('http');
const WebSocket = require('ws');
const { internalRequest, handleConnection, docs } = require('./utils');
const { internalSecret, port } = require('./config');

const server = http.createServer(async (req, res) => {
  if (req.headers['internal-secret'] !== internalSecret) {
    res.writeHead(403);
    res.end();
    return;
  }

  if (req.url === '/internal/sync-permission' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const { docId, userId, role, action } = JSON.parse(body);

      const doc = docs.get(docId);
      if (doc) {
        doc.conns.forEach((_, conn) => {
          if (conn.userId === userId) {
            if (action === 'DELETE') {
              // 踢出用户
              conn.send(JSON.stringify({ type: 'AUTH_REVOKED' }));
              conn.close(1000);
            } else {
              // 更新权限
              conn.role = role;
              conn.send(JSON.stringify({ type: 'ROLE_UPDATED', role: role }));
            }
          }
        });
      }
      res.writeHead(200);
      res.end('ok');
    });
  }
});
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
      handleConnection(conn, req, docId, token, role, userId);
    } else {
      console.warn('鉴权失败');
      conn.close(1008, 'Unauthorized');
    }
  } catch (err) {
    console.error('连接到 Kotlin 鉴权接口失败:', err.message);
    conn.close(1011, 'Internal Server Error');
  }
});

server.listen(port, () => console.log(`Node.js Server at ${port}`));
