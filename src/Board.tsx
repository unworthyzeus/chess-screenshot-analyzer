import { useEffect, useRef } from "react";
import { Chessboard, COLOR, INPUT_EVENT_TYPE } from "cm-chessboard/src/Chessboard.js";
import { Chess, type Square } from "chess.js";
import "cm-chessboard/assets/chessboard.css";

const ASSETS = `${import.meta.env.BASE_URL}cm-chessboard/`;

type BoardProps = { fen: string; flipped: boolean; enabled: boolean; onMove: (from: string, to: string) => boolean };

export function Board({ fen, flipped, enabled, onMove }: BoardProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<InstanceType<typeof Chessboard> | null>(null);
  const current = useRef({ fen, onMove });
  current.current = { fen, onMove };
  const placement = fen.split(' ')[0];
  const turn = fen.split(' ')[1] as 'w' | 'b';

  useEffect(() => {
    if (!hostRef.current) return;
    const board = new Chessboard(hostRef.current, {
      assetsUrl: ASSETS,
      position: placement,
      orientation: flipped ? COLOR.black : COLOR.white,
      style: { pieces: { file: "pieces/staunty.svg" }, animationDuration: 0 },
    });
    boardRef.current = board;
    return () => {
      board.destroy();
      boardRef.current = null;
    };
  }, []);

  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    void board.setPosition(placement, false);
    void board.setOrientation(flipped ? COLOR.black : COLOR.white, false);
  }, [placement, flipped]);

  useEffect(() => {
    const board = boardRef.current;
    if (!board || !enabled) return;
    board.enableMoveInput(event => {
      if (event.type === INPUT_EVENT_TYPE.moveInputStarted) {
        try {
          return new Chess(current.current.fen).moves({ square: event.squareFrom as Square }).length > 0;
        } catch { return false; }
      }
      if (event.type === INPUT_EVENT_TYPE.validateMoveInput) {
        return current.current.onMove(event.squareFrom, event.squareTo);
      }
    }, turn);
    return () => { if (boardRef.current === board) board.disableMoveInput(); };
  }, [turn, enabled]);

  return <div ref={hostRef} className="board-host" />;
}
