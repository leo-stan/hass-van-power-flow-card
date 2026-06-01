/**
 * van-power-flow-card
 * A bespoke Victron-style power-flow card for the van's Home Assistant.
 *
 * Fixed 4-node layout (no grid/home solar model to fight):
 *   Solar + Alternator on the left  ->  Battery in the middle  <->  Inverter on the right.
 * AC loads are shown as the inverter's wattage; DC watts live inside the battery.
 * Each node shows its Victron charge state (off / bulk / absorption / float / ...).
 * Animated direction dots run on every active line; the Battery<->Inverter line is the
 * only one that reverses (charger vs inverter), driven by the inverter's state.
 *
 * Vanilla JS custom element — no build step. Edit, copy to /config/www, bump ?v=.
 */

const CHARGE_STATES = new Set([
  "bulk", "absorption", "float", "storage", "equalize", "repeated_absorption",
  "auto_equalize", "recharging", "scheduled_recharging", "power_supply", "battery_safe",
]);
const INVERT_STATES = new Set(["inverting", "passthrough", "power_assist", "sustain"]);

const DEFAULTS = {
  title: "Victron System",
  solar: {
    name: "Solar", icon: "mdi:solar-panel",
    power: "sensor.gx_device_pv_power",
    state: "sensor.bluesolar_charger_mppt_100_30_rev3_id_277_state",
  },
  alternator: {
    name: "Alternator", icon: "mdi:engine",
    power: "sensor.gx_device_dc_alternator_power",
    state: "sensor.orion_xs_hq2532z29za_state",
  },
  battery: {
    name: "Battery", icon: "mdi:car-battery",
    soc: "sensor.gx_device_dc_battery_charge",
    power: "sensor.gx_device_dc_battery_power",
    voltage: "sensor.gx_device_dc_battery_voltage",
    current: "sensor.gx_device_dc_battery_current",
    time_to_go: "sensor.bmv_700_id_278_time_to_go",
    state: "sensor.gx_device_dc_battery_state",
  },
  inverter: {
    name: "Inverter", icon: "mdi:sine-wave",
    power: "sensor.gx_device_consumption_power_l1",
    state: "sensor.multiplus_12_1200_50_16_120v_id_276_state",
    mode: "select.multiplus_12_1200_50_16_120v_id_276",
  },
};

