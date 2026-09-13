import express from "express";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadKnownLapHistories, fetchDriverLaps } from "./laps.js";
import {
  buildMergedStandings,
  recordRaceResult,
} from "./standings.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const PORT = Number(process.env.PORT) || 3456;
const EVENT_ID = process.env.EVENT_ID || "16";
const UPSTREAM = process.env.UPSTREAM_WS || "wss://livetiming.azurewebsites.net";
const DRIVER_MATCH = (process.env.DRIVER_MATCH || "KISS").toUpperCase();
const DRIVER_NUMBER = process.env.DRIVER_NUMBER || "1";
const EVENT_PIDS = [0, 4, 3, 9002];

const state = {
  connected: false,
  lastUpdate: null,
  updateCount: 0,
  session: null,
  track: null,
  results: [],
  bestSectors: [],
  messages: [],
  leading: [],
  bestLaps: [],
  theoreticalSectors: [],
  focus: null,
  analysis: null,
  histories: [],
  liveLaps: null,
  field: null,
  error: null,
};

/** Per-driver pace from last completed lap (sectors + lap clock). */
const driverProg = new Map();
/** Per-driver sector splits from their personal best lap. */
const bestLapSectors = new Map();

let historyLoading = false;
let lastHistorySession = null;
let lastSeenLapCount = null;

const clients = new Set();

function broadcast(payload) {
  const data = JSON.stringify(payload);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  }
}

function snapshot() {
  return {
    type: "snapshot",
    connected: state.connected,
    lastUpdate: state.lastUpdate,
    updateCount: state.updateCount,
    session: state.session,
    track: state.track,
    results: state.results,
    bestSectors: state.bestSectors,
    messages: state.messages,
    leading: state.leading,
    bestLaps: state.bestLaps.slice(0, 12),
    theoreticalSectors: state.theoreticalSectors,
    focus: state.focus,
    analysis: state.analysis,
    histories: state.histories,
    liveLaps: state.liveLaps,
    field: state.field,
    error: state.error,
    standings: buildMergedStandings(),
    config: {
      eventId: EVENT_ID,
      driverMatch: DRIVER_MATCH,
      driverNumber: DRIVER_NUMBER,
    },
  };
}

/** Last race-session classification kept until the next session starts. */
let lastRaceSnapshot = null;

function sessionOnTrack(track, session) {
  if (!session) return false;
  const time = String(track?.timeState ?? "").toUpperCase();
  const flag = String(track?.trackState ?? "").toUpperCase();
  if (/FINISH|FINISHED|END|ENDED|COMPLETE|STOPPED|CHEQUERED/.test(time)) {
    return false;
  }
  // Red flag / session stopped
  if (flag === "R" || flag === "RED" || flag === "3") return false;
  return true;
}

/** True only while the car is circulating — not in pit / not standing with PIT marker. */
function driverIsOnCircuit(row) {
  const bits = [
    row.S1TIME,
    row.S2TIME,
    row.S3TIME,
    row.GAP,
    row.INT,
    row.LASTLAPTIME,
  ];
  if (bits.some((v) => /PIT/i.test(String(v ?? "")))) return false;

  const inter = Number(row.LASTINTERMEDIATENUMBER);
  // Normal intermediates are 0–3; pit/entry codes are higher (e.g. 20)
  if (Number.isFinite(inter) && inter >= 10) return false;

  return true;
}

function sectorTotal(sectors) {
  if (!sectors) return 0;
  return sectors.s1 + sectors.s2 + sectors.s3;
}

/** Path progress 0–1 from elapsed time + sector pace (continuous wrap). */
function progressFromElapsed(elapsedSec, sectors) {
  const total = sectorTotal(sectors);
  if (!(total > 0)) return 0;
  let t = elapsedSec % total;
  if (t < 0) t += total;
  const p1 = 1 / 3;
  const p2 = 2 / 3;
  if (t <= sectors.s1) return (t / sectors.s1) * p1;
  if (t <= sectors.s1 + sectors.s2) {
    return p1 + ((t - sectors.s1) / sectors.s2) * (p2 - p1);
  }
  return p2 + ((t - sectors.s1 - sectors.s2) / sectors.s3) * (1 - p2);
}

