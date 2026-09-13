import {
  $,
  escapeHtml,
  formatDelta,
  connectLive,
  historiesList,
  engineerMetrics,
  createTrackAnimator,
} from "./shared.js";

const els = {
  pulse: $("pulse"),
  statusText: $("statusText"),
  feedMeta: $("feedMeta"),
  sessionLine: $("sessionLine"),
  heatTitle: $("heatTitle"),
  modeChip: $("modeChip"),
  engPrimary: $("engPrimary"),
  sectorGrid: $("sectorGrid"),
  theoLine: $("theoLine"),
  battle: $("battle"),
  paceBox: $("paceBox"),
  sessionTabs: $("sessionTabs"),
  historyRows: $("historyRows"),
  messages: $("messages"),
  rows: $("rows"),
  trackLine: $("trackLine"),
  clock: $("clock"),
};

let snapshot = null;
let selectedHistoryId = null;
let lastUpdateAt = null;
let updateCount = 0;

const track = createTrackAnimator({
  objectEl: $("trackObject"),
  metaEl: $("animMeta"),
  sectorEl: $("animSector"),
  lapEl: $("animLap"),
  sourceEl: $("animSource"),
  toggleEl: $("animToggle"),
});

function refreshFeedAge() {
  if (!els.feedMeta || lastUpdateAt == null) return;
  const age = Math.max(0, Math.round((Date.now() - lastUpdateAt) / 1000));
  els.feedMeta.textContent = `WS élő · #${updateCount} · ${age} mp ideje`;
}

function card(label, value, sub = "") {
  return `<div class="eng-card">
    <div class="stat-label">${escapeHtml(label)}</div>
    <div class="stat-value mono">${value}</div>
    ${sub ? `<div class="stat-sub mono">${sub}</div>` : ""}
  </div>`;
}

function line(label, value, meta = "") {
  return `<div class="row-line">
    <div class="k">${escapeHtml(label)}</div>
    <div class="v">${value}</div>
    <div class="m">${meta}</div>
  </div>`;
}

function renderPrimary(m) {
  if (!m) {
    els.engPrimary.innerHTML = `<div class="empty">Nincs élő Kiss adat</div>`;
    return;
  }
  els.engPrimary.innerHTML = [
    card("Helyezés", m.position, `kat. P${m.classRank || "—"}`),
    card("Hátrány / Int", `${m.gap || "—"}`, `int ${m.interval || "—"}`),
    card("Utolsó kör", m.last || "—", `vs PB ${m.lastVsBest || "—"}`),
    card("Personal best", m.best || "—", `abs P${m.bestRank || "—"}/${m.bestCount || "—"}`),
    card("Δ pole", m.deltaPole || "—", `kat. ${m.deltaClassPole || "—"}`),
    card(
      "Konzisztencia",
      m.consistency != null ? `σ ${m.consistency.toFixed(3)}` : "—",
      m.trend != null ? `trend ${formatDelta(m.trend)}` : "utolsó 5 kör",
    ),
    card(
      "Gördülő átl. (3)",
      m.rollingAvgFmt || "—",
      `vs PB ${formatDelta(m.rollingAvgVsBest)}`,
    ),
    card(
      "Saját elméleti",
      m.theoreticalOwnFmt || "—",
      `Δ PB ${formatDelta(m.theoreticalOwnDelta)}`,
    ),
    card(
      "Session elméleti",
      m.theoreticalSession || "—",
      `Δ ${m.theoreticalSessionDelta || "—"}`,
    ),
  ].join("");
}

