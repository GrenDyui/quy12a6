/* ==========================================================================
   render.js — Complete UI Renderer (Hero, Students, Batch Mode, Seat Map,
               Debt Matrix, Extra Campaigns, Ledger, Charts, Log & Trash)
   ========================================================================== */

import { MAIN_SHEET, NAMES, SEAT_DEFAULT, cloneSeat, validSeatMap } from "./config.js";
import { $, money, fmtK, esc, removeTones, parsePeriodEnd, fmtDMY, parseDMY, fmtTime, setMoneyAnimated } from "./utils.js";

const CHART_COLORS = ["#0284c7", "#10b981", "#6366f1", "#f43f5e", "#f59e0b", "#8b5cf6", "#06b6d4", "#ec4899", "#14b8a6", "#64748b"];

/* ---------- Core Financial Calculations ---------- */
export function getWeekOrder(db) {
  return Object.keys(db.sheets)
    .filter((k) => k !== MAIN_SHEET)
    .sort((a, b) => (parseInt(a.replace(/\D/g, ""), 10) || 0) - (parseInt(b.replace(/\D/g, ""), 10) || 0));
}

export function allSheets(db) {
  return getWeekOrder(db).concat([MAIN_SHEET]);
}

export function calcSheetKpi(sh) {
  let collected = 0, target = 0, paidCount = 0, eligible = 0, exempt = 0;
  sh.students.forEach((s) => {
    collected += Number(s.paid || 0);
    target += Number(s.fee || 0);
    if (s.fee > 0) {
      eligible++;
      if (s.paid >= s.fee) paidCount++;
    } else {
      exempt++;
    }
  });
  const mirror = sh.transactions.find((t) => t.auto);
  if (mirror) mirror.amount = collected;

  let otherIn = 0, totalOut = 0;
  sh.transactions.forEach((t) => {
    if (t.type === "Chi") totalOut += Number(t.amount || 0);
    else if (!t.auto) otherIn += Number(t.amount || 0);
  });
  const totalIn = collected + otherIn;
  const balance = Number(sh.opening || 0) + totalIn - totalOut;
  const rate = target ? Math.min(collected / target, 1) : 0;
  return { collected, otherIn, totalIn, totalOut, balance, target, paidCount, eligible, exempt, rate };
}

export function totalOweOf(db, stt) {
  let t = 0;
  allSheets(db).forEach((k) => {
    const s = db.sheets[k].students[stt - 1];
    t += Math.max(s.fee - s.paid, 0);
  });
  const ex = db.extra.items[stt - 1];
  t += Math.max(ex.due - ex.paid, 0);
  return t;
}

export function streakOf(db, stt) {
  const cols = allSheets(db);
  let n = 0;
  for (let i = cols.length - 1; i >= 0; i--) {
    const s = db.sheets[cols[i]].students[stt - 1];
    const ok = s.fee <= 0 || s.paid >= s.fee;
    if (ok) n++;
    else if (i === cols.length - 1) continue;
    else break;
  }
  return n;
}

export function badgesHtml(db, stt) {
  const n = streakOf(db, stt);
  if (n >= 8) return `<span class="pill gold">🏆 ${n} tuần liền</span>`;
  if (n >= 5) return `<span class="pill gold">⭐ ${n} tuần liền</span>`;
  if (n >= 3) return `<span class="pill gold">🔥 ${n} tuần liền</span>`;
  return "";
}

export function maskName(n) {
  const p = n.split(" ");
  if (p.length < 2) return n;
  return p.slice(0, -1).map((w) => w.charAt(0).toUpperCase() + ".").join("") + " " + p[p.length - 1];
}

export function avatarHtml(stt, visible, big = false) {
  if (!visible) return `<span class="avatar mask${big ? " lg" : ""}">•</span>`;
  const parts = NAMES[stt - 1].split(" ");
  return `<span class="avatar${big ? " lg" : ""}" style="--h:${(stt * 47) % 360}">${esc(parts[parts.length - 1].charAt(0).toUpperCase())}</span>`;
}

export function seatShortName(stt) {
  const w = NAMES[stt - 1].split(" ").filter((x) => x !== "Thị" && x !== "Văn");
  return w.slice(-2).join(" ");
}

function seatStatus(s) {
  if (s.fee === 0) return "s-free";
  if (s.paid >= s.fee) return "s-full";
  return s.paid > 0 ? "s-part" : "s-none";
}

function getSeatMap(db) {
  if (!validSeatMap(db.seatMap)) db.seatMap = cloneSeat(SEAT_DEFAULT);
  return db.seatMap;
}

function monthSpent(db) {
  const now = new Date();
  let tot = 0;
  allSheets(db).forEach((k) => {
    db.sheets[k].transactions.forEach((t) => {
      if (t.type !== "Chi") return;
      const d = parseDMY(t.date);
      if (d && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) {
        tot += t.amount;
      }
    });
  });
  return tot;
}