/** Elapsed seconds within one lap for a given progress — keeps phase when pace changes. */
function elapsedFromProgress(progress, sectors) {
  const p = ((progress % 1) + 1) % 1;
  const p1 = 1 / 3;
  const p2 = 2 / 3;
  if (p <= p1) return (p / p1) * sectors.s1;
  if (p <= p2) return sectors.s1 + ((p - p1) / (p2 - p1)) * sectors.s2;
  return sectors.s1 + sectors.s2 + ((p - p2) / (1 - p2)) * sectors.s3;
}

function estimateLapStartedAt(now, intermediate, sectors) {
  const n = Number(intermediate);
  if (!sectors) return now;
  if (n >= 3) return now - sectorTotal(sectors) * 1000;
  if (n === 2) return now - (sectors.s1 + sectors.s2) * 1000;
  if (n === 1) return now - sectors.s1 * 1000;
  return now;
}

/** Update pace without teleporting — same track position, new sector times. */
function applySectors(prev, newSectors, now, intermediate) {
  if (!newSectors) return;
  if (prev.sectors && prev.lapStartedAt != null) {
    const elapsed = (now - prev.lapStartedAt) / 1000;
    const prog = progressFromElapsed(elapsed, prev.sectors);
    const kept = elapsedFromProgress(prog, newSectors);
    prev.lapStartedAt = now - kept * 1000;
  } else {
    prev.lapStartedAt = estimateLapStartedAt(now, intermediate, newSectors);
  }
  prev.sectors = newSectors;
}

function updateDriverProgress(results, focusStnr) {
  const now = Date.now();
  const seen = new Set();

  for (const r of results) {
    const stnr = String(r.STNR);
    seen.add(stnr);
    const laps = Number(r.LAPS) || 0;
    const onCircuit = driverIsOnCircuit(r);
    const s1 = parseTime(r.S1TIME);
    const s2 = parseTime(r.S2TIME);
    const s3 = parseTime(r.S3TIME);
    const lastLapSec = parseTime(r.LASTLAPTIME);
    const prev = driverProg.get(stnr) || {
      stnr,
      laps: 0,
      sectors: null,
      lapStartedAt: null,
      lastLap: null,
    };

    const fullSectors =
      s1 > 0 && s2 > 0 && s3 > 0 ? { s1, s2, s3 } : null;
    const splitLast =
      lastLapSec > 0
        ? {
            s1: lastLapSec / 3,
            s2: lastLapSec / 3,
            s3: lastLapSec / 3,
          }
        : null;

    if (onCircuit && laps > prev.laps) {
      // New lap completed — refresh pace, keep current place on the ribbon (no snap to S/F)
      const next = fullSectors || splitLast;
      if (next) {
        applySectors(prev, next, now, r.LASTINTERMEDIATENUMBER);
        prev.lastLap = r.LASTLAPTIME || prev.lastLap;
        prev.lastLapSec = lastLapSec ?? sectorTotal(next);
      }
      prev.laps = laps;
    } else if (onCircuit && !prev.sectors && (fullSectors || splitLast) && laps > 0) {
      const next = fullSectors || splitLast;
      applySectors(prev, next, now, r.LASTINTERMEDIATENUMBER);
      prev.lastLap = r.LASTLAPTIME;
      prev.lastLapSec = lastLapSec ?? sectorTotal(next);
      prev.laps = laps;
    } else if (
      onCircuit &&
      fullSectors &&
      prev.sectors &&
      laps === prev.laps &&
      lastLapSec != null &&
      Math.abs(lastLapSec - sectorTotal(fullSectors)) < 0.05
    ) {
      applySectors(prev, fullSectors, now, r.LASTINTERMEDIATENUMBER);
      prev.lastLap = r.LASTLAPTIME;
      prev.lastLapSec = lastLapSec;
    }

    // Pit / off — hide, but keep clock so rejoining continues smoothly
    if (!onCircuit) {
      prev.hidden = true;
    } else {
      prev.hidden = false;
    }

    prev.laps = Math.max(prev.laps, laps);
    prev.name = r.NAME;
    prev.position = r.POSITION;
    prev.focus = String(stnr) === String(focusStnr);
    prev.intermediate = r.LASTINTERMEDIATENUMBER;
    prev.onCircuit = onCircuit;
    prev.onTrack =
      onCircuit &&
      !prev.hidden &&
      laps > 0 &&
      prev.sectors != null &&
      prev.lapStartedAt != null &&
      lastLapSec != null;

    driverProg.set(stnr, prev);
  }

  for (const key of [...driverProg.keys()]) {
    if (!seen.has(key)) driverProg.delete(key);
  }
}

