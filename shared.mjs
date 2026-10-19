import { Chess, validateFen } from 'chess.js';
export function flipPlacement(placement) {
  const squares=placement.split('/').flatMap(rank=>[...rank].flatMap(c=>/\d/.test(c)?Array(Number(c)).fill(''):c));
  squares.reverse();
  return Array.from({length:8},(_,row)=>{
    let rank='',empty=0;
    for(const piece of squares.slice(row*8,row*8+8)){if(!piece)empty++;else{if(empty)rank+=empty;empty=0;rank+=piece;}}
    if(empty)rank+=empty;return rank;
  }).join('/');
}

export function orientImage(rawPlacement) {
  const pieces = rawPlacement.split('/').flatMap((rank, row) => [...rank].filter(c => /[a-z]/i.test(c)).map(piece => ({piece, row})));
  const whitePawns = pieces.filter(p => p.piece === 'P');
  const blackPawns = pieces.filter(p => p.piece === 'p');
  const mean = list => list.reduce((sum, p) => sum+p.row, 0) / Math.max(1,list.length);
  if (whitePawns.length && blackPawns.length) {
    const separation=mean(whitePawns)-mean(blackPawns);
    const orientation=separation<0?'black':'white';
    return {placement:orientation==='black'?flipPlacement(rawPlacement):rawPlacement,orientation,uncertain:Math.abs(separation)<.5};
  }
  const white = pieces.filter(p => p.piece === p.piece.toUpperCase());
  const black = pieces.filter(p => p.piece === p.piece.toLowerCase());
  const separation = mean(white)-mean(black);
  const orientation = separation < 0 ? 'black' : 'white';
  return {placement:orientation === 'black' ? flipPlacement(rawPlacement) : rawPlacement, orientation, uncertain:Math.abs(separation)<1};
}

export function validatePosition(fen) {
  if(typeof fen !== 'string' || fen.length > 200 || /[\r\n]/.test(fen)) throw new Error('Enter a valid FEN position.');
  const validation = validateFen(fen);
  if(!validation.ok) throw new Error(validation.error);
  const chess = new Chess(fen);
  for(const color of ['w','b']) {
    const pieces=chess.board().flat().filter(piece=>piece?.color===color);
    if(pieces.length>16||pieces.filter(piece=>piece.type==='p').length>8)throw new Error('Too many pieces for a legal position. Check the recognized board.');
  }
  const rights=fen.split(' ')[2];
  for(const [right,color,kingSquare,rookSquare] of [['K','w','e1','h1'],['Q','w','e1','a1'],['k','b','e8','h8'],['q','b','e8','a8']]){
    if(!rights.includes(right))continue;
    const king=chess.get(kingSquare),rook=chess.get(rookSquare);
    if(king?.type!=='k'||king.color!==color||rook?.type!=='r'||rook.color!==color)throw new Error('These castling rights require the king and rook on their starting squares. Uncheck that castling right.');
  }
  const inactiveColor = chess.turn() === 'w' ? 'b' : 'w';
  const inactiveKing = chess.board().flat().find(p => p?.color === inactiveColor && p.type === 'k');
  if(inactiveKing && chess.isAttacked(inactiveKing.square, chess.turn())) {
    throw new Error('The other king is in check. Change the side to move, or correct the board.');
  }
  return chess.fen();
}

export function applyLegalMove(fen, from, to, promotion) {
  const chess = new Chess(validatePosition(fen));
  const move = chess.move({from, to, promotion});
  return {fen: chess.fen(), san: move.san};
}

export function parseEngineInfo(line, fen) {
  if(!line.startsWith('info ') || !line.includes(' pv ')) return null;
  const uciMoves = line.split(' pv ')[1].trim().split(/\s+/);
  const rank = Number(line.match(/\bmultipv (\d+)/)?.[1] || 1);
  const scoreMatch = line.match(/\bscore (cp|mate) (-?\d+)/);
  if(!scoreMatch) return null;
  const position = new Chess(fen);
  const score = Number(scoreMatch[2]) * (position.turn() === 'w' ? 1 : -1);
  const moves=[];
  for(const uci of uciMoves) {
    try {
      const move = position.move({from:uci.slice(0,2),to:uci.slice(2,4),promotion:uci.slice(4)||undefined});
      if(!move) break;
      moves.push({san:move.san,uci,fen:position.fen()});
    } catch { break; }
  }
  return {rank, score, scoreType:scoreMatch[1], depth:Number(line.match(/\bdepth (\d+)/)?.[1]||0), moves};
}
