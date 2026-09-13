import {
  $,
  escapeHtml,
  connectLive,
  createTrackAnimator,
} from "./shared.js";

const els = {
  pulse: $("pulse"),
  statusText: $("statusText"),
  feedMeta: $("feedMeta"),
  sessionLine: $("sessionLine"),
  tagline: $("tagline"),
  modeChip: $("modeChip"),
  posLabel: $("posLabel"),
  position: $("position"),
  classRank: $("classRank"),
  gapLabel: $("gapLabel"),
  gap: $("gap"),
  interval: $("interval"),
  lastLap: $("lastLap"),
  fastest: $("fastest"),
  trackLine: $("trackLine"),
  rows: $("rows"),
  clock: $("clock"),
};

let prevPos = null;
let lastUpdateAt = null;
let updateCount = 0;
let snapshot = null;

const track = createTrackAnimator({
  objectEl: $("trackObject"),
  metaEl: $("animMeta"),
  sectorEl: $("animSector"),
  lapEl: $("animLap"),
  sourceEl: $("animSource"),
  toggleEl: $("animToggle"),
  titleEl: $("trackTitle"),
});

function refreshFeedAge() {
  if (!els.feedMeta || lastUpdateAt == null) return;
  const age = Math.max(0, Math.round((Date.now() - lastUpdateAt) / 1000));
  els.feedMeta.textContent = `WS élő · #${updateCount} · ${age} mp ideje`;
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
    els.sessionLine.textContent = [s.session.cup, s.session.heat]
      .filter(Boolean)
      .join(" · ");
    els.trackLine.textContent = [s.session.trackName, s.session.heat]
      .filter(Boolean)
      .join(" · ");
  }
  if (s.analysis?.modeLabel) {
    els.modeChip.textContent = s.analysis.modeLabel.toUpperCase();
    els.posLabel.textContent =
      s.analysis.mode === "qualifying" ? "Ideiglenes" : "Helyezés";
    els.gapLabel.textContent =
      s.analysis.mode === "qualifying" ? "Hátrány pole" : "Hátrány";
  }

  const f = s.focus;
  if (!f) {
    els.position.textContent = "—";
    els.classRank.textContent = "Nincs a sorrendben";
    els.gap.textContent = "—";
    els.interval.textContent = "—";
    els.lastLap.textContent = "—";
    els.fastest.textContent = "—";
    return;
  }

  if (prevPos != null && prevPos !== String(f.POSITION)) {
    els.position.classList.remove("bump");
    void els.position.offsetWidth;
    els.position.classList.add("bump");
  }
  prevPos = String(f.POSITION);
  els.position.textContent = f.POSITION;
  els.classRank.textContent = `#${f.STNR} · ${f.CLASSNAME} · kat. P${f.CLASSRANK}`;
  els.gap.textContent = f.GAP || "—";
  els.interval.textContent = f.INT || "—";
  els.lastLap.textContent = f.LASTLAPTIME || "—";
  els.fastest.textContent = f.FASTESTLAP || "—";
  els.tagline.textContent = [f.TEAM, f.CAR, f.CLASSNAME].filter(Boolean).join(" · ");

  els.rows.innerHTML = s.results
    .map((r) => {
      const focus = String(r.STNR) === String(f.STNR);
      return `<tr class="${focus ? "focus" : ""}">
        <td class="num">${escapeHtml(r.POSITION)}</td>
        <td class="mono">${escapeHtml(r.STNR)}</td>
        <td>${escapeHtml(r.NAME)}</td>
        <td>${escapeHtml(r.CLASSNAME || "")}</td>
        <td class="mono">${escapeHtml(r.GAP || "")}</td>
        <td class="mono">${escapeHtml(r.LASTLAPTIME || "")}</td>
        <td class="mono">${escapeHtml(r.FASTESTLAP || "")}</td>
      </tr>`;
    })
    .join("");

  track.syncField(s);

  if (s.lastUpdate) {
    els.clock.textContent = new Date(s.lastUpdate).toLocaleTimeString("hu-HU");
  }
}

connectLive(apply);
setInterval(refreshFeedAge, 1000);
