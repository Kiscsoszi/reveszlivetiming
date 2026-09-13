import {
  $,
  escapeHtml,
  parseTime,
  formatDelta,
  connectLive,
  historiesList,
  engineerMetrics,
  createTrackAnimator,
} from "./shared.js";
import {
  resolvePointsScale,
  loadSeasonStandings,
  invalidateStandingsCache,
  buildSeasonDriverRows,
  buildSeasonTeamRows,
} from "./etrc-points.js";

const els = {
  liveDot: $("liveDot"),
  statusText: $("statusText"),
  feedMeta: $("feedMeta"),
  sessionLine: $("sessionLine"),
  heatTitle: $("heatTitle"),
  modeChip: $("modeChip"),
  posBlock: $("posBlock"),
  position: $("position"),
  classRank: $("classRank"),
  posChg: $("posChg"),
  aheadLabel: $("aheadLabel"),
  behindLabel: $("behindLabel"),
  aheadTag: $("aheadTag"),
  behindTag: $("behindTag"),
  carAhead: $("carAhead"),
  carFocus: $("carFocus"),
  carBehind: $("carBehind"),
  gapAhead: $("gapAhead"),
  gapLeader: $("gapLeader"),
  gapBehind: $("gapBehind"),
  sectorRadar: $("sectorRadar"),
  theoLine: $("theoLine"),
  huntPole: $("huntPole"),
  huntPoleWho: $("huntPoleWho"),
  huntClass: $("huntClass"),
  huntClassWho: $("huntClassWho"),
  huntRank: $("huntRank"),
  huntClassRank: $("huntClassRank"),
  huntLadder: $("huntLadder"),
  panelQualy: $("panelQualy"),
  panelRace: $("panelRace"),
  raceVsAhead: $("raceVsAhead"),
  raceAheadLap: $("raceAheadLap"),
  raceAheadKicker: $("raceAheadKicker"),
  raceAheadCard: $("raceAheadCard"),
  raceLast: $("raceLast"),
  raceLastMeta: $("raceLastMeta"),
  raceVsBehind: $("raceVsBehind"),
  raceBehindLap: $("raceBehindLap"),
  raceBehindKicker: $("raceBehindKicker"),
  raceBehindCard: $("raceBehindCard"),
  racePack: $("racePack"),
  racePits: $("racePits"),
  raceLaps: $("raceLaps"),
  raceChg: $("raceChg"),
  fieldKicker: $("fieldKicker"),
  thS1: $("thS1"),
  thS2: $("thS2"),
  thS3: $("thS3"),
  animMeta: $("animMeta"),
  rcTicker: $("rcTicker"),
  clock: $("clock"),
  fieldRows: $("fieldRows"),
  fieldCount: $("fieldCount"),
  pointsKicker: $("pointsKicker"),
  pointsTitle: $("pointsTitle"),
  pointsClinch: $("pointsClinch"),
  clinchBar: $("clinchBar"),
  clinchText: $("clinchText"),
  pointsScale: $("pointsScale"),
  pointsBtnDrivers: $("pointsBtnDrivers"),
  pointsBtnTeams: $("pointsBtnTeams"),
  pointsHead: $("pointsHead"),
  pointsRows: $("pointsRows"),
};

let lastUpdateAt = null;
let updateCount = 0;
let prevPos = null;
let wallMode = "session";
let pointsView = "drivers";
let lastSnapshot = null;
let seasonStandings = null;
let lastStandingsRaceCount = null;

async function refreshSeasonStandings(force = false) {
  if (force) invalidateStandingsCache();
  try {
    seasonStandings = await loadSeasonStandings();
    lastStandingsRaceCount = seasonStandings?.races?.length ?? null;
    renderPointsClinch(seasonStandings, {
      race: isRaceMode(wallMode),
    });
    if (lastSnapshot) renderPoints(lastSnapshot);
  } catch (err) {
    console.warn("[standings]", err);
  }
}

refreshSeasonStandings();

function isRaceMode(mode) {
  return mode === "race";
}

const track = createTrackAnimator({
  objectEl: $("trackObject"),
  metaEl: els.animMeta,
});

function refreshFeedAge() {
  if (!els.feedMeta || lastUpdateAt == null) return;
  const age = Math.max(0, Math.round((Date.now() - lastUpdateAt) / 1000));
  els.feedMeta.textContent = `#${updateCount} · ${age}s`;
}

function parseGapSeconds(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw || /lap|pit/i.test(raw)) return null;
  if (raw.startsWith("+")) return parseTime(raw.slice(1));
  return parseTime(raw);
}

function renderHero(s, m) {
  const f = s.focus;
  if (!f) {
    els.position.textContent = "—";
    els.classRank.textContent = "Nincs a sorrendben";
    els.posChg.hidden = true;
    return;
  }

  const pos = String(f.POSITION ?? "—");
  if (prevPos != null && prevPos !== pos) {
    els.posBlock.classList.remove("bump");
    void els.posBlock.offsetWidth;
    els.posBlock.classList.add("bump");
    if (navigator.vibrate) navigator.vibrate([12, 40, 12]);
  }
  prevPos = pos;
  els.position.textContent = pos;
  els.classRank.textContent = `#${f.STNR} · ${f.CLASSNAME || "—"} · kat. P${f.CLASSRANK || "—"}`;

  const chg = Number(f.CHG);
  if (Number.isFinite(chg) && chg !== 0) {
    els.posChg.hidden = false;
    els.posChg.textContent = chg > 0 ? `↑ +${chg}` : `↓ ${chg}`;
    els.posChg.classList.toggle("up", chg > 0);
    els.posChg.classList.toggle("down", chg < 0);
  } else {
    els.posChg.hidden = true;
  }

  if (s.analysis?.modeLabel) {
    els.modeChip.textContent = s.analysis.modeLabel.toUpperCase();
  }

  renderGapTheater(s, m);
}

