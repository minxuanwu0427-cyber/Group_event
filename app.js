/* ==========================================================================
   揪團懶人包 app.js (v3)
   - 用「代號」區分不同揪團，一台裝置可記住多組代號各自的身分
   - 人員完全由主揪管理（新增/命名/簡稱），一般人只能「選你是誰」
   - 新增交通分頁（抵達方式/時間 + 座車分配）
   - 總覽改版：日期、可收折名單、彩色卡片（房間/座車/行前準備）
   ========================================================================== */

const COLLECTION = "groupEvents";
const CODE_KEY = "groupEvent_code";

const DEFAULT_EVENT = {
  title: "揪團出遊",
  tripDates: { start: "", end: "" },
  meetup: { date: "", time: "", location: "", note: "" },
  people: [],            // {id, name, nickname, isOrganizer}
  rooms: [],              // {id, name, capacity}
  roomAssignments: {},    // personId -> roomId
  vehicles: [],           // {id, name, capacity}
  vehicleAssignments: {}, // personId -> vehicleId
  arrivals: {},           // personId -> { method, eta }
  prepItems: [],
  prepChecks: {},         // personId -> { itemId: true }
  infoBlocks: [
    { id: "i1", title: "住宿注意事項", content: "" },
    { id: "i2", title: "行程重點", content: "" }
  ],
  expenses: []            // {id, payerId, amount, note, splitAmong:[personId], createdAt}
};

const state = {
  eventCode: localStorage.getItem(CODE_KEY) || null,
  event: undefined,       // undefined=載入中 / null=此代號尚未建立 / object=正常資料
  currentUserId: null,
  ui: { tab: "overview", prepView: "self", expenseModal: false, infoEditId: null, rosterOpen: false, roomsSubTab: "room" }
};

function uid() { return "id_" + Math.random().toString(36).slice(2, 10); }
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function avatarText(p) { return esc(((p && (p.nickname || p.name)) || "?").trim().slice(0, 2)); }
function fmtMoney(n) { return Math.round(n).toLocaleString("zh-Hant"); }
function identityKey() { return "groupEvent_identity_" + state.eventCode; }

function me() {
  if (!state.event || !state.currentUserId) return null;
  return state.event.people.find(p => p.id === state.currentUserId) || null;
}
function isOrganizer() { const p = me(); return !!(p && p.isOrganizer); }
function personName(id) {
  const p = state.event && state.event.people.find(x => x.id === id);
  return p ? p.name : "（已移除）";
}
function canEditPerson(pid) { return isOrganizer() || pid === state.currentUserId; }

function formatTripDates(td) {
  const gap = "\u00A0\u00A0\u00A0"; // 用不換行空白隔開日期跟天數說明，較易讀
  if (!td || !td.start) return "尚未設定日期";
  if (!td.end || td.end === td.start) return td.start + gap + "當天來回";
  const d1 = new Date(td.start), d2 = new Date(td.end);
  const diff = Math.round((d2 - d1) / 86400000);
  if (isNaN(diff) || diff <= 0) return td.start + " → " + td.end;
  return td.start + " → " + td.end + gap + (diff + 1) + "天" + diff + "夜";
}

