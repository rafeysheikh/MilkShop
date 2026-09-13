/**
 * generate-license.js — PRIVATE DEVELOPER TOOL
 * ================================================
 * Use this script to generate license keys for your clients.
 * NEVER include this file in the client installer.
 *
 * Usage:
 *   node tools/generate-license.js --machine XXXX-XXXX-XXXX-XXXX --client "Client Name"
 *   node tools/generate-license.js --machine XXXX-XXXX-XXXX-XXXX --client "Ali Dairy" --expiry 2027-12-31
 *
 * The Machine ID is shown in the app's activation screen on the client's laptop.
 * Copy it, run this command, and send the generated key to the client.
 */

import crypto from 'crypto';

// ─── MUST MATCH electron/license.cjs ─────────────────────────────────────────
const SECRET_KEY = 'DoodhKhata@MilkShop#2024$LicenseKey!Private';
const APP_ID = 'milkshop-doodh-khata-v1';
const ALGORITHM = 'aes-256-cbc';
// ─────────────────────────────────────────────────────────────────────────────

function getKey() {
  return crypto.createHash('sha256').update(SECRET_KEY).digest();
}

function encryptPayload(data) {
  const key = getKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(data), 'utf8'),
    cipher.final(),
  ]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function generateLicenseKey({ machineId, clientName, expiryDate }) {
  const payload = {
    appId: APP_ID,
    machineId: machineId.trim().toUpperCase(),
    clientName: clientName.trim(),
    expiryDate,
    issuedAt: new Date().toISOString(),
  };

  const encrypted = encryptPayload(payload);
  const b64 = Buffer.from(encrypted, 'utf8').toString('base64');

  // Remove non-alphanumeric chars and chunk into groups of 5 for readability
  const clean = b64.replace(/[^A-Za-z0-9]/g, '');
  const chunks = clean.match(/.{1,5}/g) || [];
  return chunks.join('-');
}

// ─── CLI Entry Point ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const params = {};
for (let i = 0; i < args.length - 1; i++) {
  if (args[i].startsWith('--')) {
    params[args[i].replace('--', '')] = args[i + 1];
  }
}

if (!params.machine || !params.client) {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║         MilkShop — License Key Generator                ║
║         *** PRIVATE DEVELOPER TOOL ***                  ║
╚══════════════════════════════════════════════════════════╝

Usage:
  node tools/generate-license.js --machine XXXX-XXXX-XXXX-XXXX --client "Client Name"
  node tools/generate-license.js --machine XXXX-XXXX-XXXX-XXXX --client "Ali Dairy Farm" --expiry 2027-12-31

Arguments:
  --machine   Machine ID shown in the app's Activation screen (required)
  --client    Client's business name (required)
  --expiry    Expiry date YYYY-MM-DD (optional, default: 1 year from today)

Example:
  node tools/generate-license.js --machine A3F9-B21C-77D4-E508 --client "Muhammad Ali Dairy"
`);
  process.exit(1);
}

// Default: 1 year from today
const defaultExpiry = new Date();
defaultExpiry.setFullYear(defaultExpiry.getFullYear() + 1);
const expiryDate = params.expiry || defaultExpiry.toISOString().split('T')[0];

// Validate date format
if (!/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) {
  console.error('❌ Invalid --expiry format. Use YYYY-MM-DD (e.g., 2027-09-09)');
  process.exit(1);
}

const machineId = params.machine.trim().toUpperCase();
const clientName = params.client;

const key = generateLicenseKey({ machineId, clientName, expiryDate });

console.log(`
╔══════════════════════════════════════════════════════════╗
║              Generated License Key                      ║
╚══════════════════════════════════════════════════════════╝

  Client  : ${clientName}
  Machine : ${machineId}
  Expires : ${expiryDate}
  Issued  : ${new Date().toLocaleDateString('en-PK')}

  License Key:
  ${key}

  → Copy the key above and send it to your client.
`);
