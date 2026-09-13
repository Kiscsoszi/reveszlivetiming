/** Shared live-timing helpers for visitor + team pages */

export function $(id) {
  return document.getElementById(id);
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function parseTime(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw || raw.startsWith("-") || /lap/i.test(raw)) return null;
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

export function formatDelta(seconds) {
  if (seconds == null || Number.isNaN(seconds)) return "—";
  const sign = seconds > 0 ? "+" : seconds < 0 ? "-" : "";
  return `${sign}${Math.abs(seconds).toFixed(3)}`;
}

export function connectLive(onSnapshot) {
  let timer = null;
  const open = () => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/live`);
    ws.addEventListener("message", (ev) => {
      try {
        onSnapshot(JSON.parse(ev.data));
      } catch {
        /* ignore */
      }
    });
    ws.addEventListener("close", () => {
      clearTimeout(timer);
      timer = setTimeout(open, 1500);
    });
  };
  open();
}

export function historiesList(snapshot) {
  const list = [...(snapshot.histories || [])];
  if (
    snapshot.liveLaps?.laps?.length &&
    !list.some((h) => h.id === snapshot.liveLaps.sessionId)
  ) {
    list.push({
      id: snapshot.liveLaps.sessionId,
      label: snapshot.session?.heat || "Élő szekció",
      short: "LIVE",
      available: true,
      bestLap: snapshot.liveLaps.bestLap,
      lapCount: snapshot.liveLaps.lapCount,
      laps: snapshot.liveLaps.laps,
    });
  }
  return list.filter((h) => h.available);
}

/** Engineer metrics derived from snapshot */
export function engineerMetrics(snapshot) {
  const f = snapshot.focus;
  const a = snapshot.analysis;
  if (!f || !a) return null;

  const laps =
    snapshot.liveLaps?.laps ||
    historiesList(snapshot).find((h) => h.id === snapshot.session?.session)?.laps ||
    [];

  const recent = laps.slice(-5);
  const recentSecs = recent.map((l) => l.timeSec).filter((v) => v != null);
  let consistency = null;
  if (recentSecs.length >= 3) {
    const mean = recentSecs.reduce((s, v) => s + v, 0) / recentSecs.length;
    const variance =
      recentSecs.reduce((s, v) => s + (v - mean) ** 2, 0) / recentSecs.length;
    consistency = Math.sqrt(variance);
  }

  const trend =
    recentSecs.length >= 3
      ? recentSecs.at(-1) - recentSecs[0]
      : null;

  const roll3 = recentSecs.slice(-3);
  const rollingAvg =
    roll3.length >= 3
      ? roll3.reduce((s, v) => s + v, 0) / roll3.length
      : null;

  const bestS1 = Math.min(...laps.map((l) => l.s1Sec).filter(Boolean));
  const bestS2 = Math.min(...laps.map((l) => l.s2Sec).filter(Boolean));
  const bestS3 = Math.min(...laps.map((l) => l.s3Sec).filter(Boolean));
  const theoOwn =
    Number.isFinite(bestS1) && Number.isFinite(bestS2) && Number.isFinite(bestS3)
      ? bestS1 + bestS2 + bestS3
      : null;
  const focusBest = parseTime(f.FASTESTLAP);

  function fmtLap(sec) {
    if (sec == null || Number.isNaN(sec)) return null;
    const m = Math.floor(sec / 60);
    const s = (sec % 60).toFixed(3).padStart(6, "0");
    return `${m}:${s}`;
  }

  return {
    position: f.POSITION,
    classRank: f.CLASSRANK,
    gap: f.GAP,
    interval: f.INT,
    last: f.LASTLAPTIME,
    best: f.FASTESTLAP,
    lastVsBest: a.pace?.lastVsBest,
    deltaPole: a.pace?.deltaToPole,
    deltaClassPole: a.pace?.deltaToClassPole,
    bestRank: a.pace?.bestRank,
    bestCount: a.pace?.bestCount,
    classBestRank: a.pace?.classBestRank,
    classBestCount: a.pace?.classBestCount,
    theoreticalSession: a.pace?.theoreticalBest,
    theoreticalSessionDelta: a.pace?.theoreticalDelta,
    theoreticalOwn: theoOwn,
    theoreticalOwnFmt: fmtLap(theoOwn),
    theoreticalOwnDelta:
      theoOwn != null && focusBest != null ? focusBest - theoOwn : null,
    rollingAvg,
    rollingAvgFmt: fmtLap(rollingAvg),
    rollingAvgVsBest:
      rollingAvg != null && focusBest != null ? rollingAvg - focusBest : null,
    sectors: a.sectors,
    battle: a.battle,
    consistency,
    trend,
    lapCount: f.LAPS,
    pits: f.PITSTOPCOUNT,
    messages: a.relevantMessages || [],
    laps,
    bestSectorParts: {
      s1: Number.isFinite(bestS1) ? bestS1.toFixed(3) : null,
      s2: Number.isFinite(bestS2) ? bestS2.toFixed(3) : null,
      s3: Number.isFinite(bestS3) ? bestS3.toFixed(3) : null,
    },
  };
}

export const TRACKS = {
  most: {
    id: "most",
    src: "/tracks/most.svg?v=centerline3",
    startFinish: { x: 1070, y: 621 },
    label: "Autodrom Most",
  },
  zolder: {
    id: "zolder",
    src: "/tracks/zolder.svg?v=1",
    startFinish: { x: 240.57, y: 310.55 },
    label: "Circuit Zolder",
  },
};

export function resolveTrack(trackName) {
  const n = String(trackName || "").toLowerCase();
  if (n.includes("zolder") || n.includes("terlamen")) return TRACKS.zolder;
  if (n.includes("most")) return TRACKS.most;
  return TRACKS.zolder;
}

export function createTrackAnimator({
  objectEl,
  metaEl,
  sectorEl,
  lapEl,
  sourceEl,
  toggleEl,
  titleEl = null,
  startFinish = TRACKS.zolder.startFinish,
}) {
  const anim = {
    ready: false,
    playing: true,
    mode: "idle",
    path: null,
    doc: null,
    layer: null,
    kissDot: null,
    kissLabel: null,
    markers: new Map(),
    clocks: new Map(),
    length: 0,
    startOffset: 0,
    raf: null,
    clockSkew: 0,
    pathEnds: [1 / 3, 2 / 3, 1],
    field: null,
    replay: null,
    pendingSnapshot: null,
    trackId: null,
  };

  let sf = { ...startFinish };

  function findStartOffset(path) {
    const len = path.getTotalLength();
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i <= 500; i++) {
      const d = (len * i) / 500;
      const pt = path.getPointAtLength(d);
      const dist = (pt.x - sf.x) ** 2 + (pt.y - sf.y) ** 2;
      if (dist < bestDist) {
        bestDist = dist;
        best = d;
      }
    }
    return best;
  }

  function applyTrack(track) {
    if (!objectEl || !track || anim.trackId === track.id) return;
    const sameSrc = objectEl.getAttribute("data") === track.src;
    anim.trackId = track.id;
    sf = { ...track.startFinish };
    if (titleEl) titleEl.textContent = track.label;
    if (sameSrc) {
      if (anim.path) anim.startOffset = findStartOffset(anim.path);
      return;
    }
    anim.ready = false;
    anim.path = null;
    anim.doc = null;
    anim.layer = null;
    anim.kissDot = null;
    anim.kissLabel = null;
    anim.markers.clear();
    anim.clocks.clear();
    anim.field = null;
    objectEl.setAttribute("data", track.src);
  }

  function pathEndsFromSnapshot(snapshot) {
    const lengths = snapshot?.session?.sectorLengths;
    const l1 = Number.parseFloat(lengths?.s1);
    const l2 = Number.parseFloat(lengths?.s2);
    const l3 = Number.parseFloat(lengths?.s3);
    if (l1 > 0 && l2 > 0 && l3 > 0) {
      const total = l1 + l2 + l3;
      return [l1 / total, (l1 + l2) / total, 1];
    }
    return [1 / 3, 2 / 3, 1];
  }

  function progressFromElapsed(elapsedSec, sectorSecs) {
    const [s1, s2, s3] = sectorSecs;
    const total = s1 + s2 + s3;
    if (!(total > 0)) return 0;
    let t = elapsedSec % total;
    if (t < 0) t += total;
    const [p1, p2] = anim.pathEnds;
    if (t <= s1) return (t / s1) * p1;
    if (t <= s1 + s2) return p1 + ((t - s1) / s2) * (p2 - p1);
    return p2 + ((t - s1 - s2) / s3) * (1 - p2);
  }

  function elapsedFromProgress(progress, sectorSecs) {
    const p = ((progress % 1) + 1) % 1;
    const [s1, s2, s3] = sectorSecs;
    const [p1, p2] = anim.pathEnds;
    if (p <= p1) return (p / p1) * s1;
    if (p <= p2) return s1 + ((p - p1) / (p2 - p1)) * s2;
    return s1 + s2 + ((p - p2) / (1 - p2)) * s3;
  }

  function pointAt(progress) {
    const p = ((progress % 1) + 1) % 1;
    const d = (anim.startOffset + p * anim.length) % anim.length;
    return anim.path.getPointAtLength(d);
  }

  function sectorOf(progress) {
    if (progress <= anim.pathEnds[0]) return 1;
    if (progress <= anim.pathEnds[1]) return 2;
    return 3;
  }

  function upsertClock(driver, wallNow) {
    const secs = [driver.sectors.s1, driver.sectors.s2, driver.sectors.s3];
    let clock = anim.clocks.get(driver.stnr);
    if (!clock) {
      clock = {
        stnr: driver.stnr,
        lapStartedAt: driver.lapStartedAt,
        sectors: secs,
      };
      anim.clocks.set(driver.stnr, clock);
      return clock;
    }
    const samePace =
      Math.abs(clock.sectors[0] - secs[0]) < 0.001 &&
      Math.abs(clock.sectors[1] - secs[1]) < 0.001 &&
      Math.abs(clock.sectors[2] - secs[2]) < 0.001;
    if (!samePace) {
      const elapsed = (wallNow - clock.lapStartedAt) / 1000;
      const prog = progressFromElapsed(elapsed, clock.sectors);
      const kept = elapsedFromProgress(prog, secs);
      clock.lapStartedAt = wallNow - kept * 1000;
      clock.sectors = secs;
    }
    return clock;
  }

  function ensureMarker(stnr, focus) {
    let m = anim.markers.get(stnr);
    if (m) return m;
    const g = anim.doc.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("id", `car-${stnr}`);
    const dot = anim.doc.createElementNS("http://www.w3.org/2000/svg", "circle");
    const label = anim.doc.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("font-family", "Bebas Neue, Impact, sans-serif");
    label.textContent = stnr;
    g.appendChild(dot);
    g.appendChild(label);
    anim.layer.appendChild(g);
    m = { g, dot, label, stnr, focus };
    anim.markers.set(stnr, m);
    return m;
  }

  function styleMarker(m, focus) {
    m.focus = focus;
    if (focus) {
      m.dot.setAttribute("r", "14");
      m.dot.setAttribute("fill", "#e62d37");
      m.dot.setAttribute("stroke", "#f4f1ea");
      m.dot.setAttribute("stroke-width", "3");
      m.label.setAttribute("fill", "#f4f1ea");
      m.label.setAttribute("font-size", "20");
      m.g.setAttribute("opacity", "1");
    } else {
      m.dot.setAttribute("r", "9");
      m.dot.setAttribute("fill", "#d8dde3");
      m.dot.setAttribute("stroke", "#1a1d22");
      m.dot.setAttribute("stroke-width", "2");
      m.label.setAttribute("fill", "#f4f1ea");
      m.label.setAttribute("font-size", "14");
      m.g.setAttribute("opacity", "0.92");
    }
  }

  function placeMarker(m, progress) {
    const pt = pointAt(progress);
    m.dot.setAttribute("cx", pt.x);
    m.dot.setAttribute("cy", pt.y);
    m.label.setAttribute("x", pt.x);
    m.label.setAttribute("y", pt.y - (m.focus ? 22 : 16));
  }

  function setHud({ sector, lap, source, meta }) {
    if (sectorEl && sector != null) sectorEl.textContent = sector;
    if (lapEl && lap != null) lapEl.textContent = lap;
    if (sourceEl && source != null) sourceEl.textContent = source;
    if (metaEl && meta != null) metaEl.textContent = meta;
  }

  function hideField() {
    for (const m of anim.markers.values()) {
      m.g.setAttribute("display", "none");
    }
    if (anim.kissDot) anim.kissDot.setAttribute("display", "none");
    if (anim.kissLabel) anim.kissLabel.setAttribute("display", "none");
  }

  function clearReplay() {
    anim.replay = null;
    if (anim.mode === "replay") anim.mode = "idle";
  }

  function tick(now = performance.now()) {
    anim.raf = requestAnimationFrame(tick);
    if (!anim.ready || !anim.playing) return;

    if (anim.mode === "field" && anim.field?.active) {
      const wall = Date.now() + anim.clockSkew;
      let focusProg = null;
      let focusDriver = null;
      const liveIds = new Set();

      for (const d of anim.field.drivers) {
        if (!d.onTrack || !d.sectors) continue;
        liveIds.add(d.stnr);
        const clock = upsertClock(d, wall);
        const elapsed = (wall - clock.lapStartedAt) / 1000;
        const progress = progressFromElapsed(elapsed, clock.sectors);
        const m = ensureMarker(d.stnr, d.focus);
        styleMarker(m, Boolean(d.focus));
        m.g.removeAttribute("display");
        placeMarker(m, progress);
        if (d.focus) {
          focusProg = progress;
          focusDriver = d;
        }
      }

      for (const [id, m] of anim.markers) {
        if (!liveIds.has(id)) m.g.setAttribute("display", "none");
      }
      for (const id of [...anim.clocks.keys()]) {
        if (!liveIds.has(id)) anim.clocks.delete(id);
      }
      if (anim.kissDot) anim.kissDot.setAttribute("display", "none");
      if (anim.kissLabel) anim.kissLabel.setAttribute("display", "none");

      if (focusDriver && focusProg != null) {
        const sector = sectorOf(focusProg);
        const clock = anim.clocks.get(focusDriver.stnr);
        setHud({
          sector: `Kiss · S${sector}`,
          lap: focusDriver.lastLap || "—",
          source: `pályán · ${anim.field.driverCount} autó`,
          meta: clock
            ? `folyamatos · S1 ${clock.sectors[0].toFixed(3)} · S2 ${clock.sectors[1].toFixed(3)} · S3 ${clock.sectors[2].toFixed(3)}`
            : "folyamatos",
        });
      }
      return;
    }

    if (anim.mode !== "replay") hideField();

    if (anim.mode === "replay" && anim.replay) {
      const { sectorSecs, startedAt, lap, source } = anim.replay;
      const elapsedSec = (now - startedAt) / 1000;
      const progress = progressFromElapsed(elapsedSec, sectorSecs);
      const sector = sectorOf(progress);
      const pt = pointAt(progress);
      if (anim.kissDot) {
        anim.kissDot.removeAttribute("display");
        anim.kissDot.setAttribute("cx", pt.x);
        anim.kissDot.setAttribute("cy", pt.y);
        const colors = { 1: "#22c55e", 2: "#ffe27a", 3: "#ff6b6b" };
        anim.kissDot.setAttribute("fill", colors[sector] || "#e62d37");
      }
      if (anim.kissLabel) {
        anim.kissLabel.removeAttribute("display");
        anim.kissLabel.setAttribute("x", pt.x);
        anim.kissLabel.setAttribute("y", pt.y - 22);
      }
      setHud({
        sector: `${sector}. szektor (replay)`,
        lap: lap.time || "—",
        source: `${source} · ${lap.lap}. kör`,
        meta: `replay · S1 ${lap.s1} · S2 ${lap.s2} · S3 ${lap.s3}`,
      });
    }
  }

  function syncField(snapshot) {
    applyTrack(resolveTrack(snapshot?.session?.trackName));
    if (!anim.ready) {
      anim.pendingSnapshot = snapshot;
      return;
    }
    anim.pathEnds = pathEndsFromSnapshot(snapshot);
    const field = snapshot?.field;
    anim.field = field || null;
    if (field?.serverNow) anim.clockSkew = field.serverNow - Date.now();

    if (field?.active && field.drivers?.length) {
      clearReplay();
      anim.mode = "field";
      anim.playing = true;
      const wall = Date.now() + anim.clockSkew;
      for (const d of field.drivers) {
        if (d.onTrack && d.sectors) upsertClock(d, wall);
      }
      if (toggleEl) toggleEl.textContent = "Szünet";
      if (!anim.raf) tick();
      return;
    }

    clearReplay();
    anim.mode = "idle";
    anim.playing = false;
    anim.clocks.clear();
    hideField();
    if (toggleEl) toggleEl.textContent = "Indítás";
    setHud({
      sector: "—",
      lap: "—",
      source: "nincs a pályán",
      meta: field
        ? `állás · flag ${field.trackState ?? "—"} · time ${field.timeState ?? "—"}`
        : "nincs mezőny adat",
    });
  }

  function playLap(lap, sourceLabel, snapshot) {
    if (!lap) return;
    anim.mode = "replay";
    anim.pathEnds = pathEndsFromSnapshot(snapshot);
    const sectorSecs =
      lap.s1Sec > 0 && lap.s2Sec > 0 && lap.s3Sec > 0
        ? [lap.s1Sec, lap.s2Sec, lap.s3Sec]
        : [
            (lap.timeSec || 120) / 3,
            (lap.timeSec || 120) / 3,
            (lap.timeSec || 120) / 3,
          ];
    anim.replay = {
      lap,
      source: sourceLabel || "Kiss",
      sectorSecs,
      startedAt: performance.now(),
    };
    anim.playing = true;
    hideField();
    if (anim.kissDot) anim.kissDot.removeAttribute("display");
    if (anim.kissLabel) anim.kissLabel.removeAttribute("display");
    if (toggleEl) toggleEl.textContent = "Szünet";
    if (!anim.raf) tick();
  }

  function init() {
    if (!objectEl) return;
    const setup = () => {
      const doc = objectEl.contentDocument;
      if (!doc) return;
      anim.doc = doc;
      anim.path = doc.getElementById("racing-line");
      anim.kissDot = doc.getElementById("truck-dot");
      anim.kissLabel = doc.getElementById("truck-label");
      if (!anim.path) return;
      anim.length = anim.path.getTotalLength();
      anim.startOffset = findStartOffset(anim.path);

      let layer = doc.getElementById("field-layer");
      if (!layer) {
        layer = doc.createElementNS("http://www.w3.org/2000/svg", "g");
        layer.setAttribute("id", "field-layer");
        doc.documentElement.appendChild(layer);
      }
      anim.layer = layer;

      const sf = anim.path.getPointAtLength(anim.startOffset);
      let pin = doc.getElementById("sf-pin");
      if (!pin) {
        pin = doc.createElementNS("http://www.w3.org/2000/svg", "circle");
        pin.setAttribute("id", "sf-pin");
        pin.setAttribute("r", "9");
        pin.setAttribute("fill", "#fff4f4");
        pin.setAttribute("stroke", "#e62d37");
        pin.setAttribute("stroke-width", "3");
        doc.documentElement.appendChild(pin);
      }
      pin.setAttribute("cx", sf.x);
      pin.setAttribute("cy", sf.y);

      if (anim.kissDot) anim.kissDot.setAttribute("display", "none");
      if (anim.kissLabel) anim.kissLabel.setAttribute("display", "none");

      anim.ready = true;
      if (anim.pendingSnapshot) {
        syncField(anim.pendingSnapshot);
        anim.pendingSnapshot = null;
      }
      if (!anim.raf) tick();
    };
    if (objectEl.contentDocument?.getElementById("racing-line")) setup();
    else objectEl.addEventListener("load", setup);
  }

  toggleEl?.addEventListener("click", () => {
    anim.playing = !anim.playing;
    toggleEl.textContent = anim.playing ? "Szünet" : "Indítás";
    if (anim.playing && anim.mode === "replay" && anim.replay) {
      anim.replay.startedAt = performance.now();
    }
  });

  init();
  return { playLap, syncField, anim };
}