function buildField() {
  const sessionLive = sessionOnTrack(state.track, state.session);
  const drivers = [];
  for (const d of driverProg.values()) {
    if (!sessionLive || !d.onTrack || !d.sectors) continue;
    drivers.push({
      stnr: d.stnr,
      name: d.name,
      position: d.position,
      focus: d.focus,
      lastLap: d.lastLap,
      lastLapSec: d.lastLapSec,
      laps: d.laps,
      lapStartedAt: d.lapStartedAt,
      sectors: d.sectors,
      onTrack: d.onTrack,
    });
  }
  drivers.sort((a, b) => Number(a.position) - Number(b.position));
  return {
    active: sessionLive && drivers.length > 0,
    trackState: state.track?.trackState ?? null,
    timeState: state.track?.timeState ?? null,
    driverCount: drivers.length,
    drivers,
    serverNow: Date.now(),
  };
}

async function refreshHistories() {
  if (historyLoading) return;
  historyLoading = true;
  try {
    console.log("[laps] loading known session histories…");
    state.histories = await loadKnownLapHistories(DRIVER_NUMBER);
    const current = state.session?.session;
    if (current) {
      const live = await fetchDriverLaps(current, DRIVER_NUMBER);
      state.liveLaps = live;
      seedBestLapFromHistory(DRIVER_NUMBER, live?.laps);
      if (state.results?.length) {
        state.results = state.results.map(enrichResultWithBestLap);
        state.focus = findFocus(state.results);
      }
      lastHistorySession = current;
    }
    touchAndBroadcast();
    console.log(
      "[laps] ready:",
      state.histories
        .filter((h) => h.available)
        .map((h) => `${h.short}:${h.lapCount}`)
        .join(", ") || "none",
    );
  } catch (err) {
    console.error("[laps]", err.message);
  } finally {
    historyLoading = false;
  }
}

async function refreshLiveLapsIfNeeded(sessionId, force = false) {
  if (!sessionId) return;
  if (!force && sessionId === lastHistorySession && state.liveLaps) return;
  lastHistorySession = sessionId;
  const live = await fetchDriverLaps(sessionId, DRIVER_NUMBER);
  if (live) {
    state.liveLaps = live;
    seedBestLapFromHistory(DRIVER_NUMBER, live?.laps);
    if (state.results?.length) {
      state.results = state.results.map(enrichResultWithBestLap);
      state.focus = findFocus(state.results);
    }
    state.histories = state.histories.map((h) =>
      h.id === sessionId
        ? {
            ...h,
            available: true,
            heatType: live.heatType,
            bestLap: live.bestLap,
            lapCount: live.lapCount,
            laps: live.laps,
          }
        : h,
    );
    touchAndBroadcast();
  }
}

function parseTime(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw || raw === "—" || raw.startsWith("-") || /lap|pit/i.test(raw)) return null;
  if (raw.includes(":")) {
    const [mm, rest] = raw.split(":");
    const sec = Number.parseFloat(rest);
    const min = Number.parseInt(mm, 10);
    if (Number.isNaN(min) || Number.isNaN(sec)) return null;
    return min * 60 + sec;
  }
  const n = Number.parseFloat(raw);
  return Number.isNaN(n) ? null : n;
}

