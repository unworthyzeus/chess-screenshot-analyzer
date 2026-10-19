/// <reference types="vite/client" />
declare module '*.mjs?url' {const url:string;export default url;}
declare module '*.onnx?url' {const url:string;export default url;}
declare module 'cm-chessboard/src/Chessboard.js' {
  export const COLOR:{white:'w';black:'b'};
  export const INPUT_EVENT_TYPE:{moveInputStarted:string;validateMoveInput:string};
  export type MoveInputEvent={type:string;squareFrom:string;squareTo:string};
  export class Chessboard {
    constructor(element:HTMLElement,props?:Record<string,unknown>);
    setPosition(fen:string,animated?:boolean):Promise<void>;
    setOrientation(color:'w'|'b',animated?:boolean):Promise<void>;
    enableMoveInput(handler:(event:MoveInputEvent)=>boolean|void,color?:'w'|'b'):void;
    disableMoveInput():void;
    destroy():void;
  }
}
