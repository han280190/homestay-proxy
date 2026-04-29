# Homestay Proxy - Security Layer

Vercel serverless proxy giữa web app (GitHub Pages) và Apps Script backend.

**Chức năng:**
- ✓ PIN verify từ Google Sheets
- ✓ Rate limit (5 sai → lock 10 phút)
- ✓ Session token (30 phút expire)
- ✓ Audit log (append Google Sheets)
- ✓ Forward request tới Apps Script

---

## Setup (5 phút)

### Step 1: Tạo repo GitHub
```bash
# Clone template này (hoặc tạo mới)
git clone https://github.com/han280190/homestay-proxy.git
cd homestay-proxy

# Edit .env.example → copy .env.local
cp .env.example .env.local

# Fill variables (xem bên dưới)
# APPS_SCRIPT_URL
# API_SECRET_KEY
# AUDIT_SHEET_ID
```

### Step 2: Signup Vercel + Deploy
1. Tới `vercel.com` → "Sign up with GitHub"
2. Authorize Vercel
3. Dashboard → "Add New..." → "Project"
4. Select repo `homestay-proxy`
5. Vercel auto-detect Node.js → Next
6. **Environment Variables:**
   - `APPS_SCRIPT_URL` = [your Apps Script URL]
   - `API_SECRET_KEY` = a7f3k9b2m1x5q8w6j4c7d9e2h5t3r1u0
   - `AUDIT_SHEET_ID` = [your Sheet ID]
7. Deploy → Done! (lấy URL: `https://homestay-proxy-xxx.vercel.app`)

### Step 3: Update Apps Script v14
- Sửa `homestay_api_v14.gs` → verify API key thay vì PIN
- Thêm `verifyPin_` endpoint (để proxy dùng)
- Deploy lại Apps Script

### Step 4: Update Frontend v14
- Sửa `index_v14.html` → gọi Vercel proxy thay vì Apps Script
- Cập nhật `PROXY_URL = 'https://homestay-proxy-xxx.vercel.app/api/proxy'`
- Push GitHub → GitHub Pages auto update

---

## Variables

### APPS_SCRIPT_URL
Lấy từ Apps Script deployment:
1. Apps Script editor → Deploy → Manage deployments
2. Copy "URL" của web app

### API_SECRET_KEY
Random 32 ký tự, tôi đã sinh:
```
a7f3k9b2m1x5q8w6j4c7d9e2h5t3r1u0
```
(Nếu muốn đổi, sinh random string khác)

### AUDIT_SHEET_ID
Từ Google Sheets URL:
```
https://docs.google.com/spreadsheets/d/1BxFg9qK2...zzABC/edit
                                        ↑ đây là ID
```

---

## API Format

### Login
```javascript
POST /api/proxy
{
  "action": "login",
  "userName": "han",
  "pin": "123456"
}
→ { ok: true, token: "abc123...", expiresAt: 1714123456789 }
```

### Call API (với token)
```javascript
POST /api/proxy
{
  "action": "monthCalendar",
  "token": "abc123...",
  "month": 4,
  "year": 2026,
  "homestay": "all"
}
→ { ok: true, rooms: [...], bookings: [...] }
```

---

## Troubleshoot

### Deploy thất bại
- Check Vercel logs: Dashboard → Project → Deployments → click log
- Thường là missing env variables

### Request timeout (>30s)
- Proxy có maxDuration 30s
- Nếu Apps Script slow: kiểm tra backend query

### 401 Unauthorized
- PIN sai hoặc token expire
- Frontend check token chưa expire?

---

## Security

- PIN verify ở proxy (không gửi tới Apps Script)
- API key (proxy ↔ backend) private ở Vercel env
- Session token in-memory (expire 30 phút)
- Rate limit 5 sai → lock 10 phút
- Audit log → Google Sheets (append mỗi request)

---

## Tương lai

- Upgrade in-memory → Vercel KV (persistent rate limit + session)
- Append audit log tự động (Google Sheets API)
- IP whitelist (tùy chọn)
- 2FA (SMS code)
