/* ==========================================================================
   app.js — Application Orchestrator, Auth (PIN / Vault / Worker), Events
   ========================================================================== */

import {
  MAIN_SHEET, NAMES, KEYS, SEAT_DEFAULT, cloneSeat,
  buildInitialDb, validDb, normalizeDb
} from "./config.js";
import {
  $, lsGet, lsSet, lsDel, money, removeTones, parseDMY, localISO,
  toast, openModal, closeModal, closeAllModals, askConfirm, initConfirmDialog, copyText
} from "./utils.js";
import {
  verifyAdminPin, hashPin, evaluatePasswordStrength,
  createPairingLink, decodePairingHash
} from "./crypto-vault.js";
import {
  syncState, configureSyncCallbacks, initSyncConfig, saveSyncConfig, clearLocalToken,
  ghReady, canPush, activeAuthLabel, checkRemoteVault, pullLatest, schedulePush,
  pushNow, loginToWorker, publishEncryptedVault, unlockRemoteVault, testConnection, netMsg
} from "./sync.js";
import { allSheets, renderAll, renderStudents, renderLedger, renderLog, renderSeat } from "./render.js";
import {
  ensureBank, bankLine, openQR, initQrActions, openStudentProfile, payAllDebtOfStudent,
  applyBatchPay, openReceiptModal, renderTxCategoryChips, setTxTypeUI, openTxModal,
  saveTxFromModal, openNewWeekModal, confirmNewWeek, runReconParse, drawReport, exportExcel
} from "./actions.js";

/* ---------- Local State ---------- */
let storageOk = true;
try { localStorage.setItem("__t", "1"); localStorage.removeItem("__t"); } catch { storageOk = false; }

let db = null;
const undoStack = [];
let pinFails = 0;
let pinLockUntil = 0;
let pendingPairHash = "";

const state = {
  isAdmin: false,
  week: MAIN_SHEET,
  tab: "students",
  view: "list",
  seatMode: "quick",
  seatPick: 0,
  batchMode: false,
  batchSelected: new Set(),
  search: "",
  filter: "all",
  sort: "stt",
  txSearch: "",
  txFilter: "all",
  logSearch: "",
  logFilter: "all",
  txType: "Chi",
  editTxId: null,
  payContext: null,
  charts: {}
};

/* ---------- Theme & FX Preferences ---------- */
function themeMode() {
  const m = lsGet(KEYS.THEME, "dark");
  return /^(auto|dark|light)$/.test(m) ? m : "dark";
}
function isLight() {
  const m = themeMode();
  if (m === "light") return true;
  if (m === "dark") return false;
  try { return Boolean(window.matchMedia && matchMedia("(prefers-color-scheme: light)").matches); } catch { return false; }
}
function fxPref() {
  const m = lsGet(KEYS.FX, "auto");
  return /^(auto|on|off)$/.test(m) ? m : "auto";
}
function fxOn() {
  const m = fxPref();
  if (m === "off") return false;
  if (m === "on") return true;
  try { if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return false; } catch {}
  if (navigator.connection && navigator.connection.saveData) return false;
  return true;
}
function applyTheme() {
  const l = isLight();
  document.documentElement.classList.toggle("light", l);
  document.documentElement.classList.toggle("dark", !l);
  document.body.classList.toggle("no-fx", !fxOn());
  const mt = document.querySelector('meta[name="theme-color"]');
  if (mt) mt.setAttribute("content", l ? "#f4f7fb" : "#080d19");
  const btn = $("btnTheme");
  if (btn) btn.textContent = l ? "🌙" : "☀️";
}

/* ---------- Privacy Helpers ---------- */
function getMe() {
  const v = Number(lsGet(KEYS.ME, ""));
  return v >= 1 && v <= NAMES.length ? v : 0;
}
function privOn() {
  return Boolean(db && db.privacy) && !state.isAdmin;
}
function canSee(stt) {
  return !privOn() || stt === getMe();
}
function dispName(stt) {
  if (canSee(stt)) return NAMES[stt - 1];
  const p = NAMES[stt - 1].split(" ");
  return p.length < 2 ? NAMES[stt - 1] : p.slice(0, -1).map((w) => w.charAt(0).toUpperCase() + ".").join("") + " " + p[p.length - 1];
}

/* ---------- Database Lifecycle ---------- */
function initLocalDb() {
  let raw = null;
  try {
    raw = localStorage.getItem(KEYS.DB);
    if (raw) {
      const p = JSON.parse(raw);
      if (validDb(p)) {
        db = normalizeDb(p);
        return;
      }
    }
  } catch {}
  try { if (raw) localStorage.setItem(`${KEYS.DB}_BAK`, raw); } catch {}
  db = normalizeDb(buildInitialDb());
  db.updatedAt = 0;
  try { localStorage.setItem(KEYS.DB, JSON.stringify(db)); } catch {}
}

function logAct(k, m, stt = 0) {
  if (!db.log) db.log = [];
  db.log.unshift({ t: Date.now(), k, m: String(m).slice(0, 200), s: stt || 0 });
  if (db.log.length > 300) db.log.length = 300;
}

function saveDb(pushHist) {
  if (pushHist) {
    undoStack.push(JSON.stringify(db));
    if (undoStack.length > 20) undoStack.shift();
    $("btnUndo").disabled = false;
  }
  db.updatedAt = Date.now();
  try {
    localStorage.setItem(KEYS.DB, JSON.stringify(db));
    storageOk = true;
  } catch {
    storageOk = false;
    toast("Không lưu được cục bộ! Hãy bấm Lưu lên đám mây hoặc tải sao lưu.", "err");
  }
  updateAlerts();
  if (!pushHist) {
    schedulePush(() => db, state.isAdmin);
  }
}

function requireAdmin() {
  if (!state.isAdmin) {
    toast("Chế độ Bạn Học chỉ được xem. Bấm “Mở khoá Thủ Quỹ” để chỉnh sửa.", "err");
    return false;
  }
  return true;
}

/* ---------- Alerts & Celebration ---------- */
function updateAlerts() {
  const sa = $("storageAlert");
  const ia = $("infoAlert");
  if (!sa || !ia) return;

  if (!storageOk) {
    sa.classList.remove("hidden");
    sa.textContent = "⚠️ Trình duyệt không cho phép lưu cục bộ (chế độ ẩn danh). Dữ liệu chỉ an toàn sau khi đồng bộ lên đám mây.";
  } else {
    sa.classList.add("hidden");
  }

  if (!state.isAdmin) {
    ia.classList.add("hidden");
    return;
  }

  const last = Number(lsGet(KEYS.BACKUP, 0)) || 0;
  const days = last ? Math.floor((Date.now() - last) / 86400000) : null;

  if (!canPush()) {
    ia.classList.remove("hidden");
    ia.innerHTML = syncState.remoteVault
      ? `🔐 <b>Đã phát hiện Két Token trong repo!</b> Vào <b>🔄 Đồng bộ</b> → nhập Mật khẩu Két để tự động kết nối (không cần nhập lại Token).`
      : `🔑 <b>Chưa kết nối ghi đám mây.</b> Vào <b>🔄 Đồng bộ</b> để nhập Token 1 lần và tạo <b>Két Token mã hóa</b> hoặc gắn Cloudflare Worker.`;
  } else if (days === null || days >= 14) {
    ia.classList.remove("hidden");
    ia.textContent = `💾 ${days === null ? "Bạn chưa tải bản sao lưu dự phòng." : `Đã ${days} ngày chưa tải bản sao lưu.`} Vào 🔄 Đồng bộ → Tải sao lưu (.json).`;
  } else {
    ia.classList.add("hidden");
  }
}

