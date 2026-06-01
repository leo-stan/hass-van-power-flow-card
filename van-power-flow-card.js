/**
 * van-power-flow-card
 * A compact, configurable battery-centric power-flow card for Home Assistant.
 *
 * A central Battery with up to three optional surrounding nodes:
 *   - solar      (source, top-left)
 *   - alternator (source, bottom-left; relabel for grid/generator/etc.)
 *   - inverter   (right; can charge OR invert, so its line is bidirectional)
 *
 * Every node is optional except the battery. Each shows an (optional) state,
 * a primary wattage, and node-specific extras (voltage-in, SoC, time-to-go,
 * temperature). Animated dots flow along active lines; the battery<->inverter
 * line reverses based on the inverter's charge/invert state.
 *
 * Vanilla JS custom element — no build step. Config via YAML or the visual editor.
 */

const VERSION = "1.1.0";

// Inverter/charger states that mean "charging the battery" (AC -> DC), used to
// flip the battery<->inverter flow direction. Extend via config if needed.
const CHARGE_STATES = new Set([
  "bulk", "absorption", "float", "storage", "equalize", "repeated_absorption",
  "auto_equalize", "recharging", "scheduled_recharging", "power_supply",
  "battery_safe", "charging",
]);
const INVERT_STATES = new Set(["inverting", "passthrough", "power_assist", "sustain", "discharging"]);

// Per-node default presentation. No entity IDs — those are user-supplied.
const NODE_DEFAULTS = {
  solar: { name: "Solar", icon: "mdi:solar-power" },
  alternator: { name: "Alternator", icon: "mdi:engine" },
  battery: { name: "Battery", icon: "mdi:battery" },
  inverter: { name: "Inverter", icon: "mdi:sine-wave" },
};

const OPTIONAL_NODES = ["solar", "alternator", "inverter"];

class VanPowerFlowCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("van-power-flow-card-editor");
  }
  static getStubConfig() {
    return {
      title: "Power Flow",
      battery: { soc: "", power: "" },
    };
  }

  setConfig(config) {
    if (!config || !config.battery) {
      throw new Error("A `battery:` section is required (at least `power` or `soc`).");
    }
    const merged = { title: config.title ?? "" };
    merged.battery = { ...NODE_DEFAULTS.battery, ...config.battery };
    // Only keep optional nodes the user actually configured.
    for (const k of OPTIONAL_NODES) {
      if (config[k] && typeof config[k] === "object") {
        merged[k] = { ...NODE_DEFAULTS[k], ...config[k] };
      }
    }
    this._config = merged;
    this._has = {
      battery: true,
      solar: !!merged.solar,
      alternator: !!merged.alternator,
      inverter: !!merged.inverter,
    };
    this._built = false;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) this._build();
    this._update();
    requestAnimationFrame(() => this._draw());
  }

  getCardSize() { return 5; }

  // ---- helpers ----
  _st(id) { return id && this._hass && this._hass.states[id]; }
  _num(id) { const s = this._st(id); const n = s ? parseFloat(s.state) : NaN; return isNaN(n) ? 0 : n; }
  _has_val(id) { const s = this._st(id); return !!s && s.state !== "unavailable" && s.state !== "unknown"; }
  _stateStr(id) { const s = this._st(id); return s ? s.state : "—"; }
  _fmtW(w) { const a = Math.abs(w); return a >= 1000 ? (w / 1000).toFixed(1) + " kW" : Math.round(w) + " W"; }
  _fmtState(s) { return (s || "").replace(/_/g, " "); }
  _fmtTtg(sec) {
    if (!sec || sec <= 0) return "—";
    // Truncate (floor) like the Victron VRM does (863999s sentinel -> "9d 23h").
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

  // Navigate to the built-in History panel pre-loaded with the given entities,
  // defaulting to the last 24h. The native panel keeps the full timescale picker
  // (the user can widen to 7d / 30d / custom from there).
  _history(entityIds) {
    const ids = entityIds.filter(Boolean);
    if (!ids.length) return;
    const start = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const path = `/history?entity_id=${ids.join(",")}&start_date=${encodeURIComponent(start)}`;
    history.pushState(null, "", path);
    this.dispatchEvent(new Event("location-changed", { bubbles: true, composed: true }));
  }

  // Build the inner rows of a source-style node (solar / alternator).
  _sourceBoxHTML(key, cfg) {
    const rows = [`<div class="hdr"><ha-icon icon="${cfg.icon}"></ha-icon><span>${cfg.name}</span></div>`];
    if (cfg.state) rows.push(`<div class="state" data-f="${key}-state">—</div>`);
    if (cfg.power) rows.push(`<div class="primary" data-f="${key}-power">— W</div>`);
    if (cfg.input_voltage) rows.push(`<div class="sub dim" data-f="${key}-vin">—</div>`);
    return `<div class="box ${key}" data-node="${key}" style="grid-area:${key}">${rows.join("")}</div>`;
  }

  _build() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const c = this._config, has = this._has;

    // ---- dynamic grid layout via template-areas ----
    const left = [];
    if (has.solar) left.push("solar");
    if (has.alternator) left.push("alternator");
    let leftRow1 = null, leftRow2 = null;
    if (left.length === 2) { leftRow1 = "solar"; leftRow2 = "alternator"; }
    else if (left.length === 1) { leftRow1 = leftRow2 = left[0]; }
    const hasLeft = left.length > 0, hasRight = has.inverter;

    const row1 = [hasLeft ? leftRow1 : null, "battery", hasRight ? "inverter" : null].filter(Boolean);
    const row2 = [hasLeft ? leftRow2 : null, "battery", hasRight ? "inverter" : null].filter(Boolean);
    // grid-template-areas applied via JS after render (quoted value can't live in
    // an inline style="" attribute reliably).
    this._gridAreas = `"${row1.join(" ")}" "${row2.join(" ")}"`;
    this._gridCols = [hasLeft ? "1fr" : null, "1.2fr", hasRight ? "1fr" : null].filter(Boolean).join(" ");

    // ---- battery box rows ----
    const b = c.battery;
    const bRows = [`<div class="hdr"><ha-icon icon="${b.icon}"></ha-icon><span>${b.name}</span></div>`];
    if (b.power || b.state) bRows.push(`<div class="state" data-f="batt-state">—</div>`);
    if (b.soc) bRows.push(`<div class="soc" data-f="batt-soc">— %</div>`);
    if (b.power) bRows.push(`<div class="primary" data-f="batt-power">— W</div>`);
    if (b.time_to_go) bRows.push(`<div class="sub" data-f="batt-ttg">—</div>`);
    if (b.voltage || b.temperature) bRows.push(`<div class="sub dim" data-f="batt-va">—</div>`);
    const batteryBox = `<div class="box battery" data-node="battery" style="grid-area:battery">${bRows.join("")}</div>`;

    // ---- inverter box rows ----
    let inverterBox = "";
    if (has.inverter) {
      const iv = c.inverter;
      const iRows = [`<div class="hdr"><ha-icon icon="${iv.icon}"></ha-icon><span>${iv.name}</span></div>`];
      if (iv.state) iRows.push(`<div class="state" data-f="inv-state">—</div>`);
      if (iv.power) iRows.push(`<div class="primary" data-f="inv-power">— W</div>`);
      inverterBox = `<div class="box inverter" data-node="inverter" style="grid-area:inverter">${iRows.join("")}</div>`;
    }

    const sourceBoxes =
      (has.solar ? this._sourceBoxHTML("solar", c.solar) : "") +
      (has.alternator ? this._sourceBoxHTML("alternator", c.alternator) : "");

    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      <ha-card>
        ${c.title ? `<div class="card-title">${c.title}</div>` : ""}
        <div class="wrap">
          <svg class="lines" xmlns="http://www.w3.org/2000/svg"></svg>
          ${sourceBoxes}
          ${batteryBox}
          ${inverterBox}
        </div>
      </ha-card>`;

    this._wrap = this.shadowRoot.querySelector(".wrap");
    // Apply the dynamic grid template via JS (reliable quoting).
    this._wrap.style.gridTemplateAreas = this._gridAreas;
    this._wrap.style.gridTemplateColumns = this._gridCols;
    this._svg = this.shadowRoot.querySelector(".lines");
    this._f = {};
    this.shadowRoot.querySelectorAll("[data-f]").forEach((el) => (this._f[el.dataset.f] = el));

    // Click: sources open a combined history popup; battery/inverter -> more-info.
    this.shadowRoot.querySelectorAll(".box").forEach((box) => {
      box.addEventListener("click", () => {
        const n = box.dataset.node;
        if (n === "solar" || n === "alternator") {
          const cfg = c[n];
          this._history([cfg.state, cfg.power, cfg.input_voltage]);
        } else if (n === "battery") {
          this._history([b.soc, b.power, b.voltage, b.temperature]);
        } else if (n === "inverter") {
          this._history([c.inverter.state, c.inverter.power]);
        }
      });
    });

    if (this._ro) this._ro.disconnect();
    this._ro = new ResizeObserver(() => this._draw());
    this._ro.observe(this._wrap);
    this._built = true;
  }

  _set(key, text) { if (this._f[key]) this._f[key].textContent = text; }

  _updateSource(key) {
    const cfg = this._config[key];
    if (cfg.state) this._set(`${key}-state`, this._fmtState(this._stateStr(cfg.state)));
    if (cfg.power) this._set(`${key}-power`, this._fmtW(this._num(cfg.power)));
    if (cfg.input_voltage) this._set(`${key}-vin`, this._vinText(cfg.input_voltage));
  }

  _update() {
    const c = this._config, has = this._has, f = this._f;
    if (!f) return;
    if (has.solar) this._updateSource("solar");
    if (has.alternator) this._updateSource("alternator");

    // Battery
    const b = c.battery;
    const bp = b.power ? this._num(b.power) : 0; // negative = discharging
    if (f["batt-state"]) {
      // Prefer a derived charging/discharging label from power direction (matches
      // VRM); fall back to the configured state entity if no power entity.
      let status;
      if (b.power) status = bp < -0.5 ? "Discharging" : bp > 0.5 ? "Charging" : "Idle";
      else status = this._fmtState(this._stateStr(b.state));
      this._set("batt-state", status);
    }
    if (b.soc) this._set("batt-soc", Math.round(this._num(b.soc)) + " %");
    if (b.power && f["batt-power"]) this._set("batt-power", this._fmtW(bp));
    if (b.time_to_go && f["batt-ttg"]) {
      f["batt-ttg"].innerHTML = `<ha-icon class="mini" icon="mdi:timer-sand"></ha-icon>${this._fmtTtg(this._num(b.time_to_go))}`;
    }
    if (f["batt-va"]) {
      const parts = [];
      if (b.voltage && this._has_val(b.voltage)) parts.push(`${this._num(b.voltage).toFixed(2)} V`);
      if (b.temperature && this._has_val(b.temperature)) {
        const unit = this._st(b.temperature).attributes?.unit_of_measurement || "°";
        parts.push(`${Math.round(this._num(b.temperature))}${unit}`);
      }
      this._set("batt-va", parts.join(" · "));
    }

    // Inverter
    if (has.inverter) {
      const iv = c.inverter;
      if (iv.state) this._set("inv-state", this._fmtState(this._stateStr(iv.state)));
      if (iv.power) this._set("inv-power", this._fmtW(this._num(iv.power)));
    }
  }

  // Flow per line: {active, reverse}. reverse flips the dot direction.
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
    // sources: active when producing power
    const p = c[key].power ? this._num(c[key].power) : 0;
    return { active: p > 0, reverse: false };
  }

  _center(node) {
    const wr = this._wrap.getBoundingClientRect();
    const el = this.shadowRoot.querySelector(`.box.${node}`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left - wr.left + r.width / 2, y: r.top - wr.top + r.height / 2 };
  }

  _draw() {
    if (!this._wrap) return;
    const w = this._wrap.clientWidth, h = this._wrap.clientHeight;
    if (!w || !h) return;
    const b = this._center("battery");
    if (!b) return;
    const has = this._has;
    const segs = [];
    if (has.solar) segs.push({ id: "ln-solar", a: this._center("solar"), z: b, flow: this._flow("solar") });
    if (has.alternator) segs.push({ id: "ln-alt", a: this._center("alternator"), z: b, flow: this._flow("alternator") });
    if (has.inverter) segs.push({ id: "ln-inv", a: b, z: this._center("inverter"), flow: this._flow("inverter") });

    let paths = "", dots = "";
    for (const s of segs) {
      if (!s.a || !s.z) continue;
      const from = s.flow.reverse ? s.z : s.a;
      const to = s.flow.reverse ? s.a : s.z;
      const d = `M ${from.x},${from.y} L ${to.x},${to.y}`;
      paths += `<path id="${s.id}" class="line ${s.flow.active ? "on" : "off"}" d="${d}" />`;
      if (s.flow.active) {
        for (let i = 0; i < 3; i++) {
          dots += `<circle r="3.2" class="dot">
            <animateMotion dur="1.6s" begin="${(i * 1.6 / 3).toFixed(2)}s" repeatCount="indefinite" calcMode="linear">
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
    grid-template-rows: 1fr 1fr;
    gap: 22px 56px;
    min-height: 300px;
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
  .box.battery { max-width: 168px; }
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

const NODE_SCHEMAS = {
  battery: [
    { name: "name", selector: TEXT },
    { name: "icon", selector: ICON },
    { name: "soc", selector: SENSOR },
    { name: "power", selector: SENSOR },
    { name: "voltage", selector: SENSOR },
    { name: "current", selector: SENSOR },
    { name: "temperature", selector: SENSOR },
    { name: "time_to_go", selector: SENSOR },
    { name: "state", selector: SENSOR },
  ],
  solar: [
    { name: "name", selector: TEXT },
    { name: "icon", selector: ICON },
    { name: "power", selector: SENSOR },
    { name: "state", selector: SENSOR },
    { name: "input_voltage", selector: SENSOR },
  ],
  alternator: [
    { name: "name", selector: TEXT },
    { name: "icon", selector: ICON },
    { name: "power", selector: SENSOR },
    { name: "state", selector: SENSOR },
    { name: "input_voltage", selector: SENSOR },
  ],
  inverter: [
    { name: "name", selector: TEXT },
    { name: "icon", selector: ICON },
    { name: "power", selector: SENSOR },
    { name: "state", selector: SENSOR },
    { name: "mode", selector: { entity: { domain: ["select", "switch"] } } },
  ],
};

const EDITOR_SCHEMA = [
  { name: "title", selector: TEXT },
  { name: "battery", type: "expandable", flatten: false, schema: NODE_SCHEMAS.battery },
  { name: "solar", type: "expandable", flatten: false, schema: NODE_SCHEMAS.solar },
  { name: "alternator", type: "expandable", flatten: false, schema: NODE_SCHEMAS.alternator },
  { name: "inverter", type: "expandable", flatten: false, schema: NODE_SCHEMAS.inverter },
];

const LABELS = {
  title: "Card title",
  battery: "Battery (required)",
  solar: "Solar (optional)",
  alternator: "Alternator / source (optional)",
  inverter: "Inverter / charger (optional)",
  name: "Display name",
  icon: "Icon",
  soc: "State of charge (%)",
  power: "Power (W)",
  voltage: "Voltage (V)",
  current: "Current (A)",
  temperature: "Temperature",
  time_to_go: "Time to go (s)",
  state: "State / charge stage",
  input_voltage: "Input voltage (V)",
  mode: "Control entity (tap target)",
};

class VanPowerFlowCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config || {};
    this._render();
  }
  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
  }
  _render() {
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (s) => LABELS[s.name] || s.name;
      this._form.addEventListener("value-changed", (e) => {
        this.dispatchEvent(new CustomEvent("config-changed", {
          detail: { config: e.detail.value },
          bubbles: true, composed: true,
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
  description: "A configurable battery-centric power-flow card (solar / alternator / inverter, all optional).",
  preview: true,
  documentationURL: "https://github.com/leo-stan/hass-van-power-flow-card",
});
console.info(`%c VAN-POWER-FLOW-CARD %c v${VERSION} `, "color:#0d1a26;background:#6fc0ff", "color:#6fc0ff;background:#0d1a26");
