import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getDatabase, ref, get, set, onValue } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

const fbApp = initializeApp(firebaseConfig);
const db = getDatabase(fbApp);

/* ===== 年齢・カテゴリ（当月1日基準） ===== */
function calcAgeAtMonth(birthdayISO, year, month1to12) {
  if (!birthdayISO) return null;
  const birth = new Date(birthdayISO);
  if (Number.isNaN(birth.getTime())) return null;
  const refDate = new Date(year, month1to12 - 1, 1);
  let age = refDate.getFullYear() - birth.getFullYear();
  const m = refDate.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && refDate.getDate() < birth.getDate())) age--;
  return age;
}
function getCategoryAtMonth(birthdayISO, y, m) {
  const age = calcAgeAtMonth(birthdayISO, y, m);
  if (age == null) return "unknown";
  return age >= 60 ? "senior" : "pennant";
}

/* ===== 既存：members読込（あなたの現状DB構造に合わせて teams/{team}/members を読む） ===== */
async function loadMembers(teamId) {
  const snap = await get(ref(db, `teams/${teamId}/members`));
  if (!snap.exists()) return [];
  return Object.values(snap.val());
}

/* ===== UI参照 ===== */
const rosterList = document.getElementById("rosterList");
const matchesEl = document.getElementById("matches");
const boardHint = document.getElementById("boardHint");

const teamSelect = document.getElementById("teamSelect");
const ymSelect = document.getElementById("ymSelect");
const ymHint = document.getElementById("ymHint");

const modeSeniorBtn = document.getElementById("modeSenior");
const modePennantBtn = document.getElementById("modePennant");

/* ===== フォーメーション（9人制）: 仕様に記載の候補＋デフォルト3-1-3-1 ===== */
const FORMATIONS = [
  "3-1-3-1", "3-3-2", "3-2-3", "4-3-1", "4-2-2", "2-4-2", "3-3-1-1"
]; // [1](https://onedrive.live.com/personal/11ee4e01bd19e38c/_layouts/15/doc.aspx?resid=b6010d02-7da7-4c8d-b5ab-66f2787cc2bb&cid=11ee4e01bd19e38c)

function formationPositions(name) {
  // 9人 = GK + 8
  // 座標は % (x,y)
  const base = {
    "3-1-3-1": [
      ["GK", 50, 88],
      ["DF-L", 25, 70], ["DF-C", 50, 72], ["DF-R", 75, 70],
      ["DM", 50, 58],
      ["MF-L", 25, 45], ["MF-C", 50, 42], ["MF-R", 75, 45],
      ["FW", 50, 22],
    ],
    "3-3-2": [
      ["GK", 50, 88],
      ["DF-L", 25, 70], ["DF-C", 50, 72], ["DF-R", 75, 70],
      ["MF-L", 25, 48], ["MF-C", 50, 48], ["MF-R", 75, 48],
      ["FW-L", 40, 25], ["FW-R", 60, 25],
    ],
    "3-2-3": [
      ["GK", 50, 88],
      ["DF-L", 25, 70], ["DF-C", 50, 72], ["DF-R", 75, 70],
      ["DM-L", 40, 55], ["DM-R", 60, 55],
      ["FW-L", 25, 30], ["FW-C", 50, 25], ["FW-R", 75, 30],
    ],
    "4-3-1": [
      ["GK", 50, 88],
      ["DF-L", 22, 72], ["DF-CL", 42, 72], ["DF-CR", 58, 72], ["DF-R", 78, 72],
      ["MF-L", 25, 48], ["MF-C", 50, 45], ["MF-R", 75, 48],
      ["FW", 50, 25],
    ],
    "4-2-2": [
      ["GK", 50, 88],
      ["DF-L", 22, 72], ["DF-CL", 42, 72], ["DF-CR", 58, 72], ["DF-R", 78, 72],
      ["DM-L", 40, 55], ["DM-R", 60, 55],
      ["FW-L", 40, 25], ["FW-R", 60, 25],
    ],
    "2-4-2": [
      ["GK", 50, 88],
      ["DF-L", 40, 72], ["DF-R", 60, 72],
      ["MF-L", 20, 52], ["MF-CL", 40, 52], ["MF-CR", 60, 52], ["MF-R", 80, 52],
      ["FW-L", 40, 25], ["FW-R", 60, 25],
    ],
    "3-3-1-1": [
      ["GK", 50, 88],
      ["DF-L", 25, 70], ["DF-C", 50, 72], ["DF-R", 75, 70],
      ["MF-L", 25, 48], ["MF-C", 50, 48], ["MF-R", 75, 48],
      ["AM", 50, 30],
      ["FW", 50, 18],
    ],
  };
  return base[name] || base["3-1-3-1"];
}