function renderGapTheater(s, m) {
  const battle = s.analysis?.battle;
  const f = s.focus;
  const aheadSec = parseGapSeconds(battle?.ahead?.interval ?? f?.INT);
  const behindSec = parseGapSeconds(battle?.behind?.interval);
  const leaderSec = parseGapSeconds(f?.GAP);

  const maxSpan = Math.max(
    0.8,
    aheadSec ?? 0,
    behindSec ?? 0,
    Math.min(leaderSec ?? 0, 12),
  );

  // Focus fixed at center; ahead left, behind right — scale by interval
  els.carFocus.style.left = "50%";

  if (battle?.ahead && aheadSec != null) {
    const t = Math.min(1, aheadSec / maxSpan);
    els.carAhead.style.left = `${50 - 8 - t * 34}%`;
    els.carAhead.style.display = "";
    els.aheadTag.textContent = `#${battle.ahead.stnr} ${battle.ahead.name || ""}`.trim();
    els.aheadLabel.textContent = `Elöl · #${battle.ahead.stnr}`;
  } else if (!battle?.ahead && f && String(f.POSITION) === "1") {
    els.carAhead.style.display = "none";
    els.aheadTag.textContent = "P1";
    els.aheadLabel.textContent = "Szabad";
  } else {
    els.carAhead.style.left = "12%";
    els.carAhead.style.display = "";
    els.aheadTag.textContent = battle?.ahead
      ? `#${battle.ahead.stnr}`
      : "—";
    els.aheadLabel.textContent = "Elöl";
  }

  if (battle?.behind && behindSec != null) {
    const t = Math.min(1, behindSec / maxSpan);
    els.carBehind.style.left = `${50 + 8 + t * 34}%`;
    els.carBehind.style.display = "";
    els.behindTag.textContent = `#${battle.behind.stnr} ${battle.behind.name || ""}`.trim();
    els.behindLabel.textContent = `Hátul · #${battle.behind.stnr}`;
  } else {
    els.carBehind.style.display = battle?.behind ? "" : "none";
    els.behindTag.textContent = battle?.behind ? `#${battle.behind.stnr}` : "—";
    els.behindLabel.textContent = "Hátul";
  }

  els.gapAhead.textContent =
    battle?.ahead?.interval || (String(f?.POSITION) === "1" ? "P1" : "—");
  els.gapLeader.textContent = f?.GAP || "—";
  els.gapBehind.textContent = battle?.behind?.interval || "—";
}

function renderSectors(m) {
  if (!els.sectorRadar) return;

  const lastLap = (m?.laps || []).at(-1) || null;
  const keys = ["s1", "s2", "s3"];
  const bestParts = [
    m?.bestSectorParts?.s1,
    m?.bestSectorParts?.s2,
    m?.bestSectorParts?.s3,
  ];

  const rows = [1, 2, 3].map((n, i) => {
    const sec = m?.sectors?.[i];
    const lastStr = lastLap?.[keys[i]] || sec?.time || null;
    const lastSec =
      lastLap?.[`${keys[i]}Sec`] ?? parseTime(sec?.time ?? lastStr);
    const bestStr = bestParts[i] || null;
    const bestSec = bestStr != null ? Number.parseFloat(bestStr) : null;
    const vsOwn =
      lastSec != null && bestSec != null && Number.isFinite(bestSec)
        ? lastSec - bestSec
        : null;

    let tone = "";
    if (sec?.isPurple || (sec?.deltaSec != null && sec.deltaSec <= 0)) {
      tone = "purple";
    } else if (vsOwn != null && vsOwn <= 0.0005) {
      tone = "green";
    } else if (vsOwn != null && vsOwn < 0.3) {
      tone = "yellow";
    }

    const deltaCls =
      vsOwn == null ? "" : vsOwn <= 0.0005 ? "pos" : "neg";
    const deltaTxt =
      vsOwn == null
        ? "—"
        : vsOwn <= 0.0005
          ? "PB"
          : formatDelta(vsOwn);

    return `<div class="radar-cell ${tone}">
      <div class="sec-label">S${n}</div>
      <div class="sec-pair">
        <div class="sec-row last">
          <span class="sec-tag">LAST</span>
          <strong class="mono sec-val">${escapeHtml(lastStr || "—")}</strong>
        </div>
        <div class="sec-row best">
          <span class="sec-tag">BEST</span>
          <strong class="mono sec-val">${escapeHtml(bestStr || "—")}</strong>
        </div>
      </div>
      <div class="sec-delta ${deltaCls}">${escapeHtml(deltaTxt)}</div>
    </div>`;
  });

  els.sectorRadar.innerHTML = rows.join("");

  if (!els.theoLine) return;
  if (!m) {
    els.theoLine.innerHTML = "";
    return;
  }

  const own = m.theoreticalOwnFmt || "—";
  const ownD = formatDelta(m.theoreticalOwnDelta);
  const ownTone =
    m.theoreticalOwnDelta == null
      ? ""
      : m.theoreticalOwnDelta <= 0
        ? "pos"
        : "neg";
  els.theoLine.innerHTML = `
    <div class="sector-chip">
      <span class="pulse-kicker">Theo</span>
      <strong class="mono">${escapeHtml(own)}</strong>
    </div>
    <div class="sector-chip ${ownTone}">
      <span class="pulse-kicker">vs PB</span>
      <strong class="mono">${escapeHtml(ownD)}</strong>
    </div>
  `;
}

