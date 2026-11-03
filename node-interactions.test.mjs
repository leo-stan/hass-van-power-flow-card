import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const source = process.argv[2] || new URL('./van-power-flow-card.js', import.meta.url);
let Card;
let timerId = 0;
const timers = new Map();
const context = {
  HTMLElement: class {}, window: {}, console: { info() {} },
  customElements: { define(name, ctor) { if (name === 'van-power-flow-card') Card = ctor; } },
  setTimeout(callback, delay) { assert.equal(delay, 500); timers.set(++timerId, callback); return timerId; },
  clearTimeout(id) { timers.delete(id); },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(source, 'utf8'), context);
const calls = [];
const card = Object.create(Card.prototype);
card._config = {
  inverter: { mode: 'select.inverter', state: 'sensor.inverter_state' },
  solar: { mode: 'switch.solar', power: 'sensor.solar_power' },
  alternator: { mode: 'switch.alternator', power: 'sensor.alternator_power' },
  battery: { soc: 'sensor.battery_soc' },
};
card._moreInfo = id => calls.push(['controls', id]);
card._history = ids => calls.push(['history', ...ids.filter(Boolean)]);
function box(node) {
  const handlers = {};
  return { dataset: { node }, addEventListener(name, fn) { handlers[name] = fn; },
    fire(name) { handlers[name]?.(); } };
}
const nodes = Object.fromEntries(Object.keys(card._config).map(name => [name, box(name)]));
card._bindNodeInteractions(Object.values(nodes));
for (const name of ['inverter', 'solar', 'alternator']) {
  const node = nodes[name];
  calls.length = 0;
  node.fire('pointerdown'); node.fire('pointerup'); node.fire('click');
  assert.deepEqual(calls, [['controls', card._config[name].mode]], `${name} tap opens controls only`);
  assert.equal(timers.size, 0);

  calls.length = 0;
  node.fire('pointerdown');
  for (const [id, callback] of timers) { timers.delete(id); callback(); }
  node.fire('pointerup'); node.fire('click');
  assert.equal(calls.length, 1, `${name} hold fires once`);
  assert.equal(calls[0][0], 'history', `${name} hold opens history, not controls`);

  for (const event of ['pointerleave', 'pointercancel']) {
    calls.length = 0;
    node.fire('pointerdown'); node.fire(event);
    assert.equal(timers.size, 0, `${name} ${event} cancels timer`);
    assert.deepEqual(calls, []);
  }
}
calls.length = 0;
nodes.battery.fire('click');
assert.deepEqual(calls, [['history', 'sensor.battery_soc']], 'uncontrolled node tap keeps history');
console.log('13 node-interaction cases passed');