function formatDelta(seconds) {
  if (seconds == null || Number.isNaN(seconds)) return null;
  const sign = seconds > 0 ? "+" : seconds < 0 ? "-" : "";
  const abs = Math.abs(seconds);
  if (abs >= 60) {
    const m = Math.floor(abs / 60);
    const s = (abs % 60).toFixed(3).padStart(6, "0");
    return `${sign}${m}:${s}`;
  }
  return `${sign}${abs.toFixed(3)}`;
}

function formatLap(seconds) {
  if (seconds == null || Number.isNaN(seconds)) return null;
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(3).padStart(6, "0");
  return `${m}:${s}`;
}

function findFocus(results) {
  const byName = results.find((r) =>
    String(r.NAME || "")
      .toUpperCase()
      .includes(DRIVER_MATCH),
  );
  if (byName) return byName;
  return results.find((r) => String(r.STNR) === String(DRIVER_NUMBER)) || null;
}

function normalizeResult(row) {
  return {
    POSITION: row.POSITION,
    RANK: row.RANK,
    CLASSRANK: row.CLASSRANK,
    CHG: row.CHG,
    STNR: row.STNR,
    NAME: row.NAME,
    CLASSNAME: row.CLASSNAME,
    CAR: row.CAR,
    TEAM: row.TEAM,
    LAPS: row.LAPS,
    GAP: row.GAP,
    INT: row.INT,
    LASTLAPTIME: row.LASTLAPTIME,
    LLTS: row.LLTS,
    FASTESTLAP: row.FASTESTLAP,
    FLTS: row.FLTS,
    PITSTOPCOUNT: row.PITSTOPCOUNT,
    PITSUM: row.PITSUM,
    S1TIME: row.S1TIME,
    S2TIME: row.S2TIME,
    S3TIME: row.S3TIME,
    ST1T: row.ST1T,
    ST2T: row.ST2T,
    ST3T: row.ST3T,
    LASTINTERMEDIATENUMBER: row.LASTINTERMEDIATENUMBER,
  };
}

/** When last lap == personal best, snapshot that lap's sector splits. */
function captureBestLapSectors(row) {
  const stnr = String(row.STNR ?? "");
  if (!stnr) return;
  const best = parseTime(row.FASTESTLAP);
  const last = parseTime(row.LASTLAPTIME);
  const s1 = parseTime(row.S1TIME);
  const s2 = parseTime(row.S2TIME);
  const s3 = parseTime(row.S3TIME);
  if (best == null || last == null || s1 == null || s2 == null || s3 == null) {
    return;
  }
  if (Math.abs(last - best) > 0.005) return;
  const sum = s1 + s2 + s3;
  if (Math.abs(sum - best) > 0.15) return;

  const prev = bestLapSectors.get(stnr);
  if (prev?.bestSec != null && best > prev.bestSec + 0.0005) return;

  bestLapSectors.set(stnr, {
    s1: String(row.S1TIME),
    s2: String(row.S2TIME),
    s3: String(row.S3TIME),
    bestSec: best,
    lap: String(row.FASTESTLAP),
  });
}

function seedBestLapFromHistory(stnr, laps) {
  if (!stnr || !Array.isArray(laps) || !laps.length) return;
  let best = null;
  for (const lap of laps) {
    if (lap?.timeSec == null || lap.s1Sec == null || lap.s2Sec == null || lap.s3Sec == null) {
      continue;
    }
    if (!best || lap.timeSec < best.timeSec) best = lap;
  }
  if (!best) return;
  const prev = bestLapSectors.get(String(stnr));
  if (prev?.bestSec != null && best.timeSec > prev.bestSec + 0.0005) return;
  bestLapSectors.set(String(stnr), {
    s1: String(best.s1),
    s2: String(best.s2),
    s3: String(best.s3),
    bestSec: best.timeSec,
    lap: String(best.time),
  });
}

