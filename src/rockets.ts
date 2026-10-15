import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
export interface HomingTarget {id:number;position():Vector3;alive():boolean;}
interface Rocket {root:TransformNode;target:HomingTarget;direction:Vector3;last:Vector3;life:number;age:number;trail:number;}
/** Bounded projectile pool; steering follows a live target instead of teleporting to its click position. */
export function createRockets(scene:Scene,onExplosion:(at:Vector3)=>void,onTrail:(at:Vector3)=>void,blocked:(at:Vector3)=>boolean=()=>false){
 const shell=new StandardMaterial('rocket-shell',scene);shell.diffuseColor=Color3.FromHexString('#d9e2de');shell.specularColor=Color3.Black();
 const nose=new StandardMaterial('rocket-nose',scene);nose.diffuseColor=Color3.FromHexString('#ce7f58');
 const flame=new StandardMaterial('rocket-thrust',scene);flame.disableLighting=true;flame.emissiveColor=Color3.FromHexString('#ffb85c');
 const active:Rocket[]=[];
 function remove(r:Rocket){const index=active.indexOf(r);if(index<0)return;r.root.dispose(false,false);active.splice(index,1);}
 function activeTargets():HomingTarget[]{const targets:HomingTarget[]=[],ids=new Set<number>();for(const rocket of active){const target=rocket.target;if(!ids.has(target.id)&&target.alive()){ids.add(target.id);targets.push(target);}}return targets;}
 function firstBlock(from:Vector3,to:Vector3){const distance=Vector3.Distance(from,to),samples=Math.max(1,Math.ceil(distance/.08));for(let i=1;i<=samples;i++){const at=Vector3.Lerp(from,to,i/samples);if(blocked(at))return at;}return undefined;}
 return {
  launch(from:Vector3,target:HomingTarget){if(active.length>=8||!target.alive())return false;const root=new TransformNode('homing-rocket',scene);root.position.copyFrom(from);
   const body=MeshBuilder.CreateCylinder('missile-body',{height:1.2,diameter:.23,tessellation:6},scene);body.parent=root;body.rotation.x=Math.PI/2;body.material=shell;
   const tip=MeshBuilder.CreateCylinder('missile-warhead',{height:.4,diameterBottom:.23,diameterTop:0,tessellation:6},scene);tip.parent=root;tip.position.z=.8;tip.rotation.x=Math.PI/2;tip.material=nose;
   for(const a of [0,Math.PI/2]){const fins=MeshBuilder.CreateBox('missile-fins',{width:.6,height:.045,depth:.42},scene);fins.parent=root;fins.position.z=-.4;fins.rotation.z=a;fins.material=shell;}
   const jet=MeshBuilder.CreateCylinder('missile-flame',{height:.65,diameterBottom:.04,diameterTop:.21,tessellation:6},scene);jet.parent=root;jet.rotation.x=Math.PI/2;jet.position.z=-.85;jet.material=flame;
   root.getChildMeshes().forEach(m=>m.isPickable=false);const last=target.position().clone(),direction=last.subtract(from).normalize();direction.y+=.25;direction.normalize();active.push({root,target,direction,last,life:6,age:0,trail:0});return true;
  },
  update(dt:number){for(const r of [...active]){if(!active.includes(r))continue;r.life-=dt;r.age+=dt;r.trail-=dt;if(r.target.alive())r.last.copyFrom(r.target.position());const delta=r.last.subtract(r.root.position),distance=delta.length();if(distance<1.65){const at=firstBlock(r.root.position,r.last)??r.root.position.clone();remove(r);onExplosion(at);continue;}if(r.life<=0){remove(r);continue;}
    const wanted=delta.normalize();r.direction.copyFrom(Vector3.Lerp(r.direction,wanted,1-Math.exp(-dt*6))).normalize();const step=(30+Math.min(18,r.age*20))*dt,to=step>=distance?r.last.clone():r.root.position.add(r.direction.scale(step)),collision=firstBlock(r.root.position,to);if(collision||step>=distance){const at=collision??r.last.clone();remove(r);onExplosion(at);continue;}r.root.position.copyFrom(to);r.root.rotation.set(-Math.atan2(r.direction.y,Math.hypot(r.direction.x,r.direction.z)),Math.atan2(r.direction.x,r.direction.z),0);if(r.trail<=0){onTrail(r.root.position.subtract(r.direction.scale(.9)));r.trail=.045;}
   }},
  get count(){return active.length;},
  activeTargets,
  activeTargetIds():number[]{return activeTargets().map(target=>target.id);},
  clear(){for(const r of [...active])remove(r);},
  dispose(){this.clear();shell.dispose();nose.dispose();flame.dispose();}
 };
}
