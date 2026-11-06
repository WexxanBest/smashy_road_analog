import { Engine, Scene, SceneInstrumentation } from '@babylonjs/core';

/** Development-only repeatable frame sample. A hidden tab invalidates the run. */
export function installPerfProbe(engine:Engine,scene:Scene,begin:()=>void,finish:()=>void,details:()=>unknown,keepPlaying:()=>void){
 const meter=new SceneInstrumentation(scene);meter.captureFrameTime=true;meter.capturePhysicsTime=true;meter.captureRenderTargetsRenderTime=true;meter.captureActiveMeshesEvaluationTime=true;
 let running=false,start=0,last=0,invalid=false;
 const frames:number[]=[],cpu:number[]=[],shadows:number[]=[],draws:number[]=[],active:number[]=[],physics:number[]=[],evaluation:number[]=[];
 const output=document.createElement('output');output.id='perf-result';output.style.cssText='position:fixed;bottom:12px;left:12px;z-index:100;max-width:620px;padding:10px;background:#16231e;color:#fff;font:12px monospace;pointer-events:none';output.hidden=true;document.body.append(output);
 const stats=(xs:number[])=>{const a=[...xs].sort((x,y)=>x-y);return {mean:+(a.reduce((s,x)=>s+x,0)/Math.max(1,a.length)).toFixed(2),p50:+(a[Math.floor(a.length*.5)]??0).toFixed(2),p95:+(a[Math.floor(a.length*.95)]??0).toFixed(2)};};
 scene.onBeforeRenderObservable.add(()=>{if(running&&!document.hidden)keepPlaying();});
 scene.onAfterRenderObservable.add(()=>{if(!running)return;const now=performance.now(),elapsed=now-start,delta=now-last;last=now;if(document.hidden)invalid=true;
  if(elapsed>5000){frames.push(delta);cpu.push(meter.frameTimeCounter.current);shadows.push(meter.renderTargetsRenderTimeCounter.current);draws.push(meter.drawCallsCounter.current);active.push(scene.getActiveMeshes().length);physics.push(meter.physicsTimeCounter.current);evaluation.push(meter.activeMeshesEvaluationTimeCounter.current);}
  if(elapsed<25000){if(frames.length%30===0)output.textContent=`Замер FPS: ${Math.ceil(Math.max(0,25000-elapsed)/1000)} с`;return;}
  running=false;const timing=stats(frames),result={valid:!invalid,samples:frames.length,seconds:+((elapsed-5000)/1000).toFixed(2),fps:+(1000/timing.mean).toFixed(1),frameMs:timing,cpuMs:stats(cpu),shadowCpuMs:stats(shadows),physicsCpuMs:stats(physics),activeEvaluationCpuMs:stats(evaluation),drawCalls:stats(draws),activeMeshes:stats(active),renderSize:[engine.getRenderWidth(),engine.getRenderHeight()],details:details()};
  document.documentElement.dataset.performanceResult=JSON.stringify(result);output.textContent=JSON.stringify(result);finish();
 });
 const button=document.createElement('button');button.textContent='QA: FPS 25 секунд';button.style.cssText='position:fixed;bottom:12px;right:12px;z-index:100;background:#e6ef64;padding:12px;border:0;color:#172018;cursor:pointer';
 button.onclick=()=>{button.blur();begin();frames.length=cpu.length=shadows.length=draws.length=active.length=physics.length=evaluation.length=0;invalid=false;running=true;start=last=performance.now();delete document.documentElement.dataset.performanceResult;output.hidden=false;};document.body.append(button);
}
