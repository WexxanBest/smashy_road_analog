import { CARS, CHALLENGES } from './types';
import type { CarSpec, SaveData } from './types';

const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));
export const PURSUIT_LEVELS=[
 {cars:0,interval:5,helis:0,heliCooldown:60},
 {cars:3,interval:5.5,helis:0,heliCooldown:60},
 {cars:4,interval:5,helis:0,heliCooldown:60},
 {cars:5,interval:4.5,helis:1,heliCooldown:60},
 {cars:6,interval:4,helis:1,heliCooldown:50},
 {cars:8,interval:3.5,helis:2,heliCooldown:40}
] as const;
export function policeSpec(role:NonNullable<CarSpec['policeRole']>, variantIndex=0):CarSpec {
 const source=CARS[role==='suv'?1:role==='swat'?6:role==='interceptor'?3:0];
 const values={patrol:{speed:29,armor:120,mass:1150,handling:1.1},interceptor:{speed:37,armor:100,mass:1050,handling:1.25},suv:{speed:30,armor:175,mass:1800,handling:1},swat:{speed:25,armor:260,mass:2500,handling:.85}}[role];
 const spec:CarSpec={...source,...values,id:'police-'+role,name:role.toUpperCase(),subtitle:{patrol:'Городской патруль',interceptor:'Скоростной перехватчик',suv:'Полицейский внедорожник',swat:'Бронированный фургон спецназа'}[role],policeRole:role,bodyStyle:role==='swat'?'van':role==='suv'?'suv':role==='interceptor'?'muscle':'hatch',visualVariant:role==='patrol'?'sedan':undefined};
 // Fleet variety keeps the four existing pursuit roles and their spawn limits.
 const index=Math.abs(Math.floor(Number.isFinite(variantIndex)?variantIndex:0));
 if(role==='patrol')Object.assign(spec,{width:2.04,length:4.3});
 if(role==='interceptor')Object.assign(spec,{width:2.12,length:4.5});
 if(role==='patrol'&&index%2===1)Object.assign(spec,{id:'police-rally',name:'RALLY PATROL',subtitle:'Раллийный патруль',visualVariant:'rally-hatch',width:2.08,length:3.85});
 if(role==='patrol'&&index%3===2)Object.assign(spec,{id:'police-motorcycle',name:'ROAD RIDER',subtitle:'Дорожный полицейский мотоцикл',visualVariant:'motorcycle',width:.92,length:2.7,armor:70,mass:350,speed:34,handling:1.25});
 if(role==='suv'&&index%2===1)Object.assign(spec,{id:'police-sheriff',name:'SHERIFF',subtitle:'Пикап шерифа',bodyStyle:'pickup',visualVariant:'sheriff',width:2.2,length:4.6});
 if(role==='swat'&&index%3===1)Object.assign(spec,{id:'police-command',name:'COMMAND',subtitle:'Мобильный полицейский штаб',visualVariant:'command',width:2.3,length:5.5});
 if(role==='swat'&&index%3===2)Object.assign(spec,{id:'police-apc',name:'ARMORED RESPONSE',subtitle:'Бронетранспортёр 8×8',visualVariant:'apc',extraAxles:2,width:2.45,length:5.6});
 return spec;
}
export function choosePoliceRole(stars:number,index:number):NonNullable<CarSpec['policeRole']> {
 if(stars>=4&&index%4===3)return 'swat';
 if(stars>=3&&index%3===2)return 'suv';
 if(stars>=2&&index%3===1)return 'interceptor';
 return 'patrol';
}
export interface TrafficBody {x:number;z:number;vx:number;vz:number;angle:number;length:number;width:number;}
/** Yield to a lead vehicle or a projected crossing; never swerve into oncoming traffic. */
export function safeTrafficSpeed(car:TrafficBody,others:TrafficBody[],cruise:number):number {
 const fx=Math.sin(car.angle),fz=Math.cos(car.angle),rx=fz,rz=-fx,speed=Math.hypot(car.vx,car.vz);
 let safe=cruise;
 for(const other of others){
  const dx=other.x-car.x,dz=other.z-car.z,along=dx*fx+dz*fz,lateral=Math.abs(dx*rx+dz*rz);
  const half=(car.length+other.length)*.5,margin=(car.width+other.width)*.5+.6;
  if(along>0&&along<half+3+speed*1.8&&lateral<margin){
   const lead=Math.max(0,other.vx*fx+other.vz*fz),gap=along-half-1.8;
   safe=Math.min(safe,Math.max(0,lead+(gap-speed*.65)/1.15));
  }
  const rvx=other.vx-car.vx,rvz=other.vz-car.vz,closing=rvx*rvx+rvz*rvz;
  const crossLaneSpeed=Math.abs(rvx*rx+rvz*rz);
  if(closing>.1&&along>-car.length*.5&&(lateral<margin||crossLaneSpeed>.5)){
   const t=clamp(-(dx*rvx+dz*rvz)/closing,0,2.1),near=Math.hypot(dx+rvx*t,dz+rvz*t);
   if(t>.05&&near<margin+.65&&Math.hypot(dx,dz)>half*.7)safe=Math.min(safe,Math.max(0,speed*(t-.5)/1.8));
  }
 }
 return Math.max(0,safe);
}
export function coolTurret(heat:number,dt:number,firing:boolean,overheated:boolean,level:number,noOverheat=false):number {
 if(noOverheat)return 0;
 const rate=(overheated||!firing?25:5)*(1+clamp(level,0,3)*.15);
 return Math.max(0,heat-rate*Math.max(0,dt));
}
export interface ChallengeTick {distance:number;offroadDistance:number;speedStreak:number;returnedAfterFiveStars:boolean;sandbox:boolean;}
/** Awards are immediate and idempotent; sandbox never touches normal progression. */
export function advanceChallenges(save:SaveData,tick:ChallengeTick):string[] {
 if(tick.sandbox)return [];
 save.challenges['city-runner']=(save.challenges['city-runner']||0)+tick.distance;
 save.challenges['trailblazer']=(save.challenges['trailblazer']||0)+tick.offroadDistance;
 save.challenges['speed-streak']=Math.max(save.challenges['speed-streak']||0,tick.speedStreak);
 if(tick.returnedAfterFiveStars)save.challenges['most-wanted']=1;
 const awards:string[]=[];
 for(const c of CHALLENGES){save.challenges[c.id]=Math.min(c.target,Math.max(0,save.challenges[c.id]||0));if(save.challenges[c.id]>=c.target&&!save.completedChallenges.includes(c.id)){save.completedChallenges.push(c.id);if(!save.owned.includes(c.carId))save.owned.push(c.carId);awards.push(c.carId);}}
 return awards;
}
export interface ScreenPoint {x:number;y:number;z:number;}
export function outsideSpawnViewport(points:ScreenPoint[],width:number,height:number,margin=.16):boolean {
 if(!points.length||width<=0||height<=0)return false;
 const front=points.filter(p=>p.z>=0&&p.z<=1);if(!front.length)return true;
 const minX=Math.min(...front.map(p=>p.x)),maxX=Math.max(...front.map(p=>p.x)),minY=Math.min(...front.map(p=>p.y)),maxY=Math.max(...front.map(p=>p.y));
 return maxX< -width*margin||minX>width*(1+margin)||maxY< -height*margin||minY>height*(1+margin);
}
