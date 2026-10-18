import {Engine,Scene,Color3,Color4,Vector3,Quaternion,Matrix,ArcRotateCamera,HemisphericLight,DirectionalLight,ShadowGenerator,Mesh,MeshBuilder,VertexData,Material,PBRMaterial,StandardMaterial,TransformNode,Viewport} from '@babylonjs/core';
import {createModels,createTurret,modelStats,exportModelGltf,hexToColor} from './models/model-library.mjs';

const $=id=>document.getElementById(id),canvas=$('viewport');
const models=createModels();
const engine=new Engine(canvas,true,{preserveDrawingBuffer:true,stencil:true,antialias:true,adaptToDeviceRatio:true});
engine.setHardwareScalingLevel(Math.max(1,window.devicePixelRatio/1.5));
const scene=new Scene(engine);scene.useRightHandedSystem=true;scene.clearColor=new Color4(.807,.816,.780,1);
scene.ambientColor=new Color3(.52,.55,.47);
const camera=new ArcRotateCamera('Студийная камера',1.12,1.07,18,new Vector3(0,.65,0),scene);
camera.attachControl(canvas,true);camera.lowerBetaLimit=.16;camera.upperBetaLimit=1.48;camera.lowerRadiusLimit=3.6;camera.upperRadiusLimit=36;camera.wheelPrecision=26;camera.pinchPrecision=100;camera.panningSensibility=95;camera.inertia=.82;camera.fov=.51;camera.minZ=.05;
camera.panningAxis=new Vector3(1,1,1);camera.keysUp=[];camera.keysDown=[];camera.keysLeft=[];camera.keysRight=[];
const hemi=new HemisphericLight('Рассеянный свет',new Vector3(0,1,0),scene);hemi.intensity=.65;hemi.groundColor=new Color3(.43,.44,.39);hemi.diffuse=new Color3(.92,.95,.89);hemi.specular=new Color3(.25,.25,.21);
const key=new DirectionalLight('Мягкий солнечный свет',new Vector3(-.55,-1,-.38),scene);key.position=new Vector3(8,13,8);key.intensity=1.65;key.diffuse=new Color3(1,.94,.81);key.shadowMinZ=1;key.shadowMaxZ=45;
const shadow=new ShadowGenerator(2048,key);shadow.useContactHardeningShadow=true;shadow.contactHardeningLightSizeUVRatio=.05;shadow.filteringQuality=ShadowGenerator.QUALITY_HIGH;shadow.darkness=.22;shadow.bias=.0004;shadow.normalBias=.015;
const floor=MeshBuilder.CreateGround('Студийный пол',{width:100,height:100},scene);floor.receiveShadows=true;
const floorMat=new PBRMaterial('Теплый матовый бетон',scene);floorMat.albedoColor=new Color3(.55,.57,.51);floorMat.metallic=0;floorMat.roughness=1;floorMat.environmentIntensity=0;floor.material=floorMat;

// Sparse pavement seams give the concepts a sense of scale without textures.
const seamMat=new StandardMaterial('Тонкие швы пола',scene);seamMat.diffuseColor=new Color3(.70,.73,.66);seamMat.specularColor=Color3.Black();seamMat.alpha=.23;
for(let i=-5;i<=5;i++)for(const dir of [0,1]){const seam=MeshBuilder.CreateBox('Шов',{width:dir?28:.009,height:.001,depth:dir?.009:28},scene);seam.position.set(dir?0:i*2.4,.002,dir?i*2.4:0);seam.material=seamMat;}

