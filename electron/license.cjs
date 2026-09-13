/**
 * license.cjs — Hardware fingerprinting and license validation
 * 
 * How it works:
 *  1. getMachineFingerprint() reads MAC + CPU + hostname → SHA-256 → 16-char ID
 *  2. generateLicenseKey() (in tools/generate-license.js) encrypts {machineId, clientName, expiryDate}
 *     with AES-256-CBC using the SECRET below
 *  3. validateLicenseKey() decrypts and verifies the key matches this machine + not expired
 * 
 * IMPORTANT: Keep SECRET_KEY the same as in tools/generate-license.js
 */

const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// ─── SECRET KEY (must match tools/generate-license.js) ──────────────────────
// NEVER share this or include it in public repositories.
const SECRET_KEY = 'DoodhKhata@MilkShop#2024$LicenseKey!Private';
const APP_ID = 'milkshop-doodh-khata-v1';
const ALGORITHM = 'aes-256-cbc';

// ─── Machine Fingerprint ─────────────────────────────────────────────────────

function getMachineFingerprint() {
  const interfaces = os.networkInterfaces();
  let macAddress = '';

  // Find first non-internal, non-loopback MAC address
  for (const ifaces of Object.values(interfaces)) {
    for (const iface of ifaces) {
      if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
        macAddress = iface.mac;
        break;
      }
    }
    if (macAddress) break;
  }

  const cpuModel = (os.cpus()[0]?.model || 'unknown').replace(/\s+/g, ' ').trim();
  const hostname = os.hostname();
  const platform = os.platform();

  const raw = `${APP_ID}|${macAddress}|${cpuModel}|${hostname}|${platform}`;
  const hash = crypto.createHash('sha256').update(raw).digest('hex').toUpperCase();

  // Format as XXXX-XXXX-XXXX-XXXX (first 16 hex chars)
  return `${hash.slice(0, 4)}-${hash.slice(4, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}`;
}

// ─── Encryption Helpers ───────────────────────────────────────────────────────

function getKey() {
  return crypto.createHash('sha256').update(SECRET_KEY).digest(); // 32 bytes
}

