import { Color3, DynamicTexture, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, VertexBuffer } from '@babylonjs/core';
import { conceptBox } from './vehicle-concepts';

export type PickupKind = 'cash' | 'repair' | 'ammo' | 'nitro' | 'rocket' | 'tire' | 'armor' | 'magnet' | 'smoke' | 'spikes' | 'emp' | 'drone';
export const PICKUP_INFO:Record<PickupKind,{name:string;label:string;color:string;message:string}>={
 cash:{name:'ДОБЫЧА',label:'ДОБЫЧА +80',color:'#f3d85d',message:'+$80 · добыча'},
 repair:{name:'РЕМОНТ',label:'РЕМОНТ +25',color:'#ff786a',message:'Ремкомплект · кузов +25, мотор и шины +15'},
 ammo:{name:'ГРАНАТЫ',label:'ГРАНАТЫ +3',color:'#f2a563',message:'+3 гранаты · ПКМ'},
 nitro:{name:'НИТРО',label:'НИТРО +45',color:'#63cfff',message:'Нитро +45% · Shift'},
 rocket:{name:'РАКЕТЫ',label:'РАКЕТЫ +3',color:'#c6a0ff',message:'Ракеты +3 · нажми 2 для выбора ракетницы.'},
 tire:{name:'ШИНЫ',label:'ШИНЫ 100%',color:'#f6a957',message:'Запасное колесо · шины восстановлены'},
 armor:{name:'БРОНЕПАНЕЛЬ',label:'КУЗОВ +35',color:'#86a9dc',message:'Бронепанель · кузов +35'},
 magnet:{name:'МАГНИТ',label:'МАГНИТ · 15 С',color:'#f27e73',message:'Магнит · притягивает добычу с 14 м в течение 15 с'},
 smoke:{name:'ДЫМ',label:'ДЫМ · 8 С',color:'#b5a5de',message:'Дымовая завеса · скрывает от полиции на 8 с'},
 spikes:{name:'ШИПЫ',label:'ШИПЫ · 20 С',color:'#e6ac58',message:'Шипы позади машины · замедляют преследователей, лежат 20 с'},
 emp:{name:'EMP',label:'EMP · 6 С',color:'#a69dea',message:'EMP · отключает полицию в радиусе 28 м на 6 с'},
 drone:{name:'РАЗВЕДКА',label:'ДРОН · 20 С',color:'#71d4cb',message:'Дрон · открывает карту и отмечает угрозы до 180 м на 20 с'}
};
interface Resources { model:StandardMaterial;labels:Map<PickupKind,StandardMaterial>;models:Map<string,Mesh>;labelModels:Map<PickupKind,Mesh>; }
const caches=new WeakMap<Scene,Resources>();
function resources(scene:Scene):Resources {
 let result=caches.get(scene);if(result)return result;
 const model=new StandardMaterial('supply-model-vertex-colors',scene);model.diffuseColor=Color3.White();model.emissiveColor=new Color3(.22,.22,.22);model.specularColor=Color3.Black();
 result={model,labels:new Map(),models:new Map(),labelModels:new Map()};caches.set(scene,result);return result;
}
function labelMaterial(scene:Scene,kind:PickupKind):StandardMaterial {
 const shared=resources(scene),cached=shared.labels.get(kind);if(cached)return cached;
 const info=PICKUP_INFO[kind],texture=new DynamicTexture('supply-label-'+kind,{width:512,height:112},scene,false);
 const ctx=texture.getContext() as CanvasRenderingContext2D;ctx.clearRect(0,0,512,112);ctx.fillStyle='#16201e';ctx.fillRect(2,8,508,96);ctx.fillStyle=info.color;ctx.fillRect(2,8,12,96);ctx.strokeStyle=info.color;ctx.lineWidth=3;ctx.strokeRect(2,8,508,96);ctx.font='bold 43px Arial';ctx.textBaseline='middle';ctx.textAlign='center';ctx.fillStyle='#fffbea';ctx.fillText(info.label,263,58);texture.update();
 const mat=new StandardMaterial('supply-label-material-'+kind,scene);mat.diffuseTexture=texture;mat.opacityTexture=texture;mat.emissiveColor=Color3.White();mat.disableLighting=true;mat.backFaceCulling=false;texture.hasAlpha=true;shared.labels.set(kind,mat);return mat;
}
/** A recognisable object silhouette and a readable world label share cached materials. */
export function createSupply(scene:Scene,kind:PickupKind,presentation:'pickup'|'equipment'='pickup'){
 const root=new TransformNode('supply-'+kind,scene),info=PICKUP_INFO[kind],tint=Color3.FromHexString(info.color),light=Color3.FromHexString('#fff4db'),dark=Color3.FromHexString('#263739');
 const shared=resources(scene),templateKey=kind+':'+presentation;
 function instance(template:Mesh){
  const model=template.clone('pickup-model-'+kind,root,true)!;model.setEnabled(true);
  let labelTemplate=shared.labelModels.get(kind);
  if(!labelTemplate){labelTemplate=MeshBuilder.CreatePlane('pickup-label-template-'+kind,{width:8.3,height:1.82},scene);labelTemplate.position.y=2.15;labelTemplate.billboardMode=Mesh.BILLBOARDMODE_ALL;labelTemplate.material=labelMaterial(scene,kind);labelTemplate.isPickable=false;labelTemplate.renderingGroupId=1;labelTemplate.setEnabled(false);shared.labelModels.set(kind,labelTemplate);}
  const label=labelTemplate.clone('pickup-name-'+kind,root,true)!;label.setEnabled(true);
  return {root,label,update(time:number){model.rotation.y=time*.8;root.position.y=.9+Math.sin(time*2)*.12;},dispose(){root.dispose(false,false);}};
 }
 const cached=shared.models.get(templateKey);if(cached)return instance(cached);
 const parts:Mesh[]=[];
 function add(m:Mesh,color:Color3){const colors=new Float32Array(m.getTotalVertices()*4);for(let i=0;i<m.getTotalVertices();i++)colors.set([color.r,color.g,color.b,1],i*4);m.setVerticesData(VertexBuffer.ColorKind,colors);m.material=resources(scene).model;m.isPickable=false;parts.push(m);return m;}
 function box(name:string,w:number,h:number,d:number,x:number,y:number,z:number,color=tint){const m=conceptBox(scene,name,w,h,d,.04);m.position.set(x,y,z);return add(m,color);}
 function cylinder(name:string,diameter:number,height:number,x:number,y:number,z:number,color=tint,top=diameter){const m=MeshBuilder.CreateCylinder(name,{diameterBottom:diameter,diameterTop:top,height,tessellation:8},scene);m.position.set(x,y,z);return add(m,color);}
 if(presentation==='pickup')cylinder('supply-round-base',2.25,.1,0,-.72,0,tint.scale(.65));
 const crate=(color:Color3)=>{box('crate-floor',1.8,.18,1.05,0,-.52,0,color);for(const z of [-.51,.51])box('crate-rail',1.8,.35,.09,0,-.32,z,color);for(const x of [-.85,.85])for(const z of [-.48,.48])box('crate-corner',.13,.46,.13,x,-.29,z,light);};
 if(kind==='cash'){
  crate(tint);
  for(const [x,z,n] of [[-.42,-.2,3],[.34,.19,4],[.6,-.5,2]])for(let i=0;i<n;i++)cylinder('gold-coin',.83,.16,x,-.5+i*.17,z,light);
  box('cash-bundle',.85,.35,.45,-.3,.27,.28,tint);box('bundle-band',.14,.37,.47,-.3,.27,.28,light);
 }else if(kind==='repair'){
  box('toolbox',1.55,.84,.84,0,-.1,0);box('toolbox-lid',1.65,.12,.94,0,.36,0,light);box('handle-left',.12,.35,.13,-.3,.56,0,dark);box('handle-right',.12,.35,.13,.3,.56,0,dark);box('toolbox-handle',.72,.12,.15,0,.72,0,dark);
  box('repair-cross-horizontal',.85,.16,.035,0,-.05,-.44,light);box('repair-cross-vertical',.18,.6,.035,0,-.05,-.45,light);box('top-cross-x',.65,.04,.18,0,.44,0,tint);box('top-cross-z',.18,.04,.65,0,.44,0,tint);
  for(const x of [-.7,.7])for(const z of [-.38,.38]){box('toolbox-corner',.2,.25,.2,x,-.4,z,dark);box('toolbox-lid-corner',.2,.18,.2,x,.35,z,dark);}for(const x of [-.46,.46])box('toolbox-latch',.13,.3,.06,x,.2,-.48,light);
 }else if(kind==='nitro'){
  box('nitro-jerrycan',1.32,1.25,.72,0,.03,0);box('can-inset',.96,.83,.04,0,.02,-.38,tint.scale(.8));cylinder('can-cap',.4,.16,-.38,.74,0,light);
  for(const x of [.07,.57])box('can-handle-leg',.12,.3,.19,x,.8,0,tint);box('can-handle',.62,.12,.19,.32,.98,0,tint);
  box('can-bolt',.18,.62,.04,.06,.05,-.42,light).rotation.z=-.35;
  for(const x of [-.57,.57])box('can-foot',.2,.2,.79,x,-.52,0,dark);
 }else if(kind==='ammo'){
  crate(Color3.FromHexString('#647147'));
  for(const x of [-.48,0,.48]){cylinder('grenade',.41,.72,x,.0,0,tint);cylinder('grenade-cap',.25,.16,x,.44,0,light);box('grenade-lever',.1,.48,.09,x+.19,.32,0,dark).rotation.z=.2;}
 }else if(kind==='rocket'){
  crate(tint.scale(.65));for(const x of [-.55,0,.55]){cylinder('rocket-body',.35,1.1,x,.22,0,light);cylinder('rocket-tip',.35,.48,x,1.0,0,tint,0);for(const z of [-.17,.17])box('rocket-fin',.48,.28,.06,x,-.25,z,tint);}
 }else if(kind==='tire'){
  cylinder('spare-tire',1.48,.4,-.12,.04,0,dark).rotation.x=Math.PI/2;cylinder('spare-rim',.9,.42,-.12,.04,0,light).rotation.x=Math.PI/2;cylinder('spare-hub',.31,.45,-.12,.04,0,dark).rotation.x=Math.PI/2;
  box('wheel-strap',.15,1.5,.44,-.12,.04,0,tint);box('jack-case',.68,.45,.5,.7,-.41,-.2,tint);box('tire-wrench',1.25,.1,.13,0,-.6,-.45,light).rotation.y=.25;
 }else if(kind==='armor'){
  box('armor-panel',1.45,1.5,.3,0,.1,0,tint);box('armor-inset',1.19,1.2,.08,0,.1,-.19,tint.scale(.7));
  for(const x of [-.61,.61])for(const y of [-.52,.72])box('armor-corner',.24,.22,.39,x,y,0,light);
  const shield=cylinder('armor-emblem',.57,.065,0,.12,-.26,light,.42);shield.rotation.x=Math.PI/2;
 }else if(kind==='magnet'){
  // Upright U silhouette, contrasting pole ends and attracted coins.
  box('magnet-left-leg',.37,1.14,.43,-.47,.19,0);box('magnet-right-leg',.37,1.14,.43,.47,.19,0);box('magnet-bottom',1.28,.35,.43,0,-.37,0);
  for(const x of[-.47,.47]){box('magnet-pole',.39,.31,.46,x,.8,0,light);box('pole-seam',.40,.055,.47,x,.62,0,dark);}
  for(const [x,y,z]of[[-.38,1.2,.16],[.18,1.41,-.16],[.6,1.13,.12]]){const coin=cylinder('magnet-gold',.38,.09,x,y,z,Color3.FromHexString('#f1d15e'));coin.rotation.x=Math.PI/2;}
 }else if(kind==='smoke'){
  cylinder('smoke-canister',1.02,1.12,0,.04,0,tint);cylinder('smoke-top',1.06,.15,0,.67,0,light);cylinder('smoke-base',1.06,.15,0,-.58,0,dark);
  box('smoke-handle-left',.1,.31,.14,-.26,.86,0,dark);box('smoke-handle-right',.1,.31,.14,.26,.86,0,dark);box('smoke-handle',.62,.1,.14,0,1.02,0,dark);
  box('cloud-symbol-base',.61,.17,.03,0,.07,-.52,light);for(const [x,y,d]of[[-.2,.16,.24],[0,.25,.33],[.2,.15,.25]])cylinder('cloud-symbol',d,.04,x,y,-.54,light).rotation.x=Math.PI/2;
  const puff=cylinder('smoke-puff',.41,.29,.48,.88,.1,light,.26);puff.rotation.z=-.42;cylinder('smoke-puff-small',.29,.25,.63,1.13,.1,tint.scale(1.05),.17);
 }else if(kind==='spikes'){
  box('spike-case',1.76,.24,.93,0,-.48,0,dark);for(const x of[-.78,.78])box('spike-case-edge',.12,.34,.99,x,-.44,0,tint);
  for(const x of[-.57,-.19,.19,.57]){box('spike-strip-section',.32,.12,.64,x,-.25,0,light);cylinder('spike-cone',.28,.68,x,.15,0,tint,0);}
  box('spike-grip-left',.08,.17,.09,-.28,-.43,-.58,light);box('spike-grip-right',.08,.17,.09,.28,-.43,-.58,light);box('spike-grip',.64,.08,.09,0,-.43,-.67,light);
 }else if(kind==='emp'){
  box('emp-unit',1.37,1.02,.85,0,0,0,tint);box('emp-top',1.42,.15,.90,0,.58,0,Color3.FromHexString('#72d9cf'));box('emp-front',1.06,.77,.045,0,0,-.46,tint.scale(.65));
  for(const x of[-.6,.6])for(const z of[-.36,.36])box('emp-corner',.2,1.06,.2,x,0,z,dark);
  for(const x of[-.42,.42]){cylinder('emp-antenna',.12,.47,x,.85,.06,dark);cylinder('emp-tip',.2,.15,x,1.14,.06,light);}
  box('emp-bolt-top',.20,.45,.055,-.08,.18,-.50,light).rotation.z=-.38;box('emp-bolt-mid',.37,.13,.06,0,-.01,-.51,light);box('emp-bolt-base',.18,.44,.055,.09,-.2,-.50,light).rotation.z=-.38;
 }else if(kind==='drone'){
  box('scout-body',.78,.32,.72,0,.13,0,tint);box('scout-top',.53,.09,.49,0,.34,0,light);cylinder('scout-camera',.26,.20,0,-.05,-.39,dark).rotation.x=Math.PI/2;
  for(const x of[-1,1])for(const z of[-1,1]){const arm=box('drone-arm',.15,.13,.91,x*.38,.15,z*.38,dark);arm.rotation.y=x*z*Math.PI/4;cylinder('drone-motor',.24,.22,x*.72,.23,z*.72,tint);box('drone-propeller',.72,.045,.11,x*.72,.38,z*.72,light).rotation.y=x*z*.35;box('drone-landing-foot',.08,.38,.08,x*.3,-.2,z*.27,dark);}
 }
 const model=Mesh.MergeMeshes(parts,true,true,undefined,false,false)!;model.name='pickup-template-'+templateKey;model.material=shared.model;model.isPickable=false;model.setEnabled(false);shared.models.set(templateKey,model);
 return instance(model);
}