/* -------------------------------- Firestore -------------------------------- */
let unsub = null;
async function boot() {
  await window.authReady;
  if (state.eventCode) subscribe(state.eventCode);
  else render();
}
function subscribe(code) {
  if (unsub) { unsub(); unsub = null; }
  state.eventCode = code;
  state.event = undefined;
  const ref = db.collection(COLLECTION).doc(code);
  unsub = ref.onSnapshot(snap => {
    state.event = snap.exists ? normalizeEvent(snap.data()) : null;
    if (state.event) state.currentUserId = localStorage.getItem(identityKey()) || null;
    render();
  }, err => {
    console.error("Firestore 讀取失敗", err);
    document.getElementById("app").innerHTML = '<div class="empty-hint">連線失敗，請檢查網路後重新整理</div>';
  });
}
function normalizeEvent(data) {
  const e = Object.assign({}, DEFAULT_EVENT, data);
  e.tripDates = Object.assign({}, DEFAULT_EVENT.tripDates, data.tripDates || {});
  e.meetup = Object.assign({}, DEFAULT_EVENT.meetup, data.meetup || {});
  e.people = Array.isArray(data.people) ? data.people : [];
  e.rooms = Array.isArray(data.rooms) ? data.rooms : [];
  e.roomAssignments = data.roomAssignments || {};
  e.vehicles = Array.isArray(data.vehicles) ? data.vehicles : [];
  e.vehicleAssignments = data.vehicleAssignments || {};
  e.arrivals = data.arrivals || {};
  e.prepItems = Array.isArray(data.prepItems) ? data.prepItems : DEFAULT_EVENT.prepItems;
  e.prepChecks = data.prepChecks || {};
  e.infoBlocks = Array.isArray(data.infoBlocks) ? data.infoBlocks : DEFAULT_EVENT.infoBlocks;
  e.expenses = Array.isArray(data.expenses) ? data.expenses : [];
  return e;
}
function save() {
  db.collection(COLLECTION).doc(state.eventCode).set(state.event).catch(err => console.error("寫入失敗", err));
}
function mutate(fn) { fn(state.event); save(); render(); }

/* -------------------------------- 代號 / 身分 -------------------------------- */
function setCode(code) {
  code = (code || "").trim();
  if (!code) return;
  localStorage.setItem(CODE_KEY, code);
  subscribe(code);
}
function switchCode() {
  if (unsub) { unsub(); unsub = null; }
  localStorage.removeItem(CODE_KEY);
  state.eventCode = null; state.event = undefined; state.currentUserId = null;
  render();
}
function setIdentity(id) {
  state.currentUserId = id;
  localStorage.setItem(identityKey(), id);
  render();
}
function switchIdentity() {
  localStorage.removeItem(identityKey());
  state.currentUserId = null;
  render();
}

function renderCodeEntryScreen() {
  let html = '<div class="identity-screen">';
  html += '<h1>揪團懶人包</h1>';
  html += '<p style="margin:16px 0;color:var(--color-text-soft);font-size:14px;">請輸入這次揪團的代號</p>';
  html += '<input class="input" id="codeInput" placeholder="8碼數字" style="max-width:320px;margin-bottom:10px;text-align:center;">';
  html += '<button class="btn" data-act="submitCode">進入</button>';
  html += '</div>';
  return html;
}
function renderCreateEventScreen() {
  let html = '<div class="identity-screen">';
  html += '<h1>建立新揪團</h1>';
  html += '<p style="margin:16px 0;color:var(--color-text-soft);font-size:14px;">代號「' + esc(state.eventCode) + '」還沒有人建立，你是第一位，會自動成為主揪</p>';
  html += '<input class="input" id="newEventTitle" placeholder="這趟旅行的名稱（例如：南投包棟出遊）" style="max-width:320px;margin-bottom:10px;">';
  html += '<input class="input" id="newOrganizerName" placeholder="你的名字" style="max-width:320px;margin-bottom:10px;">';
  html += '<button class="btn" data-act="createEvent">建立揪團並加入</button>';
  html += '<button class="btn ghost small" style="margin-top:14px;" data-act="switchCode">代號輸入錯了？重新輸入</button>';
  html += '</div>';
  return html;
}
function renderIdentityScreen() {
  const e = state.event;
  let html = '<div class="identity-screen">';
  html += '<h1>' + esc(e.title) + '</h1>';
  if (!e.people.length) {
    html += '<p style="margin:16px 0;color:var(--color-text-soft);font-size:14px;">主揪還沒有新增任何團員，請聯絡主揪</p>';
  } else {
    html += '<p style="margin:16px 0;color:var(--color-text-soft);font-size:14px;">請選擇你是哪一位</p>';
    e.people.forEach(p => {
      html += '<button class="btn secondary" data-act="claimIdentity" data-id="' + p.id + '">' +
        esc(p.name) + (p.isOrganizer ? '（主揪）' : '') + '</button>';
    });
  }
  html += '<button class="btn ghost small" style="margin-top:14px;" data-act="switchCode">不是這個揪團？切換代號</button>';
  html += '</div>';
  return html;
}

