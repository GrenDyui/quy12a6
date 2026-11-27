/* ==========================================================================
   crypto-vault.js — Zero-Friction Encrypted Token Vault + IndexedDB + Pairing
   Solves "đỡ phải add lại token" securely across ALL devices on GitHub Pages
   ========================================================================== */

import { LEGACY_PIN_SALT, LEGACY_PIN_HASH, KEYS } from "./config.js";
import { lsGet, lsSet } from "./utils.js";

const IDB_NAME = "quy12a6_vault_db";
const IDB_STORE = "kv";
const VAULT_ITER = 600000;
const PAIR_ITER = 120000;

/* ---------- Base64URL helpers for binary buffers ---------- */
function bytesToB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64Url(bytes) {
  return bytesToB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64UrlToBytes(str) {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  return b64ToBytes(str.replace(/-/g, "+").replace(/_/g, "/") + pad);
}

/* ---------- IndexedDB Dual Persistence (survives casual cache cleans) ---------- */
function openIdb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error("No IndexedDB"));
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGet(key) {
  try {
    const db = await openIdb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function idbSet(key, val) {
  try {
    const db = await openIdb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(val, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch {
    return false;
  }
}

export async function persistConfig(cfg) {
  const json = JSON.stringify(cfg);
  lsSet(KEYS.GH, json);
  await idbSet(KEYS.GH, cfg);
  try {
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist();
    }
  } catch {}
}

export async function loadPersistedConfig() {
  let fromLs = null;
  try {
    const raw = lsGet(KEYS.GH, "");
    if (raw) fromLs = JSON.parse(raw);
  } catch {}
  const fromIdb = await idbGet(KEYS.GH);

  // Merge: prefer whichever has token or workerUrl populated
  const merged = { ...(fromIdb || {}), ...(fromLs || {}) };
  if (!merged.token && fromIdb && fromIdb.token) merged.token = fromIdb.token;
  if (!merged.workerUrl && fromIdb && fromIdb.workerUrl) merged.workerUrl = fromIdb.workerUrl;
  if (!merged.workerSecret && fromIdb && fromIdb.workerSecret) merged.workerSecret = fromIdb.workerSecret;

  // Backfill missing store
  if (merged.token || merged.workerUrl) {
    lsSet(KEYS.GH, JSON.stringify(merged));
    if (!fromIdb || !fromIdb.token) idbSet(KEYS.GH, merged);
  }
  return merged;
}

/* ---------- PBKDF2 PIN Hashing (compatible with legacy PIN) ---------- */
export async function hashPin(pin, salt = LEGACY_PIN_SALT) {
  if (!window.crypto || !crypto.subtle) {
    throw new Error("Trình duyệt không hỗ trợ Web Crypto (hãy mở bằng HTTPS / Chrome / Safari mới).");
  }
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(salt), iterations: 200000, hash: "SHA-256" },
    key,
    256
  );
  return Array.from(new Uint8Array(bits))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyAdminPin(pin, customHash = "") {
  const expected = customHash || LEGACY_PIN_HASH;
  const h = await hashPin(pin);
  return h === expected;
}

/* ---------- Password Strength Helper ---------- */
export function evaluatePasswordStrength(pw) {
  const s = String(pw || "");
  let score = 0;
  if (s.length >= 8) score++;
  if (s.length >= 12) score++;
  if (/[a-z]/.test(s) && /[A-Z]/.test(s)) score++;
  if (/\d/.test(s)) score++;
  if (/[^A-Za-z0-9]/.test(s)) score++;
  if (s.length < 8) return { ok: false, score: Math.min(score, 1), label: "Quá ngắn (cần ≥ 8 ký tự)", color: "#fb7185", pct: 20 };
  if (score <= 2) return { ok: true, score, label: "Trung bình (nên thêm số hoặc chữ hoa)", color: "#fbbf24", pct: 55 };
  if (score === 3) return { ok: true, score, label: "Khá mạnh", color: "#38bdf8", pct: 80 };
  return { ok: true, score, label: "Rất mạnh (An toàn lưu trong repo)", color: "#34d399", pct: 100 };
}

/* ---------- AES-256-GCM Vault Encryption / Decryption ---------- */
async function deriveAesKey(password, saltBytes, iterations = VAULT_ITER) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptTokenVault({ token, owner, repo, hint = "", unlockAdmin = true }, password) {
  if (!window.crypto || !crypto.subtle) throw new Error("Trình duyệt không hỗ trợ mã hóa Web Crypto.");
  if (String(password || "").length < 8) throw new Error("Mật khẩu Két phải dài tối thiểu 8 ký tự!");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(password, salt, VAULT_ITER);
  const payload = JSON.stringify({ token, owner, repo, createdAt: Date.now() });
  const ctBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(payload));
  return {
    v: 1,
    alg: "AES-256-GCM",
    kdf: "PBKDF2-SHA256",
    iter: VAULT_ITER,
    owner,
    repo,
    unlockAdmin: !!unlockAdmin,
    hint: String(hint || "").slice(0, 80),
    salt: bytesToB64(salt),
    iv: bytesToB64(iv),
    ct: bytesToB64(new Uint8Array(ctBuf)),
    updatedAt: Date.now()
  };
}

export async function decryptTokenVault(vaultObj, password) {
  if (!vaultObj || vaultObj.v !== 1 || !vaultObj.salt || !vaultObj.iv || !vaultObj.ct) {
    throw new Error("File Két Token (vault.json) không hợp lệ.");
  }
  try {
    const salt = b64ToBytes(vaultObj.salt);
    const iv = b64ToBytes(vaultObj.iv);
    const ct = b64ToBytes(vaultObj.ct);
    const key = await deriveAesKey(password, salt, Number(vaultObj.iter) || VAULT_ITER);
    const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    const parsed = JSON.parse(new TextDecoder().decode(plainBuf));
    if (!parsed || !parsed.token) throw new Error("Empty token");
    return parsed;
  } catch {
    throw new Error("Sai mật khẩu Két Token!");
  }
}

/* ---------- Instant Device Pairing Link (Encrypted with 1-time 6-digit code) ---------- */
export async function createPairingLink(cfg) {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const salt = crypto.getRandomValues(new Uint8Array(12));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(code, salt, PAIR_ITER);
  const payload = JSON.stringify({
    owner: cfg.owner,
    repo: cfg.repo,
    token: cfg.token,
    workerUrl: cfg.workerUrl || "",
    exp: Date.now() + 15 * 60 * 1000 // expires in 15 minutes
  });
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(payload))
  );
  const packed = `${bytesToB64Url(salt)}.${bytesToB64Url(iv)}.${bytesToB64Url(ct)}`;
  const baseUrl = location.href.split("#")[0].split("?")[0];
  return { code, url: `${baseUrl}#pair=${packed}` };
}

export async function decodePairingHash(packed, code) {
  const parts = String(packed || "").split(".");
  if (parts.length !== 3) throw new Error("Liên kết ghép nối không hợp lệ.");
  try {
    const salt = b64UrlToBytes(parts[0]);
    const iv = b64UrlToBytes(parts[1]);
    const ct = b64UrlToBytes(parts[2]);
    const key = await deriveAesKey(String(code || "").trim(), salt, PAIR_ITER);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    const data = JSON.parse(new TextDecoder().decode(plain));
    if (data.exp && Date.now() > data.exp) {
      throw new Error("EXPIRED");
    }
    return data;
  } catch (e) {
    if (e && e.message === "EXPIRED") {
      throw new Error("Liên kết ghép máy đã hết hạn (quá 15 phút). Hãy tạo link mới.");
    }
    throw new Error("Mã 6 số không đúng!");
  }
}
