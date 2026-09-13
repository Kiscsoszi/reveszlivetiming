/** Goodyear FIA ETRC points helpers + 2026 season standings merge. */

export const POINTS_R13 = [20, 15, 12, 10, 8, 6, 4, 3, 2, 1];
export const POINTS_R24 = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

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

let standingsCache = null;

export async function loadSeasonStandings() {
  if (standingsCache) return standingsCache;
  try {
    const res = await fetch("/api/standings", { cache: "no-store" });
    if (res.ok) {
      standingsCache = await res.json();
      return standingsCache;
    }
  } catch {
    /* fall through */
  }
  const res = await fetch("/standings-2026.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`standings ${res.status}`);
  standingsCache = await res.json();
  return standingsCache;
}

/** Force reload after race recording / long sessions. */
export function invalidateStandingsCache() {
  standingsCache = null;
}

export function resolvePointsScale(session) {
  const heat = String(session?.heat || "").toLowerCase();
  const num = Number.parseInt(String(session?.heatNumber ?? ""), 10);
  if (/race\s*[24]\b|futam\s*[24]\b|r2\b|r4\b/.test(heat)) {
    return { scale: POINTS_R24, label: "Race 2/4 · 10–1", key: "r24" };
  }
  if (/race\s*[13]\b|futam\s*[13]\b|r1\b|r3\b/.test(heat)) {
    return { scale: POINTS_R13, label: "Race 1/3 · 20–1", key: "r13" };
  }
  if (num === 2 || num === 4) {
    return { scale: POINTS_R24, label: "Race 2/4 · 10–1", key: "r24" };
  }
  if (num === 1 || num === 3) {
    return { scale: POINTS_R13, label: "Race 1/3 · 20–1", key: "r13" };
  }
  return { scale: POINTS_R13, label: "Race 1/3 · 20–1", key: "r13" };
}

function pointsForPosition(pos, scale) {
  const p = Number(pos);
  if (!Number.isFinite(p) || p < 1 || p > scale.length) return 0;
  return scale[p - 1];
}

function normName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .trim();
}

function matchTeamDriver(entry, result) {
  const stnr = String(result.STNR ?? "");
  const name = normName(result.NAME);
  return entry.drivers.some((d) => {
    if (d.stnr && String(d.stnr) === stnr) return true;
    if (d.name && name.includes(normName(d.name))) return true;
    return false;
  });
}

/** Live provisional points for current race order (top 10). */
export function buildLiveDriverPoints(results, scale = POINTS_R13) {
  return [...(results || [])]
    .filter((r) => Number(r.POSITION) > 0)
    .sort((a, b) => Number(a.POSITION) - Number(b.POSITION))
    .map((r) => {
      const pos = Number(r.POSITION);
      const pts = pointsForPosition(pos, scale);
      return {
        position: pos,
        stnr: String(r.STNR ?? ""),
        name: r.NAME || "",
        className: r.CLASSNAME || "",
        livePoints: pts,
      };
    });
}

/**
 * Season championship table.
 * When includeLive=true (race session), adds provisional race pts + projected total.
 */