/* ---------- Master Render ---------- */
export function renderAll(ctx) {
  const { db, state, fxOn, isLight, canSee, privOn, getMe, dispName, updateAlerts, checkCelebrate } = ctx;
  if (!db.sheets[state.week]) state.week = MAIN_SHEET;

  document.body.classList.toggle("mode-viewer", !state.isAdmin);

  const badge = $("roleBadge");
  badge.textContent = state.isAdmin ? "👑 Thủ Quỹ · Toàn quyền" : "👁️ Bạn Học · Chỉ xem";
  badge.classList.toggle("is-admin", state.isAdmin);
  $("btnAdminText").textContent = state.isAdmin ? "Khoá sổ" : "Mở khoá Thủ Quỹ";

  // Cascade opening balances chronologically
  const order = allSheets(db);
  let prevBal = null;
  order.forEach((k) => {
    if (prevBal !== null) db.sheets[k].opening = prevBal;
    prevBal = calcSheetKpi(db.sheets[k]).balance;
  });

  const sh = db.sheets[state.week];
  const kpi = calcSheetKpi(sh);
  const fx = fxOn();

  $("subtitle").textContent = `${sh.weekLabel} · ${sh.period || "Đang hoạt động"}`;
  setMoneyAnimated("kpiBalance", kpi.balance, fx);
  $("kpiOpening").textContent = `Đầu kỳ: ${money(sh.opening)}`;
  setMoneyAnimated("kpiIn", kpi.totalIn, fx);
  $("kpiInSub").textContent = `Quỹ HS: ${money(kpi.collected)}${kpi.otherIn ? ` + Khác: ${money(kpi.otherIn)}` : ""}`;
  setMoneyAnimated("kpiOut", kpi.totalOut, fx);
  const diff = kpi.totalIn - kpi.totalOut;
  $("kpiOutSub").textContent = `Chênh lệch tuần: ${diff >= 0 ? "+" : ""}${money(diff)}`;

  const totalDebtAll = NAMES.reduce((acc, _, i) => acc + totalOweOf(db, i + 1), 0);
  setMoneyAnimated("kpiTotalDebt", totalDebtAll, fx);
  const debtorCountAll = NAMES.filter((_, i) => totalOweOf(db, i + 1) > 0).length;
  $("kpiTotalDebtSub").textContent = debtorCountAll ? `${debtorCountAll} bạn còn thiếu lũy kế` : "Không còn nợ lũy kế 🎉";

  $("kpiRate").textContent = `${Math.round(kpi.rate * 100)}%`;
  $("kpiCount").textContent = `${kpi.paidCount}/${kpi.eligible} đủ${kpi.exempt ? ` · ${kpi.exempt} miễn` : ""}`;
  $("kpiRing").style.strokeDashoffset = String(163.36 * (1 - kpi.rate));
  $("weekFeeLabel").textContent = `Mức đóng ${sh.weekLabel}: ${money(sh.weeklyFee || 20000)}/bạn`;
  const hFee = $("heroFeeChip");
  if (hFee) hFee.innerHTML = `Mức quỹ ${esc(sh.weekLabel)}: <b class="num">${money(sh.weeklyFee || 20000)}/bạn</b>`;
  const hBank = $("heroBankChip");
  if (hBank && db.bank) hBank.textContent = `💳 ${db.bank.bankId || "MB"} · ${db.bank.accountNo || ""}`;

  // Overdue week reminder for admin
  const main = db.sheets[MAIN_SHEET];
  const end = parsePeriodEnd(main.period);
  const alertEl = $("weekAlert");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (end && end < today && state.isAdmin) {
    alertEl.classList.remove("hidden");
    $("weekAlertText").textContent = `⏰ ${main.weekLabel} đã kết thúc ngày ${fmtDMY(end)}. Bấm “Chốt & Tạo tuần” để chuyển sang tuần mới.`;
  } else {
    alertEl.classList.add("hidden");
  }

  // Personal Lookup Select
  const lookup = $("quickStudentLookup");
  if (lookup.options.length <= 1) {
    NAMES.forEach((n, i) => lookup.add(new Option(`#${i + 1}. ${n}`, String(i + 1))));
  }
  const me = getMe();
  if (privOn()) {
    $("lookupTitle").textContent = "🔒 Chế độ riêng tư đang bật";
    $("lookupSub").textContent = me
      ? `Đang xem hồ sơ của: ${NAMES[me - 1]} (đổi người trong ⚙️ Cài đặt).`
      : "Chọn tên của bạn để xem chi tiết cá nhân và lấy mã VietQR.";
  } else {
    $("lookupTitle").textContent = "Tra cứu nhanh hồ sơ quỹ cá nhân";
    $("lookupSub").textContent = "Chọn tên học sinh để xem lịch sử các tuần, khoản phụ và mã VietQR.";
  }

  // Week Picker
  const wp = $("weekPicker");
  const orderedPicker = [MAIN_SHEET].concat(getWeekOrder(db).slice().reverse());
  wp.innerHTML = orderedPicker.map((k) => {
    const active = k === state.week;
    const lbl = k === MAIN_SHEET ? `⚡ ${esc(db.sheets[k].weekLabel)} (Hiện tại)` : esc(k);
    return `<button data-week="${esc(k)}" class="week-chip ${active ? "active" : ""}">${lbl}</button>`;
  }).join("");
  wp.querySelectorAll("button").forEach((b) => {
    b.onclick = () => {
      state.week = b.getAttribute("data-week");
      state.batchSelected.clear();
      renderAll(ctx);
    };
  });

  renderStudents(ctx, sh);
  renderMatrix(ctx);
  renderExtra(ctx);
  renderLedger(ctx, sh);
  renderCompare(ctx);
  renderGoals(ctx);
  renderCharts(ctx, sh, isLight);
  renderLog(ctx);
  updateAlerts();
  checkCelebrate(kpi);
}

