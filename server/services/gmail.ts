// Gmail integration. Production uses explicit env vars only:
// - GMAIL_USER + GMAIL_APP_PASSWORD for SMTP, or
// - GMAIL_CLIENT_ID + GMAIL_CLIENT_SECRET + GMAIL_REFRESH_TOKEN for OAuth.
import { google } from 'googleapis';
import net from 'net';
import tls from 'tls';
import { deliverWithGmailFallback, type GmailApiOutcome } from './gmailDelivery';

function getEnvGmailSmtpCredentials() {
  const user = process.env.GMAIL_USER || process.env.COMPANY_EMAIL || process.env.FROM_EMAIL;
  const appPassword = process.env.GMAIL_APP_PASSWORD || process.env.GOOGLE_APP_PASSWORD;

  if (!user || !appPassword) {
    return null;
  }

  return { user: normalizeEmailAddress(user), appPassword: appPassword.trim().replace(/^["']|["']$/g, '').replace(/\s/g, '') };
}

function getEnvGmailCredentials() {
  const clientId = process.env.GMAIL_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN || process.env.GOOGLE_REFRESH_TOKEN;
  const user = process.env.GMAIL_USER || process.env.COMPANY_EMAIL || process.env.FROM_EMAIL;

  if (!clientId || !clientSecret || !refreshToken) {
    return null;
  }

  return { clientId, clientSecret, refreshToken, user };
}

function describeClientId(clientId?: string) {
  if (!clientId) return 'missing';
  return `${clientId.slice(0, 8)}...${clientId.slice(-18)}`;
}

function getEnvGmailClient() {
  const credentials = getEnvGmailCredentials();
  if (!credentials) return null;

  const oauth2Client = new google.auth.OAuth2(credentials.clientId, credentials.clientSecret);
  oauth2Client.setCredentials({
    refresh_token: credentials.refreshToken,
  });

  return google.gmail({ version: 'v1', auth: oauth2Client });
}

async function getAccessToken() {
  const envCredentials = getEnvGmailCredentials();
  if (envCredentials) {
    const oauth2Client = new google.auth.OAuth2(envCredentials.clientId, envCredentials.clientSecret);
    oauth2Client.setCredentials({ refresh_token: envCredentials.refreshToken });
    const accessToken = await oauth2Client.getAccessToken();
    if (accessToken.token) return accessToken.token;
    throw new Error('Gmail OAuth refresh token did not return an access token');
  }

  throw new Error('Gmail OAuth env vars are not configured');
}

async function getUncachableGmailClient() {
  const envClient = getEnvGmailClient();
  if (envClient) return envClient;

  const accessToken = await getAccessToken();

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({
    access_token: accessToken
  });

  return google.gmail({ version: 'v1', auth: oauth2Client });
}

function encodeSubject(subject: string): string {
  return `=?UTF-8?B?${Buffer.from(subject, 'utf-8').toString('base64')}?=`;
}

function normalizeEmailAddress(value: string): string {
  const trimmed = String(value || '').trim();
  const angleMatch = trimmed.match(/<([^<>@\s]+@[^<>\s]+)>/);
  if (angleMatch) return angleMatch[1].trim();

  return trimmed.replace(/^["']+|["']+$/g, '').trim();
}

function buildRawEmail(to: string, from: string, subject: string, html?: string, text?: string, replyTo?: string): string {
  const boundary = 'boundary_' + Date.now();
  const normalizedTo = normalizeEmailAddress(to);
  const normalizedFrom = normalizeEmailAddress(from);
  const lines = [
    `From: JC ON THE MOVE <${normalizedFrom}>`,
    `To: ${normalizedTo}`,
    ...(replyTo ? [`Reply-To: ${normalizeEmailAddress(replyTo)}`] : []),
    `Subject: ${encodeSubject(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    text || (html ? html.replace(/<[^>]*>/g, '') : ''),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    '',
    html || text || '',
    `--${boundary}--`,
  ];

  const rawMessage = lines.join('\r\n');
  return Buffer.from(rawMessage).toString('base64url');
}

function buildSmtpEmail(to: string, from: string, subject: string, html?: string, text?: string, replyTo?: string): string {
  const boundary = 'boundary_' + Date.now();
  const normalizedTo = normalizeEmailAddress(to);
  const normalizedFrom = normalizeEmailAddress(from);
  const lines = [
    `From: JC ON THE MOVE <${normalizedFrom}>`,
    `To: ${normalizedTo}`,
    ...(replyTo ? [`Reply-To: ${normalizeEmailAddress(replyTo)}`] : []),
    `Subject: ${encodeSubject(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    text || (html ? html.replace(/<[^>]*>/g, '') : ''),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    '',
    html || text || '',
    `--${boundary}--`,
    '',
  ];

  return lines.join('\r\n');
}

function escapeSmtpData(message: string): string {
  return message
    .split(/\r?\n/)
    .map((line) => line.startsWith('.') ? `.${line}` : line)
    .join('\r\n');
}

type SmtpSocket = net.Socket | tls.TLSSocket;

async function sendSmtpCommand(socket: SmtpSocket, command: string | null, expectedCodes: number[]): Promise<string> {
  if (command !== null) {
    socket.write(command + '\r\n');
  }

  return await new Promise((resolve, reject) => {
    let buffer = '';
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`SMTP timeout waiting for ${expectedCodes.join('/')}`));
    }, 20_000);

    const cleanup = () => {
      clearTimeout(timeout);
      socket.off('data', onData);
      socket.off('error', onError);
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1];
      if (!last || !/^\d{3} /.test(last)) return;

      const code = Number(last.slice(0, 3));
      cleanup();
      if (expectedCodes.includes(code)) {
        resolve(buffer);
      } else {
        reject(new Error(`SMTP command failed. Expected ${expectedCodes.join('/')} but got: ${buffer.trim()}`));
      }
    };

    socket.on('data', onData);
    socket.on('error', onError);
  });
}

async function connectSmtpSocket(host: string, port: number): Promise<SmtpSocket> {
  if (port === 587) {
    const plainSocket = net.connect({ host, port });
    await sendSmtpCommand(plainSocket, null, [220]);
    await sendSmtpCommand(plainSocket, 'EHLO jconthemove.com', [250]);
    await sendSmtpCommand(plainSocket, 'STARTTLS', [220]);

    const secureSocket = tls.connect({
      socket: plainSocket,
      servername: host,
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('SMTP STARTTLS handshake timeout')), 20_000);
      secureSocket.once('secureConnect', () => {
        clearTimeout(timeout);
        resolve();
      });
      secureSocket.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    await sendSmtpCommand(secureSocket, 'EHLO jconthemove.com', [250]);
    return secureSocket;
  }

  const secureSocket = tls.connect({
    host,
    port,
    servername: host,
  });
  await sendSmtpCommand(secureSocket, null, [220]);
  await sendSmtpCommand(secureSocket, 'EHLO jconthemove.com', [250]);
  return secureSocket;
}

async function sendGmailSmtpEmail(params: {
  to: string;
  from: string;
  replyTo?: string;
  subject: string;
  text?: string;
  html?: string;
}): Promise<boolean> {
  const credentials = getEnvGmailSmtpCredentials();
  if (!credentials) return false;

  const host = process.env.GMAIL_SMTP_HOST || 'smtp.gmail.com';
  const port = Number(process.env.GMAIL_SMTP_PORT || 465);
  let socket: SmtpSocket | null = null;

  try {
    socket = await connectSmtpSocket(host, port);
    const to = normalizeEmailAddress(params.to);
    const from = normalizeEmailAddress(credentials.user);
    await sendSmtpCommand(socket, 'AUTH LOGIN', [334]);
    await sendSmtpCommand(socket, Buffer.from(credentials.user).toString('base64'), [334]);
    await sendSmtpCommand(socket, Buffer.from(credentials.appPassword).toString('base64'), [235]);
    await sendSmtpCommand(socket, `MAIL FROM:<${from}>`, [250]);
    await sendSmtpCommand(socket, `RCPT TO:<${to}>`, [250, 251]);
    await sendSmtpCommand(socket, 'DATA', [354]);

    const raw = buildSmtpEmail(
      to,
      from,
      params.subject,
      params.html,
      params.text,
      params.replyTo,
    );
    await sendSmtpCommand(socket, `${escapeSmtpData(raw)}\r\n.`, [250]);
    await sendSmtpCommand(socket, 'QUIT', [221]);

    console.log(`Gmail SMTP: Email accepted from=${from} to=${to} subject="${params.subject}"`);
    return true;
  } catch (error: any) {
    console.error('Gmail SMTP send error:', error?.message || error);
    return false;
  } finally {
    socket?.destroy();
  }
}

async function sendGmailApiEmail(params: {
  to: string;
  from: string;
  replyTo?: string;
  subject: string;
  text?: string;
  html?: string;
}): Promise<GmailApiOutcome> {
  try {
    const gmail = await getUncachableGmailClient();
    const envCredentials = getEnvGmailCredentials();
    const configuredFrom = envCredentials?.user || params.from;
    const from = normalizeEmailAddress(configuredFrom);
    const to = normalizeEmailAddress(params.to);
    const raw = buildRawEmail(to, from, params.subject, params.html, params.text, params.replyTo);

    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });

    console.log(`Gmail API: Email accepted id=${response.data.id || 'unknown'} from=${from} to=${to} subject="${params.subject}"`);
    return "sent";
  } catch (error: any) {
    const envCredentials = getEnvGmailCredentials();
    console.error(
      'Gmail API send error:',
      error?.message || error,
      `client=${describeClientId(envCredentials?.clientId)}`,
      `hasRefreshToken=${Boolean(envCredentials?.refreshToken)}`,
    );
    return error?.response?.data?.error === 'invalid_grant' || error?.message === 'invalid_grant'
      ? "auth-rejected" : "failed";
  }
}

