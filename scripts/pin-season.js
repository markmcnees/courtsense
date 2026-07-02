'use strict';
// Pin currentSeasonId='2026' at config for live school roots.
// DRY-RUN default. LIVE_WRITE_ENABLED must be true AND --live passed to write.
const LIVE_WRITE_ENABLED = false;
const https = require('https');
const BASE = 'https://leon-beach-volleyball-default-rtdb.firebaseio.com';
const ROOTS = ['leon_queens_matches','south_walton_matches'];
const SEASON = '2026';
const wantLive = process.argv.includes('--live');
const DRY = !(LIVE_WRITE_ENABLED && wantLive);
function getJson(url){return new Promise((res,rej)=>{https.get(url,r=>{let b='';r.on('data',d=>b+=d);r.on('end',()=>{if(r.statusCode!==200)return rej(new Error('GET '+r.statusCode));res(b==='null'?null:JSON.parse(b));});}).on('error',rej);});}
function patchJson(url,obj){return new Promise((res,rej)=>{const data=JSON.stringify(obj);const u=new URL(url);const rq=https.request({hostname:u.hostname,path:u.pathname+u.search,method:'PATCH',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}},r=>{let b='';r.on('data',d=>b+=d);r.on('end',()=>{if(r.statusCode!==200)return rej(new Error('PATCH '+r.statusCode+' '+b));res(b);});});rq.on('error',rej);rq.write(data);rq.end();});}
(async()=>{
  console.log('PIN SEASON --', DRY?'DRY RUN (no writes)':'*** LIVE WRITE ***', '| season', SEASON);
  for(const root of ROOTS){
    const url = BASE+'/'+root+'/config/currentSeasonId.json';
    let cur; try{ cur = await getJson(url); }catch(e){ console.log('  '+root+': READ ERROR '+e.message); continue; }
    console.log('  '+root+': current config/currentSeasonId =', JSON.stringify(cur), cur===SEASON?'(already set)':'(will set -> '+SEASON+')');
    if(!DRY && cur!==SEASON){ await patchJson(BASE+'/'+root+'/config.json',{currentSeasonId:SEASON}); console.log('     -> wrote currentSeasonId='+SEASON); }
  }
  console.log('DONE', DRY?'(dry run, nothing written)':'(live write complete)');
})();
