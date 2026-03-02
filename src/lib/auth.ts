import http from 'node:http';
import { getApiUrl } from './config.js';

export async function startOAuthFlow(): Promise<string> {
  const port = await findAvailablePort(9000, 9100);
  const returnUrl = `http://localhost:${port}/callback`;
  const apiUrl = getApiUrl();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error('Login timed out after 5 minutes. Try again or use --token.'));
    }, 5 * 60 * 1000);

    const server = http.createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost:${port}`);

      if (url.pathname === '/callback') {
        const accessToken = url.searchParams.get('access_token');
        const successParam = url.searchParams.get('success');

        if (successParam === 'true' && accessToken) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html><body style="font-family: system-ui; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
              <div style="text-align: center;">
                <h1 style="color: #22c55e;">&#10003; Authenticated</h1>
                <p>You can close this window and return to the terminal.</p>
              </div>
            </body></html>
          `);
          clearTimeout(timeout);
          server.close();
          resolve(accessToken);
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html><body style="font-family: system-ui; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
              <div style="text-align: center;">
                <h1 style="color: #ef4444;">&#10007; Authentication Failed</h1>
                <p>Please try again.</p>
              </div>
            </body></html>
          `);
          clearTimeout(timeout);
          server.close();
          reject(new Error('Authentication was denied or failed.'));
        }
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    server.listen(port, () => {
      const authorizeUrl = `${apiUrl}/authorize?source=cli&return_url=${encodeURIComponent(returnUrl)}`;
      import('open').then((mod) => mod.default(authorizeUrl)).catch(() => {
        console.log(`Open this URL in your browser:\n  ${authorizeUrl}`);
      });
    });
  });
}

function findAvailablePort(start: number, end: number): Promise<number> {
  return new Promise((resolve, reject) => {
    function tryPort(port: number) {
      if (port > end) {
        reject(new Error(`No available port found in range ${start}-${end}`));
        return;
      }
      const server = http.createServer();
      server.listen(port, () => {
        server.close(() => resolve(port));
      });
      server.on('error', () => tryPort(port + 1));
    }
    tryPort(start);
  });
}
