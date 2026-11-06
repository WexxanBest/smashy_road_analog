import { ArcRotateCamera, Color3, Color4, DirectionalLight, Engine, HemisphericLight, MeshBuilder, Scene, StandardMaterial, Vector3 } from '@babylonjs/core';
import { CARS, type CarSpec, type VehicleVisual } from '../src/types';
import { CIVILIAN_FLEET } from '../src/vehicle-fleet';
import { policeSpec } from '../src/gameplay';
import { createVehicle } from '../src/vehicles';
import { createPatrolBoat } from '../src/special-vehicles';

const canvas=document.querySelector<HTMLCanvasElement>('#preview')!,engine=new Engine(canvas,true,{preserveDrawingBuffer:true,stencil:true}),scene=new Scene(engine);
scene.clearColor=new Color4(.22,.29,.23,1);
const camera=new ArcRotateCamera('fleet-camera',Math.PI/3,1.10,8,new Vector3(0,1,0),scene);camera.attachControl(canvas,true);camera.lowerRadiusLimit=4;camera.upperRadiusLimit=14;camera.wheelPrecision=35;
const ambient=new HemisphericLight('ambient',new Vector3(.3,1,.2),scene);ambient.intensity=.85;ambient.groundColor=new Color3(.40,.46,.36);
const sun=new DirectionalLight('sun',new Vector3(-.4,-1,-.35),scene);sun.intensity=.7;
const ground=MeshBuilder.CreateGround('matte-stage',{width:200,height:200},scene),material=new StandardMaterial('matte-stage-material',scene);material.diffuseColor=new Color3(.34,.42,.31);material.specularColor=Color3.Black();ground.material=material;
const group=document.querySelector<HTMLSelectElement>('#group')!,model=document.querySelector<HTMLSelectElement>('#model')!,compact=document.querySelector<HTMLInputElement>('#compact')!,damage=document.querySelector<HTMLButtonElement>('#damage')!;
const groups:Record<string,CarSpec[]>={player:CARS,traffic:CIVILIAN_FLEET,police:[policeSpec('patrol'),policeSpec('patrol',1),policeSpec('interceptor'),policeSpec('suv'),policeSpec('suv',1),policeSpec('swat'),policeSpec('swat',1),policeSpec('swat',2),{...policeSpec('patrol'),id:'police-motorcycle',name:'MOTO PATROL',subtitle:'Дорожный полицейский мотоцикл',visualVariant:'motorcycle',width:.96,length:2.7}],water:[{...policeSpec('patrol'),id:'police-boat',name:'HARBOUR PATROL',subtitle:'Катер преследует и обстреливает нарушителя у причалов',width:1.9,length:4.8}]};
const waterOption=document.createElement('option');waterOption.value='water';waterOption.textContent='Патрульный катер';group.append(waterOption);
const query=new URLSearchParams(location.search);group.value=groups[query.get('group')??'']?query.get('group')!:'player';
let visual:VehicleVisual|undefined,damaged=false;
function metrics(){
  if(!visual)return;const meshes=visual.root.getChildMeshes().filter(mesh=>mesh.isEnabled()&&mesh.isVisible);
  const stats={id:groups[group.value][model.selectedIndex].id,meshes:meshes.length,vertices:meshes.reduce((n,m)=>n+m.getTotalVertices(),0),triangles:meshes.reduce((n,m)=>n+m.getTotalIndices()/3,0),wheels:visual.wheels.length,compact:compact.checked,damaged};
  document.querySelector('#metrics')!.textContent=`${stats.meshes} мешей · ${stats.triangles.toLocaleString('ru-RU')} треугольников · ${stats.wheels} колёс`;
  document.documentElement.dataset.model=JSON.stringify(stats);
}
function select(){
  visual?.dispose();damaged=false;damage.textContent='Повреждения';const car=groups[group.value][model.selectedIndex];
  visual=group.value==='water'?createPatrolBoat(scene):createVehicle(scene,car,car.color,group.value as 'player'|'police'|'traffic');visual.setCompact?.(compact.checked);
  material.diffuseColor=group.value==='water'?new Color3(.31,.5,.56):new Color3(.34,.42,.31);
  camera.radius=Math.max(7.2,car.length*1.65);camera.target.set(0,car.visualVariant==='command'?1.6:car.bodyStyle==='van'?1.35:.94,0);
  document.querySelector('#name')!.textContent=car.name;document.querySelector('#description')!.textContent=car.subtitle;
  history.replaceState(null,'',`?group=${group.value}&index=${model.selectedIndex}`);metrics();
}
function changeGroup(index=0){model.replaceChildren(...groups[group.value].map((car,i)=>{const option=document.createElement('option');option.value=String(i);option.textContent=car.name;return option;}));model.selectedIndex=Math.max(0,Math.min(groups[group.value].length-1,index));select();}
group.addEventListener('change',()=>changeGroup());model.addEventListener('change',select);
document.querySelector('#previous')!.addEventListener('click',()=>{model.selectedIndex=(model.selectedIndex+model.options.length-1)%model.options.length;select();});
document.querySelector('#next')!.addEventListener('click',()=>{model.selectedIndex=(model.selectedIndex+1)%model.options.length;select();});
compact.addEventListener('change',()=>{visual?.setCompact?.(compact.checked);metrics();});
damage.addEventListener('click',()=>{damaged=!damaged;visual?.setDamage(damaged?.2:1,damaged?.35:1);for(const mesh of visual?.popDebris?.()??[])mesh.dispose(false,true);damage.textContent=damaged?'Восстановить':'Повреждения';metrics();});
changeGroup(Number(query.get('index'))||0);engine.runRenderLoop(()=>scene.render());window.addEventListener('resize',()=>engine.resize());
