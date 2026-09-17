/* ==========================================================================
   揪團懶人包 app.js (v3)
   - 用「代號」區分不同揪團，一台裝置可記住多組代號各自的身分
   - 人員完全由主揪管理（新增/命名/簡稱），一般人只能「選你是誰」
   - 新增交通分頁（抵達方式/時間 + 座車分配）
   - 總覽改版：日期、可收折名單、彩色卡片（房間/座車/行前準備）
   ========================================================================== */

const COLLECTION = "groupEvents";
const CODE_KEY = "groupEvent_code";
const CREATE_PASSWORD = "maxine"; // 建立新揪團時要輸入的密碼，避免不相干的人亂建立

const DEFAULT_EVENT = {
  title: "揪團出遊",
  tripDates: { start: "", end: "" },
  meetup: { date: "", time: "", location: "", note: "" },
  meetupGroups: [],       // {id, title, date, time, location, note, memberIds}
  people: [],            // {id, name, nickname, isOrganizer}
  rooms: [],              // {id, name, capacity}
  roomAssignments: {},    // personId -> roomId
  vehicles: [],           // {id, name, capacity}
  vehicleAssignments: {}, // personId -> vehicleId
  arrivals: {},           // personId -> { method, eta }
  prepItems: [],
  prepMemo: "",           // 主揪備忘錄，自由文字
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
  ui: { tab: "overview", expenseModal: false, infoEditId: null, rosterOpen: false, roomsSubTab: "room", viewMode: false, arrivalModalFor: null, arrivalMethodTemp: null, arrivalsOpen: false, balancesOpen: false, unassignedRoomsOpen: false, unassignedVehiclesOpen: false, expensesOpen: false, settlementModalOpen: false, prepTaskModalFor: null, meetupOpen: false, meetupGroupModalFor: null, finalMeetupModalOpen: false }
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
function canManage() { return isOrganizer() && !state.ui.viewMode; }
function personName(id) {
  const p = state.event && state.event.people.find(x => x.id === id);
  return p ? p.name : "（已移除）";
}
function canEditPerson(pid) { return canManage() || pid === state.currentUserId; }

function toSlashDate(s) { return (s || "").trim().replace(/-/g, "/"); }
function toMonthDay(s) {
  const parts = toSlashDate(s).split("/");
  return parts.length === 3 ? parts[1] + "/" + parts[2] : toSlashDate(s);
}
function parseDateAny(s) { return new Date((s || "").trim().replace(/\//g, "-")); }
function formatTripDates(td) {
  const gap = "\u00A0\u00A0\u00A0"; // 用不換行空白隔開日期跟天數說明，較易讀
  if (!td || !td.start) return "尚未設定日期";
  const start = toSlashDate(td.start), end = toSlashDate(td.end);
  if (!end || end === start) return start + gap + "當天來回";
  const diff = Math.round((parseDateAny(td.end) - parseDateAny(td.start)) / 86400000);
  if (isNaN(diff) || diff <= 0) return start + " → " + end;
  return start + " → " + end + gap + (diff + 1) + "天" + diff + "夜";
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
  e.meetupGroups = Array.isArray(data.meetupGroups) ? data.meetupGroups : [];
  e.people = Array.isArray(data.people) ? data.people : [];
  e.rooms = Array.isArray(data.rooms) ? data.rooms : [];
  e.roomAssignments = data.roomAssignments || {};
  e.vehicles = Array.isArray(data.vehicles) ? data.vehicles : [];
  e.vehicleAssignments = data.vehicleAssignments || {};
  e.arrivals = data.arrivals || {};
  e.prepMemo = data.prepMemo || "";
  e.prepItems = Array.isArray(data.prepItems) ? data.prepItems : DEFAULT_EVENT.prepItems;
  e.prepItems = e.prepItems.map(it => {
    if (Array.isArray(it.assigneeIds)) return it;
    return Object.assign({}, it, { assigneeIds: it.assigneeId ? [it.assigneeId] : [] });
  });
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
  html += '<input class="input" id="newEventPassword" type="password" placeholder="建立密碼" style="max-width:320px;margin-bottom:10px;">';
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
const strokeCollator = (() => {
  try { return new Intl.Collator("zh-Hant-u-co-stroke"); } catch (e) { return new Intl.Collator("zh-Hant"); }
})();
function sortedRoster(people) {
  return people.slice().sort((a, b) => {
    if (!!a.isOrganizer !== !!b.isOrganizer) return a.isOrganizer ? -1 : 1;
    return strokeCollator.compare(a.name || "", b.name || "");
  });
}
/* -------------------------------- 集合資訊 -------------------------------- */
function renderMeetupCard() {
  const e = state.event;
  const org = canManage();
  const myId = state.currentUserId;
  const groups = e.meetupGroups || [];
  const groupsToShow = state.ui.meetupOpen ? groups : groups.filter(g => (g.memberIds || []).includes(myId));
  const showGroupsBlock = state.ui.meetupOpen || groupsToShow.length > 0 || org;

  let html = '<div class="card card-bordered">';
  html += '<div class="row" data-act="toggleMeetup" style="cursor:pointer;">' +
    '<h2>集合資訊</h2><span class="chip neutral">' + (state.ui.meetupOpen ? "收合" : "展開") + '</span></div>';

  if (showGroupsBlock) {
    if (org) html += '<div style="margin-top:8px;"><button class="btn ghost small" data-act="openMeetupGroupModal">＋新增分組集合</button></div>';

    if (!groups.length) {
      html += '<p class="empty-hint" style="padding:8px 0;">尚未設定分組集合</p>';
    } else if (!groupsToShow.length) {
      html += '<p class="empty-hint" style="padding:8px 0;">你目前沒有被安排在任何分組</p>';
    } else {
      groupsToShow.forEach(g => {
        const members = e.people.filter(p => (g.memberIds || []).includes(p.id));
        html += '<div class="room-card" style="margin-top:8px;">';
        html += '<div class="row" style="align-items:center;flex-wrap:wrap;">';
        html += '<strong style="flex:1;">' + esc(g.title || "集合分組") + '</strong>';
        html += '<div style="display:flex;">';
        members.forEach((p, i) => { html += '<div class="avatar small" style="margin-left:' + (i > 0 ? "-4px" : "0") + ';box-shadow:0 0 0 2px var(--color-surface, #fff);">' + avatarText(p) + '</div>'; });
        html += '</div>';
        html += '</div>';
        if (g.date || g.time || g.location) {
          html += '<p style="margin-top:6px;font-size:13px;">🕒 ' + esc(toMonthDay(g.date) || "未定") + ' ' + esc(g.time || "") + '　📍 ' + esc(g.location || "未定") + '</p>';
        }
        if (g.note) html += '<p style="margin-top:4px;font-size:12.5px;color:var(--color-text-soft);white-space:pre-wrap;">' + esc(g.note) + '</p>';
        if (org) html += '<div style="margin-top:6px;"><button class="btn ghost small" data-act="openMeetupGroupModal" data-id="' + g.id + '">編輯</button>' +
          '<button class="btn ghost small" data-act="deleteMeetupGroup" data-id="' + g.id + '">刪除</button></div>';
        html += '</div>';
      });
    }
    html += '<div class="divider"></div>';
  }

  if (showGroupsBlock) html += '<div class="row"><h2 style="font-size:14px;">最終集合地點</h2>' + (org ? '<button class="btn ghost small" data-act="openFinalMeetupModal">編輯</button>' : '') + '</div>';
  else if (org) html += '<div class="row" style="justify-content:flex-end;"><button class="btn ghost small" data-act="openFinalMeetupModal">編輯</button></div>';

  if (e.meetup.date || e.meetup.location) {
    html += '<p style="margin-top:6px;font-size:14px;">🕒 ' + esc(toMonthDay(e.meetup.date) || "未定") + ' ' + esc(e.meetup.time || "") + '　📍 ' + esc(e.meetup.location || "未定") + '</p>';
    if (e.meetup.note) html += '<p style="margin-top:4px;font-size:13px;color:var(--color-text-soft);white-space:pre-wrap;">' + esc(e.meetup.note) + '</p>';
  } else {
    html += '<p class="empty-hint" style="padding:8px 0;">尚未填寫</p>';
  }
  html += '</div>';
  return html;
}
function renderMeetupGroupModal() {
  const e = state.event;
  const groupId = state.ui.meetupGroupModalFor;
  const isNew = groupId === "new";
  const g = isNew ? null : e.meetupGroups.find(x => x.id === groupId);
  const memberIds = g ? (g.memberIds || []) : [];
  let html = '<div class="modal-backdrop"><div class="modal-sheet">';
  html += '<h2>' + (isNew ? "新增分組集合" : "編輯分組集合") + '</h2>';
  html += '<div class="form-field"><label>分組名稱</label><input class="input" id="meetupGroupTitle" placeholder="例如：搭台鐵組" value="' + esc(g ? g.title : "") + '"></div>';
  html += '<div class="form-field"><label>日期</label><input class="input" type="date" id="meetupGroupDate" value="' + esc(g ? g.date : "") + '"></div>';
  html += '<div class="form-field"><label>時間</label><input class="input" type="time" id="meetupGroupTime" value="' + esc(g ? g.time : "") + '"></div>';
  html += '<div class="form-field"><label>地點</label><input class="input" id="meetupGroupLocation" placeholder="例如：新竹高鐵站" value="' + esc(g ? g.location : "") + '"></div>';
  html += '<div class="form-field"><label>備註</label><textarea class="input" id="meetupGroupNote" rows="2">' + esc(g ? g.note : "") + '</textarea></div>';
  html += '<div class="form-field"><label>這組集合的人</label>';
  e.people.forEach(p => {
    html += '<label style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:14px;">' +
      '<input type="checkbox" class="meetupGroupMember" value="' + p.id + '"' + (memberIds.includes(p.id) ? " checked" : "") + '> ' + esc(p.name) + '</label>';
  });
  html += '</div>';
  html += '<button class="btn" style="width:100%;" data-act="submitMeetupGroup" data-id="' + (isNew ? "" : groupId) + '">儲存</button>';
  html += '</div></div>';
  return html;
}
function renderFinalMeetupModal() {
  const m = state.event.meetup;
  let html = '<div class="modal-backdrop"><div class="modal-sheet">';
  html += '<h2>最終集合地點</h2>';
  html += '<div class="form-field"><label>日期</label><input class="input" type="date" id="finalMeetupDate" value="' + esc(m.date) + '"></div>';
  html += '<div class="form-field"><label>時間</label><input class="input" type="time" id="finalMeetupTime" value="' + esc(m.time) + '"></div>';
  html += '<div class="form-field"><label>地點</label><input class="input" id="finalMeetupLocation" placeholder="例如：南投火車站" value="' + esc(m.location) + '"></div>';
  html += '<div class="form-field"><label>補充說明</label><textarea class="input" id="finalMeetupNote" rows="2">' + esc(m.note) + '</textarea></div>';
  html += '<button class="btn" style="width:100%;" data-act="submitFinalMeetup">儲存</button>';
  html += '</div></div>';
  return html;
}

function renderOverview() {
  const e = state.event;
  const myRoom = e.rooms.find(r => r.id === e.roomAssignments[state.currentUserId]);
  const myVehicle = e.vehicles.find(v => v.id === e.vehicleAssignments[state.currentUserId]);
  const myTasks = e.prepItems.filter(it => (it.assigneeIds || []).includes(state.currentUserId));
  const roster = sortedRoster(e.people);

  let html = renderMeetupCard();

  html += '<div class="card card-bordered">';
  html += '<div class="row" data-act="toggleRoster" style="cursor:pointer;">' +
    '<h2>👥 團員名單（' + e.people.length + '）</h2><span class="chip neutral">' + (state.ui.rosterOpen ? "收合" : "展開") + '</span></div>';
  if (state.ui.rosterOpen) {
    html += '<div class="roster-grid">';
    roster.forEach(p => {
      html += '<div class="roster-item"><div class="avatar small">' + avatarText(p) + '</div><span class="name">' + esc(p.name) + (p.isOrganizer ? ' 🙋🏻\u200d♂️' : '') + '</span></div>';
    });
    html += '</div>';
    if (canManage()) {
      html += '<div class="divider"></div>';
      html += '<div class="row"><span class="section-title" style="margin:0;">團員管理</span><button class="btn ghost small" data-act="addPersonPrompt">＋新增團員</button></div>';
      roster.forEach(p => {
        html += '<div class="person-line"><div class="avatar small">' + avatarText(p) + '</div><span class="name">' + esc(p.name) + (p.isOrganizer ? ' 🙋🏻\u200d♂️主揪' : '') + '</span>';
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
  html += statTile("t-cream", "🛏️", myRoom ? myRoom.name : "未分房", "住哪房", "rooms", "room");
  html += statTile("t-pink", "🚗", myVehicle ? myVehicle.name : "未分配", "怎麼行動", "rooms", "vehicle");
  let taskValue;
  if (!myTasks.length) taskValue = ["未分配"];
  else taskValue = myTasks.map(it => it.label);
  html += statTile("t-mint", "📋", taskValue, "要幫忙什麼", canManage() ? "prep" : null);
  const balances = computeBalances();
  const settlements = computeSettlements(balances);
  const myPay = settlements.filter(s => s.from === state.currentUserId);
  const myReceive = settlements.filter(s => s.to === state.currentUserId);
  let feeValue;
  if (myPay.length) feeValue = myPay.map(s => "付" + personName(s.to) + " $" + fmtMoney(s.amount));
  else if (myReceive.length) feeValue = myReceive.map(s => "收" + personName(s.from) + " $" + fmtMoney(s.amount));
  else feeValue = ["已結清"];
  html += statTile("t-blue", "💰", feeValue, "目前費用", "expense");
  html += '</div>';

  html += '<p style="text-align:center;margin-top:16px;"><button class="btn ghost small" data-act="switchIdentity">不是你？切換身分</button></p>';
  html += '<p style="text-align:center;margin-top:4px;font-size:11px;color:var(--color-text-soft);opacity:.7;">代號 ' + esc(state.eventCode) + '</p>';
  return html;
}
function statTile(cls, icon, value, label, tab, subTab) {
  const lines = Array.isArray(value) ? value : [value];
  const valueHtml = lines.map(esc).join("<br>");
  const fontSize = lines.length > 1 ? "14px" : "17px";
  return '<div class="stat-tile ' + cls + '"' + (tab ? ' data-act="goTab" data-tab="' + tab + '"' : '') + (subTab ? ' data-sub="' + subTab + '"' : '') + '>' +
    '<div class="stat-top"><span class="stat-icon">' + icon + '</span><span class="stat-label">' + esc(label) + '</span></div>' +
    '<div class="stat-value" style="font-size:' + fontSize + ';line-height:1.4;">' + valueHtml + '</div>' +
    '</div>';
}

/* -------------------------------- 分房 -------------------------------- */
function renderRoomsTab() {
  const e = state.event;
  const org = canManage();
  const sub = state.ui.roomsSubTab || "room";
  let html = '<div class="sub-tabs">';
  html += '<button class="' + (sub === "room" ? "active" : "") + '" data-act="setRoomsSubTab" data-v="room">🛏️ 房間</button>';
  html += '<button class="' + (sub === "vehicle" ? "active" : "") + '" data-act="setRoomsSubTab" data-v="vehicle">🚗 座車</button>';
  html += '</div>';

  if (sub === "room") {
    const accommodationBlock = e.infoBlocks.find(b => b.id === "i1");
    if (accommodationBlock) html += renderInfoBlock(accommodationBlock);

    html += '<div class="card card-bordered">';
    html += '<div class="row"><h2>房間分配</h2>' + (org ? '<button class="btn ghost small" data-act="addRoom">＋新增房間</button>' : '') + '</div>';
    if (e.rooms.length === 0) html += '<p class="empty-hint">尚未建立房間</p>';
    e.rooms.forEach(r => {
      const members = e.people.filter(p => e.roomAssignments[p.id] === r.id);
      const full = r.capacity && members.length >= r.capacity;
      const mine = e.roomAssignments[state.currentUserId] === r.id;
      html += '<div class="room-card' + (full ? ' full' : '') + (mine ? ' mine-room' : '') + '">';
      html += '<div class="row"><strong>' + esc(r.name) + '</strong>' +
        '<span class="chip' + (full ? ' warn' : ' neutral') + '">' + members.length + (r.capacity ? "/" + r.capacity : "") + ' 人</span></div>';
      if (org) html += '<div style="margin-top:6px;"><button class="btn ghost small" data-act="editRoom" data-id="' + r.id + '">編輯</button>' +
        '<button class="btn ghost small" data-act="deleteRoom" data-id="' + r.id + '">刪除</button></div>';
      if (members.length) {
        html += '<div class="chip-grid grid-4" style="margin-top:8px;">';
        members.forEach(p => {
          html += '<div class="person-chip"><div class="avatar small">' + avatarText(p) + '</div><span class="name">' + esc(p.name) +
            (canEditPerson(p.id) ? ' <a class="x-remove" data-act="unassignRoom" data-id="' + p.id + '">✕</a>' : '') + '</span></div>';
        });
        html += '</div>';
      }
      html += '</div>';
    });
    html += '</div>';

    const unassigned = e.people.filter(p => !e.roomAssignments[p.id]);
    if (unassigned.length) {
      html += '<div class="card card-bordered card-dashed">';
      html += '<div class="row" data-act="toggleUnassignedRooms" style="cursor:pointer;">' +
        '<h2>未分房（' + unassigned.length + '/' + e.people.length + '）</h2><span class="chip neutral">' + (state.ui.unassignedRoomsOpen ? "收合" : "展開") + '</span></div>';
      if (state.ui.unassignedRoomsOpen) {
        html += '<div style="margin-top:8px;">';
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
      }
      html += '</div>';
    }
  } else {
    html += renderTransportSection();

    html += '<div class="card card-bordered">';
    html += '<div class="row"><h2>座車分配</h2>' + (org ? '<button class="btn ghost small" data-act="addVehicle">＋新增座車</button>' : '') + '</div>';
    if (e.vehicles.length === 0) html += '<p class="empty-hint">尚未建立座車</p>';
    e.vehicles.forEach(v => {
      const members = e.people.filter(p => e.vehicleAssignments[p.id] === v.id);
      const full = v.capacity && members.length >= v.capacity;
      const mine = e.vehicleAssignments[state.currentUserId] === v.id;
      html += '<div class="room-card' + (full ? ' full' : '') + (mine ? ' mine-vehicle' : '') + '">';
      html += '<div class="row"><strong>' + esc(v.name) + '</strong>' +
        '<span class="chip' + (full ? ' warn' : ' neutral') + '">' + members.length + (v.capacity ? "/" + v.capacity : "") + ' 人</span></div>';
      if (org) html += '<div style="margin-top:6px;"><button class="btn ghost small" data-act="editVehicle" data-id="' + v.id + '">編輯</button>' +
        '<button class="btn ghost small" data-act="deleteVehicle" data-id="' + v.id + '">刪除</button></div>';
      if (members.length) {
        html += '<div class="chip-grid grid-3" style="margin-top:8px;">';
        members.forEach(p => {
          html += '<div class="person-chip"><div class="avatar small">' + avatarText(p) + '</div><span class="name">' + esc(p.name) +
            (canEditPerson(p.id) ? ' <a class="x-remove" data-act="unassignVehicle" data-id="' + p.id + '">✕</a>' : '') + '</span></div>';
        });
        html += '</div>';
      }
      html += '</div>';
    });
    html += '</div>';

    const unassignedV = e.people.filter(p => !e.vehicleAssignments[p.id]);
    if (unassignedV.length) {
      html += '<div class="card card-bordered card-dashed">';
      html += '<div class="row" data-act="toggleUnassignedVehicles" style="cursor:pointer;">' +
        '<h2>未分配座車（' + unassignedV.length + '/' + e.people.length + '）</h2><span class="chip neutral">' + (state.ui.unassignedVehiclesOpen ? "收合" : "展開") + '</span></div>';
      if (state.ui.unassignedVehiclesOpen) {
        html += '<div style="margin-top:8px;">';
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
      html += '</div>';
    }
  }

  return html;
}

/* -------------------------------- 交通（併入座車內容） -------------------------------- */
const ARRIVAL_PRESETS = ["台鐵", "高鐵", "開車", "其他"];
function renderTransportSection() {
  const e = state.event;
  let html = '<div class="card card-bordered">';
  html += '<div class="row" data-act="toggleArrivals" style="cursor:pointer;">' +
    '<h2>抵達方式與時間</h2><span class="chip neutral">' + (state.ui.arrivalsOpen ? "收合" : "展開") + '</span></div>';
  html += '<div style="margin-top:8px;">';
  const sortedPeople = e.people.slice().sort((p1, p2) => {
    const A = e.arrivals[p1.id] || {}, B = e.arrivals[p2.id] || {};
    const aEmpty = !A.method && !A.eta, bEmpty = !B.method && !B.eta;
    if (aEmpty && !bEmpty) return 1;
    if (!aEmpty && bEmpty) return -1;
    if (aEmpty && bEmpty) return 0;
    const mCompare = (A.method || "").localeCompare(B.method || "", "zh-Hant");
    if (mCompare !== 0) return mCompare;
    return (A.eta || "").localeCompare(B.eta || "");
  });
  const peopleToShow = state.ui.arrivalsOpen ? sortedPeople : sortedPeople.filter(p => p.id === state.currentUserId);
  peopleToShow.forEach(p => {
    const a = e.arrivals[p.id] || {};
    const editable = canEditPerson(p.id);
    const parts = [a.method, a.location, a.eta].filter(Boolean);
    const summary = parts.length ? parts.map(esc).join("．") : "尚未填寫";
    html += '<div class="row" ' + (editable ? 'data-act="openArrivalModal" data-id="' + p.id + '"' : '') + ' style="padding:8px 0;border-bottom:1px solid var(--color-divider);' + (editable ? 'cursor:pointer;' : '') + '">';
    html += '<div class="person-line" style="padding:0;"><div class="avatar small">' + avatarText(p) + '</div><span class="name">' + esc(p.name) + '</span></div>';
    html += '<span class="' + (parts.length ? "" : "empty-hint") + '" style="font-size:13px;padding:0;">' + summary + '</span>';
    html += '</div>';
  });
  if (!e.people.length) html += '<p class="empty-hint">尚無團員</p>';
  html += '</div>';
  html += '</div>';
  return html;
}
function renderArrivalModal() {
  const pid = state.ui.arrivalModalFor;
  const p = state.event.people.find(x => x.id === pid);
  if (!p) return "";
  const a = state.event.arrivals[pid] || {};
  const isPreset = ARRIVAL_PRESETS.slice(0, 3).includes(a.method);
  const currentMethod = state.ui.arrivalMethodTemp || (isPreset ? a.method : (a.method ? "其他" : "台鐵"));
  let html = '<div class="modal-backdrop"><div class="modal-sheet">';
  html += '<h2>抵達方式・' + esc(p.name) + '</h2>';
  html += '<div class="form-field"><label>交通方式</label><select class="input" id="arrivalMethodSelect" data-act="arrivalMethodChange">';
  ARRIVAL_PRESETS.forEach(m => { html += '<option value="' + m + '"' + (currentMethod === m ? " selected" : "") + '>' + m + '</option>'; });
  html += '</select></div>';
  if (currentMethod === "其他") {
    html += '<div class="form-field"><label>請輸入交通方式</label><input class="input" id="arrivalMethodOther" value="' + esc(isPreset ? "" : (a.method || "")) + '"></div>';
  }
  html += '<div class="form-field"><label>抵達地點（例如：烏日站）</label><input class="input" id="arrivalLocationInput" value="' + esc(a.location || "") + '"></div>';
  html += '<div class="form-field"><label>預計抵達時間</label><input class="input" type="time" id="arrivalTimeInput" value="' + esc(a.eta || "") + '"></div>';
  html += '<button class="btn" style="width:100%;" data-act="submitArrival" data-id="' + pid + '">儲存</button>';
  html += '</div></div>';
  return html;
}

/* -------------------------------- 行前分工 -------------------------------- */
function renderPrepTab() {
  const e = state.event;
  const org = canManage();
  let html = '<div class="card card-bordered">';
  html += '<div class="row"><h2>行前分工</h2>' + (org ? '<button class="btn ghost small" data-act="openPrepTaskModal">＋新增任務</button>' : '') + '</div>';
  if (!e.prepItems.length) html += '<p class="empty-hint">尚未安排工作項目</p>';
  const myId = state.currentUserId;
  const items = e.prepItems.slice().sort((a, b) => {
    const aMine = (a.assigneeIds || []).includes(myId) ? 0 : 1;
    const bMine = (b.assigneeIds || []).includes(myId) ? 0 : 1;
    return aMine - bMine;
  });
  items.forEach(it => {
    const assignees = e.people.filter(p => (it.assigneeIds || []).includes(p.id));
    const isMine = (it.assigneeIds || []).includes(myId);
    html += '<div class="row" style="padding:8px 0;border-bottom:1px solid var(--color-divider);flex-wrap:wrap;">';
    html += '<span style="flex:1;font-size:14px;min-width:120px;">' + (isMine ? "★ " : "") + esc(it.label) + '</span>';
    if (assignees.length) {
      assignees.forEach(p => {
        html += '<div class="avatar small" style="margin-left:6px;">' + avatarText(p) + '</div>' +
          '<span class="name" style="margin-left:4px;margin-right:2px;font-size:13px;">' + esc(p.name) + '</span>';
      });
    } else {
      html += '<span class="empty-hint" style="padding:0;margin-left:6px;">尚未分配</span>';
    }
    if (org) {
      html += '<button class="btn ghost small" data-act="openPrepTaskModal" data-id="' + it.id + '" style="padding:4px 8px;">' +
        '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>';
      html += '<button class="btn ghost small" data-act="deletePrepTask" data-id="' + it.id + '">✕</button>';
    }
    html += '</div>';
  });
  html += '</div>';

  html += '<div class="card card-bordered">';
  html += '<h2 style="margin-bottom:8px;">備忘錄</h2>';
  const memoRows = Math.max(3, (e.prepMemo || "").split("\n").length + 1);
  html += '<textarea class="input" rows="' + memoRows + '" data-act="editPrepMemo" placeholder="給自己的提醒事項…" style="overflow:hidden;resize:none;" oninput="this.style.height=\'auto\';this.style.height=this.scrollHeight+\'px\';">' + esc(e.prepMemo || "") + '</textarea>';
  html += '</div>';
  return html;
}
function renderPrepTaskModal() {
  const e = state.event;
  const taskId = state.ui.prepTaskModalFor;
  const isNew = taskId === "new";
  const task = isNew ? null : e.prepItems.find(it => it.id === taskId);
  const assigneeIds = task ? (task.assigneeIds || []) : [];
  let html = '<div class="modal-backdrop"><div class="modal-sheet">';
  html += '<h2>' + (isNew ? "新增任務" : "編輯任務") + '</h2>';
  html += '<div class="form-field"><label>任務內容</label><input class="input" id="prepTaskLabel" placeholder="例如：租車、訂餐廳" value="' + esc(task ? task.label : "") + '"></div>';
  html += '<div class="form-field"><label>指派給</label>';
  e.people.forEach(p => {
    html += '<label style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:14px;">' +
      '<input type="checkbox" class="prepTaskAssignee" value="' + p.id + '"' + (assigneeIds.includes(p.id) ? " checked" : "") + '> ' + esc(p.name) + '</label>';
  });
  html += '</div>';
  html += '<button class="btn" style="width:100%;" data-act="submitPrepTask" data-id="' + (isNew ? "" : taskId) + '">儲存</button>';
  html += '</div></div>';
  return html;
}

/* -------------------------------- 行程 / 住宿注意事項 -------------------------------- */
function renderInfoBlock(b) {
  const org = canManage();
  const editing = state.ui.infoEditId === b.id;
  let html = '<div class="card card-bordered">';
  html += '<div class="row"><h2>' + esc(b.title) + '</h2>' +
    (org ? '<button class="btn ghost small" data-act="toggleInfoEdit" data-id="' + b.id + '">' + (editing ? "完成" : "編輯") + '</button>' : '') + '</div>';
  if (editing) {
    html += '<input class="input" style="margin:8px 0;" data-act="editInfoTitle" data-id="' + b.id + '" value="' + esc(b.title) + '">';
    const rows = Math.max(8, (b.content || "").split("\n").length + 2);
    html += '<textarea class="input" rows="' + rows + '" data-act="editInfoContent" data-id="' + b.id + '" style="overflow:hidden;" oninput="this.style.height=\'auto\';this.style.height=this.scrollHeight+\'px\';">' + esc(b.content) + '</textarea>';
    html += '<button class="btn danger small" style="margin-top:8px;" data-act="deleteInfoBlock" data-id="' + b.id + '">刪除這個區塊</button>';
  } else {
    html += b.content
      ? '<p style="margin-top:8px;font-size:14px;white-space:pre-wrap;">' + esc(b.content) + '</p>'
      : '<p class="empty-hint">尚未填寫</p>';
  }
  html += '</div>';
  return html;
}
function renderInfoTab() {
  const e = state.event;
  const org = canManage();
  let html = "";
  e.infoBlocks.filter(b => b.id !== "i1").forEach(b => { html += renderInfoBlock(b); });
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
  const myBalance = balances[state.currentUserId] || 0;

  let html = '<div class="card card-bordered">';
  html += '<h2 style="margin-bottom:10px;">目前費用</h2>';
  html += '<div class="row" style="padding:4px 0;"><span style="font-size:14px;">團體總花費</span><span>NT$ ' + fmtMoney(total) + '</span></div>';
  html += '<div class="row" style="padding:4px 0;"><span style="font-size:14px;">我的結算</span><span class="amt ' + (myBalance >= 0 ? "pos" : "neg") + '" style="font-weight:700;">' + (myBalance >= 0 ? "應收 " : "應付 ") + 'NT$ ' + fmtMoney(Math.abs(myBalance)) + '</span></div>';
  html += '<button class="btn secondary" style="width:100%;margin-top:10px;" data-act="openSettlementModal">結算明細</button>';
  html += '</div>';

  html += '<div class="card card-bordered">';
  html += '<div class="row" data-act="toggleExpenses" style="cursor:pointer;">' +
    '<h2>花費紀錄</h2><span class="chip neutral">' + (state.ui.expensesOpen ? "收合" : "展開") + '</span></div>';
  const allExpenses = [...e.expenses].reverse();
  const expensesToShow = state.ui.expensesOpen ? allExpenses : allExpenses.filter(ex => ex.payerId === state.currentUserId || (ex.splitAmong || []).includes(state.currentUserId));
  if (!e.expenses.length) html += '<p class="empty-hint">還沒有任何花費紀錄</p>';
  else if (!expensesToShow.length) html += '<p class="empty-hint">沒有跟你相關的花費紀錄</p>';
  expensesToShow.forEach(ex => {
    html += '<div class="row" style="padding:8px 0;border-bottom:1px solid var(--color-divider);">';
    html += '<div><div style="font-size:14px;font-weight:600;">' + esc(ex.note || "（無備註）") + '</div>';
    html += '<div style="font-size:12.5px;color:var(--color-text-soft);">' + esc(personName(ex.payerId)) + ' 付款 · ' + (ex.splitAmong || []).length + ' 人分攤</div></div>';
    html += '<div style="text-align:right;"><div style="font-weight:700;">NT$ ' + fmtMoney(ex.amount) + '</div>';
    if (canManage() || ex.payerId === state.currentUserId) {
      html += '<button class="btn ghost small" data-act="editExpense" data-id="' + ex.id + '">編輯</button>';
      html += '<button class="btn ghost small" data-act="deleteExpense" data-id="' + ex.id + '">刪除</button>';
    }
    html += '</div></div>';
  });
  html += '</div>';
  return html;
}
function renderSettlementModal() {
  const e = state.event;
  const balances = computeBalances();
  const settlements = computeSettlements(balances);
  let html = '<div class="modal-backdrop"><div class="modal-sheet">';
  html += '<h2>結算明細</h2>';
  html += '<div class="row" data-act="toggleBalances" style="cursor:pointer;">' +
    '<div class="section-title" style="margin:0;">每人餘額</div><span class="chip neutral">' + (state.ui.balancesOpen ? "收合" : "展開") + '</span></div>';
  const peopleToShow = state.ui.balancesOpen ? e.people : e.people.filter(p => p.id === state.currentUserId);
  peopleToShow.forEach(p => {
    const v = balances[p.id] || 0;
    html += '<div class="balance-row"><span>' + esc(p.name) + '</span>' +
      '<span class="amt ' + (v >= 0 ? "pos" : "neg") + '">' + (v >= 0 ? "應收 " : "應付 ") + 'NT$ ' + fmtMoney(Math.abs(v)) + '</span></div>';
  });
  html += '<div class="divider"></div>';
  html += '<div class="section-title">結算建議（誰付給誰）</div>';
  if (!settlements.length) html += '<p class="empty-hint">目前不需要轉帳，帳務已平衡</p>';
  settlements.forEach(s => {
    html += '<div class="balance-row"><span>' + esc(personName(s.from)) + ' → ' + esc(personName(s.to)) + '</span>' +
      '<span class="amt neg">NT$ ' + fmtMoney(s.amount) + '</span></div>';
  });
  html += '<button class="btn" style="width:100%;margin-top:14px;" data-act="closeSettlementModal">關閉</button>';
  html += '</div></div>';
  return html;
}
function renderExpenseModal() {
  const e = state.event;
  const editId = state.ui.expenseModal === true ? null : state.ui.expenseModal;
  const ex = editId ? e.expenses.find(x => x.id === editId) : null;
  let html = '<div class="modal-backdrop"><div class="modal-sheet">';
  html += '<h2>' + (ex ? "編輯花費" : "新增花費") + '</h2>';
  html += '<div class="form-field"><label>付款人</label><select class="input" id="expPayer">';
  e.people.forEach(p => { html += '<option value="' + p.id + '"' + ((ex ? ex.payerId : state.currentUserId) === p.id ? " selected" : "") + '>' + esc(p.name) + '</option>'; });
  html += '</select></div>';
  html += '<div class="form-field"><label>金額（NT$）</label><input class="input" id="expAmount" type="number" inputmode="numeric" placeholder="0" value="' + (ex ? ex.amount : "") + '"></div>';
  html += '<div class="form-field"><label>備註</label><input class="input" id="expNote" placeholder="例如：晚餐、車資" value="' + esc(ex ? ex.note : "") + '"></div>';
  html += '<div class="form-field"><label>分攤的人</label>';
  const splitSet = ex ? (ex.splitAmong || []) : e.people.map(p => p.id);
  e.people.forEach(p => {
    html += '<label style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:14px;">' +
      '<input type="checkbox" class="expSplit" value="' + p.id + '"' + (splitSet.includes(p.id) ? " checked" : "") + '> ' + esc(p.name) + '</label>';
  });
  html += '</div>';
  html += '<button class="btn" style="width:100%;" data-act="submitExpense" data-id="' + (editId || "") + '">儲存</button>';
  html += '</div></div>';
  return html;
}

/* -------------------------------- Tabbar / Shell -------------------------------- */
const TAB_ICONS = {
  overview: '<path d="M3 10.5 12 3l9 7.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 9.5V21h14V9.5" stroke-linecap="round" stroke-linejoin="round"/>',
  rooms: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87" stroke-linecap="round" stroke-linejoin="round"/><path d="M16 3.13a4 4 0 0 1 0 7.75" stroke-linecap="round" stroke-linejoin="round"/>',
  prep: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="m8 12 3 3 5-6" stroke-linecap="round" stroke-linejoin="round"/>',
  info: '<rect x="3" y="4" width="18" height="17" rx="3"/><path d="M16 2v4M8 2v4M3 9h18" stroke-linecap="round"/>',
  expense: '<path d="M12 2v20" stroke-linecap="round"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" stroke-linecap="round" stroke-linejoin="round"/>'
};
const TABS = [
  { id: "overview", label: "總覽" },
  { id: "rooms", label: "分房" },
  { id: "prep", label: "準備" },
  { id: "info", label: "行程" },
  { id: "expense", label: "記帳" }
];
function renderTabbar() {
  const tabs = TABS.filter(t => t.id !== "prep" || canManage());
  let html = '<div class="tabbar">';
  tabs.forEach(t => {
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
  if (state.ui.tab === "prep" && !canManage()) state.ui.tab = "overview";

  let body = "";
  if (state.ui.tab === "overview") body = renderOverview();
  else if (state.ui.tab === "rooms") body = renderRoomsTab();
  else if (state.ui.tab === "prep") body = renderPrepTab();
  else if (state.ui.tab === "info") body = renderInfoTab();
  else if (state.ui.tab === "expense") body = renderExpenseTab();

  let html = '<div class="header"><div>' +
    '<div class="greet-small">Hi, ' + esc(me().name) + (canManage() ? "（主揪）" : "") + '</div>' +
    '<h1 ' + (canManage() ? 'data-act="editTitle" style="cursor:pointer;"' : '') + '>' + esc(state.event.title) + '</h1>' +
    '<div class="trip-date-line" ' + (canManage() ? 'data-act="editTripDates" style="cursor:pointer;"' : '') + '>📅 ' + esc(formatTripDates(state.event.tripDates)) + '</div></div>' +
    '<div style="display:flex;flex-direction:column;align-items:center;gap:4px;">' +
    '<div class="avatar-badge">' + avatarText(me()) + '</div>' +
    (isOrganizer() ? '<button class="btn ghost small" style="padding:2px 8px;font-size:11px;" data-act="toggleViewMode">' + (state.ui.viewMode ? "編輯" : "檢視") + '</button>' : '') +
    '</div></div>';
  html += body;
  if (state.ui.tab === "expense") html += '<button class="fab" data-act="openExpenseModal">＋</button>';
  html += renderTabbar();
  if (state.ui.expenseModal) html += renderExpenseModal();
  if (state.ui.arrivalModalFor) html += renderArrivalModal();
  if (state.ui.settlementModalOpen) html += renderSettlementModal();
  if (state.ui.prepTaskModalFor) html += renderPrepTaskModal();
  if (state.ui.meetupGroupModalFor) html += renderMeetupGroupModal();
  if (state.ui.finalMeetupModalOpen) html += renderFinalMeetupModal();
  app.innerHTML = html;
}

/* -------------------------------- 事件委派 -------------------------------- */
document.addEventListener("click", e => {
  if (e.target.classList && e.target.classList.contains("modal-backdrop")) {
    state.ui.expenseModal = false; state.ui.arrivalModalFor = null; state.ui.arrivalMethodTemp = null; state.ui.settlementModalOpen = false; state.ui.prepTaskModalFor = null; state.ui.meetupGroupModalFor = null; state.ui.finalMeetupModalOpen = false; render(); return;
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
    const password = document.getElementById("newEventPassword").value;
    if (!name) return;
    if (password !== CREATE_PASSWORD) { alert("建立密碼不正確"); return; }
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
    const targetTab = el.dataset.tab;
    if (targetTab === "prep" && !canManage()) return;
    state.ui.tab = targetTab;
    if (el.dataset.sub) state.ui.roomsSubTab = el.dataset.sub;
    render();
  } else if (act === "toggleViewMode") {
    state.ui.viewMode = !state.ui.viewMode; render();
  } else if (act === "toggleArrivals") {
    state.ui.arrivalsOpen = !state.ui.arrivalsOpen; render();
  } else if (act === "toggleBalances") {
    state.ui.balancesOpen = !state.ui.balancesOpen; render();
  } else if (act === "toggleUnassignedRooms") {
    state.ui.unassignedRoomsOpen = !state.ui.unassignedRoomsOpen; render();
  } else if (act === "toggleUnassignedVehicles") {
    state.ui.unassignedVehiclesOpen = !state.ui.unassignedVehiclesOpen; render();
  } else if (act === "toggleExpenses") {
    state.ui.expensesOpen = !state.ui.expensesOpen; render();
  } else if (act === "openSettlementModal") {
    state.ui.settlementModalOpen = true; render();
  } else if (act === "closeSettlementModal") {
    state.ui.settlementModalOpen = false; render();
  } else if (act === "toggleRoster") {
    state.ui.rosterOpen = !state.ui.rosterOpen; render();
  } else if (act === "editTitle") {
    const t = window.prompt("旅行名稱", state.event.title);
    if (t && t.trim()) mutate(ev => { ev.title = t.trim(); });
  } else if (act === "editTripDates") {
    const ev0 = state.event;
    const start = window.prompt("出發日期（格式 YYYY/MM/DD，例如 2026/10/18）", toSlashDate(ev0.tripDates.start)) ?? ev0.tripDates.start;
    const end = window.prompt("結束日期（格式 YYYY/MM/DD，當天來回可留空或跟出發日相同）", toSlashDate(ev0.tripDates.end)) ?? ev0.tripDates.end;
    mutate(ev => { ev.tripDates = { start: start.trim(), end: end.trim() }; });
  } else if (act === "openFinalMeetupModal") {
    state.ui.finalMeetupModalOpen = true; render();
  } else if (act === "submitFinalMeetup") {
    const date = document.getElementById("finalMeetupDate").value;
    const time = document.getElementById("finalMeetupTime").value;
    const location = document.getElementById("finalMeetupLocation").value.trim();
    const note = document.getElementById("finalMeetupNote").value.trim();
    mutate(e2 => { e2.meetup = { date, time, location, note }; });
    state.ui.finalMeetupModalOpen = false; render();
  } else if (act === "toggleMeetup") {
    state.ui.meetupOpen = !state.ui.meetupOpen; render();
  } else if (act === "openMeetupGroupModal") {
    state.ui.meetupGroupModalFor = id || "new"; render();
  } else if (act === "deleteMeetupGroup") {
    if (!confirm("確定刪除這個分組集合？")) return;
    mutate(ev => { ev.meetupGroups = ev.meetupGroups.filter(x => x.id !== id); });
  } else if (act === "submitMeetupGroup") {
    const title = document.getElementById("meetupGroupTitle").value.trim();
    const date = document.getElementById("meetupGroupDate").value.trim();
    const time = document.getElementById("meetupGroupTime").value.trim();
    const location = document.getElementById("meetupGroupLocation").value.trim();
    const note = document.getElementById("meetupGroupNote").value.trim();
    const memberIds = Array.from(document.querySelectorAll(".meetupGroupMember:checked")).map(x => x.value);
    if (!title) { alert("請輸入分組名稱"); return; }
    if (id) {
      mutate(ev => { const g = ev.meetupGroups.find(x => x.id === id); if (g) Object.assign(g, { title, date, time, location, note, memberIds }); });
    } else {
      mutate(ev => { ev.meetupGroups.push({ id: uid(), title, date, time, location, note, memberIds }); });
    }
    state.ui.meetupGroupModalFor = null; render();
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
      delete ev.arrivals[id];
      ev.prepItems.forEach(it => { it.assigneeIds = (it.assigneeIds || []).filter(pid => pid !== id); });
    });
  } else if (act === "setRoomsSubTab") {
    state.ui.roomsSubTab = el.dataset.v; render();
  } else if (act === "openPrepTaskModal") {
    state.ui.prepTaskModalFor = id || "new"; render();
  } else if (act === "submitPrepTask") {
    const label = document.getElementById("prepTaskLabel").value.trim();
    if (!label) { alert("請輸入任務內容"); return; }
    const assigneeIds = Array.from(document.querySelectorAll(".prepTaskAssignee:checked")).map(x => x.value);
    if (id) {
      mutate(ev => { const it = ev.prepItems.find(x => x.id === id); if (it) { it.label = label; it.assigneeIds = assigneeIds; } });
    } else {
      mutate(ev => { ev.prepItems.push({ id: uid(), label, assigneeIds }); });
    }
    state.ui.prepTaskModalFor = null; render();
  } else if (act === "deletePrepTask") {
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
  } else if (act === "editExpense") {
    state.ui.expenseModal = id; render();
  } else if (act === "submitExpense") {
    const payerId = document.getElementById("expPayer").value;
    const amount = Number(document.getElementById("expAmount").value || 0);
    const note = document.getElementById("expNote").value.trim();
    const splitAmong = Array.from(document.querySelectorAll(".expSplit:checked")).map(x => x.value);
    if (!amount || !splitAmong.length) { alert("請輸入金額並至少選一位分攤者"); return; }
    if (id) {
      mutate(ev => { const ex = ev.expenses.find(x => x.id === id); if (ex) Object.assign(ex, { payerId, amount, note, splitAmong }); });
    } else {
      mutate(ev => { ev.expenses.push({ id: uid(), payerId, amount, note, splitAmong, createdAt: Date.now() }); });
    }
    state.ui.expenseModal = false; render();
  } else if (act === "deleteExpense") {
    mutate(ev => { ev.expenses = ev.expenses.filter(x => x.id !== id); });
  } else if (act === "openArrivalModal") {
    state.ui.arrivalModalFor = id; state.ui.arrivalMethodTemp = null; render();
  } else if (act === "submitArrival") {
    const methodSel = document.getElementById("arrivalMethodSelect").value;
    const otherInput = document.getElementById("arrivalMethodOther");
    const method = methodSel === "其他" ? (otherInput ? otherInput.value.trim() : "") : methodSel;
    const location = document.getElementById("arrivalLocationInput").value.trim();
    const eta = document.getElementById("arrivalTimeInput").value;
    mutate(ev => { ev.arrivals[id] = { method, location, eta }; });
    state.ui.arrivalModalFor = null; state.ui.arrivalMethodTemp = null; render();
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
  } else if (act === "arrivalMethodChange") {
    state.ui.arrivalMethodTemp = el.value; render();
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
  } else if (act === "editPrepMemo") {
    mutate(ev => { ev.prepMemo = el.value; });
  }
}, true);

boot();