/* -------------------------------- 總覽 -------------------------------- */
function renderOverview() {
  const e = state.event;
  const myRoom = e.rooms.find(r => r.id === e.roomAssignments[state.currentUserId]);
  const myVehicle = e.vehicles.find(v => v.id === e.vehicleAssignments[state.currentUserId]);
  const myChecks = e.prepChecks[state.currentUserId] || {};
  const myDone = e.prepItems.filter(it => myChecks[it.id]).length;

  let html = '<div class="card card-bordered">';
  html += '<div class="row"><h2>集合資訊</h2>' + (isOrganizer() ? '<button class="btn ghost small" data-act="editMeetup">編輯</button>' : '') + '</div>';
  if (e.meetup.date || e.meetup.location) {
    html += '<p style="margin-top:8px;font-size:14px;">🕒 ' + esc(e.meetup.date || "未定") + ' ' + esc(e.meetup.time || "") + '</p>';
    html += '<p style="margin-top:4px;font-size:14px;">📍 ' + esc(e.meetup.location || "未定") + '</p>';
    if (e.meetup.note) html += '<p style="margin-top:4px;font-size:13px;color:var(--color-text-soft);white-space:pre-wrap;">' + esc(e.meetup.note) + '</p>';
  } else {
    html += '<p class="empty-hint" style="padding:8px 0;">尚未填寫集合資訊</p>';
  }
  html += '</div>';

  html += '<div class="card card-bordered">';
  html += '<div class="row" data-act="toggleRoster" style="cursor:pointer;">' +
    '<h2>👥 團員名單（' + e.people.length + '）</h2><span class="chip neutral">' + (state.ui.rosterOpen ? "收合" : "展開") + '</span></div>';
  if (state.ui.rosterOpen) {
    html += '<div class="roster-grid">';
    e.people.forEach(p => {
      html += '<div class="roster-item"><div class="avatar small">' + avatarText(p) + '</div><span class="name">' + esc(p.name) + (p.isOrganizer ? ' 🙋🏻\u200d♂️' : '') + '</span></div>';
    });
    html += '</div>';
    if (isOrganizer()) {
      html += '<div class="divider"></div>';
      html += '<div class="row"><span class="section-title" style="margin:0;">團員管理</span><button class="btn ghost small" data-act="addPersonPrompt">＋新增團員</button></div>';
      e.people.forEach(p => {
        html += '<div class="person-line"><div class="avatar small">' + avatarText(p) + '</div><span class="name">' + esc(p.name) + (p.nickname ? '（' + esc(p.nickname) + '）' : '') + (p.isOrganizer ? ' 🙋🏻\u200d♂️主揪' : '') + '</span>';
        html += '<button class="btn ghost small" data-act="editPerson" data-id="' + p.id + '">編輯</button>';
        if (p.id !== state.currentUserId) {
          html += '<button class="btn ghost small" data-act="toggleOrganizer" data-id="' + p.id + '">' + (p.isOrganizer ? '取消主揪' : '設為主揪') + '</button>';
          html += '<button class="btn ghost small" data-act="removePerson" data-id="' + p.id + '">移除</button>';
        }
        html += '</div>';
      });
    }
  }
  html += '</div>';

  html += '<div class="section-title">我的分配</div>';
  html += '<div class="stat-grid">';
  html += statTile("t-cream", "🛏️", myRoom ? myRoom.name : "未分房", "我的房間", "rooms", "room");
  html += statTile("t-blue", "🚗", myVehicle ? myVehicle.name : "未分配", "我的座車", "rooms", "vehicle");
  html += statTile("t-mint", "✅", myDone + "/" + e.prepItems.length, "行前準備", "prep");
  html += '</div>';

  html += '<p style="text-align:center;margin-top:16px;"><button class="btn ghost small" data-act="switchIdentity">不是你？切換身分</button></p>';
  return html;
}
function statTile(cls, icon, value, label, tab, subTab) {
  return '<div class="stat-tile ' + cls + '" data-act="goTab" data-tab="' + tab + '"' + (subTab ? ' data-sub="' + subTab + '"' : '') + '>' +
    '<span class="stat-icon">' + icon + '</span>' +
    '<div><div class="stat-value" style="font-size:17px;">' + esc(value) + '</div><div class="stat-label">' + esc(label) + '</div></div>' +
    '</div>';
}

