import http from 'node:http';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';

const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
const jwk = await exportJWK(publicKey);
jwk.kid = 'test-key-1';
jwk.alg = 'RS256';
jwk.use = 'sig';

const server = http.createServer((req, res) => {
  if (req.url === '/.well-known/jwks.json') {
    res.writeHead(200, {'content-type':'application/json'});
    res.end(JSON.stringify({ keys: [jwk] }));
  } else { res.writeHead(404); res.end(); }
});
async function printTokens() {
  const adminToken = await new SignJWT({ role: 'admin' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1', typ: 'JWT' })
    .setIssuer('http://127.0.0.1:8899')
    .setSubject('admin_user_1')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey);
  console.log('ADMIN_TOKEN=' + adminToken);
  const token = await new SignJWT({ channels: ['public:clerk', 'private:clerk-only'], app_id: 'app_cc438da998b947209422ab25' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1', typ: 'JWT' })
    .setIssuer('http://127.0.0.1:8899')
    .setSubject('clerk_user_123')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
  console.log('TOKEN=' + token);
}
server.listen(8899, () => { void printTokens(); });
