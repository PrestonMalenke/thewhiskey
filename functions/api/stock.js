const headers={"content-type":"application/json","cache-control":"no-store"};
const respond=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
const inventory=[2,2,1,2,2,1,2,1,2,2,1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,6,6,6,6,6,6,3,3,2,2,1,1];
async function dbFor(env){
 if(!env.STOCK_DB)throw new Error("Missing Cloudflare D1 binding STOCK_DB");
 await env.STOCK_DB.prepare("CREATE TABLE IF NOT EXISTS counts (id INTEGER PRIMARY KEY, needed INTEGER NOT NULL DEFAULT 0, grabbed INTEGER NOT NULL DEFAULT 0)").run();
 return env.STOCK_DB;
}
async function state(db){
 const {results}=await db.prepare("SELECT id,needed,grabbed FROM counts").all();
 const needed={},grabbed={};
 for(let i=0;i<inventory.length;i++){needed[i]=0;grabbed[i]=0}
 for(const row of results){if(row.id>=0&&row.id<inventory.length){needed[row.id]=row.needed;grabbed[row.id]=row.grabbed}}
 return {needed,grabbed};
}
const valid=(v,max)=>Number.isInteger(v)&&v>=0&&v<=max;
export async function onRequest({request,env}){
 try{
  const db=await dbFor(env), method=request.method;
  if(method==="GET")return respond(await state(db));
  if(method==="PUT"){
   const payload=await request.json();
   if(!payload||typeof payload.needed!=="object"||!payload.needed||Array.isArray(payload.needed))return respond({error:"Invalid needed list"},400);
   const current=await state(db),ops=[];
   for(let i=0;i<inventory.length;i++){
    const value=payload.needed[i];
    if(!valid(value,inventory[i]))return respond({error:"Invalid count for item "+i},400);
    ops.push(db.prepare("INSERT INTO counts (id, needed, grabbed) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET needed=excluded.needed, grabbed=MIN(counts.grabbed,excluded.needed)").bind(i,value,Math.min(current.grabbed[i],value)));
   }
   await db.batch(ops);return respond(await state(db));
  }
  if(method==="PATCH"){
   const payload=await request.json(),id=payload?.id,value=payload?.grabbed;
   if(!Number.isInteger(id)||id<0||id>=inventory.length||!valid(value,inventory[id]))return respond({error:"Invalid grabbed count"},400);
   await db.prepare("INSERT INTO counts (id,needed,grabbed) VALUES (?,0,0) ON CONFLICT(id) DO NOTHING").bind(id).run();
   const result=await db.prepare("UPDATE counts SET grabbed=? WHERE id=? AND needed>=?").bind(value,id,value).run();
   if(result.meta.changes===0)return respond({error:"Grabbed exceeds current Needed; reload list"},409);
   return respond(await state(db));
  }
  if(method==="POST"){
   const payload=await request.json();
   if(payload?.reset==="needed")await db.prepare("UPDATE counts SET needed=0,grabbed=0").run();
   else if(payload?.reset==="grabbed")await db.prepare("UPDATE counts SET grabbed=0").run();
   else return respond({error:"Unknown reset"},400);
   return respond(await state(db));
  }
  return respond({error:"Method not allowed"},405);
 }catch(e){return respond({error:e?.message||"Server error"},500)}
}
