import http from 'http';
import crypto from 'crypto';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { google } from 'googleapis';

const DEFAULT_PORT = Number(process.env.GOOGLE_DRIVE_OAUTH_PORT || 8765);
const SCOPES = ['https://www.googleapis.com/auth/drive'];

function askHiddenFallback(prompt) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input, output });
    rl.question(prompt).then(answer => {
      rl.close();
      resolve(String(answer || '').trim());
    });
  });
}

async function promptForValue(label, envName) {
  const preset = String(process.env[envName] || '').trim();
  if (preset) return preset;
  return askHiddenFallback(`${label}: `);
}

function buildOAuthClient(clientId, clientSecret, redirectUri) {
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function waitForAuthCode(port, expectedState) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close(() => reject(new Error('Timed out waiting for Google OAuth callback.')));
    }, 5 * 60 * 1000);

    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
        if (url.pathname !== '/oauth2callback') {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }

        const state = url.searchParams.get('state');
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (state !== expectedState) {
          res.statusCode = 400;
          res.end('State mismatch. You can close this window.');
          return;
        }

        if (error) {
          res.statusCode = 400;
          res.end(`Google returned an error: ${error}. You can close this window.`);
          clearTimeout(timeout);
          server.close(() => reject(new Error(`Google OAuth error: ${error}`)));
          return;
        }

        if (!code) {
          res.statusCode = 400;
          res.end('Missing authorization code. You can close this window.');
          return;
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(`
          <html>
            <body style="font-family:Arial,sans-serif;padding:24px;">
              <h2>Google Drive OAuth completed</h2>
              <p>You can return to the terminal now.</p>
            </body>
          </html>
        `);
        clearTimeout(timeout);
        server.close(() => resolve(code));
      } catch (error) {
        clearTimeout(timeout);
        server.close(() => reject(error));
      }
    });

    server.listen(port, '127.0.0.1', () => {
      console.log(`Waiting for Google callback on http://127.0.0.1:${port}/oauth2callback ...`);
    });
  });
}

async function main() {
  const clientId = await promptForValue('Google Drive OAuth Client ID', 'GOOGLE_DRIVE_CLIENT_ID');
  const clientSecret = await promptForValue('Google Drive OAuth Client Secret', 'GOOGLE_DRIVE_CLIENT_SECRET');

  if (!clientId || !clientSecret) {
    throw new Error('Client ID and Client Secret are required.');
  }

  const redirectUri = `http://127.0.0.1:${DEFAULT_PORT}/oauth2callback`;
  const state = crypto.randomBytes(24).toString('hex');
  const oauth2Client = buildOAuthClient(clientId, clientSecret, redirectUri);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: true,
    scope: SCOPES,
    state
  });

  console.log('\n1. Open this URL in your browser:');
  console.log(authUrl);
  console.log('\n2. Sign in with the same Google account that owns your target Drive folder.');
  console.log('3. Accept the Drive permission screen.');
  console.log('4. After the browser jumps back to localhost, return here.\n');

  const code = await waitForAuthCode(DEFAULT_PORT, state);
  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.refresh_token) {
    console.error('\nNo refresh token was returned.');
    console.error('If you already authorized this app before, revoke that app in your Google Account permissions and run this command again.');
    process.exitCode = 2;
    return;
  }

  console.log('\nOAuth success. Put these values into Render:\n');
  console.log(`GOOGLE_DRIVE_CLIENT_ID=${clientId}`);
  console.log(`GOOGLE_DRIVE_CLIENT_SECRET=${clientSecret}`);
  console.log(`GOOGLE_DRIVE_REFRESH_TOKEN=${tokens.refresh_token}`);
  console.log('\nRecommended cleanup in Render: remove GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON after switching to OAuth mode.');
}

main().catch(error => {
  console.error('\nGoogle Drive OAuth setup failed:');
  console.error(error?.message || error);
  process.exitCode = 1;
});