const instances=[];let current=-1,paintOverrides=new Map(),autoRotate=false,wire=false;let lastInteraction=0;
function makeInstance(model,index) {
  const materials={};
  for(const [name,m] of Object.entries(model.materials)){
    const material=new PBRMaterial(model.id+'/'+name,scene);material.albedoColor=new Color3(...m.color.slice(0,3));material.metallic=m.metallic??0;material.roughness=m.roughness??.7;material.environmentIntensity=.65;material.directIntensity=1;
    if(m.emissive)material.emissiveColor=new Color3(...m.emissive);materials[name]=material;
  }
  const meshes=[],rotors=[];
  const walk=(n,parent)=>{
    let node;
    if(n.geometry){node=new Mesh(n.name,scene);const data=new VertexData();data.positions=n.geometry.positions;data.normals=n.geometry.normals;data.indices=n.geometry.indices;data.applyToMesh(node);node.material=materials[n.material];
      // glTF geometry is CCW. Babylon's raw Mesh defaults to CW in a RH scene;
      // its built-in MeshBuilder compensates, while these custom buffers do not.
      node.sideOrientation=Material.CounterClockWiseSideOrientation;
      node.receiveShadows=true;shadow.addShadowCaster(node);meshes.push(node);}
    else node=new TransformNode(n.name,scene);
    node.parent=parent??null;node.position=new Vector3(...(n.translation??[0,0,0]));if(n.rotation)node.rotationQuaternion=new Quaternion(...n.rotation);if(n.animate==='rotor')rotors.push(node);
    for(const child of n.children??[])walk(child,node);return node;
  };
  const root=walk(model.root);let turret;
  if(!model.isProp&&model.id!=='interceptor'){const mount=new TransformNode('Съемная турель / крепление',scene);mount.parent=root;mount.position.y=model.mountY;turret=walk(createTurret(),mount);turret.setEnabled(false);}
  const label=document.createElement('div');label.className='model-label';label.innerHTML=`<i style="--label-color:${model.color}"></i>${model.title}<small>0${index+1}</small>`;$('labels').append(label);
  root.setEnabled(false);return {model,root,materials,meshes,rotors,turret,label};
}
models.forEach((m,i)=>instances.push(makeInstance(m,i)));

models.forEach((model,i)=>{
  const b=document.createElement('button');b.dataset.index=i;
  if(i<3){b.className='model-button';b.innerHTML=`<span class="index">0${i+1}</span><span><strong>${model.title}</strong><small>${model.subtitle}</small></span><span class="arrow">↗</span>`;$('model-list').append(b);}
  else{b.textContent=i===3?'Полиция / INTERCEPTOR':'Ветротурбина / 3 лопасти';$('extra-list').append(b);}
  b.addEventListener('click',()=>select(i));
});

