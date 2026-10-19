import {useCallback,useEffect,useRef,useState} from 'react';
import {Chess,type Square} from 'chess.js';
import {flipPlacement,inferCastling,placementToFen,type BoardScanResult} from '@scoriiu/fenshot';
import {createBoardRecognizer} from './recognizer';
import {orientImage,validatePosition,applyLegalMove} from '../shared.mjs';
import {Board} from './Board';
import modelUrl from '@scoriiu/fenshot/model/chess-tiles-v2.onnx?url';
import ortMjsUrl from './ort/ort-wasm-simd-threaded.mjs?url';
import ortWasmUrl from './ort/ort-wasm-simd-threaded.wasm?url';

const recognizer=createBoardRecognizer({modelUrl,wasmPaths:{mjs:ortMjsUrl,wasm:ortWasmUrl}});
type Position={raw:string;placement:string;bottom:'w'|'b';turn:'w'|'b';autoTurn:boolean;castle:string;ep:string;halfmove:number;fullmove:number;imageUrl:string;scan:BoardScanResult|null;trusted:boolean;recognitionMs:number;uncertain:boolean;edited:boolean;lastMove:string};
type Promotion='q'|'r'|'b'|'n';
type PendingPromotion={fen:string;from:string;to:string};
type Line={rank:number;score:number;scoreType:'cp'|'mate';depth:number;moves:{san:string;uci:string;fen:string}[]};
type Analysis={type:'idle'|'working'|'info'|'done'|'error';lines:Line[];elapsedMs:number;error?:string};
const emptyAnalysis:Analysis={type:'idle',lines:[],elapsedMs:0};
const colorName=(color:'w'|'b')=>color==='w'?'White':'Black';
const scoreText=(line:Line)=>line.scoreType==='mate'?`${line.score>=0?'+':'−'}M${Math.abs(line.score)}`:`${line.score>=0?'+':''}${(line.score/100).toFixed(2)}`;
function updateFromFen(position:Position,fen:string,lastMove=''):Position{
  const [placement,turn,castle,ep,halfmove,fullmove]=fen.split(' ');
  return {...position,placement,turn:turn as 'w'|'b',castle:castle==='-'?'':castle,ep,halfmove:Number(halfmove),fullmove:Number(fullmove),autoTurn:false,edited:true,lastMove,uncertain:false};
}

