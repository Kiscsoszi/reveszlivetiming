import { WebSocket } from "ws";

const UPSTREAM = process.env.UPSTREAM_WS || "wss://livetiming.azurewebsites.net";
const EVENT_ID = process.env.EVENT_ID || "16";
const DRIVER_NUMBER = process.env.DRIVER_NUMBER || "1";

/** Known Most weekend sessions we can still pull. */
export const KNOWN_SESSIONS = [
  { id: "4600401007", label: "Warm up 2", short: "WU2" },
  { id: "4600401009", label: "Quali practice", short: "QP" },
  { id: "4600401010", label: "Quali practice 6", short: "QP6" },
  { id: "4600401101", label: "Futam 1", short: "R1" },
  { id: "4600401102", label: "Futam 2", short: "R2" },
];

function parseTime(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw || raw.startsWith("-")) return null;
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

function normalizeLap(row) {
  const t = parseTime(row.T);
  const s1 = parseTime(row.S1);
  const s2 = parseTime(row.S2);
  const s3 = parseTime(row.S3);
  return {
    lap: Number(row.L),
    stnr: String(row.N),
    timeOfDay: row.D,
    time: row.T,
    timeSec: t,
    s1: row.S1,
    s2: row.S2,
    s3: row.S3,
    s1Sec: s1,
    s2Sec: s2,
    s3Sec: s3,
  };
}

export function fetchDriverLaps(sessionId, startingNo = DRIVER_NUMBER, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const ws = new WebSocket(UPSTREAM);
    let settled = false;
    const timer = setTimeout(() => finish(null), timeoutMs);

    function finish(payload) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolve(payload);
    }

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          eventId: EVENT_ID,
          eventPid: [7],
          clientLocalTime: Date.now(),
          session: String(sessionId),
          startingNo: String(startingNo),
        }),
      );
    });

    ws.on("message", (buf) => {
      try {
        const msg = JSON.parse(buf.toString());
        if (String(msg.PID) !== "7") return;
        const laps = (msg.DATA || []).map(normalizeLap);
        const bestSec = laps
          .map((l) => l.timeSec)
          .filter((v) => v != null)
          .sort((a, b) => a - b)[0];
        finish({
          sessionId: String(msg.SESSION || sessionId),
          heatType: msg.HEATTYPE,
          sectors: Number(msg.SECTORS) || 3,
          startingNo: String(msg.N ?? startingNo),
          laps,
          bestLap: laps.find((l) => l.timeSec === bestSec) || null,
          lapCount: laps.length,
        });
      } catch {
        finish(null);
      }
    });

    ws.on("error", () => finish(null));
    ws.on("close", () => finish(null));
  });
}

export async function loadKnownLapHistories(startingNo = DRIVER_NUMBER) {
  const out = [];
  for (const meta of KNOWN_SESSIONS) {
    const data = await fetchDriverLaps(meta.id, startingNo);
    if (!data || !data.laps?.length) {
      out.push({ ...meta, available: false, laps: [] });
      continue;
    }
    out.push({
      ...meta,
      available: true,
      heatType: data.heatType,
      bestLap: data.bestLap,
      lapCount: data.lapCount,
      laps: data.laps,
    });
  }
  return out;
}