function launchConfetti() {
  if (!fxOn()) return;
  const c = $("confettiCanvas");
  const ctx = c.getContext("2d");
  if (!ctx) return;
  const w = (c.width = window.innerWidth);
  const h = (c.height = window.innerHeight);
  const cols = ["#10b981", "#38bdf8", "#fbbf24", "#fb7185", "#818cf8"];
  const ps = Array.from({ length: 120 }, () => ({
    x: w / 2 + (Math.random() - 0.5) * 140,
    y: h * 0.32,
    vx: (Math.random() - 0.5) * 13,
    vy: -Math.random() * 12 - 3,
    s: Math.random() * 7 + 4,
    r: Math.random() * 6,
    vr: (Math.random() - 0.5) * 0.35,
    c: cols[(Math.random() * cols.length) | 0]
  }));
  const t0 = performance.now();
  (function frame(t) {
    ctx.clearRect(0, 0, w, h);
    ps.forEach((p) => {
      p.vy += 0.34; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
      ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      ctx.restore();
    });
    if (t - t0 < 2800) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, w, h);
  })(t0);
}

function checkCelebrate(kpi) {
  const main = db.sheets[MAIN_SHEET];
  const box = $("celebrate");
  const full = db.updatedAt > 0 && state.week === MAIN_SHEET && kpi.eligible > 0 && kpi.paidCount === kpi.eligible;
  if (!full) { box.classList.add("hidden"); return; }
  box.classList.remove("hidden");
  box.textContent = `🎉 Cả lớp đã nộp đủ 100% ${main.weekLabel}! Cảm ơn các bạn rất nhiều.`;
  const key = `${main.weekLabel}|${main.period}`;
  if (lsGet(KEYS.CELEB, "") !== key) {
    lsSet(KEYS.CELEB, key);
    launchConfetti();
  }
}

/* ---------- Shared Context ---------- */
function getCtx() {
  return {
    db, state, fxOn, isLight, canSee, privOn, getMe, dispName,
    requireAdmin, saveDb, logAct, updateAlerts, checkCelebrate,
    rerender: () => renderAll(getCtx())
  };
}

function rerender() {
  renderAll(getCtx());
}

/* ---------- Tab Switching ---------- */
function selectTab(t) {
  state.tab = t;
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.getAttribute("data-tab") === t));
  document.querySelectorAll("#bottomNav button").forEach((b) => b.classList.toggle("active", b.getAttribute("data-tab") === t));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
  const panel = $(`tab-${t}`);
  if (panel) panel.classList.remove("hidden");
  if (t === "charts") renderAll(getCtx());
  if (t !== "students") window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ---------- Payment Operations ---------- */
function toggleFull(stt) {
  if (!requireAdmin()) return;
  saveDb(true);
  const sh = db.sheets[state.week];
  const s = sh.students[stt - 1];
  const old = s.paid;
  s.paid = s.paid >= s.fee ? 0 : s.fee;
  logAct("pay", `${NAMES[stt - 1]}: ${sh.weekLabel} ${money(old)} → ${money(s.paid)}`, stt);
  saveDb(false);
  rerender();
}

function toggleExtraFull(stt) {
  if (!requireAdmin()) return;
  saveDb(true);
  const it = db.extra.items[stt - 1];
  const old = it.paid;
  it.paid = it.paid >= it.due ? 0 : it.due;
  logAct("pay", `${NAMES[stt - 1]}: ${db.extra.title} ${money(old)} → ${money(it.paid)}`, stt);
  saveDb(false);
  rerender();
}

function openPayModal(mode, stt, sheetKey) {
  if (!requireAdmin()) return;
  state.payContext = { mode, stt, sheetKey: sheetKey || state.week };
  const box = $("payFeeBox");
  if (mode === "extra") {
    const it = db.extra.items[stt - 1];
    $("payTitle").textContent = `Khoản phụ: ${it.name}`;
    $("paySub").textContent = `Phải đóng: ${money(it.due)}`;
    $("payInput").value = it.paid;
    box.style.display = "none";
  } else {
    const sh = db.sheets[state.payContext.sheetKey];
    const s = sh.students[stt - 1];
    $("payTitle").textContent = `${sh.weekLabel} — ${s.name}`;
    $("paySub").textContent = `Mức đóng: ${money(s.fee)}${s.note ? ` (${s.note})` : ""}`;
    $("payInput").value = s.paid;
    box.style.display = "";
    box.open = Boolean(s.exempt);
    $("payFee").value = s.fee;
    $("payNote").value = s.note || "";
    $("payPerm").checked = Boolean(s.perm);
  }
  openModal("modalPay");
  setTimeout(() => { $("payInput").select(); }, 50);
}

async function savePay() {
  const ctx = state.payContext;
  if (!ctx || !requireAdmin()) return;
  const val = Math.max(Number($("payInput").value) || 0, 0);

  if (ctx.mode === "extra") {
    const it = db.extra.items[ctx.stt - 1];
    if (val > Math.max(it.due * 3, 100000)) {
      const ok = await askConfirm({ title: "Số tiền lớn bất thường", message: `Số tiền ${money(val)} lớn hơn nhiều so với mức ${money(it.due)}. Vẫn lưu?` });
      if (!ok) return;
    }
    saveDb(true);
    const msg = `${NAMES[ctx.stt - 1]}: ${db.extra.title} ${money(it.paid)} → ${money(val)}`;
    it.paid = val;
    logAct("pay", msg, ctx.stt);
  } else {
    const sh = db.sheets[ctx.sheetKey];
    const s = sh.students[ctx.stt - 1];
    const feeRaw = $("payFee").value.trim();
    const newFee = feeRaw === "" ? s.fee : Math.max(Number(feeRaw) || 0, 0);
    if (val > Math.max(newFee * 3, 100000)) {
      const ok = await askConfirm({ title: "Số tiền lớn bất thường", message: `Số tiền ${money(val)} lớn hơn mức ${money(newFee)}. Vẫn lưu?` });
      if (!ok) return;
    }
    saveDb(true);
    let msg = `${NAMES[ctx.stt - 1]}: ${sh.weekLabel} ${money(s.paid)} → ${money(val)}`;
    if (newFee !== s.fee) msg += ` (mức ${money(s.fee)} → ${money(newFee)})`;
    s.paid = val;
    s.fee = newFee;
    s.exempt = s.fee !== sh.weeklyFee;
    s.note = s.exempt ? $("payNote").value.trim().slice(0, 80) : "";
    s.perm = s.exempt && $("payPerm").checked;
    if (s.exempt && s.note) msg += ` · ${s.note}`;
    logAct("pay", msg, ctx.stt);
  }

  saveDb(false);
  closeModal("modalPay");
  rerender();
  toast("Đã cập nhật!", "ok");
}