function enrichResultWithBestLap(row) {
  const stored = bestLapSectors.get(String(row.STNR));
  return {
    ...row,
    BESTS1: stored?.s1 ?? null,
    BESTS2: stored?.s2 ?? null,
    BESTS3: stored?.s3 ?? null,
  };
}

function sessionMode(heatType, heatName = "") {
  const t = String(heatType || "").toUpperCase();
  const name = String(heatName || "").toLowerCase();
  if (
    t === "Q" ||
    t.startsWith("Q") ||
    /qualif|időmér|idomer/.test(name)
  ) {
    return "qualifying";
  }
  if (t === "R" || t.startsWith("R") || /race|futam/.test(name)) return "race";
  if (
    t === "P" ||
    t.startsWith("P") ||
    /practice|edzés|edzes|warm\s*up|free practice/.test(name)
  ) {
    return "practice";
  }
  if (t === "T") {
    // LTS often uses T for timed sessions — prefer name
    if (/qualif/.test(name)) return "qualifying";
    if (/warm|practice|edzés|edzes/.test(name)) return "practice";
  }
  return "session";
}

function parseBestSectors(best) {
  if (!Array.isArray(best)) return [];
  return best
    .slice(0, 3)
    .map((entry, idx) => {
      if (!Array.isArray(entry)) return null;
      const [stnr, time] = entry;
      const seconds = parseTime(time);
      if (!seconds) return null;
      return { sector: idx + 1, stnr: String(stnr), time: String(time), seconds };
    })
    .filter(Boolean);
}

