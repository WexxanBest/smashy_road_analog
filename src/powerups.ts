export type TimedPowerup='magnet'|'smoke'|'emp'|'drone';
export const POWERUP_SECONDS:Record<TimedPowerup,number>={magnet:15,smoke:8,emp:6,drone:20};
const LABELS:Record<TimedPowerup,string>={magnet:'Магнит',smoke:'Дымовая завеса',emp:'EMP',drone:'Разведка'};
/** Run-local effects never touch the persistent save. Re-pickup refreshes, not stacks. */
export function createPowerups(){
 const left:Record<TimedPowerup,number>={magnet:0,smoke:0,emp:0,drone:0};
 return {left,activate(kind:TimedPowerup){left[kind]=POWERUP_SECONDS[kind];},update(dt:number){if(!Number.isFinite(dt)||dt<0)return;for(const kind of Object.keys(left) as TimedPowerup[])left[kind]=Math.max(0,left[kind]-dt);},clear(){for(const kind of Object.keys(left) as TimedPowerup[])left[kind]=0;},badges(){return (Object.keys(left) as TimedPowerup[]).filter(kind=>left[kind]>0).map(kind=>({kind,label:LABELS[kind],seconds:Math.ceil(left[kind])}));}};
}
export function segmentCrossesSmoke(ax:number,az:number,bx:number,bz:number,x:number,z:number,radius=8){const dx=bx-ax,dz=bz-az,length=dx*dx+dz*dz,t=length?Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/length)):0;return (ax+t*dx-x)**2+(az+t*dz-z)**2<radius*radius;}
export function spikeContact(x:number,z:number,angle:number,carX:number,carZ:number,width:number){const dx=carX-x,dz=carZ-z;return Math.abs(dx*Math.cos(angle)-dz*Math.sin(angle))<2.6+width/2&&Math.abs(dx*Math.sin(angle)+dz*Math.cos(angle))<1.6;}
