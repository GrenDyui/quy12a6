/* ==========================================================================
   sync.js — Unified Cloud Sync Engine (Raw CDN Read + Smart Batch Push +
             Encrypted Vault + Optional Cloudflare Worker Proxy + Auto-Retry)
   ========================================================================== */

import { DATA_FILE, VAULT_FILE, DEFAULT_REPO, KEYS, validDb, normalizeDb } from "./config.js";
import { $, b64enc, b64dec, nowStr, toast, askConfirm } from "./utils.js";
import { persistConfig, loadPersistedConfig, encryptTokenVault, decryptTokenVault } from "./crypto-vault.js";

export const syncState = {
  owner: DEFAULT_REPO.owner,
  repo: DEFAULT_REPO.repo,
  branch: DEFAULT_REPO.branch,
  token: "",
  workerUrl: DEFAULT_REPO.workerUrl || "",
  workerSession: "", // bearer token returned by Cloudflare Worker after login
  remoteVault: null, // parsed vault.json if detected in repo
  lastSynced: 0,
  pendingChanges: 0,
  pushing: false,
  pushAgain: false,
  pushTimer: null,
  statusKind: "ok" // ok | pending | error | offline
};

let onRemoteDataLoaded = null;
let onSyncUiUpdate = null;

export function configureSyncCallbacks({ onData, onUi }) {
  onRemoteDataLoaded = onData;
  onSyncUiUpdate = onUi;
}

export async function initSyncConfig() {
  let detectedOwner = DEFAULT_REPO.owner;
  let detectedRepo = DEFAULT_REPO.repo;
  const hm = location.hostname.match(/^([^.]+)\.github\.io$/i);
  if (hm) {
    detectedOwner = hm[1];
    const seg = location.pathname.split("/")[1] || "";
    detectedRepo = seg && !/\.html?$/i.test(seg) ? seg : location.hostname;
  }

  const saved = await loadPersistedConfig();
  syncState.owner = saved.owner || detectedOwner;
  syncState.repo = saved.repo || detectedRepo;
  syncState.branch = saved.branch || DEFAULT_REPO.branch;
  syncState.token = saved.token || "";
  syncState.workerUrl = saved.workerUrl || DEFAULT_REPO.workerUrl || "";
  syncState.workerSession = sessionStorage.getItem("QUY_12A6_WORKER_SESS") || "";
}

export async function saveSyncConfig() {
  await persistConfig({
    owner: syncState.owner,
    repo: syncState.repo,
    branch: syncState.branch,
    token: syncState.token,
    workerUrl: syncState.workerUrl
  });
  if (syncState.workerSession) {
    try { sessionStorage.setItem("QUY_12A6_WORKER_SESS", syncState.workerSession); } catch {}
  }
  if (onSyncUiUpdate) onSyncUiUpdate();
}

export function clearLocalToken() {
  syncState.token = "";
  syncState.workerSession = "";
  try { sessionStorage.removeItem("QUY_12A6_WORKER_SESS"); } catch {}
  return saveSyncConfig();
}

export function ghReady() {
  return /^[A-Za-z0-9_.-]+$/.test(syncState.owner) && /^[A-Za-z0-9_.-]+$/.test(syncState.repo);
}

export function canPush() {
  if (syncState.workerUrl && syncState.workerSession) return true;
  return ghReady() && Boolean(syncState.token);
}

export function activeAuthLabel() {
  if (syncState.workerUrl && syncState.workerSession) return "Cloudflare Worker Proxy";
  if (syncState.token) return "GitHub Token (đã lưu bền)";
  if (syncState.remoteVault) return "Có Két Token (chưa mở)";
  return "Chưa kết nối ghi";
}

function ghBase() {
  return `https://api.github.com/repos/${encodeURIComponent(syncState.owner)}/${encodeURIComponent(syncState.repo)}`;
}

function rawBase() {
  return `https://raw.githubusercontent.com/${encodeURIComponent(syncState.owner)}/${encodeURIComponent(syncState.repo)}/${encodeURIComponent(syncState.branch)}`;
}

