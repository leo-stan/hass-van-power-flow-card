# Van Power Flow Card

A bespoke Victron-style power-flow Lovelace card for the van's Home Assistant.

Fixed 4-node layout purpose-built for a DC van electrical system:

- **Solar** and **Alternator** on the left feed the **Battery** in the middle.
- **Battery** ↔ **Inverter / Charger** on the right (the only bidirectional link).
- AC loads are shown as the inverter's wattage; DC watts live inside the battery.
- Each node shows its Victron charge state (off / bulk / absorption / float / …).
- Animated direction dots run on every active line.

Vanilla JS, no build step. Single file: `van-power-flow-card.js`.

## Usage

Register `van-power-flow-card.js` as a dashboard resource (module), then:

```yaml
type: custom:van-power-flow-card
title: Victron System
```

All entity IDs default to this van's Victron setup; override per-node
(`solar`, `alternator`, `battery`, `inverter`) as needed. See the top of
`van-power-flow-card.js` for the configurable keys.