/* ===== 試合構成（仕様） ===== */
const MATCHES_BY_MODE = {
  senior: [{ key: "seniorGame", title: "シニア戦" }],                 // [1](https://onedrive.live.com/personal/11ee4e01bd19e38c/_layouts/15/doc.aspx?resid=b6010d02-7da7-4c8d-b5ab-66f2787cc2bb&cid=11ee4e01bd19e38c)
  pennant: [
    { key: "geneki", title: "現役戦" },
    { key: "ob", title: "OB戦" },
    { key: "mix", title: "混合戦" }
  ] // [1](https://onedrive.live.com/personal/11ee4e01bd19e38c/_layouts/15/doc.aspx?resid=b6010d02-7da7-4c8d-b5ab-66f2787cc2bb&cid=11ee4e01bd19e38c)
};

/* ===== 状態 ===== */
let currentMode = "senior";
let membersAll = [];
let membersFiltered = [];
let ymKey = "";
let teamId = "1";
let unsubscribers = [];

// lineupState[matchKey] = { formation, q1:{pos->player}, q2:{...}, bench:[playerId...] }
const lineupState = {};

/* ===== month UI ===== */
function pad2(n){ return String(n).padStart(2,"0"); }
function buildYmOptions(){
  if (!ymSelect) return;
  ymSelect.innerHTML = "";
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth(), 1);
  for (let i=-12;i<=12;i++){
    const d = new Date(base.getFullYear(), base.getMonth()+i, 1);
    const y = d.getFullYear();
    const m = d.getMonth()+1;
    const opt = document.createElement("option");
    opt.value = `${y}-${pad2(m)}`;
    opt.textContent = `${y}年${m}月`;
    ymSelect.appendChild(opt);
  }
  ymSelect.value = `${base.getFullYear()}-${pad2(base.getMonth()+1)}`;
}
function getSelectedYearMonth(){
  const v = ymSelect?.value || "";
  const mm = /^(\d{4})-(\d{2})$/.exec(v);
  if (!mm) {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth()+1, ym: `${now.getFullYear()}-${pad2(now.getMonth()+1)}` };
  }
  return { year: Number(mm[1]), month: Number(mm[2]), ym: v };
}

/* ===== roster ===== */
function playerIdOf(m){
  return String(m.fullName || "").replace(/[\s　]+/g,"");
}
function renderRoster(){
  rosterList.innerHTML = "";
  const { year, month } = getSelectedYearMonth();
  membersFiltered = membersAll.map(m => ({
    ...m,
    _id: playerIdOf(m),
    _cat: getCategoryAtMonth(m.birthday, year, month),
  })).filter(m => m._cat === currentMode);

  const seniorCount = membersAll.filter(m => getCategoryAtMonth(m.birthday, year, month) === "senior").length;
  const pennantCount = membersAll.filter(m => getCategoryAtMonth(m.birthday, year, month) === "pennant").length;
  if (ymHint) ymHint.innerHTML = `<span class="count"><span class="senior">シニア ${seniorCount}</span> / <span class="pennant">ペナント ${pennantCount}</span></span>`;

  membersFiltered.forEach(m => {
    const div = document.createElement("div");
    div.className = "rosterItem";
    div.draggable = true;
    div.dataset.pid = m._id;
    div.dataset.pname = m.fullName;
    div.innerHTML = `<span class="name">${m.fullName}</span><span class="tag tag-${m._cat}">${m._cat==="senior"?"シニア":"ペナント"}</span>`;
    div.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", JSON.stringify({ pid:m._id, name:m.fullName }));
    });
    rosterList.appendChild(div);
  });

  boardHint.textContent = currentMode === "senior"
    ? "シニア：1試合（1Q/2Q）" 
    : "ペナント：現役/OB/混合（各1Q/2Q）"; // [1](https://onedrive.live.com/personal/11ee4e01bd19e38c/_layouts/15/doc.aspx?resid=b6010d02-7da7-4c8d-b5ab-66f2787cc2bb&cid=11ee4e01bd19e38c)
}