function buildAnalysis() {
  const results = state.results;
  const focus = state.focus;
  if (!focus || !results.length) return null;

  const sorted = [...results].sort(
    (a, b) => Number(a.POSITION) - Number(b.POSITION),
  );
  const idx = sorted.findIndex((r) => String(r.STNR) === String(focus.STNR));
  const leader = sorted[0] || null;
  const ahead = idx > 0 ? sorted[idx - 1] : null;
  const behind = idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1] : null;

  const classMates = sorted.filter((r) => r.CLASSNAME === focus.CLASSNAME);
  const classLeader = classMates[0] || null;
  const classIdx = classMates.findIndex((r) => String(r.STNR) === String(focus.STNR));
  const classAhead = classIdx > 0 ? classMates[classIdx - 1] : null;

  const byBest = [...results]
    .map((r) => ({ ...r, bestSec: parseTime(r.FASTESTLAP) }))
    .filter((r) => r.bestSec != null)
    .sort((a, b) => a.bestSec - b.bestSec);
  const bestRank = byBest.findIndex((r) => String(r.STNR) === String(focus.STNR));
  const pole = byBest[0] || null;
  const focusBest = parseTime(focus.FASTESTLAP);
  const deltaToPole =
    focusBest != null && pole?.bestSec != null ? focusBest - pole.bestSec : null;

  const classByBest = byBest.filter((r) => r.CLASSNAME === focus.CLASSNAME);
  const classBestRank = classByBest.findIndex(
    (r) => String(r.STNR) === String(focus.STNR),
  );
  const classPole = classByBest[0] || null;
  const deltaToClassPole =
    focusBest != null && classPole?.bestSec != null
      ? focusBest - classPole.bestSec
      : null;

  const sessionBest = state.bestSectors;
  const sectors = [1, 2, 3].map((n) => {
    const timeKey = `S${n}TIME`;
    const statusKey = `ST${n}T`;
    const own = parseTime(focus[timeKey]);
    const best = sessionBest.find((s) => s.sector === n) || null;
    const delta = own != null && best ? own - best.seconds : null;
    return {
      sector: n,
      time: focus[timeKey] || null,
      status: focus[statusKey] || "0",
      bestTime: best?.time || null,
      bestStnr: best?.stnr || null,
      delta: formatDelta(delta),
      deltaSec: delta,
      isPurple: best && String(best.stnr) === String(focus.STNR),
    };
  });

  const theoretical =
    sectors.every((s) => s.bestTime) &&
    sessionBest.length >= 3
      ? sessionBest.slice(0, 3).reduce((sum, s) => sum + s.seconds, 0)
      : null;
  const theoreticalDelta =
    focusBest != null && theoretical != null ? focusBest - theoretical : null;

  const kissLaps = state.bestLaps
    .filter((l) => String(l.NR) === String(focus.STNR))
    .slice(0, 8);

  const mode = sessionMode(state.session?.heatType, state.session?.heat);

  return {
    mode,
    modeLabel:
      mode === "qualifying"
        ? "Időmérő"
        : mode === "race"
          ? "Futam"
          : mode === "practice"
            ? /warm/.test(String(state.session?.heat || "").toLowerCase())
              ? "Warm up"
              : "Edzés"
            : "Szekció",
    battle: {
      leader: leader
        ? {
            stnr: leader.STNR,
            name: leader.NAME,
            gap: focus.GAP,
            best: leader.FASTESTLAP,
          }
        : null,
      ahead: ahead
        ? {
            stnr: ahead.STNR,
            name: ahead.NAME,
            interval: focus.INT,
            best: ahead.FASTESTLAP,
            last: ahead.LASTLAPTIME,
          }
        : null,
      behind: behind
        ? {
            stnr: behind.STNR,
            name: behind.NAME,
            interval: behind.INT,
            best: behind.FASTESTLAP,
            last: behind.LASTLAPTIME,
          }
        : null,
      classLeader: classLeader
        ? {
            stnr: classLeader.STNR,
            name: classLeader.NAME,
            classRank: focus.CLASSRANK,
          }
        : null,
      classAhead: classAhead
        ? { stnr: classAhead.STNR, name: classAhead.NAME }
        : null,
    },
    pace: {
      bestRank: bestRank >= 0 ? bestRank + 1 : null,
      bestCount: byBest.length,
      classBestRank: classBestRank >= 0 ? classBestRank + 1 : null,
      classBestCount: classByBest.length,
      deltaToPole: formatDelta(deltaToPole),
      deltaToClassPole: formatDelta(deltaToClassPole),
      pole: pole
        ? { stnr: pole.STNR, name: pole.NAME, time: pole.FASTESTLAP }
        : null,
      classPole: classPole
        ? { stnr: classPole.STNR, name: classPole.NAME, time: classPole.FASTESTLAP }
        : null,
      theoreticalBest: formatLap(theoretical),
      theoreticalDelta: formatDelta(theoreticalDelta),
      lastVsBest: formatDelta(
        (() => {
          const last = parseTime(focus.LASTLAPTIME);
          if (last == null || focusBest == null) return null;
          return last - focusBest;
        })(),
      ),
    },
    sectors,
    kissLaps,
    relevantMessages: state.messages
      .filter((m) => {
        const text = String(m.message || "").toUpperCase();
        return (
          text.includes(`#${focus.STNR}`) ||
          text.includes(DRIVER_MATCH) ||
          /FLAG|SAFETY|RED|GREEN|CHEQUERED|FINAL LAP|SESSION|RAIN|TRACK/i.test(
            text,
          )
        );
      })
      .slice(0, 10),
  };
}

function touchAndBroadcast() {
  state.updateCount += 1;
  state.lastUpdate = Date.now();
  state.analysis = buildAnalysis();
  broadcast(snapshot());
}

