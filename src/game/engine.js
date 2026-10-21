export const RULES={collectMs:30000,battleMs:180000,baseHp:1000,spawnMs:1050,visibleMs:1250,maxUnits:24};
export const unitStats=id=>({hp:120+(id%5)*22,atk:22+(id%6)*5,speed:3+(id%4)*.6,cost:30+(id%5)*10});
/** @returns {{name:string,ready:boolean,roster:number[],energy:number,base:number,wild:Array<{key:number,id:number,slot:number,expires:number}>,caught:number[],cooldown:number}} */
const player=name=>({name,ready:false,roster:[],energy:80,base:RULES.baseHp,wild:[],caught:[],cooldown:0});
export function createGame(name='탐험가',now=Date.now()){return {pool:Array.from({length:30},(_,id)=>id),phase:'waiting',effects:[],players:[player(name)],units:[],winner:null,reason:'',started:0,deadline:0,nextSpawn:0,seq:0,now};}
export function addPlayer(g,name){if(g.phase!=='waiting'||g.players.length!==1)throw Error('입장할 수 없는 방입니다.');g.players.push(player(name));}
export function finish(g,winner,reason){if(g.phase==='ended')return;g.phase='ended';g.winner=winner;g.reason=reason;g.units=[];if(winner!==null){g.players[1-winner].roster=[];}}
export function action(g,side,msg,now=Date.now()){
 const p=g.players[side];if(!p)throw Error('참가자가 아닙니다.');
 if(msg.type==='ready'&&g.phase==='waiting'){p.ready=true;if(g.players.length===2&&g.players.every(x=>x.ready)){g.phase='collect';g.started=now;g.deadline=now+RULES.collectMs;g.nextSpawn=now;}return;}
 if(msg.type==='catch'&&g.phase==='collect'&&now<g.deadline){const w=p.wild.find(x=>x.key===msg.key&&x.expires>now);if(!w)throw Error('이미 숨어 버렸어요.');p.wild=p.wild.filter(x=>x.key!==w.key);p.roster.push(w.id);p.caught.push(w.id);return;}
 if(msg.type==='summon'&&g.phase==='battle'){
  const index=p.roster.indexOf(msg.id);const st=unitStats(msg.id);
  if(index<0||p.energy<st.cost||p.cooldown>now||g.units.filter(u=>u.side===side).length>=RULES.maxUnits)throw Error('보급이나 출격 공룡을 확인해 주세요.');
  p.roster.splice(index,1);p.energy-=st.cost;p.cooldown=now+450;g.units.push({key:++g.seq,id:msg.id,side,x:side===0?10:90,hp:st.hp,maxHp:st.hp,atk:st.atk,speed:st.speed,nextAttack:now+500,spawnedAt:now,attackUntil:0,hitUntil:0,attackSeq:0,moving:true});return;
 }
 if(msg.type==='surrender'&&['collect','battle'].includes(g.phase)){finish(g,1-side,'상대가 항복했습니다.');return;}
 throw Error('지금은 이 행동을 할 수 없습니다.');
}
export function tick(g,now=Date.now(),rng=Math.random){
 g.effects=(g.effects||[]).filter(e=>e.expires>now);
 const dt=Math.min(.25,Math.max(0,(now-g.now)/1000));g.now=now;
 if(g.phase==='collect'){
  for(const p of g.players)p.wild=p.wild.filter(w=>w.expires>now);
  if(now>=g.deadline){g.phase='battle';g.started=now;g.deadline=now+RULES.battleMs;for(const p of g.players)p.wild=[];return;}
  if(now>=g.nextSpawn){for(const p of g.players){p.wild.push({key:++g.seq,id:g.pool[Math.floor(rng()*g.pool.length)],slot:Math.floor(rng()*6),expires:now+RULES.visibleMs});p.wild=p.wild.slice(-3);}g.nextSpawn=now+RULES.spawnMs;}
 }
 if(g.phase==='battle'){
  for(const p of g.players)p.energy=Math.min(160,p.energy+dt*12);
  const damages=new Map();const baseDamage=[0,0];
  const effect=(type,x,side,id=0)=>g.effects.push({key:++g.seq,type,x,side,id,expires:now+(type==='defeat'?650:380)});
  for(const u of g.units){if(u.hp<=0)continue;const direction=u.side===0?1:-1;
   const targets=g.units.filter(e=>e.side!==u.side&&e.hp>0&&Math.abs(e.x-u.x)<7);const target=targets.sort((a,b)=>Math.abs(a.x-u.x)-Math.abs(b.x-u.x))[0];
   const atBase=u.side===0?u.x>=88:u.x<=12;
   if(target||atBase){u.moving=false;if(now>=u.nextAttack){u.nextAttack=now+900;u.attackUntil=now+330;u.attackSeq=(u.attackSeq||0)+1;if(target){damages.set(target.key,(damages.get(target.key)||0)+u.atk);target.hitUntil=now+260;effect('hit',(u.x+target.x)/2,u.side);}else{baseDamage[1-u.side]+=u.atk;effect('base',u.side===0?91:9,u.side);}}}
   else {u.moving=true;u.x=Math.max(10,Math.min(90,u.x+direction*u.speed*dt));}
  }
  for(const u of g.units){u.hp-=damages.get(u.key)||0;if(u.hp<=0)effect('defeat',u.x,u.side,u.id);}
  g.units=g.units.filter(u=>u.hp>0);g.players.forEach((p,i)=>p.base=Math.max(0,p.base-baseDamage[i]));
  const dead=g.players.map(p=>p.base<=0);if(dead.some(Boolean)){finish(g,dead.every(Boolean)?null:dead[0]?1:0,'고인돌이 무너졌습니다.');return;}
  if(now>=g.deadline){finish(g,null,'제한시간 종료 · 무승부');return;}
  if(g.players.every(p=>!p.roster.length)&&!g.units.length)finish(g,null,'모든 공룡 소진 · 무승부');
 }
}
// Hide uncaught species from the opponent and never publish session tokens.
export function snapshot(g,side){return {...g,players:g.players.map((p,i)=>({...p,wild:i===side?p.wild:[],roster:i===side?p.roster:[],caught:i===side?p.caught:[],rosterCount:p.roster.length,caughtCount:p.caught.length}))};}
