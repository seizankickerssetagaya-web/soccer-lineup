/*************************************************
 * SEIZAN pennant - app.js (fixed)
 *************************************************/

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getDatabase, ref, get, set } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

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

/* ===== 起動（最小表示） ===== */
(async function start() {
  // ※ここは今は固定（後でUI選択に差し替え）
  const teamId = "1";

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  // 初回Seed（既にあれば何もしない）
  await seedMembersIfEmpty(teamId);

  // Firebaseから取得
  const members = await loadMembers(teamId);

  // 当月カテゴリ付与して表示
  const enriched = members.map((m) => ({
    ...m,
    age: calcAgeAtMonth(m.birthday, year, month),
    category: getCategoryAtMonth(m.birthday, year, month),
  }));

  const el = document.getElementById("app");
  el.innerHTML = enriched
    .map((m) => `${m.fullName}（${m.category}）`)
    .join("<br>");
})();