/* -------------------------------- 分房 -------------------------------- */
function renderRoomsTab() {
  const e = state.event;
  const org = isOrganizer();
  const sub = state.ui.roomsSubTab || "room";
  let html = '<div class="sub-tabs">';
  html += '<button class="' + (sub === "room" ? "active" : "") + '" data-act="setRoomsSubTab" data-v="room">🛏️ 房間</button>';
  html += '<button class="' + (sub === "vehicle" ? "active" : "") + '" data-act="setRoomsSubTab" data-v="vehicle">🚗 座車</button>';
  html += '</div>';

  if (sub === "room") {
    html += '<div class="card card-bordered">';
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
          html += '<div class="person-line"><div class="avatar small">' + avatarText(p) + '</div><span class="name">' + esc(p.name) + '</span>' +
            (canEditPerson(p.id) ? '<button class="btn ghost small" data-act="unassignRoom" data-id="' + p.id + '">移出</button>' : '') + '</div>';
        });
        html += '</div>';
      }
      html += '</div>';
    });
    html += '</div>';

    const unassigned = e.people.filter(p => !e.roomAssignments[p.id]);
    html += '<div class="card card-bordered">';
    html += '<h2 style="margin-bottom:8px;">未分房（' + unassigned.length + '/' + e.people.length + '）</h2>';
    if (!unassigned.length) html += '<p class="empty-hint">大家都分好房間了</p>';
    unassigned.forEach(p => {
      html += '<div class="person-line"><div class="avatar small">' + avatarText(p) + '</div><span class="name">' + esc(p.name) + (p.isOrganizer ? ' 🙋🏻\u200d♂️' : '') + '</span>';
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
  } else {
    html += renderTransportSection();

    html += '<div class="card card-bordered">';
    html += '<div class="row"><h2>座車分配</h2>' + (org ? '<button class="btn ghost small" data-act="addVehicle">＋新增座車</button>' : '') + '</div>';
    if (e.vehicles.length === 0) html += '<p class="empty-hint">尚未建立座車</p>';
    e.vehicles.forEach(v => {
      const members = e.people.filter(p => e.vehicleAssignments[p.id] === v.id);
      const full = v.capacity && members.length >= v.capacity;
      html += '<div class="room-card' + (full ? ' full' : '') + '">';
      html += '<div class="row"><strong>' + esc(v.name) + '</strong>' +
        '<span class="chip' + (full ? ' warn' : ' neutral') + '">' + members.length + (v.capacity ? "/" + v.capacity : "") + ' 人</span></div>';
      if (org) html += '<div style="margin-top:6px;"><button class="btn ghost small" data-act="editVehicle" data-id="' + v.id + '">編輯</button>' +
        '<button class="btn ghost small" data-act="deleteVehicle" data-id="' + v.id + '">刪除</button></div>';
      if (members.length) {
        html += '<div style="margin-top:8px;">';
        members.forEach(p => {
          html += '<div class="person-line"><div class="avatar small">' + avatarText(p) + '</div><span class="name">' + esc(p.name) + '</span>' +
            (canEditPerson(p.id) ? '<button class="btn ghost small" data-act="unassignVehicle" data-id="' + p.id + '">移出</button>' : '') + '</div>';
        });
        html += '</div>';
      }
      html += '</div>';
    });
    html += '</div>';

    const unassignedV = e.people.filter(p => !e.vehicleAssignments[p.id]);
    html += '<div class="card card-bordered">';
    html += '<h2 style="margin-bottom:8px;">未分配座車（' + unassignedV.length + '/' + e.people.length + '）</h2>';
    if (!unassignedV.length) html += '<p class="empty-hint">大家都分好座車了</p>';
    unassignedV.forEach(p => {
      html += '<div class="person-line"><div class="avatar small">' + avatarText(p) + '</div><span class="name">' + esc(p.name) + '</span>';
      if (canEditPerson(p.id) && e.vehicles.length) {
        html += '<select class="input input-compact" style="width:auto;" data-act="assignVehicle" data-id="' + p.id + '">';
        html += '<option value="">選座車</option>';
        e.vehicles.forEach(v => { html += '<option value="' + v.id + '">' + esc(v.name) + '</option>'; });
        html += '</select>';
      } else if (!e.vehicles.length) {
        html += '<span class="empty-hint" style="padding:0;">尚無座車</span>';
      }
      html += '</div>';
    });
    html += '</div>';
  }

  return html;
}

