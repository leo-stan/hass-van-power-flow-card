# Optional charging automations

The power-flow card works without these files. Use them only if you want Home
Assistant to manage charging; if you already have storage/protection automations,
connect their existing helpers to the card instead.

The optional blueprint runs in HA, even when the dashboard/browser is closed.
It is independent of charger brands: you select measurements and explicit
shutdown/recovery actions in HA's automation editor.

## Install

1. If you don't already have equivalent helpers, copy [helpers.yaml](helpers.yaml)
   into your HA packages directory (with packages enabled). Check configuration
   and restart HA to create the helpers. It creates no device-control actions.
   Alternatively create the five input booleans via **Settings → Devices &
   services → Helpers**, without `initial` values, and choose those in step 3.
2. Import [the automation blueprint](../../blueprints/automation/battery-management.yaml)
   through **Settings → Automations & scenes → Blueprints → Import Blueprint**.
   Use its GitHub file URL after this version is published.
3. Create one automation from it. Select your storage and protection toggles and
   the three separate internal state helpers. Never use the same helper for two
   roles, and don't share state helpers across multiple batteries/controllers.
4. Select **your temperature sensor** from the picker: a BMS, battery probe,
   MultiPlus sensor, etc. It must report `°C` or `°F`; no device-class filter hides
   sensors without a temperature class. Select SoC (%) for storage mode. Unused
   measurement selectors can be left empty when their corresponding feature is
   disabled; enabling it without a valid measurement inhibits charging.
5. Configure **Prevent charging** and **Allow charging again** actions for all
   chargers. For example, switch solar and alternator charging off/on and select
   your inverter/charger's noncharging/charging mode. This can be `off`,
   `inverter_only`, a current limit, or a dedicated inhibit input as appropriate
   for your equipment. The blueprint doesn't guess these settings. You can call
   your own scripts from these action selectors.
6. Optionally select the charger control entities to watch, so a manual change
   while inhibited triggers enforcement immediately. The minute watchdog also
   retries shutdown actions. Use idempotent actions (set off, never toggle).
   Arrange independent shutdowns to continue after an individual device failure.
7. With both feature toggles **off**, confirm normal device settings and test your
   configured actions safely. Then enable whichever features you want.

### What it does

- Storage mode: defaults to stopping at **55%** and resuming at **45%**. The
  holding flag restores across restarts, so values inside the band don't reset
  the charge cycle. Invalid SoC or inverted thresholds inhibit charging while
  storage mode is enabled.
- Cold protection: defaults to stopping below **0°C / 32°F** and releasing at
  **2.3°C / approximately 36°F**. Fahrenheit measurements are converted to Celsius
  automatically. Both limits are configurable in the blueprint UI.
- Missing, nonnumeric/nonfinite, or incorrectly unit-labelled temperature data
  inhibits charging while cold protection is enabled. An invalid recovery limit
  also inhibits charging. Plausible but stale readings cannot be detected.
- Both features work independently. Cold protection takes priority over storage
  and any optional full-charge/calibration helper.
- You may select an existing calibration helper to bypass the storage band;
  scheduling full charges is left to your existing calibration automation. This
  blueprint does not schedule calibration or infer a battery manufacturer's
  balancing requirements.
- With neither feature enabled and no prior inhibition, it does nothing. When a
  previous inhibition clears (including an explicit override disabling the last
  feature), it runs your **Allow charging again** actions once. Those are the
  recovery settings **you configured**, not an automatic snapshot of arbitrary
  device states. To preserve custom modes/manual-off choices, supply your own
  snapshot/restore controller scripts as the two action sequences.
- A persistent inhibition flag is set before shutdown, and only cleared after
  recovery actions succeed. Device command acknowledgement alone doesn't prove
  physical charging has stopped; verify current/device feedback for your setup.

Don't run this controller alongside another independent controller managing the
same chargers. Any other automation which enables charging should go through
your shared inhibit/allow scripts; HA can only correct a direct manual enable
after it sees the change (or on the next watchdog tick).

This is a software interlock, dependent on HA, the selected sensor and device
communications. It cannot guarantee the actual battery cell temperature or
replace an appropriate BMS/hardware charge inhibit. Verify thresholds with your
battery specification and choose a sensor physically representative of the cells.

## Card configuration

Merge either or both sections into your existing card:

```yaml
storage_mode:
  entity: input_boolean.vpf_storage_mode
  status: sensor.vpf_storage_status
cold_protection:
  entity: input_boolean.vpf_cold_protection
  status: sensor.vpf_cold_status
  blocked: input_boolean.vpf_cold_blocked
  temperature: sensor.your_selected_temperature
```

Choose the **same temperature entity** in the automation and card. The card's
field is a readout; changing it doesn't reconfigure the automation's enforcement
source. Controls are also available in the card's visual editor.

HACS installs the card, not this optional helper package or blueprint. Removing
the card does not disable the server-side automation; remove/disable the
automation explicitly if retiring the controller.