function renderHunt(s, m) {
  const results = Array.isArray(s?.results) ? s.results : [];
  const focus = s?.focus;
  const focusNo = focus?.STNR;

  const byBest = results
    .map((r) => ({ ...r, bestSec: parseTime(r.FASTESTLAP) }))
    .filter((r) => r.bestSec != null)
    .sort((a, b) => a.bestSec - b.bestSec);

  const pole = byBest[0] || null;
  const focusBest = parseTime(focus?.FASTESTLAP);
  const classMates = byBest.filter((r) => r.CLASSNAME === focus?.CLASSNAME);
  const classPole = classMates[0] || null;
  const bestRank = byBest.findIndex((r) => String(r.STNR) === String(focusNo));
  const classRank = classMates.findIndex((r) => String(r.STNR) === String(focusNo));

  const deltaPole =
    m?.deltaPole ??
    (focusBest != null && pole?.bestSec != null ? focusBest - pole.bestSec : null);
  const deltaClass =
    m?.deltaClassPole ??
    (focusBest != null && classPole?.bestSec != null
      ? focusBest - classPole.bestSec
      : null);

  const tone = (d) =>
    d == null ? "" : d <= 0.0005 ? "pos" : d < 0.3 ? "near" : "neg";

  if (els.huntPole) {
    els.huntPole.textContent = formatDelta(deltaPole);
    els.huntPole.className = `mono ${tone(deltaPole)}`;
  }
  if (els.huntPoleWho) {
    els.huntPoleWho.textContent = pole
      ? `#${pole.STNR} ${pole.NAME || ""} · ${pole.FASTESTLAP || ""}`
      : "nincs pole";
  }
  if (els.huntClass) {
    els.huntClass.textContent = formatDelta(deltaClass);
    els.huntClass.className = `mono ${tone(deltaClass)}`;
  }
  if (els.huntClassWho) {
    els.huntClassWho.textContent = classPole
      ? `#${classPole.STNR} ${classPole.NAME || ""} · ${classPole.FASTESTLAP || ""}`
      : "—";
  }
  if (els.huntRank) {
    els.huntRank.textContent =
      bestRank >= 0 ? `P${bestRank + 1}` : "—";
  }
  if (els.huntClassRank) {
    els.huntClassRank.textContent =
      classRank >= 0
        ? `kat. P${classRank + 1}/${classMates.length || "—"}`
        : "—";
  }

  if (!els.huntLadder) return;
  if (!byBest.length || focusBest == null) {
    els.huntLadder.innerHTML = `<div class="hunt-empty">Várakozás best körökre…</div>`;
    return;
  }

  const idx = Math.max(0, bestRank);
  const start = Math.max(0, idx - 2);
  const slice = byBest.slice(start, start + 5);
  const maxDelta = Math.max(
    0.25,
    ...slice.map((r) => Math.abs(r.bestSec - (pole?.bestSec ?? focusBest))),
  );

  els.huntLadder.innerHTML = slice
    .map((r, i) => {
      const rank = start + i + 1;
      const isFocus = String(r.STNR) === String(focusNo);
      const delta = r.bestSec - (pole?.bestSec ?? r.bestSec);
      const width = Math.max(6, (Math.abs(delta) / maxDelta) * 100);
      return `<div class="hunt-row ${isFocus ? "is-focus" : ""}">
        <span class="hunt-pos mono">P${rank}</span>
        <span class="hunt-car mono">#${escapeHtml(r.STNR)}</span>
        <span class="hunt-name">${escapeHtml(r.NAME || "")}</span>
        <span class="hunt-time mono">${escapeHtml(r.FASTESTLAP || "—")}</span>
        <span class="hunt-delta mono ${delta <= 0.0005 ? "pos" : "neg"}">${escapeHtml(formatDelta(delta))}</span>
        <span class="hunt-bar-track"><span class="hunt-bar ${isFocus ? "focus" : ""}" style="width:${width.toFixed(1)}%"></span></span>
      </div>`;
    })
    .join("");
}

function renderTicker(s, m) {
  const msgs = (m?.messages?.length ? m.messages : s.messages || []).slice(0, 12);
  if (!msgs.length) {
    els.rcTicker.innerHTML = `<span class="ticker-item">Nincs race control üzenet</span>`;
    els.rcTicker.style.animationDuration = "20s";
    return;
  }

  const items = msgs
    .map(
      (msg) =>
        `<span class="ticker-item"><span class="t-time">${escapeHtml(msg.time || "")}</span>${escapeHtml(msg.message || "")}</span>`,
    )
    .join("");

  // Duplicate for seamless loop
  els.rcTicker.innerHTML = items + items;
  const dur = Math.max(28, msgs.length * 6);
  els.rcTicker.style.animationDuration = `${dur}s`;
}

function setWallMode(mode) {
  const race = isRaceMode(mode);
  wallMode = race ? "race" : mode || "session";
  document.body.classList.toggle("is-race", race);
  document.body.classList.toggle("is-qualy", !race);
  if (els.panelQualy) els.panelQualy.hidden = race;
  if (els.panelRace) els.panelRace.hidden = !race;
  if (els.fieldKicker) {
    els.fieldKicker.textContent = race
      ? "Sorrend · utolsó kör szektorok"
      : "Sorrend · best kör szektorok";
  }
  if (els.thS1) els.thS1.textContent = race ? "S1" : "BS1";
  if (els.thS2) els.thS2.textContent = race ? "S2" : "BS2";
  if (els.thS3) els.thS3.textContent = race ? "S3" : "BS3";
}