function decryptPayload(encryptedStr) {
  try {
    const parts = encryptedStr.split(':');
    if (parts.length !== 2) return null;
    const [ivHex, encHex] = parts;
    const key = getKey();
    const iv = Buffer.from(ivHex, 'hex');
    const encrypted = Buffer.from(encHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
  } catch {
    return null;
  }
}

// ─── License File Persistence ─────────────────────────────────────────────────

function getLicensePath() {
  const userData = app.getPath('userData');
  return path.join(userData, 'license.dat');
}

function saveLicense(licenseKey) {
  const licensePath = getLicensePath();
  const dir = path.dirname(licensePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(licensePath, licenseKey.trim(), 'utf8');
}

function loadSavedLicense() {
  try {
    const licensePath = getLicensePath();
    if (fs.existsSync(licensePath)) {
      return fs.readFileSync(licensePath, 'utf8').trim();
    }
  } catch {
    // ignore
  }
  return null;
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

function getTrialPath() {
  const userData = app.getPath('userData');
  return path.join(userData, 'trial.dat');
}

function getSecondaryTrialPath() {
  const base = process.env.LOCALAPPDATA || app.getPath('userData');
  return path.join(base, 'milkshop_doodh_khata.sys');
}

const TRIAL_DAYS = 7;

function checkTrialStatus(machineId) {
  const trialPath = getTrialPath();
  const secPath = getSecondaryTrialPath();
  const now = new Date();

  // Try reading from both locations
  let primaryData = null;
  let secondaryData = null;

  if (fs.existsSync(trialPath)) {
    try {
      const raw = fs.readFileSync(trialPath, 'utf8').trim();
      primaryData = decryptPayload(raw);
    } catch {}
  }

  if (fs.existsSync(secPath)) {
    try {
      const raw = fs.readFileSync(secPath, 'utf8').trim();
      secondaryData = decryptPayload(raw);
    } catch {}
  }

  // Determine active trial data, taking the earlier firstRun if both exist
  let data = null;
  if (primaryData && secondaryData) {
    const pTime = new Date(primaryData.firstRun).getTime();
    const sTime = new Date(secondaryData.firstRun).getTime();
    data = pTime <= sTime ? primaryData : secondaryData;
  } else {
    data = primaryData || secondaryData;
  }

  // If no trial data exists anywhere, start a fresh 7-day trial
  if (!data) {
    const trialData = {
      machineId,
      firstRun: now.toISOString(),
      lastSeen: now.toISOString(),
      trialDays: TRIAL_DAYS,
    };
    try {
      const encrypted = encryptPayload(trialData);
      const dir1 = path.dirname(trialPath);
      if (!fs.existsSync(dir1)) fs.mkdirSync(dir1, { recursive: true });
      fs.writeFileSync(trialPath, encrypted, 'utf8');

      const dir2 = path.dirname(secPath);
      if (!fs.existsSync(dir2)) fs.mkdirSync(dir2, { recursive: true });
      fs.writeFileSync(secPath, encrypted, 'utf8');

      return {
        isTrial: true,
        trialExpired: false,
        daysLeft: TRIAL_DAYS,
        firstRun: trialData.firstRun,
      };
    } catch (err) {
      console.error('Failed to create trial file:', err);
      return { isTrial: false, trialExpired: true, daysLeft: 0, reason: 'Failed to initialize trial.' };
    }
  }

  // Trial data found - verify machine ID
  if (data.machineId !== machineId) {
    return { isTrial: false, trialExpired: true, daysLeft: 0, reason: 'Trial verification failed for this machine.' };
  }

  const firstRun = new Date(data.firstRun);
  const lastSeen = new Date(data.lastSeen || data.firstRun);

  if (isNaN(firstRun.getTime())) {
    return { isTrial: false, trialExpired: true, daysLeft: 0, reason: 'Corrupted trial data.' };
  }

  // Clock rollback detection (more than 24h backwards)
  if (now.getTime() < lastSeen.getTime() - 24 * 60 * 60 * 1000) {
    return {
      isTrial: true,
      trialExpired: true,
      daysLeft: 0,
      reason: 'System clock change detected. Trial has been ended.',
    };
  }

  const elapsedMs = now.getTime() - firstRun.getTime();
  const totalTrialMs = TRIAL_DAYS * 24 * 60 * 60 * 1000;
  const remainingMs = totalTrialMs - elapsedMs;

  if (remainingMs <= 0) {
    return {
      isTrial: true,
      trialExpired: true,
      daysLeft: 0,
      reason: 'Your 7-day trial period has ended.',
    };
  }

  // Update lastSeen timestamp and sync both anchors
  data.lastSeen = now.toISOString();
  try {
    const enc = encryptPayload(data);
    fs.writeFileSync(trialPath, enc, 'utf8');
    fs.writeFileSync(secPath, enc, 'utf8');
  } catch {}

  const daysLeft = Math.max(1, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)));
  return {
    isTrial: true,
    trialExpired: false,
    daysLeft,
    firstRun: data.firstRun,
  };
}

// ─── License Validation ───────────────────────────────────────────────────────

/**
 * Validates a license key against the current machine.
 * Returns { valid, clientName, expiryDate, daysLeft, reason, expired }
 */
function validateLicenseKey(licenseKey, machineId) {
  try {
    // License key is: base64(ivHex:encryptedHex) with dashes every 5 chars
    const cleaned = licenseKey.replace(/-/g, '').trim();
    const decoded = Buffer.from(cleaned, 'base64').toString('utf8');
    const data = decryptPayload(decoded);

    if (!data) {
      return { valid: false, reason: 'Invalid license key. Please check and try again.' };
    }

    if (data.appId !== APP_ID) {
      return { valid: false, reason: 'This license key is not for this application.' };
    }

    if (data.machineId !== machineId) {
      return {
        valid: false,
        reason: 'This license key is registered to a different machine. Contact your provider.',
      };
    }

    const expiryDate = new Date(data.expiryDate);
    const now = new Date();

    if (isNaN(expiryDate.getTime())) {
      return { valid: false, reason: 'License key contains invalid expiry date.' };
    }

    if (expiryDate < now) {
      return {
        valid: false,
        expired: true,
        reason: `Your license expired on ${expiryDate.toLocaleDateString('en-PK')}.`,
        clientName: data.clientName,
        expiryDate: data.expiryDate,
      };
    }

    const daysLeft = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));

    return {
      valid: true,
      clientName: data.clientName,
      expiryDate: data.expiryDate,
      daysLeft,
    };
  } catch {
    return { valid: false, reason: 'Invalid license key format.' };
  }
}

module.exports = {
  getMachineFingerprint,
  validateLicenseKey,
  saveLicense,
  loadSavedLicense,
  checkTrialStatus,
};