class VanPowerFlowCard extends HTMLElement {
  setConfig(config) {
    // Shallow-merge each node so a partial config still gets van defaults.
    const merged = { ...DEFAULTS, ...config };
    for (const k of ["solar", "alternator", "battery", "inverter"]) {
      merged[k] = { ...DEFAULTS[k], ...(config[k] || {}) };
    }
    this._config = merged;
    this._built = false;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) this._build();
    this._update();
    // Defer line drawing to the next frame so box geometry is settled.
    requestAnimationFrame(() => this._draw());
  }

  getCardSize() { return 5; }

  // ---- helpers ----
  _st(id) { return id && this._hass && this._hass.states[id]; }
  _num(id) { const s = this._st(id); const n = s ? parseFloat(s.state) : NaN; return isNaN(n) ? 0 : n; }
  _stateStr(id) { const s = this._st(id); return s ? s.state : "—"; }
  _fmtW(w) { const a = Math.abs(w); return (a >= 1000 ? (w / 1000).toFixed(1) + " kW" : Math.round(w) + " W"); }
  _fmtState(s) { return (s || "").replace(/_/g, " "); }
  _fmtTtg(sec) {
    if (!sec || sec <= 0) return "—";
    // Round to the nearest minute and carry up, so the Victron 863999s sentinel
    // (9d 23h 59m 59s) renders as a clean "10d" like the VRM does.
    const totalMin = Math.round(sec / 60);
    const d = Math.floor(totalMin / 1440);
    const h = Math.floor((totalMin % 1440) / 60);
    const m = totalMin % 60;
    if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }
  _moreInfo(entityId) {
    if (!entityId) return;
    const e = new Event("hass-more-info", { bubbles: true, composed: true });
    e.detail = { entityId };
    this.dispatchEvent(e);
  }

  _build() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const c = this._config;
    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      <ha-card>
        ${c.title ? `<div class="card-title">${c.title}</div>` : ""}
        <div class="wrap">
          <svg class="lines" xmlns="http://www.w3.org/2000/svg"></svg>
          <div class="box solar" data-node="solar">
            <div class="hdr"><ha-icon icon="${c.solar.icon}"></ha-icon><span>${c.solar.name}</span></div>
            <div class="state" data-f="solar-state">—</div>
            <div class="primary" data-f="solar-power">— W</div>
          </div>
          <div class="box alternator" data-node="alternator">
            <div class="hdr"><ha-icon icon="${c.alternator.icon}"></ha-icon><span>${c.alternator.name}</span></div>
            <div class="state" data-f="alt-state">—</div>
            <div class="primary" data-f="alt-power">— W</div>
          </div>
          <div class="box battery" data-node="battery">
            <div class="hdr"><ha-icon icon="${c.battery.icon}"></ha-icon><span>${c.battery.name}</span></div>
            <div class="state" data-f="batt-state">—</div>
            <div class="soc" data-f="batt-soc">— %</div>
            <div class="primary" data-f="batt-power">— W</div>
            <div class="sub" data-f="batt-ttg">—</div>
            <div class="sub dim" data-f="batt-va">—</div>
          </div>
          <div class="box inverter" data-node="inverter">
            <div class="hdr"><ha-icon icon="${c.inverter.icon}"></ha-icon><span>${c.inverter.name}</span></div>
            <div class="state" data-f="inv-state">—</div>
            <div class="primary" data-f="inv-power">— W</div>
          </div>
        </div>
      </ha-card>`;

    this._wrap = this.shadowRoot.querySelector(".wrap");
    this._svg = this.shadowRoot.querySelector(".lines");
    this._f = {};
    this.shadowRoot.querySelectorAll("[data-f]").forEach((el) => (this._f[el.dataset.f] = el));

    // Click → more-info on the most relevant entity.
    this.shadowRoot.querySelectorAll(".box").forEach((box) => {
      box.addEventListener("click", () => {
        const n = box.dataset.node;
        const map = {
          solar: c.solar.state, alternator: c.alternator.state,
          battery: c.battery.soc, inverter: c.inverter.mode || c.inverter.state,
        };
        this._moreInfo(map[n]);
      });
    });

    if (this._ro) this._ro.disconnect();
    this._ro = new ResizeObserver(() => this._draw());
    this._ro.observe(this._wrap);
    this._built = true;
  }

  _update() {
    const c = this._config, f = this._f;
    if (!f) return;
    // Solar
    f["solar-state"].textContent = this._fmtState(this._stateStr(c.solar.state));
    f["solar-power"].textContent = this._fmtW(this._num(c.solar.power));
    // Alternator
    f["alt-state"].textContent = this._fmtState(this._stateStr(c.alternator.state));
    f["alt-power"].textContent = this._fmtW(this._num(c.alternator.power));
    // Battery
    const bp = this._num(c.battery.power); // negative = discharging
    // Victron's UI labels by current direction, not the GX state entity (which
    // has a wide deadband and reads "idle" under small loads). Derive from power.
    const battStatus = bp < -0.5 ? "Discharging" : bp > 0.5 ? "Charging" : "Idle";
    f["batt-state"].textContent = battStatus;
    f["batt-soc"].textContent = Math.round(this._num(c.battery.soc)) + " %";
    f["batt-power"].textContent = this._fmtW(bp); // signed: negative when discharging
    f["batt-ttg"].innerHTML = `<ha-icon class="mini" icon="mdi:timer-sand"></ha-icon>${this._fmtTtg(this._num(c.battery.time_to_go))}`;
    f["batt-va"].textContent =
      `${this._num(c.battery.voltage).toFixed(2)} V · ${this._num(c.battery.current).toFixed(1)} A`;
    // Inverter
    f["inv-state"].textContent = this._fmtState(this._stateStr(c.inverter.state));
    f["inv-power"].textContent = this._fmtW(this._num(c.inverter.power));
  }

  // Determine flow on each line: returns {active, reverse} where reverse flips dot direction.
  _flows() {
    const c = this._config;
    const solarP = this._num(c.solar.power);
    const altP = this._num(c.alternator.power);
    const invState = this._stateStr(c.inverter.state);
    const invLoad = this._num(c.inverter.power);
    let inv = { active: false, reverse: false };
    if (CHARGE_STATES.has(invState)) inv = { active: true, reverse: true };       // AC in -> battery
    else if (INVERT_STATES.has(invState) || invLoad > 0) inv = { active: true, reverse: false }; // battery -> AC
    return {
      solar: { active: solarP > 0, reverse: false },
      alternator: { active: altP > 0, reverse: false },
      inverter: inv,
    };
  }

  _center(node) {
    const wr = this._wrap.getBoundingClientRect();
    const r = this.shadowRoot.querySelector(`.box.${node}`).getBoundingClientRect();
    return { x: r.left - wr.left + r.width / 2, y: r.top - wr.top + r.height / 2 };
  }

  _draw() {
    if (!this._wrap) return;
    const w = this._wrap.clientWidth, h = this._wrap.clientHeight;
    if (!w || !h) return;
    const b = this._center("battery");
    const segs = [
      { id: "ln-solar", from: this._center("solar"), to: b, flow: this._flows().solar },
      { id: "ln-alt", from: this._center("alternator"), to: b, flow: this._flows().alternator },
      { id: "ln-inv", from: b, to: this._center("inverter"), flow: this._flows().inverter },
    ];
    let paths = "", dots = "";
    for (const s of segs) {
      const a = s.flow.reverse ? s.to : s.from;
      const z = s.flow.reverse ? s.from : s.to;
      const d = `M ${a.x},${a.y} L ${z.x},${z.y}`;
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
    background: #0d1a26;
    color: #eaf2fb;
    padding: 8px 12px 14px;
    overflow: hidden;
  }
  .card-title { font-size: 20px; font-weight: 500; margin: 6px 4px 2px; }
  .wrap {
    position: relative;
    display: grid;
    grid-template-columns: 1fr 1.2fr 1fr;
    grid-template-rows: 1fr 1fr;
    gap: 22px 56px;
    min-height: 320px;
    padding: 16px 8px;
    align-items: center;
    justify-items: center;
  }
  .lines { position: absolute; inset: 0; z-index: 0; pointer-events: none; }
  .line { fill: none; stroke-width: 2.5; }
  .line.on { stroke: #2f8fd6; }
  .line.off { stroke: #2a3f55; }
  .dot { fill: #6fc0ff; }
  .box {
    position: relative; z-index: 1;
    box-sizing: border-box;
    width: 100%; max-width: 150px;
    background: #16263a;
    border: 1px solid #2c4a6e;
    border-radius: 14px;
    padding: 10px 8px;
    text-align: center;
    cursor: pointer;
    transition: border-color .15s, background .15s;
  }
  .box:hover { border-color: #4d82c0; background: #1b2f47; }
  .box.solar { grid-column: 1; grid-row: 1; }
  .box.alternator { grid-column: 1; grid-row: 2; }
  .box.battery { grid-column: 2; grid-row: 1 / 3; max-width: 168px; }
  .box.inverter { grid-column: 3; grid-row: 1 / 3; }
  .hdr { display: flex; align-items: center; justify-content: center; gap: 5px; color: #aebfd2; font-size: 13px; }
  .hdr ha-icon { --mdc-icon-size: 18px; color: #6fc0ff; }
  .state { font-size: 12px; color: #8fa6bd; text-transform: capitalize; margin-top: 4px; min-height: 14px; }
  .primary { font-size: 22px; font-weight: 500; margin-top: 2px; }
  .soc { font-size: 30px; font-weight: 600; margin-top: 2px; }
  .sub { font-size: 12px; color: #9fb3c8; margin-top: 3px; display: flex; align-items: center; justify-content: center; gap: 3px; }
  .sub.dim { color: #6f829a; font-size: 11px; }
  ha-icon.mini { --mdc-icon-size: 13px; }
`;

customElements.define("van-power-flow-card", VanPowerFlowCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "van-power-flow-card",
  name: "Van Power Flow Card",
  description: "Bespoke Victron-style power flow card for the van.",
});
console.info("%c VAN-POWER-FLOW-CARD %c v0.1.0 ", "color:#0d1a26;background:#6fc0ff", "color:#6fc0ff;background:#0d1a26");
