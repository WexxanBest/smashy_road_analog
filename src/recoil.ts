export interface RecoilPose { roll:number; pitch:number; barrel:number; }

type Spring = { position:number; velocity:number };
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
const finite=(value:number)=>Number.isFinite(value)?value:0;

/** Exact damped-spring recoil: radians for the chassis, metres for barrel setback. */
export function createRecoil(): {
  kick(localRight:number,localForward:number,weight?:number):void;
  step(dt:number):RecoilPose;
  reset():void;
} {
  const roll:Spring={position:0,velocity:0},pitch:Spring={position:0,velocity:0},barrel:Spring={position:0,velocity:0};
  function advance(spring:Spring,dt:number,frequency:number,damping:number,min:number,max:number):void {
    const decay=frequency*damping,oscillation=frequency*Math.sqrt(1-damping*damping);
    const factor=Math.exp(-decay*dt),sin=Math.sin(oscillation*dt),cos=Math.cos(oscillation*dt);
    const x=spring.position,v=spring.velocity;
    spring.position=factor*(x*cos+(v+decay*x)/oscillation*sin);
    spring.velocity=factor*(v*cos-(decay*v+frequency*frequency*x)/oscillation*sin);
    if(spring.position<min){spring.position=min;if(spring.velocity<0)spring.velocity=0;}
    if(spring.position>max){spring.position=max;if(spring.velocity>0)spring.velocity=0;}
    if(Math.abs(spring.position)<1e-6&&Math.abs(spring.velocity)<1e-5){spring.position=0;spring.velocity=0;}
  }
  return {
    kick(localRight:number,localForward:number,weight=1):void {
      const strength=clamp(finite(weight),0,2),right=clamp(finite(localRight),-1,1),forward=clamp(finite(localForward),-1,1);
      // Above-COM reaction: shooting right raises the right side; forward raises the nose.
      roll.velocity=clamp(roll.velocity+right*.36*strength,-.9,.9);
      pitch.velocity=clamp(pitch.velocity-forward*.36*strength,-.9,.9);
      barrel.position=Math.min(.12,barrel.position+.055*strength);
      barrel.velocity=Math.min(1.2,barrel.velocity+.45*strength);
    },
    step(dt:number):RecoilPose {
      const time=clamp(finite(dt),0,.05);
      advance(roll,time,12,.8,-.045,.045);
      advance(pitch,time,12,.8,-.045,.045);
      advance(barrel,time,22,.78,0,.12);
      return {roll:roll.position,pitch:pitch.position,barrel:barrel.position};
    },
    reset():void {roll.position=roll.velocity=pitch.position=pitch.velocity=barrel.position=barrel.velocity=0;},
  };
}