function formatCount(value){return new Intl.NumberFormat('ru-RU').format(value);}
function setColor(color) {
  const targets=current<0?instances.slice(0,3):[instances[current]];
  for(const instance of targets){instance.materials.paint.albedoColor=new Color3(...hexToColor(color).slice(0,3));paintOverrides.set(instance.model.id,color);}
  $('color-name').textContent=color.toUpperCase();$('custom-color').value=color;
  document.querySelectorAll('[data-color]').forEach(b=>b.classList.toggle('selected',b.dataset.color===color));
}
function updateInfo() {
  const withTurret=$('turret-toggle').checked;
  let triangles;
  if(current<0){$('model-index').textContent='01 — 03 / КОНЦЕПТЫ МАШИНЫ ИГРОКА';$('model-title').textContent='Три характера DUSTLINE';$('model-description').textContent='Короткий хэтчбек, высокий внедорожник и длинный пикап. Выберите кузов слева, чтобы рассмотреть детали и скачать модель.';$('traits').innerHTML='<span>Наклонные окна</span><span>12-гранные колеса</span><span>Съемная турель</span>';triangles=instances.slice(0,3).reduce((s,i)=>s+modelStats(i.model,withTurret).triangles,0);$('dimensions').textContent='Три самостоятельных кузова, без подмены пропорций масштабом';}
  else{const m=models[current];$('model-index').textContent=current<3?`0${current+1} / 03 · ВАРИАНТ ИГРОКА`:'ДОПОЛНИТЕЛЬНЫЙ КОНЦЕПТ';$('model-title').textContent=m.title;$('model-description').textContent=m.description;$('traits').innerHTML=m.traits.map(t=>`<span>${t}</span>`).join('');triangles=modelStats(m,withTurret).triangles;$('dimensions').textContent=m.dimensions+' · габариты концепта';}
  $('triangle-count').textContent=formatCount(triangles);$('download').disabled=current<0;
  $('animation-hint').textContent=current===4?'● Ротор вращается · 8 секунд на оборот':'';
}
function setCamera(alpha,beta,radius,target){camera.alpha=alpha;camera.beta=beta;camera.radius=radius;camera.setTarget(new Vector3(...target),false,true,true);camera.inertialAlphaOffset=0;camera.inertialBetaOffset=0;camera.inertialRadiusOffset=0;}
function select(index,resetCamera=true) {
  current=index;$('overview').classList.toggle('active',index<0);
  document.querySelectorAll('[data-index]').forEach(b=>b.classList.toggle('active',Number(b.dataset.index)===index));
  for(let i=0;i<instances.length;i++){
    const inst=instances[i];inst.root.setEnabled(index<0?i<3:i===index);inst.label.style.display=index<0&&i<3?'block':'none';
    inst.root.position.set(index<0?(i===0?-4.15:i===2?4.35:0):0,0,index<0?(i===0?.30:i===2?-.30:0):0);
  }
  const canTurret=index<0||(index<3);$('turret-toggle').disabled=!canTurret;$('turret-hint').textContent=canTurret?'Отдельный модуль':index===3?'Место занято световой балкой':'Объект окружения';
  const fixedColor=index===4;
  $('palette').classList.toggle('disabled',fixedColor);document.querySelectorAll('[data-color]').forEach(b=>b.disabled=fixedColor);$('custom-color').disabled=fixedColor;
  const color=index<0?undefined:paintOverrides.get(models[index].id);$('color-name').textContent=fixedColor?'Материалы башни фиксированы':color?color.toUpperCase():index<0?'Авторские цвета':models[index].color.toUpperCase();
  document.querySelectorAll('[data-color]').forEach(b=>b.classList.toggle('selected',b.dataset.color===(color??(index<0?'':models[index].color))));
  if(resetCamera){if(index<0)setCamera(1.24,1.02,23.6,[.45,.78,0]);else if(models[index].isProp)setCamera(1.04,1.18,30,[0,5.5,0]);else setCamera(1.03,1.06,index===2?12.4:index===1?12.3:11.2,[0,.45,0]);}
  updateInfo();
}
$('overview').addEventListener('click',()=>select(-1));
document.querySelectorAll('[data-color]').forEach(b=>b.addEventListener('click',()=>setColor(b.dataset.color)));
$('custom-color').addEventListener('input',e=>setColor(e.target.value));
$('turret-toggle').addEventListener('change',()=>{for(const i of instances)i.turret?.setEnabled($('turret-toggle').checked);updateInfo();});
$('rotate-toggle').addEventListener('change',()=>autoRotate=$('rotate-toggle').checked);
$('wire-toggle').addEventListener('change',()=>{wire=$('wire-toggle').checked;for(const i of instances)for(const material of Object.values(i.materials))material.wireframe=wire;});
$('reset').addEventListener('click',()=>{for(const i of current<0?instances.slice(0,3):[instances[current]]){i.materials.paint.albedoColor=new Color3(...i.model.materials.paint.color.slice(0,3));paintOverrides.delete(i.model.id);}select(current);});
canvas.addEventListener('pointerdown',()=>{lastInteraction=performance.now();autoRotate=false;$('rotate-toggle').checked=false;});
canvas.addEventListener('wheel',()=>lastInteraction=performance.now(),{passive:true});
for(const [id,alpha,beta] of [['front-view',Math.PI/2,1.36],['side-view',0,1.36],['top-view',Math.PI/2,.16]])$(id).addEventListener('click',()=>{camera.alpha=alpha;camera.beta=beta;camera.setTarget(new Vector3(current<0?.1:0,current===4?5.5:.45,0),false,true,true);});
$('download').addEventListener('click',()=>{
  if(current<0)return;const model=models[current],turret=$('turret-toggle').checked;
  const json=exportModelGltf(model,{paint:paintOverrides.get(model.id),turret});const blob=new Blob([JSON.stringify(json)],{type:'model/gltf+json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=model.id+(turret&&current<3?'-with-turret':'')+'.gltf';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});

engine.runRenderLoop(()=>{
  const dt=Math.min(engine.getDeltaTime()/1000,.05);
  if(autoRotate&&performance.now()-lastInteraction>1000)camera.alpha+=dt*.14;
  for(const inst of instances)if(inst.root.isEnabled())for(const rotor of inst.rotors)rotor.rotation.z-=dt*Math.PI/4;
  scene.render();
  if(current<0){const viewport=new Viewport(0,0,engine.getRenderWidth(),engine.getRenderHeight());for(const inst of instances.slice(0,3)){
    const p=Vector3.Project(new Vector3(inst.root.position.x,.025,inst.root.position.z+2.25),Matrix.Identity(),scene.getTransformMatrix(),viewport);
    inst.label.style.left=(p.x/engine.getRenderWidth()*canvas.clientWidth)+'px';inst.label.style.top=(p.y/engine.getRenderHeight()*canvas.clientHeight)+'px';
  }}
});
const resize=()=>engine.resize();window.addEventListener('resize',resize);new ResizeObserver(resize).observe(canvas);
select(-1);$('loading').style.display='none';
window.__DUSTLINE_MODEL_REVIEW__={models:models.map(m=>({id:m.id,...modelStats(m)})),select,current:()=>current,scene};



