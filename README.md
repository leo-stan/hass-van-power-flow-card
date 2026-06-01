# Van Power Flow Card

A compact, **battery-centric** power-flow card for Home Assistant. A central
battery surrounded by up to three optional nodes — **solar**, **alternator**
(relabel for grid / generator / shore), and **inverter / charger** — with
animated flow lines, per-node state, and click-through 24-hour history graphs.

Built for DC systems (vans, RVs, boats, off-grid) where the stock Energy
Distribution card's grid/solar/home model doesn't fit. Pure vanilla JS — no
build step.

## Features

- **Battery-centric layout** — battery in the middle; solar/alternator on the
  left, inverter on the right. **Every node except the battery is optional** —
  omit one and it (and its flow line) simply disappears, and the layout
  re-centers.
- **Animated flow lines** — dots travel along active connections. The
  battery↔inverter line is **bidirectional**: it reverses based on the
  inverter's state (charging vs inverting).
- **Per-node detail** — state / charge stage, signed wattage, input voltage
  (solar PV / alternator source), and for the battery: SoC %, time-to-go,
  voltage, and temperature.
- **Click for history** — tapping a node opens a popup with a 24-hour
  history-graph of its relevant entities (state + power + voltage, etc.).
- **Visual editor** — configure entirely in the HA card UI (no YAML required),
  or use YAML.
- **Themeable** — colors are CSS variables (`--vpf-*`).

## Installation

### Manual

1. Download `van-power-flow-card.js`.
2. Copy it to `config/www/` on your HA instance.
3. Add it as a dashboard resource (**Settings → Dashboards → ⋮ → Resources →
   Add**), URL `/local/van-power-flow-card.js`, type **JavaScript Module**.
4. Hard-refresh your browser.

### HACS (custom repository)

Add `leo-stan/hass-van-power-flow-card` as a **Lovelace** custom repository in
HACS, then install.

## Configuration

Add a card of type `custom:van-power-flow-card`. Only `battery` is required.

### Minimal

```yaml
type: custom:van-power-flow-card
title: My System
battery:
  soc: sensor.battery_soc
  power: sensor.battery_power   # signed: negative = discharging
```

### Full example

```yaml
type: custom:van-power-flow-card
title: Victron System
battery:
  name: Battery
  icon: mdi:car-battery
  soc: sensor.battery_charge          # %
  power: sensor.battery_power         # W, signed (− = discharging)
  voltage: sensor.battery_voltage     # V
  current: sensor.battery_current     # A
  temperature: sensor.battery_temp    # ° (any unit)
  time_to_go: sensor.battery_time_to_go  # seconds
  state: sensor.battery_state         # used only if `power` is unset
solar:
  name: Solar
  icon: mdi:solar-panel
  power: sensor.pv_power
  state: sensor.solar_charger_state   # e.g. bulk / absorption / float
  input_voltage: sensor.pv_voltage    # panel voltage, shown as "N V in"
alternator:                           # relabel freely (grid / generator / shore)
  name: Alternator
  icon: mdi:engine
  power: sensor.alternator_power
  state: sensor.dcdc_charger_state
  input_voltage: sensor.starter_battery_voltage
inverter:
  name: Inverter
  icon: mdi:sine-wave
  power: sensor.ac_loads_power        # AC load wattage
  state: sensor.inverter_state        # drives flow direction (see below)
  mode: select.inverter_mode          # optional tap target (more-info)
```

### Options

| Node | Key | Meaning |
|------|-----|---------|
| **battery** (required) | `soc` | State of charge (%) |
| | `power` | Power in W, **signed** (− = discharging). Drives the derived Charging/Discharging/Idle label. |
| | `voltage` / `current` / `temperature` | Shown in the battery's detail line |
| | `time_to_go` | Seconds; rendered like Victron VRM (floored, e.g. `9d 23h`) |
| | `state` | Fallback status label when `power` is not set |
| **solar / alternator** (optional) | `power` | Wattage (line is "active" when > 0) |
| | `state` | State / charge stage label |
| | `input_voltage` | Source voltage, shown as `N V in` |
| **inverter** (optional) | `power` | AC load wattage |
| | `state` | Charge/invert state — controls flow direction |
| | `mode` | Optional `select`/`switch` entity used as the tap target |

All nodes also accept `name` and `icon`.

### Flow direction

Source nodes (solar, alternator) flow **into** the battery whenever their power
is > 0. The inverter line is bidirectional:

- **Charging** states (`bulk`, `absorption`, `float`, `charging`, …) → flows
  **into** the battery (AC → DC).
- **Inverting** states (`inverting`, `power_assist`, `discharging`, …) or any AC
  load → flows **out** of the battery (DC → AC).

## Theming

Override any of these CSS variables (via `card_mod` or a theme):

```
--vpf-bg, --vpf-fg, --vpf-accent, --vpf-line-on, --vpf-line-off, --vpf-dot,
--vpf-node-bg, --vpf-node-border, --vpf-node-hover, --vpf-node-bg-hover,
--vpf-hdr, --vpf-muted, --vpf-sub, --vpf-sub-dim
```

## License

MIT