function ghHeaders(isJson = false) {
  const h = { Accept: "application/vnd.github+json" };
  if (syncState.token) h.Authorization = `Bearer ${syncState.token}`;
  if (isJson) h["Content-Type"] = "application/json";
  return h;
}

export function ghError(status) {
  if (status === 401) return "Token sai hoặc đã hết hạn";
  if (status === 403) return syncState.token
    ? "Token thiếu quyền Contents: Read & Write hoặc bị giới hạn"
    : "GitHub giới hạn lượt gọi API, thử lại sau ít phút";
  if (status === 404) return `Không tìm thấy repo ${syncState.owner}/${syncState.repo}`;
  return `GitHub trả lỗi HTTP ${status}`;
}

export function netMsg(e) {
  const m = String((e && e.message) || e || "");
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) {
    return "Không kết nối được mạng / GitHub";
  }
  return m;
}

export function setSyncStatus(text, kind = "ok") {
  syncState.statusKind = kind;
  const dot = $("syncDot");
  if (dot) dot.className = `sync-dot ${kind}`;
  const el = $("syncStatus");
  if (el) el.textContent = text;
  const g = $("ghState");
  if (g) g.textContent = text;

  const pendingBtn = $("btnPushPending");
  if (pendingBtn) {
    if (syncState.pendingChanges > 0) {
      pendingBtn.classList.remove("hidden");
      pendingBtn.textContent = syncState.pushing
        ? "⏳ Đang lưu…"
        : `☁️ Lưu ngay (${syncState.pendingChanges})`;
    } else {
      pendingBtn.classList.add("hidden");
    }
  }
}

/* ---------- Zero-Rate-Limit Public Read (Local relative -> Raw CDN -> API) ---------- */
export async function fetchPublicJson(filename) {
  const bust = `?t=${Date.now()}`;
  const candidates = [];

  // 1. If hosted on GitHub Pages or localhost HTTP(S), try same-origin file first (fastest, 0 API rate limit!)
  if (location.protocol === "http:" || location.protocol === "https:") {
    candidates.push(`./${filename}${bust}`);
  }
  // 2. Raw GitHub CDN (0 REST API rate limit!)
  if (ghReady()) {
    candidates.push(`${rawBase()}/${filename}${bust}`);
  }

  for (const url of candidates) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (r.ok) {
        return await r.json();
      }
    } catch {}
  }
  return null;
}

/* ---------- Detect vault.json in Repo (zero rate limit) ---------- */
export async function checkRemoteVault() {
  try {
    const v = await fetchPublicJson(VAULT_FILE);
    if (v && v.v === 1 && v.salt && v.iv && v.ct) {
      syncState.remoteVault = v;
    } else {
      syncState.remoteVault = null;
    }
  } catch {
    syncState.remoteVault = null;
  }
  if (onSyncUiUpdate) onSyncUiUpdate();
  return syncState.remoteVault;
}

/* ---------- Fetch data.json via GitHub API (for exact SHA before push) ---------- */
async function ghFetchFileMeta(path) {
  const url = `${ghBase()}/contents/${path}?t=${Date.now()}`;
  const r = await fetch(url, { headers: ghHeaders(false), cache: "no-store" });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(ghError(r.status));
  const j = await r.json();
  return { sha: j.sha, content: j.content ? b64dec(j.content) : "" };
}

