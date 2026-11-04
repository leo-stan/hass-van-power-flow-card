# Validation

Tested on the van's Home Assistant Core 2026.9.3 on November 3, 2026.

- All Node regression suites pass, including optional controls, service failure,
  unavailable entities, custom temperature units, duplicate-click suppression,
  and leaving features unconfigured.
- The blueprint was saved and substituted by HA's blueprint API. An automation
  created from it ran against disposable boolean/number helpers standing in for
  chargers and sensors. No test changed a real sensor value or controlled a real
  charger.
- Celsius tests: inhibit below 0°C, retain lockout at 1°C, release at 2.3°C.
- Fahrenheit tests: inhibit at 30°F, retain at 33°F, release at 36.2°F.
- Storage tests: hold at 55%, retain hold at 50%, release at 45%.
- Priority tests: disabling storage doesn't release a cold lockout; a calibration
  helper bypasses a storage hold but cannot bypass cold protection.
- Missing temperature with protection enabled inhibits charging. Explicitly
  disabling protection releases its lockout when storage doesn't require a hold.
- Both features off leaves an otherwise uninhibited charger alone.
- The live van card uses the van's existing production controller/helpers. Its
  cold switch was exercised off/on at a warm temperature and verified against
  actual HA state; it was left enabled. The storage switch was read-only during
  that UI test to avoid an unnecessary real charger shutdown.
- Chrome screenshots were inspected on desktop and at 390px viewport width.
  The visual-editor schema exposes both optional sections and an unrestricted
  sensor-domain temperature selector.

The test automation, blueprint and disposable helpers were removed afterward.
The portable blueprint was not installed as a second production charger
controller. Field testing actual battery cold shutdown and restart behavior
remains the installer's responsibility for their selected equipment.

Run local checks:

```sh
node --test *.test.mjs
python3 -m unittest discover -s tests
```

The Python decision-template checks require PyYAML and Jinja2.