/* ---------- Tab 1: Students List + Batch Collect + Classroom Seat Map ---------- */
export function renderStudents(ctx, sh) {
  const { db, state, canSee, privOn, dispName } = ctx;
  const q = removeTones(state.search.trim());
  const hideOthers = privOn();

  const list = sh.students
    .filter((s) => {
      const owe = Math.max(s.fee - s.paid, 0);
      const vis = canSee(s.stt);
      if (!vis && state.filter !== "all") return false;
      if (state.filter === "owe" && owe <= 0) return false;
      if (state.filter === "full" && owe > 0) return false;
      return !q || removeTones(dispName(s.stt)).includes(q) || String(s.stt) === q;
    })
    .slice()
    .sort((a, b) => {
      if (state.sort === "owe" && !hideOthers) return (b.fee - b.paid) - (a.fee - a.paid) || a.stt - b.stt;
      if (state.sort === "name") return a.name.split(" ").pop().localeCompare(b.name.split(" ").pop(), "vi") || a.stt - b.stt;
      return a.stt - b.stt;
    });

  let collected = 0, target = 0, oweCnt = 0;
  sh.students.forEach((s) => {
    collected += s.paid;
    target += s.fee;
    if (s.fee > 0 && s.paid < s.fee) oweCnt++;
  });
  const pct = target ? Math.min(collected / target, 1) * 100 : 0;

  $("collectBar").innerHTML = `
    <div class="row-between row-wrap">
      <span class="text-xs">Đã thu <b class="num">${money(collected)}</b> <span class="text-muted num">/ ${money(target)}</span></span>
      ${oweCnt ? `<span class="pill bad">Còn ${oweCnt} bạn chưa đủ</span>` : `<span class="pill ok">Cả lớp đã đủ 🎉</span>`}
    </div>
    <div class="bar-track mt-1">
      <div class="bar-fill" style="width:${pct.toFixed(1)}%;background:linear-gradient(90deg,#10b981,#38bdf8)"></div>
    </div>`;

  // Batch toolbar state
  const batchBar = $("batchBar");
  const batchBtn = $("btnBatchMode");
  if (batchBtn) {
    batchBtn.classList.toggle("btn-primary", state.batchMode);
    batchBtn.textContent = state.batchMode ? "✕ Tắt chọn nhiều" : "☑️ Chọn nhiều";
  }
  if (batchBar) {
    if (state.isAdmin && state.batchMode && state.view === "list") {
      batchBar.classList.remove("hidden");
      $("batchCountText").textContent = `Đã chọn ${state.batchSelected.size} bạn`;
      $("btnBatchPay").disabled = state.batchSelected.size === 0;
      $("btnBatchZero").disabled = state.batchSelected.size === 0;
    } else {
      batchBar.classList.add("hidden");
    }
  }

  const el = $("studentList");
  const scroll = el.scrollTop;
  el.innerHTML = list.length
    ? list.map((s) => {
        const vis = canSee(s.stt);
        const owe = Math.max(s.fee - s.paid, 0);
        const done = owe === 0;
        const key = esc(state.week);

        if (!vis) {
          return `
            <div class="list-row" style="opacity:.78">
              <div class="row-main">
                ${avatarHtml(s.stt, false)}
                <div class="flex-1">
                  <p class="row-title">${esc(dispName(s.stt))}</p>
                  <p class="row-meta">🔒 Chế độ riêng tư</p>
                </div>
              </div>
            </div>`;
        }

        const pctRow = s.fee > 0 ? Math.min(s.paid / s.fee, 1) * 100 : 100;
        const tag = s.exempt ? `<span class="pill gold" title="${esc(s.note)}">${s.fee === 0 ? "Miễn" : "Giảm"}</span>` : "";
        const checked = state.batchSelected.has(s.stt);

        return `
          <div class="list-row">
            <div class="row-main">
              ${state.isAdmin && state.batchMode
                ? `<input type="checkbox" class="batch-chk" data-stt="${s.stt}" ${checked ? "checked" : ""} style="width:18px;height:18px;accent-color:var(--accent);cursor:pointer">`
                : ""}
              <div class="row-main" style="cursor:pointer" data-profile="${s.stt}">
                ${avatarHtml(s.stt, true)}
                <div class="flex-1">
                  <p class="row-title">
                    <span class="text-muted text-xs num">#${s.stt}</span>
                    <span>${esc(s.name)}</span>
                    ${tag}
                    ${badgesHtml(db, s.stt)}
                  </p>
                  <p class="row-meta">
                    <span class="num">${money(s.paid)} / ${money(s.fee)}</span> ·
                    ${owe > 0
                      ? `<span class="c-rose font-bold num">Thiếu ${money(owe)}</span>`
                      : `<span class="c-emerald font-bold">Đã đủ</span>`}
                    ${s.note ? ` · <i>${esc(s.note)}</i>` : ""}
                  </p>
                  <div class="minibar ${owe > 0 ? "warn" : ""}"><i style="width:${pctRow.toFixed(0)}%"></i></div>
                </div>
              </div>
            </div>
            <div class="row-actions">
              ${owe > 0 ? `<button class="btn btn-sm btn-accent-soft" data-qr-week="${s.stt}" title="Hiện mã VietQR">📱 QR</button>` : ""}
              <button class="admin-only btn btn-sm ${done ? "" : "btn-emerald"}" data-toggle-full="${s.stt}">${done ? "Đặt 0đ" : "Nộp đủ"}</button>
              <button class="admin-only btn btn-icon" data-edit-pay="${s.stt}" data-sheet="${key}" title="Nhập số tiền / Miễn giảm">✏️</button>
            </div>
          </div>`;
      }).join("")
    : `<div class="p-4 text-center text-muted text-sm">Không tìm thấy học sinh phù hợp.</div>`;
  el.scrollTop = scroll;

  renderSeat(ctx, sh);
}

