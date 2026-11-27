/* ==========================================================================
   config.js — Constants, Student Roster, Initial DB & Schema Validation
   100% backward-compatible with data.json & quy12a6-zalo-bot
   ========================================================================== */

export const APP_VERSION = "3.0.0";
export const MAIN_SHEET = "SỔ CHÍNH";
export const DATA_FILE = "data.json";
export const VAULT_FILE = "vault.json";

export const KEYS = {
  THEME: "QUY_12A6_THEME",
  FX: "QUY_12A6_FX",
  ME: "QUY_12A6_ME",
  DB: "QUY_12A6_PORTAL_V5",
  BACKUP: "QUY_12A6_LASTBACKUP",
  CELEB: "QUY_12A6_CELEB",
  GH: "QUY_12A6_GH",
  ADMIN_SESSION: "QUY_12A6_ADMIN_SESS"
};

// Default GitHub repo (auto-detected on github.io, falls back to GrenDyui/quy12a6)
export const DEFAULT_REPO = {
  owner: "GrenDyui",
  repo: "quy12a6",
  branch: "main",
  // Optional: If you deploy worker/cloudflare-worker.js, paste its URL here so every device connects automatically!
  workerUrl: ""
};

// Legacy Admin PIN (PBKDF2-SHA256, 200,000 iters) — preserved so existing Treasurer PIN works immediately
export const LEGACY_PIN_SALT = "12A6-quy-salt-v1";
export const LEGACY_PIN_HASH = "2bcdd961d2e1bbae6e2606169bfe8c0ea0aa8ceb2e9241f837c8c0a850fcba72";

export const NAMES = [
  "Cao Thị Kim Anh","Nguyễn Trâm Anh","Võ Thị Bảo Anh","Trần Công Bằng","Hồ Thị Châu",
  "Ngô Xuân Diệu","Huỳnh Quốc Duy","Huỳnh Thị Mỹ Duyên","Huỳnh Thị Anh Đào","Phạm Tiến Đạt",
  "Nguyễn Huỳnh Tú Hảo","Trần Ngọc Hân","Nguyễn Trung Hòa","Lại Gia Hưng","Nguyễn Quốc Huy",
  "Lê Thái Khang","Nguyễn Gia Khiêm","Nguyễn Hữu Khôi","Nguyễn Trần Phương Linh","Lưu Trần Bích Ly",
  "Trà Hoài Nam","Đào Tâm Nghi","Lê Huỳnh Mỹ Ngọc","Trần Lý Khánh Ngọc","Trần Ngọc Như Nguyện",
  "Trần Huỳnh Nhi","Nguyễn Quỳnh Như","Huỳnh Hồng Phi","Trần Nghi Phương","Trần Đang Quyền Qui",
  "Phan Thế Sơn","Nguyễn Hữu Thanh","Lê Thị Ngọc Thảo","Nguyễn Ngọc Kim Thơ","Trương Minh Thuận",
  "Trương Bảo Thy","Nguyễn Trung Tín","Nguyễn Thị Thảo Trang","Lê Thị Thanh Trúc","Trần Quốc Tuấn",
  "Võ Trúc Uyển","Lê Nguyễn Tường Vy","Thiều Lê Thảo Vy","Trần Ngọc Như Ý","Trần Thị Kim Yến"
];

export const SEAT_DEFAULT = {
  v: 2,
  label: "Sơ đồ lớp 12A6",
  cols: [
    [0,7,39,34,21,11],   [0,10,32,1,30,12],
    [4,19,38,14,37,31],  [28,43,29,26,15,33],
    [24,2,20,23,9,40],   [44,13,0,6,36,35],
    [27,3,41,25,17,18],  [5,45,8,22,16,42]
  ]
};

export const TX_PRESET_CATEGORIES = [
  "Tiền in đề",
  "Photo tài liệu",
  "Vệ sinh lớp",
  "Hoạt động lớp",
  "Liên hoan",
  "Mua đồ dùng lớp",
  "Quỹ khác"
];

export function cloneSeat(m) {
  return { v: 2, label: m.label, cols: m.cols.map((c) => c.slice()) };
}

