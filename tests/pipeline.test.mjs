import test from 'node:test';
import assert from 'node:assert/strict';
import {orientImage,flipPlacement,validatePosition,parseEngineInfo,applyLegalMove} from '../shared.mjs';
import {Chess} from 'chess.js';
import {Stockfish} from '../engine.mjs';
const placement='r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R';

test('Image orientation defaults to the side at the bottom',()=>{
  const white=orientImage(placement);
  const black=orientImage(flipPlacement(placement));
  assert.equal(white.orientation,'white');assert.equal(black.orientation,'black');
  assert.equal(white.placement,placement);assert.equal(black.placement,placement);
});
test('Illegal turns cannot terminate Stockfish',()=>{
  assert.throws(()=>validatePosition('7k/6Q1/6K1/8/8/8/8/8 w - - 0 1'),/other king/);
  assert.throws(()=>validatePosition('startpos\nquit'));
  assert.throws(()=>validatePosition('7k/5Q2/6K1/8/8/8/8/8 w K - 0 1'),/castling rights/);
  assert.equal(validatePosition(placement+' b KQkq - 0 1').split(' ')[1],'b');
});
test('Black scores become White-perspective scores and lines become legal SAN',()=>{
  const line=parseEngineInfo('info depth 12 multipv 1 score cp 40 pv g8f6 d2d3',placement+' b KQkq - 0 1');
  assert.equal(line.score,-40);assert.deepEqual(line.moves.map(m=>m.san),['Nf6','d3']);
});
test('Board moves advance the turn and preserve special-move state',()=>{
  const original='rnbqkbnr/pppp2pp/8/4p2Q/4P3/8/PPPP2PP/RNB1KBNR b KQkq - 0 1';
  const reply=applyLegalMove(original,'g7','g6');
  assert.equal(reply.san,'g6');assert.equal(reply.fen,'rnbqkbnr/pppp3p/6p1/4p2Q/4P3/8/PPPP2PP/RNB1KBNR w KQkq - 0 2');
  assert.throws(()=>applyLegalMove(original,'a7','a6'),/Invalid move/);
  const castle=applyLegalMove('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1','e1','g1');
  const afterCastle=new Chess(castle.fen);
  assert.equal(afterCastle.get('g1').type,'k');assert.equal(afterCastle.get('f1').type,'r');assert.equal(castle.fen.split(' ')[2],'kq');
  const rookMove=applyLegalMove('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1','a1','a2');
  assert.equal(rookMove.fen.split(' ')[2],'Kkq');
  const capture=applyLegalMove('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1','a1','a8');
  assert.equal(capture.fen.split(' ')[2],'Kk');
  const ep=applyLegalMove('7k/8/8/3pP3/8/8/8/K7 w - d6 0 1','e5','d6');
  assert.equal(new Chess(ep.fen).get('d5'),undefined);assert.equal(new Chess(ep.fen).get('d6').type,'p');
  const promotion=applyLegalMove('8/P6k/8/8/8/8/8/7K w - - 0 1','a7','a8','n');
  assert.equal(new Chess(promotion.fen).get('a8').type,'n');assert.equal(promotion.fen.split(' ')[1],'b');
});
test('Preload and live four-line analysis work with the installed engine',async()=>{
  const engine=new Stockfish();
  try{
    assert.equal((await engine.preload()).ready,true);
    const controller=new AbortController();const updates=[];
    await engine.analyze(placement+' b KQkq - 0 1',1000,update=>updates.push(update),controller.signal);
    const final=updates.at(-1);assert.equal(final.type,'done');assert.equal(final.lines.length,4);
    assert.ok(final.lines.every(line=>line.moves.length));
    assert.equal(new Set(final.lines.map(line=>line.moves[0].uci)).size,4);
    const cancel=new AbortController();const aborted=engine.analyze(placement+' w KQkq - 0 1',10000,()=>{},cancel.signal);
    setTimeout(()=>cancel.abort(),100);await aborted;
    const next=[];await engine.analyze(placement+' b KQkq - 0 1',1000,update=>next.push(update),new AbortController().signal);
    assert.equal(next.at(-1).lines.length,4);
    const checked=[];
    await engine.analyze('rnbqkbnr/pppp2pp/8/4p2Q/4P3/8/PPPP2PP/RNB1KBNR b KQkq - 0 1',1000,update=>checked.push(update),new AbortController().signal);
    assert.ok(checked.some(update=>update.type==='info'&&update.lines.length===2),'Two legal replies must stream before the search finishes');
    assert.equal(checked.at(-1).lines.length,2);
  }finally{engine.close();}
});
