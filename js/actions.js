/* ==========================================================================
   actions.js — VietQR, Bank Reconciliation, PNG Report Card, Excel Export,
                Student Profile, Batch Pay, Pay All Debt, Modals
   ========================================================================== */

import { MAIN_SHEET, NAMES, TX_PRESET_CATEGORIES } from "./config.js";
import { $, money, fmtK, esc, removeTones, hashStr, localISO, fmtDMY, parseDMY, toInputDate, fromInputDate, nextPeriod, toast, openModal, closeModal, askConfirm, copyText } from "./utils.js";
import { allSheets, getWeekOrder, calcSheetKpi, streakOf, badgesHtml, avatarHtml } from "./render.js";
import { uploadReceipt, fetchReceiptUrl, netMsg } from "./sync.js";

const NORM_NAMES = NAMES.map((n) => removeTones(n).replace(/[^a-z0-9]+/g, " ").trim());
let reconRows = [];
let currentQrInfo = null;

export function ensureBank(db) {
  if (!db.bank) db.bank = {};
  if (!db.bank.bankId) db.bank.bankId = "MB";
  if (!db.bank.accountNo) db.bank.accountNo = "0977370232";
  if (!db.bank.accountName) db.bank.accountName = "HUYNH QUOC DUY";
}

export function bankLine(db) {
  ensureBank(db);
  return `\n\n💳 ${db.bank.bankId} · ${db.bank.accountNo} · ${db.bank.accountName}`;
}

/* ---------- VietQR Modal with 1-click Copy & Download ---------- */
export function openQR(db, name, amount, label) {
  ensureBank(db);
  const b = db.bank;
  const memo = (`12A6 ${removeTones(name).toUpperCase()} ${removeTones(label).toUpperCase()}`)
    .replace(/[^A-Z0-9 ]/g, "")
    .slice(0, 50);
  const amt = Math.round(Number(amount) || 0);
  const url = `https://img.vietqr.io/image/${encodeURIComponent(b.bankId)}-${encodeURIComponent(b.accountNo)}-compact2.png?amount=${amt}&addInfo=${encodeURIComponent(memo)}&accountName=${encodeURIComponent(b.accountName)}`;
  currentQrInfo = { url, bankId: b.bankId, accountNo: b.accountNo, accountName: b.accountName, memo, amount: amt, name };

  $("qrTitle").textContent = `${name} — ${money(amt)}`;
  $("qrImg").src = url;
  $("qrBankLine").textContent = `${b.bankId} · ${b.accountNo} · ${b.accountName}`;
  $("qrMemoLine").textContent = memo;
  openModal("modalQR");
}