function renderSectors(m) {
  if (!m?.sectors?.length) {
    els.sectorGrid.innerHTML = `<div class="empty">Nincs szektoradat</div>`;
    return;
  }
  els.theoLine.textContent = `Saját legjobb szektorok: ${m.bestSectorParts.s1 || "—"} · ${m.bestSectorParts.s2 || "—"} · ${m.bestSectorParts.s3 || "—"}`;
  els.sectorGrid.innerHTML = m.sectors
    .map((s) => {
      const cls =
        s.deltaSec == null ? "" : s.deltaSec <= 0 ? "green" : s.deltaSec < 0.3 ? "yellow" : "";
      const deltaCls = s.deltaSec == null ? "" : s.deltaSec <= 0 ? "pos" : "neg";
      return `<div class="sector-cell ${cls}">
        <div class="label">${s.sector}. szektor</div>
        <div class="time">${escapeHtml(s.time || "—")}</div>
        <div class="delta ${deltaCls}">session besthez ${escapeHtml(s.delta || "—")}</div>
        <div class="best">best #${escapeHtml(s.bestStnr || "—")} · ${escapeHtml(s.bestTime || "—")}</div>
      </div>`;
    })
    .join("");
}

function renderBattle(m) {
  const b = m?.battle;
  if (!b) {
    els.battle.innerHTML = `<div class="empty">—</div>`;
    return;
  }
  const bits = [];
  if (b.leader) {
    bits.push(
      line("Éllovas", `#${b.leader.stnr} ${b.leader.name}`, escapeHtml(b.leader.gap || "")),
    );
  }
  if (b.ahead) {
    bits.push(
      line("Elöl", `#${b.ahead.stnr} ${b.ahead.name}`, `int ${b.ahead.interval || "—"}`),
    );
  } else bits.push(line("Elöl", "Szabad", "P1"));
  if (b.behind) {
    bits.push(
      line("Hátul", `#${b.behind.stnr} ${b.behind.name}`, `int ${b.behind.interval || "—"}`),
    );
  }
  if (b.classLeader) {
    bits.push(
      line(
        "Kat. lead",
        `#${b.classLeader.stnr} ${b.classLeader.name}`,
        `Kiss P${b.classLeader.classRank || "—"}`,
      ),
    );
  }
  els.battle.innerHTML = bits.join("");
}

function renderPace(m) {
  if (!m) {
    els.paceBox.innerHTML = `<div class="empty">—</div>`;
    return;
  }
  els.paceBox.innerHTML = [
    line("Abszolút best rank", `${m.bestRank || "—"} / ${m.bestCount || "—"}`),
    line("Kategória best rank", `${m.classBestRank || "—"} / ${m.classBestCount || "—"}`),
    line("Δ pole", escapeHtml(m.deltaPole || "—")),
    line("Δ kat. pole", escapeHtml(m.deltaClassPole || "—")),
    line("Session theo", escapeHtml(m.theoreticalSession || "—"), escapeHtml(m.theoreticalSessionDelta || "")),
    line("Kör / box", `${m.lapCount || "—"} / ${m.pits || "0"}`),
  ].join("");
}

function renderHistory(s, m) {
  const list = historiesList(s);
  if (!list.length) {
    els.sessionTabs.innerHTML = "";
    els.historyRows.innerHTML = `<tr><td colspan="7" class="muted">Nincs körhistória</td></tr>`;
    return;
  }
  if (!selectedHistoryId || !list.some((h) => h.id === selectedHistoryId)) {
    selectedHistoryId = list[list.length - 1].id;
  }
  els.sessionTabs.innerHTML = list
    .map(
      (h) =>
        `<button type="button" class="session-tab ${h.id === selectedHistoryId ? "active" : ""}" data-id="${escapeHtml(h.id)}">${escapeHtml(h.label)} (${h.lapCount})</button>`,
    )
    .join("");

  const selected = list.find((h) => h.id === selectedHistoryId);
  const pb = selected?.bestLap?.timeSec;
  els.historyRows.innerHTML = (selected?.laps || [])
    .map((lap) => {
      const isBest = lap.timeSec != null && lap.timeSec === pb;
      const dPb = pb != null && lap.timeSec != null ? lap.timeSec - pb : null;
      return `<tr class="${isBest ? "best" : ""}">
        <td class="num">${escapeHtml(lap.lap)}</td>
        <td class="mono">${escapeHtml(lap.time)}</td>
        <td class="mono">${formatDelta(dPb)}</td>
        <td class="mono ${lap.s1 === m?.bestSectorParts?.s1 ? "best-sec" : ""}">${escapeHtml(lap.s1)}</td>
        <td class="mono ${lap.s2 === m?.bestSectorParts?.s2 ? "best-sec" : ""}">${escapeHtml(lap.s2)}</td>
        <td class="mono ${lap.s3 === m?.bestSectorParts?.s3 ? "best-sec" : ""}">${escapeHtml(lap.s3)}</td>
        <td><button type="button" class="play-lap" data-session="${escapeHtml(selected.id)}" data-lap="${escapeHtml(lap.lap)}">play</button></td>
      </tr>`;
    })
    .join("");
}