function renderRace(s, m) {
  const focus = s?.focus;
  const battle = m?.battle || s?.analysis?.battle;
  const ahead = battle?.ahead;
  const behind = battle?.behind;
  const focusLast = parseTime(focus?.LASTLAPTIME);
  const aheadLast = parseTime(ahead?.last);
  const behindLast = parseTime(behind?.last);

  const vsAhead =
    focusLast != null && aheadLast != null ? focusLast - aheadLast : null;
  const vsBehind =
    focusLast != null && behindLast != null ? focusLast - behindLast : null;

  const tone = (d) => {
    if (d == null) return "";
    if (Math.abs(d) < 0.001) return "pos";
    return d < 0 ? "pos" : d < 0.25 ? "near" : "neg";
  };

  if (els.raceVsAhead) {
    els.raceVsAhead.textContent = ahead ? formatDelta(vsAhead) : "P1";
    els.raceVsAhead.className = `mono ${ahead ? tone(vsAhead) : "pos"}`;
  }
  if (els.raceAheadKicker) {
    els.raceAheadKicker.textContent = ahead ? "Last vs elöl" : "Elöl";
  }
  if (els.raceAheadLap) {
    els.raceAheadLap.textContent = ahead
      ? `#${ahead.stnr} last ${ahead.last || "—"}`
      : "vezet — nincs előtte";
  }
  if (els.raceAheadCard) {
    els.raceAheadCard.classList.toggle("is-empty", !ahead);
  }
  if (els.raceLast) els.raceLast.textContent = focus?.LASTLAPTIME || "—";
  if (els.raceLastMeta) {
    els.raceLastMeta.textContent = m?.lastVsBest
      ? `vs PB ${m.lastVsBest}`
      : focus?.FASTESTLAP
        ? `PB ${focus.FASTESTLAP}`
        : "—";
  }
  if (els.raceVsBehind) {
    els.raceVsBehind.textContent = behind ? formatDelta(vsBehind) : "—";
    els.raceVsBehind.className = `mono ${behind ? tone(vsBehind) : ""}`;
  }
  if (els.raceBehindKicker) {
    els.raceBehindKicker.textContent = behind ? "Last vs hátul" : "Hátul";
  }
  if (els.raceBehindLap) {
    els.raceBehindLap.textContent = behind
      ? `#${behind.stnr} last ${behind.last || "—"}`
      : "senki hátul";
  }
  if (els.raceBehindCard) {
    els.raceBehindCard.classList.toggle("is-empty", !behind);
  }
  if (els.racePits) els.racePits.textContent = focus?.PITSTOPCOUNT ?? "—";
  if (els.raceLaps) els.raceLaps.textContent = focus?.LAPS ?? "—";
  if (els.raceChg) {
    const chg = focus?.CHG;
    els.raceChg.textContent =
      chg == null || chg === "" ? "—" : String(chg);
    els.raceChg.className = `mono ${
      Number(chg) > 0 ? "pos" : Number(chg) < 0 ? "neg" : ""
    }`;
  }

  if (!els.racePack) return;
  const results = [...(s?.results || [])].sort(
    (a, b) => Number(a.POSITION) - Number(b.POSITION),
  );
  const focusNo = focus?.STNR;
  const idx = results.findIndex((r) => String(r.STNR) === String(focusNo));
  if (idx < 0 || !results.length) {
    els.racePack.innerHTML = `<div class="hunt-empty">Várakozás a mezőnyre…</div>`;
    return;
  }

  const start = Math.max(0, idx - 2);
  const slice = results.slice(start, start + 5);
  const ints = slice
    .map((r) => parseGapSeconds(r.INT))
    .filter((v) => v != null && v > 0);
  const maxInt = Math.max(0.5, ...(ints.length ? ints : [1]));

  els.racePack.innerHTML = slice
    .map((r) => {
      const isFocus = String(r.STNR) === String(focusNo);
      const intSec = parseGapSeconds(r.INT);
      const width =
        intSec == null
          ? 0
          : Math.max(4, Math.min(100, (intSec / maxInt) * 100));
      return `<div class="hunt-row ${isFocus ? "is-focus" : ""}">
        <span class="hunt-pos mono">P${escapeHtml(r.POSITION)}</span>
        <span class="hunt-car mono">#${escapeHtml(r.STNR)}</span>
        <span class="hunt-name">${escapeHtml(r.NAME || "")}</span>
        <span class="hunt-time mono">${escapeHtml(r.LASTLAPTIME || "—")}</span>
        <span class="hunt-delta mono">${escapeHtml(isFocus ? "KISS" : r.INT || "—")}</span>
        <span class="hunt-bar-track"><span class="hunt-bar ${isFocus ? "focus" : ""}" style="width:${width.toFixed(1)}%"></span></span>
      </div>`;
    })
    .join("");
}

