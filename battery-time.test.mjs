import vm from 'node:vm';import fs from 'node:fs';import assert from 'node:assert/strict';
let Card;const context={HTMLElement:class{},customElements:{define:(name,c)=>{if(name==='van-power-flow-card')Card=c;}},window:{},console:{info(){}}};vm.createContext(context);vm.runInContext(fs.readFileSync(new URL('./van-power-flow-card.js',import.meta.url),'utf8'),context);
const card=Object.create(Card.prototype);card._config={battery:{power:'p',current:'i',consumed_ah:'ah',soc:'soc',time_to_go:'ttg'}};
const tests=[
 ['net charge',650,50,-150,50,'unavailable','≈ 3h 0m to full'],
 ['load reduces charge',325,25,-150,50,9999,'≈ 6h 0m to full'],
 ['discharging',-130,-10,-150,50,7200,'2h 0m'],
 ['idle',0,0,-150,50,7200,'—'],
 ['full charging',10,.8,0,100,'unavailable','Full'],
 ['full idle',0,0,0,100,'unavailable','Full'],
 ['unavailable current',650,'unavailable',-150,50,7200,'—'],
 ['unknown deficit',650,50,'unknown',50,7200,'—'],
 ['invalid power','unavailable',50,-150,50,7200,'—'],
 ['zero current',650,0,-150,50,7200,'—'],
 ['near zero current',1,.05,-150,50,7200,'—'],
 ['wrong current sign',650,-50,-150,50,7200,'—'],
 ['positive deficit',650,50,150,50,7200,'—'],
 ['under a minute',650,50,-.1,99.9,7200,'≈ <1m to full'],
 ['no time to go',-130,-10,-150,50,'unavailable','—'],
 ['infinite current',650,'Infinity',-150,50,7200,'—'],
 ['negative soc',650,50,-150,-1,7200,'—'],
];
for(const [label,p,i,ah,soc,ttg,expected]of tests){card._hass={states:Object.fromEntries(Object.entries({p,i,ah,soc,ttg}).map(([id,state])=>[id,{state:String(state)}]))};assert.equal(card._batteryTime().text,expected,label);}
console.log(`${tests.length} battery timing cases passed`);