function renderMessages(m) {
  const msgs = m?.messages || [];
  if (!msgs.length) {
    els.messages.innerHTML = `<div class="empty">Nincs releváns üzenet</div>`;
    return;
  }
  els.messages.innerHTML = msgs
    .map((msg) => line(msg.time || "", escapeHtml(msg.message || "")))
    .join("");
}

function renderField(s) {
  const focusNo = s.focus?.STNR;
  els.rows.innerHTML = s.results
    .map((r) => {
      const focus = String(r.STNR) === String(focusNo);
      return `<tr class="${focus ? "focus" : ""}">
        <td class="num">${escapeHtml(r.POSITION)}</td>
        <td class="mono">${escapeHtml(r.STNR)}</td>
        <td>${escapeHtml(r.NAME)}</td>
        <td>${escapeHtml(r.CLASSNAME || "")}</td>
        <td class="mono">${escapeHtml(r.GAP || "")}</td>
        <td class="mono">${escapeHtml(r.INT || "")}</td>
        <td class="mono">${escapeHtml(r.LASTLAPTIME || "")}</td>
        <td class="mono">${escapeHtml(r.FASTESTLAP || "")}</td>
        <td class="mono">${escapeHtml(r.BESTS1 || "—")}</td>
        <td class="mono">${escapeHtml(r.BESTS2 || "—")}</td>
        <td class="mono">${escapeHtml(r.BESTS3 || "—")}</td>
        <td class="mono">${escapeHtml(r.LAPS || "")}</td>
      </tr>`;
    })
    .join("");
}

function apply(s) {
  snapshot = s;
  lastUpdateAt = s.lastUpdate ?? lastUpdateAt;
  updateCount = s.updateCount ?? updateCount;

  const live = s.connected && s.focus;
  els.pulse.classList.toggle("live", Boolean(live));
  els.pulse.classList.toggle("offline", !s.connected);
  els.statusText.textContent = !s.connected
    ? "Újracsatlakozás"
    : s.error || (s.focus ? "Élő" : "Várakozás");
  refreshFeedAge();

  if (s.session) {
    els.sessionLine.textContent = [s.session.trackName, s.session.heat]
      .filter(Boolean)
      .join(" · ");
    els.heatTitle.textContent = `Kiss #1 — ${s.session.heat || "szekció"}`;
    els.trackLine.textContent = [s.session.trackName, s.session.heatType]
      .filter(Boolean)
      .join(" · ");
  }
  if (s.analysis?.modeLabel) {
    els.modeChip.textContent = s.analysis.modeLabel.toUpperCase();
  }

  const m = engineerMetrics(s);
  renderPrimary(m);
  renderSectors(m);
  renderBattle(m);
  renderPace(m);
  renderHistory(s, m);
  renderMessages(m);
  renderField(s);
  track.syncField(s);

  if (s.lastUpdate) {
    els.clock.textContent = new Date(s.lastUpdate).toLocaleTimeString("hu-HU");
  }
}

els.sessionTabs?.addEventListener("click", (ev) => {
  const btn = ev.target.closest("[data-id]");
  if (!btn || !snapshot) return;
  selectedHistoryId = btn.dataset.id;
  apply(snapshot);
});

els.historyRows?.addEventListener("click", (ev) => {
  const btn = ev.target.closest(".play-lap");
  if (!btn || !snapshot) return;
  const hist = historiesList(snapshot).find((h) => h.id === btn.dataset.session);
  const lap = hist?.laps?.find((l) => String(l.lap) === String(btn.dataset.lap));
  if (lap) track.playLap(lap, hist.label, snapshot);
});

connectLive(apply);
setInterval(refreshFeedAge, 1000);