function renderField(s) {
  if (!els.fieldRows) return;
  const results = Array.isArray(s?.results) ? s.results : [];
  const focusNo = s?.focus?.STNR;
  const bestTimes = {};
  for (const sec of s?.bestSectors || s?.analysis?.sectors || []) {
    const n = sec.sector;
    const t = sec.time || sec.bestTime;
    if (n && t) bestTimes[n] = String(t);
  }

  if (els.fieldCount) {
    els.fieldCount.textContent = results.length
      ? `${results.length} autó`
      : "nincs adat";
  }

  if (!results.length) {
    els.fieldRows.innerHTML = `<tr><td colspan="12" class="field-empty">Várakozás a sorrendre…</td></tr>`;
    return;
  }

  els.fieldRows.innerHTML = results
    .map((r) => {
      const focus = String(r.STNR) === String(focusNo);
      const s1 = wallMode === "race" ? r.S1TIME || null : r.BESTS1 || null;
      const s2 = wallMode === "race" ? r.S2TIME || null : r.BESTS2 || null;
      const s3 = wallMode === "race" ? r.S3TIME || null : r.BESTS3 || null;
      const secClass = (n, time) => {
        if (wallMode === "race") return "";
        if (!time || !bestTimes[n]) return "";
        return String(time) === bestTimes[n] ? "sec-purple" : "";
      };
      return `<tr class="${focus ? "is-focus" : ""}" data-stnr="${escapeHtml(r.STNR)}">
        <td class="num">${escapeHtml(r.POSITION)}</td>
        <td class="mono">${escapeHtml(r.STNR)}</td>
        <td class="name">${escapeHtml(r.NAME || "")}</td>
        <td class="col-desk">${escapeHtml(r.CLASSNAME || "")}</td>
        <td class="mono">${escapeHtml(r.GAP || "—")}</td>
        <td class="mono">${escapeHtml(r.INT || "—")}</td>
        <td class="mono">${escapeHtml(r.LASTLAPTIME || "—")}</td>
        <td class="mono col-desk">${escapeHtml(r.FASTESTLAP || "—")}</td>
        <td class="mono col-sec ${secClass(1, s1)}">${escapeHtml(s1 || "—")}</td>
        <td class="mono col-sec ${secClass(2, s2)}">${escapeHtml(s2 || "—")}</td>
        <td class="mono col-sec ${secClass(3, s3)}">${escapeHtml(s3 || "—")}</td>
        <td class="mono col-desk">${escapeHtml(r.LAPS || "—")}</td>
      </tr>`;
    })
    .join("");
}

function isSessionAlreadyRecorded(standings, session) {
  const sid = String(session?.session || "").trim();
  if (!sid) return false;
  return (standings?.races || []).some((r) => {
    if (String(r.sessionId || "") === sid) return true;
    if (String(r.id || "").startsWith(`${sid}-`)) return true;
    return false;
  });
}

function thisRaceMaxFromScale(scale) {
  if (!scale?.length) return 20;
  return Math.max(...scale);
}

function renderPointsClinch(
  standings,
  {
    race = false,
    liveOverlay = false,
    projectedFocus = null,
    projectedTeam = null,
    thisRaceMax = 20,
  } = {},
) {
  const clinch = standings?.clinch;
  const parts = [];
  const remainingAfter = Math.max(0, (clinch?.driver?.remainingMax ?? 0) - thisRaceMax);

  if (clinch?.driver) {
    if (clinch.driver.clinched) {
      parts.push("Norbi: bajnok");
    } else if (liveOverlay && projectedFocus != null) {
      // "ha így": season+live, remaining AFTER this race (don't double-count this race's pot)
      const threatLive =
        (clinch.driver.threatRival?.points ?? clinch.driver.threat - clinch.driver.remainingMax) +
        remainingAfter;
      const liveNeed = Math.max(0, threatLive - projectedFocus + 1);
      parts.push(
        liveNeed !== clinch.driver.need
          ? `Norbi: még ${clinch.driver.need} → ha így ${liveNeed}`
          : `Norbi: még ${clinch.driver.need} pont a címhez`,
      );
    } else {
      parts.push(`Norbi: még ${clinch.driver.need} pont a címhez`);
    }
  }
  if (clinch?.team) {
    const teamRaceMax = thisRaceMax >= 20 ? 35 : 19;
    const teamRemainingAfter = Math.max(
      0,
      (clinch.team.remainingMax ?? 0) - teamRaceMax,
    );
    if (clinch.team.clinched) {
      parts.push("Csapat: csapatbajnok");
    } else if (liveOverlay && projectedTeam != null) {
      const threatLive =
        (clinch.team.threatRival?.points ?? clinch.team.threat - clinch.team.remainingMax) +
        teamRemainingAfter;
      const liveNeed = Math.max(0, threatLive - projectedTeam + 1);
      parts.push(
        liveNeed !== clinch.team.need
          ? `Csapat: még ${clinch.team.need} → ha így ${liveNeed}`
          : `Csapat: még ${clinch.team.need} pont a csapatbajnokihoz`,
      );
    } else {
      parts.push(`Csapat: még ${clinch.team.need} pont a csapatbajnokihoz`);
    }
  }

  const line = parts.join(" · ");
  const has = Boolean(line);

  if (els.pointsClinch) {
    els.pointsClinch.hidden = !has;
    els.pointsClinch.textContent = line;
    els.pointsClinch.classList.toggle(
      "is-clinched",
      Boolean(clinch?.driver?.clinched && clinch?.team?.clinched),
    );
  }

  if (els.clinchBar && els.clinchText) {
    els.clinchBar.hidden = !has;
    els.clinchText.textContent = line || "—";
    els.clinchBar.classList.toggle(
      "is-clinched",
      Boolean(clinch?.driver?.clinched && clinch?.team?.clinched),
    );
  }
}

