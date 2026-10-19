import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {EventEmitter} from 'node:events';
import {Chess} from 'chess.js';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseEngineInfo} from './shared.mjs';

export class Stockfish {
  constructor(enginePath=process.env.STOCKFISH_PATH||(process.platform==='win32'?fileURLToPath(new URL('../Stockfish-19/stockfish/stockfish-windows-x86-64-universal.exe',import.meta.url)):'stockfish')) {
    this.enginePath=enginePath;
    this.events=new EventEmitter();
    this.serial=Promise.resolve();
    this.child=spawn(enginePath,[],{cwd:path.dirname(enginePath),windowsHide:true});
    this.reader=createInterface({input:this.child.stdout});
    this.reader.on('line',line=>this.events.emit('line',line));
    this.child.stderr.on('data',data=>{this.lastError=String(data);});
    this.child.on('error',error=>{this.failure=error;this.events.emit('failed',error);});
    this.child.on('exit',code=>{this.failure=new Error('Stockfish stopped ('+code+'). '+(this.lastError||''));this.events.emit('failed',this.failure);});
    this.ready=this.initialize();
    this.ready.catch(()=>{});
  }
  send(command) {if(this.failure)throw this.failure;this.child.stdin.write(command+'\n');}
  wait(predicate,timeout=20000) {
    if(this.failure)return Promise.reject(this.failure);
    return new Promise((resolve,reject)=>{
      const cleanup=()=>{clearTimeout(timer);this.events.off('line',onLine);this.events.off('failed',onFailure);};
      const onLine=line=>{if(predicate(line)){cleanup();resolve(line);}};
      const onFailure=error=>{cleanup();reject(error);};
      const timer=setTimeout(()=>{cleanup();reject(new Error('Stockfish did not respond.'));},timeout);
      this.events.on('line',onLine);this.events.once('failed',onFailure);
    });
  }
  async initialize() {
    let pending=this.wait(line=>line==='uciok');this.send('uci');await pending;
    for(const [name,value] of Object.entries({Threads:12,Hash:1024,MultiPV:4,UCI_LimitStrength:false,'Skill Level':20,UCI_ShowWDL:true}))this.send(`setoption name ${name} value ${value}`);
    pending=this.wait(line=>line==='readyok');this.send('isready');await pending;
  }
  enqueue(work) {
    const next=this.serial.catch(()=>{}).then(work);
    this.serial=next.catch(()=>{});
    return next;
  }
  async preload() {
    if(!this.preloading)this.preloading=this.enqueue(async()=>{
      await this.ready;
      const pending=this.wait(line=>line.startsWith('bestmove '));
      this.send('position startpos');this.send('go depth 6');await pending;
      return {ready:true,engine:'Stockfish 19',threads:12,hashMb:1024,lines:4};
    }).catch(error=>{this.preloading=null;throw error;});
    return this.preloading;
  }
  analyze(fen,timeMs,onUpdate,signal) {
    return this.enqueue(async()=>{
      await this.ready;
      if(signal.aborted)return;
      const lines=new Map();const pendingLines=new Map();const started=performance.now();let lastSent=0;
      const expectedLines=Math.min(4,new Chess(fen).moves().length);
      const publish=type=>onUpdate({type,elapsedMs:Math.round(performance.now()-started),lines:[...lines.values()].sort((a,b)=>a.rank-b.rank)});
      const onLine=line=>{
        const parsed=parseEngineInfo(line,fen);
        if(parsed){
          if(parsed.rank===1)pendingLines.clear();
          pendingLines.set(parsed.rank,parsed);
          if(pendingLines.size===expectedLines){
            lines.clear();for(const [rank,value] of pendingLines)lines.set(rank,value);
            const now=performance.now();if(now-lastSent>100){lastSent=now;publish('info');}
          }
        }
      };
      const onAbort=()=>{try{this.send('stop');}catch{}};
      this.events.on('line',onLine);signal.addEventListener('abort',onAbort,{once:true});
      try {
        const pending=this.wait(line=>line.startsWith('bestmove '),timeMs+10000);
        this.send('position fen '+fen);this.send('go movetime '+timeMs);
        const bestLine=await pending;
        const bestUci=bestLine.split(' ')[1];
        if(lines.get(1)?.moves[0]?.uci!==bestUci){
          const candidates=[...pendingLines.values(),...lines.values()];
          const best=candidates.filter(line=>line.moves[0]?.uci===bestUci).sort((a,b)=>b.moves.length-a.moves.length)[0];
          if(best){
            const chosen=[best];const seen=new Set([bestUci]);
            for(const line of [...lines.values(),...pendingLines.values()]){const root=line.moves[0]?.uci;if(root&&!seen.has(root)){seen.add(root);chosen.push(line);}}
            lines.clear();chosen.slice(0,4).forEach((line,index)=>lines.set(index+1,{...line,rank:index+1}));
          }
        }
        if(!signal.aborted)publish('done');
      } finally {this.events.off('line',onLine);signal.removeEventListener('abort',onAbort);}
    });
  }
  close(){try{this.send('quit');}catch{}this.child.kill();}
}