/* -------------------------------- 交通（併入座車內容） -------------------------------- */
function renderTransportSection() {
  const e = state.event;
  let html = '<div class="card card-bordered">';
  html += '<h2 style="margin-bottom:8px;">抵達方式與時間</h2>';
  e.people.forEach(p => {
    const a = e.arrivals[p.id] || {};
    const editable = canEditPerson(p.id);
    html += '<div style="padding:8px 0;border-bottom:1px solid var(--color-divider);">';
    html += '<div class="person-line" style="padding:0 0 6px;"><div class="avatar small">' + avatarText(p) + '</div><span class="name">' + esc(p.name) + '</span></div>';
    if (editable) {
      html += '<div class="row" style="gap:8px;">';
      html += '<input class="input input-compact" style="flex:1;" placeholder="交通方式（例如：台鐵）" data-act="editArrivalMethod" data-id="' + p.id + '" value="' + esc(a.method || "") + '">';
      html += '<input class="input input-compact" style="flex:1;" placeholder="預計時間（例如：12:53）" data-act="editArrivalEta" data-id="' + p.id + '" value="' + esc(a.eta || "") + '">';
      html += '</div>';
    } else {
      html += '<p style="font-size:13px;color:var(--color-text-soft);">' + (a.method || a.eta ? esc(a.method || "") + ' ・ ' + esc(a.eta || "") : "尚未填寫") + '</p>';
    }
    html += '</div>';
  });
  if (!e.people.length) html += '<p class="empty-hint">尚無團員</p>';
  html += '</div>';
  return html;
}

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
    e.people.forEach(p => { html += '<th>' + avatarText(p) + '</th>'; });
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
      html += '<p style="margin-top:8px;font-size:12.5px;color:var(--color-text-soft);">刪除項目：</p>';
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
    html += '<div style="font-size:12.5px;color:var(--color-text-soft);">' + esc(personName(ex.payerId)) + ' 付款 · ' + (ex.splitAmong || []).length + ' 人分攤</div></div>';
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
const TAB_ICONS = {
  overview: '<path d="M3 10.5 12 3l9 7.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 9.5V21h14V9.5" stroke-linecap="round" stroke-linejoin="round"/>',
  rooms: '<path d="M3 18v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 18h18" stroke-linecap="round"/><path d="M7 10V7a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v3" stroke-linecap="round" stroke-linejoin="round"/>',
  prep: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="m8 12 3 3 5-6" stroke-linecap="round" stroke-linejoin="round"/>',
  info: '<rect x="3" y="4" width="18" height="17" rx="3"/><path d="M16 2v4M8 2v4M3 9h18" stroke-linecap="round"/>',
  expense: '<path d="M3 7a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" stroke-linecap="round" stroke-linejoin="round"/><path d="M16 12h2" stroke-linecap="round"/>'
};
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
    html += '<button class="' + (state.ui.tab === t.id ? "active" : "") + '" data-act="goTab" data-tab="' + t.id + '" aria-label="' + t.label + '">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' + TAB_ICONS[t.id] + '</svg></button>';
  });
  html += '</div>';
  return html;
}