/* ---------- Seat Map Actions ---------- */
function seatFind(stt) {
  let pos = null;
  db.seatMap.cols.forEach((col, ci) => col.forEach((v, ri) => { if (v === stt) pos = [ci, ri]; }));
  return pos;
}
function seatTap(stt) {
  if (!state.isAdmin) {
    if (canSee(stt)) openStudentProfile(getCtx(), stt);
    return;
  }
  if (state.seatMode === "quick") return toggleFull(stt);
  if (state.seatMode === "edit") return openPayModal("week", stt, state.week);
  if (!state.seatPick) { state.seatPick = stt; renderSeat(getCtx(), db.sheets[state.week]); return; }
  if (state.seatPick === stt) { state.seatPick = 0; renderSeat(getCtx(), db.sheets[state.week]); return; }
  const a = state.seatPick, b = stt;
  saveDb(true);
  const pa = seatFind(a), pb = seatFind(b);
  if (pa && pb) { db.seatMap.cols[pa[0]][pa[1]] = b; db.seatMap.cols[pb[0]][pb[1]] = a; }
  logAct("sys", `Đổi chỗ ngồi: ${NAMES[a - 1]} ⇄ ${NAMES[b - 1]}`);
  state.seatPick = 0;
  saveDb(false);
  rerender();
  toast("Đã đổi chỗ!", "ok");
}
function seatEmpty(c, r) {
  if (!state.isAdmin || state.seatMode !== "swap" || !state.seatPick) return;
  const a = state.seatPick;
  const pa = seatFind(a);
  if (!pa) return;
  saveDb(true);
  db.seatMap.cols[pa[0]][pa[1]] = 0;
  db.seatMap.cols[c][r] = a;
  logAct("sys", `Chuyển chỗ: ${NAMES[a - 1]}`);
  state.seatPick = 0;
  saveDb(false);
  rerender();
  toast("Đã chuyển chỗ!", "ok");
}

/* ---------- Sync Modal & Zero-Token Vault UI ---------- */
function renderSyncModal() {
  $("syncMethodBadge").textContent = activeAuthLabel();
  $("ghOwner").value = syncState.owner;
  $("ghRepo").value = syncState.repo;
  $("ghToken").value = "";
  $("ghToken").placeholder = syncState.token
    ? "Đã lưu bền trên máy (nhập mới nếu muốn thay)"
    : "ghp_... hoặc github_pat_...";
  $("workerUrlInput").value = syncState.workerUrl || "";
  $("syncTokenBox").value = btoa(unescape(encodeURIComponent(JSON.stringify(db))));

  const hasVault = Boolean(syncState.remoteVault);
  const hasToken = Boolean(syncState.token);

  $("vaultStatusBox").innerHTML = hasVault
    ? `<span class="pill ok">🔐 Đã có Két Token trên repo</span> <span class="text-xs text-muted">${syncState.remoteVault.hint ? `Gợi ý: ${syncState.remoteVault.hint}` : "Mở máy nào chỉ cần nhập Mật khẩu Két"}</span>`
    : `<span class="pill gold">Chưa thiết lập Két Token</span> <span class="text-xs text-muted">Nhập Token 1 lần rồi mã hóa lưu vào repo để mọi máy tự dùng.</span>`;

  $("vaultUnlockBox").classList.toggle("hidden", !hasVault || hasToken);
  $("vaultSetupBox").classList.toggle("hidden", !state.isAdmin);
  $("btnClearToken").classList.toggle("hidden", !hasToken);
  $("btnCreatePair").disabled = !(hasToken || syncState.workerUrl);
  $("pairResultBox").classList.add("hidden");
}

/* ---------- Settings Modal ---------- */
function segButtons(boxId, opts, cur, onPick) {
  const box = $(boxId);
  box.innerHTML = opts.map(([v, label]) =>
    `<button type="button" data-v="${v}" class="seg-btn ${v === cur ? "active" : ""}">${label}</button>`
  ).join("");
  box.querySelectorAll("button").forEach((b) => {
    b.onclick = () => { onPick(b.getAttribute("data-v")); renderSettings(); };
  });
}

function renderSettings() {
  segButtons("setTheme", [["dark", "🌙 Tối"], ["light", "☀️ Sáng"], ["auto", "📱 Hệ thống"]], themeMode(), (v) => {
    lsSet(KEYS.THEME, v);
    applyTheme();
    rerender();
  });
  segButtons("setFx", [["auto", "Tự động"], ["on", "Bật"], ["off", "Tắt"]], fxPref(), (v) => {
    lsSet(KEYS.FX, v);
    applyTheme();
  });
  $("setPrivacy").checked = Boolean(db.privacy);
  const me = getMe();
  $("meBox").classList.toggle("hidden", !me);
  if (me) $("meName").textContent = NAMES[me - 1];
}

/* ---------- Unified Admin Unlock (PIN OR Vault Password OR Worker Password!) ---------- */
function openUnlockModal() {
  $("pinInput").value = "";
  const vHint = $("pinVaultHint");
  if (syncState.remoteVault && !syncState.token) {
    vHint.classList.remove("hidden");
    vHint.textContent = `🔐 Nhập Mật khẩu Két Token để vừa mở khoá Thủ Quỹ vừa tự động nạp Token!${syncState.remoteVault.hint ? ` (Gợi ý: ${syncState.remoteVault.hint})` : ""}`;
  } else {
    vHint.classList.add("hidden");
  }
  const wHint = $("pinWorkerHint");
  if (syncState.workerUrl && !syncState.workerSession) {
    wHint.classList.remove("hidden");
    wHint.textContent = `☁️ Đang kết nối Cloudflare Worker Proxy — nhập mật khẩu Thủ Quỹ của Worker.`;
  } else {
    wHint.classList.add("hidden");
  }
  openModal("modalPin");
}

async function handleUnlockSubmit() {
  const now = Date.now();
  if (now < pinLockUntil) {
    return toast(`Nhập sai nhiều lần, thử lại sau ${Math.ceil((pinLockUntil - now) / 1000)} giây!`, "err");
  }
  const secret = $("pinInput").value.trim();
  if (!secret) return toast("Hãy nhập mã PIN hoặc mật khẩu!", "err");

  const btn = $("btnVerifyPin");
  btn.disabled = true;
  btn.textContent = "Đang xác thực…";

  try {
    let unlocked = false;
    let extraNote = "";

    // 1. If Worker URL is configured, try authenticating with Cloudflare Worker first!
    if (syncState.workerUrl) {
      try {
        await loginToWorker(secret);
        unlocked = true;
        extraNote = " (Đã kết nối Cloudflare Worker!)";
      } catch {}
    }

    // 2. If remote Vault exists & we don't have token locally yet, try decrypting vault.json with this secret!
    if (!unlocked && syncState.remoteVault && syncState.remoteVault.unlockAdmin !== false && secret.length >= 8) {
      try {
        await unlockRemoteVault(secret);
        unlocked = true;
        extraNote = " + Đã tự mở Két Token!";
      } catch {}
    }

    // 3. Fallback: Classic Admin PIN verification (compatible with original PIN + custom changed PIN)
    if (!unlocked) {
      const okPin = await verifyAdminPin(secret, db.adminPinHash || "");
      if (okPin) unlocked = true;
    }

    if (unlocked) {
      pinFails = 0;
      state.isAdmin = true;
      closeModal("modalPin");
      rerender();
      toast(`👑 Đã mở khoá Thủ Quỹ!${extraNote}`, "ok");
      pullLatest(db, { force: false, silent: true, isAdmin: true });
    } else {
      pinFails++;
      if (pinFails >= 3) {
        pinLockUntil = Date.now() + 25000 * pinFails;
        toast(`Sai mã PIN / mật khẩu! Tạm khoá ${25 * pinFails} giây.`, "err");
      } else {
        toast("Sai mã PIN hoặc mật khẩu!", "err");
      }
    }
  } catch (e) {
    toast(netMsg(e), "err");
  } finally {
    btn.disabled = false;
    btn.textContent = "Mở khoá";
  }
}

