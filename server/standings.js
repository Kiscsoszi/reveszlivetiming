import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const BASE_PATH = join(ROOT, "public/standings-2026.json");
const RESULTS_PATH = join(ROOT, "data/race-results.json");

const POINTS_R13 = [20, 15, 12, 10, 8, 6, 4, 3, 2, 1];
const POINTS_R24 = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

/** Rest of 2026: BEL R1–R4 + FRA R1–R4 + ESP R1–R4 (driver P1 max / team P1+P2 max). */
const SEASON_RACE_SLOTS = [
  { scale: "r13", driverMax: 20, teamMax: 35 },
  { scale: "r24", driverMax: 10, teamMax: 19 },
  { scale: "r13", driverMax: 20, teamMax: 35 },
  { scale: "r24", driverMax: 10, teamMax: 19 },
  { scale: "r13", driverMax: 20, teamMax: 35 },
  { scale: "r24", driverMax: 10, teamMax: 19 },
  { scale: "r13", driverMax: 20, teamMax: 35 },
  { scale: "r24", driverMax: 10, teamMax: 19 },
  { scale: "r13", driverMax: 20, teamMax: 35 },
  { scale: "r24", driverMax: 10, teamMax: 19 },
  { scale: "r13", driverMax: 20, teamMax: 35 },
  { scale: "r24", driverMax: 10, teamMax: 19 },
];

const FOCUS_DRIVER_STNR = "1";
const FOCUS_TEAM_ID = "revesz-reinert";

export const ETRC_TEAMS = [
  {
    id: "revesz-reinert",
    name: "Révész-Reinert Racing Team",
    short: "Révész-Reinert",
    drivers: [
      { stnr: "1", name: "KISS" },
      { stnr: "77", name: "REINERT" },
    ],
  },
  {
    id: "bullen",
    name: "Die Bullen von Iveco",
    short: "Die Bullen",
    drivers: [
      { stnr: "2", name: "HAHN" },
      { stnr: "44", name: "HALM" },
    ],
  },
  {
    id: "lowenpower",
    name: "Löwenpower",
    short: "Löwenpower",
    drivers: [
      { stnr: "30", name: "LENZ" },
      { stnr: "3", name: "LENZ" },
      { stnr: "18", name: "NEWELL" },
    ],
  },
  {
    id: "bernau-smith",
    name: "Bernau-Smith Racing",
    short: "Bernau-Smith",
    drivers: [
      { stnr: "23", name: "ALBACETE" },
      { stnr: "11", name: "SMITH" },
    ],
  },
  {
    id: "taylor-rodrigues",
    name: "Taylor & Rodrigues",
    short: "Taylor & Rodrigues",
    drivers: [
      { stnr: "38", name: "RODRIGUES" },
      { stnr: "81", name: "TAYLOR" },
    ],
  },
  {
    id: "faas-recuenco",
    name: "Team Faas Recuenco",
    short: "Faas-Recuenco",
    drivers: [
      { stnr: "24", name: "FAAS" },
      { stnr: "64", name: "RECUENCO" },
    ],
  },
  {
    id: "h-and-k",
    name: "Team H&K",
    short: "H&K",
    drivers: [
      { stnr: "25", name: "HECKER" },
      { stnr: "33", name: "KURSCH" },
    ],
  },
];

function normName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .trim();
}

function scaleForRace(race) {
  if (race?.scale === "r24") return POINTS_R24;
  if (race?.scale === "r13") return POINTS_R13;
  const heat = String(race?.heat || "").toLowerCase();
  const num = Number(race?.heatNumber);
  if (/race\s*[24]\b|r2\b|r4\b/.test(heat) || num === 2 || num === 4) {
    return POINTS_R24;
  }
  return POINTS_R13;
}

function scaleKey(race) {
  return scaleForRace(race) === POINTS_R24 ? "r24" : "r13";
}

function pointsForPosition(pos, scale) {
  const p = Number(pos);
  if (!Number.isFinite(p) || p < 1 || p > scale.length) return 0;
  return scale[p - 1];
}