function handleUpstreamJson(msg) {
  if (!msg || typeof msg !== "object") return;

  if (msg.PID === "LTS_TIMESYNC") return;

  if (msg.PID === "0") {
    const prevSession = state.session?.session;
    const prevSessionMeta = state.session;
    const prevResults = state.results;
    const prevMode = state.analysis?.mode;
    const nextSession = msg.SESSION != null ? String(msg.SESSION) : null;
    if (nextSession && prevSession && nextSession !== String(prevSession)) {
      console.log(`[session] ${prevSession} → ${nextSession} (${msg.HEAT})`);
      if (prevMode === "race" && prevSessionMeta && prevResults?.length) {
        recordRaceResult({
          session: prevSessionMeta,
          results: prevResults,
          source: "session-end",
        });
      } else if (
        lastRaceSnapshot &&
        String(lastRaceSnapshot.session?.session) === String(prevSession)
      ) {
        recordRaceResult({
          session: lastRaceSnapshot.session,
          results: lastRaceSnapshot.results,
          source: "session-end-buffered",
        });
      }
      lastRaceSnapshot = null;
      driverProg.clear();
      bestLapSectors.clear();
      state.field = null;
      state.liveLaps = null;
      lastHistorySession = null;
      lastSeenLapCount = null;
    }
    state.session = {
      exportId: msg.EXPORTID,
      heat: msg.HEAT,
      heatType: msg.HEATTYPE,
      heatNumber: msg.HEATNUMBER,
      session: msg.SESSION,
      cup: msg.CUP,
      trackName: msg.TRACKNAME,
      trackLength: msg.TRACKLENGTH,
      version: msg.VER,
      intermediates: msg.NROFINTERMEDIATETIMES,
    };
    const normalized = (msg.RESULT || []).map(normalizeResult);
    for (const row of normalized) captureBestLapSectors(row);
    state.results = normalized.map(enrichResultWithBestLap);
    state.focus = findFocus(state.results);
    state.bestSectors = parseBestSectors(msg.BEST);
    state.session.sectorLengths = {
      s1: msg.S1L,
      s2: msg.S2L,
      s3: msg.S3L,
    };
    updateDriverProgress(state.results, state.focus?.STNR);
    state.field = buildField();
    state.error = null;

    const upcomingMode = sessionMode(state.session.heatType, state.session.heat);
    if (upcomingMode === "race" && state.results.length) {
      lastRaceSnapshot = {
        session: { ...state.session },
        results: state.results.map((r) => ({ ...r })),
      };
    }

    touchAndBroadcast();
    const lapCount = state.focus?.LAPS ?? null;
    const force =
      (lapCount != null && lapCount !== lastSeenLapCount) ||
      (nextSession && nextSession !== String(prevSession));
    lastSeenLapCount = lapCount;
    refreshLiveLapsIfNeeded(msg.SESSION, force);
    return;
  }

  if (msg.PID === "4") {
    state.track = {
      trackState: msg.TRACKSTATE,
      timeState: msg.TIMESTATE,
      endTime: msg.ENDTIME,
      tod: msg.TOD,
    };
    state.field = buildField();
    touchAndBroadcast();
    return;
  }

  if (msg.PID === "3") {
    state.messages = (msg.MESSAGES || []).map((m) => ({
      id: m.ID,
      time: m.MESSAGETIME,
      message: m.MESSAGE,
      group: m.MESSAGEGROUP,
    }));
    const chequered = state.messages.some((m) =>
      /CHEQUERED|CHECKERED|CÉLZÁSZLÓ|CELZASZLO/i.test(String(m.message || "")),
    );
    if (
      chequered &&
      state.analysis?.mode === "race" &&
      state.session &&
      state.results?.length
    ) {
      recordRaceResult({
        session: state.session,
        results: state.results,
        source: "chequered",
      });
    }
    touchAndBroadcast();
    return;
  }

  if (msg.PID === "9002") {
    state.leading = msg.LEADING || [];
    state.bestLaps = msg.BESTLAPS || [];
    const theo = (msg.BESTSECTORS || []).filter(
      (s) => s.CLASS === "TOTAL" && s.LAPTIME,
    );
    state.theoreticalSectors = theo.slice(-3);
    touchAndBroadcast();
    return;
  }

  if (msg.PID === "LTS_NOT_FOUND") {
    state.session = null;
    state.results = [];
    state.focus = null;
    state.analysis = null;
    state.field = null;
    driverProg.clear();
    bestLapSectors.clear();
    state.error = "Ehhez az eventhez nincs aktív timing";
    touchAndBroadcast();
  }
}

