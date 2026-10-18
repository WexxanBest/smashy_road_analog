import { Color3, DynamicTexture, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, VertexBuffer } from '@babylonjs/core';

export type PickupKind = 'cash' | 'repair' | 'ammo' | 'nitro' | 'rocket';
export const PICKUP_INFO:Record<PickupKind,{name:string;label:string;color:string;message:string}>={
 cash:{name:'ДОБЫЧА',label:'ДОБЫЧА +80',color:'#f3d85d',message:'+$80 · добыча'},
 repair:{name:'РЕМОНТ',label:'РЕМОНТ +25',color:'#ff786a',message:'Ремкомплект · кузов +25, мотор и шины +15'},
 ammo:{name:'ГРАНАТЫ',label:'ГРАНАТЫ +3',color:'#f2a563',message:'+3 гранаты · ПКМ'},
 nitro:{name:'НИТРО',label:'НИТРО +45',color:'#63cfff',message:'Нитро +45% · Shift'},
 rocket:{name:'РАКЕТЫ',label:'РАКЕТНИЦА +3',color:'#c6a0ff',message:'Ракеты +3 · нажми 2 для выбора ракетницы.'}
};
interface Resources { model:StandardMaterial;labels:Map<PickupKind,StandardMaterial>; }
const caches=new WeakMap<Scene,Resources>();
function resources(scene:Scene):Resources {
 let result=caches.get(scene);if(result)return result;
 const model=new StandardMaterial('supply-model-vertex-colors',scene);model.diffuseColor=Color3.White();model.emissiveColor=new Color3(.22,.22,.22);model.specularColor=Color3.Black();
 result={model,labels:new Map()};caches.set(scene,result);return result;
}
function labelMaterial(scene:Scene,kind:PickupKind):StandardMaterial {
 const shared=resources(scene),cached=shared.labels.get(kind);if(cached)return cached;
 const info=PICKUP_INFO[kind],texture=new DynamicTexture('supply-label-'+kind,{width:512,height:112},scene,false);
 const ctx=texture.getContext() as CanvasRenderingContext2D;ctx.clearRect(0,0,512,112);ctx.fillStyle='#16201e';ctx.fillRect(2,8,508,96);ctx.fillStyle=info.color;ctx.fillRect(2,8,12,96);ctx.strokeStyle=info.color;ctx.lineWidth=3;ctx.strokeRect(2,8,508,96);ctx.font='bold 43px Arial';ctx.textBaseline='middle';ctx.textAlign='center';ctx.fillStyle='#fffbea';ctx.fillText(info.label,263,58);texture.update();
 const mat=new StandardMaterial('supply-label-material-'+kind,scene);mat.diffuseTexture=texture;mat.opacityTexture=texture;mat.emissiveColor=Color3.White();mat.disableLighting=true;mat.backFaceCulling=false;texture.hasAlpha=true;shared.labels.set(kind,mat);return mat;
}
/** A recognisable object silhouette and a readable world label share cached materials. */
export function createSupply(scene:Scene,kind:PickupKind){
 const root=new TransformNode('supply-'+kind,scene),info=PICKUP_INFO[kind],tint=Color3.FromHexString(info.color),light=Color3.FromHexString('#fff4db'),dark=Color3.FromHexString('#263739');
 const parts:Mesh[]=[];
 function add(m:Mesh,color:Color3){const colors=new Float32Array(m.getTotalVertices()*4);for(let i=0;i<m.getTotalVertices();i++)colors.set([color.r,color.g,color.b,1],i*4);m.setVerticesData(VertexBuffer.ColorKind,colors);m.material=resources(scene).model;m.isPickable=false;parts.push(m);return m;}
 function box(name:string,w:number,h:number,d:number,x:number,y:number,z:number,color=tint){const m=MeshBuilder.CreateBox(name,{width:w,height:h,depth:d},scene);m.position.set(x,y,z);return add(m,color);}
 function cylinder(name:string,diameter:number,height:number,x:number,y:number,z:number,color=tint,top=diameter){const m=MeshBuilder.CreateCylinder(name,{diameterBottom:diameter,diameterTop:top,height,tessellation:8},scene);m.position.set(x,y,z);return add(m,color);}
 cylinder('supply-round-base',2.25,.1,0,-.72,0,tint.scale(.65));
 if(kind==='cash'){
  for(const [x,z,n] of [[-.42,-.2,3],[.34,.19,4],[.6,-.5,2]])for(let i=0;i<n;i++)cylinder('gold-coin',.83,.16,x,-.5+i*.17,z,light);
  box('cash-bundle',.85,.35,.45,-.3,.27,.28,tint);box('bundle-band',.14,.37,.47,-.3,.27,.28,light);
 }else if(kind==='repair'){
  box('toolbox',1.55,.84,.84,0,-.1,0);box('toolbox-lid',1.65,.12,.94,0,.36,0,light);box('handle-left',.12,.35,.13,-.3,.56,0,dark);box('handle-right',.12,.35,.13,.3,.56,0,dark);box('toolbox-handle',.72,.12,.15,0,.72,0,dark);
  box('repair-cross-horizontal',.85,.16,.035,0,-.05,-.44,light);box('repair-cross-vertical',.18,.6,.035,0,-.05,-.45,light);box('top-cross-x',.65,.04,.18,0,.44,0,tint);box('top-cross-z',.18,.04,.65,0,.44,0,tint);
 }else if(kind==='nitro'){
  cylinder('nitro-bottle',.83,1.45,0,.03,0,tint);cylinder('bottle-shoulder',.83,.23,0,.87,0,tint,.35);cylinder('nitro-valve',.21,.23,0,1.08,0,dark);box('nitro-valve-grip',.5,.07,.1,0,1.18,0,light);
  box('bottle-label',.54,.65,.04,0,.13,-.425,light);box('label-bolt',.16,.43,.045,.03,.13,-.45,tint).rotation.z=-.34;
 }else if(kind==='ammo'){
  box('grenade-holder',1.65,.22,1.0,0,-.47,0,dark);
  for(const x of [-.48,0,.48]){cylinder('grenade',.41,.72,x,.0,0,tint);cylinder('grenade-cap',.25,.16,x,.44,0,light);box('grenade-lever',.1,.48,.09,x+.19,.32,0,dark).rotation.z=.2;}
 }else{
  const tube=cylinder('launcher-tube',.48,2.25,0,.1,0,dark);tube.rotation.z=Math.PI/2;cylinder('rocket-warhead',.45,.65,-.7,.1,0,tint,0).rotation.z=Math.PI/2;
  box('launcher-grip',.2,.52,.22,.3,-.28,0,light);box('launcher-sight',.42,.13,.16,.26,.47,0,light);
  for(const z of [-.2,.2])box('rocket-fin',.5,.4,.06,.86,.1,z,tint);
 }
 const model=Mesh.MergeMeshes(parts,true,true,undefined,false,false)!;model.parent=root;model.material=resources(scene).model;model.isPickable=false;
 const label=MeshBuilder.CreatePlane('pickup-name-'+kind,{width:8.3,height:1.82},scene);label.parent=root;label.position.y=2.15;label.billboardMode=Mesh.BILLBOARDMODE_ALL;label.material=labelMaterial(scene,kind);label.isPickable=false;label.renderingGroupId=1;
 return {root,label,update(time:number){model.rotation.y=time*.8;root.position.y=.9+Math.sin(time*2)*.12;},dispose(){root.dispose(false,false);}};
}