function setPointsView(view) {
  pointsView = view === "teams" ? "teams" : "drivers";
  els.pointsBtnDrivers?.classList.toggle("is-active", pointsView === "drivers");
  els.pointsBtnTeams?.classList.toggle("is-active", pointsView === "teams");
  if (els.pointsTitle) {
    els.pointsTitle.textContent =
      pointsView === "teams" ? "Csapatbajnokság" : "Pilóták";
  }
  if (els.pointsKicker) {
    const live = isRaceMode(wallMode);
    els.pointsKicker.textContent = live
      ? "Futam · szezon + élő pont"
      : pointsView === "teams"
        ? "Szezon · csapatok"
        : "Szezon · pilóták";
  }
  if (lastSnapshot) renderPoints(lastSnapshot);
}

function renderPoints(s) {
  if (!els.pointsRows || !els.pointsHead) return;
  const race = isRaceMode(s?.analysis?.mode || wallMode);
  const alreadyIn = isSessionAlreadyRecorded(seasonStandings, s?.session);
  // After auto-record, session can still be "race" — don't double-add +Élő / "ha így"
  const liveOverlay = race && !alreadyIn;
  const { scale, label } = resolvePointsScale(s?.session);
  const focusNo = String(s?.focus?.STNR ?? "");
  const thisRaceMax = thisRaceMaxFromScale(scale);

  if (els.pointsScale) {
    els.pointsScale.textContent = liveOverlay ? label : alreadyIn && race ? "rögzítve" : "—";
  }
  if (els.pointsKicker) {
    els.pointsKicker.textContent = liveOverlay
      ? "Futam · szezon + élő pont"
      : pointsView === "teams"
        ? "Szezon · csapatok"
        : "Szezon · pilóták";
  }

  if (!seasonStandings) {
    els.pointsHead.innerHTML = `<tr><th>—</th></tr>`;
    els.pointsRows.innerHTML = `<tr><td class="field-empty">Szezonállás betöltése…</td></tr>`;
    renderPointsClinch(null);
    return;
  }

  if (pointsView === "teams") {
    const rows = buildSeasonTeamRows(seasonStandings, s?.results || [], {
      includeLive: liveOverlay,
      scale,
    });
    els.pointsHead.innerHTML = liveOverlay
      ? `<tr><th>P</th><th>Csapat</th><th>Pilóták</th><th>Szezon</th><th>+Élő</th><th>Összesen</th></tr>`
      : `<tr><th>P</th><th>Csapat</th><th>Szezon</th></tr>`;

    const focusTeam = rows.find((t) => t.id === "revesz-reinert") ||
      rows.find((t) => t.drivers.some((d) => String(d.stnr) === focusNo));
    renderPointsClinch(seasonStandings, {
      race,
      liveOverlay,
      projectedFocus: null,
      projectedTeam: focusTeam?.projected ?? null,
      thisRaceMax,
    });

    if (!rows.length) {
      els.pointsRows.innerHTML = `<tr><td colspan="${liveOverlay ? 6 : 3}" class="field-empty">Nincs csapatadat</td></tr>`;
      return;
    }

    els.pointsRows.innerHTML = rows
      .map((t) => {
        const isFocus = t.drivers.some((d) => String(d.stnr) === focusNo) ||
          t.id === "revesz-reinert";
        if (!liveOverlay) {
          return `<tr class="${isFocus ? "is-focus" : ""}">
            <td class="num">${escapeHtml(t.position)}</td>
            <td class="name">${escapeHtml(t.short || t.name)}</td>
            <td class="mono pts-val scored">${escapeHtml(t.seasonPoints)}</td>
          </tr>`;
        }
        const members = t.drivers.length
          ? t.drivers
              .map(
                (d) =>
                  `#${escapeHtml(d.stnr)} ${escapeHtml(d.name)} <span class="pts-inline mono">P${escapeHtml(d.racePos ?? "—")} · +${escapeHtml(d.livePoints || 0)}</span>`,
              )
              .join("<br/>")
          : "—";
        const add = t.livePoints > 0 ? `+${escapeHtml(t.livePoints)}` : "—";
        return `<tr class="${isFocus ? "is-focus" : ""}">
          <td class="num">${escapeHtml(t.position)}</td>
          <td class="name">${escapeHtml(t.short || t.name)}</td>
          <td class="pts-members">${members}</td>
          <td class="mono">${escapeHtml(t.seasonPoints)}</td>
          <td class="mono pts-val ${t.livePoints > 0 ? "scored" : ""}">${add}</td>
          <td class="mono pts-val scored">${escapeHtml(t.projected)}</td>
        </tr>`;
      })
      .join("");
    return;
  }

  const rows = buildSeasonDriverRows(seasonStandings, s?.results || [], {
    includeLive: liveOverlay,
    scale,
  });
  els.pointsHead.innerHTML = liveOverlay
    ? `<tr><th>P</th><th>#</th><th>Versenyző</th><th>Hely</th><th>Szezon</th><th>+Élő</th><th>Összesen</th></tr>`
    : `<tr><th>P</th><th>#</th><th>Versenyző</th><th>Szezon</th></tr>`;

  const focusRow = rows.find((r) => String(r.stnr) === focusNo) ||
    rows.find((r) => String(r.stnr) === "1");
  const teamRows = liveOverlay
    ? buildSeasonTeamRows(seasonStandings, s?.results || [], { includeLive: true, scale })
    : [];
  const focusTeam = teamRows.find((t) => t.id === "revesz-reinert");
  renderPointsClinch(seasonStandings, {
    race,
    liveOverlay,
    projectedFocus: focusRow?.projected ?? null,
    projectedTeam: focusTeam?.projected ?? null,
    thisRaceMax,
  });

  if (!rows.length) {
    els.pointsRows.innerHTML = `<tr><td colspan="${liveOverlay ? 7 : 4}" class="field-empty">Nincs szezonadat</td></tr>`;
    return;
  }

  els.pointsRows.innerHTML = rows
    .map((r) => {
      const focus = String(r.stnr) === focusNo || String(r.stnr) === "1";
      if (!liveOverlay) {
        return `<tr class="${focus ? "is-focus" : ""}">
          <td class="num">${escapeHtml(r.position)}</td>
          <td class="mono">${escapeHtml(r.stnr || "—")}</td>
          <td class="name">${escapeHtml(r.name)}</td>
          <td class="mono pts-val scored">${escapeHtml(r.seasonPoints)}</td>
        </tr>`;
      }
      const add = r.livePoints > 0 ? `+${escapeHtml(r.livePoints)}` : "—";
      return `<tr class="${focus ? "is-focus" : ""}">
        <td class="num">${escapeHtml(r.position)}</td>
        <td class="mono">${escapeHtml(r.stnr || "—")}</td>
        <td class="name">${escapeHtml(r.name)}</td>
        <td class="mono">${r.racePos != null ? `P${escapeHtml(r.racePos)}` : "—"}</td>
        <td class="mono">${escapeHtml(r.seasonPoints)}</td>
        <td class="mono pts-val ${r.livePoints > 0 ? "scored" : ""}">${add}</td>
        <td class="mono pts-val scored">${escapeHtml(r.projected)}</td>
      </tr>`;
    })
    .join("");
}