/* ===== Firebase lineups path ===== */
function lineupPath(matchKey){
  return `teams/${teamId}/lineups/${ymKey}/${currentMode}/${matchKey}`;
}

/* ===== subscribe realtime ===== */
function clearSubs(){
  unsubscribers.forEach(u => { try{u();}catch{} });
  unsubscribers = [];
}
function subscribeMatch(matchKey){
  const r = ref(db, lineupPath(matchKey));
  const unsub = onValue(r, (snap) => {
    const v = snap.val();
    if (v) lineupState[matchKey] = v;
    else lineupState[matchKey] = { formation:"3-1-3-1", q1:{}, q2:{}, bench:[] };
    renderMatches(); // リアルタイム反映 [5](https://modularfirebase.web.app/reference/database.onvalue)[1](https://onedrive.live.com/personal/11ee4e01bd19e38c/_layouts/15/doc.aspx?resid=b6010d02-7da7-4c8d-b5ab-66f2787cc2bb&cid=11ee4e01bd19e38c)
  });
  unsubscribers.push(unsub);
}

/* ===== save lineup ===== */
async function saveMatch(matchKey){
  await set(ref(db, lineupPath(matchKey)), lineupState[matchKey]); // set() で保存 [6](https://firebase.google.com/docs/database/web/read-and-write)
}

/* ===== 1Q→2Q 自動コピー（2Qの空きだけ埋める） ===== */
function autoCopyQ1toQ2(matchKey){
  const st = lineupState[matchKey];
  Object.keys(st.q1||{}).forEach(pos => {
    if (!st.q2) st.q2 = {};
    if (!st.q2[pos]) st.q2[pos] = st.q1[pos];
  });
}

/* ===== render matches & pitches ===== */
function renderMatches(){
  matchesEl.innerHTML = "";
  const matchList = MATCHES_BY_MODE[currentMode];

  matchList.forEach(({key,title}) => {
    const st = lineupState[key] || { formation:"3-1-3-1", q1:{}, q2:{}, bench:[] };
    lineupState[key] = st;

    const card = document.createElement("div");
    card.className = "matchCard";

    // header
    const head = document.createElement("div");
    head.className = "matchHead";
    head.innerHTML = `<div class="title">${title}</div>`;
    const sel = document.createElement("select");
    FORMATIONS.forEach(f => {
      const opt = document.createElement("option");
      opt.value = f; opt.textContent = f;
      sel.appendChild(opt);
    });
    sel.value = st.formation || "3-1-3-1"; // default [1](https://onedrive.live.com/personal/11ee4e01bd19e38c/_layouts/15/doc.aspx?resid=b6010d02-7da7-4c8d-b5ab-66f2787cc2bb&cid=11ee4e01bd19e38c)
    sel.addEventListener("change", async () => {
      st.formation = sel.value;
      await saveMatch(key);
      renderMatches();
    });
    head.appendChild(sel);
    card.appendChild(head);

    // pitches row (1Q / 2Q 横並び) [1](https://onedrive.live.com/personal/11ee4e01bd19e38c/_layouts/15/doc.aspx?resid=b6010d02-7da7-4c8d-b5ab-66f2787cc2bb&cid=11ee4e01bd19e38c)
    const row = document.createElement("div");
    row.className = "pitchesRow";
    row.appendChild(buildPitch(key, "q1", "1Q", st.formation));
    row.appendChild(buildPitch(key, "q2", "2Q", st.formation));
    card.appendChild(row);

    // bench (共通1つ) [1](https://onedrive.live.com/personal/11ee4e01bd19e38c/_layouts/15/doc.aspx?resid=b6010d02-7da7-4c8d-b5ab-66f2787cc2bb&cid=11ee4e01bd19e38c)
    const bench = document.createElement("div");
    bench.className = "bench";
    bench.innerHTML = `<div class="benchTitle">ベンチ（クリックで外す）</div>`;
    const slots = document.createElement("div");
    slots.className = "benchSlots";
    (st.bench || []).forEach(pid => {
      const m = membersFiltered.find(x=>x._id===pid) || membersAll.find(x=>playerIdOf(x)===pid);
      const chip = document.createElement("div");
      chip.className = "benchChip";
      chip.textContent = m?.fullName || pid;
      chip.addEventListener("click", async ()=>{
        st.bench = (st.bench||[]).filter(x=>x!==pid);
        await saveMatch(key);
      });
      slots.appendChild(chip);
    });
    bench.appendChild(slots);
    card.appendChild(bench);

    matchesEl.appendChild(card);
  });
}

