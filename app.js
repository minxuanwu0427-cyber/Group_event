/* ==========================================================================
   揪團懶人包 app.js
   單頁式 vanilla JS + Firestore，架構參考 travel-planner 專案
   ========================================================================== */

const EVENT_ID = "default";           // 目前只支援單一活動；之後要多團可比照舊站做切換機制
const COLLECTION = "groupEvents";     // 跟舊站的 trips collection 分開，避免資料互相污染
const IDENTITY_KEY = "groupEvent_identity_" + EVENT_ID;

const DEFAULT_EVENT = {
  title: "揪團出遊",
  meetup: { date: "", time: "", location: "", note: "" },
  people: [],           // {id, name, isOrganizer}
  rooms: [],             // {id, name, capacity}
  roomAssignments: {},   // personId -> roomId
  prepItems: [
    { id: "p1", label: "確認護照效期 / 證件" },
    { id: "p2", label: "旅平險投保" },
    { id: "p3", label: "個人藥品準備" }
  ],
  prepChecks: {},        // personId -> { itemId: true }
  infoBlocks: [
    { id: "i1", title: "住宿注意事項", content: "" },
    { id: "i2", title: "行程重點", content: "" }
  ],
  expenses: []           // {id, payerId, amount, note, splitAmong:[personId], createdAt}
};

const state = {
  event: null,
  currentUserId: localStorage.getItem(IDENTITY_KEY) || null,
  ui: { tab: "overview", prepView: "self", expenseModal: false, roomModal: false, infoEditId: null }
};

function uid() { return "id_" + Math.random().toString(36).slice(2, 10); }
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function initials(name) { return esc((name || "?").trim().slice(0, 1).toUpperCase()); }
function fmtMoney(n) { return Math.round(n).toLocaleString("zh-Hant"); }

function me() {
  if (!state.event || !state.currentUserId) return null;
  return state.event.people.find(p => p.id === state.currentUserId) || null;
}
function isOrganizer() { const p = me(); return !!(p && p.isOrganizer); }
function personName(id) {
  const p = state.event && state.event.people.find(x => x.id === id);
  return p ? p.name : "（已移除）";
}

/* -------------------------------- Firestore -------------------------------- */
let unsub = null;
async function boot() {
  await window.authReady;
  const ref = db.collection(COLLECTION).doc(EVENT_ID);
  unsub = ref.onSnapshot(snap => {
    if (!snap.exists) {
      ref.set(DEFAULT_EVENT).catch(err => console.error("初始化失敗", err));
      state.event = JSON.parse(JSON.stringify(DEFAULT_EVENT));
    } else {
      state.event = normalizeEvent(snap.data());
    }
    render();
  }, err => {
    console.error("Firestore 讀取失敗", err);
    document.getElementById("app").innerHTML = '<div class="empty-hint">連線失敗，請檢查網路後重新整理</div>';
  });
}

function normalizeEvent(data) {
  const e = Object.assign({}, DEFAULT_EVENT, data);
  e.meetup = Object.assign({}, DEFAULT_EVENT.meetup, data.meetup || {});
  e.people = Array.isArray(data.people) ? data.people : [];
  e.rooms = Array.isArray(data.rooms) ? data.rooms : [];
  e.roomAssignments = data.roomAssignments || {};
  e.prepItems = Array.isArray(data.prepItems) ? data.prepItems : DEFAULT_EVENT.prepItems;
  e.prepChecks = data.prepChecks || {};
  e.infoBlocks = Array.isArray(data.infoBlocks) ? data.infoBlocks : DEFAULT_EVENT.infoBlocks;
  e.expenses = Array.isArray(data.expenses) ? data.expenses : [];
  return e;
}

function save() {
  db.collection(COLLECTION).doc(EVENT_ID).set(state.event).catch(err => console.error("寫入失敗", err));
}
// mutate: function(event) -> void，直接改 state.event 後存檔並重繪
function mutate(fn) {
  fn(state.event);
  save();
  render();
}

/* -------------------------------- 身分識別 -------------------------------- */
function setIdentity(id) {
  state.currentUserId = id;
  localStorage.setItem(IDENTITY_KEY, id);
  render();
}
function switchIdentity() {
  localStorage.removeItem(IDENTITY_KEY);
  state.currentUserId = null;
  render();
}