export function renderSeat(ctx, sh) {
  const { db, state, canSee } = ctx;
  const seat = state.view === "seat";
  $("studentList").classList.toggle("hidden", seat);
  $("seatView").classList.toggle("hidden", !seat);
  $("viewList").className = `btn btn-sm ${seat ? "" : "btn-primary"}`;
  $("viewSeat").className = `btn btn-sm ${seat ? "btn-primary" : ""}`;
  if (!seat) return;

  const map = getSeatMap(db);
  const cols = map.cols;
  const q = removeTones(state.search.trim());

  document.querySelectorAll(".seat-mode").forEach((b) => {
    b.classList.toggle("btn-primary", b.getAttribute("data-seatmode") === state.seatMode);
  });

  const hints = {
    quick: "Chạm vào học sinh để đổi nhanh giữa Nộp đủ và 0đ.",
    edit: "Chạm vào học sinh để nhập số tiền cụ thể.",
    swap: state.seatPick
      ? `Đang chọn ${NAMES[state.seatPick - 1]} — chạm bạn khác hoặc ô trống để đổi chỗ.`
      : "Chạm lần lượt 2 bạn để hoán đổi chỗ ngồi."
  };
  $("seatHint").textContent = `${map.label ? map.label + " · " : ""}${state.isAdmin ? hints[state.seatMode] : "Chạm vào chỗ ngồi để xem hồ sơ."}`;

  const maxRows = Math.max(...cols.map((c) => c.length));
  const tpl = cols.map((_, i) => (i > 0 && i % 2 === 0 ? "10px " : "") + "minmax(0,1fr)").join(" ");
  let html = `<div class="seat-grid" style="grid-template-columns:${tpl}">`;
  for (let r = 0; r < maxRows; r++) {
    for (let c = 0; c < cols.length; c++) {
      if (c > 0 && c % 2 === 0) html += `<div></div>`;
      const stt = cols[c][r];
      if (!stt) {
        html += `<div class="seat-empty" data-seat-empty="${c},${r}"></div>`;
        continue;
      }
      const s = sh.students[stt - 1];
      const vis = canSee(stt);
      let cls = "seat " + (vis ? seatStatus(s) : "s-mask");
      const match = !q || (vis && (removeTones(NAMES[stt - 1]).includes(q) || String(stt) === q));
      const fm = state.filter === "all" ? true : (state.filter === "owe" ? s.paid < s.fee : s.paid >= s.fee);
      if (!match || (vis && !fm)) cls += " dim";
      if (state.seatPick === stt) cls += " pick";
      const nm = vis ? esc(seatShortName(stt)) : esc(maskName(NAMES[stt - 1]));
      const am = vis
        ? (s.fee === 0 ? "miễn" : (s.paid >= s.fee ? "✓" : (s.paid > 0 ? `${fmtK(s.paid)}/${fmtK(s.fee)}` : `-${fmtK(s.fee)}`)))
        : "•";
      html += `<div class="${cls}" data-seat-tap="${stt}" title="${esc(vis ? NAMES[stt - 1] : "")}">
        <span class="sn">#${stt}</span>
        <span class="nm">${nm}</span>
        <span class="am">${am}</span>
      </div>`;
    }
  }
  html += `</div>
    <div class="row-between mt-2" style="gap:10px">
      <span class="seat-tag">🚪 CỬA VÀO ➜</span>
      <div class="seat-board flex-1" style="max-width:220px">BẢNG</div>
      <span class="seat-tag">🧑‍🏫 BÀN GV<br><span style="font-size:9px;font-weight:600">Cô Võ Thị Cúc</span></span>
    </div>`;
  $("seatMap").innerHTML = html;
}