/* ---------- Pull latest data.json ---------- */
export async function pullLatest(currentDb, { force = false, silent = true, isAdmin = false } = {}) {
  if (!ghReady() && location.protocol === "file:") return false;
  try {
    let remoteData = null;

    // If admin with token & force pull, read via API for instant freshness (raw CDN can lag ~30-60s)
    if (isAdmin && syncState.token && force) {
      const meta = await ghFetchFileMeta(DATA_FILE);
      if (meta && meta.content) remoteData = JSON.parse(meta.content);
    } else {
      remoteData = await fetchPublicJson(DATA_FILE);
      // Fallback to API if raw failed and token is available
      if (!remoteData && syncState.token) {
        const meta = await ghFetchFileMeta(DATA_FILE);
        if (meta && meta.content) remoteData = JSON.parse(meta.content);
      }
    }

    if (!remoteData) {
      setSyncStatus("Chưa có data.json", "offline");
      if (!silent) toast("Chưa tìm thấy data.json trên máy chủ.", "err");
      return false;
    }

    if (!validDb(remoteData)) {
      throw new Error("Dữ liệu trên máy chủ không đúng định dạng.");
    }

    const ru = Number(remoteData.updatedAt) || 0;
    const lu = Number(currentDb && currentDb.updatedAt) || 0;

    if (!force && (syncState.pushTimer || syncState.pushing || syncState.pendingChanges > 0 || ru <= lu)) {
      syncState.lastSynced = Math.max(syncState.lastSynced, ru);
      setSyncStatus(`Mới nhất · ${nowStr()}`, "ok");
      return false;
    }

    const clean = normalizeDb(remoteData);
    syncState.lastSynced = ru;
    if (onRemoteDataLoaded) onRemoteDataLoaded(clean);
    setSyncStatus(`Đã cập nhật · ${nowStr()}`, "ok");
    if (!silent) toast("Đã tải dữ liệu mới nhất!", "ok");
    return true;
  } catch (e) {
    setSyncStatus("Chưa đồng bộ được", "error");
    if (!silent) toast(`Không tải được: ${netMsg(e)}`, "err");
    return false;
  }
}

/* ---------- Smart Debounced Push (batches rapid edits into 1 commit!) ---------- */
export function schedulePush(getDb, isAdmin) {
  if (!isAdmin) return;
  syncState.pendingChanges++;
  if (!canPush()) {
    setSyncStatus(`Chưa lưu lên mạng (${syncState.pendingChanges})`, "pending");
    return;
  }
  clearTimeout(syncState.pushTimer);
  setSyncStatus(`Đang chờ lưu (${syncState.pendingChanges})…`, "pending");
  syncState.pushTimer = setTimeout(() => {
    syncState.pushTimer = null;
    pushNow(getDb(), { manual: false, isAdmin: true });
  }, 2400);
}

/* ---------- Push via Cloudflare Worker Proxy ---------- */
async function pushViaWorker(dbSnapshot, at) {
  const base = syncState.workerUrl.replace(/\/+$/, "");
  const r = await fetch(`${base}/api/sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${syncState.workerSession}`
    },
    body: JSON.stringify({
      data: dbSnapshot,
      updatedAt: at,
      message: `Cập nhật sổ quỹ ${new Date().toISOString()}`
    })
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401) {
      syncState.workerSession = "";
      try { sessionStorage.removeItem("QUY_12A6_WORKER_SESS"); } catch {}
      throw new Error("Phiên Worker đã hết hạn, hãy mở khóa lại.");
    }
    throw new Error(body.error || `Worker trả lỗi HTTP ${r.status}`);
  }
  return body;
}