function renderIdentityScreen() {
  const e = state.event;
  const hasAnyone = e.people.length > 0;
  let html = '<div class="identity-screen">';
  html += '<h1>' + esc(e.title) + '</h1>';
  if (!hasAnyone) {
    html += '<p style="margin:16px 0;color:var(--color-neutral-600);font-size:14px;">還沒有人建立這個揪團，輸入你的名字即可成為第一位主揪</p>';
    html += '<input class="input" id="newOrganizerName" placeholder="你的名字" style="max-width:320px;margin-bottom:10px;">';
    html += '<button class="btn" data-act="createFirstOrganizer">建立揪團並加入</button>';
  } else {
    html += '<p style="margin:16px 0;color:var(--color-neutral-600);font-size:14px;">請選擇你是哪一位</p>';
    e.people.forEach(p => {
      html += '<button class="btn secondary" data-act="claimIdentity" data-id="' + p.id + '">' +
        esc(p.name) + (p.isOrganizer ? '（主揪）' : '') + '</button>';
    });
    html += '<div class="divider" style="width:100%;max-width:320px;"></div>';
    html += '<p style="font-size:13px;color:var(--color-neutral-500);">名單裡沒有你？新增自己：</p>';
    html += '<input class="input" id="newMemberName" placeholder="你的名字" style="max-width:320px;margin-bottom:10px;">';
    html += '<button class="btn secondary" data-act="addSelfAsMember">加入這個揪團</button>';
  }
  html += '</div>';
  return html;
}

/* -------------------------------- 總覽 -------------------------------- */
function renderOverview() {
  const e = state.event;
  const totalPeople = e.people.length;
  const assignedCount = Object.keys(e.roomAssignments).filter(pid => e.people.some(p => p.id === pid)).length;
  const myChecks = e.prepChecks[state.currentUserId] || {};
  const myDone = e.prepItems.filter(it => myChecks[it.id]).length;
  const totalExpense = e.expenses.reduce((s, x) => s + Number(x.amount || 0), 0);
  const balances = computeBalances();
  const myBalance = balances[state.currentUserId] || 0;

  let html = '<div class="card card-bordered">';
  html += '<div class="row"><h2>集合資訊</h2>' + (isOrganizer() ? '<button class="btn ghost small" data-act="editMeetup">編輯</button>' : '') + '</div>';
  if (e.meetup.date || e.meetup.location) {
    html += '<p style="margin-top:8px;font-size:14px;">📅 ' + esc(e.meetup.date || "未定") + ' ' + esc(e.meetup.time || "") + '</p>';
    html += '<p style="margin-top:4px;font-size:14px;">📍 ' + esc(e.meetup.location || "未定") + '</p>';
    if (e.meetup.note) html += '<p style="margin-top:4px;font-size:13px;color:var(--color-neutral-600);white-space:pre-wrap;">' + esc(e.meetup.note) + '</p>';
  } else {
    html += '<p class="empty-hint" style="padding:8px 0;">尚未填寫集合資訊</p>';
  }
  html += '</div>';

  html += '<div class="card card-bordered">';
  html += '<h2 style="margin-bottom:10px;">重點總覽</h2>';
  html += statLine("👥 團員人數", totalPeople + " 人（已分房 " + assignedCount + "）", "rooms");
  html += statLine("✅ 我的行前準備", myDone + " / " + e.prepItems.length, "prep");
  html += statLine("💰 目前總花費", "NT$ " + fmtMoney(totalExpense), "expense");
  html += statLine("🧾 我的結算", (myBalance >= 0 ? "應收回 NT$ " + fmtMoney(myBalance) : "應付 NT$ " + fmtMoney(-myBalance)), "expense");
  html += '</div>';

  e.infoBlocks.filter(b => b.content).forEach(b => {
    html += '<div class="card card-bordered">';
    html += '<h2>' + esc(b.title) + '</h2>';
    html += '<p style="margin-top:8px;font-size:14px;white-space:pre-wrap;">' + esc(b.content) + '</p>';
    html += '</div>';
  });

  html += '<p style="text-align:center;margin-top:16px;"><button class="btn ghost small" data-act="switchIdentity">不是你？切換身分</button></p>';
  return html;
}
function statLine(label, value, tab) {
  return '<div class="row" data-act="goTab" data-tab="' + tab + '" style="cursor:pointer;padding:6px 0;">' +
    '<span style="font-size:14px;">' + label + '</span><span class="chip">' + value + '</span></div>';
}