export function buildSeasonDriverRows(standings, results, { includeLive = false, scale = POINTS_R13 } = {}) {
  const liveByStnr = new Map();
  if (includeLive) {
    for (const row of buildLiveDriverPoints(results, scale)) {
      liveByStnr.set(row.stnr, row);
    }
  }

  const used = new Set();
  const rows = [];

  for (const d of standings?.drivers || []) {
    if (!d.name) continue;
    const key = `${d.stnr || ""}:${normName(d.name)}`;
    if (used.has(key)) continue;
    used.add(key);

    const live =
      (d.stnr && liveByStnr.get(String(d.stnr))) ||
      [...liveByStnr.values()].find((l) => {
        const ln = normName(l.name);
        const dn = normName(d.name);
        if (dn.includes("LUKAS")) return ln.includes("LUKAS");
        if (dn === "HAHN") return ln === "HAHN";
        return ln === dn || ln.includes(dn) || dn.includes(ln);
      }) ||
      null;

    const season = Number(d.points) || 0;
    const livePoints = includeLive ? live?.livePoints || 0 : null;
    const projected = includeLive ? season + (livePoints || 0) : season;

    rows.push({
      stnr: d.stnr ? String(d.stnr) : live?.stnr || "",
      name: d.name,
      className: live?.className || "",
      racePos: live?.position ?? null,
      seasonPoints: season,
      livePoints,
      projected,
      inSession: Boolean(live),
    });
  }

  // Drivers in session without season row
  if (includeLive) {
    for (const live of liveByStnr.values()) {
      if (rows.some((r) => r.stnr && r.stnr === live.stnr)) continue;
      if (rows.some((r) => normName(r.name) === normName(live.name))) continue;
      rows.push({
        stnr: live.stnr,
        name: live.name,
        className: live.className,
        racePos: live.position,
        seasonPoints: 0,
        livePoints: live.livePoints,
        projected: live.livePoints,
        inSession: true,
      });
    }
  }

  rows.sort((a, b) => {
    const pa = includeLive ? a.projected : a.seasonPoints;
    const pb = includeLive ? b.projected : b.seasonPoints;
    if (pb !== pa) return pb - pa;
    return String(a.name).localeCompare(String(b.name));
  });

  return rows.map((row, i) => ({ ...row, position: i + 1 }));
}

export function buildSeasonTeamRows(standings, results, { includeLive = false, scale = POINTS_R13 } = {}) {
  const liveDrivers = includeLive ? buildLiveDriverPoints(results, scale) : [];
  const liveByStnr = new Map(liveDrivers.map((d) => [d.stnr, d]));
  const seasonById = new Map((standings?.teams || []).map((t) => [t.id, Number(t.points) || 0]));

  const rows = ETRC_TEAMS.map((team) => {
    const members = (results || []).filter((r) => matchTeamDriver(team, r));
    const seen = new Set();
    const picks = [];
    for (const m of members) {
      const stnr = String(m.STNR ?? "");
      if (seen.has(stnr)) continue;
      seen.add(stnr);
      const live = liveByStnr.get(stnr);
      picks.push({
        stnr,
        name: m.NAME || "",
        racePos: live?.position ?? (Number(m.POSITION) || null),
        livePoints: live?.livePoints ?? 0,
      });
    }
    picks.sort((a, b) => (b.livePoints || 0) - (a.livePoints || 0));
    const top = picks.slice(0, 2);
    const livePoints = includeLive
      ? top.reduce((s, p) => s + (p.livePoints || 0), 0)
      : null;
    const seasonPoints = seasonById.get(team.id) || 0;
    const projected = includeLive ? seasonPoints + (livePoints || 0) : seasonPoints;

    return {
      id: team.id,
      name: team.name,
      short: team.short || team.name,
      drivers: top,
      seasonPoints,
      livePoints,
      projected,
      inSession: top.length > 0,
    };
  }).filter((t) => t.seasonPoints > 0 || t.inSession);

  rows.sort((a, b) => {
    const pa = includeLive ? a.projected : a.seasonPoints;
    const pb = includeLive ? b.projected : b.seasonPoints;
    if (pb !== pa) return pb - pa;
    return a.name.localeCompare(b.name);
  });

  return rows.map((row, i) => ({ ...row, position: i + 1 }));
}

// Back-compat aliases used nowhere critical
export function buildDriverPoints(results, scale) {
  return buildLiveDriverPoints(results, scale).map((r) => ({
    ...r,
    points: r.livePoints,
    scored: r.livePoints > 0,
  }));
}

export function buildTeamPoints(results, scale) {
  return buildSeasonTeamRows(
    { teams: ETRC_TEAMS.map((t) => ({ id: t.id, points: 0 })) },
    results,
    { includeLive: true, scale },
  ).map((t) => ({
    ...t,
    points: t.livePoints || 0,
    drivers: t.drivers.map((d) => ({
      ...d,
      position: d.racePos,
      points: d.livePoints,
    })),
  }));
}
