/*************************************************
 * SEIZAN pennant - app.js (fixed)
 *************************************************/

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getDatabase, ref, get, set, onValue } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

/* ===== Firebase 初期化 ===== */
const fbApp = initializeApp(firebaseConfig);
const db = getDatabase(fbApp);

/* ===== 当月基準の年齢・カテゴリ ===== */
function calcAgeAtMonth(birthdayISO, year, month1to12) {
  if (!birthdayISO) return null;
  const birth = new Date(birthdayISO);
  if (Number.isNaN(birth.getTime())) return null;

  // 当月1日を基準（「当月時点の年齢」）
  const refDate = new Date(year, month1to12 - 1, 1);
  let age = refDate.getFullYear() - birth.getFullYear();
  const m = refDate.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && refDate.getDate() < birth.getDate())) age--;
  return age;
}

function getCategoryAtMonth(birthdayISO, year, month1to12) {
  const age = calcAgeAtMonth(birthdayISO, year, month1to12);
  if (age == null) return "unknown";
  return age >= 60 ? "senior" : "pennant";
}

/* ===== Excel 読み込み（members.xlsx） ===== */
async function loadSeedMembersFromXlsx() {
  const res = await fetch("./members.xlsx", { cache: "no-store" });
  if (!res.ok) throw new Error("members.xlsx not found");

  const buf = await res.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false });

  // "11/11/1928" → "1928-11-11"
  const toISO = (s) => {
    const str = String(s).trim();
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(str);
    if (!m) return "";
    let [, mm, dd, yy] = m;
    if (yy.length === 2) yy = "19" + yy;
    return `${yy.padStart(4, "0")}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  };

  const getName = (r) => String(r["氏　名"] || r["氏名"] || "").trim();
  const getTeam = (r) => String(r["組"] || "").trim();
  const getDob = (r) => String(r["生年月日"] || "").trim();
  const getNick = (r) => String(r["ニックネーム"] || "").trim();

  return rows
    .map((r) => ({
      fullName: getName(r),
      nickname: getNick(r) || getName(r),
      team: getTeam(r),                 // "1","2","3"
      birthday: toISO(getDob(r)),        // ISO
    }))
    .filter((m) => m.fullName && ["1", "2", "3"].includes(m.team));
}

/* ===== 初回のみ Firebase に Seed（上書きしない） ===== */
async function seedMembersIfEmpty(teamId) {
  const basePath = `teams/${teamId}/members`;
  const baseRef = ref(db, basePath);

  const snap = await get(baseRef);
  if (snap.exists()) return { seeded: false };

  const all = await loadSeedMembersFromXlsx();
  const seed = all.filter((m) => m.team === String(teamId));

  const payload = {};
  for (const m of seed) {
    const key = (m.fullName + "_" + (m.nickname || ""))
      .replace(/[\s　]+/g, "")
      .slice(0, 60);

    payload[key] = {
      fullName: m.fullName,
      nickname: m.nickname || m.fullName,
      birthday: m.birthday || null,
    };
  }

  await set(baseRef, payload);
  return { seeded: true, count: seed.length };
}

/* ===== メンバー取得 ===== */
async function loadMembers(teamId) {
  const snap = await get(ref(db, `teams/${teamId}/members`));
  if (!snap.exists()) return [];
  return Object.values(snap.val());
}

/* ===== 起動（チーム + 月 セレクタ） ===== */
(async function start() {

  // UI参照
  const teamSelect = document.getElementById("teamSelect");
  const ymSelect = document.getElementById("ymSelect");
  const ymHint = document.getElementById("ymHint");
  const appEl = document.getElementById("app");

  function pad2(n){ return String(n).padStart(2,"0"); }

  // 月セレクタ作成（-12〜+12ヶ月）
  function buildYmOptions() {
    if (!ymSelect) return;
    ymSelect.innerHTML = "";
    const now = new Date();
    const base = new Date(now.getFullYear(), now.getMonth(), 1);

    for (let i = -12; i <= 12; i++) {
      const d = new Date(base.getFullYear(), base.getMonth() + i, 1);
      const y = d.getFullYear();
      const m = d.getMonth() + 1;
      const opt = document.createElement("option");
      opt.value = `${y}-${pad2(m)}`;
      opt.textContent = `${y}年${m}月`;
      ymSelect.appendChild(opt);
    }
    ymSelect.value = `${base.getFullYear()}-${pad2(base.getMonth()+1)}`;
  }

  function getSelectedYearMonth() {
    const v = ymSelect?.value || "";
    const mm = /^(\d{4})-(\d{2})$/.exec(v);
    if (!mm) {
      const now = new Date();
      return { year: now.getFullYear(), month: now.getMonth() + 1 };
    }
    return { year: Number(mm[1]), month: Number(mm[2]) };
  }

  function getSelectedTeamId() {
    return teamSelect?.value || "1";
  }

  // チームごとに members をキャッシュ（切替時の体感速度UP）
  const membersCache = new Map(); // teamId -> members[]

  async function ensureMembers(teamId) {
    if (membersCache.has(teamId)) return membersCache.get(teamId);

    // 初回だけExcelからSeed（既にあればスキップ）
    await seedMembersIfEmpty(teamId);

    // Firebaseから取得
    const members = await loadMembers(teamId);
    membersCache.set(teamId, members);
    return members;
  }

  // 描画
async function render() {
  const teamId = String(getSelectedTeamId());  // 念のため文字列化
  const { year, month } = getSelectedYearMonth();

  appEl.textContent = `Loading...（${teamId}組）`;

  // ★チーム切替のたびに seed確認 → その直後に必ず読み直す
  await seedMembersIfEmpty(teamId);
  const members = await loadMembers(teamId);   // ←キャッシュを使わない

  const enriched = members.map((m) => ({
    ...m,
    age: calcAgeAtMonth(m.birthday, year, month),
    category: getCategoryAtMonth(m.birthday, year, month),
  }));

  const seniorCount = enriched.filter(x => x.category === "senior").length;
  const pennantCount = enriched.filter(x => x.category === "pennant").length;
  if (ymHint) ymHint.textContent = `${teamId}組：シニア ${seniorCount} / ペナント ${pennantCount}`;

appEl.innerHTML = enriched
  .map(m => `${m.fullName}（${m.category}）`)
  .join("<br>");
``

  console.log("render teamId=", teamId, "members=", members.length);
}

  // 初期化
  buildYmOptions();

  // 初期チーム（1組）で表示
  if (teamSelect) teamSelect.value = "1";
  await render();

  // イベント：月変更・チーム変更で再描画
  ymSelect?.addEventListener("change", render);
  teamSelect?.addEventListener("change", render);

})();