export function initQrActions() {
  $("btnQrCopyAcc").onclick = () => currentQrInfo && copyText(currentQrInfo.accountNo, "Đã copy số tài khoản!");
  $("btnQrCopyMemo").onclick = () => currentQrInfo && copyText(currentQrInfo.memo, "Đã copy nội dung chuyển khoản!");
  $("btnQrCopyAmt").onclick = () => currentQrInfo && copyText(String(currentQrInfo.amount), "Đã copy số tiền!");
  $("btnQrDownload").onclick = async () => {
    if (!currentQrInfo) return;
    try {
      const r = await fetch(currentQrInfo.url);
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `VietQR_${removeTones(currentQrInfo.name).replace(/\s+/g, "_")}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1500);
      toast("Đã tải ảnh VietQR!", "ok");
    } catch {
      window.open(currentQrInfo.url, "_blank", "noopener");
    }
  };
}

/* ---------- Student Profile Modal ---------- */
export function openStudentProfile(ctx, stt) {
  const { db, state, canSee } = ctx;
  const idx = stt - 1;
  const name = NAMES[idx];
  if (!name) return;
  if (!canSee(stt)) return toast("🔒 Chế độ riêng tư: bạn chỉ xem được hồ sơ của chính mình.", "err");

  const cols = allSheets(db);
  let totalPaid = 0, totalOwe = 0;
  const chips = cols.map((k) => {
    const sh = db.sheets[k];
    const st = sh.students[idx];
    const owe = Math.max(st.fee - st.paid, 0);
    totalPaid += st.paid;
    totalOwe += owe;
    const cls = st.fee === 0 ? "na" : (owe === 0 ? "ok" : "bad");
    const txt = st.fee === 0 ? "miễn" : (owe === 0 ? "✓" : `-${fmtK(owe)}`);
    const act = state.isAdmin ? `data-prof-edit-week="${esc(k)}" data-stt="${stt}" style="cursor:pointer"` : "";
    return `<div class="weekchip ${cls}" ${act} title="${esc(sh.weekLabel + (st.note ? " — " + st.note : ""))}">
      <span>${esc(sh.weekLabel.replace("Tuần ", "T"))}</span>
      <b>${txt}</b>
    </div>`;
  }).join("");

  const ex = db.extra.items[idx];
  const exOwe = Math.max(ex.due - ex.paid, 0);
  totalOwe += exOwe;
  const streak = streakOf(db, stt);
  const mine = db.sheets[MAIN_SHEET].students[idx];

  $("profHead").innerHTML = `${avatarHtml(stt, true, true)}
    <div class="flex-1">
      <h3 class="modal-title truncate">#${stt}. ${esc(name)}</h3>
      <div class="row-wrap mt-1">
        ${badgesHtml(db, stt)}
        ${totalOwe === 0 ? `<span class="pill ok">🛡️ Không nợ</span>` : `<span class="pill bad">Còn thiếu</span>`}
        ${mine.exempt ? `<span class="pill gold">${mine.fee === 0 ? "Được miễn" : "Được giảm"}</span>` : ""}
      </div>
    </div>`;

  const pct = totalPaid + totalOwe > 0 ? (totalPaid / (totalPaid + totalOwe)) * 100 : 100;
  $("profBody").innerHTML = `
    <div class="grid-3 text-center">
      <div class="sync-section" style="padding:10px;background:var(--emerald-bg);border-color:var(--emerald-border)">
        <span class="text-xs text-muted">Đã đóng</span>
        <b class="num c-emerald">${money(totalPaid)}</b>
      </div>
      <div class="sync-section" style="padding:10px;background:var(--rose-bg);border-color:var(--rose-border)">
        <span class="text-xs text-muted">Còn thiếu</span>
        <b class="num c-rose">${money(totalOwe)}</b>
      </div>
      <div class="sync-section" style="padding:10px;background:var(--amber-bg);border-color:var(--amber-border)">
        <span class="text-xs text-muted">Chuỗi đủ</span>
        <b class="num c-amber">${streak} tuần</b>
      </div>
    </div>
    <div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct.toFixed(0)}%;background:linear-gradient(90deg,#10b981,#38bdf8)"></div></div>
      <p class="text-xs text-muted mt-1">Hoàn thành ${pct.toFixed(0)}% tổng nghĩa vụ quỹ</p>
    </div>
    <div>
      <p class="text-xs font-bold" style="margin:0 0 6px">Lịch đóng quỹ theo tuần ${state.isAdmin ? "<span class='text-muted'>(bấm từng tuần để sửa)</span>" : ""}</p>
      <div class="row-wrap">${chips}</div>
    </div>
    <div class="row-between" style="padding-top:10px;border-top:1px solid var(--divider)">
      <span class="text-sm">Khoản phụ (${esc(db.extra.title)})</span>
      <span class="font-bold text-sm num ${exOwe > 0 ? "c-rose" : "c-emerald"}">${exOwe > 0 ? `Thiếu ${money(exOwe)}` : `Đã đủ (${money(ex.paid)})`}</span>
    </div>
    ${mine.note ? `<p class="text-xs text-muted">📝 ${esc(mine.note)}</p>` : ""}`;

  $("btnProfQR").textContent = totalOwe > 0 ? `📱 VietQR nộp ${money(totalOwe)}` : "📱 Hiện VietQR Nộp Quỹ";
  $("btnProfQR").onclick = () => {
    closeModal("modalProfile");
    openQR(db, name, totalOwe > 0 ? totalOwe : (db.sheets[MAIN_SHEET].weeklyFee || 20000), "QUY 12A6");
  };

  const payAllBtn = $("btnProfPayAll");
  if (state.isAdmin && totalOwe > 0) {
    payAllBtn.classList.remove("hidden");
    payAllBtn.textContent = `✅ Thu hết nợ (${money(totalOwe)})`;
    payAllBtn.onclick = () => {
      closeModal("modalProfile");
      payAllDebtOfStudent(ctx, stt);
    };
  } else {
    payAllBtn.classList.add("hidden");
  }

  openModal("modalProfile");
}

/* ---------- 1-Click Pay All Cumulative Debt for a Student ---------- */
export async function payAllDebtOfStudent(ctx, stt) {
  const { db, requireAdmin, saveDb, logAct, rerender } = ctx;
  if (!requireAdmin()) return;
  const idx = stt - 1;
  const name = NAMES[idx];
  const cols = allSheets(db);
  const items = [];
  let sum = 0;

  cols.forEach((k) => {
    const s = db.sheets[k].students[idx];
    const owe = Math.max(s.fee - s.paid, 0);
    if (owe > 0) { sum += owe; items.push({ key: k, label: db.sheets[k].weekLabel, owe }); }
  });
  const ex = db.extra.items[idx];
  const exOwe = Math.max(ex.due - ex.paid, 0);
  if (exOwe > 0) { sum += exOwe; items.push({ key: "__extra", label: db.extra.title, owe: exOwe }); }

  if (!sum) return toast(`${name} không còn khoản nợ nào!`, "ok");

  const ok = await askConfirm({
    title: `Thu hết nợ cho ${name}`,
    message: `Ghi nhận đã nộp đủ ${money(sum)} cho các khoản: ${items.map((x) => `${x.label} (${fmtK(x.owe)})`).join(", ")}?`,
    confirmText: `Thu đủ ${money(sum)}`
  });
  if (!ok) return;

  saveDb(true);
  items.forEach((it) => {
    if (it.key === "__extra") db.extra.items[idx].paid = db.extra.items[idx].due;
    else db.sheets[it.key].students[idx].paid = db.sheets[it.key].students[idx].fee;
  });
  logAct("pay", `Thu hết nợ ${name}: +${money(sum)} (${items.map((x) => x.label).join(", ")})`, stt);
  saveDb(false);
  rerender();
  toast(`✅ Đã thu hết ${money(sum)} cho ${name}!`, "ok");
}

/* ---------- Batch Pay Selected Students ---------- */
export async function applyBatchPay(ctx, setToFull) {
  const { db, state, requireAdmin, saveDb, logAct, rerender } = ctx;
  if (!requireAdmin() || state.batchSelected.size === 0) return;
  const sh = db.sheets[state.week];
  const stts = Array.from(state.batchSelected);
  const ok = await askConfirm({
    title: setToFull ? `Thu đủ ${stts.length} học sinh` : `Đặt 0đ cho ${stts.length} học sinh`,
    message: `Áp dụng cho ${stts.length} bạn đã chọn trong ${sh.weekLabel}?`,
    confirmText: setToFull ? "Xác nhận thu đủ" : "Đặt 0đ",
    danger: !setToFull
  });
  if (!ok) return;

  saveDb(true);
  stts.forEach((stt) => {
    const s = sh.students[stt - 1];
    s.paid = setToFull ? s.fee : 0;
  });
  logAct("pay", `Cập nhật hàng loạt (${stts.length} bạn) ${sh.weekLabel} → ${setToFull ? "Đủ" : "0đ"}`);
  state.batchSelected.clear();
  state.batchMode = false;
  saveDb(false);
  rerender();
  toast(`✅ Đã cập nhật ${stts.length} bạn trong 1 lần lưu!`, "ok");
}

/* ---------- Receipt Viewer ---------- */
export async function openReceiptModal(path) {
  const img = $("receiptImg");
  const msg = $("receiptMsg");
  img.classList.add("hidden");
  img.removeAttribute("src");
  msg.textContent = "Đang tải ảnh biên lai…";
  msg.classList.remove("hidden");
  openModal("modalReceipt");
  try {
    const url = await fetchReceiptUrl(path);
    img.src = url;
    img.classList.remove("hidden");
    msg.classList.add("hidden");
  } catch (e) {
    msg.textContent = `Không tải được ảnh: ${netMsg(e)}`;
  }
}

/* ---------- Transaction Modal with Quick Category Chips ---------- */
export function renderTxCategoryChips() {
  const box = $("txCatChips");
  if (!box) return;
  box.innerHTML = TX_PRESET_CATEGORIES.map(
    (c) => `<button type="button" class="btn btn-xs" data-tx-cat="${esc(c)}">${esc(c)}</button>`
  ).join("");
  box.querySelectorAll("button").forEach((b) => {
    b.onclick = () => { $("txCat").value = b.getAttribute("data-tx-cat"); };
  });
}

export function setTxTypeUI(state, t) {
  state.txType = t;
  $("typeThu").className = `btn flex-1 ${t === "Thu" ? "btn-emerald" : ""}`;
  $("typeChi").className = `btn flex-1 ${t === "Chi" ? "btn-rose" : ""}`;
}

export function openTxModal(ctx, id = null) {
  const { db, state, requireAdmin } = ctx;
  if (!requireAdmin()) return;
  const sh = db.sheets[state.week];
  const t = id ? sh.transactions.find((x) => x.id === id && !x.auto) : null;
  state.editTxId = t ? t.id : null;
  $("txModalTitle").textContent = t ? "Sửa giao dịch" : "Ghi giao dịch Thu / Chi";
  setTxTypeUI(state, t ? t.type : "Chi");
  $("txDate").value = t ? toInputDate(t.date) : localISO();
  $("txCat").value = t ? t.category : "";
  $("txAmt").value = t ? t.amount : "";
  $("txNote").value = t ? t.note : "";
  $("txImg").value = "";
  $("txImgInfo").textContent = t && t.img
    ? "Đã có ảnh biên lai đính kèm. Chọn ảnh mới để thay thế."
    : "Ảnh sẽ được nén tự động và lưu vào thư mục receipts/ trong repo.";
  if (t) $("txPerson").value = t.person;
  openModal("modalTx");
}

export async function saveTxFromModal(ctx) {
  const { db, state, requireAdmin, saveDb, logAct, rerender } = ctx;
  if (!requireAdmin()) return;
  const cat = $("txCat").value.trim();
  const amt = Number($("txAmt").value);
  if (!cat || !(amt > 0)) return toast("Nhập đủ danh mục và số tiền lớn hơn 0!", "err");
  if (amt >= 1000000) {
    const ok = await askConfirm({
      title: "Xác nhận khoản tiền lớn",
      message: `Số tiền ${money(amt)} khá lớn. Bạn chắc chắn đã nhập đúng?`,
      confirmText: "Đúng, lưu ngay"
    });
    if (!ok) return;
  }

  saveDb(true);
  const key = state.week;
  const sh = db.sheets[key];
  const file = $("txImg").files && $("txImg").files[0];
  const payload = {
    date: fromInputDate($("txDate").value),
    type: state.txType,
    category: cat,
    amount: amt,
    person: $("txPerson").value.trim() || "Duy",
    note: $("txNote").value.trim()
  };

  let t = state.editTxId ? sh.transactions.find((x) => x.id === state.editTxId && !x.auto) : null;
  const isNew = !t;
  if (t) Object.assign(t, payload);
  else {
    t = { ...payload, id: Date.now(), auto: false, img: "" };
    sh.transactions.push(t);
  }
  logAct("tx", `${isNew ? "Thêm" : "Sửa"} ${t.type === "Chi" ? "khoản chi" : "khoản thu"} “${t.category}” ${money(t.amount)} (${sh.weekLabel})`);
  const savedId = t.id;
  state.editTxId = null;
  saveDb(false);
  closeModal("modalTx");
  rerender();
  toast("Đã lưu giao dịch!", "ok");

  if (file) {
    toast("Đang tải ảnh biên lai…");
    try {
      const path = await uploadReceipt(file, savedId);
      const tx2 = db.sheets[key].transactions.find((x) => x.id === savedId && !x.auto);
      if (tx2) {
        tx2.img = path;
        saveDb(false);
        rerender();
        toast("📎 Đã đính kèm ảnh biên lai!", "ok");
      }
    } catch (e) {
      toast(`Chưa đính kèm được biên lai: ${netMsg(e)}`, "err");
    }
  }
}

/* ---------- Close Week & Create New Week Modal ---------- */
export function openNewWeekModal(ctx) {
  const { db, requireAdmin } = ctx;
  if (!requireAdmin()) return;
  const main = db.sheets[MAIN_SHEET];
  const cur = main.weekLabel;
  if (db.sheets[cur]) return toast(`Đã có sổ '${cur}', không thể chốt trùng tên!`, "err");
  const nextNum = (parseInt(cur.replace(/\D/g, ""), 10) || getWeekOrder(db).length + 1) + 1;
  const bal = calcSheetKpi(main).balance;
  const carry = main.students.filter((s) => s.perm).length;

  $("nwPreview").innerHTML = `Sẽ chốt <b>${esc(cur)}</b> với tồn cuối <b class="num c-accent">${money(bal)}</b> chuyển sang tuần mới.${carry ? ` (${carry} bạn miễn/giảm dài hạn được giữ nguyên.)` : ""}`;
  $("nwLabel").value = `Tuần ${nextNum}`;
  $("nwPeriod").value = nextPeriod(main.period);
  $("nwFee").value = main.weeklyFee || 20000;
  openModal("modalNewWeek");
}

export function confirmNewWeek(ctx) {
  const { db, state, requireAdmin, saveDb, logAct, rerender } = ctx;
  if (!requireAdmin()) return;
  const main = db.sheets[MAIN_SHEET];
  const cur = main.weekLabel;
  if (db.sheets[cur]) return toast(`Đã có sổ '${cur}'!`, "err");
  const nextLbl = $("nwLabel").value.trim();
  const nextPer = $("nwPeriod").value.trim();
  const nextFee = Math.max(Number($("nwFee").value) || 0, 0);
  if (!nextLbl || !nextFee) return toast("Nhập tên tuần và mức đóng hợp lệ!", "err");

  const bal = calcSheetKpi(main).balance;
  saveDb(true);
  db.sheets[cur] = JSON.parse(JSON.stringify(main));
  db.sheets[cur].sheetName = cur;

  main.weekLabel = nextLbl;
  main.period = nextPer;
  main.opening = bal;
  main.weeklyFee = nextFee;
  main.students.forEach((s) => {
    s.paid = 0;
    if (!s.perm) {
      s.fee = nextFee;
      s.exempt = false;
      s.note = "";
    }
  });
  main.transactions = [{
    id: Date.now(),
    date: fmtDMY(new Date()),
    type: "Thu",
    category: "Quỹ hằng tuần",
    amount: 0,
    person: "Duy",
    note: "",
    auto: true,
    img: ""
  }];
  logAct("sys", `Chốt ${cur} (tồn cuối ${money(bal)}), tạo ${nextLbl} (${money(nextFee)}/bạn)`);
  state.week = MAIN_SHEET;
  saveDb(false);
  closeModal("modalNewWeek");
  rerender();
  toast(`🎉 Đã chốt ${cur} và mở ${nextLbl}!`, "ok");
}

/* ---------- Bank Statement Reconciliation ---------- */
function wordsIn(norm) {
  return ` ${norm.replace(/[^a-z0-9]+/g, " ").trim()} `;
}

function parseAmount(line) {
  const re = /([+\-−])?\s*(\d{1,3}(?:[.,]\d{3})+|\d{4,9})/g;
  let m;
  const found = [];
  while ((m = re.exec(line))) {
    const start = m.index + (m[0].length - m[0].replace(/^[+\-−]?\s*/, "").length);
    const prev = start > 0 ? line.charAt(start - 1) : "";
    const after = line.charAt(re.lastIndex);
    if (/\d/.test(prev) || /\d/.test(after) || prev === "/" || after === "/" || prev === ":") continue;
    const num = Number(m[2].replace(/[.,]/g, ""));
    if (num < 1000 || num > 50000000) continue;
    const before = removeTones(line.slice(Math.max(0, m.index - 14), m.index));
    if (/(so du|sd|balance|bal)\W*$/.test(before)) continue;
    const tail = removeTones(line.slice(re.lastIndex, re.lastIndex + 6));
    found.push({ num, sign: m[1] || "", cur: /^\s*(d|vnd)\b/.test(tail) || /^\s*vn/.test(tail) });
  }
  if (!found.length) return null;
  return found.find((f) => f.sign || f.cur) || found[0];
}

function matchStudent(norm) {
  const text = wordsIn(norm);
  let best = 0;
  let bestList = [];
  NORM_NAMES.forEach((n, i) => {
    const w = n.split(" ");
    let score = 0;
    for (let k = w.length; k >= 2; k--) {
      if (text.includes(` ${w.slice(-k).join(" ")} `)) { score = k; break; }
    }
    if (score > best) { best = score; bestList = [i + 1]; }
    else if (score === best && score > 0) bestList.push(i + 1);
  });
  if (best >= 2 && bestList.length === 1) return { stt: bestList[0], conf: "ok" };
  if (best >= 2) return { stt: 0, conf: "amb" };
  const one = [];
  NORM_NAMES.forEach((n, i) => {
    const w = n.split(" ");
    if (text.includes(` ${w[w.length - 1]} `)) one.push(i + 1);
  });
  if (one.length === 1) return { stt: one[0], conf: "low" };
  return { stt: 0, conf: "none" };
}

function parseBankText(db, text) {
  text = String(text || "").trim();
  const blocks = /\n\s*\n/.test(text) ? text.split(/\n\s*\n/) : text.split(/\n/);
  return blocks.map((b) => b.replace(/\s+/g, " ").trim()).filter(Boolean).map((line) => {
    const a = parseAmount(line);
    const norm = removeTones(line);
    const ms = matchStudent(norm);
    const wk = norm.match(/tuan\s*(\d+)/);
    let pref = null;
    if (wk) {
      const key = `Tuần ${wk[1]}`;
      if (db.sheets[key]) pref = key;
      else if (db.sheets[MAIN_SHEET].weekLabel === key) pref = MAIN_SHEET;
    }
    const exTok = removeTones(db.extra.title).replace(/[^a-z0-9]+/g, " ").trim();
    const wantExtra = exTok.length >= 3 && wordsIn(norm).includes(` ${exTok} `);
    const amount = a ? a.num : 0;
    const out = !!(a && /^[-−]$/.test(a.sign));
    const hash = hashStr(`${norm}|${amount}`);
    const dup = (db.applied || []).includes(hash);
    return {
      line,
      stt: ms.stt,
      conf: ms.conf,
      amount,
      out,
      pref,
      wantExtra,
      hash,
      dup,
      on: !!(ms.stt && ms.conf === "ok" && amount && !out && !dup)
    };
  });
}

function simulateRecon(db, rows) {
  const virt = {};
  const keys = allSheets(db);
  keys.forEach((k) => { virt[k] = db.sheets[k].students.map((s) => s.paid); });
  virt.__extra = db.extra.items.map((x) => x.paid);

  rows.forEach((r) => {
    r.alloc = [];
    r.surplus = 0;
    if (!r.on || !r.stt || !(r.amount > 0)) return;
    let order = keys.slice();
    if (r.pref) order = [r.pref].concat(order.filter((k) => k !== r.pref));
    const targets = order.map((k) => ({ key: k, label: db.sheets[k].weekLabel, fee: db.sheets[k].students[r.stt - 1].fee }));
    const extraT = { key: "__extra", label: db.extra.title, fee: db.extra.items[r.stt - 1].due };
    if (r.wantExtra) targets.unshift(extraT); else targets.push(extraT);

    let left = r.amount;
    targets.forEach((t) => {
      if (left <= 0) return;
      const have = virt[t.key][r.stt - 1];
      const owe = Math.max(t.fee - have, 0);
      const give = Math.min(owe, left);
      if (give > 0) {
        virt[t.key][r.stt - 1] = have + give;
        left -= give;
        r.alloc.push({ key: t.key, label: t.label, amt: give });
      }
    });
    r.surplus = left;
  });
}

export function runReconParse(ctx) {
  reconRows = parseBankText(ctx.db, $("reconText").value);
  renderRecon(ctx);
}

function renderRecon(ctx) {
  const { db } = ctx;
  simulateRecon(db, reconRows);
  const opts = `<option value="0">— chọn bạn —</option>` + NAMES.map((n, i) => `<option value="${i + 1}">#${i + 1} ${esc(n)}</option>`).join("");
  const okCnt = reconRows.filter((r) => r.on && r.alloc.length).length;
  const sum = reconRows.reduce((a, r) => a + (r.on ? r.amount - r.surplus : 0), 0);

  if (!reconRows.length) {
    $("reconResult").innerHTML = `<p class="text-xs text-muted">Không tìm thấy dòng giao dịch nào.</p>`;
    return;
  }

  $("reconResult").innerHTML = reconRows.map((r, i) => {
    const note = r.out ? `<span class="pill bad">Tiền ra</span>`
      : r.dup ? `<span class="pill gold">Đã áp dụng trước</span>`
      : !r.amount ? `<span class="pill bad">Thiếu số tiền</span>`
      : r.conf === "ok" ? `<span class="pill ok">Khớp tên</span>`
      : r.conf === "low" ? `<span class="pill gold">Khớp tên gọi</span>`
      : r.conf === "amb" ? `<span class="pill gold">Trùng nhiều bạn</span>`
      : `<span class="pill bad">Chưa khớp tên</span>`;

    const alloc = r.alloc && r.alloc.length
      ? `→ ${r.alloc.map((a) => `${esc(a.label)} +${fmtK(a.amt)}`).join(", ")}${r.surplus ? ` · <b class="c-amber">dư ${money(r.surplus)}</b>` : ""}`
      : (r.on ? `<span class="c-amber">Bạn này không còn nợ khoản nào</span>` : "");

    return `<div class="sync-section" data-ri="${i}">
      <div class="row" style="align-items:flex-start">
        <input type="checkbox" class="rc-on" style="margin-top:3px;width:16px;height:16px" ${r.on ? "checked" : ""}>
        <p class="text-xs mono flex-1" style="margin:0;word-break:break-word">${esc(r.line)}</p>
      </div>
      <div class="row-wrap">
        <select class="select rc-stu" style="font-size:12px;padding:6px 8px;max-width:240px">${opts.replace(`value="${r.stt}"`, `value="${r.stt}" selected`)}</select>
        <input type="number" class="input rc-amt num" style="width:120px;padding:6px 8px;font-size:12px" value="${r.amount}">
        ${note}
      </div>
      ${alloc ? `<p class="text-xs text-muted" style="margin:0">${alloc}</p>` : ""}
    </div>`;
  }).join("") + `
    <div class="row-between pt-1">
      <span class="text-xs font-bold">Sẽ ghi ${okCnt} giao dịch · <span class="num c-emerald">${money(sum)}</span></span>
      <button id="btnReconApply" class="btn btn-emerald" ${okCnt ? "" : "disabled"}>✅ Áp dụng vào sổ</button>
    </div>`;

  $("reconResult").querySelectorAll("[data-ri]").forEach((box) => {
    const i = Number(box.getAttribute("data-ri"));
    const r = reconRows[i];
    box.querySelector(".rc-on").onchange = (e) => { r.on = e.target.checked; renderRecon(ctx); };
    box.querySelector(".rc-stu").onchange = (e) => {
      r.stt = Number(e.target.value);
      r.conf = r.stt ? "ok" : "none";
      r.on = !!(r.stt && r.amount && !r.out && !r.dup);
      renderRecon(ctx);
    };
    box.querySelector(".rc-amt").onchange = (e) => {
      r.amount = Math.max(Number(e.target.value) || 0, 0);
      r.on = !!(r.stt && r.amount && !r.out && !r.dup);
      renderRecon(ctx);
    };
  });

  const ap = $("btnReconApply");
  if (ap) ap.onclick = () => applyRecon(ctx);
}

async function applyRecon(ctx) {
  const { db, requireAdmin, saveDb, logAct, rerender } = ctx;
  if (!requireAdmin()) return;
  simulateRecon(db, reconRows);
  const rows = reconRows.filter((r) => r.on && r.alloc.length);
  if (!rows.length) return toast("Không có giao dịch hợp lệ để áp dụng.", "err");
  const total = rows.reduce((a, r) => a + r.amount - r.surplus, 0);
  const ok = await askConfirm({
    title: "Áp dụng sao kê vào sổ quỹ",
    message: `Ghi nhận ${rows.length} giao dịch chuyển khoản, tổng cộng ${money(total)}?`,
    confirmText: "Áp dụng ngay"
  });
  if (!ok) return;

  saveDb(true);
  rows.forEach((r) => {
    r.alloc.forEach((a) => {
      if (a.key === "__extra") db.extra.items[r.stt - 1].paid += a.amt;
      else db.sheets[a.key].students[r.stt - 1].paid += a.amt;
    });
    db.applied.push(r.hash);
    if (db.applied.length > 600) db.applied.shift();
    logAct("pay", `Sao kê: ${NAMES[r.stt - 1]} +${money(r.amount - r.surplus)} → ${r.alloc.map((a) => `${a.label} ${fmtK(a.amt)}`).join(", ")}`, r.stt);
  });
  saveDb(false);
  closeModal("modalRecon");
  reconRows = [];
  $("reconResult").innerHTML = "";
  rerender();
  toast(`✅ Đã ghi ${rows.length} giao dịch từ sao kê!`, "ok");
}

/* ---------- Modern Fintech PNG Report Card ---------- */
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitText(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  while (text.length > 1 && ctx.measureText(text + "…").width > maxW) text = text.slice(0, -1);
  return text + "…";
}

export function drawReport(db, state) {
  const c = $("reportCanvas");
  const sh = db.sheets[state.week];
  const kp = calcSheetKpi(sh);
  const W = 1080;
  const F = "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif";
  const spend = sh.transactions.filter((t) => t.type === "Chi").slice(0, 12);
  const debtors = sh.students.filter((s) => s.fee > 0 && s.paid < s.fee);
  const showNames = $("repNames").checked;
  const lightStyle = $("repLight").checked;
  const debtLines = showNames ? Math.min(debtors.length, 18) : 1;
  const H = 560 + (spend.length ? 90 + spend.length * 56 : 0) + 110 + debtLines * 50 + 130;

  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  if (!ctx) return;

  const pal = lightStyle
    ? { bg1: "#f8fafc", bg2: "#eef2ff", card: "#ffffff", row: "#f1f5f9", text: "#0f172a", muted: "#64748b", ok: "#059669", bad: "#e11d48", acc: "#0284c7" }
    : { bg1: "#090e1a", bg2: "#111b33", card: "rgba(255,255,255,.06)", row: "rgba(255,255,255,.05)", text: "#f8fafc", muted: "#94a3b8", ok: "#34d399", bad: "#fb7185", acc: "#38bdf8" };

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, pal.bg1);
  bg.addColorStop(1, pal.bg2);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const hd = ctx.createLinearGradient(0, 0, W, 240);
  hd.addColorStop(0, "#0f172a");
  hd.addColorStop(0.6, "#1d4ed8");
  hd.addColorStop(1, "#0284c7");
  ctx.fillStyle = hd;
  ctx.fillRect(0, 0, W, 236);

  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "alphabetic";
  ctx.font = `900 52px ${F}`;
  ctx.fillText("SỔ QUỸ LỚP 12A6", 60, 108);
  ctx.font = `700 30px ${F}`;
  ctx.globalAlpha = 0.92;
  ctx.fillText(`${sh.weekLabel}${sh.period ? `  ·  ${sh.period}` : ""}`, 60, 160);
  ctx.globalAlpha = 0.78;
  ctx.font = `600 22px ${F}`;
  ctx.fillText("Báo cáo tài chính minh bạch hàng tuần", 60, 202);
  ctx.globalAlpha = 1;

  const cards = [
    ["TỔNG THU TUẦN", money(kp.totalIn), pal.ok],
    ["TỔNG CHI TUẦN", money(kp.totalOut), pal.bad],
    ["TỒN QUỸ HIỆN TẠI", money(kp.balance), pal.acc]
  ];
  const cw = (W - 120 - 40) / 3;
  cards.forEach((k, i) => {
    const x = 60 + i * (cw + 20);
    const y = 276;
    ctx.fillStyle = pal.card;
    rr(ctx, x, y, cw, 148, 22);
    ctx.fill();
    ctx.fillStyle = pal.muted;
    ctx.font = `800 20px ${F}`;
    ctx.fillText(k[0], x + 24, y + 48);
    ctx.fillStyle = k[2];
    ctx.font = `900 36px ${F}`;
    ctx.fillText(fitText(ctx, k[1], cw - 44), x + 24, y + 104);
  });

  let y = 480;
  ctx.fillStyle = pal.text;
  ctx.font = `800 26px ${F}`;
  ctx.fillText("Tiến độ nộp quỹ", 60, y);
  ctx.textAlign = "right";
  ctx.fillStyle = pal.acc;
  ctx.fillText(`${Math.round(kp.rate * 100)}% (${kp.paidCount}/${kp.eligible} bạn)`, W - 60, y);
  ctx.textAlign = "left";

  ctx.fillStyle = pal.row;
  rr(ctx, 60, y + 20, W - 120, 24, 12);
  ctx.fill();
  const pg = ctx.createLinearGradient(60, 0, W - 60, 0);
  pg.addColorStop(0, "#10b981");
  pg.addColorStop(1, "#0284c7");
  ctx.fillStyle = pg;
  if (kp.rate > 0) {
    rr(ctx, 60, y + 20, Math.max((W - 120) * kp.rate, 24), 24, 12);
    ctx.fill();
  }

  y += 108;
  if (spend.length) {
    ctx.fillStyle = pal.text;
    ctx.font = `800 26px ${F}`;
    ctx.fillText("Các khoản chi trong tuần", 60, y);
    y += 24;
    spend.forEach((t) => {
      y += 56;
      ctx.fillStyle = pal.row;
      rr(ctx, 60, y - 38, W - 120, 48, 12);
      ctx.fill();
      ctx.fillStyle = pal.text;
      ctx.font = `600 23px ${F}`;
      ctx.fillText(fitText(ctx, t.category, 600), 82, y - 6);
      ctx.fillStyle = pal.muted;
      ctx.font = `500 20px ${F}`;
      ctx.fillText(t.date.slice(0, 5), 695, y - 6);
      ctx.textAlign = "right";
      ctx.fillStyle = pal.bad;
      ctx.font = `800 23px ${F}`;
      ctx.fillText(`-${money(t.amount)}`, W - 82, y - 6);
      ctx.textAlign = "left";
    });
    y += 64;
  }

  ctx.fillStyle = pal.text;
  ctx.font = `800 26px ${F}`;
  ctx.fillText("Tình trạng còn thiếu tuần này", 60, y);
  y += 24;
  if (!debtors.length) {
    y += 50;
    ctx.fillStyle = pal.ok;
    ctx.font = `800 26px ${F}`;
    ctx.fillText("🎉 Cả lớp đã nộp đủ 100%!", 82, y - 6);
  } else if (!showNames) {
    y += 50;
    ctx.fillStyle = "#d97706";
    ctx.font = `700 25px ${F}`;
    ctx.fillText(`Còn ${debtors.length} bạn chưa nộp đủ — vui lòng xem chi tiết trên web.`, 82, y - 6);
  } else {
    debtors.slice(0, debtLines).forEach((s) => {
      y += 50;
      ctx.fillStyle = pal.text;
      ctx.font = `600 23px ${F}`;
      ctx.fillText(fitText(ctx, `#${s.stt}  ${s.name}`, 640), 82, y - 6);
      ctx.textAlign = "right";
      ctx.fillStyle = pal.bad;
      ctx.font = `800 23px ${F}`;
      ctx.fillText(`thiếu ${money(s.fee - s.paid)}`, W - 82, y - 6);
      ctx.textAlign = "left";
    });
    if (debtors.length > debtLines) {
      y += 46;
      ctx.fillStyle = pal.muted;
      ctx.font = `500 22px ${F}`;
      ctx.fillText(`… và ${debtors.length - debtLines} bạn khác`, 82, y - 6);
    }
  }

  ctx.fillStyle = pal.muted;
  ctx.font = `600 20px ${F}`;
  ctx.textAlign = "center";
  ctx.fillText(`Sổ Quỹ 12A6 · Xuất ngày ${fmtDMY(new Date())} · grendyui.github.io/quy12a6`, W / 2, H - 46);
  ctx.textAlign = "left";
}

/* ---------- Excel Export (.xlsx) ---------- */
export function exportExcel(db) {
  if (!window.XLSX) return toast("Đang tải thư viện Excel, thử lại sau vài giây…", "err");
  const cols = allSheets(db);
  const wb = XLSX.utils.book_new();
  const addSheet = (name, aoa, widths) => {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    if (widths) ws["!cols"] = widths.map((w) => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  };

  const sum = [["Tuần", "Kỳ", "Tồn đầu kỳ", "Tổng thu", "Tổng chi", "Tồn cuối kỳ", "Đã nộp đủ", "Tiến độ nộp"]];
  cols.forEach((k) => {
    const sh = db.sheets[k];
    const kp = calcSheetKpi(sh);
    sum.push([sh.weekLabel, sh.period, sh.opening, kp.totalIn, kp.totalOut, kp.balance, `${kp.paidCount}/${kp.eligible}`, `${Math.round(kp.rate * 100)}%`]);
  });
  addSheet("Tổng kết tuần", sum, [12, 24, 14, 14, 14, 14, 12, 12]);

  const head = ["STT", "Họ tên", ...cols.map((k) => `${db.sheets[k].weekLabel} (nợ)`), `${db.extra.title} (nợ)`, "Tổng nợ"];
  const debt = [head];
  const totals = new Array(head.length - 2).fill(0);
  NAMES.forEach((n, i) => {
    const row = [i + 1, n];
    let tot = 0;
    cols.forEach((k, ci) => {
      const s = db.sheets[k].students[i];
      const o = Math.max(s.fee - s.paid, 0);
      row.push(o);
      tot += o;
      totals[ci] += o;
    });
    const exO = Math.max(db.extra.items[i].due - db.extra.items[i].paid, 0);
    row.push(exO, tot + exO);
    totals[cols.length] += exO;
    totals[cols.length + 1] += tot + exO;
    debt.push(row);
  });
  debt.push(["", "TỔNG", ...totals]);
  addSheet("Tổng hợp nợ", debt, [6, 26, ...head.slice(2).map(() => 13)]);

  const ex = [["STT", "Họ tên", "Phải đóng", "Đã nộp", "Còn thiếu"]];
  let exDue = 0, exPaid = 0;
  db.extra.items.forEach((it, i) => {
    ex.push([i + 1, NAMES[i], it.due, it.paid, Math.max(it.due - it.paid, 0)]);
    exDue += it.due;
    exPaid += it.paid;
  });
  ex.push(["", `TỔNG (${db.extra.title})`, exDue, exPaid, Math.max(exDue - exPaid, 0)]);
  addSheet("Khoản phụ", ex, [6, 26, 12, 12, 12]);

  const led = [["Tuần", "Ngày", "Loại", "Danh mục", "Số tiền", "Người thực hiện", "Ghi chú", "Biên lai"]];
  cols.forEach((k) => {
    const sh = db.sheets[k];
    calcSheetKpi(sh);
    sh.transactions.forEach((t) => led.push([sh.weekLabel, t.date, t.type, t.category, t.amount, t.person, t.note, t.img || ""]));
  });
  addSheet("Sổ thu chi", led, [10, 12, 8, 30, 14, 18, 28, 26]);

  cols.forEach((k) => {
    const sh = db.sheets[k];
    const aoa = [["STT", "Họ Tên", "Mức Đóng", "Đã Thu", "Còn Thiếu", "Ghi chú"]];
    let fee = 0, paid = 0;
    sh.students.forEach((s, i) => {
      aoa.push([i + 1, NAMES[i], s.fee, s.paid, Math.max(s.fee - s.paid, 0), s.note || ""]);
      fee += s.fee;
      paid += s.paid;
    });
    aoa.push(["", "TỔNG", fee, paid, Math.max(fee - paid, 0), ""]);
    addSheet(k === MAIN_SHEET ? `SỔ CHÍNH (${sh.weekLabel})` : k, aoa, [6, 26, 12, 12, 12, 28]);
  });

  const lg = [["Thời gian", "Loại", "Nội dung"]];
  (db.log || []).forEach((x) => lg.push([fmtTime(x.t), x.k === "pay" ? "Nộp tiền" : x.k === "tx" ? "Thu/Chi" : "Hệ thống", x.m]));
  addSheet("Nhật ký", lg, [16, 10, 90]);

  XLSX.writeFile(wb, `SO_QUY_12A6_${localISO()}.xlsx`);
  toast("📊 Đã xuất file Excel!", "ok");
}