function apply(s) {
  lastSnapshot = s;
  lastUpdateAt = s.lastUpdate ?? lastUpdateAt;
  updateCount = s.updateCount ?? updateCount;

  if (s.standings) {
    const n = s.standings.races?.length ?? 0;
    if (n !== lastStandingsRaceCount || !seasonStandings) {
      seasonStandings = s.standings;
      lastStandingsRaceCount = n;
    } else if (s.standings.clinch) {
      seasonStandings = { ...seasonStandings, ...s.standings };
    }
  }

  const live = s.connected && s.focus;
  els.liveDot.classList.toggle("live", Boolean(live));
  els.liveDot.classList.toggle("offline", !s.connected);
  els.statusText.textContent = !s.connected
    ? "Újracsatlakozás"
    : s.error || (s.focus ? "ÉLŐ" : "Várakozás");
  refreshFeedAge();

  if (s.session) {
    els.sessionLine.textContent = [s.session.cup, s.session.trackName]
      .filter(Boolean)
      .join(" · ");
    els.heatTitle.textContent = `Kiss #1 — ${s.session.heat || "szekció"}`;
  }

  const m = engineerMetrics(s);
  // Prefer relevant messages for ticker; fall back to all
  if (m && s.analysis?.relevantMessages) {
    m.messages = s.analysis.relevantMessages;
  }

  // Prefer lap history for sector LAST/BEST when liveLaps empty
  if (m && (!m.laps || !m.laps.length)) {
    const hist = historiesList(s);
    const current = hist.at(-1);
    if (current?.laps?.length) m.laps = current.laps;
  }

  const mode = s.analysis?.mode || m?.mode || "session";
  setWallMode(mode);

  renderHero(s, m);
  renderSectors(m);
  if (isRaceMode(mode)) renderRace(s, m);
  else renderHunt(s, m);
  renderField(s);
  renderPoints(s);
  renderTicker(s, m);
  track.syncField(s);

  if (s.field?.active) {
    els.animMeta.textContent = `pályán · ${s.field.driverCount} autó`;
  }

  if (s.lastUpdate) {
    els.clock.textContent = new Date(s.lastUpdate).toLocaleTimeString("hu-HU");
  }
}

connectLive((raw) => apply(demoRaceSnapshot(raw)));
setInterval(refreshFeedAge, 1000);

els.pointsBtnDrivers?.addEventListener("click", () => setPointsView("drivers"));
els.pointsBtnTeams?.addEventListener("click", () => setPointsView("teams"));
setPointsView("drivers");

