# Van Power Flow Card

[![GitHub release](https://img.shields.io/github/v/release/leo-stan/hass-van-power-flow-card?style=flat-square)](https://github.com/leo-stan/hass-van-power-flow-card/releases)
[![hacs](https://img.shields.io/badge/HACS-Custom-41BDF5?style=flat-square)](https://hacs.xyz)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

A compact, **battery-centric** power-flow card for Home Assistant. A central
battery surrounded by six optional nodes — **grid / shore**, **solar**,
**alternator**, **inverter / charger**, **AC loads**, and **DC loads** — with
animated flow lines, per-node state, and click-through history.

Built for DC systems (vans, RVs, boats, off-grid) where the stock Energy
Distribution card's grid/solar/home model doesn't fit. Pure vanilla JS, **no
build step**, themeable, with a visual editor.

<p align="center">
  <img src="docs/screenshot.png" alt="Updated Van Power Flow Card showing Grid connected, inverter, solar, alternator, battery, and AC/DC loads" width="620">
</p>

## Features

- 🔋 **Battery-centric layout** — battery in the middle; grid, solar and
  alternator on the left, inverter above, and AC/DC loads on the right.
- ➕ **Everything optional** — only the battery is required. Omit any node and it
  (with its flow line) disappears; the layout re-centers automatically.
- 🌊 **Animated flow lines** — dots travel along active connections. The
  battery↔inverter line is **bidirectional** — it reverses based on the
  inverter's state (charging vs inverting).
- 📊 **Per-node detail** — state / charge stage, signed wattage, input voltage
  (solar PV / alternator source); the battery also shows SoC %, time-to-go,
  voltage, and temperature.
- 🕑 **Controls and history** — tap a node with a configured `mode` entity to
  open its controls; hold for 500 ms to open History. Nodes without a `mode`
  entity open History on tap (last 24 h by default).
- 🎛️ **Visual editor** — configure it entirely in the HA card UI, no YAML
  required.
- 🎨 **Themeable** — all colors are `--vpf-*` CSS variables.

<p align="center">
  <img src="docs/editor.png" alt="Visual editor" width="420">
</p>

## Installation

### HACS (recommended)

1. In HACS, go to **⋮ → Custom repositories**.
2. Add `https://github.com/leo-stan/hass-van-power-flow-card` with category
   **Lovelace / Dashboard**.
3. Install **Van Power Flow Card**, then hard-refresh your browser.

### Manual

1. Download `van-power-flow-card.js` from the
   [latest release](https://github.com/leo-stan/hass-van-power-flow-card/releases).
2. Copy it to `config/www/` on your HA instance.
3. Add a dashboard resource (**Settings → Dashboards → ⋮ → Resources → Add**):
   URL `/local/van-power-flow-card.js`, type **JavaScript Module**.
4. Hard-refresh your browser.

## Configuration

For Victron systems, use the GX system's active input source for the Grid node:

```yaml
grid:
  state: sensor.gx_device_ac_active_input_source
```

The card displays `grid`, `generator`, and `shore_power` as **Connected**, and
`not_connected` as **Not Connected**. The MultiPlus-specific active-input sensor
can report `unknown` even while the GX system correctly reports the active source.

Flow particles start spaced along their paths and keep animating through routine
Home Assistant state updates; layout or flow changes redraw the paths.

Add a card of type `custom:van-power-flow-card`. Use the **visual editor**, or
YAML. Only the `battery` section is required.

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
  soc: sensor.battery_charge             # %
  power: sensor.battery_power            # W, signed (− = discharging)
  voltage: sensor.battery_voltage        # V
  current: sensor.battery_current        # A
  temperature: sensor.battery_temp       # any unit
  time_to_go: sensor.battery_time_to_go  # seconds
  consumed_ah: sensor.battery_consumed_amp_hours  # negative Ah deficit from full
  state: sensor.battery_state            # used only if `power` is unset
solar:
  name: Solar
  icon: mdi:solar-panel
  power: sensor.pv_power
  state: sensor.solar_charger_state      # e.g. bulk / absorption / float
  mode: switch.solar_charger_enabled     # optional tap target (more-info)
  input_voltage: sensor.pv_voltage       # panel voltage, shown as "N V in"
alternator:                              # relabel freely (grid / generator / shore)
  name: Alternator
  icon: mdi:engine
  power: sensor.alternator_power
  state: sensor.dcdc_charger_state
  mode: switch.dcdc_charger_enabled      # optional tap target (more-info)
  input_voltage: sensor.starter_battery_voltage
inverter:
  name: Inverter
  icon: mdi:sine-wave
  power: sensor.ac_loads_power           # AC load wattage
  state: sensor.inverter_state           # drives flow direction (see below)
  mode: select.inverter_mode             # optional tap target (more-info)
```

### Options

| Node | Key | Meaning |
|------|-----|---------|
| **battery** *(required)* | `soc` | State of charge (%) |
| | `power` | Power in W, **signed** (− = discharging). Drives the Charging/Discharging/Idle label. |
| | `voltage` / `current` / `temperature` | Shown in the battery's detail line |
| | `time_to_go` | Victron discharge time in seconds; rendered like `9d 23h` while discharging |
| | `consumed_ah` | Signed consumed Ah (negative deficit from full). With `current` in net battery amps (positive when charging), shows `≈ 2h 30m to full` while charging. |
| | `state` | Fallback status label when `power` is not set |
| **solar / alternator** *(optional)* | `power` | Wattage (line is "active" when > 0) |
| | `state` | State / charge stage label |
| | `input_voltage` | Source voltage, shown as `N V in` |
| **inverter** *(optional)* | `power` | AC load wattage |
| | `state` | Charge/invert state — controls flow direction |
| | `mode` | Optional `select` / `switch` entity used as the tap target |

Every node also accepts `name` and `icon`.

### Flow direction

Sources (solar, alternator) flow **into** the battery whenever their power is
> 0. The inverter line is bidirectional, driven by its `state`:

- **Charging** (`bulk`, `absorption`, `float`, `charging`, …) → flows **into**
  the battery (AC → DC).
- **Inverting** (`inverting`, `power_assist`, `discharging`, …) or any positive
  AC load → flows **out** of the battery (DC → AC).

## Theming

Override any of these CSS variables (e.g. via `card_mod` or a theme):

```
--vpf-bg            --vpf-node-bg           --vpf-hdr
--vpf-fg            --vpf-node-border       --vpf-muted
--vpf-accent        --vpf-node-hover        --vpf-sub
--vpf-line-on       --vpf-node-bg-hover     --vpf-sub-dim
--vpf-line-off      --vpf-dot
```

## Notes

- Designed and tested against a Victron system (Cerbo GX, MultiPlus, BMV,
  BlueSolar MPPT, Orion DC-DC), but works with **any** entities — it's just
  power/voltage/state sensors.
- The card *type* is `custom:van-power-flow-card`.

## License

[MIT](LICENSE)

### Charging time estimate

The battery timer switches to an approximate time to full when net battery power
is positive. Configure `battery.consumed_ah` and `battery.current` from the same
battery monitor: `-consumed_ah / current` gives hours at the present net charge
rate, including the effect of running loads. Zero or near-zero current and
unavailable or invalid sensor values display `—`; a full battery displays `Full`.
The estimate assumes the present rate continues. Charge taper, charge losses,
changes in solar output or loads, and monitor calibration affect the actual time.
Victron's discharge time-to-go remains in use when discharging and is measured
to its configured discharge floor. No HA helper or restart is required.

Run all regression checks with `node --test *.test.mjs`.

### Manual deployment

For an unreleased version, copy `van-power-flow-card.js` from this repository to
your Home Assistant `config/www/` directory and register it as a JavaScript Module
at `/local/van-power-flow-card.js?v=1.3.0`. When replacing an existing manual
installation, update its resource URL's version query and refresh your browser.
The charging timer, tap/hold controls and animation fixes are all in this file;
no separate van-specific variant is required.
