/** Body-space tyre traction with four smoothly blended driving profiles. SI units. */
export type HandlingProfileId = 'arcade' | 'balanced' | 'drift' | 'grip';
export interface HandlingMemory { steer:number; drift:number; roll:number; pitch:number; arcade:number; driftMode:number; grip:number; }
export interface HandlingInput { vx:number;vz:number;yaw:number;angle:number;throttle:number;steer:number;handbrake:boolean;nitro:boolean;offRoad:boolean;speedLimit:number;handling:number;mass:number;length:number;tireCondition:number;engineCondition:number;engineLevel:number;tireLevel:number;ai:boolean;profile?:HandlingProfileId;dt:number; }
export interface HandlingOutput { vx:number;vz:number;yaw:number;forward:number;lateral:number;slip:number;steerAngle:number;roll:number;pitch:number; }
const clamp=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));
const approach=(value:number,target:number,rate:number,dt:number)=>value+(target-value)*(1-Math.exp(-rate*dt));
export function handlingMemory():HandlingMemory {return {steer:0,drift:0,roll:0,pitch:0,arcade:1,driftMode:0,grip:0};}

export function stepHandling(memory:HandlingMemory,input:HandlingInput):HandlingOutput {
 const dt=clamp(input.dt,0,.05),sn=Math.sin(input.angle),cs=Math.cos(input.angle);
 const forward=input.vx*sn+input.vz*cs,lateral=input.vx*cs-input.vz*sn,speed=Math.hypot(input.vx,input.vz);
 const profile=input.ai?'grip':input.profile??'arcade';
 if(input.ai){memory.arcade=0;memory.driftMode=0;memory.grip=1;}
 else {
  // A switch takes approximately .7s to settle; no steering/velocity state is reset.
  memory.arcade=approach(memory.arcade,profile==='balanced'?.6:profile==='arcade'?1:0,4.5,dt);
  memory.driftMode=approach(memory.driftMode,profile==='drift'?1:0,4.5,dt);
  memory.grip=approach(memory.grip,profile==='balanced'?.4:profile==='grip'?1:0,4.5,dt);
 }
 const a=memory.arcade,d=memory.driftMode,g=memory.grip;
 const throttle=clamp(input.throttle,-1,1),condition=.5+clamp(input.tireCondition,0,100)*.005;
 memory.steer=approach(memory.steer,clamp(input.steer,-1,1),a*10+d*7.5+g*13,dt);
 const steerAngle=memory.steer*(a*.64+d*.62+g*.49)/(1+speed*(a*.05+d*.048+g*.043))*input.handling;
 const powerIntent=clamp((throttle-.25)/.75,0,1)*clamp((speed-6)/10,0,1);
 const steerIntent=clamp((Math.abs(memory.steer)-.12)/.55,0,1);
 const existingSlide=clamp(Math.abs(lateral)/Math.max(3,Math.abs(forward))/.65,0,1);
 const powerSlide=powerIntent*Math.max(steerIntent,existingSlide*.88);
 const driftIntent=input.ai?0:Math.max(input.handbrake&&speed>2?1:0,powerSlide*(d+a*.3+g*.025));
 memory.drift=approach(memory.drift,driftIntent,driftIntent>memory.drift?6:a*5.5+d*1.7+g*8,dt);

 const baseGrip=a*6+d*5.3+g*16;
 const looseGrip=a*1.85+d*1.05+g*3.7;
 const surface=input.offRoad?.64:1;
 const gripRate=(baseGrip+(looseGrip-baseGrip)*memory.drift)*condition*surface*(1+input.tireLevel*.065);
 // Grip changes the velocity vector; it never commands the body to face that vector.
 // Countersteering therefore has a direct, predictable effect instead of a recovery torque.
 const nextLateral=lateral*Math.exp(-gripRate*dt);
 const lateralAccel=dt>0?(nextLateral-lateral)/dt:0;
 const wheelbase=Math.max(1.5,input.length*.68);
 const maxLateral=(a*24+d*17+g*22)*condition*(input.offRoad?.76:1)*(1+input.tireLevel*.035);
 const yawLimit=Math.min(input.ai?1.75:2.2,maxLateral/Math.max(5,speed)*(1+d*memory.drift*.15+(input.handbrake?.12:0)));
 const desiredYaw=clamp(forward/wheelbase*Math.tan(steerAngle),-yawLimit,yawLimit)*clamp(speed/1.5,0,1);
 let yaw=approach(input.yaw,desiredYaw,a*10.5+d*4.7+g*12,dt);
 if(speed<.3)yaw*=Math.exp(-dt*15);
 yaw=clamp(yaw,input.ai?-1.75:-2.2,input.ai?1.75:2.2);

 const nitro=input.nitro&&throttle>0;
 const normalMax=Math.max(3,input.speedLimit)*(1+input.engineLevel*.085)*(.72+clamp(input.engineCondition,0,100)*.0028);
 const max=normalMax*(nitro?1.48:1),reverseMax=normalMax*.35;
 const drag=.42+speed*.027+speed*speed*.0018+(input.handbrake?1.5:0);
 const power=(input.mass>1500?7.8:input.handling>1.15?10.4:9.2)*(a*1.04+d*1.08+g)*(1+input.engineLevel*.1)*(nitro?1.7:1);
 let longitudinal=0;
 if(throttle>0)longitudinal=(forward<-.45?24:power*clamp(1-Math.pow(Math.max(0,forward)/max,4),0,1)+drag)*throttle;
 else if(throttle<0)longitudinal=(forward>.45?23:power*.62*clamp(1-Math.pow(Math.abs(forward)/reverseMax,4),0,1)+drag)*throttle;
 const frictionFactor=speed>0?Math.max(0,1-drag*dt/speed):0;
 const overspeed=Math.max(0,speed-(forward<0?reverseMax:max));
 const capFactor=speed>0?Math.max(0,1-overspeed*.65*dt/speed):1;
 // Soft resistance dissipates overspeed after nitro; releasing it never snaps to a cap.
 let nextForward=forward*frictionFactor+longitudinal*dt;
 let lat=nextLateral*frictionFactor;
 nextForward*=capFactor;lat*=capFactor;
 let vx=sn*nextForward+cs*lat,vz=cs*nextForward-sn*lat;
 if(throttle===0&&speed<.35){vx=0;vz=0;yaw=0;nextForward=0;lat=0;}
 const targetRoll=clamp(lateralAccel*.0075,-.14,.14),targetPitch=clamp(-longitudinal*.0035,-.055,.075);
 memory.roll=approach(memory.roll,targetRoll,6,dt);memory.pitch=approach(memory.pitch,targetPitch,5,dt);
 return {vx,vz,yaw,forward:nextForward,lateral:lat,slip:speed>3?Math.atan2(lat,Math.max(1,Math.abs(nextForward))):0,steerAngle,roll:memory.roll,pitch:memory.pitch};
}
