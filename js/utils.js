/* ==========================================================================
   utils.js — Formatting, Dates, Strings, Storage, Clipboard, Toasts, Modals
   ========================================================================== */

export const $ = (id) => document.getElementById(id);

export function lsGet(k, d = "") {
  try {
    const v = localStorage.getItem(k);
    return v == null ? d : v;
  } catch {
    return d;
  }
}

export function lsSet(k, v) {
  try {
    localStorage.setItem(k, v);
    return true;
  } catch {
    return false;
  }
}

export function lsDel(k) {
  try { localStorage.removeItem(k); } catch {}
}

export function pad(n) {
  return (n < 10 ? "0" : "") + n;
}

export function localISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fmtDM(d) {
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}

export function fmtDMY(d) {
  return `${fmtDM(d)}/${d.getFullYear()}`;
}

export function money(n) {
  return `${(Number(n) || 0).toLocaleString("vi-VN")}đ`;
}

export function fmtK(n) {
  n = Number(n) || 0;
  return n % 1000 === 0 ? `${n / 1000}k` : money(n);
}

export function removeTones(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

export function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

export function parsePeriodEnd(p) {
  const m = String(p || "").match(/(\d{1,2})\/(\d{1,2})\s*-\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? new Date(+m[5], +m[4] - 1, +m[3]) : null;
}

export function nextPeriod(p) {
  const end = parsePeriodEnd(p);
  if (!end) return "";
  const s = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1);
  const e = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 7);
  return `${fmtDM(s)} - ${fmtDM(e)}/${e.getFullYear()}`;
}

export function parseDMY(s) {
  const m = String(s || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
}

export function toInputDate(s) {
  const m = String(s || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${pad(+m[2])}-${pad(+m[1])}` : localISO();
}

export function fromInputDate(s) {
  const p = String(s || "").split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : "";
}

export function fmtTime(t) {
  const d = new Date(t);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function nowStr() {
  return new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

export function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function b64enc(str) {
  const bytes = new TextEncoder().encode(str);
  let out = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  }
  return btoa(out);
}

export function b64dec(b64) {
  const bin = atob(String(b64 || "").replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export async function copyText(text, successMsg = "Đã sao chép!") {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      toast(successMsg, "ok");
      return true;
    }
  } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;left:-9999px;top:0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    toast(successMsg, "ok");
    return true;
  } catch {
    toast("Không thể sao chép tự động, hãy chọn và copy thủ công.", "err");
    return false;
  }
}

export function toast(msg, type = "info") {
  const w = $("toastWrap");
  if (!w) return;
  const d = document.createElement("div");
  d.className = `toast-item ${type}`;
  d.textContent = msg;
  w.appendChild(d);
  setTimeout(() => {
    d.style.opacity = "0";
    d.style.transition = "opacity 0.2s";
    setTimeout(() => d.remove(), 220);
  }, 3100);
}

export function openModal(id) {
  const el = $(id);
  if (el) {
    el.classList.remove("hidden");
    const focusable = el.querySelector("input:not([type=hidden]):not([disabled]), textarea, select");
    if (focusable) setTimeout(() => focusable.focus(), 40);
  }
}

export function closeModal(id) {
  const el = $(id);
  if (el) el.classList.add("hidden");
}

export function closeAllModals() {
  document.querySelectorAll(".modal-backdrop").forEach((m) => m.classList.add("hidden"));
}

/* Custom sleek in-app Confirm Dialog (replaces ugly browser confirm()) */
let confirmResolver = null;
export function askConfirm({ title = "Xác nhận", message = "", confirmText = "Xác nhận", danger = false } = {}) {
  return new Promise((resolve) => {
    confirmResolver = resolve;
    $("confirmTitle").textContent = title;
    $("confirmMsg").textContent = message;
    const okBtn = $("btnConfirmOk");
    okBtn.textContent = confirmText;
    okBtn.className = `btn flex-1 ${danger ? "btn-rose" : "btn-primary"}`;
    openModal("modalConfirm");
  });
}

export function initConfirmDialog() {
  const finish = (val) => {
    closeModal("modalConfirm");
    if (confirmResolver) {
      const r = confirmResolver;
      confirmResolver = null;
      r(val);
    }
  };
  $("btnConfirmOk").onclick = () => finish(true);
  $("btnConfirmCancel").onclick = () => finish(false);
  $("modalConfirm").addEventListener("click", (e) => {
    if (e.target === $("modalConfirm")) finish(false);
  });
}

export function setMoneyAnimated(id, n, fxEnabled) {
  const el = $(id);
  if (!el) return;
  const prev = el.dataset.v;
  el.dataset.v = String(n);
  if (prev === undefined || Number(prev) === n || !fxEnabled || !window.requestAnimationFrame) {
    el.textContent = money(n);
    return;
  }
  const from = Number(prev);
  const t0 = performance.now();
  const dur = 480;
  if (el._raf) cancelAnimationFrame(el._raf);
  const step = (t) => {
    const k = Math.min((t - t0) / dur, 1);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = money(Math.round(from + (n - from) * e));
    if (k < 1) el._raf = requestAnimationFrame(step);
    else el.textContent = money(n);
  };
  el._raf = requestAnimationFrame(step);
}