function render() {
  const app = document.getElementById("app");
  if (!state.eventCode) { app.innerHTML = renderCodeEntryScreen(); return; }
  if (state.event === undefined) { app.innerHTML = '<div class="empty-hint">載入中...</div>'; return; }
  if (state.event === null) { app.innerHTML = renderCreateEventScreen(); return; }
  if (!state.currentUserId || !me()) { app.innerHTML = renderIdentityScreen(); return; }

  let body = "";
  if (state.ui.tab === "overview") body = renderOverview();
  else if (state.ui.tab === "rooms") body = renderRoomsTab();
  else if (state.ui.tab === "prep") body = renderPrepTab();
  else if (state.ui.tab === "info") body = renderInfoTab();
  else if (state.ui.tab === "expense") body = renderExpenseTab();

  let html = '<div class="header"><div>' +
    '<div class="greet-small">Hi, ' + esc(me().name) + (isOrganizer() ? "（主揪）" : "") + '</div>' +
    '<h1 ' + (isOrganizer() ? 'data-act="editTitle" style="cursor:pointer;"' : '') + '>' + esc(state.event.title) + '</h1>' +
    '<div class="trip-date-line" ' + (isOrganizer() ? 'data-act="editTripDates" style="cursor:pointer;"' : '') + '>📅 ' + esc(formatTripDates(state.event.tripDates)) + '</div></div>' +
    '<div class="avatar-badge">' + avatarText(me()) + '</div></div>';
  html += body;
  if (state.ui.tab === "expense") html += '<button class="fab" data-act="openExpenseModal">＋</button>';
  html += renderTabbar();
  if (state.ui.expenseModal) html += renderExpenseModal();
  app.innerHTML = html;
}