/* -------------------------------- 人員 / 分房 -------------------------------- */
function renderRoomsTab() {
  const e = state.event;
  const org = isOrganizer();
  let html = '<div class="card card-bordered">';
  html += '<div class="row"><h2>房間分配</h2>' + (org ? '<button class="btn ghost small" data-act="addRoom">＋新增房間</button>' : '') + '</div>';
  if (e.rooms.length === 0) html += '<p class="empty-hint">尚未建立房間</p>';
  e.rooms.forEach(r => {
    const members = e.people.filter(p => e.roomAssignments[p.id] === r.id);
    const full = r.capacity && members.length >= r.capacity;
    html += '<div class="room-card' + (full ? ' full' : '') + '">';
    html += '<div class="row"><strong>' + esc(r.name) + '</strong>' +
      '<span class="chip' + (full ? ' warn' : ' neutral') + '">' + members.length + (r.capacity ? "/" + r.capacity : "") + ' 人</span></div>';
    if (org) html += '<div style="margin-top:6px;"><button class="btn ghost small" data-act="editRoom" data-id="' + r.id + '">編輯</button>' +
      '<button class="btn ghost small" data-act="deleteRoom" data-id="' + r.id + '">刪除</button></div>';
    if (members.length) {
      html += '<div style="margin-top:8px;">';
      members.forEach(p => {
        html += '<div class="person-line"><div class="avatar small">' + initials(p.name) + '</div><span class="name">' + esc(p.name) + '</span>' +
          (canEditPerson(p.id) ? '<button class="btn ghost small" data-act="unassignRoom" data-id="' + p.id + '">移出</button>' : '') + '</div>';
      });
      html += '</div>';
    }
    html += '</div>';
  });
  html += '</div>';

  const unassigned = e.people.filter(p => !e.roomAssignments[p.id]);
  html += '<div class="card card-bordered">';
  html += '<h2 style="margin-bottom:8px;">未分房（' + unassigned.length + '）</h2>';
  if (!unassigned.length) html += '<p class="empty-hint">大家都分好房間了</p>';
  unassigned.forEach(p => {
    html += '<div class="person-line"><div class="avatar small">' + initials(p.name) + '</div><span class="name">' + esc(p.name) + (p.isOrganizer ? ' 👑' : '') + '</span>';
    if (canEditPerson(p.id) && e.rooms.length) {
      html += '<select class="input input-compact" style="width:auto;" data-act="assignRoom" data-id="' + p.id + '">';
      html += '<option value="">選房間</option>';
      e.rooms.forEach(r => { html += '<option value="' + r.id + '">' + esc(r.name) + '</option>'; });
      html += '</select>';
    } else if (!e.rooms.length) {
      html += '<span class="empty-hint" style="padding:0;">尚無房間</span>';
    }
    html += '</div>';
  });
  html += '</div>';

  html += '<div class="card card-bordered">';
  html += '<div class="row"><h2>團員名單（' + e.people.length + '）</h2>' + '<button class="btn ghost small" data-act="addPersonPrompt">＋新增團員</button></div>';
  e.people.forEach(p => {
    html += '<div class="person-line"><div class="avatar small">' + initials(p.name) + '</div><span class="name">' + esc(p.name) + (p.isOrganizer ? ' 👑主揪' : '') + '</span>';
    if (org && p.id !== state.currentUserId) {
      html += '<button class="btn ghost small" data-act="toggleOrganizer" data-id="' + p.id + '">' + (p.isOrganizer ? '取消主揪' : '設為主揪') + '</button>';
      html += '<button class="btn ghost small" data-act="removePerson" data-id="' + p.id + '">移除</button>';
    }
    html += '</div>';
  });
  html += '</div>';
  return html;
}
function canEditPerson(pid) { return isOrganizer() || pid === state.currentUserId; }

