import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Stockfish} from './engine.mjs';
import {validatePosition} from './shared.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const engine=new Stockfish();
const port=Number(process.env.CHESS_ANALYSIS_PORT||8765);
const origin='http://127.0.0.1:'+port;
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png','.onnx':'application/octet-stream','.json':'application/json'};
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
const server=http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,origin);
    if(req.headers.origin && req.headers.origin!==origin)return json(res,403,{error:'Open this tool at '+origin});
    if(url.pathname==='/api/health')return json(res,200,{app:'chess-screenshot-analyzer',ready:!engine.failure});
    if(url.pathname==='/api/preload' && req.method==='POST')return json(res,200,await engine.preload());
    if(url.pathname==='/api/analyze' && req.method==='POST') {
      let body='';for await(const chunk of req){body+=chunk;if(body.length>4096)return json(res,413,{error:'Position is too large.'});}
      const input=JSON.parse(body);const fen=validatePosition(input.fen);
      const timeMs=Math.max(1000,Math.min(60000,Number(input.timeMs)||5000));
      const cancellation=new AbortController();
      res.on('close',()=>{if(!res.writableEnded)cancellation.abort();});
      res.writeHead(200,{'Content-Type':'application/x-ndjson','Cache-Control':'no-store'});res.flushHeaders();
      await engine.analyze(fen,timeMs,update=>{if(!res.destroyed)res.write(JSON.stringify(update)+'\n');},cancellation.signal);
      return res.end();
    }
    if(req.method!=='GET')return json(res,405,{error:'Unsupported request.'});
    const dist=path.resolve(root,'dist');
    const file=path.resolve(dist,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
    if(!file.startsWith(dist+path.sep))return json(res,403,{error:'Invalid path.'});
    if(!fs.existsSync(file)||!fs.statSync(file).isFile())return json(res,404,{error:'Not found.'});
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':url.pathname.startsWith('/assets/')?'public, max-age=31536000, immutable':'no-cache'});
    fs.createReadStream(file).pipe(res);
  } catch(error) {if(!res.headersSent)json(res,400,{error:error.message});else{if(!res.destroyed)res.end(JSON.stringify({type:'error',error:error.message})+'\n');}}
});
server.listen(port,'127.0.0.1',()=>console.log('Chess screenshot analyzer ready at '+origin));
server.on('error',error=>{console.error(error.message);engine.close();process.exitCode=1;});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{engine.close();server.close();});