/* -------------------------------- 事件委派 -------------------------------- */
document.addEventListener("click", e => {
  if (e.target.classList && e.target.classList.contains("modal-backdrop")) {
    state.ui.expenseModal = false; render(); return;
  }
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const act = el.dataset.act;
  const id = el.dataset.id;

  if (act === "submitCode") {
    setCode(document.getElementById("codeInput").value);
  } else if (act === "switchCode") {
    switchCode();
  } else if (act === "createEvent") {
    const title = document.getElementById("newEventTitle").value.trim() || DEFAULT_EVENT.title;
    const name = document.getElementById("newOrganizerName").value.trim();
    if (!name) return;
    const pid = uid();
    const ev = JSON.parse(JSON.stringify(DEFAULT_EVENT));
    ev.title = title;
    ev.people.push({ id: pid, name, nickname: name.slice(0, 2), isOrganizer: true });
    state.event = ev;
    save();
    setIdentity(pid);
  } else if (act === "claimIdentity") {
    setIdentity(id);
  } else if (act === "switchIdentity") {
    switchIdentity();
  } else if (act === "goTab") {
    state.ui.tab = el.dataset.tab;
    if (el.dataset.sub) state.ui.roomsSubTab = el.dataset.sub;
    render();
  } else if (act === "toggleRoster") {
    state.ui.rosterOpen = !state.ui.rosterOpen; render();
  } else if (act === "editTitle") {
    const t = window.prompt("旅行名稱", state.event.title);
    if (t && t.trim()) mutate(ev => { ev.title = t.trim(); });
  } else if (act === "editTripDates") {
    const ev0 = state.event;
    const start = window.prompt("出發日期（格式 YYYY-MM-DD，例如 2026-10-18）", ev0.tripDates.start) ?? ev0.tripDates.start;
    const end = window.prompt("結束日期（當天來回可留空或跟出發日相同）", ev0.tripDates.end) ?? ev0.tripDates.end;
    mutate(ev => { ev.tripDates = { start: start.trim(), end: end.trim() }; });
  } else if (act === "editMeetup") {
    const ev = state.event;
    const date = window.prompt("集合日期（例如 2026/10/18）", ev.meetup.date) ?? ev.meetup.date;
    const time = window.prompt("集合時間", ev.meetup.time) ?? ev.meetup.time;
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
  } else if (act === "addVehicle") {
    const name = window.prompt("座車名稱（例如：小美的車 / 9人座租車）"); if (!name) return;
    const cap = Number(window.prompt("可乘坐人數上限（可留空）", "4") || 0);
    mutate(ev => { ev.vehicles.push({ id: uid(), name, capacity: cap || 0 }); });
  } else if (act === "editVehicle") {
    const v = state.event.vehicles.find(x => x.id === id); if (!v) return;
    const name = window.prompt("座車名稱", v.name) ?? v.name;
    const cap = Number(window.prompt("可乘坐人數上限", v.capacity || 0) || 0);
    mutate(ev => { const vv = ev.vehicles.find(x => x.id === id); vv.name = name; vv.capacity = cap; });
  } else if (act === "deleteVehicle") {
    if (!confirm("確定刪除這台座車？裡面的人會變成未分配")) return;
    mutate(ev => {
      ev.vehicles = ev.vehicles.filter(x => x.id !== id);
      Object.keys(ev.vehicleAssignments).forEach(pid => { if (ev.vehicleAssignments[pid] === id) delete ev.vehicleAssignments[pid]; });
    });
  } else if (act === "unassignVehicle") {
    if (!canEditPerson(id)) return;
    mutate(ev => { delete ev.vehicleAssignments[id]; });
  } else if (act === "addPersonPrompt") {
    const name = window.prompt("團員姓名"); if (!name) return;
    const nickname = window.prompt("簡稱（顯示在頭像上，可留空）", name.slice(0, 2)) || name.slice(0, 2);
    mutate(ev => { ev.people.push({ id: uid(), name, nickname, isOrganizer: false }); });
  } else if (act === "editPerson") {
    const p = state.event.people.find(x => x.id === id); if (!p) return;
    const name = window.prompt("姓名", p.name) ?? p.name;
    const nickname = window.prompt("簡稱（顯示在頭像上）", p.nickname || name.slice(0, 2)) ?? p.nickname;
    mutate(ev => { const pp = ev.people.find(x => x.id === id); pp.name = name; pp.nickname = nickname; });
  } else if (act === "toggleOrganizer") {
    mutate(ev => { const p = ev.people.find(x => x.id === id); p.isOrganizer = !p.isOrganizer; });
  } else if (act === "removePerson") {
    if (!confirm("確定移除這位團員？")) return;
    mutate(ev => {
      ev.people = ev.people.filter(x => x.id !== id);
      delete ev.roomAssignments[id];
      delete ev.vehicleAssignments[id];
      delete ev.prepChecks[id];
      delete ev.arrivals[id];
    });
  } else if (act === "setRoomsSubTab") {
    state.ui.roomsSubTab = el.dataset.v; render();
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
    mutate(ev => { if (roomId) ev.roomAssignments[id] = roomId; else delete ev.roomAssignments[id]; });
  } else if (act === "assignVehicle") {
    const vehicleId = el.value;
    mutate(ev => { if (vehicleId) ev.vehicleAssignments[id] = vehicleId; else delete ev.vehicleAssignments[id]; });
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
  } else if (act === "editArrivalMethod") {
    mutate(ev => { ev.arrivals[id] = Object.assign({}, ev.arrivals[id], { method: el.value }); });
  } else if (act === "editArrivalEta") {
    mutate(ev => { ev.arrivals[id] = Object.assign({}, ev.arrivals[id], { eta: el.value }); });
  }
}, true);

boot();