/* ---------- Push via GitHub Contents API with 409/422 Auto-Retry ---------- */
async function pushViaGitHub(dbSnapshot, at, manual) {
  const contentB64 = b64enc(JSON.stringify(dbSnapshot));
  const msg = `Cập nhật sổ quỹ ${new Date().toISOString()}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    const meta = await ghFetchFileMeta(DATA_FILE);
    if (meta && meta.content && attempt === 0) {
      try {
        const remote = JSON.parse(meta.content);
        const ru = Number(remote.updatedAt) || 0;
        if (ru > syncState.lastSynced && ru !== at) {
          const ok = await askConfirm({
            title: "Phát hiện dữ liệu mới hơn trên GitHub",
            message: "Có vẻ Thủ Quỹ vừa sửa sổ quỹ ở một thiết bị khác. Bạn có muốn ghi đè bằng dữ liệu của máy này không?",
            confirmText: "Vẫn ghi đè",
            danger: true
          });
          if (!ok) throw new Error("Đã hủy để tránh ghi đè dữ liệu mới hơn.");
        }
      } catch (err) {
        if (err && err.message && err.message.includes("Đã hủy")) throw err;
      }
    }

    const body = { message: msg, content: contentB64 };
    if (meta && meta.sha) body.sha = meta.sha;

    const res = await fetch(`${ghBase()}/contents/${DATA_FILE}`, {
      method: "PUT",
      headers: ghHeaders(true),
      body: JSON.stringify(body)
    });

    if (res.ok) return await res.json();
    if ((res.status === 409 || res.status === 422) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 350));
      continue;
    }
    throw new Error(res.status === 409 || res.status === 422 ? "Xung đột phiên bản, bấm Lưu lại" : ghError(res.status));
  }
}

export async function pushNow(dbObj, { manual = false, isAdmin = false } = {}) {
  if (!isAdmin) return false;
  if (!canPush()) {
    if (manual) toast("Chưa kết nối Token hoặc Worker Proxy (vào 🔄 Đồng bộ).", "err");
    return false;
  }
  if (syncState.pushing) {
    syncState.pushAgain = true;
    return false;
  }
  clearTimeout(syncState.pushTimer);
  syncState.pushTimer = null;
  syncState.pushing = true;
  setSyncStatus("Đang lưu lên đám mây…", "pending");

  const at = Number(dbObj.updatedAt) || Date.now();
  try {
    if (syncState.workerUrl && syncState.workerSession) {
      await pushViaWorker(dbObj, at);
    } else {
      await pushViaGitHub(dbObj, at, manual);
    }
    syncState.lastSynced = at;
    syncState.pendingChanges = 0;
    setSyncStatus(`Đã lưu · ${nowStr()}`, "ok");
    if (manual) toast("☁️ Đã lưu sổ quỹ lên đám mây!", "ok");
    return true;
  } catch (e) {
    setSyncStatus("Lưu thất bại", "error");
    toast(`Không đẩy được: ${netMsg(e)}`, "err");
    return false;
  } finally {
    syncState.pushing = false;
    if (syncState.pushAgain) {
      syncState.pushAgain = false;
      setTimeout(() => pushNow(dbObj, { manual: false, isAdmin: true }), 400);
    } else {
      setSyncStatus(syncState.pendingChanges > 0 ? `Chưa lưu (${syncState.pendingChanges})` : `Đã lưu · ${nowStr()}`, syncState.pendingChanges > 0 ? "pending" : "ok");
    }
  }
}

/* ---------- Worker Login ---------- */
export async function loginToWorker(password) {
  const base = syncState.workerUrl.replace(/\/+$/, "");
  if (!base) throw new Error("Chưa nhập địa chỉ Cloudflare Worker.");
  const r = await fetch(`${base}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Đăng nhập Worker thất bại (HTTP ${r.status})`);
  if (!j.sessionToken) throw new Error("Worker không trả về mã phiên.");
  syncState.workerSession = j.sessionToken;
  try { sessionStorage.setItem("QUY_12A6_WORKER_SESS", j.sessionToken); } catch {}
  await saveSyncConfig();
  return j;
}

/* ---------- Save & Unlock Encrypted Token Vault (vault.json in repo) ---------- */
export async function publishEncryptedVault(password, hint = "") {
  if (!ghReady() || !syncState.token) {
    throw new Error("Cần nhập GitHub Token trước khi tạo Két Token.");
  }
  const vaultObj = await encryptTokenVault(
    { token: syncState.token, owner: syncState.owner, repo: syncState.repo, hint, unlockAdmin: true },
    password
  );
  const existing = await ghFetchFileMeta(VAULT_FILE);
  const body = {
    message: "Cập nhật Két Token mã hóa AES-256 (vault.json)",
    content: b64enc(JSON.stringify(vaultObj, null, 2))
  };
  if (existing && existing.sha) body.sha = existing.sha;

  const res = await fetch(`${ghBase()}/contents/${VAULT_FILE}`, {
    method: "PUT",
    headers: ghHeaders(true),
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(ghError(res.status));
  syncState.remoteVault = vaultObj;
  if (onSyncUiUpdate) onSyncUiUpdate();
  return vaultObj;
}

export async function unlockRemoteVault(password) {
  if (!syncState.remoteVault) {
    await checkRemoteVault();
  }
  if (!syncState.remoteVault) {
    throw new Error("Repo chưa có Két Token (vault.json).");
  }
  const decrypted = await decryptTokenVault(syncState.remoteVault, password);
  syncState.owner = decrypted.owner || syncState.owner;
  syncState.repo = decrypted.repo || syncState.repo;
  syncState.token = decrypted.token;
  await saveSyncConfig();
  return decrypted;
}

/* ---------- Connection / Token Health Test ---------- */
export async function testConnection() {
  if (syncState.workerUrl) {
    const base = syncState.workerUrl.replace(/\/+$/, "");
    const r = await fetch(`${base}/api/health`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Worker lỗi HTTP ${r.status}`);
    return { mode: "worker", ok: true, detail: `Worker sẵn sàng (${j.repo || syncState.repo})` };
  }
  if (!ghReady()) throw new Error("Tên chủ repo hoặc tên repo không hợp lệ.");
  if (!syncState.token) throw new Error("Chưa nhập GitHub Token.");

  const r = await fetch(ghBase(), { headers: ghHeaders(false), cache: "no-store" });
  if (!r.ok) throw new Error(ghError(r.status));
  const j = await r.json();
  const canWrite = Boolean(j.permissions && j.permissions.push);
  const exp = r.headers.get("github-authentication-token-expiration") || "";
  if (!canWrite) {
    throw new Error("Token chỉ có quyền ĐỌC, thiếu quyền ghi (Contents: Read and write)!");
  }
  return {
    mode: "github",
    ok: true,
    detail: `Kết nối tốt tới ${j.full_name}${exp ? ` · Hết hạn: ${exp.slice(0, 10)}` : ""}`
  };
}