let upstream = null;
let reconnectTimer = null;
let intentionalClose = false;
let lastUpstreamMsgAt = 0;
let staleWatchTimer = null;
let resubTimer = null;

const STALE_MS = 60_000;
const RESUB_MS = 30_000;

function forceUpstreamReconnect(reason) {
  console.log(`[upstream] force reconnect: ${reason}`);
  intentionalClose = true;
  try {
    upstream?.close();
  } catch {
    /* ignore */
  }
  upstream = null;
  intentionalClose = false;
  scheduleReconnect(500);
}

function subscribeUpstream() {
  if (!upstream || upstream.readyState !== WebSocket.OPEN) return;
  upstream.send(
    JSON.stringify({
      eventId: EVENT_ID,
      eventPid: EVENT_PIDS,
      clientLocalTime: Date.now(),
    }),
  );
}

function connectUpstream() {
  if (
    upstream &&
    (upstream.readyState === WebSocket.OPEN ||
      upstream.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  intentionalClose = false;
  console.log(`[upstream] connecting ${UPSTREAM} event=${EVENT_ID}`);
  upstream = new WebSocket(UPSTREAM);

  upstream.on("open", () => {
    state.connected = true;
    state.error = null;
    lastUpstreamMsgAt = Date.now();
    broadcast(snapshot());
    subscribeUpstream();
  });

  upstream.on("message", (buf) => {
    lastUpstreamMsgAt = Date.now();
    try {
      handleUpstreamJson(JSON.parse(buf.toString()));
    } catch (err) {
      console.error("[upstream] bad json", err.message);
    }
  });

  upstream.on("close", () => {
    state.connected = false;
    broadcast(snapshot());
    if (!intentionalClose) scheduleReconnect();
  });

  upstream.on("error", (err) => {
    console.error("[upstream]", err.message);
    state.error = err.message;
    broadcast(snapshot());
  });
}

function scheduleReconnect(delayMs = 2500) {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectUpstream();
  }, delayMs);
}

function startUpstreamWatchdogs() {
  if (!staleWatchTimer) {
    staleWatchTimer = setInterval(() => {
      if (!upstream || upstream.readyState !== WebSocket.OPEN) {
        if (!intentionalClose) connectUpstream();
        return;
      }
      if (lastUpstreamMsgAt && Date.now() - lastUpstreamMsgAt > STALE_MS) {
        forceUpstreamReconnect(`stale ${Math.round((Date.now() - lastUpstreamMsgAt) / 1000)}s`);
      }
    }, 5000);
  }
  if (!resubTimer) {
    resubTimer = setInterval(() => {
      if (upstream?.readyState === WebSocket.OPEN) subscribeUpstream();
    }, RESUB_MS);
  }
}

const app = express();

app.get("/", (_req, res) => {
  res.sendFile(join(ROOT, "public/pulse.html"));
});

app.get(["/index.html", "/team.html"], (_req, res) => {
  res.redirect(302, "/");
});

app.use(express.static(join(ROOT, "public")));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    connected: state.connected,
    lastUpdate: state.lastUpdate,
    updateCount: state.updateCount,
    drivers: state.results.length,
    focus: state.focus?.NAME ?? null,
    mode: state.analysis?.mode ?? null,
  });
});

app.get("/api/snapshot", (_req, res) => {
  res.json(snapshot());
});

app.get("/api/standings", (_req, res) => {
  res.json(buildMergedStandings());
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/live" });

wss.on("connection", (socket) => {
  clients.add(socket);
  socket.send(JSON.stringify(snapshot()));
  socket.on("close", () => clients.delete(socket));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Kiss Live → http://0.0.0.0:${PORT}`);
  connectUpstream();
  startUpstreamWatchdogs();
  refreshHistories();
});

function shutdown() {
  intentionalClose = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (staleWatchTimer) clearInterval(staleWatchTimer);
  if (resubTimer) clearInterval(resubTimer);
  if (upstream) upstream.close();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
