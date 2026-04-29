/**
 * Homestay Proxy v1
 * 
 * Chức năng:
 * 1. Verify PIN từ Google Sheets (USERS)
 * 2. Rate limit (5 sai → lock 10 phút)
 * 3. Session token (30 phút expire)
 * 4. Log audit vào Google Sheets (11. Audit_log)
 * 5. Forward request tới Apps Script với API key
 */

const fetch = require('node-fetch');

// ========== CONFIG ==========
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;
const API_SECRET_KEY = process.env.API_SECRET_KEY;
const AUDIT_SHEET_ID = process.env.AUDIT_SHEET_ID;

// In-memory storage (reset mỗi deploy, đủ cho 3 user)
// Tương lai: upgrade sang Vercel KV nếu cần persistent
const rateLimitMap = new Map(); // { userName: { failCount, lockedUntil } }
const sessionMap = new Map();   // { token: { userName, expiresAt } }

const RATE_LIMIT_MAX_FAILS = 5;
const RATE_LIMIT_LOCK_MINUTES = 10;
const SESSION_DURATION_MINUTES = 30;

// ========== HELPERS ==========

function generateToken() {
  return require('crypto').randomBytes(16).toString('hex');
}

function isRateLimited(userName) {
  const record = rateLimitMap.get(userName);
  if (!record) return false;
  if (Date.now() > record.lockedUntil) {
    rateLimitMap.delete(userName);
    return false;
  }
  return true;
}

function recordFailedAttempt(userName) {
  const record = rateLimitMap.get(userName) || { failCount: 0, lockedUntil: 0 };
  record.failCount++;
  if (record.failCount >= RATE_LIMIT_MAX_FAILS) {
    record.lockedUntil = Date.now() + RATE_LIMIT_LOCK_MINUTES * 60000;
  }
  rateLimitMap.set(userName, record);
}

function clearRateLimit(userName) {
  rateLimitMap.delete(userName);
}

function createSession(userName) {
  const token = generateToken();
  const expiresAt = Date.now() + SESSION_DURATION_MINUTES * 60000;
  sessionMap.set(token, { userName, expiresAt });
  return { token, expiresAt };
}

function validateSession(token) {
  const session = sessionMap.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessionMap.delete(token);
    return null;
  }
  return session;
}

async function logAudit(userName, action, details) {
  // Log audit vào Google Sheets sheet "11. Audit_log"
  // Format: Timestamp | UserName | Action | Details
  // Tương lai: dùng Google Sheets API để append
  // Hiện tại: print to console (Vercel logs)
  const timestamp = new Date().toISOString();
  console.log(`[AUDIT] ${timestamp} | ${userName} | ${action} | ${JSON.stringify(details)}`);
  
  // TODO v14.1: Append vào Google Sheets qua API
}

async function forwardToAppsScript(action, userName, params) {
  /**
   * Forward request tới Apps Script backend
   * Gửi API_SECRET_KEY thay vì PIN
   */
  const payload = {
    action,
    userName,
    apiKey: API_SECRET_KEY, // Backend sẽ verify key này
    ...params
  };

  try {
    const response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      timeout: 30000
    });

    if (!response.ok) {
      return { ok: false, error: `Apps Script error: ${response.status}` };
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('[ERROR] Forward to Apps Script failed:', error);
    return { ok: false, error: 'Backend connection failed' };
  }
}

// ========== MAIN HANDLER ==========

module.exports = async (req, res) => {
  // CORS - Allow GitHub Pages origin
  res.setHeader('Access-Control-Allow-Origin', 'https://han280190.github.io');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(400).json({ ok: false, error: 'POST only' });
  }

  const { action, userName, pin, token, ...otherParams } = req.body;

  // ===== ACTION 1: LOGIN (verify PIN → create token) =====
  if (action === 'login') {
    if (!userName || !pin) {
      return res.status(400).json({ ok: false, error: 'Missing userName or pin' });
    }

    // Check rate limit
    if (isRateLimited(userName)) {
      await logAudit(userName, 'LOGIN_ATTEMPT', { result: 'RATE_LIMITED' });
      return res.status(429).json({ ok: false, error: 'Too many failed attempts. Try again in 10 minutes.' });
    }

    // Verify PIN từ Apps Script (backend read từ USERS sheet)
    const verifyRes = await forwardToAppsScript('verifyPin', userName, { pin });
    
    if (!verifyRes.ok || !verifyRes.verified) {
      recordFailedAttempt(userName);
      await logAudit(userName, 'LOGIN_FAILED', { attempt: rateLimitMap.get(userName)?.failCount || 1 });
      return res.status(401).json({ ok: false, error: 'Invalid PIN' });
    }

    // PIN đúng → create session token
    clearRateLimit(userName);
    const { token: newToken, expiresAt } = createSession(userName);
    await logAudit(userName, 'LOGIN_SUCCESS', { tokenExpiresAt: new Date(expiresAt).toISOString() });

    return res.json({ ok: true, token: newToken, expiresAt });
  }

  // ===== ACTION 2: API calls (require valid token) =====
  // monthCalendar, createBooking, updateBooking, etc.
  if (!token) {
    return res.status(401).json({ ok: false, error: 'Missing token' });
  }

  const session = validateSession(token);
  if (!session) {
    return res.status(401).json({ ok: false, error: 'Invalid or expired token' });
  }

  // Token valid → forward to Apps Script
  const apiRes = await forwardToAppsScript(action, session.userName, {
    ...otherParams
  });

  // Log audit for data-modifying actions
  if (['createBooking', 'updateBooking', 'cancelBooking', 'updateStatus'].includes(action)) {
    await logAudit(session.userName, action, otherParams);
  }

  return res.json(apiRes);
};