/* ---------- Receipt Compression, Upload & Zero-Rate-Limit View ---------- */
export function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, 1280 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.max(Math.round(img.width * k), 1);
      c.height = Math.max(Math.round(img.height * k), 1);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.74).split(",")[1]);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Không đọc được file ảnh."));
    };
    img.src = url;
  });
}

export async function uploadReceipt(file, id) {
  if (!canPush()) throw new Error("Chưa kết nối Token hoặc Worker để tải ảnh biên lai.");
  const b64 = await compressImage(file);
  const path = `receipts/${id}-${Date.now().toString(36)}.jpg`;

  if (syncState.workerUrl && syncState.workerSession) {
    const base = syncState.workerUrl.replace(/\/+$/, "");
    const r = await fetch(`${base}/api/receipt`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${syncState.workerSession}`
      },
      body: JSON.stringify({ path, contentBase64: b64, message: `Biên lai ${id}` })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Worker lỗi HTTP ${r.status}`);
    return path;
  }

  const r = await fetch(`${ghBase()}/contents/${path}`, {
    method: "PUT",
    headers: ghHeaders(true),
    body: JSON.stringify({ message: `Biên lai ${id}`, content: b64 })
  });
  if (!r.ok) throw new Error(ghError(r.status));
  return path;
}

export async function fetchReceiptUrl(path) {
  if (!/^receipts\/[A-Za-z0-9_.-]{1,80}\.(jpg|jpeg|png|webp)$/i.test(path || "")) {
    throw new Error("Đường dẫn biên lai không hợp lệ.");
  }
  const candidates = [];
  if (location.protocol === "http:" || location.protocol === "https:") {
    candidates.push(`./${path}`);
  }
  if (ghReady()) {
    candidates.push(`${rawBase()}/${path}`);
  }
  for (const url of candidates) {
    try {
      const r = await fetch(url);
      if (r.ok) {
        const blob = await r.blob();
        return URL.createObjectURL(blob);
      }
    } catch {}
  }
  // Fallback to GitHub API raw
  if (ghReady()) {
    const r = await fetch(`${ghBase()}/contents/${path}`, {
      headers: { Accept: "application/vnd.github.raw+json", ...(syncState.token ? { Authorization: `Bearer ${syncState.token}` } : {}) }
    });
    if (r.ok) {
      return URL.createObjectURL(await r.blob());
    }
  }
  throw new Error("Không tìm thấy ảnh biên lai.");
}