export default function App(){
  const [position,setPosition]=useState<Position|null>(null);
  const [scanning,setScanning]=useState(false);
  const [scanError,setScanError]=useState('');
  const [preloadState,setPreloadState]=useState<'idle'|'loading'|'ready'|'error'>('idle');
  const [preloadError,setPreloadError]=useState('');
  const [analysis,setAnalysis]=useState<Analysis>(emptyAnalysis);
  const [timeMs,setTimeMs]=useState(5000);
  const [paused,setPaused]=useState(false);
  const [analysisRun,setAnalysisRun]=useState(0);
  const [preview,setPreview]=useState<{fen:string;label:string}|null>(null);
  const [history,setHistory]=useState<Position[]>([]);
  const [initialPosition,setInitialPosition]=useState<Position|null>(null);
  const [pendingPromotion,setPendingPromotion]=useState<PendingPromotion|null>(null);
  const [moveError,setMoveError]=useState('');
  const [fenDraft,setFenDraft]=useState('');
  const [dragging,setDragging]=useState(false);
  const inputRef=useRef<HTMLInputElement>(null);
  const promotionDialogRef=useRef<HTMLDialogElement>(null);
  const scanId=useRef(0);
  const currentUrl=useRef('');
  const preloadPromise=useRef<Promise<void>|null>(null);
  const analysisAbort=useRef<AbortController|null>(null);
  const scanStarted=useRef(0);
  const [firstResultMs,setFirstResultMs]=useState<number|null>(null);
  const fen=position?`${position.placement} ${position.turn} ${position.castle||'-'} ${position.ep} ${position.halfmove} ${position.fullmove}`:'';
  const displayedFen=preview?.fen||fen;
  const displayedTurn=displayedFen.split(' ')[1] as 'w'|'b';
  let terminal='';
  try{if(fen){const chess=new Chess(fen);if(chess.isCheckmate())terminal=`Checkmate. ${colorName(position!.turn==='w'?'b':'w')} wins.`;else if(chess.isStalemate())terminal='Stalemate — draw.';else if(chess.isInsufficientMaterial())terminal='Draw — insufficient material.';}}catch{}

  const preload=useCallback(async()=>{
    if(preloadPromise.current)return preloadPromise.current;
    setPreloadState('loading');setPreloadError('');
    const work=Promise.all([
      (async()=>{recognizer.warmUp();const image=await fetch('/warmup-board.png');if(!image.ok)throw new Error('The recognition warm-up image could not load.');const result=await recognizer.recognize(await image.blob());if(!result)throw new Error('The recognition model did not finish warming up.');})(),
      (async()=>{const response=await fetch('/api/preload',{method:'POST'});const data=await response.json();if(!response.ok)throw new Error(data.error||'Stockfish could not load.');})(),
      fetch('/cm-chessboard/pieces/staunty.svg').then(response=>{if(!response.ok)throw new Error('Board pieces could not load.');return response.arrayBuffer();})
    ]).then(()=>{setPreloadState('ready');}).catch(error=>{preloadPromise.current=null;setPreloadState('error');setPreloadError(error.message);});
    preloadPromise.current=work;
    return work;
  },[]);

  const scan=useCallback(async(blob:Blob)=>{
    const id=++scanId.current;
    analysisAbort.current?.abort();setAnalysis(emptyAnalysis);setPosition(null);setInitialPosition(null);setHistory([]);setPendingPromotion(null);setMoveError('');setPreview(null);setScanning(true);setScanError('');setFirstResultMs(null);
    scanStarted.current=performance.now();
    try{
      const result=await recognizer.recognize(blob);
      if(id!==scanId.current)return;
      if(!result){setScanError('No complete board found. Try cropping the image closer to the board.');return;}
      const oriented=orientImage(result.placement);
      const bottom=oriented.orientation==='black'?'b':'w';
      if(currentUrl.current)URL.revokeObjectURL(currentUrl.current);
      currentUrl.current=URL.createObjectURL(blob);
      const next:Position={raw:result.placement,placement:oriented.placement,bottom,turn:bottom,autoTurn:true,castle:inferCastling(oriented.placement),ep:'-',halfmove:0,fullmove:1,imageUrl:currentUrl.current,scan:result,trusted:result.reliable,recognitionMs:Math.round(performance.now()-scanStarted.current),uncertain:oriented.uncertain,edited:false,lastMove:''};
      setPosition(next);setInitialPosition(next);setPaused(false);setFenDraft(placementToFen(next.placement,next.turn));
    }catch(error){if(id===scanId.current)setScanError((error as Error).message||'Could not read this image.');}
    finally{if(id===scanId.current)setScanning(false);}
  },[]);

  useEffect(()=>{
    const onPaste=(event:ClipboardEvent)=>{
      const image=Array.from(event.clipboardData?.items||[]).find(item=>item.type.startsWith('image/'))?.getAsFile();
      if(image){event.preventDefault();void scan(image);}
    };
    window.addEventListener('paste',onPaste);
    return()=>window.removeEventListener('paste',onPaste);
  },[scan]);
  useEffect(()=>()=>{scanId.current++;analysisAbort.current?.abort();if(currentUrl.current)URL.revokeObjectURL(currentUrl.current);},[]);

  useEffect(()=>{
    if(!position||!position.trusted||paused)return;
    const abort=new AbortController();analysisAbort.current=abort;
    setAnalysis({...emptyAnalysis,type:'working'});setPreview(null);
    (async()=>{
      try{
        validatePosition(fen);
        const response=await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fen,timeMs}),signal:abort.signal});
        if(!response.ok){const data=await response.json();throw new Error(data.error);}
        if(!response.body)throw new Error('No engine response.');
        const reader=response.body.getReader();const decoder=new TextDecoder();let buffer='';let gotFirst=false;
        while(true){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});const complete=buffer.split('\n');buffer=complete.pop()||'';
          for(const text of complete){if(!text.trim()||abort.signal.aborted)continue;const update=JSON.parse(text);if(update.type==='error')throw new Error(update.error);setAnalysis(update);if(!gotFirst&&update.lines?.length){gotFirst=true;if(scanStarted.current)setFirstResultMs(previous=>previous??Math.round(performance.now()-scanStarted.current));}}
        }
      }catch(error){if(!abort.signal.aborted)setAnalysis({...emptyAnalysis,type:'error',error:(error as Error).message});}
    })();
    return()=>abort.abort();
  },[fen,timeMs,position?.trusted,paused,analysisRun]);
  useEffect(()=>{setFenDraft(fen);},[fen]);
  useEffect(()=>{if(pendingPromotion&&!promotionDialogRef.current?.open)promotionDialogRef.current?.showModal();},[pendingPromotion]);

  const changeTurn=(turn:'w'|'b')=>{setPosition(p=>p?{...p,turn,autoTurn:false,lastMove:''}:p);setPaused(false);setPendingPromotion(null);setMoveError('');};
  const changeOrientation=(bottom:'w'|'b')=>{
    setPosition(p=>{if(!p)return p;if(p.edited)return {...p,bottom};const placement=bottom==='b'?flipPlacement(p.raw):p.raw;return {...p,bottom,placement,turn:p.autoTurn?bottom:p.turn,castle:inferCastling(placement),uncertain:false};});setPaused(false);setPendingPromotion(null);setMoveError('');
  };
  const applyFen=()=>{
    try{const valid=validatePosition(fenDraft.trim());const [placement,turn,castle,ep,halfmove,fullmove]=valid.split(' ');const next:Position={raw:placement,placement,bottom:'w',turn:turn as 'w'|'b',autoTurn:false,castle:castle==='-'?'':castle,ep,halfmove:Number(halfmove),fullmove:Number(fullmove),imageUrl:'',scan:null,trusted:true,recognitionMs:0,uncertain:false,edited:true,lastMove:''};analysisAbort.current?.abort();scanStarted.current=0;setFirstResultMs(null);setPosition(next);setInitialPosition(next);setHistory([]);setPendingPromotion(null);setPreview(null);setMoveError('');setPaused(false);setScanError('');}
    catch(error){setScanError((error as Error).message);}
  };
  const commitMove=(baseFen:string,from:string,to:string,promotion?:Promotion)=>{
    if(!position)return false;
    try{
      const result=applyLegalMove(baseFen,from,to,promotion);
      analysisAbort.current?.abort();setAnalysis({...emptyAnalysis,type:'working'});
      const previousPosition=baseFen===fen?position:updateFromFen(position,baseFen);
      setHistory(previous=>[...previous,previousPosition]);setPosition(updateFromFen(position,result.fen,result.san));
      setPreview(null);setPendingPromotion(null);setMoveError('');setPaused(false);
      return true;
    }catch{setMoveError('That move is not legal. Check the side to move and castling rights.');return false;}
  };
  const movePiece=(from:string,to:string)=>{
    try{
      const chess=new Chess(validatePosition(displayedFen));
      const choices=chess.moves({square:from as Square,verbose:true}).filter(move=>move.to===to);
      if(!choices.length){setMoveError('That move is not legal. Check the side to move and castling rights.');return false;}
      if(choices.some(move=>move.promotion)){setPendingPromotion({fen:displayedFen,from,to});setMoveError('');return false;}
      return commitMove(displayedFen,from,to);
    }catch(error){setMoveError((error as Error).message);return false;}
  };
  const restorePosition=(next:Position)=>{
    analysisAbort.current?.abort();setAnalysis({...emptyAnalysis,type:'working'});setPosition(next);setPreview(null);setPendingPromotion(null);setMoveError('');setPaused(false);setAnalysisRun(value=>value+1);
  };
  const undoMove=()=>{const previous=history.at(-1);if(previous){setHistory(history.slice(0,-1));restorePosition(previous);}};
  const resetPosition=()=>{if(initialPosition){setHistory([]);restorePosition(initialPosition);}};
  const changeCastling=(right:string,checked:boolean)=>{
    setPosition(p=>p?{...p,castle:'KQkq'.split('').filter(c=>c===right?checked:p.castle.includes(c)).join('')}:p);setPaused(false);setMoveError('');setPendingPromotion(null);
  };
  const best=analysis.lines.find(line=>line.rank===1);
  const active=analysis.type==='working'||analysis.type==='info';

  return <div className="page analyzer-page">
    <header className="header analyzer-header">
      <div><h1 className="brand">Chess <span className="brand-accent">Analysis</span></h1><p className="tagline">Paste a board. Get Stockfish’s best moves and lines.</p></div>
      <div className="preload-group"><button className="primary-button" onClick={()=>void preload()} disabled={preloadState==='loading'||preloadState==='ready'}>{preloadState==='loading'?'Preloading…':preloadState==='ready'?'Everything preloaded':'Preload for fastest results'}</button><span className="ready-state" role="status">{preloadState==='ready'?'Recognition model + Stockfish ready':preloadState==='loading'?'Loading models and warming up analysis':preloadState==='error'?preloadError:'Runs locally on this laptop'}</span></div>
    </header>
    <input ref={inputRef} type="file" accept="image/*" aria-label="Upload board image" hidden onChange={event=>{const file=event.target.files?.[0];if(file)void scan(file);event.target.value='';}}/>
    <div className="workspace" onDragOver={event=>{event.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={event=>{event.preventDefault();setDragging(false);const image=Array.from(event.dataTransfer.files).find(file=>file.type.startsWith('image/'));if(image)void scan(image);}}>
      <section className={`input-panel ${dragging?'dragging':''}`}>
        <h2>Your position</h2>
        <button className="paste-target" onClick={()=>inputRef.current?.click()} disabled={scanning}>
          {position?.imageUrl?<img src={position.imageUrl} alt="Pasted board screenshot"/>:<div className="paste-symbol" aria-hidden>♟</div>}
          <strong>{scanning?'Reading the board…':position?'Paste another screenshot':'Paste a chessboard screenshot'}</strong><span><kbd>Ctrl</kbd> + <kbd>V</kbd>, drag an image, or choose a file</span>
        </button>
        {scanError?<p className="warning" role="alert">{scanError}</p>:null}
        {position?<><label className="control-label" htmlFor="turn">Side to move</label><select id="turn" value={position.turn} onChange={event=>changeTurn(event.target.value as 'w'|'b')}><option value="w">White to move</option><option value="b">Black to move</option></select><p className="small-note">{position.autoTurn?`Default: ${colorName(position.bottom)} has the pieces at the bottom.`:position.lastMove?`After ${position.lastMove}, ${colorName(position.turn)} moves.`:'Turn set manually.'}</p>
          {!position.autoTurn?<button className="text-button" onClick={()=>{setPosition(p=>p?{...p,turn:p.bottom,autoTurn:true}:p);setPaused(false);}}>Use the bottom side</button>:null}
          <label className="control-label" htmlFor="orientation">{position.edited?'Board orientation':'Screenshot orientation'}</label><select id="orientation" value={position.bottom} onChange={event=>changeOrientation(event.target.value as 'w'|'b')}><option value="w">White at the bottom</option><option value="b">Black at the bottom</option></select>
          {position.uncertain?<p className="warning">Check the orientation for this endgame.</p>:null}
          {!position.trusted?<><p className="warning">Some pieces are uncertain. Check the recognized board before analysis.</p><button className="primary-button" onClick={()=>setPosition(p=>p?{...p,trusted:true}:p)}>Board is correct — analyze</button></>:null}
          <fieldset className="castling-fieldset"><legend>Castling rights</legend><div className="castling-controls">{[['K','White O-O'],['Q','White O-O-O'],['k','Black O-O'],['q','Black O-O-O']].map(([right,label])=><label key={right}><input type="checkbox" checked={position.castle.includes(right)} onChange={event=>changeCastling(right,event.target.checked)}/>{label}</label>)}</div><p className="small-note">Guessed from kings and rooks on their starting squares. Uncheck if they moved earlier. Played moves update the rights.</p><button className="text-button" onClick={()=>{setPosition(p=>p?{...p,castle:inferCastling(p.placement)}:p);setPaused(false);setMoveError('');}}>Guess from board</button></fieldset>
          <details className="position-details"><summary>Position FEN</summary><p className="small-note">Use a FEN to set a position, including en passant rights.</p><label className="control-label" htmlFor="fen">Position FEN</label><textarea id="fen" value={fenDraft} onChange={event=>setFenDraft(event.target.value)}/><button className="secondary-button" onClick={applyFen}>Use FEN</button><button className="text-button" onClick={()=>void navigator.clipboard.writeText(fen)}>Copy current FEN</button></details>
        </>:<p className="small-note">The side at the bottom moves by default. You can change it after pasting.</p>}
      </section>
      <section className="board-panel"><div className="panel-heading"><h2>Recognized board</h2>{position?<span>{colorName(displayedTurn)} to move</span>:null}</div>
        {position?<><Board fen={displayedFen} flipped={position.bottom==='b'} enabled={position.trusted&&!pendingPromotion} onMove={movePiece}/><p className="small-note board-instructions">Drag a piece, or click it and its destination. Legal moves recalculate automatically.</p><div className="board-actions"><button className="secondary-button" onClick={undoMove} disabled={!history.length}>Undo move</button><button className="secondary-button" onClick={resetPosition} disabled={position===initialPosition}>Reset position</button></div>{moveError?<p className="warning" role="alert">{moveError}</p>:null}<div className="board-caption">{preview?<><span>{preview.label} · Play a move here to analyze this position.</span><button className="text-button" onClick={()=>{setPreview(null);setMoveError('');}}>Return to position</button></>:<span>{position.lastMove?`Played ${position.lastMove} · `:''}{position.scan?`${Math.round(position.scan.meanConfidence*100)}% recognition confidence · ${position.recognitionMs} ms`:'Position from FEN'}</span>}</div></>:<div className="empty-board"><div className="board-pattern"/><p>Your recognized position will appear here.</p></div>}
      </section>
      <section className="analysis-panel" aria-label="Stockfish analysis"><div className="panel-heading"><h2>Stockfish 19</h2><span>12 threads · up to 4 lines</span></div>
        <div className="analysis-controls"><label htmlFor="think-time">Thinking time</label><select id="think-time" value={timeMs} onChange={event=>{setTimeMs(Number(event.target.value));setPaused(false);}}><option value={1000}>1 second — quick</option><option value={5000}>5 seconds — fast</option><option value={10000}>10 seconds</option><option value={30000}>30 seconds — deeper</option><option value={60000}>60 seconds</option></select>{position?<button className="secondary-button" onClick={()=>{if(active&&!paused)setPaused(true);else{setPaused(false);setAnalysisRun(value=>value+1);}}}>{paused?'Analyze again':active?'Stop':'Analyze again'}</button>:null}</div>
        {analysis.type==='error'?<p className="warning" role="alert">{analysis.error}</p>:null}
        {best?.moves[0]?<div className="best-move"><span>Best move</span><button onClick={()=>setPreview({fen:best.moves[0].fen,label:`After ${best.moves[0].san}`})}>{best.moves[0].san}</button><strong>{scoreText(best)}</strong></div>:<div className="waiting-lines"><p>{terminal|| (scanning?'Reading your image…':active?'Stockfish is calculating…':position&&!position.trusted?'Confirm the recognized board to start.':'Paste an image to begin.')}</p></div>}
        <div className="variation-list">{analysis.lines.map(line=><article className="variation" key={line.rank}><div className="variation-heading"><strong>{line.rank}. {line.moves[0]?.san||'—'}</strong><span>{scoreText(line)} · depth {line.depth}</span></div><div className="variation-moves">{line.moves.slice(0,24).map((move,index)=><button key={index} title="Preview this move" onClick={()=>setPreview({fen:move.fen,label:`Line ${line.rank}, after ${move.san}`})}>{move.san}</button>)}</div></article>)}</div>
        {analysis.lines.length?<p className="small-note analysis-footer">{paused?'Paused':active?'Improving lines…':'Search complete'} · {(analysis.elapsedMs/1000).toFixed(1)} s. Scores are from White’s perspective. Click a move to preview it.</p>:null}
        {firstResultMs!==null?<p className="timing-note">Image to first line: {(firstResultMs/1000).toFixed(2)} s</p>:null}
      </section>
    </div>
    {pendingPromotion?<dialog ref={promotionDialogRef} className="promotion-dialog" aria-labelledby="promotion-title" onCancel={()=>setPendingPromotion(null)}><h2 id="promotion-title">Promote your pawn</h2><p>Choose a piece to continue analysis.</p><div className="promotion-choices">{([['q','Queen'],['r','Rook'],['b','Bishop'],['n','Knight']] as const).map(([piece,label],index)=><button key={piece} className="secondary-button" autoFocus={index===0} onClick={()=>commitMove(pendingPromotion.fen,pendingPromotion.from,pendingPromotion.to,piece)}>{label}</button>)}</div><button className="text-button" onClick={()=>setPendingPromotion(null)}>Cancel</button></dialog>:null}
    <footer className="local-footer">Images stay on this laptop. Stockfish calculates locally. New images use the bottom side again.</footer>
  </div>;
}