function readJson(path, fallback) {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export function loadBaseStandings() {
  return readJson(BASE_PATH, { drivers: [], teams: [] });
}

export function loadRaceResults() {
  const data = readJson(RESULTS_PATH, { event: "", races: [] });
  if (!Array.isArray(data.races)) data.races = [];
  return data;
}

function matchTeamDriver(team, entry) {
  const stnr = String(entry.stnr ?? entry.STNR ?? "");
  const name = normName(entry.name ?? entry.NAME);
  return team.drivers.some((d) => {
    if (d.stnr && String(d.stnr) === stnr) return true;
    if (d.name && name.includes(normName(d.name))) return true;
    return false;
  });
}

function findDriverBucket(map, entry) {
  const stnr = String(entry.stnr ?? "");
  const name = normName(entry.name);
  if (stnr && map.has(`stnr:${stnr}`)) return map.get(`stnr:${stnr}`);
  if (name && map.has(`name:${name}`)) return map.get(`name:${name}`);
  // partial name
  for (const [key, val] of map) {
    if (!key.startsWith("name:")) continue;
    const dn = key.slice(5);
    if (dn.includes("LUKAS") || name.includes("LUKAS")) {
      if (dn.includes("LUKAS") && name.includes("LUKAS")) return val;
      continue;
    }
    if (dn === "HAHN" && name === "HAHN") return val;
    if (name === dn || name.includes(dn) || dn.includes(name)) return val;
  }
  return null;
}

/** Merge base season + completed races into live standings payload. */
export function buildMergedStandings() {
  const base = loadBaseStandings();
  const store = loadRaceResults();
  const driverMap = new Map();

  for (const d of base.drivers || []) {
    if (!d?.name) continue;
    const row = {
      name: d.name,
      stnr: d.stnr ? String(d.stnr) : null,
      points: Number(d.points) || 0,
    };
    if (row.stnr) driverMap.set(`stnr:${row.stnr}`, row);
    driverMap.set(`name:${normName(row.name)}`, row);
  }

  const teamPts = new Map(
    (base.teams || []).map((t) => [t.id, Number(t.points) || 0]),
  );

  for (const race of store.races || []) {
    const scale = scaleForRace(race);
    const raceTeamAdd = new Map();

    for (const entry of race.results || []) {
      const pos = Number(entry.position);
      const pts = pointsForPosition(pos, scale);
      if (!pts) continue;

      let row = findDriverBucket(driverMap, entry);
      if (!row) {
        row = {
          name: String(entry.name || "").toUpperCase() || `STNR ${entry.stnr}`,
          stnr: entry.stnr ? String(entry.stnr) : null,
          points: 0,
        };
        if (row.stnr) driverMap.set(`stnr:${row.stnr}`, row);
        driverMap.set(`name:${normName(row.name)}`, row);
      }
      row.points += pts;
      if (entry.stnr && !row.stnr) row.stnr = String(entry.stnr);

      const team = ETRC_TEAMS.find((t) => matchTeamDriver(t, entry));
      if (team) {
        raceTeamAdd.set(team.id, (raceTeamAdd.get(team.id) || 0) + pts);
      }
    }

    for (const [id, add] of raceTeamAdd) {
      teamPts.set(id, (teamPts.get(id) || 0) + add);
    }
  }

  // unique drivers
  const seen = new Set();
  const drivers = [];
  for (const row of driverMap.values()) {
    const key = `${row.stnr || ""}:${normName(row.name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    drivers.push({ ...row });
  }
  drivers.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));

  const teams = ETRC_TEAMS.map((t) => ({
    id: t.id,
    name: t.name,
    short: t.short,
    points: teamPts.get(t.id) || 0,
  }))
    .filter((t) => t.points > 0)
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));

  const raceCount = (store.races || []).length;
  const remaining = SEASON_RACE_SLOTS.slice(Math.min(raceCount, SEASON_RACE_SLOTS.length));
  const remainingDriverMax = remaining.reduce((s, r) => s + r.driverMax, 0);
  const remainingTeamMax = remaining.reduce((s, r) => s + r.teamMax, 0);

  return {
    season: base.season || 2026,
    label: "2026 szezon",
    updated: new Date().toISOString().slice(0, 10),
    source: "base + recorded races",
    baseLabel: base.label || null,
    races: (store.races || []).map((r) => ({
      id: r.id,
      heat: r.heat,
      heatNumber: r.heatNumber,
      scale: r.scale || scaleKey(r),
      recordedAt: r.recordedAt,
    })),
    remaining: {
      races: remaining.length,
      driverMax: remainingDriverMax,
      teamMax: remainingTeamMax,
    },
    clinch: buildClinch({
      drivers,
      teams,
      remainingDriverMax,
      remainingTeamMax,
    }),
    drivers,
    teams,
  };
}

/**
 * Points still needed so focus is guaranteed champion even if every rival
 * takes the maximum remaining points (and focus scores the rest).
 */
function clinchNeed(focusPts, rivalsPts, remainingMax) {
  const threat = Math.max(0, ...rivalsPts.map((p) => p + remainingMax));
  const need = Math.max(0, threat - focusPts + 1);
  return {
    points: focusPts,
    remainingMax,
    threat,
    need,
    clinched: need === 0,
  };
}

function buildClinch({ drivers, teams, remainingDriverMax, remainingTeamMax }) {
  const focusDriver =
    drivers.find((d) => String(d.stnr) === FOCUS_DRIVER_STNR) ||
    drivers.find((d) => normName(d.name).includes("KISS"));
  const rivals = drivers.filter((d) => d !== focusDriver);
  const driver = focusDriver
    ? clinchNeed(
        Number(focusDriver.points) || 0,
        rivals.map((d) => Number(d.points) || 0),
        remainingDriverMax,
      )
    : null;

  if (driver && focusDriver) {
    driver.name = focusDriver.name;
    driver.stnr = focusDriver.stnr;
    const threatRival = rivals
      .map((d) => ({
        name: d.name,
        stnr: d.stnr,
        points: Number(d.points) || 0,
        ceiling: (Number(d.points) || 0) + remainingDriverMax,
      }))
      .sort((a, b) => b.ceiling - a.ceiling)[0];
    driver.threatRival = threatRival || null;
  }

  const focusTeam = teams.find((t) => t.id === FOCUS_TEAM_ID);
  const teamRivals = teams.filter((t) => t.id !== FOCUS_TEAM_ID);
  const team = focusTeam
    ? clinchNeed(
        Number(focusTeam.points) || 0,
        teamRivals.map((t) => Number(t.points) || 0),
        remainingTeamMax,
      )
    : null;

  if (team && focusTeam) {
    team.id = focusTeam.id;
    team.name = focusTeam.short || focusTeam.name;
    const threatRival = teamRivals
      .map((t) => ({
        id: t.id,
        name: t.short || t.name,
        points: Number(t.points) || 0,
        ceiling: (Number(t.points) || 0) + remainingTeamMax,
      }))
      .sort((a, b) => b.ceiling - a.ceiling)[0];
    team.threatRival = threatRival || null;
  }

  return { driver, team };
}

function raceIdFromSession(session) {
  const sid = String(session?.session || session?.exportId || "unknown");
  const heat = String(session?.heat || "race")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${sid}-${heat}`;
}

function classifyScale(session) {
  const heat = String(session?.heat || "").toLowerCase();
  const num = Number.parseInt(String(session?.heatNumber ?? ""), 10);
  if (/race\s*[24]\b|futam\s*[24]\b|r2\b|r4\b/.test(heat) || num === 2 || num === 4) {
    return "r24";
  }
  return "r13";
}

/**
 * Persist a finished race classification (idempotent by id/sessionId).
 * results: timing RESULT rows or {position,stnr,name}[]
 */
export function recordRaceResult({ session, results, source = "live" }) {
  if (!session || !Array.isArray(results) || !results.length) {
    return { ok: false, reason: "empty" };
  }

  const classified = results
    .map((r) => ({
      position: Number(r.POSITION ?? r.position),
      stnr: String(r.STNR ?? r.stnr ?? ""),
      name: String(r.NAME ?? r.name ?? "").toUpperCase(),
    }))
    .filter((r) => Number.isFinite(r.position) && r.position > 0)
    .sort((a, b) => a.position - b.position);

  if (classified.length < 3) return { ok: false, reason: "too-few" };

  const store = loadRaceResults();
  const id = raceIdFromSession(session);
  if (store.races.some((r) => r.id === id || r.sessionId === String(session.session))) {
    return { ok: false, reason: "already-recorded", id };
  }

  const entry = {
    id,
    sessionId: String(session.session || ""),
    heat: session.heat || "Race",
    heatNumber: Number.parseInt(String(session.heatNumber ?? ""), 10) || null,
    scale: classifyScale(session),
    source,
    recordedAt: new Date().toISOString(),
    results: classified,
  };

  store.races.push(entry);
  writeJson(RESULTS_PATH, store);
  console.log(
    `[standings] recorded ${entry.heat} (${entry.scale}) · ${classified.length} cars → ${RESULTS_PATH}`,
  );
  return { ok: true, entry, standings: buildMergedStandings() };
}

export function listRecordedRaces() {
  return loadRaceResults().races || [];
}