/** Local/demo: `/?demo=race` forces futam UI even in quali. */
function demoRaceSnapshot(s) {
  if (new URLSearchParams(location.search).get("demo") !== "race") return s;
  if (!s) return s;

  const results = (s.results || []).map((r) => ({ ...r }));
  const focusIdx = Math.max(
    0,
    results.findIndex((r) => String(r.STNR) === "1" || /KISS/i.test(r.NAME || "")),
  );
  const focus = results[focusIdx] ? { ...results[focusIdx] } : { ...s.focus };
  if (focus) {
    // Demo: put Kiss mid-pack so ahead+behind both show (real race uses true pos)
    const demoPos = 3;
    focus.POSITION = demoPos;
    focus.STNR = focus.STNR || "1";
    focus.NAME = focus.NAME || "KISS";
    focus.GAP = "+1.842";
    focus.INT = "+0.387";
    focus.LASTLAPTIME = focus.LASTLAPTIME || "1:02.418";
    focus.FASTESTLAP =
      focus.FASTESTLAP && !String(focus.FASTESTLAP).startsWith("2:")
        ? focus.FASTESTLAP
        : "1:02.105";
    focus.S1TIME = focus.S1TIME || "22.140";
    focus.S2TIME = focus.S2TIME || "24.880";
    focus.S3TIME = focus.S3TIME || "15.398";
    focus.LAPS = focus.LAPS || "8";
    focus.PITSTOPCOUNT = focus.PITSTOPCOUNT ?? "0";
    focus.CHG = focus.CHG ?? 1;

    // Reorder list so POSITION matches: P2 ahead, Kiss P3, P4 behind
    const others = results.filter((r) => String(r.STNR) !== String(focus.STNR));
    others.sort((a, b) => Number(a.POSITION) - Number(b.POSITION));
    const rebuilt = [];
    for (let i = 0; i < others.length; i++) {
      if (rebuilt.length === demoPos - 1) rebuilt.push(focus);
      rebuilt.push({ ...others[i], POSITION: rebuilt.length + 1 });
    }
    if (!rebuilt.some((r) => String(r.STNR) === String(focus.STNR))) {
      rebuilt.splice(demoPos - 1, 0, focus);
    }
    rebuilt.forEach((r, i) => {
      r.POSITION = i + 1;
    });
    focus.POSITION = demoPos;
    results.length = 0;
    results.push(...rebuilt);
  }

  const ahead = results.find((r) => Number(r.POSITION) === Number(focus.POSITION) - 1) || null;
  const behind = results.find((r) => Number(r.POSITION) === Number(focus.POSITION) + 1) || null;

  return {
    ...s,
    connected: true,
    results,
    focus,
    session: {
      ...(s.session || {}),
      heat: "Race 3",
      heatNumber: 3,
      heatType: "R",
    },
    analysis: {
      ...(s.analysis || {}),
      mode: "race",
      modeLabel: "FUTAM · DEMO",
      battle: {
        ahead: ahead
          ? {
              stnr: ahead.STNR,
              name: ahead.NAME,
              gap: focus.INT || ahead.INT,
              last: ahead.LASTLAPTIME || "1:02.310",
            }
          : null,
        behind: behind
          ? {
              stnr: behind.STNR,
              name: behind.NAME,
              gap: behind.INT || "+0.512",
              last: behind.LASTLAPTIME || "1:02.590",
            }
          : null,
        pack: results.slice(
          Math.max(0, Number(focus.POSITION) - 2),
          Number(focus.POSITION) + 2,
        ),
      },
    },
  };
}

/* ——— Phone app shell: dock, wake lock, track toggle ——— */
const dock = $("pulseDock");
const wakeBtn = $("wakeBtn");
const trackPanel = $("secTrack");
const trackToggle = $("trackToggle");
const jumpFocusBtn = $("jumpFocusBtn");

let wakeLock = null;

function jumpTo(id) {
  const el = $(id);
  if (!el) return;
  const top = el.getBoundingClientRect().top + window.scrollY - 64;
  window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  dock?.querySelectorAll(".dock-btn[data-jump]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.jump === id);
  });
  if (navigator.vibrate) navigator.vibrate(8);
}

dock?.addEventListener("click", (e) => {
  const btn = e.target.closest(".dock-btn[data-jump]");
  if (!btn) return;
  jumpTo(btn.dataset.jump);
});

async function setWake(on) {
  if (!("wakeLock" in navigator)) {
    wakeBtn?.classList.add("is-unavailable");
    if (wakeBtn) wakeBtn.title = "Nem támogatott ezen a telón";
    return;
  }
  try {
    if (on) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => {
        wakeBtn?.classList.remove("is-on");
        wakeBtn?.setAttribute("aria-pressed", "false");
      });
      wakeBtn?.classList.add("is-on");
      wakeBtn?.setAttribute("aria-pressed", "true");
    } else {
      await wakeLock?.release();
      wakeLock = null;
      wakeBtn?.classList.remove("is-on");
      wakeBtn?.setAttribute("aria-pressed", "false");
    }
  } catch (err) {
    console.warn("[wake]", err);
  }
}

wakeBtn?.addEventListener("click", () => {
  const on = !wakeBtn.classList.contains("is-on");
  setWake(on);
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && wakeBtn?.classList.contains("is-on")) {
    setWake(true);
  }
});

function syncTrackCollapsed() {
  const collapsed = trackPanel?.classList.contains("is-collapsed");
  if (trackToggle) {
    trackToggle.textContent = collapsed ? "Mutat" : "Elrejt";
    trackToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
  }
}

trackToggle?.addEventListener("click", () => {
  trackPanel?.classList.toggle("is-collapsed");
  syncTrackCollapsed();
});

// Desktop: show track; phone: stay collapsed until toggled
if (window.matchMedia("(min-width: 981px)").matches) {
  trackPanel?.classList.remove("is-collapsed");
}
syncTrackCollapsed();

jumpFocusBtn?.addEventListener("click", () => {
  jumpTo("secField");
  requestAnimationFrame(() => {
    const row =
      els.fieldRows?.querySelector("tr.is-focus") ||
      els.fieldRows?.querySelector('tr[data-stnr="1"]');
    row?.scrollIntoView({ block: "center", behavior: "smooth" });
  });
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch((err) => {
    console.warn("[sw]", err);
  });
}

// Active dock section on scroll
const sectionIds = ["secLive", "secSectors", "secField", "secPoints"];
const sectionEls = sectionIds.map((id) => $(id)).filter(Boolean);
if (sectionEls.length && "IntersectionObserver" in window) {
  const io = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible?.target?.id) return;
      dock?.querySelectorAll(".dock-btn[data-jump]").forEach((btn) => {
        btn.classList.toggle("is-active", btn.dataset.jump === visible.target.id);
      });
    },
    { rootMargin: "-20% 0px -55% 0px", threshold: [0.15, 0.4, 0.7] },
  );
  sectionEls.forEach((el) => io.observe(el));
}

document.documentElement.classList.add("has-dock");
if (window.matchMedia("(display-mode: standalone)").matches || navigator.standalone) {
  document.body.classList.add("is-standalone");
}
