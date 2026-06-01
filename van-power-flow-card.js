/**
 * van-power-flow-card
 * A compact, configurable power-flow card for Home Assistant DC systems.
 *
 * A central Battery, with optional surrounding nodes arranged like the Victron
 * VRM flow screen:
 *
 *     Grid        Inverter      AC Loads
 *     Solar       Battery       DC Loads
 *     Alternator
 *
 * Sources (grid/solar/alternator) feed in on the left; the inverter/charger sits
 * top-center (bidirectional with the battery); loads draw on the right. Every
 * node is optional except the battery, and the layout re-centers around whatever
 * is configured. Animated dots flow along active lines.
 *
 * Flow topology:
 *   grid       -> inverter        (AC in)
 *   solar      -> battery
 *   alternator -> battery
 *   battery   <-> inverter        (reverses: charging vs inverting)
 *   inverter   -> ac_loads        (AC out)
 *   battery    -> dc_loads        (DC out)
 *
 * Vanilla JS custom element — no build step. Config via YAML or the visual editor.
 */

const VERSION = "1.2.0";

// Inverter/charger states that mean "charging the battery" (AC -> DC), used to
// flip the battery<->inverter flow direction.
const CHARGE_STATES = new Set([
  "bulk", "absorption", "float", "storage", "equalize", "repeated_absorption",
  "auto_equalize", "recharging", "scheduled_recharging", "power_supply",
  "battery_safe", "charging",
]);
const INVERT_STATES = new Set(["inverting", "passthrough", "power_assist", "sustain", "discharging"]);

// Per-node default presentation. No entity IDs — those are user-supplied.
const NODE_DEFAULTS = {
  grid: { name: "Grid", icon: "mdi:transmission-tower" },
  solar: { name: "Solar", icon: "mdi:solar-power" },
  alternator: { name: "Alternator", icon: "mdi:engine" },
  battery: { name: "Battery", icon: "mdi:battery" },
  inverter: { name: "Inverter", icon: "mdi:sine-wave" },
  ac_loads: { name: "AC Loads", icon: "mdi:power-plug" },
  dc_loads: { name: "DC Loads", icon: "mdi:current-dc" },
};

const OPTIONAL_NODES = ["grid", "solar", "alternator", "inverter", "ac_loads", "dc_loads"];

class VanPowerFlowCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("van-power-flow-card-editor");
  }
  static getStubConfig() {
    return { title: "Power Flow", battery: { soc: "", power: "" } };
  }

  setConfig(config) {
    if (!config || !config.battery) {
      throw new Error("A `battery:` section is required (at least `power` or `soc`).");
    }
    const merged = { title: config.title ?? "" };
    merged.battery = { ...NODE_DEFAULTS.battery, ...config.battery };
    for (const k of OPTIONAL_NODES) {
      if (config[k] && typeof config[k] === "object") {
        merged[k] = { ...NODE_DEFAULTS[k], ...config[k] };
      }
    }
    this._config = merged;
    this._has = { battery: true };
    for (const k of OPTIONAL_NODES) this._has[k] = !!merged[k];
    this._built = false;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) this._build();
    this._update();
    requestAnimationFrame(() => this._draw());
  }

  getCardSize() { return 6; }

  // ---- helpers ----
  _st(id) { return id && this._hass && this._hass.states[id]; }
  _num(id) { const s = this._st(id); const n = s ? parseFloat(s.state) : NaN; return isNaN(n) ? 0 : n; }
  _has_val(id) { const s = this._st(id); return !!s && s.state !== "unavailable" && s.state !== "unknown"; }
  _stateStr(id) { const s = this._st(id); return s ? s.state : "—"; }
  _fmtW(w) { const a = Math.abs(w); return a >= 1000 ? (w / 1000).toFixed(1) + " kW" : Math.round(w) + " W"; }
  _fmtState(s) { return (s || "").replace(/_/g, " "); }
  _fmtTtg(sec) {
    if (!sec || sec <= 0) return "—";
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }
  _vinText(id) { return this._has_val(id) ? `${this._num(id).toFixed(2)} V in` : ""; }

  _moreInfo(entityId) {
    if (!entityId) return;
    const e = new Event("hass-more-info", { bubbles: true, composed: true });
    e.detail = { entityId };
    this.dispatchEvent(e);
  }

  // Navigate to the built-in History panel pre-loaded with the given entities (24h default).
  _history(entityIds) {
    const ids = entityIds.filter(Boolean);
    if (!ids.length) return;
    const start = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const path = `/history?entity_id=${ids.join(",")}&start_date=${encodeURIComponent(start)}`;
    history.pushState(null, "", path);
    this.dispatchEvent(new Event("location-changed", { bubbles: true, composed: true }));
  }

  // Build a node box. Row set depends on node type and which fields are configured.
  _nodeBoxHTML(key) {
    const cfg = this._config[key];
    const rows = [`<div class="hdr"><ha-icon icon="${cfg.icon}"></ha-icon><span>${cfg.name}</span></div>`];
    const stateRow = `<div class="state" data-f="${key}-state">—</div>`;
    const powerRow = `<div class="primary" data-f="${key}-power">— W</div>`;
    if (key === "battery") {
      if (cfg.power || cfg.state) rows.push(stateRow);
      if (cfg.soc) rows.push(`<div class="soc" data-f="battery-soc">— %</div>`);
      if (cfg.power) rows.push(powerRow);
      if (cfg.time_to_go) rows.push(`<div class="sub" data-f="battery-ttg">—</div>`);
      if (cfg.voltage || cfg.temperature) rows.push(`<div class="sub dim" data-f="battery-va">—</div>`);
    } else if (key === "solar" || key === "alternator") {
      if (cfg.state) rows.push(stateRow);
      if (cfg.power) rows.push(powerRow);
      if (cfg.input_voltage) rows.push(`<div class="sub dim" data-f="${key}-vin">—</div>`);
    } else if (key === "grid" || key === "inverter") {
      if (cfg.state) rows.push(stateRow);
      if (cfg.power) rows.push(powerRow);
    } else if (key === "ac_loads" || key === "dc_loads") {
      if (cfg.power) rows.push(powerRow);
    }
    return `<div class="box ${key}" data-node="${key}" style="grid-area:${key}">${rows.join("")}</div>`;
  }

  _build() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const c = this._config, has = this._has;

    // ---- uniform 3x3 grid layout (matches the Victron VRM flow screen) ----
    // Rows:   [grid,       inverter, ac_loads]
    //         [solar,      battery,  dc_loads]
    //         [alternator, .,        .       ]
    // Battery sits in the single center cell (row 2) so all rows align cleanly.
    const leftCol = has.grid || has.solar || has.alternator;
    const rightCol = has.ac_loads || has.dc_loads;
    const cell = (p, n) => (p ? n : ".");
    // When both solar and alternator are present, the battery (and DC loads)
    // span rows 2-3 so the two left-column sources sit tight against the
    // battery's vertical centre. Otherwise the battery is a single centre cell.
    const stack = has.solar && has.alternator;
    const grid3 = [
      [cell(has.grid, "grid"), cell(has.inverter, "inverter"), cell(has.ac_loads, "ac_loads")],
      [cell(has.solar, "solar"), "battery", cell(has.dc_loads, "dc_loads")],
      [cell(has.alternator, "alternator"), stack ? "battery" : ".", stack && has.dc_loads ? "dc_loads" : "."],
    ];
    const rowsUsed = has.alternator ? 3 : 2;
    const areaRows = [];
    for (let i = 0; i < rowsUsed; i++) {
      const r = [];
      if (leftCol) r.push(grid3[i][0]);
      r.push(grid3[i][1]);
      if (rightCol) r.push(grid3[i][2]);
      areaRows.push(`"${r.join(" ")}"`);
    }
    this._gridAreas = areaRows.join(" ");
    const cols = [];
    if (leftCol) cols.push("1fr");
    cols.push("1fr");
    if (rightCol) cols.push("1fr");
    this._gridCols = cols.join(" ");
    this._gridRows = `repeat(${rowsUsed}, auto)`;

    let boxes = "";
    for (const k of ["grid", "solar", "alternator", "battery", "inverter", "ac_loads", "dc_loads"]) {
      if (has[k]) boxes += this._nodeBoxHTML(k);
    }

    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      <ha-card>
        ${c.title ? `<div class="card-title">${c.title}</div>` : ""}
        <div class="wrap">
          <svg class="lines" xmlns="http://www.w3.org/2000/svg"></svg>
          ${boxes}
        </div>
      </ha-card>`;

    this._wrap = this.shadowRoot.querySelector(".wrap");
    this._wrap.style.gridTemplateAreas = this._gridAreas;
    this._wrap.style.gridTemplateColumns = this._gridCols;
    this._wrap.style.gridTemplateRows = this._gridRows;
    this._svg = this.shadowRoot.querySelector(".lines");
    this._f = {};
    this.shadowRoot.querySelectorAll("[data-f]").forEach((el) => (this._f[el.dataset.f] = el));

    // Click a node -> History panel of its relevant entities.
    this.shadowRoot.querySelectorAll(".box").forEach((box) => {
      box.addEventListener("click", () => this._history(this._historyEntities(box.dataset.node)));
    });

    if (this._ro) this._ro.disconnect();
    this._ro = new ResizeObserver(() => this._draw());
    this._ro.observe(this._wrap);
    this._built = true;
  }

  _historyEntities(key) {
    const cfg = this._config[key];
    if (!cfg) return [];
    if (key === "battery") return [cfg.soc, cfg.power, cfg.voltage, cfg.temperature];
    if (key === "solar" || key === "alternator") return [cfg.state, cfg.power, cfg.input_voltage];
    return [cfg.state, cfg.power]; // grid, inverter, ac_loads, dc_loads
  }

  _set(key, text) { if (this._f[key]) this._f[key].textContent = text; }

  _update() {
    const c = this._config, has = this._has, f = this._f;
    if (!f) return;

    // Simple source/grid/inverter/load nodes: state + power (+ vin for sources).
    for (const k of ["grid", "solar", "alternator", "inverter", "ac_loads", "dc_loads"]) {
      if (!has[k]) continue;
      const cfg = c[k];
      if (cfg.state) this._set(`${k}-state`, this._fmtState(this._stateStr(cfg.state)));
      if (cfg.power) this._set(`${k}-power`, this._fmtW(this._num(cfg.power)));
      if ((k === "solar" || k === "alternator") && cfg.input_voltage) {
        this._set(`${k}-vin`, this._vinText(cfg.input_voltage));
      }
    }

    // Battery.
    const b = c.battery;
    const bp = b.power ? this._num(b.power) : 0; // negative = discharging
    if (f["battery-state"]) {
      let status;
      if (b.power) status = bp < -0.5 ? "Discharging" : bp > 0.5 ? "Charging" : "Idle";
      else status = this._fmtState(this._stateStr(b.state));
      this._set("battery-state", status);
    }
    if (b.soc) this._set("battery-soc", Math.round(this._num(b.soc)) + " %");
    if (b.power && f["battery-power"]) this._set("battery-power", this._fmtW(bp));
    if (b.time_to_go && f["battery-ttg"]) {
      f["battery-ttg"].innerHTML = `<ha-icon class="mini" icon="mdi:timer-sand"></ha-icon>${this._fmtTtg(this._num(b.time_to_go))}`;
    }
    if (f["battery-va"]) {
      const parts = [];
      if (b.voltage && this._has_val(b.voltage)) parts.push(`${this._num(b.voltage).toFixed(2)} V`);
      if (b.temperature && this._has_val(b.temperature)) {
        const unit = this._st(b.temperature).attributes?.unit_of_measurement || "°";
        parts.push(`${Math.round(this._num(b.temperature))}${unit}`);
      }
      this._set("battery-va", parts.join(" · "));
    }
  }

  // Flow per line key: {active, reverse}. reverse flips dot direction (toward `a`).
  _flow(key) {
    const c = this._config;
    if (key === "inverter") {
      const iv = c.inverter;
      const st = iv.state ? this._stateStr(iv.state) : "";
      const load = iv.power ? this._num(iv.power) : 0;
      if (CHARGE_STATES.has(st)) return { active: true, reverse: true };           // AC -> battery
      if (INVERT_STATES.has(st) || load > 0) return { active: true, reverse: false }; // battery -> AC
      return { active: false, reverse: false };
    }
    // grid / solar / alternator / ac_loads / dc_loads: active when power flows.
    const p = c[key] && c[key].power ? this._num(c[key].power) : 0;
    return { active: Math.abs(p) > 0, reverse: false };
  }

  _center(node) {
    const wr = this._wrap.getBoundingClientRect();
    const el = this.shadowRoot.querySelector(`.box.${node}`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left - wr.left + r.width / 2, y: r.top - wr.top + r.height / 2 };
  }

  // Smooth cubic curve between two node centres. For diagonals the control
  // handles are pulled most of the way across horizontally, so the line leaves
  // the source flat, sweeps across, then bends into the target — the rounded
  // "elbow" connectors of the Victron VRM screen. Same-row/col pairs stay
  // straight.
  _curve(a, z) {
    const dx = z.x - a.x, dy = z.y - a.y;
    if (Math.abs(dy) < 4) return `M ${a.x},${a.y} L ${z.x},${z.y}`;      // same row → straight
    if (Math.abs(dx) < 4) return `M ${a.x},${a.y} L ${z.x},${z.y}`;      // same col → straight
    // Control points sit on the horizontal midline at each endpoint's y but
    // pushed ~85% of the way toward the other node's x → pronounced bend.
    const c1x = a.x + dx * 0.85;
    const c2x = z.x - dx * 0.85;
    return `M ${a.x},${a.y} C ${c1x},${a.y} ${c2x},${z.y} ${z.x},${z.y}`;
  }

  _draw() {
    if (!this._wrap) return;
    const w = this._wrap.clientWidth, h = this._wrap.clientHeight;
    if (!w || !h) return;
    const b = this._center("battery");
    if (!b) return;
    const has = this._has;
    const segs = [];
    // grid -> inverter (AC in)
    if (has.grid && has.inverter) segs.push({ id: "ln-grid", a: this._center("grid"), z: this._center("inverter"), flow: this._flow("grid") });
    // sources -> battery
    if (has.solar) segs.push({ id: "ln-solar", a: this._center("solar"), z: b, flow: this._flow("solar") });
    if (has.alternator) segs.push({ id: "ln-alt", a: this._center("alternator"), z: b, flow: this._flow("alternator") });
    // battery <-> inverter (bidirectional)
    if (has.inverter) segs.push({ id: "ln-inv", a: b, z: this._center("inverter"), flow: this._flow("inverter") });
    // inverter -> AC loads (fallback to battery if no inverter)
    if (has.ac_loads) segs.push({ id: "ln-acl", a: has.inverter ? this._center("inverter") : b, z: this._center("ac_loads"), flow: this._flow("ac_loads") });
    // battery -> DC loads
    if (has.dc_loads) segs.push({ id: "ln-dcl", a: b, z: this._center("dc_loads"), flow: this._flow("dc_loads") });

    let paths = "", dots = "";
    for (const s of segs) {
      if (!s.a || !s.z) continue;
      const from = s.flow.reverse ? s.z : s.a;
      const to = s.flow.reverse ? s.a : s.z;
      const d = this._curve(from, to);
      paths += `<path id="${s.id}" class="line ${s.flow.active ? "on" : "off"}" d="${d}" />`;
      if (s.flow.active) {
        for (let i = 0; i < 3; i++) {
          dots += `<circle r="3.2" class="dot">
            <animateMotion dur="3.2s" begin="${(i * 3.2 / 3).toFixed(2)}s" repeatCount="indefinite" calcMode="linear">
              <mpath href="#${s.id}" />
            </animateMotion></circle>`;
        }
      }
    }
    this._svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    this._svg.setAttribute("width", w);
    this._svg.setAttribute("height", h);
    this._svg.innerHTML = paths + dots;
  }
}

const STYLE = `
  ha-card {
    background: var(--vpf-bg, var(--ha-card-background, var(--card-background-color)));
    color: var(--vpf-fg, var(--primary-text-color));
    padding: 8px 12px 14px;
    overflow: hidden;
  }
  .card-title { font-size: 20px; font-weight: 500; margin: 6px 4px 2px; }
  .wrap {
    position: relative;
    display: grid;
    gap: 10px 48px;
    padding: 16px 8px;
    align-items: center;
    justify-items: center;
  }
  .lines { position: absolute; inset: 0; z-index: 0; pointer-events: none; }
  .line { fill: none; stroke-width: 2.5; }
  .line.on { stroke: var(--vpf-line-on, #2f8fd6); }
  .line.off { stroke: var(--vpf-line-off, #2a3f55); }
  .dot { fill: var(--vpf-dot, #6fc0ff); }
  .box {
    position: relative; z-index: 1;
    box-sizing: border-box;
    width: 100%; max-width: 150px;
    background: var(--vpf-node-bg, #16263a);
    border: 1px solid var(--vpf-node-border, #2c4a6e);
    border-radius: 14px;
    padding: 10px 8px;
    text-align: center;
    cursor: pointer;
    transition: border-color .15s, background .15s;
  }
  .box:hover { border-color: var(--vpf-node-hover, #4d82c0); background: var(--vpf-node-bg-hover, #1b2f47); }
  .hdr { display: flex; align-items: center; justify-content: center; gap: 5px; color: var(--vpf-hdr, #aebfd2); font-size: 13px; }
  .hdr ha-icon { --mdc-icon-size: 18px; color: var(--vpf-accent, #6fc0ff); }
  .state { font-size: 12px; color: var(--vpf-muted, #8fa6bd); text-transform: capitalize; margin-top: 4px; min-height: 14px; }
  .primary { font-size: 22px; font-weight: 500; margin-top: 2px; }
  .soc { font-size: 30px; font-weight: 600; margin-top: 2px; }
  .sub { font-size: 12px; color: var(--vpf-sub, #9fb3c8); margin-top: 3px; display: flex; align-items: center; justify-content: center; gap: 3px; }
  .sub.dim { color: var(--vpf-sub-dim, #6f829a); font-size: 11px; }
  ha-icon.mini { --mdc-icon-size: 13px; }
`;

// ---------------------------------------------------------------------------
// Visual editor (auto-generated HA UI via ha-form)
// ---------------------------------------------------------------------------
const SENSOR = { entity: { domain: ["sensor"] } };
const TEXT = { text: {} };
const ICON = { icon: {} };
const COMMON = [
  { name: "name", selector: TEXT },
  { name: "icon", selector: ICON },
];

const NODE_SCHEMAS = {
  battery: [...COMMON,
    { name: "soc", selector: SENSOR }, { name: "power", selector: SENSOR },
    { name: "voltage", selector: SENSOR }, { name: "current", selector: SENSOR },
    { name: "temperature", selector: SENSOR }, { name: "time_to_go", selector: SENSOR },
    { name: "state", selector: SENSOR }],
  grid: [...COMMON, { name: "state", selector: SENSOR }, { name: "power", selector: SENSOR }],
  solar: [...COMMON, { name: "power", selector: SENSOR }, { name: "state", selector: SENSOR }, { name: "input_voltage", selector: SENSOR }],
  alternator: [...COMMON, { name: "power", selector: SENSOR }, { name: "state", selector: SENSOR }, { name: "input_voltage", selector: SENSOR }],
  inverter: [...COMMON, { name: "power", selector: SENSOR }, { name: "state", selector: SENSOR }, { name: "mode", selector: { entity: { domain: ["select", "switch"] } } }],
  ac_loads: [...COMMON, { name: "power", selector: SENSOR }],
  dc_loads: [...COMMON, { name: "power", selector: SENSOR }],
};

const EDITOR_SCHEMA = [
  { name: "title", selector: TEXT },
  { name: "battery", type: "expandable", flatten: false, schema: NODE_SCHEMAS.battery },
  { name: "grid", type: "expandable", flatten: false, schema: NODE_SCHEMAS.grid },
  { name: "solar", type: "expandable", flatten: false, schema: NODE_SCHEMAS.solar },
  { name: "alternator", type: "expandable", flatten: false, schema: NODE_SCHEMAS.alternator },
  { name: "inverter", type: "expandable", flatten: false, schema: NODE_SCHEMAS.inverter },
  { name: "ac_loads", type: "expandable", flatten: false, schema: NODE_SCHEMAS.ac_loads },
  { name: "dc_loads", type: "expandable", flatten: false, schema: NODE_SCHEMAS.dc_loads },
];

const LABELS = {
  title: "Card title",
  battery: "Battery (required)", grid: "Grid (optional)", solar: "Solar (optional)",
  alternator: "Alternator / source (optional)", inverter: "Inverter / charger (optional)",
  ac_loads: "AC Loads (optional)", dc_loads: "DC Loads (optional)",
  name: "Display name", icon: "Icon", soc: "State of charge (%)", power: "Power (W)",
  voltage: "Voltage (V)", current: "Current (A)", temperature: "Temperature",
  time_to_go: "Time to go (s)", state: "State / charge stage", input_voltage: "Input voltage (V)",
  mode: "Control entity (tap target)",
};

class VanPowerFlowCardEditor extends HTMLElement {
  setConfig(config) { this._config = config || {}; this._render(); }
  set hass(hass) { this._hass = hass; if (this._form) this._form.hass = hass; }
  _render() {
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (s) => LABELS[s.name] || s.name;
      this._form.addEventListener("value-changed", (e) => {
        this.dispatchEvent(new CustomEvent("config-changed", {
          detail: { config: e.detail.value }, bubbles: true, composed: true,
        }));
      });
      this.appendChild(this._form);
    }
    this._form.schema = EDITOR_SCHEMA;
    this._form.data = this._config;
    if (this._hass) this._form.hass = this._hass;
  }
}

customElements.define("van-power-flow-card-editor", VanPowerFlowCardEditor);
customElements.define("van-power-flow-card", VanPowerFlowCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "van-power-flow-card",
  name: "Van Power Flow Card",
  description: "A configurable power-flow card (grid / solar / alternator / inverter / AC + DC loads, all optional).",
  preview: true,
  documentationURL: "https://github.com/leo-stan/hass-van-power-flow-card",
});
console.info(`%c VAN-POWER-FLOW-CARD %c v${VERSION} `, "color:#0d1a26;background:#6fc0ff", "color:#6fc0ff;background:#0d1a26");