export function validSeatMap(m) {
  if (!m || m.v !== 2 || !Array.isArray(m.cols) || m.cols.length < 1 || m.cols.length > 12) return false;
  const seen = {};
  let n = 0;
  for (let i = 0; i < m.cols.length; i++) {
    if (!Array.isArray(m.cols[i])) return false;
    for (let j = 0; j < m.cols[i].length; j++) {
      const v = m.cols[i][j];
      if (v === 0) continue;
      if (!(v >= 1 && v <= NAMES.length) || seen[v]) return false;
      seen[v] = 1;
      n++;
    }
  }
  return n === NAMES.length;
}

export function makeStudents(fee, overrides = {}) {
  return NAMES.map((name, i) => {
    const stt = i + 1;
    return {
      stt,
      name,
      fee,
      paid: overrides[stt] !== undefined ? overrides[stt] : fee,
      note: "",
      perm: false,
      exempt: false
    };
  });
}

export function buildInitialDb() {
  return {
    fileName: "SỔ QUỸ 12A6",
    mainSheetName: MAIN_SHEET,
    cloudRoom: "",
    bank: { bankId: "MB", accountNo: "0977370232", accountName: "HUYNH QUOC DUY" },
    privacy: true,
    log: [],
    trash: [],
    applied: [],
    goal: null,
    budget: { monthly: 0 },
    seatMap: cloneSeat(SEAT_DEFAULT),
    extraHistory: [],
    sheets: {
      [MAIN_SHEET]: {
        sheetName: MAIN_SHEET,
        weekLabel: "Tuần 1",
        period: "",
        opening: 0,
        weeklyFee: 20000,
        students: makeStudents(20000, {}),
        transactions: [
          { id: 1, date: "", type: "Thu", category: "Quỹ hằng tuần", amount: 0, person: "Duy", note: "", auto: true, img: "" }
        ]
      }
    },
    extra: {
      title: "Khoản phụ",
      items: NAMES.map((name, i) => ({ stt: i + 1, name, due: 0, paid: 0 }))
    },
    updatedAt: 0
  };
}

export function isNum(x) {
  return typeof x === "number" && Number.isFinite(x);
}

