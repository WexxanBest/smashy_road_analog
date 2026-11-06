import { Mesh, Scene, StandardMaterial, Color3, VertexData, VertexBuffer, Material } from '@babylonjs/core';
import type { SurfaceKind } from './types';
export type { SurfaceKind } from './types';
type Contact={lx:number;lz:number;rx:number;rz:number;surface:SurfaceKind};
const style:Record<SurfaceKind,{width:number;life:number;alpha:number;color:readonly number[]}>={
 asphalt:{width:.21,life:52,alpha:.86,color:[.035,.039,.034]},
 sand:{width:.29,life:25,alpha:.64,color:[.46,.33,.18]},
 grass:{width:.33,life:14,alpha:.55,color:[.25,.33,.13]},
 dirt:{width:.28,life:34,alpha:.7,color:[.29,.2,.12]},
 snow:{width:.32,life:30,alpha:.64,color:[.43,.54,.58]},
};
/** Surface-coloured tyre ribbons share one bounded buffer and one draw call. */
export function createSkids(scene:Scene){
 const capacity=2000,positions=new Float32Array(capacity*12),colors=new Float32Array(capacity*16),normals=new Float32Array(capacity*12),indices=new Uint16Array(capacity*6),life=new Float32Array(capacity),duration=new Float32Array(capacity),opacity=new Float32Array(capacity);
 for(let i=0;i<capacity;i++){for(let j=0;j<4;j++)normals[i*12+j*3+1]=1;indices.set([i*4,i*4+1,i*4+2,i*4,i*4+2,i*4+3],i*6);}
 const mesh=new Mesh('persistent-tyre-trails',scene),data=new VertexData();data.positions=positions;data.colors=colors;data.normals=normals;data.indices=indices;data.applyToMesh(mesh,true);mesh.hasVertexAlpha=true;mesh.isPickable=false;mesh.alwaysSelectAsActiveMesh=true;mesh.receiveShadows=false;
 const material=new StandardMaterial('surface-tyre-trails',scene);material.diffuseColor=Color3.White();material.specularColor=Color3.Black();material.disableLighting=true;material.emissiveColor=Color3.White();material.alpha=.82;material.transparencyMode=Material.MATERIAL_ALPHABLEND;material.backFaceCulling=false;mesh.material=material;
 const contacts=new Map<number,Contact>();let cursor=0,dirty=false,active=0;
 function segment(fx:number,fz:number,tx:number,tz:number,surface:SurfaceKind){
  const dx=tx-fx,dz=tz-fz,d=Math.hypot(dx,dz);if(d<.08||d>4)return;
  const s=style[surface],ox=-dz/d*s.width*.5,oz=dx/d*s.width*.5,i=cursor;
  cursor=(cursor+1)%capacity;life[i]=duration[i]=s.life;opacity[i]=s.alpha;
  const p=i*12;positions[p]=fx+ox;positions[p+1]=.145;positions[p+2]=fz+oz;positions[p+3]=fx-ox;positions[p+4]=.145;positions[p+5]=fz-oz;positions[p+6]=tx-ox;positions[p+7]=.145;positions[p+8]=tz-oz;positions[p+9]=tx+ox;positions[p+10]=.145;positions[p+11]=tz+oz;
  for(let j=0;j<4;j++){const c=i*16+j*4;colors[c]=s.color[0];colors[c+1]=s.color[1];colors[c+2]=s.color[2];colors[c+3]=s.alpha;}dirty=true;
 }
 return {
  track(id:number,x:number,z:number,angle:number,width:number,length:number,sliding:boolean,surface:SurfaceKind='asphalt'){
   if(!sliding&&surface==='asphalt'){contacts.delete(id);return;}
   const sx=Math.sin(angle),cz=Math.cos(angle),rx=Math.cos(angle),rz=-Math.sin(angle),bx=x-sx*length*.31,bz=z-cz*length*.31;
   const lx=bx-rx*width*.43,lz=bz-rz*width*.43,rightX=bx+rx*width*.43,rightZ=bz+rz*width*.43;
   const prev=contacts.get(id);
   if(!prev){contacts.set(id,{lx,lz,rx:rightX,rz:rightZ,surface});return;}
   if(prev.surface!==surface){prev.lx=lx;prev.lz=lz;prev.rx=rightX;prev.rz=rightZ;prev.surface=surface;return;}
   // Accumulate distance across frames: slow cars still leave trails at 144fps.
   if(Math.max(Math.hypot(lx-prev.lx,lz-prev.lz),Math.hypot(rightX-prev.rx,rightZ-prev.rz))<.16)return;
   segment(prev.lx,prev.lz,lx,lz,surface);segment(prev.rx,prev.rz,rightX,rightZ,surface);
   prev.lx=lx;prev.lz=lz;prev.rx=rightX;prev.rz=rightZ;
  },
  update(dt:number){
   active=0;let colorDirty=dirty;
   for(let i=0;i<capacity;i++){if(life[i]<=0)continue;life[i]=Math.max(0,life[i]-Math.max(0,dt));if(life[i]>0)active++;const alpha=opacity[i]*Math.min(1,life[i]/Math.min(8,duration[i]*.4));for(let j=0;j<4;j++)colors[i*16+j*4+3]=alpha;colorDirty=true;}
   if(dirty){mesh.updateVerticesData(VertexBuffer.PositionKind,positions,false,false);dirty=false;}
   if(colorDirty)mesh.updateVerticesData(VertexBuffer.ColorKind,colors,false,false);
  },
  get count(){return active;},
  clear(){contacts.clear();life.fill(0);colors.fill(0);cursor=0;active=0;dirty=false;mesh.updateVerticesData(VertexBuffer.ColorKind,colors,false,false);},
  dispose(){contacts.clear();mesh.dispose();material.dispose();}
 };
}
