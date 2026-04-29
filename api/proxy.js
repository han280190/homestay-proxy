/**
 * Vercel Proxy for Homestay App v15
 * 
 * Security layer between Frontend (GitHub Pages) and Backend (Apps Script)
 * 
 * Handles:
 * - PIN verification (converts PIN to session token)
 * - Session token validation
 * - Rate limiting (5 fails = 10min lock)
 * - CORS headers
 * - Audit logging
 */

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;
const API_SECRET_KEY = process.env.API_SECRET_KEY || 'a7f3k9b2m1x5q8w6j4c7d9e2h5t3r1u0';  // Fallback
const FRONTEND_ORIGIN = 'https://han280190.github.io';

// Rate limiting: userName -> { failCount, lockUntil }
const rateLimits = {};

// Session tokens: token -> { userName, expiresAt }
const sessions = {};

module.exports = (req, res) => {
  // === CORS Headers ===
  res.setHeader('Access-Control-Allow-Origin', FRONTEND_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only POST allowed
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  let body = {};
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch (e) {
    return res.status(400).json({ ok: false, error: 'Invalid JSON' });
  }

  const { action, userName, pin, token } = body;

  try {
    // === Route actions ===
    
    if (action === 'login') {
      // Frontend: send PIN → Proxy verify → Proxy create token
      return handleLogin(res, userName, pin);
    }

    // All other actions require valid session token
    if (!token || !validateSessionToken(token)) {
      return res.status(401).json({ ok: false, error: 'Invalid or expired token' });
    }

    // Forward to Apps Script with API key
    return forwardToAppsScript(res, body);

  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ ok: false, error: 'Server error: ' + err.message });
  }
};

// ============ LOGIN HANDLER ============

function handleLogin(res, userName, pin) {
  if (!userName || !pin) {
    return res.status(400).json({ ok: false, error: 'Missing userName or pin' });
  }

  // Check rate limit
  const now = Date.now();
  const limit = rateLimits[userName];
  
  if (limit && limit.lockUntil > now) {
    const secondsLeft = Math.ceil((limit.lockUntil - now) / 1000);
    return res.status(429).json({ 
      ok: false, 
      error: `Bị khóa. Thử lại sau ${secondsLeft} giây` 
    });
  }

  // Verify PIN via Apps Script
  verifyPinViaAppsScript(userName, pin, (err, result) => {
    if (err || !result.ok) {
      // Increment fail count
      if (!rateLimits[userName]) {
        rateLimits[userName] = { failCount: 0, lockUntil: 0 };
      }
      rateLimits[userName].failCount++;

      // Lock after 5 fails for 10 minutes
      if (rateLimits[userName].failCount >= 5) {
        rateLimits[userName].lockUntil = Date.now() + 10 * 60 * 1000;
        return res.status(429).json({ 
          ok: false, 
          error: 'Bị khóa 10 phút vì nhập sai PIN quá lần' 
        });
      }

      return res.status(401).json({ 
        ok: false, 
        error: result ? result.error : err.message 
      });
    }

    // PIN correct - create session token
    const token = generateToken();
    const expiresAt = Date.now() + 30 * 60 * 1000; // 30 min
    sessions[token] = { userName, expiresAt };

    // Reset fail count
    rateLimits[userName].failCount = 0;

    return res.status(200).json({
      ok: true,
      token,
      userName,
      expiresAt
    });
  });
}

// ============ APPS SCRIPT COMMUNICATION ============

function verifyPinViaAppsScript(userName, pin, callback) {
  const payload = {
    action: 'verifyPin',
    userName,
    pin,
    apiKey: API_SECRET_KEY
  };

  const body = JSON.stringify(payload);
  const fetchURL = APPS_SCRIPT_URL;

  fetch(fetchURL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  })
    .then(res => res.json())
    .then(data => callback(null, data))
    .catch(err => callback(err, null));
}

function forwardToAppsScript(res, body) {
  // Add API key to request
  body.apiKey = API_SECRET_KEY;

  const fetchURL = APPS_SCRIPT_URL;

  fetch(fetchURL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
    .then(r => r.json())
    .then(data => {
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).send(JSON.stringify(data));
    })
    .catch(err => {
      console.error('Apps Script error:', err);
      return res.status(502).json({ ok: false, error: 'Apps Script error: ' + err.message });
    });
}

// ============ SESSION MANAGEMENT ============

function generateToken() {
  return 'tok_' + Math.random().toString(36).substring(2, 15) + 
         Math.random().toString(36).substring(2, 15);
}

function validateSessionToken(token) {
  if (!sessions[token]) return false;
  const session = sessions[token];
  if (session.expiresAt < Date.now()) {
    delete sessions[token];
    return false;
  }
  return true;
}

// ============ CLEANUP ============

// Clean expired sessions every 5 minutes
setInterval(() => {
  const now = Date.now();
  Object.keys(sessions).forEach(token => {
    if (sessions[token].expiresAt < now) {
      delete sessions[token];
    }
  });
}, 5 * 60 * 1000);