/* ---------- Tab 2: Debt Matrix ---------- */
export function renderMatrix(ctx) {
  const { db, state, canSee, dispName } = ctx;
  const cols = allSheets(db);
  $("matrixHead").innerHTML = `<tr>
    <th>STT</th>
    <th>Họ và tên</th>
    ${cols.map((k) => `<th>${esc(db.sheets[k].weekLabel)}</th>`).join("")}
    <th>${esc(db.extra.title)}</th>
    <th class="text-right c-rose">Tổng nợ</th>
    ${state.isAdmin ? `<th>Thao tác</th>` : ""}
  </tr>`;

  const colSum = cols.map(() => 0);
  let exSum = 0, grand = 0, oweCount = 0;

  const rows = NAMES.map((name, idx) => {
    const stt = idx + 1;
    const vis = canSee(stt);
    let totalOwe = 0;

    const cells = cols.map((k, ci) => {
      const st = db.sheets[k].students[idx];
      const owe = Math.max(st.fee - st.paid, 0);
      totalOwe += owe;
      colSum[ci] += owe;
      if (!vis) return `<td class="text-center"><span class="cell-btn na">•</span></td>`;
      const cls = st.fee === 0 ? "na" : (owe === 0 ? "ok" : "bad");
      const txt = st.fee === 0 ? "miễn" : (owe === 0 ? "✓" : `-${fmtK(owe)}`);
      const attr = state.isAdmin ? `data-edit-pay="${stt}" data-sheet="${esc(k)}"` : `data-profile="${stt}"`;
      return `<td class="text-center"><button class="cell-btn ${cls}" ${attr}>${txt}</button></td>`;
    }).join("");

    const ex = db.extra.items[idx];
    const exOwe = Math.max(ex.due - ex.paid, 0);
    totalOwe += exOwe;
    exSum += exOwe;
    grand += totalOwe;
    if (totalOwe > 0) oweCount++;

    const exCell = vis
      ? `<button class="cell-btn ${exOwe === 0 ? "ok" : "bad"}" ${state.isAdmin ? `data-edit-extra="${stt}"` : `data-profile="${stt}"`}>${exOwe === 0 ? "✓" : `-${fmtK(exOwe)}`}</button>`
      : `<span class="cell-btn na">•</span>`;

    return `<tr>
      <td class="text-muted font-bold num">${stt}</td>
      <td ${vis ? `data-profile="${stt}" style="cursor:pointer"` : ""} class="font-bold">${esc(dispName(stt))}</td>
      ${cells}
      <td class="text-center">${exCell}</td>
      <td class="text-right font-black num ${vis ? (totalOwe > 0 ? "c-rose" : "c-emerald") : "text-muted"}">${vis ? money(totalOwe) : "•••"}</td>
      ${state.isAdmin ? `<td class="text-center">${totalOwe > 0 ? `<button class="btn btn-xs btn-emerald-soft" data-pay-all-debt="${stt}">Thu hết</button>` : `<span class="text-xs text-muted">✓</span>`}</td>` : ""}
    </tr>`;
  });

  $("matrixBody").innerHTML = rows.join("");
  const sumCell = (n) => `<td class="text-center text-xs num ${n > 0 ? "c-rose" : "c-emerald"}">${n > 0 ? fmtK(n) : "✓"}</td>`;
  $("matrixFoot").innerHTML = `<tr>
    <td colspan="2" class="c-accent">TỔNG NỢ (${oweCount}/${NAMES.length} bạn)</td>
    ${colSum.map(sumCell).join("")}
    ${sumCell(exSum)}
    <td class="text-right c-rose num">${money(grand)}</td>
    ${state.isAdmin ? `<td></td>` : ""}
  </tr>`;
}

/* ---------- Tab 3: Extra Fees + History ---------- */
export function renderExtra(ctx) {
  const { db, canSee, dispName } = ctx;
  const ex = db.extra;
  $("extraTitle").textContent = ex.title;
  let dueSum = 0, paidSum = 0, doneCnt = 0;
  ex.items.forEach((it) => {
    dueSum += it.due;
    paidSum += it.paid;
    if (it.paid >= it.due && it.due > 0) doneCnt++;
  });
  $("extraSummaryText").textContent = `Đã thu: ${money(paidSum)} / ${money(dueSum)} (${doneCnt}/${NAMES.length} bạn đủ)`;

  $("extraList").innerHTML = ex.items.map((it) => {
    const owe = Math.max(it.due - it.paid, 0);
    const vis = canSee(it.stt);
    if (!vis) {
      return `<div class="list-row" style="opacity:.78"><div class="row-main">${avatarHtml(it.stt, false)}<div><p class="row-title">${esc(dispName(it.stt))}</p><p class="row-meta">🔒 Chế độ riêng tư</p></div></div></div>`;
    }
    const pct = it.due > 0 ? Math.min(it.paid / it.due, 1) * 100 : 100;
    return `<div class="list-row">
      <div class="row-main" style="cursor:pointer" data-profile="${it.stt}">
        ${avatarHtml(it.stt, true)}
        <div class="flex-1">
          <p class="row-title"><span class="text-muted text-xs num">#${it.stt}</span> ${esc(it.name)}</p>
          <p class="row-meta num">${money(it.paid)} / ${money(it.due)}${owe > 0 ? ` · <span class="c-rose font-bold">Thiếu ${money(owe)}</span>` : ` · <span class="c-emerald font-bold">Đã đủ</span>`}</p>
          <div class="minibar ${owe > 0 ? "warn" : ""}"><i style="width:${pct.toFixed(0)}%"></i></div>
        </div>
      </div>
      <div class="row-actions">
        ${owe > 0 ? `<button class="btn btn-sm btn-accent-soft" data-qr-extra="${it.stt}">📱 QR</button>` : `<span class="pill ok">Đủ</span>`}
        <button class="admin-only btn btn-sm ${owe === 0 ? "" : "btn-primary"}" data-toggle-extra="${it.stt}">${owe === 0 ? "Đặt 0đ" : "Nộp đủ"}</button>
        <button class="admin-only btn btn-icon" data-edit-extra="${it.stt}">✏️</button>
      </div>
    </div>`;
  }).join("");

  // Archived extra campaigns
  const histBox = $("extraHistoryBox");
  const hist = db.extraHistory || [];
  if (hist.length) {
    histBox.classList.remove("hidden");
    $("extraHistoryList").innerHTML = hist.map((c, idx) => {
      const paid = c.items.reduce((a, x) => a + x.paid, 0);
      const due = c.items.reduce((a, x) => a + x.due, 0);
      const ok = c.items.filter((x) => x.paid >= x.due && x.due > 0).length;
      return `<div class="list-row">
        <div>
          <p class="row-title">${esc(c.title)} <span class="pill muted">Đã lưu trữ</span></p>
          <p class="row-meta num">Đã thu ${money(paid)} / ${money(due)} · ${ok}/${c.items.length} bạn đủ · ${fmtTime(c.closedAt)}</p>
        </div>
        <button class="admin-only btn btn-xs" data-restore-extra="${idx}">Mở lại</button>
      </div>`;
    }).join("");
  } else {
    histBox.classList.add("hidden");
  }
}

