import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';
let Card;
const context = { HTMLElement: class {}, window: {}, console: { info() {} },
  customElements: { define(name, ctor) { if (name === 'van-power-flow-card') Card = ctor; } } };
vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL('./van-power-flow-card.js', import.meta.url), 'utf8'), context);
const card = new Card();
card.setConfig({ battery: {} });
assert.equal(card._featuresHTML(), '');
card.setConfig({ battery: {}, cold_protection: {} });
assert.equal(card._featuresHTML(), '', 'empty editor sections stay hidden');
assert.throws(() => card.setConfig({ battery: {}, cold_protection: { entity: 'sensor.temp' } }));
card.setConfig({battery:{},storage_mode:{entity:'input_boolean.storage',status:'sensor.storage_status',next_full_charge:'sensor.next',last_full_charge:'sensor.last'},
  cold_protection:{entity:'switch.protection',status:'sensor.status',temperature:'sensor.temp',blocked:'binary_sensor.blocked'}});
assert.equal(card.getCardSize(), 8);
assert.equal((card._featuresHTML().match(/data-feature=/g)||[]).length, 2);
function row() {
  const parts = new Map();
  return { querySelector(selector) { if(!parts.has(selector)) parts.set(selector, {textContent:'', attributes:{}, setAttribute(k,v){this.attributes[k]=v;}});return parts.get(selector); } };
}
const storage=row(), cold=row();card._features=[['storage_mode',storage],['cold_protection',cold]];
let complete;
const calls=[];
card._hass={states:{'input_boolean.storage':{state:'off'},'switch.protection':{state:'on'},
  'sensor.storage_status':{state:'Off — normal charging'},'sensor.next':{state:'—'},'sensor.last':{state:'Nov 3, 4:00 PM'},
  'sensor.status':{state:'Protected'},'sensor.temp':{state:'3',attributes:{unit_of_measurement:'°C'}},
  'binary_sensor.blocked':{state:'on'}}, callService(...args){calls.push(args);return new Promise(resolve=>{complete=resolve;});}};
card._updateFeatures();
assert.equal(storage.querySelector('.feature-status').textContent,'Off — normal charging');
assert.equal(storage.querySelector('.feature-next').textContent,'Next full charge: —');
assert.equal(storage.querySelector('.feature-last').textContent,'Last 100%: Nov 3, 4:00 PM');
card._hass.states['sensor.last'].state='unavailable';card._updateFeatures();
assert.equal(storage.querySelector('.feature-last').textContent,'Last 100%: Unavailable');
assert.equal(cold.querySelector('.feature-detail').textContent,'Charging blocked · 3°C');
assert.equal(cold.querySelector('button').attributes['aria-checked'],'true');
const pending=card._toggleFeature('cold_protection');
assert.equal(cold.querySelector('button').disabled,true);
await card._toggleFeature('cold_protection');
assert.equal(calls.length,1,'double clicks do not send duplicate calls');
assert.equal(calls[0][0],'switch');assert.equal(calls[0][1],'turn_off');
complete();await pending;
assert.equal(cold.querySelector('button').attributes['aria-checked'],'true','no optimistic safety-state changes');
card._hass.callService=async()=>{throw new Error('Denied');};
await card._toggleFeature('storage_mode');
assert.match(storage.querySelector('.feature-error').textContent,/Denied/);
card._hass.states['switch.protection'].state='unavailable';card._updateFeatures();
assert.equal(cold.querySelector('button').disabled,true);
assert.equal(cold.querySelector('.feature-status').textContent,'Control unavailable');
card._hass.states['switch.protection'].state='on';
delete card._hass.states['sensor.status'];delete card._hass.states['sensor.temp'];card._updateFeatures();
assert.equal(cold.querySelector('.feature-status').textContent,'Status unavailable');
assert.match(cold.querySelector('.feature-detail').textContent,/Temperature unavailable/);
console.log('Optional feature configuration, status, units, service calls, pending and failure checks passed');