export function validDb(d) {
  try {
    if (!d || typeof d !== "object" || !d.sheets || typeof d.sheets !== "object" || !d.sheets[MAIN_SHEET]) return false;
    if (!d.extra || !Array.isArray(d.extra.items) || d.extra.items.length !== NAMES.length) return false;
    for (const k of Object.keys(d.sheets)) {
      if (k !== MAIN_SHEET && !/^Tuần \d+$/.test(k)) return false;
      const sh = d.sheets[k];
      if (!sh || !Array.isArray(sh.students) || sh.students.length !== NAMES.length || !Array.isArray(sh.transactions)) return false;
      for (const s of sh.students) {
        if (!isNum(s.fee) || !isNum(s.paid)) return false;
      }
      for (const tx of sh.transactions) {
        if (!isNum(Number(tx.amount))) return false;
      }
    }
    for (const it of d.extra.items) {
      if (!isNum(it.due) || !isNum(it.paid)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function cleanTx(t, i = 0) {
  t = t || {};
  const o = {
    id: Number(t.id) || (Date.now() + i),
    type: t.type === "Thu" ? "Thu" : "Chi",
    amount: Math.max(Number(t.amount) || 0, 0),
    auto: !!t.auto
  };
  for (const f of ["date", "category", "person", "note"]) {
    o[f] = String(t[f] == null ? "" : t[f]).slice(0, 200);
  }
  o.img = /^receipts\/[A-Za-z0-9_.-]{1,80}\.(jpg|jpeg|png|webp)$/i.test(String(t.img || "")) ? String(t.img) : "";
  return o;
}

export function normalizeDb(d) {
  Object.keys(d.sheets).forEach((k) => {
    const sh = d.sheets[k];
    sh.sheetName = k;
    sh.weekLabel = String(sh.weekLabel || k);
    sh.period = String(sh.period || "");
    sh.opening = Number(sh.opening) || 0;
    sh.weeklyFee = Number(sh.weeklyFee) || (sh.students[0] && sh.students[0].fee) || 20000;
    sh.students.forEach((s, i) => {
      s.stt = i + 1;
      s.name = NAMES[i];
      s.fee = Math.max(Number(s.fee) || 0, 0);
      s.paid = Math.max(Number(s.paid) || 0, 0);
      s.note = String(s.note || "").slice(0, 80);
      s.perm = !!s.perm;
      s.exempt = !!s.exempt;
    });
    sh.transactions = sh.transactions.map((t, i) => cleanTx(t, i));
  });

  d.extra.title = String(d.extra.title || "Khoản phụ").slice(0, 60);
  d.extra.items.forEach((it, i) => {
    it.stt = i + 1;
    it.name = NAMES[i];
    it.due = Math.max(Number(it.due) || 0, 0);
    it.paid = Math.max(Number(it.paid) || 0, 0);
  });

  d.extraHistory = (Array.isArray(d.extraHistory) ? d.extraHistory : []).slice(0, 20).map((camp) => ({
    title: String(camp.title || "Khoản phụ cũ").slice(0, 60),
    closedAt: Number(camp.closedAt) || Date.now(),
    items: (Array.isArray(camp.items) ? camp.items : []).slice(0, NAMES.length).map((it, i) => ({
      stt: i + 1,
      name: NAMES[i],
      due: Math.max(Number(it.due) || 0, 0),
      paid: Math.max(Number(it.paid) || 0, 0)
    }))
  }));

  if (!d.bank || typeof d.bank !== "object") d.bank = {};
  d.bank.bankId = String(d.bank.bankId || "").replace(/\s+/g, "").toUpperCase();
  d.bank.accountNo = String(d.bank.accountNo || "").replace(/\s+/g, "");
  if (!/^[A-Z0-9]{2,12}$/.test(d.bank.bankId)) d.bank.bankId = "MB";
  if (!/^[A-Za-z0-9]{4,24}$/.test(d.bank.accountNo)) d.bank.accountNo = "0977370232";
  d.bank.accountName = String(d.bank.accountName || "HUYNH QUOC DUY")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, "")
    .slice(0, 40) || "HUYNH QUOC DUY";

  d.cloudRoom = "";
  d.privacy = !!d.privacy;

  d.log = (Array.isArray(d.log) ? d.log : [])
    .filter((x) => x && isNum(Number(x.t)))
    .slice(0, 300)
    .map((x) => ({
      t: Number(x.t),
      k: /^(pay|tx|sys)$/.test(x.k) ? x.k : "sys",
      m: String(x.m == null ? "" : x.m).slice(0, 200),
      s: Math.min(Math.max(Number(x.s) || 0, 0), NAMES.length)
    }));

  d.trash = (Array.isArray(d.trash) ? d.trash : [])
    .filter((x) => x && x.tx && d.sheets[x.sheet])
    .slice(0, 50)
    .map((x, i) => ({
      t: Number(x.t) || Date.now(),
      sheet: x.sheet,
      tx: cleanTx(x.tx, i)
    }));

  d.applied = (Array.isArray(d.applied) ? d.applied : [])
    .filter((x) => typeof x === "string" && x.length < 40)
    .slice(-600);

  const g = d.goal;
  d.goal = (g && typeof g === "object" && Number(g.target) > 0)
    ? {
        title: String(g.title || "Mục tiêu quỹ").slice(0, 60),
        target: Number(g.target),
        deadline: /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(String(g.deadline || "")) ? String(g.deadline) : ""
      }
    : null;

  d.seatMap = validSeatMap(d.seatMap)
    ? { v: 2, label: String(d.seatMap.label || "").slice(0, 60), cols: d.seatMap.cols.map((c) => c.slice()) }
    : cloneSeat(SEAT_DEFAULT);

  d.budget = { monthly: Math.max(Number(d.budget && d.budget.monthly) || 0, 0) };
  if (typeof d.adminPinHash !== "string") d.adminPinHash = "";

  return d;
}