/* ---------- Check URL Hash for Device Pairing (#pair=...) ---------- */
function checkPairingHash() {
  const m = location.hash.match(/^#pair=([A-Za-z0-9._-]+)$/);
  if (!m) return;
  pendingPairHash = m[1];
  history.replaceState(null, "", location.pathname + location.search);
  $("pairAcceptCode").value = "";
  openModal("modalPairAccept");
}

/* ---------- Wire All Events ---------- */
function bindEvents() {
  initConfirmDialog();
  initQrActions();
  renderTxCategoryChips();

  // Backdrop click & Esc close modals
  document.querySelectorAll(".modal-backdrop").forEach((m) => {
    if (m.id === "modalConfirm") return;
    m.addEventListener("click", (e) => { if (e.target === m) closeModal(m.id); });
  });
  document.querySelectorAll("[data-close]").forEach((b) => {
    b.onclick = () => closeModal(b.getAttribute("data-close"));
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAllModals();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      selectTab("students");
      $("searchStudent").focus();
    }
  });

  // Warn before closing tab if unsaved changes are pending
  window.addEventListener("beforeunload", (e) => {
    if (syncState.pendingChanges > 0) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  // Top Ribbon & Header
  $("btnToggleAdmin").onclick = () => {
    if (state.isAdmin) {
      state.isAdmin = false;
      state.batchMode = false;
      state.batchSelected.clear();
      rerender();
      toast("Đã khoá sổ (Chế độ Bạn Học).");
    } else {
      openUnlockModal();
    }
  };
  $("btnVerifyPin").onclick = handleUnlockSubmit;
  $("pinInput").addEventListener("keydown", (e) => { if (e.key === "Enter") handleUnlockSubmit(); });

  $("btnPushPending").onclick = () => pushNow(db, { manual: true, isAdmin: state.isAdmin });
  $("btnSyncOpen").onclick = () => { renderSyncModal(); openModal("modalSync"); };
  $("btnTheme").onclick = () => { lsSet(KEYS.THEME, isLight() ? "dark" : "light"); applyTheme(); rerender(); };
  $("btnSettings").onclick = () => { renderSettings(); openModal("modalSettings"); };

  // Tabs
  document.querySelectorAll(".tab-btn, #bottomNav button").forEach((b) => {
    b.onclick = () => selectTab(b.getAttribute("data-tab"));
  });

  // Student Search / Filter / Sort
  $("searchStudent").oninput = (e) => { state.search = e.target.value; renderStudents(getCtx(), db.sheets[state.week]); };
  $("searchStudent").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !state.isAdmin || !state.search.trim()) return;
    const q = removeTones(state.search.trim());
    const matches = db.sheets[state.week].students.filter((s) => removeTones(s.name).includes(q) || String(s.stt) === q);
    if (matches.length === 1) {
      toggleFull(matches[0].stt);
      toast(`✓ ${matches[0].name}`, "ok");
      state.search = "";
      e.target.value = "";
      renderStudents(getCtx(), db.sheets[state.week]);
    } else if (matches.length > 1) {
      toast(`Còn ${matches.length} bạn khớp, gõ thêm để chọn đúng 1 người.`);
    }
  });
  $("filterStatus").onchange = (e) => { state.filter = e.target.value; renderStudents(getCtx(), db.sheets[state.week]); };
  $("sortStudent").onchange = (e) => { state.sort = e.target.value; renderStudents(getCtx(), db.sheets[state.week]); };

  // Quick Personal Lookup
  $("quickStudentLookup").onchange = async (e) => {
    const v = Number(e.target.value);
    e.target.value = "";
    if (!v) return;
    if (privOn()) {
      const me = getMe();
      if (!me) {
        const ok = await askConfirm({
          title: "Xác nhận danh tính",
          message: `Bạn là ${NAMES[v - 1]}? Trong chế độ riêng tư, bạn chỉ xem được hồ sơ của chính mình.`,
          confirmText: "Đúng, là tôi"
        });
        if (!ok) return;
        lsSet(KEYS.ME, String(v));
        rerender();
      } else if (me !== v) {
        return toast(`🔒 Chế độ riêng tư: chỉ xem được hồ sơ của ${NAMES[me - 1]}. Đổi người trong ⚙️ Cài đặt.`, "err");
      }
    }
    openStudentProfile(getCtx(), v);
  };

  // Batch Mode Controls
  $("btnBatchMode").onclick = () => {
    if (!requireAdmin()) return;
    state.batchMode = !state.batchMode;
    state.batchSelected.clear();
    renderStudents(getCtx(), db.sheets[state.week]);
  };
  $("btnBatchSelectAll").onclick = () => {
    const sh = db.sheets[state.week];
    const unpaid = sh.students.filter((s) => s.fee > 0 && s.paid < s.fee);
    if (state.batchSelected.size === unpaid.length && unpaid.length > 0) state.batchSelected.clear();
    else unpaid.forEach((s) => state.batchSelected.add(s.stt));
    renderStudents(getCtx(), sh);
  };
  $("btnBatchPay").onclick = () => applyBatchPay(getCtx(), true);
  $("btnBatchZero").onclick = () => applyBatchPay(getCtx(), false);

  // List vs Seat View
  $("viewList").onclick = () => { state.view = "list"; state.seatPick = 0; renderStudents(getCtx(), db.sheets[state.week]); };
  $("viewSeat").onclick = () => { state.view = "seat"; state.batchMode = false; renderStudents(getCtx(), db.sheets[state.week]); };
  document.querySelectorAll(".seat-mode").forEach((b) => {
    b.onclick = () => { state.seatMode = b.getAttribute("data-seatmode"); state.seatPick = 0; renderSeat(getCtx(), db.sheets[state.week]); };
  });
  $("seatReset").onclick = async () => {
    if (!requireAdmin()) return;
    const ok = await askConfirm({ title: "Đặt lại sơ đồ lớp", message: "Khôi phục sơ đồ chỗ ngồi về vị trí gốc?", danger: true });
    if (!ok) return;
    saveDb(true);
    db.seatMap = cloneSeat(SEAT_DEFAULT);
    logAct("sys", "Đặt lại sơ đồ lớp về bản gốc");
    saveDb(false);
    rerender();
    toast("Đã khôi phục sơ đồ gốc!", "ok");
  };

  // Delegated clicks inside dynamic containers
  document.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-profile],[data-qr-week],[data-qr-extra],[data-toggle-full],[data-toggle-extra],[data-edit-pay],[data-edit-extra],[data-pay-all-debt],[data-seat-tap],[data-seat-empty],[data-view-receipt],[data-edit-tx],[data-del-tx],[data-restore-trash],[data-purge-trash],[data-restore-extra],[data-prof-edit-week],#btnOpenGoalModal,#btnOpenBudgetModal");
    if (!t) return;

    if (t.matches("[data-profile]")) return openStudentProfile(getCtx(), Number(t.getAttribute("data-profile")));
    if (t.matches("[data-qr-week]")) {
      const stt = Number(t.getAttribute("data-qr-week"));
      if (!canSee(stt)) return;
      const sh = db.sheets[state.week], s = sh.students[stt - 1];
      return openQR(db, NAMES[stt - 1], Math.max(s.fee - s.paid, 0), sh.weekLabel);
    }
    if (t.matches("[data-qr-extra]")) {
      const stt = Number(t.getAttribute("data-qr-extra"));
      if (!canSee(stt)) return;
      const it = db.extra.items[stt - 1];
      return openQR(db, NAMES[stt - 1], Math.max(it.due - it.paid, 0), db.extra.title);
    }
    if (t.matches("[data-toggle-full]")) return toggleFull(Number(t.getAttribute("data-toggle-full")));
    if (t.matches("[data-toggle-extra]")) return toggleExtraFull(Number(t.getAttribute("data-toggle-extra")));
    if (t.matches("[data-edit-pay]")) return openPayModal("week", Number(t.getAttribute("data-edit-pay")), t.getAttribute("data-sheet"));
    if (t.matches("[data-edit-extra]")) return openPayModal("extra", Number(t.getAttribute("data-edit-extra")));
    if (t.matches("[data-pay-all-debt]")) return payAllDebtOfStudent(getCtx(), Number(t.getAttribute("data-pay-all-debt")));
    if (t.matches("[data-seat-tap]")) return seatTap(Number(t.getAttribute("data-seat-tap")));
    if (t.matches("[data-seat-empty]")) {
      const [c, r] = t.getAttribute("data-seat-empty").split(",").map(Number);
      return seatEmpty(c, r);
    }
    if (t.matches("[data-view-receipt]")) return openReceiptModal(t.getAttribute("data-view-receipt"));
    if (t.matches("[data-edit-tx]")) return openTxModal(getCtx(), Number(t.getAttribute("data-edit-tx")));
    if (t.matches("[data-del-tx]")) {
      if (!requireAdmin()) return;
      const id = Number(t.getAttribute("data-del-tx"));
      const sh = db.sheets[state.week];
      const tx = sh.transactions.find((x) => x.id === id && !x.auto);
      if (!tx) return;
      const ok = await askConfirm({
        title: "Xoá giao dịch",
        message: `Xoá ${tx.type === "Chi" ? "khoản chi" : "khoản thu"} “${tx.category}” (${money(tx.amount)})? Bạn có thể khôi phục trong tab Lịch sử.`,
        confirmText: "Xoá giao dịch",
        danger: true
      });
      if (!ok) return;
      saveDb(true);
      db.trash.unshift({ t: Date.now(), sheet: state.week, tx: JSON.parse(JSON.stringify(tx)) });
      if (db.trash.length > 50) db.trash.length = 50;
      sh.transactions = sh.transactions.filter((x) => x.id !== id || x.auto);
      logAct("tx", `Xoá ${tx.type === "Chi" ? "khoản chi" : "khoản thu"} “${tx.category}” ${money(tx.amount)} (${sh.weekLabel})`);
      saveDb(false);
      rerender();
      toast("Đã chuyển vào thùng rác!");
      return;
    }
    if (t.matches("[data-restore-trash]")) {
      if (!requireAdmin()) return;
      const i = Number(t.getAttribute("data-restore-trash"));
      const x = db.trash[i];
      if (!x || !db.sheets[x.sheet]) return;
      saveDb(true);
      const tx = x.tx;
      if (db.sheets[x.sheet].transactions.some((y) => y.id === tx.id)) tx.id = Date.now();
      db.sheets[x.sheet].transactions.push(tx);
      db.trash.splice(i, 1);
      logAct("tx", `Khôi phục giao dịch “${tx.category}” ${money(tx.amount)}`);
      saveDb(false);
      rerender();
      toast("Đã khôi phục giao dịch!", "ok");
      return;
    }
    if (t.matches("[data-purge-trash]")) {
      if (!requireAdmin()) return;
      const ok = await askConfirm({ title: "Xoá vĩnh viễn", message: "Giao dịch này sẽ bị xoá hẳn khỏi thùng rác?", danger: true });
      if (!ok) return;
      saveDb(true);
      db.trash.splice(Number(t.getAttribute("data-purge-trash")), 1);
      saveDb(false);
      rerender();
      return;
    }
    if (t.matches("[data-restore-extra]")) {
      if (!requireAdmin()) return;
      const idx = Number(t.getAttribute("data-restore-extra"));
      const arch = db.extraHistory[idx];
      if (!arch) return;
      const ok = await askConfirm({
        title: `Mở lại đợt “${arch.title}”`,
        message: `Đợt hiện tại (“${db.extra.title}”) sẽ được chuyển xuống lịch sử lưu trữ.`
      });
      if (!ok) return;
      saveDb(true);
      const cur = JSON.parse(JSON.stringify(db.extra));
      cur.closedAt = Date.now();
      db.extra = { title: arch.title, items: arch.items };
      db.extraHistory.splice(idx, 1);
      db.extraHistory.unshift(cur);
      logAct("sys", `Mở lại đợt thu phụ “${arch.title}”`);
      saveDb(false);
      rerender();
      toast("Đã chuyển đợt thu phụ!", "ok");
      return;
    }
    if (t.matches("[data-prof-edit-week]")) {
      closeModal("modalProfile");
      return openPayModal("week", Number(t.getAttribute("data-stt")), t.getAttribute("data-prof-edit-week"));
    }
    if (t.id === "btnOpenGoalModal") {
      if (!requireAdmin()) return;
      const g = db.goal || { title: "", target: 2000000, deadline: "" };
      $("goalTitleInput").value = g.title || "";
      $("goalTargetInput").value = g.target || 2000000;
      $("goalDeadlineInput").value = g.deadline || "";
      return openModal("modalGoal");
    }
    if (t.id === "btnOpenBudgetModal") {
      if (!requireAdmin()) return;
      $("budgetMonthlyInput").value = db.budget.monthly || 1000000;
      return openModal("modalBudget");
    }
  });

  // Batch checkboxes change delegation
  $("studentList").addEventListener("change", (e) => {
    if (!e.target.classList.contains("batch-chk")) return;
    const stt = Number(e.target.getAttribute("data-stt"));
    if (e.target.checked) state.batchSelected.add(stt);
    else state.batchSelected.delete(stt);
    $("batchCountText").textContent = `Đã chọn ${state.batchSelected.size} bạn`;
    $("btnBatchPay").disabled = state.batchSelected.size === 0;
    $("btnBatchZero").disabled = state.batchSelected.size === 0;
  });

  // Pay Modal
  $("btnSavePay").onclick = savePay;
  $("payInput").addEventListener("keydown", (e) => { if (e.key === "Enter") savePay(); });
  $("btnPayFillFull").onclick = () => {
    const c = state.payContext;
    if (!c) return;
    $("payInput").value = c.mode === "extra"
      ? db.extra.items[c.stt - 1].due
      : (Number($("payFee").value) || db.sheets[c.sheetKey].students[c.stt - 1].fee);
  };
  document.querySelectorAll("[data-quick-amt]").forEach((b) => {
    b.onclick = () => { $("payInput").value = b.getAttribute("data-quick-amt"); };
  });

  // Week Admin Modals (Zero browser prompt!)
  $("btnNewWeek").onclick = () => openNewWeekModal(getCtx());
  $("btnConfirmNewWeek").onclick = () => confirmNewWeek(getCtx());

  const openEditWeek = () => {
    if (!requireAdmin()) return;
    const sh = db.sheets[state.week];
    $("ewFee").value = sh.weeklyFee || 20000;
    $("ewPeriod").value = sh.period || "";
    const isFirst = allSheets(db)[0] === state.week;
    $("ewOpeningWrap").classList.toggle("hidden", !isFirst);
    $("ewOpening").value = sh.opening || 0;
    openModal("modalEditWeek");
  };
  $("btnEditWeek").onclick = openEditWeek;
  $("btnEditOpening").onclick = openEditWeek;
  $("btnSaveEditWeek").onclick = () => {
    if (!requireAdmin()) return;
    const sh = db.sheets[state.week];
    const newFee = Math.max(Number($("ewFee").value) || 0, 0);
    const newPer = $("ewPeriod").value.trim();
    const isFirst = allSheets(db)[0] === state.week;
    saveDb(true);
    if (newFee > 0 && newFee !== sh.weeklyFee) {
      logAct("sys", `Đổi mức đóng ${sh.weekLabel}: ${money(sh.weeklyFee)} → ${money(newFee)}`);
      sh.weeklyFee = newFee;
      sh.students.forEach((s) => { if (!s.exempt) s.fee = newFee; });
    }
    sh.period = newPer;
    if (isFirst) {
      const op = Number($("ewOpening").value);
      if (Number.isFinite(op) && op !== sh.opening) {
        logAct("sys", `Sửa số dư đầu kỳ → ${money(op)}`);
        sh.opening = op;
      }
    }
    saveDb(false);
    closeModal("modalEditWeek");
    rerender();
    toast("Đã lưu thông tin tuần!", "ok");
  };

  $("btnMarkAll").onclick = async () => {
    if (!requireAdmin()) return;
    const sh = db.sheets[state.week];
    const ok = await askConfirm({
      title: `Nộp đủ cả lớp (${sh.weekLabel})`,
      message: "Đánh dấu tất cả 45 học sinh đã nộp đủ mức đóng của tuần này?"
    });
    if (!ok) return;
    saveDb(true);
    sh.students.forEach((s) => { s.paid = s.fee; });
    logAct("pay", `Đánh dấu cả lớp nộp đủ ${sh.weekLabel}`);
    saveDb(false);
    rerender();
    toast("🎉 Đã đánh dấu cả lớp đủ!", "ok");
  };

  // Extra Campaign Modal
  $("btnNewExtra").onclick = () => {
    if (!requireAdmin()) return;
    $("newExtraTitle").value = "";
    $("newExtraAmount").value = "50000";
    openModal("modalNewExtra");
  };
  $("btnSaveNewExtra").onclick = () => {
    if (!requireAdmin()) return;
    const title = $("newExtraTitle").value.trim().slice(0, 60);
    const amt = Math.max(Number($("newExtraAmount").value) || 0, 0);
    if (!title || !amt) return toast("Nhập tên đợt thu và số tiền hợp lệ!", "err");
    saveDb(true);
    // Archive previous extra campaign if it had any due > 0
    if (db.extra && db.extra.items.some((x) => x.due > 0)) {
      db.extraHistory = db.extraHistory || [];
      db.extraHistory.unshift({ title: db.extra.title, closedAt: Date.now(), items: JSON.parse(JSON.stringify(db.extra.items)) });
      if (db.extraHistory.length > 20) db.extraHistory.length = 20;
    }
    db.extra = { title, items: NAMES.map((name, i) => ({ stt: i + 1, name, due: amt, paid: 0 })) };
    logAct("sys", `Tạo đợt thu phụ “${title}” (${money(amt)}/bạn)`);
    saveDb(false);
    closeModal("modalNewExtra");
    rerender();
    toast(`Đã tạo đợt thu phụ “${title}”!`, "ok");
  };

  // Ledger Events
  $("searchTx").oninput = (e) => { state.txSearch = e.target.value; renderLedger(getCtx(), db.sheets[state.week]); };
  $("filterTxType").onchange = (e) => { state.txFilter = e.target.value; renderLedger(getCtx(), db.sheets[state.week]); };
  $("btnAddTx").onclick = () => openTxModal(getCtx(), null);
  $("typeThu").onclick = () => setTxTypeUI(state, "Thu");
  $("typeChi").onclick = () => setTxTypeUI(state, "Chi");
  $("btnSaveTx").onclick = () => saveTxFromModal(getCtx());

  // Log Filter
  $("searchLog").oninput = (e) => { state.logSearch = e.target.value; renderLog(getCtx()); };
  $("filterLog").onchange = (e) => { state.logFilter = e.target.value; renderLog(getCtx()); };

  // Bank Settings Modal
  $("btnBank").onclick = () => {
    if (!requireAdmin()) return;
    ensureBank(db);
    $("bankIdInput").value = db.bank.bankId;
    $("bankAccInput").value = db.bank.accountNo;
    $("bankNameInput").value = db.bank.accountName;
    openModal("modalBank");
  };
  $("btnSaveBank").onclick = () => {
    if (!requireAdmin()) return;
    const b = $("bankIdInput").value.replace(/\s+/g, "").toUpperCase();
    const a = $("bankAccInput").value.replace(/\s+/g, "");
    const h = removeTones($("bankNameInput").value.trim()).toUpperCase().replace(/[^A-Z0-9 ]/g, "");
    if (!/^[A-Z0-9]{2,12}$/.test(b) || !/^[A-Za-z0-9]{4,24}$/.test(a) || h.length < 2) {
      return toast("Thông tin ngân hàng chưa hợp lệ!", "err");
    }
    saveDb(true);
    db.bank = { bankId: b, accountNo: a, accountName: h.slice(0, 40) };
    logAct("sys", "Cập nhật thông tin tài khoản VietQR");
    saveDb(false);
    closeModal("modalBank");
    toast("Đã lưu thông tin VietQR!", "ok");
  };

  // Goal & Budget Modals
  $("btnSaveGoal").onclick = () => {
    if (!requireAdmin()) return;
    const t = $("goalTitleInput").value.trim().slice(0, 60);
    const a = Number($("goalTargetInput").value);
    const d = $("goalDeadlineInput").value.trim();
    if (!t || !(a > 0)) return toast("Nhập tên mục tiêu và số tiền > 0!", "err");
    if (d && !parseDMY(d)) return toast("Hạn chót phải có dạng dd/mm/yyyy (VD: 25/05/2027).", "err");
    saveDb(true);
    db.goal = { title: t, target: a, deadline: d };
    logAct("sys", `Đặt mục tiêu “${t}” ${money(a)}`);
    saveDb(false);
    closeModal("modalGoal");
    rerender();
    toast("Đã lưu mục tiêu quỹ!", "ok");
  };
  $("btnClearGoal").onclick = () => {
    if (!requireAdmin()) return;
    saveDb(true);
    db.goal = null;
    logAct("sys", "Xoá mục tiêu quỹ");
    saveDb(false);
    closeModal("modalGoal");
    rerender();
    toast("Đã xoá mục tiêu.");
  };
  $("btnSaveBudget").onclick = () => {
    if (!requireAdmin()) return;
    const v = Math.max(Number($("budgetMonthlyInput").value) || 0, 0);
    saveDb(true);
    db.budget.monthly = v;
    logAct("sys", `Đặt hạn mức chi tháng: ${money(v)}`);
    saveDb(false);
    closeModal("modalBudget");
    rerender();
    toast("Đã lưu hạn mức chi tháng!", "ok");
  };

  // Zalo Reminder Text Builders
  $("btnZaloWeek").onclick = () => {
    const sh = db.sheets[state.week];
    const d = sh.students.filter((s) => s.paid < s.fee);
    $("zaloText").value = d.length
      ? `📢 NHẮC QUỸ ${sh.weekLabel.toUpperCase()} - 12A6\n\n` + d.map((s, i) => `${i + 1}. ${s.name} — thiếu ${money(s.fee - s.paid)}`).join("\n") + bankLine(db)
      : "Cả lớp đã nộp đủ 100%! 🎉";
    openModal("modalZalo");
  };
  $("btnZaloMatrix").onclick = () => {
    const cols = allSheets(db);
    const lines = ["📢 TỔNG HỢP NỢ QUỸ LŨY KẾ 12A6", ""];
    let any = false;
    NAMES.forEach((n, i) => {
      const parts = [];
      let sum = 0;
      cols.forEach((k) => {
        const s = db.sheets[k].students[i];
        const o = Math.max(s.fee - s.paid, 0);
        if (o > 0) { sum += o; parts.push(db.sheets[k].weekLabel); }
      });
      const exO = Math.max(db.extra.items[i].due - db.extra.items[i].paid, 0);
      if (exO > 0) { sum += exO; parts.push(db.extra.title); }
      if (sum > 0) { any = true; lines.push(`- ${n}: ${money(sum)} (${parts.join(", ")})`); }
    });
    $("zaloText").value = any ? lines.join("\n") + bankLine(db) : "Cả lớp không còn nợ! 🎉";
    openModal("modalZalo");
  };
  $("btnZaloExtra").onclick = () => {
    const d = db.extra.items.filter((x) => x.paid < x.due);
    $("zaloText").value = d.length
      ? `📢 NHẮC KHOẢN PHỤ ${db.extra.title.toUpperCase()} - 12A6\n\n` + d.map((s, i) => `${i + 1}. ${s.name} — thiếu ${money(s.due - s.paid)}`).join("\n") + bankLine(db)
      : "Cả lớp đã đóng đủ 100%! 🎉";
    openModal("modalZalo");
  };
  $("btnCopyZalo").onclick = () => copyText($("zaloText").value, "Đã sao chép tin nhắn Zalo!");

  // Undo, Recon, Report, Excel
  $("btnUndo").onclick = () => {
    if (!requireAdmin() || !undoStack.length) return;
    db = JSON.parse(undoStack.pop());
    $("btnUndo").disabled = !undoStack.length;
    saveDb(false);
    rerender();
    toast("Đã hoàn tác!");
  };
  $("btnBankRecon").onclick = () => { if (!requireAdmin()) return; $("reconResult").innerHTML = ""; openModal("modalRecon"); };
  $("btnReconParse").onclick = () => runReconParse(getCtx());
  $("btnReport").onclick = () => { if (!requireAdmin()) return; openModal("modalReport"); drawReport(db, state); };
  $("repNames").onchange = () => drawReport(db, state);
  $("repLight").onchange = () => drawReport(db, state);
  const reportBlob = () => new Promise((res) => $("reportCanvas").toBlob((b) => res(b), "image/png"));
  $("btnRepSave").onclick = async () => {
    const b = await reportBlob();
    if (!b) return toast("Không tạo được ảnh!", "err");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b);
    a.download = `BAO_CAO_${db.sheets[state.week].weekLabel.replace(/\s+/g, "_")}_${localISO()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    toast("Đã tải ảnh báo cáo!", "ok");
  };
  $("btnRepShare").onclick = async () => {
    const b = await reportBlob();
    if (!b) return toast("Không tạo được ảnh!", "err");
    const f = new File([b], "bao-cao-quy-12a6.png", { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [f] })) {
      navigator.share({ files: [f], title: "Báo cáo quỹ lớp 12A6" }).catch(() => {});
    } else {
      $("btnRepSave").click();
    }
  };
  $("btnData").onclick = () => exportExcel(db);

  // Settings Modal Controls
  $("setPrivacy").onchange = (e) => {
    if (!requireAdmin()) { e.target.checked = Boolean(db.privacy); return; }
    saveDb(true);
    db.privacy = e.target.checked;
    logAct("sys", `Chế độ riêng tư: ${db.privacy ? "BẬT" : "TẮT"}`);
    saveDb(false);
    rerender();
  };
  $("btnClearMe").onclick = () => {
    lsDel(KEYS.ME);
    renderSettings();
    rerender();
    toast("Đã bỏ chọn tên của bạn.");
  };
  $("btnChangePinOpen").onclick = () => {
    if (!requireAdmin()) return;
    $("oldPinInput").value = "";
    $("newPinInput").value = "";
    $("newPinConfirm").value = "";
    closeModal("modalSettings");
    openModal("modalChangePin");
  };
  $("btnSaveNewPin").onclick = async () => {
    if (!requireAdmin()) return;
    const oldP = $("oldPinInput").value.trim();
    const newP = $("newPinInput").value.trim();
    const cfm = $("newPinConfirm").value.trim();
    if (newP.length < 4) return toast("Mã PIN mới phải từ 4 ký tự trở lên!", "err");
    if (newP !== cfm) return toast("Xác nhận mã PIN mới không khớp!", "err");
    const okOld = await verifyAdminPin(oldP, db.adminPinHash || "");
    if (!okOld) return toast("Mã PIN hiện tại không đúng!", "err");
    saveDb(true);
    db.adminPinHash = await hashPin(newP);
    logAct("sys", "Thay đổi mã PIN Thủ Quỹ");
    saveDb(false);
    closeModal("modalChangePin");
    toast("🔐 Đã đổi mã PIN Thủ Quỹ thành công!", "ok");
  };

  /* ---------- Sync Modal Actions (Token Vault + Worker + Direct + Pairing) ---------- */
  const readSyncInputs = async () => {
    const o = $("ghOwner").value.trim();
    const r = $("ghRepo").value.trim().replace(/\.git$/, "");
    const t = $("ghToken").value.trim();
    if (o) syncState.owner = o;
    if (r) syncState.repo = r;
    if (t) {
      if (!/^[A-Za-z0-9_]+$/.test(t)) {
        toast("Token GitHub không hợp lệ!", "err");
        return false;
      }
      syncState.token = t;
    }
    await saveSyncConfig();
    updateAlerts();
    if (!ghReady()) { toast("Tên tài khoản / repo không hợp lệ!", "err"); return false; }
    return true;
  };

  $("vaultPw").oninput = (e) => {
    const st = evaluatePasswordStrength(e.target.value);
    const bar = $("vaultPwMeter");
    bar.style.width = `${st.pct}%`;
    bar.style.background = st.color;
    $("vaultPwLabel").textContent = st.label;
    $("vaultPwLabel").style.color = st.color;
  };

  $("btnVaultCreate").onclick = async () => {
    if (!requireAdmin()) return;
    if (!(await readSyncInputs())) return;
    if (!syncState.token) return toast("Hãy dán GitHub Token ở mục bên dưới trước khi tạo Két!", "err");
    const pw = $("vaultPw").value.trim();
    const st = evaluatePasswordStrength(pw);
    if (!st.ok) return toast("Mật khẩu Két cần dài tối thiểu 8 ký tự để đảm bảo an toàn!", "err");

    const btn = $("btnVaultCreate");
    btn.disabled = true;
    btn.textContent = "⏳ Đang mã hóa AES-256 & lưu…";
    try {
      await publishEncryptedVault(pw, $("vaultHint").value.trim());
      $("vaultPw").value = "";
      renderSyncModal();
      toast("🔐 Đã lưu Két Token mã hóa (vault.json) vào repo! Từ nay mọi thiết bị chỉ cần Mật khẩu Két.", "ok");
    } catch (e) {
      toast(`Không tạo được Két: ${netMsg(e)}`, "err");
    } finally {
      btn.disabled = false;
      btn.textContent = "🔐 Mã hóa & Lưu Két lên Repo";
    }
  };

  $("btnVaultUnlock").onclick = async () => {
    const pw = $("vaultUnlockPw").value.trim();
    if (!pw) return toast("Nhập mật khẩu Két Token!", "err");
    const btn = $("btnVaultUnlock");
    btn.disabled = true;
    btn.textContent = "Đang giải mã…";
    try {
      await unlockRemoteVault(pw);
      state.isAdmin = true;
      $("vaultUnlockPw").value = "";
      renderSyncModal();
      rerender();
      toast("🔓 Đã mở Két Token & tự động kết nối máy này!", "ok");
    } catch (e) {
      toast(netMsg(e), "err");
    } finally {
      btn.disabled = false;
      btn.textContent = "🔓 Mở Két Token";
    }
  };

  $("btnTestConn").onclick = async () => {
    if (!(await readSyncInputs())) return;
    const btn = $("btnTestConn");
    btn.disabled = true;
    btn.textContent = "Đang kiểm tra…";
    try {
      const res = await testConnection();
      toast(`✅ ${res.detail}`, "ok");
      renderSyncModal();
    } catch (e) {
      toast(`❌ ${netMsg(e)}`, "err");
    } finally {
      btn.disabled = false;
      btn.textContent = "🩺 Kiểm tra kết nối";
    }
  };

  $("btnClearToken").onclick = async () => {
    const ok = await askConfirm({
      title: "Xoá Token khỏi máy này?",
      message: "Chỉ xoá Token lưu trên trình duyệt này (Két Token trên repo vẫn giữ nguyên).",
      confirmText: "Xoá khỏi máy này",
      danger: true
    });
    if (!ok) return;
    await clearLocalToken();
    renderSyncModal();
    updateAlerts();
    toast("Đã xoá Token khỏi thiết bị này.");
  };

  $("btnSaveWorker").onclick = async () => {
    const url = $("workerUrlInput").value.trim().replace(/\/+$/, "");
    if (url && !/^https:\/\/[a-z0-9.-]+/i.test(url)) {
      return toast("URL Worker phải bắt đầu bằng https://", "err");
    }
    syncState.workerUrl = url;
    if (!url) syncState.workerSession = "";
    await saveSyncConfig();
    renderSyncModal();
    toast(url ? "✅ Đã lưu Cloudflare Worker URL!" : "Đã tắt Worker Proxy.", "ok");
  };

  $("btnCreatePair").onclick = async () => {
    if (!requireAdmin()) return;
    if (!syncState.token && !syncState.workerUrl) return toast("Máy này chưa có Token để ghép nối!", "err");
    const { code, url } = await createPairingLink(syncState);
    $("pairCodeDisplay").textContent = code;
    $("pairUrlInput").value = url;
    $("pairResultBox").classList.remove("hidden");
    toast("Đã tạo link ghép máy (hiệu lực 15 phút)!", "ok");
  };
  $("btnCopyPairUrl").onclick = () => copyText($("pairUrlInput").value, "Đã copy link ghép máy! Gửi qua Zalo Cloud của bạn rồi mở trên điện thoại.");

  $("btnPairAccept").onclick = async () => {
    const code = $("pairAcceptCode").value.trim();
    if (!/^\d{6}$/.test(code)) return toast("Nhập đủ 6 chữ số mã ghép nối!", "err");
    try {
      const cfg = await decodePairingHash(pendingPairHash, code);
      syncState.owner = cfg.owner || syncState.owner;
      syncState.repo = cfg.repo || syncState.repo;
      syncState.token = cfg.token || "";
      syncState.workerUrl = cfg.workerUrl || syncState.workerUrl;
      await saveSyncConfig();
      state.isAdmin = true;
      closeModal("modalPairAccept");
      rerender();
      toast("🎉 Ghép nối thành công! Máy này đã sẵn sàng đồng bộ.", "ok");
    } catch (e) {
      toast(netMsg(e), "err");
    }
  };

  $("btnGhPush").onclick = async () => {
    if (!requireAdmin()) return;
    if (!(await readSyncInputs())) return;
    saveDb(false);
    await pushNow(db, { manual: true, isAdmin: true });
    renderSyncModal();
  };

  $("btnGhPull").onclick = async () => {
    if (!(await readSyncInputs())) return;
    if (state.isAdmin) {
      const ok = await askConfirm({
        title: "Tải lại từ GitHub?",
        message: "Dữ liệu trên máy này sẽ được thay bằng bản mới nhất từ GitHub."
      });
      if (!ok) return;
    }
    await pullLatest(db, { force: true, silent: false, isAdmin: state.isAdmin });
  };

  // Offline Backup / Restore / Sync Code
  const acceptNewDb = (p, msg) => {
    if (!validDb(p)) return toast("File dữ liệu không hợp lệ hoặc bị hỏng!", "err");
    saveDb(true);
    db = normalizeDb(p);
    logAct("sys", "Khôi phục toàn bộ dữ liệu từ bản sao lưu");
    saveDb(false);
    closeModal("modalSync");
    rerender();
    toast(msg, "ok");
  };

  $("btnBackup").onclick = () => {
    if (!requireAdmin()) return;
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `SAO_LUU_QUY_12A6_${localISO()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    lsSet(KEYS.BACKUP, String(Date.now()));
    updateAlerts();
    toast("💾 Đã tải file sao lưu JSON!", "ok");
  };
  $("btnRestore").onclick = () => { if (requireAdmin()) $("fileRestore").click(); };
  $("fileRestore").onchange = (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f || !requireAdmin()) return;
    const r = new FileReader();
    r.onload = async () => {
      let p = null;
      try { p = JSON.parse(r.result); } catch { return toast("Không đọc được file JSON!", "err"); }
      const ok = await askConfirm({ title: "Khôi phục từ file", message: "Toàn bộ dữ liệu hiện tại sẽ được thay bằng nội dung file này?", danger: true });
      if (ok) acceptNewDb(p, "Đã khôi phục dữ liệu từ file!");
    };
    r.readAsText(f);
  };
  $("btnCopyToken").onclick = () => copyText($("syncTokenBox").value, "Đã sao chép mã đồng bộ offline!");
  $("btnLoadToken").onclick = () => {
    if (!requireAdmin()) return;
    const raw = $("syncTokenBox").value.trim();
    let p = null;
    try { p = JSON.parse(raw.charAt(0) === "{" ? raw : decodeURIComponent(escape(atob(raw)))); }
    catch { return toast("Mã đồng bộ không hợp lệ!", "err"); }
    acceptNewDb(p, "Đã nạp dữ liệu đồng bộ!");
  };

  // Auto-refresh every 2 minutes for viewers (zero GitHub API rate limit!)
  setInterval(() => {
    if (!state.isAdmin && !document.hidden) pullLatest(db, { force: false, silent: true, isAdmin: false });
  }, 120000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !state.isAdmin) pullLatest(db, { force: false, silent: true, isAdmin: false });
  });
}

/* ---------- Boot Sequence ---------- */
async function boot() {
  initLocalDb();
  applyTheme();

  configureSyncCallbacks({
    onData: (cleanDb) => {
      db = cleanDb;
      try { localStorage.setItem(KEYS.DB, JSON.stringify(db)); } catch {}
      rerender();
    },
    onUi: () => updateAlerts()
  });

  bindEvents();
  selectTab("students");
  rerender();

  await initSyncConfig();
  checkPairingHash();
  await Promise.all([
    pullLatest(db, { force: false, silent: true, isAdmin: false }),
    checkRemoteVault()
  ]);
  updateAlerts();

  // Register PWA Service Worker
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

boot();
