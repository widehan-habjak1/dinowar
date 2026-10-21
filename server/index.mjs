import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createGame,addPlayer,action,tick,finish,snapshot} from '../src/game/engine.js';
export function createGameServer(){
 const rooms=new Map(),sessions=new Map(),streams=new Map();
 const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
 const publish=room=>{room.tokens.forEach((t,i)=>{for(const res of streams.get(t)||[])res.write(`data: ${JSON.stringify({code:room.code,side:i,game:snapshot(room.game,i)})}\n\n`);});};
 const server=http.createServer(async(req,res)=>{
  const origin=req.headers.origin;const allowed=(process.env.ALLOWED_ORIGINS||'').split(',').filter(Boolean);
  if(origin){const u=new URL(origin);const local=['localhost','127.0.0.1',req.headers.host?.split(':')[0]].includes(u.hostname);if(!local&&!allowed.includes(origin)){send(res,403,{error:'허용되지 않은 사이트입니다.'});return;}res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
  const url=new URL(req.url,'http://local');if(url.pathname==='/api/health'){send(res,200,{ok:true});return;}
  const token=(req.headers.authorization||'').replace('Bearer ','')||url.searchParams.get('token');const session=sessions.get(token);
  if(url.pathname==='/api/events'&&req.method==='GET'){
   if(!session){send(res,401,{error:'방에 다시 입장해 주세요.'});return;}
   const room=rooms.get(session.code);if(!room){send(res,410,{error:'만료된 방입니다.'});return;}
   res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'});res.write(': connected\n\n');const group=streams.get(token)||new Set();group.add(res);streams.set(token,group);session.disconnectedAt=null;publish(room);req.on('close',()=>{group.delete(res);if(!group.size)session.disconnectedAt=Date.now();});return;
  }
  if(req.method!=='POST'){send(res,404,{error:'경로를 찾을 수 없습니다.'});return;}
  try{
   let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>2048){send(res,413,{error:'요청이 너무 큽니다.'});return;}}const body=JSON.parse(raw||'{}');
   const name=typeof body.name==='string'?body.name.trim().slice(0,16)||'탐험가':'탐험가';
   if(url.pathname==='/api/create'||url.pathname==='/api/join'){
    // Limit abandoned rooms and sessions on this small in-memory game server.
    if(rooms.size>=500)throw Error('서버가 혼잡합니다. 잠시 후 다시 시도하세요.');let room;
    if(url.pathname==='/api/create'){let code;do{code=randomBytes(3).toString('hex').toUpperCase();}while(rooms.has(code));room={code,game:createGame(name),tokens:[],created:Date.now()};rooms.set(code,room);}
    else {room=rooms.get(String(body.code||'').trim().toUpperCase());if(!room)throw Error('방 코드를 확인해 주세요.');addPlayer(room.game,name);}
    const side=room.tokens.length;const t=randomBytes(24).toString('hex');room.tokens.push(t);sessions.set(t,{code:room.code,side,lastAction:0,disconnectedAt:Date.now()});send(res,200,{token:t,code:room.code,side,game:snapshot(room.game,side)});publish(room);return;
   }
   if(!session){send(res,401,{error:'다시 입장해 주세요.'});return;}const room=rooms.get(session.code);if(!room)throw Error('만료된 방입니다.');
   if(url.pathname==='/api/action'){const now=Date.now();if(now-session.lastAction<60)throw Error('조금 천천히 눌러 주세요.');session.lastAction=now;tick(room.game,now);action(room.game,session.side,body,now);publish(room);send(res,200,{ok:true});return;}
   if(url.pathname==='/api/leave'){if(['collect','battle'].includes(room.game.phase))finish(room.game,1-session.side,'상대가 방을 떠났습니다.');else if(room.game.phase==='waiting')finish(room.game,null,'참가자가 방을 떠났습니다. 새 방을 만들어 주세요.');publish(room);send(res,200,{ok:true});return;}
   send(res,404,{error:'잘못된 요청입니다.'});
  }catch(e){send(res,400,{error:e.message||'요청을 처리할 수 없습니다.'});}
 });
 const timer=setInterval(()=>{const now=Date.now();for(const room of rooms.values()){
  for(const token of room.tokens){const s=sessions.get(token);if(s.disconnectedAt&&now-s.disconnectedAt>20000&&['collect','battle'].includes(room.game.phase))finish(room.game,1-s.side,'상대 연결이 20초 이상 끊겼습니다.');}
  tick(room.game,now);publish(room);
  if(now-room.created>30*60*1000){for(const t of room.tokens){for(const res of streams.get(t)||[])res.end();streams.delete(t);sessions.delete(t);}rooms.delete(room.code);}
 }},100);timer.unref();server.on('close',()=>clearInterval(timer));return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const port=Number(process.env.PORT)||3001;createGameServer().listen(port,'0.0.0.0',()=>console.log(`Game server http://localhost:${port}`));}
