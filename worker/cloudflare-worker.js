/**
 * Cloudflare Worker Proxy for Sổ Quỹ Lớp 12A6 (GrenDyui/quy12a6)
 * --------------------------------------------------------------
 * Giấu 100% GITHUB_TOKEN ở phía server Cloudflare.
 * Trình duyệt Thủ Quỹ chỉ cần nhập mật khẩu 1 lần -> nhận Session Token HMAC 30 ngày.
 *
 * Environment Secrets cần cài trong Cloudflare Dashboard -> Worker -> Settings -> Variables:
 *   - GITHUB_TOKEN    (Secret) : Fine-grained PAT có quyền Contents: Read & Write trên repo quy12a6
 *   - ADMIN_PASSWORD  (Secret) : Mật khẩu Thủ Quỹ (nên >= 8 ký tự)
 *   - SESSION_SECRET  (Secret) : Chuỗi ngẫu nhiên bất kỳ >= 32 ký tự để ký phiên đăng nhập
 *
 * Environment Variables (plaintext):
 *   - GITHUB_OWNER    : "GrenDyui"
 *   - GITHUB_REPO     : "quy12a6"
 *   - ALLOWED_ORIGIN  : "https://grendyui.github.io"
 */

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 ngày
const failTracker = new Map();

function corsHeaders(req, env) {
  const origin = req.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGIN || "https://grendyui.github.io").split(",").map((s) => s.trim());
  const allowOrigin = allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
    ? origin
    : allowed[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400"
  };
}

function jsonResp(data, status, req, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(req, env) }
  });
}

async function hmacSign(message, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function safeEqual(a, b) {
  const sa = String(a || "");
  const sb = String(b || "");
  if (sa.length !== sb.length) return false;
  let diff = 0;
  for (let i = 0; i < sa.length; i++) diff |= sa.charCodeAt(i) ^ sb.charCodeAt(i);
  return diff === 0;
}

async function createSessionToken(env) {
  const payload = btoa(JSON.stringify({ role: "admin", exp: Date.now() + SESSION_TTL_MS }))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const sig = await hmacSign(payload, env.SESSION_SECRET || env.ADMIN_PASSWORD);
  return `${payload}.${sig}`;
}

async function verifySessionToken(authHeader, env) {
  const m = String(authHeader || "").match(/^Bearer\s+([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/);
  if (!m) return false;
  const [, payload, sig] = m;
  const expected = await hmacSign(payload, env.SESSION_SECRET || env.ADMIN_PASSWORD);
  if (!safeEqual(sig, expected)) return false;
  try {
    const pad = payload.length % 4 === 0 ? "" : "=".repeat(4 - (payload.length % 4));
    const data = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/") + pad));
    return data.role === "admin" && Number(data.exp) > Date.now();
  } catch {
    return false;
  }
}

function toBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(bin);
}

async function ghPutFile(env, path, base64Content, message) {
  const owner = env.GITHUB_OWNER || "GrenDyui";
  const repo = env.GITHUB_REPO || "quy12a6";
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`;
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    "User-Agent": "quy12a6-cloudflare-worker/1.0"
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    let sha;
    const getRes = await fetch(`${url}?t=${Date.now()}`, { headers });
    if (getRes.ok) {
      const meta = await getRes.json();
      sha = meta.sha;
    } else if (getRes.status !== 404) {
      throw new Error(`GitHub GET failed (${getRes.status})`);
    }

    const body = { message, content: base64Content };
    if (sha) body.sha = sha;

    const putRes = await fetch(url, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    if (putRes.ok) return await putRes.json();
    if ((putRes.status === 409 || putRes.status === 422) && attempt < 2) continue;
    const errText = await putRes.text();
    throw new Error(`GitHub PUT failed (${putRes.status}): ${errText.slice(0, 140)}`);
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    const url = new URL(request.url);

    if (url.pathname === "/api/health" && request.method === "GET") {
      return jsonResp({
        ok: true,
        repo: `${env.GITHUB_OWNER || "GrenDyui"}/${env.GITHUB_REPO || "quy12a6"}`,
        configured: Boolean(env.GITHUB_TOKEN && env.ADMIN_PASSWORD)
      }, 200, request, env);
    }

    if (url.pathname === "/api/login" && request.method === "POST") {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const rec = failTracker.get(ip) || { count: 0, lockUntil: 0 };
      if (Date.now() < rec.lockUntil) {
        return jsonResp({ error: "Thử sai quá nhiều lần, vui lòng đợi vài phút." }, 429, request, env);
      }

      const body = await request.json().catch(() => ({}));
      if (!env.ADMIN_PASSWORD || !safeEqual(body.password, env.ADMIN_PASSWORD)) {
        rec.count += 1;
        if (rec.count >= 5) rec.lockUntil = Date.now() + 5 * 60 * 1000;
        failTracker.set(ip, rec);
        return jsonResp({ error: "Sai mật khẩu Thủ Quỹ." }, 401, request, env);
      }

      failTracker.delete(ip);
      const sessionToken = await createSessionToken(env);
      return jsonResp({ ok: true, sessionToken, expiresInDays: 30 }, 200, request, env);
    }

    // Protected endpoints require valid session token
    const isAuthed = await verifySessionToken(request.headers.get("Authorization"), env);
    if (!isAuthed) {
      return jsonResp({ error: "Chưa đăng nhập hoặc phiên đã hết hạn." }, 401, request, env);
    }

    if (url.pathname === "/api/sync" && request.method === "POST") {
      try {
        const body = await request.json();
        if (!body || !body.data || !body.data.sheets) {
          return jsonResp({ error: "Dữ liệu data.json không hợp lệ." }, 400, request, env);
        }
        const msg = String(body.message || `Cập nhật sổ quỹ ${new Date().toISOString()}`).slice(0, 120);
        await ghPutFile(env, "data.json", toBase64Utf8(JSON.stringify(body.data)), msg);
        return jsonResp({ ok: true }, 200, request, env);
      } catch (e) {
        return jsonResp({ error: e.message || "Lỗi đồng bộ GitHub." }, 500, request, env);
      }
    }

    if (url.pathname === "/api/receipt" && request.method === "POST") {
      try {
        const body = await request.json();
        const path = String(body.path || "");
        if (!/^receipts\/[A-Za-z0-9_.-]{1,80}\.jpg$/.test(path) || !body.contentBase64) {
          return jsonResp({ error: "Đường dẫn hoặc nội dung ảnh không hợp lệ." }, 400, request, env);
        }
        await ghPutFile(env, path, body.contentBase64, String(body.message || "Biên lai").slice(0, 80));
        return jsonResp({ ok: true, path }, 200, request, env);
      } catch (e) {
        return jsonResp({ error: e.message || "Lỗi tải biên lai." }, 500, request, env);
      }
    }

    return jsonResp({ error: "Not found" }, 404, request, env);
  }
};