/* ---------- Tab 4: Ledger ---------- */
export function renderLedger(ctx, sh) {
  const { state } = ctx;
  const q = removeTones(state.txSearch.trim());
  const typeF = state.txFilter;
  const txs = sh.transactions.slice().reverse().filter((t) => {
    if (typeF !== "all" && t.type !== typeF) return false;
    return !q || removeTones(`${t.category} ${t.person} ${t.note}`).includes(q);
  });

  const sumIn = txs.filter((t) => t.type === "Thu").reduce((a, t) => a + t.amount, 0);
  const sumOut = txs.filter((t) => t.type === "Chi").reduce((a, t) => a + t.amount, 0);
  $("ledgerSummary").innerHTML = `
    <span>Hiển thị <b>${txs.length}</b> giao dịch</span>
    <span class="row-wrap" style="gap:12px">
      <span class="c-emerald font-bold num">+${money(sumIn)}</span>
      <span class="c-rose font-bold num">−${money(sumOut)}</span>
    </span>`;

  $("txList").innerHTML = txs.length
    ? txs.map((t) => {
        const isOut = t.type === "Chi";
        const id = Number(t.id) || 0;
        return `<div class="list-row">
          <div class="row-main">
            <div class="kpi-icon" style="background:${isOut ? "var(--rose-bg)" : "var(--emerald-bg)"};color:${isOut ? "var(--rose)" : "var(--emerald)"};font-weight:900">${isOut ? "↓" : "↑"}</div>
            <div class="flex-1">
              <p class="row-title">${esc(t.category)} ${t.auto ? `<span class="pill info">Tự động</span>` : ""}</p>
              <p class="row-meta">${esc(t.date)}${t.person ? ` · ${esc(t.person)}` : ""}${t.note ? ` · ${esc(t.note)}` : ""}</p>
            </div>
          </div>
          <div class="row-actions">
            <span class="font-black num text-sm ${isOut ? "c-rose" : "c-emerald"}">${isOut ? "−" : "+"}${money(t.amount)}</span>
            ${t.img ? `<button class="btn btn-icon" data-view-receipt="${esc(t.img)}" title="Xem ảnh biên lai">📎</button>` : ""}
            ${!t.auto ? `
              <button class="admin-only btn btn-icon" data-edit-tx="${id}" title="Sửa">✏️</button>
              <button class="admin-only btn btn-icon" data-del-tx="${id}" title="Xoá">🗑️</button>` : ""}
          </div>
        </div>`;
      }).join("")
    : `<div class="p-4 text-center text-muted text-sm">Chưa có giao dịch nào phù hợp.</div>`;
}

/* ---------- Tab 5: Compare, Goals & Charts ---------- */
export function renderCompare(ctx) {
  const { db, state } = ctx;
  const cols = allSheets(db);
  const idx = cols.indexOf(state.week);
  const prevKey = idx > 0 ? cols[idx - 1] : null;
  const cur = calcSheetKpi(db.sheets[state.week]);
  const pv = prevKey ? calcSheetKpi(db.sheets[prevKey]) : null;

  const tile = (label, val, delta, good, fmt, ico) => {
    let d = `<span class="text-xs text-muted">Tuần đầu tiên</span>`;
    if (delta !== null) {
      const up = delta > 0, zero = delta === 0;
      const cls = zero ? "info" : (up === good ? "ok" : "bad");
      d = `<span class="pill ${cls}">${zero ? "= " : up ? "▲ " : "▼ "}${fmt(Math.abs(delta))}</span> <span class="text-xs text-muted">vs ${esc(db.sheets[prevKey].weekLabel)}</span>`;
    }
    return `<div class="card kpi-card">
      <div class="kpi-head"><span>${label}</span><span>${ico}</span></div>
      <p class="kpi-val num">${val}</p>
      <div class="row-wrap">${d}</div>
    </div>`;
  };

  $("compareTiles").innerHTML =
    tile("Thu tuần này", money(cur.totalIn), pv ? cur.totalIn - pv.totalIn : null, true, money, "📈") +
    tile("Chi tuần này", money(cur.totalOut), pv ? cur.totalOut - pv.totalOut : null, false, money, "📉") +
    tile("Tỷ lệ nộp", `${Math.round(cur.rate * 100)}%`, pv ? Math.round((cur.rate - pv.rate) * 100) : null, true, (n) => `${n}%`, "🎯");
}

