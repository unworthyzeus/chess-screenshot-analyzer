import {extractTiles,probsToPlacement,recognizeGray,rgbaToGray,type BoardCorners,type BoardScanResult,type GrayImage,type RecognizerOptions} from '@scoriiu/fenshot';

// A tightly cropped board may have no outer edge, and a textured theme can
// drown out the seven internal grid peaks. Test the full frame only when its
// tile backgrounds alternate clearly; piece confidence and king counts must
// independently confirm the candidate.
function croppedBoardCandidate(gray:GrayImage):BoardCorners|null{
  if(Math.abs(gray.width-gray.height)/Math.max(gray.width,gray.height)>.04)return null;
  const means:number[]=[];
  for(let row=0;row<8;row++)for(let col=0;col<8;col++){
    const x0=col*gray.width/8,y0=row*gray.height/8;
    const tileW=gray.width/8,tileH=gray.height/8;
    let total=0,count=0;
    // Sample four background corners, away from border highlights and labels.
    for(const [left,top] of [[.10,.10],[.78,.10],[.10,.78],[.78,.78]]){
      for(let dy=0;dy<.10*tileH;dy+=2)for(let dx=0;dx<.10*tileW;dx+=2){
        const x=Math.min(gray.width-1,Math.floor(x0+left*tileW+dx));
        const y=Math.min(gray.height-1,Math.floor(y0+top*tileH+dy));
        total+=gray.data[y*gray.width+x];count++;
      }
    }
    means.push(total/count);
  }
  const parity=means.map((_,index)=>(Math.floor(index/8)+index%8)%2?1:-1);
  const average=means.reduce((sum,value)=>sum+value,0)/64;
  let numerator=0,variance=0;
  for(let index=0;index<64;index++){const delta=means[index]-average;numerator+=delta*parity[index];variance+=delta*delta;}
  const correlation=Math.abs(numerator)/Math.sqrt(variance*64);
  const contrast=Math.abs(numerator)/32;
  if(!Number.isFinite(correlation)||correlation<.58||contrast<12)return null;
  return {x0:0,y0:0,x1:gray.width,y1:gray.height};
}

export function createBoardRecognizer(options:RecognizerOptions){
  let runtimePromise:Promise<typeof import('onnxruntime-web/wasm')>|null=null;
  let sessionPromise:Promise<import('onnxruntime-web').InferenceSession>|null=null;
  function runtime(){
    if(!runtimePromise)runtimePromise=import('onnxruntime-web/wasm').then(ort=>{ort.env.wasm.wasmPaths=options.wasmPaths;return ort;});
    return runtimePromise;
  }
  function session(){
    if(!sessionPromise)sessionPromise=runtime().then(ort=>ort.InferenceSession.create(options.modelUrl,{executionProviders:['wasm']}));
    return sessionPromise;
  }
  return {
    warmUp(){void session().catch(()=>{});},
    async recognize(source:HTMLImageElement|ImageBitmap|File|Blob):Promise<BoardScanResult|null>{
      const ownsBitmap=source instanceof Blob;
      const image=ownsBitmap?await createImageBitmap(source):source;
      try{
        const width='naturalWidth' in image?image.naturalWidth:image.width;
        const height='naturalHeight' in image?image.naturalHeight:image.height;
        const scale=Math.min(1,1600/Math.max(width,height));
        const canvas=document.createElement('canvas');canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);
        const context=canvas.getContext('2d',{willReadFrequently:true});
        if(!context)throw new Error('Could not read image pixels.');
        context.drawImage(image,0,0,canvas.width,canvas.height);
        const pixels=context.getImageData(0,0,canvas.width,canvas.height);
        const gray=rgbaToGray(pixels.data,canvas.width,canvas.height);
        const [ort,model]=await Promise.all([runtime(),session()]);
        const classify=async(corners:BoardCorners)=>{
          const output=await model.run({tiles:new ort.Tensor('float32',extractTiles(gray,corners),[64,1024])});
          return probsToPlacement(output.probs.data as Float32Array);
        };
        const detected=await recognizeGray(gray,classify);
        if(detected?.reliable&&detected.placement!=='8/8/8/8/8/8/8/8')return detected;
        const corners=croppedBoardCandidate(gray);
        if(!corners)return detected;
        const fullFrame=await classify(corners);
        const kingsConfirmed=(fullFrame.placement.match(/K/g)||[]).length===1&&(fullFrame.placement.match(/k/g)||[]).length===1;
        if(!kingsConfirmed||fullFrame.meanConfidence<.90)return detected;
        if(detected&&detected.meanConfidence>=fullFrame.meanConfidence)return detected;
        return {...fullFrame,corners,reliable:fullFrame.minConfidence>=.70};
      }finally{if(ownsBitmap)(image as ImageBitmap).close();}
    }
  };
}
