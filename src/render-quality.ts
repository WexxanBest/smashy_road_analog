import type { GraphicsQuality } from './types';

/** The first visible frame must render before an idle frame budget can start. */
export function shouldRenderFrame(now:number,lastRenderedAt:number,minimumIntervalMs:number){
 return lastRenderedAt===0||now-lastRenderedAt>=minimumIntervalMs;
}

export function qualityProfile(quality:GraphicsQuality,autoLevel=0){
 const level=quality==='auto'?Math.max(0,Math.min(3,autoLevel)):quality==='performance'?3:quality==='balanced'?0:-1;
 // The world sun and its projection follow the car every frame. Reusing a shadow
 // texture with a newer light matrix makes the entire shadow pattern flicker.
 return {level,scale:level<0?1:1+level*.22,maxWidth:level<0?1920:1600,shadows:level<2,shadowSize:level<0?1024:768,shadowRefreshRate:1,detailDistance:level>=2?13:18};
}

/** Slow adaptation with hysteresis: isolated streaming/GC spikes do not lower quality. */
export function createAdaptiveQuality(){
 let level=0,elapsed=0,total=0,count=0,slow=0,fast=0;
 return {
  get level(){return level;},
  reset(){level=elapsed=total=count=slow=fast=0;},
  sample(ms:number){if(!Number.isFinite(ms)||ms<=0||ms>150)return false;elapsed+=ms;total+=ms;count++;if(elapsed<2000)return false;
   const average=total/count;elapsed=total=count=0;slow=average>23?slow+1:0;fast=average<17.5?fast+1:0;
   if(slow>=2&&level<3){level++;slow=fast=0;return true;}if(fast>=8&&level>0){level--;slow=fast=0;return true;}return false;
  }
 };
}