export function renderGoals(ctx) {
  const { db } = ctx;
  const bal = calcSheetKpi(db.sheets[MAIN_SHEET]).balance;
  const g = db.goal;
  const bud = db.budget.monthly;
  const sp = monthSpent(db);

  let html = `<div class="row-between row-wrap">
    <h2 class="panel-title">🎯 Mục tiêu quỹ & Hạn mức chi tháng</h2>
    <div class="admin-only row">
      <button id="btnOpenGoalModal" class="btn btn-sm btn-accent-soft">Đặt mục tiêu</button>
      <button id="btnOpenBudgetModal" class="btn btn-sm btn-amber-soft">Hạn mức tháng</button>
    </div>
  </div>`;

  if (g) {
    const pct = Math.min(Math.max(bal, 0) / g.target, 1) * 100;
    const remain = Math.max(g.target - bal, 0);
    let extraTxt = "";
    const dl = parseDMY(g.deadline);
    if (dl) {
      const days = Math.ceil((dl - new Date()) / 86400000);
      if (remain === 0) extraTxt = "Đã đạt mục tiêu 🎉";
      else if (days <= 0) extraTxt = `Đã quá hạn ${g.deadline}`;
      else {
        const weeks = Math.max(Math.ceil(days / 7), 1);
        const perWeek = Math.ceil(remain / weeks);
        const elig = Math.max(calcSheetKpi(db.sheets[MAIN_SHEET]).eligible, 1);
        extraTxt = `Còn ${days} ngày (${weeks} tuần) · cần thêm ~${money(perWeek)}/tuần ≈ ${money(Math.ceil(perWeek / elig / 1000) * 1000)}/bạn/tuần`;
      }
    } else if (remain === 0) {
      extraTxt = "Đã đạt mục tiêu 🎉";
    }
    html += `<div>
      <div class="row-between text-xs font-bold"><span>${esc(g.title)}</span><span class="num">${money(Math.max(bal, 0))} / ${money(g.target)} (${Math.round(pct)}%)</span></div>
      <div class="bar-track mt-1"><div class="bar-fill" style="width:${pct.toFixed(1)}%;background:linear-gradient(90deg,#38bdf8,#6366f1)"></div></div>
      ${extraTxt ? `<p class="text-xs text-muted mt-1">${esc(extraTxt)}</p>` : ""}
    </div>`;
  } else {
    html += `<p class="text-xs text-muted">Chưa đặt mục tiêu quỹ chung (VD: liên hoan cuối năm, kỷ yếu 12A6).</p>`;
  }

  if (bud > 0) {
    const bp = sp / bud;
    const col = bp >= 1 ? "linear-gradient(90deg,#fb7185,#e11d48)" : bp >= 0.7 ? "linear-gradient(90deg,#fbbf24,#f59e0b)" : "linear-gradient(90deg,#10b981,#38bdf8)";
    html += `<div>
      <div class="row-between text-xs font-bold"><span>Chi tiêu tháng ${new Date().getMonth() + 1}</span><span class="num">${money(sp)} / ${money(bud)} (${Math.round(bp * 100)}%)</span></div>
      <div class="bar-track mt-1"><div class="bar-fill" style="width:${Math.min(bp * 100, 100).toFixed(1)}%;background:${col}"></div></div>
      ${bp >= 1 ? `<p class="text-xs c-rose font-bold mt-1">⚠️ Đã vượt hạn mức chi tháng!</p>` : bp >= 0.7 ? `<p class="text-xs c-amber font-bold mt-1">Sắp chạm hạn mức chi tháng.</p>` : ""}
    </div>`;
  } else {
    html += `<p class="text-xs text-muted">Tháng ${new Date().getMonth() + 1} đã chi: <b class="num">${money(sp)}</b> (chưa đặt hạn mức).</p>`;
  }

  $("goalCard").innerHTML = html;
}