/* -------------------------------- 行前準備 -------------------------------- */
function renderPrepTab() {
  const e = state.event;
  const org = isOrganizer();
  let html = '<div class="card card-bordered">';
  html += '<div class="row"><h2>行前準備</h2>';
  if (org) html += '<div><button class="btn ghost small" data-act="setPrepView" data-v="self">我的清單</button>' +
    '<button class="btn ghost small" data-act="setPrepView" data-v="matrix">全員進度</button></div>';
  html += '</div>';

  if (org && state.ui.prepView === "matrix") {
    html += '<div class="matrix-wrap"><table class="matrix"><thead><tr><th class="name-col">項目</th>';
    e.people.forEach(p => { html += '<th>' + esc(p.name.slice(0, 4)) + '</th>'; });
    html += '</tr></thead><tbody>';
    e.prepItems.forEach(it => {
      html += '<tr><td class="name-col">' + esc(it.label) + '</td>';
      e.people.forEach(p => {
        const done = !!((e.prepChecks[p.id] || {})[it.id]);
        html += '<td class="' + (done ? "yes" : "no") + '">' + (done ? "✓" : "—") + '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table></div>';
  } else {
    e.prepItems.forEach(it => {
      const done = !!((e.prepChecks[state.currentUserId] || {})[it.id]);
      html += '<div class="row" data-act="togglePrep" data-id="' + it.id + '" style="cursor:pointer;padding:8px 0;">' +
        '<span style="font-size:14px;">' + esc(it.label) + '</span>' +
        '<span class="chip' + (done ? '' : ' neutral') + '">' + (done ? "已完成" : "未完成") + '</span></div>';
    });
    if (!e.prepItems.length) html += '<p class="empty-hint">尚無項目</p>';
  }
  if (org) {
    html += '<div class="divider"></div>';
    html += '<div class="row"><input class="input" id="newPrepLabel" placeholder="新增項目名稱"><button class="btn small" data-act="addPrepItem">新增</button></div>';
    if (e.prepItems.length) {
      html += '<p style="margin-top:8px;font-size:12.5px;color:var(--color-neutral-500);">刪除項目：</p>';
      e.prepItems.forEach(it => { html += '<button class="btn ghost small" data-act="deletePrepItem" data-id="' + it.id + '">✕ ' + esc(it.label) + '</button>'; });
    }
  }
  html += '</div>';
  return html;
}

/* -------------------------------- 行程 / 住宿注意事項 -------------------------------- */
function renderInfoTab() {
  const e = state.event;
  const org = isOrganizer();
  let html = "";
  e.infoBlocks.forEach(b => {
    const editing = state.ui.infoEditId === b.id;
    html += '<div class="card card-bordered">';
    html += '<div class="row"><h2>' + esc(b.title) + '</h2>' +
      (org ? '<button class="btn ghost small" data-act="toggleInfoEdit" data-id="' + b.id + '">' + (editing ? "完成" : "編輯") + '</button>' : '') + '</div>';
    if (editing) {
      html += '<input class="input" style="margin:8px 0;" data-act="editInfoTitle" data-id="' + b.id + '" value="' + esc(b.title) + '">';
      html += '<textarea class="input" rows="5" data-act="editInfoContent" data-id="' + b.id + '">' + esc(b.content) + '</textarea>';
      html += '<button class="btn danger small" style="margin-top:8px;" data-act="deleteInfoBlock" data-id="' + b.id + '">刪除這個區塊</button>';
    } else {
      html += b.content
        ? '<p style="margin-top:8px;font-size:14px;white-space:pre-wrap;">' + esc(b.content) + '</p>'
        : '<p class="empty-hint">尚未填寫</p>';
    }
    html += '</div>';
  });
  if (org) html += '<p style="text-align:center;"><button class="btn secondary small" data-act="addInfoBlock">＋新增區塊</button></p>';
  return html;
}

/* -------------------------------- 記帳 -------------------------------- */
function computeBalances() {
  const e = state.event;
  const net = {};
  e.people.forEach(p => net[p.id] = 0);
  e.expenses.forEach(ex => {
    if (net[ex.payerId] === undefined) return;
    net[ex.payerId] += Number(ex.amount || 0);
    const among = (ex.splitAmong || []).filter(pid => net[pid] !== undefined);
    if (!among.length) return;
    const per = Number(ex.amount || 0) / among.length;
    among.forEach(pid => net[pid] -= per);
  });
  return net;
}
function computeSettlements(net) {
  const debtors = [], creditors = [];
  Object.keys(net).forEach(id => {
    const v = Math.round(net[id] * 100) / 100;
    if (v < -0.5) debtors.push({ id, amt: -v });
    else if (v > 0.5) creditors.push({ id, amt: v });
  });
  debtors.sort((a, b) => b.amt - a.amt);
  creditors.sort((a, b) => b.amt - a.amt);
  const result = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amt, creditors[j].amt);
    if (pay > 0.5) result.push({ from: debtors[i].id, to: creditors[j].id, amount: pay });
    debtors[i].amt -= pay; creditors[j].amt -= pay;
    if (debtors[i].amt <= 0.5) i++;
    if (creditors[j].amt <= 0.5) j++;
  }
  return result;
}

function renderExpenseTab() {
  const e = state.event;
  const total = e.expenses.reduce((s, x) => s + Number(x.amount || 0), 0);
  const balances = computeBalances();
  const settlements = computeSettlements(balances);

  let html = '<div class="card card-bordered">';
  html += '<h2>花費紀錄（總計 NT$ ' + fmtMoney(total) + '）</h2>';
  if (!e.expenses.length) html += '<p class="empty-hint">還沒有任何花費紀錄</p>';
  [...e.expenses].reverse().forEach(ex => {
    html += '<div class="row" style="padding:8px 0;border-bottom:1px solid var(--color-divider);">';
    html += '<div><div style="font-size:14px;font-weight:600;">' + esc(ex.note || "（無備註）") + '</div>';
    html += '<div style="font-size:12.5px;color:var(--color-neutral-500);">' + esc(personName(ex.payerId)) + ' 付款 · ' + (ex.splitAmong || []).length + ' 人分攤</div></div>';
    html += '<div style="text-align:right;"><div style="font-weight:700;">NT$ ' + fmtMoney(ex.amount) + '</div>';
    if (isOrganizer() || ex.payerId === state.currentUserId) html += '<button class="btn ghost small" data-act="deleteExpense" data-id="' + ex.id + '">刪除</button>';
    html += '</div></div>';
  });
  html += '</div>';

  html += '<div class="card card-bordered">';
  html += '<h2 style="margin-bottom:8px;">每人餘額</h2>';
  e.people.forEach(p => {
    const v = balances[p.id] || 0;
    html += '<div class="balance-row"><span>' + esc(p.name) + '</span>' +
      '<span class="amt ' + (v >= 0 ? "pos" : "neg") + '">' + (v >= 0 ? "應收 " : "應付 ") + 'NT$ ' + fmtMoney(Math.abs(v)) + '</span></div>';
  });
  html += '</div>';

  html += '<div class="card card-bordered">';
  html += '<h2 style="margin-bottom:8px;">結算建議（誰付給誰）</h2>';
  if (!settlements.length) html += '<p class="empty-hint">目前不需要轉帳，帳務已平衡</p>';
  settlements.forEach(s => {
    html += '<div class="balance-row"><span>' + esc(personName(s.from)) + ' → ' + esc(personName(s.to)) + '</span>' +
      '<span class="amt neg">NT$ ' + fmtMoney(s.amount) + '</span></div>';
  });
  html += '</div>';
  return html;
}

function renderExpenseModal() {
  const e = state.event;
  let html = '<div class="modal-backdrop"><div class="modal-sheet">';
  html += '<h2>新增花費</h2>';
  html += '<div class="form-field"><label>付款人</label><select class="input" id="expPayer">';
  e.people.forEach(p => { html += '<option value="' + p.id + '"' + (p.id === state.currentUserId ? " selected" : "") + '>' + esc(p.name) + '</option>'; });
  html += '</select></div>';
  html += '<div class="form-field"><label>金額（NT$）</label><input class="input" id="expAmount" type="number" inputmode="numeric" placeholder="0"></div>';
  html += '<div class="form-field"><label>備註</label><input class="input" id="expNote" placeholder="例如：晚餐、車資"></div>';
  html += '<div class="form-field"><label>分攤的人</label>';
  e.people.forEach(p => {
    html += '<label style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:14px;">' +
      '<input type="checkbox" class="expSplit" value="' + p.id + '" checked> ' + esc(p.name) + '</label>';
  });
  html += '</div>';
  html += '<button class="btn" style="width:100%;" data-act="submitExpense">儲存</button>';
  html += '</div></div>';
  return html;
}

/* -------------------------------- Tabbar / Shell -------------------------------- */
const TABS = [
  { id: "overview", label: "總覽" },
  { id: "rooms", label: "分房" },
  { id: "prep", label: "準備" },
  { id: "info", label: "行程" },
  { id: "expense", label: "記帳" }
];
function renderTabbar() {
  let html = '<div class="tabbar">';
  TABS.forEach(t => {
    html += '<button class="' + (state.ui.tab === t.id ? "active" : "") + '" data-act="goTab" data-tab="' + t.id + '">' + t.label + '</button>';
  });
  html += '</div>';
  return html;
}

function render() {
  const app = document.getElementById("app");
  if (!state.event) { app.innerHTML = '<div class="empty-hint">載入中...</div>'; return; }
  if (!state.currentUserId || !me()) {
    app.innerHTML = renderIdentityScreen();
    return;
  }
  let body = "";
  if (state.ui.tab === "overview") body = renderOverview();
  else if (state.ui.tab === "rooms") body = renderRoomsTab();
  else if (state.ui.tab === "prep") body = renderPrepTab();
  else if (state.ui.tab === "info") body = renderInfoTab();
  else if (state.ui.tab === "expense") body = renderExpenseTab();

  let html = '<div class="header"><h1>' + esc(state.event.title) + '</h1>' +
    '<div class="meta">Hi, ' + esc(me().name) + (isOrganizer() ? "（主揪）" : "") + '</div></div>';
  html += body;
  if (state.ui.tab === "expense") html += '<button class="fab" data-act="openExpenseModal">＋</button>';
  html += renderTabbar();
  if (state.ui.expenseModal) html += renderExpenseModal();
  app.innerHTML = html;
}

/* -------------------------------- 事件委派 -------------------------------- */
document.addEventListener("click", e => {
  // 點擊 modal 背景（而不是裡面的內容）時關閉 modal，用直接比對目標，不靠 closest，
  // 避免跟 sheet 內按鈕的事件委派互相干擾
  if (e.target.classList && e.target.classList.contains("modal-backdrop")) {
    state.ui.expenseModal = false; render(); return;
  }
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const act = el.dataset.act;
  const id = el.dataset.id;

  if (act === "createFirstOrganizer") {
    const name = document.getElementById("newOrganizerName").value.trim();
    if (!name) return;
    const pid = uid();
    mutate(ev => { ev.people.push({ id: pid, name, isOrganizer: true }); });
    setIdentity(pid);
  } else if (act === "claimIdentity") {
    setIdentity(id);
  } else if (act === "addSelfAsMember") {
    const name = document.getElementById("newMemberName").value.trim();
    if (!name) return;
    const pid = uid();
    mutate(ev => { ev.people.push({ id: pid, name, isOrganizer: false }); });
    setIdentity(pid);
  } else if (act === "switchIdentity") {
    switchIdentity();
  } else if (act === "goTab") {
    state.ui.tab = el.dataset.tab; render();
  } else if (act === "editMeetup") {
    const ev = state.event;
    const date = window.prompt("日期（例如 2026/11/1）", ev.meetup.date) ?? ev.meetup.date;
    const time = window.prompt("時間", ev.meetup.time) ?? ev.meetup.time;
    const location = window.prompt("集合地點", ev.meetup.location) ?? ev.meetup.location;
    const note = window.prompt("補充說明", ev.meetup.note) ?? ev.meetup.note;
    mutate(e2 => { e2.meetup = { date, time, location, note }; });
  } else if (act === "addRoom") {
    const name = window.prompt("房間名稱（例如：302 房）"); if (!name) return;
    const cap = Number(window.prompt("可住人數上限（可留空）", "4") || 0);
    mutate(ev => { ev.rooms.push({ id: uid(), name, capacity: cap || 0 }); });
  } else if (act === "editRoom") {
    const r = state.event.rooms.find(x => x.id === id); if (!r) return;
    const name = window.prompt("房間名稱", r.name) ?? r.name;
    const cap = Number(window.prompt("可住人數上限", r.capacity || 0) || 0);
    mutate(ev => { const rr = ev.rooms.find(x => x.id === id); rr.name = name; rr.capacity = cap; });
  } else if (act === "deleteRoom") {
    if (!confirm("確定刪除這個房間？裡面的人會變成未分房")) return;
    mutate(ev => {
      ev.rooms = ev.rooms.filter(x => x.id !== id);
      Object.keys(ev.roomAssignments).forEach(pid => { if (ev.roomAssignments[pid] === id) delete ev.roomAssignments[pid]; });
    });
  } else if (act === "unassignRoom") {
    if (!canEditPerson(id)) return;
    mutate(ev => { delete ev.roomAssignments[id]; });
  } else if (act === "addPersonPrompt") {
    const name = window.prompt("團員姓名"); if (!name) return;
    mutate(ev => { ev.people.push({ id: uid(), name, isOrganizer: false }); });
  } else if (act === "toggleOrganizer") {
    mutate(ev => { const p = ev.people.find(x => x.id === id); p.isOrganizer = !p.isOrganizer; });
  } else if (act === "removePerson") {
    if (!confirm("確定移除這位團員？")) return;
    mutate(ev => {
      ev.people = ev.people.filter(x => x.id !== id);
      delete ev.roomAssignments[id];
      delete ev.prepChecks[id];
    });
  } else if (act === "setPrepView") {
    state.ui.prepView = el.dataset.v; render();
  } else if (act === "togglePrep") {
    mutate(ev => {
      ev.prepChecks[state.currentUserId] = ev.prepChecks[state.currentUserId] || {};
      ev.prepChecks[state.currentUserId][id] = !ev.prepChecks[state.currentUserId][id];
    });
  } else if (act === "addPrepItem") {
    const inp = document.getElementById("newPrepLabel");
    const label = inp.value.trim(); if (!label) return;
    mutate(ev => { ev.prepItems.push({ id: uid(), label }); });
  } else if (act === "deletePrepItem") {
    mutate(ev => { ev.prepItems = ev.prepItems.filter(x => x.id !== id); });
  } else if (act === "toggleInfoEdit") {
    state.ui.infoEditId = state.ui.infoEditId === id ? null : id; render();
  } else if (act === "deleteInfoBlock") {
    if (!confirm("確定刪除這個區塊？")) return;
    mutate(ev => { ev.infoBlocks = ev.infoBlocks.filter(x => x.id !== id); });
    state.ui.infoEditId = null;
  } else if (act === "addInfoBlock") {
    const title = window.prompt("區塊標題（例如：交通方式）"); if (!title) return;
    mutate(ev => { ev.infoBlocks.push({ id: uid(), title, content: "" }); });
  } else if (act === "openExpenseModal") {
    state.ui.expenseModal = true; render();
  } else if (act === "submitExpense") {
    const payerId = document.getElementById("expPayer").value;
    const amount = Number(document.getElementById("expAmount").value || 0);
    const note = document.getElementById("expNote").value.trim();
    const splitAmong = Array.from(document.querySelectorAll(".expSplit:checked")).map(x => x.value);
    if (!amount || !splitAmong.length) { alert("請輸入金額並至少選一位分攤者"); return; }
    mutate(ev => { ev.expenses.push({ id: uid(), payerId, amount, note, splitAmong, createdAt: Date.now() }); });
    state.ui.expenseModal = false; render();
  } else if (act === "deleteExpense") {
    mutate(ev => { ev.expenses = ev.expenses.filter(x => x.id !== id); });
  }
});

document.addEventListener("change", e => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const act = el.dataset.act, id = el.dataset.id;
  if (act === "assignRoom") {
    const roomId = el.value;
    mutate(ev => {
      if (roomId) ev.roomAssignments[id] = roomId;
      else delete ev.roomAssignments[id];
    });
  }
});

document.addEventListener("blur", e => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const act = el.dataset.act, id = el.dataset.id;
  if (act === "editInfoTitle") {
    mutate(ev => { ev.infoBlocks.find(x => x.id === id).title = el.value; });
  } else if (act === "editInfoContent") {
    mutate(ev => { ev.infoBlocks.find(x => x.id === id).content = el.value; });
  }
}, true);

boot();