function buildPitch(matchKey, qKey, label, formation){
  const st = lineupState[matchKey];
  const pitch = document.createElement("div");
  pitch.className = "pitch";
  pitch.dataset.match = matchKey;
  pitch.dataset.q = qKey;

  const qLabel = document.createElement("div");
  qLabel.className = "qLabel";
  qLabel.textContent = label;
  pitch.appendChild(qLabel);

  const posList = formationPositions(formation);
  posList.forEach(([pos, x, y]) => {
    const node = document.createElement("div");
    const p = (st[qKey]||{})[pos];
    const p1 = (st.q1||{})[pos];
    const isChanged = (qKey==="q2" && p && p1 && p !== p1); // 2Q差分は赤 [1](https://onedrive.live.com/personal/11ee4e01bd19e38c/_layouts/15/doc.aspx?resid=b6010d02-7da7-4c8d-b5ab-66f2787cc2bb&cid=11ee4e01bd19e38c)

    node.className = "pos" + (p ? " filled":"") + (isChanged ? " changed":"");
    node.style.left = `${x}%`;
    node.style.top = `${y}%`;
    node.dataset.pos = pos;

    const name = p ? (membersAll.find(m=>playerIdOf(m)===p)?.fullName || p) : "";
    node.innerHTML = `${pos}<br>${name ? name : "（空）"}`;

    node.addEventListener("dragover", (e)=> e.preventDefault());
    node.addEventListener("drop", async (e)=>{
      e.preventDefault();
      const data = JSON.parse(e.dataTransfer.getData("text/plain"));
      if (!st[qKey]) st[qKey] = {};
      st[qKey][pos] = data.pid;

      // 1Qに置いたら2Q空きを自動コピー [1](https://onedrive.live.com/personal/11ee4e01bd19e38c/_layouts/15/doc.aspx?resid=b6010d02-7da7-4c8d-b5ab-66f2787cc2bb&cid=11ee4e01bd19e38c)
      if (qKey === "q1") autoCopyQ1toQ2(matchKey);

      await saveMatch(matchKey);
    });

    // クリックでクリア（簡易）
    node.addEventListener("click", async ()=>{
      if (!st[qKey]) st[qKey] = {};
      if (st[qKey][pos]) {
        delete st[qKey][pos];
        await saveMatch(matchKey);
      }
    });

    pitch.appendChild(node);
  });

  return pitch;
}

/* ===== init ===== */
function setMode(mode){
  currentMode = mode;
  modeSeniorBtn.classList.toggle("active", mode==="senior");
  modePennantBtn.classList.toggle("active", mode==="pennant");
}

async function reloadAll(){
  teamId = String(teamSelect?.value || "1");
  const ym = getSelectedYearMonth();
  ymKey = ym.ym;

  membersAll = await loadMembers(teamId);

  renderRoster();

  // lineup 購読し直し
  clearSubs();
  MATCHES_BY_MODE[currentMode].forEach(m => subscribeMatch(m.key));
  // 初回描画（onValueが来る前の仮）
  renderMatches();
}

buildYmOptions();
setMode("senior");

modeSeniorBtn.addEventListener("click", async ()=>{ setMode("senior"); await reloadAll(); });
modePennantBtn.addEventListener("click", async ()=>{ setMode("pennant"); await reloadAll(); });

teamSelect?.addEventListener("change", reloadAll);
ymSelect?.addEventListener("change", ()=>{ renderRoster(); renderMatches(); });

reloadAll();
