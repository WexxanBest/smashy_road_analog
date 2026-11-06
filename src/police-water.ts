import { Scene, Vector3 } from '@babylonjs/core';
import type { World, WorldProp } from './types';
import { createPatrolBoat } from './special-vehicles';

export interface WaterBounds {centerX:number;centerZ:number;halfWidth:number;halfDepth:number;}
export interface PatrolBoat {id:number;basinId:string;visual:ReturnType<typeof createPatrolBoat>;health:number;alive:boolean;bounds:WaterBounds;fireClock:number;wreckLife:number;phase:number;}
interface Callbacks {onFire(from:Vector3,to:Vector3,damage:number):void;onDestroyed(at:Vector3):void;lineOfSight(from:Vector3,to:Vector3):boolean;}
const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));
const angleDelta=(n:number)=>Math.atan2(Math.sin(n),Math.cos(n));
export function harbourBounds(prop:WorldProp):WaterBounds|undefined {
  if(prop.kind!=='harbour-basin'||!prop.active)return;
  const data=prop.mesh.metadata?.waterBounds as WaterBounds|undefined;
  if(data&&[data.centerX,data.centerZ,data.halfWidth,data.halfDepth].every(Number.isFinite)&&data.halfWidth>=4&&data.halfDepth>=4)return data;
  return {centerX:prop.x,centerZ:prop.z,halfWidth:Math.max(4,(prop.width??26)/2-2),halfDepth:Math.max(4,(prop.depth??21)/2-2)};
}

/** Boats stay in real bounded harbour water. No rigid bodies or per-frame world scans. */
export function createPoliceWater(scene:Scene,callbacks:Callbacks) {
  const boats:PatrolBoat[]=[],cooldowns=new Map<string,number>();let scanClock=0,clock=0;
  function remove(index:number){boats[index].visual.dispose();boats.splice(index,1);}
  function clear(){for(let i=boats.length-1;i>=0;i--)remove(i);cooldowns.clear();scanClock=0;clock=0;}
  function hit(boat:PatrolBoat,damage:number){if(!boat.alive||!Number.isFinite(damage)||damage<=0)return;boat.health=Math.max(0,boat.health-damage);boat.visual.setDamage(boat.health/140,1);for(const fragment of boat.visual.popDebris?.()??[])fragment.dispose(false,true);if(boat.health===0){boat.alive=false;boat.wreckLife=8;cooldowns.set(boat.basinId,clock+35);callbacks.onDestroyed(boat.visual.root.position.clone());}}
  function update(dt:number,player:Vector3,wanted:number,world:World,enabled=true,suppress:boolean|Vector3=false){
    if(!enabled){if(boats.length||cooldowns.size)clear();return;}
    dt=clamp(dt,0,.1);clock+=dt;scanClock-=dt;
    if(scanClock<=0){
      scanClock=1;
      for(const [id,time]of cooldowns)if(time<clock)cooldowns.delete(id);
      const basins=world.propsNear(player.x,player.z,145).filter(p=>p.kind==='harbour-basin'&&p.active),ids=new Set(basins.map(p=>p.id));
      for(let i=boats.length-1;i>=0;i--)if(!ids.has(boats[i].basinId)||Math.hypot(boats[i].visual.root.position.x-player.x,boats[i].visual.root.position.z-player.z)>160)remove(i);
      if(wanted>=2&&suppress!==true)for(const prop of basins){
        if(boats.length>=Math.min(2,wanted>=4?2:1))break;
        if(!prop.id||boats.some(b=>b.basinId===prop.id)||(cooldowns.get(prop.id)??0)>clock)continue;
        const bounds=harbourBounds(prop);if(!bounds)continue;
        const visual=createPatrolBoat(scene);visual.root.position.set(bounds.centerX,.06,bounds.centerZ);
        boats.push({id:visual.root.uniqueId,basinId:prop.id,visual,health:140,alive:true,bounds,fireClock:2,wreckLife:0,phase:0});
      }
    }
    for(let i=boats.length-1;i>=0;i--){const boat=boats[i],at=boat.visual.root.position;
      if(!boat.alive){boat.wreckLife-=dt;boat.visual.root.rotation.z=Math.min(.23,boat.visual.root.rotation.z+dt*.04);if(boat.wreckLife<=0)remove(i);continue;}
      if(suppress===true||suppress instanceof Vector3&&Vector3.DistanceSquared(at,suppress)<=28*28)continue;
      boat.phase+=dt;const b=boat.bounds,near=Math.hypot(player.x-at.x,player.z-at.z)<70&&wanted>0;
      const tx=near?clamp(player.x,b.centerX-b.halfWidth+3,b.centerX+b.halfWidth-3):b.centerX+Math.sin(boat.phase*.3)*(b.halfWidth-3);
      const tz=near?clamp(player.z,b.centerZ-b.halfDepth+3,b.centerZ+b.halfDepth-3):b.centerZ+Math.cos(boat.phase*.3)*(b.halfDepth-3);
      const dx=tx-at.x,dz=tz-at.z,distance=Math.hypot(dx,dz),yaw=Math.atan2(dx,dz);
      if(distance>.1){boat.visual.root.rotation.y+=clamp(angleDelta(yaw-boat.visual.root.rotation.y),-dt*1.6,dt*1.6);const step=Math.min(distance,dt*(near?5.5:3));at.x+=dx/distance*step;at.z+=dz/distance*step;}
      at.y=.06+Math.sin(boat.phase*2)*.025;
      boat.fireClock=Math.max(0,boat.fireClock-dt);
      if(wanted>0&&boat.fireClock<=0&&Vector3.DistanceSquared(at,player)<45*45){const from=at.add(new Vector3(0,1.9,0)),to=player.add(new Vector3(0,.65,0));if(callbacks.lineOfSight(from,to)){boat.fireClock=1.65;callbacks.onFire(from,to,5);}else boat.fireClock=.3;}
    }
  }
  return {boats,update,hit,clear,dispose:clear};
}