export async function sendGmailEmail(params: {
  to: string;
  from: string;
  replyTo?: string;
  subject: string;
  text?: string;
  html?: string;
}): Promise<boolean> {
  if (getEnvGmailCredentials()) {
    return deliverWithGmailFallback({
      hasOAuth: true,
      hasSmtp: Boolean(getEnvGmailSmtpCredentials()),
      api: () => sendGmailApiEmail(params),
      smtp: () => sendGmailSmtpEmail(params),
    });
  }

  const smtpCredentials = getEnvGmailSmtpCredentials();
  if (smtpCredentials) return sendGmailSmtpEmail(params);

  try {
    const gmail = await getUncachableGmailClient();
    const envCredentials = getEnvGmailCredentials();
    const configuredFrom = envCredentials?.user || params.from;
    const from = normalizeEmailAddress(configuredFrom);
    const to = normalizeEmailAddress(params.to);
    const raw = buildRawEmail(to, from, params.subject, params.html, params.text, params.replyTo);
    
    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });
    
    console.log(`Gmail: Email sent to ${to} - "${params.subject}"`);
    console.log(`Gmail: Email accepted by API id=${response.data.id || 'unknown'} from=${from} to=${to} subject="${params.subject}"`);
    return true;
  } catch (error: any) {
    console.error('Gmail send error:', error?.message || error);
    return false;
  }
}

export async function isGmailAvailable(): Promise<boolean> {
  try {
    if (getEnvGmailSmtpCredentials()) return true;
    if (getEnvGmailCredentials()) return true;
    await getAccessToken();
    return true;
  } catch {
    return false;
  }
}
