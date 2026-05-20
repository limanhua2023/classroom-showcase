import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const KDF_ITERATIONS = 210000;

dotenv.config({ path: path.join(projectRoot, '.env') });
dotenv.config({ path: path.join(projectRoot, '.env.secrets-backup'), override: true });
dotenv.config({ path: path.join(projectRoot, '.env.secrets-backup.local'), override: true });

function printHelp() {
  console.log(`
ClassShow Secrets Backup Restore

Usage:
  node scripts/restore-secrets-backup.mjs --input "<bundle>" --output ".\\\\recovered_secrets" --passphrase "<secret>"

Options:
  --input <path>         Path to the encrypted bundle JSON.
  --output <path>        Folder where the restored files will be written.
  --passphrase <value>   Passphrase used during bundle creation.
  --help                 Show this message.
`);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--input':
        parsed.input = argv[++index];
        break;
      case '--output':
        parsed.output = argv[++index];
        break;
      case '--passphrase':
        parsed.passphrase = argv[++index];
        break;
      case '--help':
      case '-h':
        parsed.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function decryptBundle(bundle, passphrase) {
  const salt = Buffer.from(String(bundle.kdf?.salt_b64 || ''), 'base64');
  const iv = Buffer.from(String(bundle.iv_b64 || ''), 'base64');
  const authTag = Buffer.from(String(bundle.auth_tag_b64 || ''), 'base64');
  const ciphertext = Buffer.from(String(bundle.ciphertext_b64 || ''), 'base64');
  const key = crypto.pbkdf2Sync(passphrase, salt, Number(bundle.kdf?.iterations || KDF_ITERATIONS), 32, 'sha256');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const payload = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const digest = sha256Buffer(payload);
  if (digest !== String(bundle.payload_sha256 || '').trim()) {
    throw new Error('Decrypted payload checksum mismatch. Verify the passphrase and bundle integrity.');
  }
  return JSON.parse(payload.toString('utf8'));
}

function restorePayload(outputDir, payload) {
  const sourceFiles = Array.isArray(payload.source_files) ? payload.source_files : [];
  for (const file of sourceFiles) {
    const relativePath = String(file.relative_path || '').replace(/^\/+/, '');
    if (!relativePath) continue;
    const targetPath = path.join(outputDir, relativePath);
    ensureDir(path.dirname(targetPath));
    const content = Buffer.from(String(file.content_base64 || ''), 'base64').toString('utf8');
    fs.writeFileSync(targetPath, content, 'utf8');
  }
  return sourceFiles.length;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const inputPath = path.resolve(args.input || '');
  const outputDir = path.resolve(args.output || path.join(projectRoot, 'recovered_secrets'));
  const passphrase = String(args.passphrase || process.env.SECRETS_BACKUP_PASSPHRASE || '').trim();

  if (!inputPath || !fs.existsSync(inputPath)) {
    throw new Error('Encrypted bundle not found. Provide --input with a valid bundle JSON path.');
  }
  if (!passphrase) {
    throw new Error('Passphrase is required. Provide --passphrase or set SECRETS_BACKUP_PASSPHRASE.');
  }

  const bundle = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const payload = decryptBundle(bundle, passphrase);
  ensureDir(outputDir);
  const restoredCount = restorePayload(outputDir, payload);
  console.log(`[secrets-restore] restored=${restoredCount} output=${outputDir}`);
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
