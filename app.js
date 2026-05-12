/*************************************************
 * SEIZAN pennant - app.js (FINAL)
 *************************************************/

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getDatabase, ref, get, set } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

/* ===== Firebase 初期化 ===== */
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

/* ===== 年齢・カテゴリ（当月基準） ===== */
function calcAgeAtMonth(birthdayISO, year, month) {
  if (!birthdayISO) return null;
  const birth = new Date(birthdayISO);
  const ref = new Date(year, month - 1, 1);
  let age = ref.getFullYear() - birth.getFullYear();
  const m = ref.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && ref.getDate() < birth.getDate())) age--;
  return age;
}

function getCategoryAtMonth(birthdayISO, year, month) {
  const age = calcAgeAtMonth(birthdayISO, year, month);
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
  const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });

  const toISO = (s) => {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
    if (!m) return "";
    let [, mm, dd, yy] = m;
    if (yy.length === 2) yy = "19" + yy;
    return `${yy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  };

  return rows
    .map(r => ({
      fullName: (r["氏　名"] || r["氏名"] || "").trim(),
      nickname: (r["ニックネーム"] || "").trim(),
      team: String(r["組"] || "").trim(),
      birthday: toISO(r["生年月日"] || "")
    }))
    .filter(m => m.fullName && ["1","2","3"].includes(m.team));
}

/* ===== 初回のみ Firebase に Seed ===== */
async function seedMembersIfEmpty(teamId) {
  const baseRef = ref(db, `teams/${teamId}/members`);
  const snap = await get(baseRef);
  if (snap.exists()) return;

  const all = await loadSeedMembersFromXlsx();
  const seed = all.filter(m => m.team === String(teamId));

  const payload = {};
  seed.forEach(m => {
    const key = (m.fullName + "_" + m.nickname).replace(/[ \u3000]/g, "");
    payload[key] = {
      fullName: m.fullName,
      nickname: m.nickname || m.fullName,
      birthday: m.birthday || null
    };
  });

  await set(baseRef, payload);
}

/* ===== メンバー取得 ===== */
async function loadMembers(teamId) {
  const snap = await get(ref(db, `teams/${teamId}/members`));
  if (!snap.exists()) return [];
  return Object.values(snap.val());
}

/* ===== アプリ起動 ===== */
(async function start() {

  // ★ここは仮：実アプリでは UI から選択
  const teamId = "1";   // 1 / 2 / 3

  // 当月
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  // 初回Seed
  await seedMembersIfEmpty(teamId);

  // メンバー取得
  const members = await loadMembers(teamId);

  // 当月カテゴリ付与
  const enriched = members.map(m => ({
    ...m,
    age: calcAgeAtMonth(m.birthday, year, month),
    category: getCategoryAtMonth(m.birthday, year, month)
  }));

  // 仮表示（ここは既存UIに接続）
  document.getElementById("app").innerHTML =
    enriched.map(m =>
      `${m.fullName}（${m.category}）`
    ).join("<br>");

})();