export function renderCharts(ctx, sh, isLight) {
  const { db, state, privOn } = ctx;
  if (!window.Chart || state.tab !== "charts") return;
  const th = isLight()
    ? { text: "#334155", grid: "rgba(15,23,42,.08)" }
    : { text: "#cbd5e1", grid: "rgba(148,163,184,.1)" };

  try {
    const cols = allSheets(db);
    const labels = [], dIn = [], dOut = [], dBal = [], dRate = [];
    cols.forEach((k) => {
      const s = db.sheets[k];
      const kp = calcSheetKpi(s);
      labels.push(s.weekLabel);
      dIn.push(kp.totalIn);
      dOut.push(kp.totalOut);
      dBal.push(kp.balance);
      dRate.push(Math.round(kp.rate * 100));
    });

    const tickK = (v) => `${(v / 1000).toLocaleString("vi-VN")}k`;
    const common = { responsive: true, maintainAspectRatio: false };
    const mk = (key, id, cfg) => {
      if (state.charts[key]) state.charts[key].destroy();
      state.charts[key] = new Chart($(id), cfg);
    };

    mk("w", "chartWeekly", {
      type: "bar",
      data: {
        labels,
        datasets: [
          { label: "Thu", data: dIn, backgroundColor: "#10b981", borderRadius: 6, maxBarThickness: 24 },
          { label: "Chi", data: dOut, backgroundColor: "#f43f5e", borderRadius: 6, maxBarThickness: 24 },
          { type: "line", label: "Tồn quỹ", data: dBal, borderColor: "#38bdf8", backgroundColor: "#38bdf8", tension: 0.35, pointRadius: 4 }
        ]
      },
      options: {
        ...common,
        plugins: {
          legend: { labels: { color: th.text } },
          tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${money(c.parsed.y)}` } }
        },
        scales: {
          x: { ticks: { color: th.text }, grid: { display: false } },
          y: { ticks: { color: th.text, callback: tickK }, grid: { color: th.grid } }
        }
      }
    });

    const catMap = {};
    sh.transactions.forEach((t) => {
      if (t.type === "Chi") catMap[t.category] = (catMap[t.category] || 0) + t.amount;
    });
    const empty = Object.keys(catMap).length === 0;
    const catEntries = empty ? { "Chưa có khoản chi": 1 } : catMap;
    mk("c", "chartCategory", {
      type: "doughnut",
      data: {
        labels: Object.keys(catEntries),
        datasets: [{ data: Object.values(catEntries), backgroundColor: empty ? ["#475569"] : CHART_COLORS, borderWidth: 0, hoverOffset: 6 }]
      },
      options: {
        ...common,
        cutout: "64%",
        plugins: {
          legend: { labels: { color: th.text } },
          tooltip: { enabled: !empty, callbacks: { label: (c) => `${c.label}: ${money(c.parsed)}` } }
        }
      }
    });

    mk("r", "chartRate", {
      type: "line",
      data: {
        labels,
        datasets: [{ label: "% đã nộp", data: dRate, borderColor: "#10b981", backgroundColor: "rgba(16,185,129,.16)", fill: true, tension: 0.35, pointRadius: 4 }]
      },
      options: {
        ...common,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => `${c.parsed.y}%` } }
        },
        scales: {
          x: { ticks: { color: th.text }, grid: { display: false } },
          y: { min: 0, max: 100, ticks: { color: th.text, callback: (v) => `${v}%` }, grid: { color: th.grid } }
        }
      }
    });

    const card = $("debtorsCard");
    if (privOn()) {
      card.style.display = "none";
      if (state.charts.d) { state.charts.d.destroy(); state.charts.d = null; }
    } else {
      card.style.display = "";
      const owes = NAMES.map((n, i) => ({ n, v: totalOweOf(db, i + 1) }))
        .filter((x) => x.v > 0)
        .sort((a, b) => b.v - a.v)
        .slice(0, 10);
      mk("d", "chartDebtors", {
        type: "bar",
        data: {
          labels: owes.length ? owes.map((x) => x.n.split(" ").slice(-2).join(" ")) : ["Không ai nợ 🎉"],
          datasets: [{ data: owes.length ? owes.map((x) => x.v) : [0], backgroundColor: "#f43f5e", borderRadius: 6, maxBarThickness: 18 }]
        },
        options: {
          ...common,
          indexAxis: "y",
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: (c) => money(c.parsed.x) } }
          },
          scales: {
            x: { ticks: { color: th.text, callback: tickK }, grid: { color: th.grid } },
            y: { ticks: { color: th.text }, grid: { display: false } }
          }
        }
      });
    }
  } catch {}
}

/* ---------- Tab 6: Activity Log & Trash ---------- */
export function renderLog(ctx) {
  const { db, state, privOn, getMe } = ctx;
  const q = removeTones(state.logSearch.trim());
  const f = state.logFilter;
  const items = (db.log || []).filter((x) => {
    if (f !== "all" && x.k !== f) return false;
    if (privOn() && x.k === "pay" && x.s && x.s !== getMe()) return false;
    return !q || removeTones(x.m).includes(q);
  });

  const ico = { pay: "💵", tx: "🧾", sys: "⚙️" };
  $("logList").innerHTML = items.length
    ? items.map((x) => `<div class="list-row">
        <div class="row-main">
          <div class="kpi-icon" style="background:var(--accent-bg)">${ico[x.k] || "•"}</div>
          <div class="flex-1">
            <p class="row-title" style="font-weight:600">${esc(x.m)}</p>
            <p class="row-meta num">${fmtTime(x.t)}</p>
          </div>
        </div>
      </div>`).join("")
    : `<div class="p-4 text-center text-muted text-sm">Chưa có hoạt động nào.</div>`;

  const tr = db.trash || [];
  $("trashList").innerHTML = tr.length
    ? tr.map((x, i) => {
        const t = x.tx;
        const wk = (db.sheets[x.sheet] && db.sheets[x.sheet].weekLabel) || x.sheet;
        return `<div class="list-row">
          <div class="flex-1">
            <p class="row-title">${esc(t.category)} · <span class="num ${t.type === "Chi" ? "c-rose" : "c-emerald"}">${money(t.amount)}</span></p>
            <p class="row-meta">${esc(wk)} · xoá lúc ${fmtTime(x.t)}</p>
          </div>
          <div class="row-actions">
            <button class="btn btn-sm btn-emerald" data-restore-trash="${i}">Khôi phục</button>
            <button class="btn btn-icon" data-purge-trash="${i}" title="Xoá vĩnh viễn">✕</button>
          </div>
        </div>`;
      }).join("")
    : `<div class="p-4 text-center text-muted text-sm">Thùng rác trống.</div>`;
}
