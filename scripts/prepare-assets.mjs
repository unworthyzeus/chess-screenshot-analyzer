import {copyFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
for(const [source,target] of [
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs','src/ort/ort-wasm-simd-threaded.mjs'],
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm','src/ort/ort-wasm-simd-threaded.wasm'],
  ['node_modules/cm-chessboard/assets/pieces/staunty.svg','public/cm-chessboard/pieces/staunty.svg'],
]){
  const destination=path.join(root,target);
  await mkdir(path.dirname(destination),{recursive:true});
  await copyFile(path.join(root,source),destination);
}
console.log('Prepared local recognition runtime and board pieces.');
