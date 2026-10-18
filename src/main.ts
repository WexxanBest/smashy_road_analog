import { Engine, Scene, Vector3, Color3, Color4, FreeCamera, Camera, HemisphericLight, DirectionalLight, ShadowGenerator, MeshBuilder, StandardMaterial, Quaternion, PhysicsAggregate, PhysicsShapeType, HavokPlugin, Mesh, Plane, TransformNode, Matrix, Ray } from '@babylonjs/core';
import HavokPhysics from '@babylonjs/havok';
import havokUrl from '@babylonjs/havok/lib/esm/HavokPhysics.wasm?url';
import { CARS, PAINTS, defaultSave, normalizeSave, carUpgrades, upgradeCost, turretAvailable, TURRET_PRICE, turretCoolingCost } from './types';
import { PURSUIT_LEVELS, policeSpec, choosePoliceRole, safeTrafficSpeed, coolTurret, advanceChallenges, outsideSpawnViewport } from './gameplay';
import type { GameState, SaveData, CarSpec, VehicleVisual, WorldProp, RadarMarker, UpgradeKey, HandlingProfileId, HudLayout, WeaponKind, AimAssist, UIActions } from './types';
import { createVehicle } from './vehicles';
import { createWorld } from './world';
import { createUI } from './ui';
import { createEffects, createHelicopter } from './effects';
import { createSupply, PICKUP_INFO } from './pickups';
import type { PickupKind } from './pickups';
import { createRockets } from './rockets';
import type { HomingTarget } from './rockets';
import { GameAudio } from './audio';
import { handlingMemory, stepHandling } from './handling';
import type { HandlingMemory } from './handling';
import { createSkids } from './skids';
import { createGarage } from './garage';
import { createNavigation } from './navigation';
import { createAtlas } from './atlas';
import { createRecoil } from './recoil';
import { configureWreckPhysics, stepDisabledVehiclePhysics } from './wreck-physics';
import './style.css';

const canvas=document.querySelector<HTMLCanvasElement>('#game')!;
const container=document.querySelector<HTMLElement>('#ui')!;
const IS_QA=import.meta.env.DEV&&new URLSearchParams(location.search).has('qa');
const qaEvents:Record<string,unknown>[]=[];
function qaTrace(kind:string,details:Record<string,unknown>={}){if(!IS_QA)return;qaEvents.push({kind,wall:Date.now(),seconds:state.seconds,...details});while(qaEvents.length>30)qaEvents.shift();document.documentElement.dataset.qaTrace=JSON.stringify(qaEvents);}
const QA_CASE=IS_QA?(new URLSearchParams(location.search).get('case')??'').replace(/[^a-z0-9-]/gi,'').slice(0,40):'';
const SAVE_KEY=IS_QA?'dustline-qa-save-v2'+(QA_CASE?'-'+QA_CASE:''):'dustline-save-v1';
const SETTINGS_KEY=IS_QA?'dustline-qa-controls-v3'+(QA_CASE?'-'+QA_CASE:''):'dustline-controls-v3';
function readSettings(){try{const raw=JSON.parse(localStorage.getItem(SETTINGS_KEY)||'{}');const assist=(value:unknown):AimAssist=>value==='off'||value==='weak'?value:'standard';return {handlingProfile:(['arcade','balanced','drift','grip'].includes(raw.handlingProfile)?raw.handlingProfile:'arcade') as HandlingProfileId,pursuitEnabled:raw.pursuitEnabled!==false,trafficSide:(raw.trafficSide==='left'?'left':'right') as 'left'|'right',hudLayout:'minimal' as HudLayout,tutorialSeen:raw.tutorialSeen===true,turretAssist:assist(raw.turretAssist),rocketAssist:assist(raw.rocketAssist)};}catch{return {handlingProfile:'arcade' as HandlingProfileId,pursuitEnabled:true,trafficSide:'right' as const,hudLayout:'minimal' as HudLayout,tutorialSeen:false,turretAssist:'standard' as const,rocketAssist:'standard' as const};}}
const settings=readSettings();
function readSave():SaveData {
 try {return normalizeSave(JSON.parse(localStorage.getItem(SAVE_KEY)||'null'));
 }catch{return defaultSave();}
}
let save=readSave(),sandboxNormalSave:SaveData|undefined;
function persist(){if(sandboxNormalSave)return;try{localStorage.setItem(SAVE_KEY,JSON.stringify(save));}catch{/* Private browsing can disable storage. */}}
const state:GameState={mode:'garage',speed:0,health:100,maxHealth:100,engine:100,tires:100,nitro:100,heat:0,ammo:8,wanted:0,escape:0,seconds:0,earned:0,kills:0,biome:'city',garageDistance:0,canGarage:true,message:'',messageTime:0,fps:60,traffic:0,seed:IS_QA&&new URLSearchParams(location.search).has('seed')?(Number(new URLSearchParams(location.search).get('seed'))||42):Math.floor(Math.random()*1000000),...settings,rockets:0,weapon:'turret',targetName:'',rocketReady:false,tutorialTime:0,turretEquipped:turretAvailable(save),sandbox:false,cheats:{invincible:false,unlimitedNitro:false,unlimitedAmmo:false,noOverheat:false},wantedOverride:-1};
persist();
function persistSettings(){try{localStorage.setItem(SETTINGS_KEY,JSON.stringify({handlingProfile:state.handlingProfile,pursuitEnabled:state.pursuitEnabled,trafficSide:state.trafficSide,hudLayout:state.hudLayout,tutorialSeen:settings.tutorialSeen,turretAssist:state.turretAssist,rocketAssist:state.rocketAssist}));}catch{/* Storage can be disabled. */}}
const engine=new Engine(canvas,true,{stencil:true,preserveDrawingBuffer:false,powerPreference:'high-performance'},false);
engine.setHardwareScalingLevel(Math.max(1,window.devicePixelRatio/1.45));
const scene=new Scene(engine);scene.clearColor=new Color4(.73,.79,.77,1);scene.fogMode=Scene.FOGMODE_LINEAR;scene.fogStart=95;scene.fogEnd=175;scene.fogColor=new Color3(.73,.79,.77);
const camera=new FreeCamera('chase',new Vector3(45,60,-45),scene);camera.mode=Camera.ORTHOGRAPHIC_CAMERA;camera.minZ=.1;camera.maxZ=240;camera.setTarget(Vector3.Zero());
const hemi=new HemisphericLight('sky',new Vector3(0,1,0),scene);hemi.intensity=.72;hemi.groundColor=new Color3(.55,.57,.48);
const sun=new DirectionalLight('sun',new Vector3(-.5,-1,.35),scene);sun.position=new Vector3(40,70,-35);sun.intensity=1.15;
const shadows=new ShadowGenerator(1024,sun);shadows.usePoissonSampling=true;shadows.bias=.001;shadows.normalBias=.035;shadows.setDarkness(.25);sun.shadowMinZ=1;sun.shadowMaxZ=170;
scene.imageProcessingConfiguration.contrast=1.12;scene.imageProcessingConfiguration.exposure=1.02;sun.diffuse=Color3.FromHexString('#ffe3b4');hemi.diffuse=Color3.FromHexString('#cbd8e3');
scene.metadata={shadowGenerator:shadows};
const world=createWorld(scene,state.seed),effects=createEffects(scene),skids=createSkids(scene),audio=new GameAudio();
audio.setVolumes(save.volumes);world.setExplosionHandler?.((at,damage)=>explosion(at,damage));
world.setTrafficSide?.(state.trafficSide);
const navigation=createNavigation(),recoil=createRecoil();
let missileBlockers:WorldProp[]=[];
const missiles=createRockets(scene,at=>{if(state.mode==='playing')explosion(at,165);},at=>effects.smoke(at),at=>at.y<7&&missileBlockers.some(p=>Math.hypot(p.x-at.x,p.z-at.z)<p.radius*.75));
const keys=new Set<string>();let mouseX=window.innerWidth/2,mouseY=window.innerHeight/2,mouseDown=false,grenadeDown=false;
let runActive=false,physicsReady=false,bootError='',frame=0,garageEntered=false;
let qaFreeDrive=false;
let player:Actor|undefined,police:Actor[]=[],traffic:Actor[]=[],helis:Heli[]=[],pickups:Pickup[]=[],grenades:Grenade[]=[];
const parked=new Map<string,Actor>(),parkedStates=new Map<string,{x:number;z:number;angle:number;health:number;carId:string;color:string}>(),destroyedParked=new Set<string>();
const debris:{mesh:Mesh;physics:PhysicsAggregate;life:number}[]=[],wrecks:{actor:Actor;life:number}[]=[];
let wantedClock=0,spawnClock=0,trafficClock=0,pickupClock=0,fireClock=0,grenadeClock=0,rocketClock=0,overheated=false,damageClock=0,proxyClock=0,collisionClock=0,parkedClock=0;
let startGrace=6,peaceUntil=0,lastReportedBiome='city',lastSpeed=0,safeGarageTime=0;
const carConditions=new Map<string,{health:number;engine:number;tires:number;nitro:number}>();
let roadblockLevel=1;
let heliClock=20,spawnSequence=0,helicopterSequence=0,peakWanted=0,escapedFiveStars=false,speedStreak=0,challengeSaveClock=0,cameraZoom=23,physicsAccumulator=0,renderDt=1/60;
let contractIndex=0,contractProgress=0,contractKills=0,contractSawWanted=false;
const contracts=[{label:'Проедь 600 метров',target:600,reward:250},{label:'Держи 60 км/ч в течение 15 секунд',target:15,reward:300},{label:'Выведи из строя 3 преследователей',target:3,reward:400},{label:'Сбрось преследование',target:1,reward:450}];
let aim=new Vector3(0,1,20),aimHeli:Heli|undefined;
let rocketTarget:HomingTarget|undefined;
let lastPrimary=0,lastSecondary=0,lastPointerDown=0,primaryPointerHandled=false;
const proxies=new Map<WorldProp,{mesh:Mesh;aggregate:PhysicsAggregate}>();
const tracked=new Vector3(7,0,10),velTemp=new Vector3(),angTemp=new Vector3();
interface Actor{visual:VehicleVisual;mesh:Mesh;physics:PhysicsAggregate;spec:CarSpec;color:string;health:number;maxHealth:number;angle:number;hitTime:number;kind:'player'|'police'|'traffic';prevSpeed:number;dynamics:HandlingMemory;slip:number;burnTime:number;exploded:boolean;fire?:TransformNode;nitroJets?:TransformNode[];roadblock?:boolean;parkedId?:string;control:{throttle:number;steer:number;handbrake:boolean;nitro:boolean};previousPosition:Vector3;previousAngle:number;disabled:boolean;}
interface Heli{visual:ReturnType<typeof createHelicopter>;health:number;fire:number;slot:number;phase:number;status:'flying'|'falling'|'wreck';fallTime:number;verticalSpeed:number;drift:Vector3;wreckLife:number;}
interface Pickup{visual:ReturnType<typeof createSupply>;mesh:TransformNode;kind:PickupKind;phase:number;}
interface Grenade{mesh:Mesh;start:Vector3;end:Vector3;time:number;duration:number;air?:Heli;}
function notice(text:string,duration=4){state.message=text;state.messageTime=duration;}
function chooseWeapon(weapon:WeaponKind){if(weapon==='turret'&&!state.turretEquipped){notice('Установи турель в гараже. Одна покупка — для всех твоих машин.',3);return;}state.weapon=weapon;mouseDown=false;}
function spec(){return CARS.find(c=>c.id===save.selected)!;}
function paintColor(){return save.colors[save.selected]||spec().color;}
function refreshMax(){if(runActive&&player?.spec.id!==save.selected)return;const max=spec().armor+carUpgrades(save).armor*30;state.health=runActive?Math.min(max,state.health+(max-state.maxHealth)):max;state.maxHealth=max;}

// A physical workshop scene; the active world remains intact during a pit stop.
const garage=createGarage(engine,spec,paintColor,()=>turretAvailable(save)),garageScene=garage.scene;
function refreshPreview(){state.turretEquipped=turretAvailable(save,runActive&&player?player.spec.id:save.selected);garage.refresh();refreshMax();if(runActive&&player?.spec.id===save.selected)garage.setCondition(state.health/state.maxHealth,state.tires/100);else{const condition=carConditions.get(save.selected);garage.setCondition(condition?condition.health/(spec().armor+carUpgrades(save).armor*30):1,condition?condition.tires/100:1);}}
refreshPreview();
function responsiveActions(actions:UIActions):UIActions {return new Proxy(actions,{get(target,key){const action=Reflect.get(target,key);return typeof action!=='function'?action:(...args:unknown[])=>{Reflect.apply(action,target,args);ui.render(state,save);};}});}
const ui=createUI(container,responsiveActions({
 start(){if(!physicsReady){notice(bootError||'Подготавливаем физику…');return;}if(!save.owned.includes(save.selected)){notice('Сначала купи выбранную машину.');return;}audio.start(save.music);if(runActive&&player)leaveGarage();else startRun();},
 selectCar(id){if(!CARS.some(c=>c.id===id))return;save.selected=id;persist();refreshPreview();},
 buyCar(id){const c=CARS.find(c=>c.id===id);if(!c||save.owned.includes(id))return;if(c.challengeId&&!state.sandbox){notice('Эта машина — награда за испытание. Условия указаны в каталоге.');return;}if(save.credits<c.price){notice('Недостаточно денег. Заработай в погоне.');return;}save.credits-=c.price;save.owned.push(id);save.selected=id;persist();refreshPreview();notice('Машина теперь твоя.');},
 paint(hex){if(!PAINTS.includes(hex))return;save.colors[save.selected]=hex;persist();garage.refresh();if(player&&player.spec.id===save.selected)player.visual.setColor(hex);},
 upgrade(key){if(!save.owned.includes(save.selected)){notice('Сначала получи эту машину.');return;}const u={...carUpgrades(save)},cost=upgradeCost(u[key],key);if(u[key]>=3)return;if(save.credits<cost){notice('Не хватает денег на улучшение.');return;}save.credits-=cost;u[key]++;save.upgrades[save.selected]=u;persist();refreshMax();notice('Улучшение установлено.');audio.effect('pickup');},
 repair(){if(runActive&&player?.spec.id!==save.selected){notice('Для ремонта выбери машину текущего заезда.');return;}if(state.health===state.maxHealth&&state.engine===100&&state.tires===100){notice('Машина уже в отличном состоянии.');return;}if(save.credits<150){notice('Для ремонта нужно $150.');return;}save.credits-=150;state.health=state.maxHealth;state.engine=state.tires=state.nitro=100;if(player){player.visual.setDamage(1,1);player.burnTime=0;player.fire?.setEnabled(false);}state.burnSeconds=0;garage.setCondition(1,1);persist();notice('Полный ремонт выполнен.');audio.effect('pickup');},
 resume(){if(state.mode==='paused')state.mode='playing';},
 garage(){if(state.mode==='gameover'){state.mode='garage';refreshPreview();}else if(state.wanted===0&&state.garageDistance<13)enterGarage();else notice('Сначала уйди от полиции и доберись до гаража.');},
 restart(){if(physicsReady){audio.start(save.music);startRun();}},
 toggleMusic(){save.music=!save.music;persist();audio.start(save.music);audio.toggle(save.music);},
 setHandling(profile){if(!['arcade','balanced','drift','grip'].includes(profile))return;state.handlingProfile=profile;persistSettings();notice(`Вождение: ${profile==='arcade'?'Аркада':profile==='drift'?'Дрифт':profile==='balanced'?'Баланс':'Сцепление'}. Можно переключать на ходу.`,3);},
 togglePursuit(){state.pursuitEnabled=!state.pursuitEnabled;persistSettings();if(!state.pursuitEnabled){police.forEach(disposeActor);police=[];helis.forEach(h=>h.visual.dispose());helis=[];state.wanted=0;state.escape=100;startGrace=0;peaceUntil=99999;wantedClock=0;notice('Преследование выключено. Спокойно тестируй вождение.',4);}else{qaFreeDrive=false;wantedClock=0;startGrace=6;peaceUntil=0;state.escape=0;notice('Преследование включено. Полиция заметит тебя через 6 секунд.',4);}},
 setHudLayout(layout){state.hudLayout=layout;persistSettings();},
 selectWeapon(weapon){chooseWeapon(weapon);},
 setTrafficSide(side){if(side!=='right'&&side!=='left')return;state.trafficSide=side;persistSettings();world.setTrafficSide?.(side);traffic.forEach(disposeActor);traffic=[];trafficClock=0;notice(side==='right'?'Правостороннее движение.':'Левостороннее движение.',2);},
 garageTab(tab){garage.setView(tab);},
 openMap(){if(player&&(state.mode==='playing'||state.mode==='paused'))atlas.toggle();},
 buyTurret(){if(save.turretOwned)return;if(save.credits<TURRET_PRICE){notice(`Турель стоит ${TURRET_PRICE} $.`);return;}save.credits-=TURRET_PRICE;save.turretOwned=true;save.turretEquipped[save.selected]=true;persist();if(player&&player.spec.id===save.selected)player.visual.setTurretEnabled?.(true);refreshPreview();notice('Турель куплена. Устанавливай её на любые свои машины.');},
 toggleTurret(){if(!save.turretOwned||!save.owned.includes(save.selected))return;save.turretEquipped[save.selected]=!save.turretEquipped[save.selected];persist();if(player&&player.spec.id===save.selected)player.visual.setTurretEnabled?.(turretAvailable(save));refreshPreview();},
 upgradeTurret(){if(!save.turretOwned||save.turretCooling>=3)return;const cost=turretCoolingCost(save.turretCooling);if(save.credits<cost){notice('Не хватает денег на охлаждение.');return;}save.credits-=cost;save.turretCooling++;persist();notice('Остывание турели ускорено для всех машин.');},
 setAimAssist(weapon,level){if(!['off','weak','standard'].includes(level))return;if(weapon==='turret')state.turretAssist=level;else state.rocketAssist=level;persistSettings();},
 toggleSandbox(){clearRun();runActive=false;Object.assign(state,{mode:'garage',speed:0,engine:100,tires:100,nitro:100,heat:0,ammo:8,rockets:0,burnSeconds:0,wanted:0,escape:0,seconds:0,earned:0,kills:0,targetName:'',rocketReady:false});overheated=false;if(!state.sandbox){sandboxNormalSave=normalizeSave(JSON.parse(JSON.stringify(save)));save=normalizeSave(JSON.parse(JSON.stringify(save)));save.credits=50000;save.owned=CARS.map(c=>c.id);save.turretOwned=true;for(const c of CARS)save.turretEquipped[c.id]=true;state.sandbox=true;notice('Песочница. Награды и рекорды обычной игры не изменяются.',6);}else{save=sandboxNormalSave??readSave();sandboxNormalSave=undefined;state.sandbox=false;state.cheats={invincible:false,unlimitedNitro:false,unlimitedAmmo:false,noOverheat:false};state.wantedOverride=-1;notice('Обычный прогресс восстановлен.');}carConditions.clear();refreshPreview();audio.setVolumes(save.volumes);audio.toggle(save.music);},
 setCheat(key,enabled){if(!state.sandbox)return;state.cheats[key]=enabled;if(key==='invincible'&&enabled&&player){state.health=state.maxHealth;state.engine=state.tires=100;state.burnSeconds=0;player.burnTime=0;player.exploded=false;player.visual.setDamage(1,1);}if(key==='noOverheat'&&enabled){state.heat=0;overheated=false;}},
 setWanted(level){if(!state.sandbox)return;state.wantedOverride=Math.max(-1,Math.min(5,Math.round(level)));if(state.wantedOverride>=0){state.wanted=state.wantedOverride;state.escape=0;startGrace=0;state.pursuitEnabled=true;spawnClock=0;heliClock=Math.min(heliClock,5);const policy=PURSUIT_LEVELS[state.wanted];while(police.length>policy.cars)disposeActor(police.pop()!);const live=helis.filter(h=>h.status==='flying');for(const h of live.slice(policy.helis)){h.visual.dispose();helis=helis.filter(v=>v!==h);}}},
 setVolume(channel,value){save.volumes[channel]=Math.max(0,Math.min(1,value));audio.setVolumes(save.volumes);persist();}
}));

const atlas=createAtlas(container,world,navigation,()=>updateWaypoint(),()=>{keys.clear();mouseDown=grenadeDown=false;});
const lockLayer=document.createElement('div');lockLayer.className='dl-lock-layer';container.append(lockLayer);
const lockBoxes=new Map<number,HTMLDivElement>();
const waypointMat=new StandardMaterial('waypoint-cyan',scene);waypointMat.disableLighting=true;waypointMat.emissiveColor=Color3.FromHexString('#64d9ed');
const waypointRoot=new TransformNode('destination',scene);
const waypointRing=MeshBuilder.CreateTorus('destination-ring',{diameter:7.5,thickness:.18,tessellation:8},scene);waypointRing.parent=waypointRoot;waypointRing.position.y=.12;waypointRing.material=waypointMat;waypointRing.isPickable=false;
const waypointPin=MeshBuilder.CreateCylinder('destination-pin',{diameterBottom:0,diameterTop:1.2,height:1.7,tessellation:4},scene);waypointPin.parent=waypointRoot;waypointPin.position.y=4;waypointPin.material=waypointMat;waypointPin.isPickable=false;waypointRoot.setEnabled(false);
function updateWaypoint(){const point=navigation.waypoint,visible=!!player&&!!point&&navigation.distance(player.mesh.position.x,player.mesh.position.z)<95&&state.mode!=='garage';waypointRoot.setEnabled(visible);if(point){waypointRoot.position.set(point.x,0,point.z);waypointPin.position.y=4+Math.sin(state.seconds*3)*.3;}}
function renderLocks(){
 const shown=state.mode==='playing'&&!atlas.isOpen;lockLayer.hidden=!shown;const hovered=shown&&state.weapon==='rocket'?rocketTarget:undefined;container.querySelector<HTMLElement>('.dl-app')!.dataset.targetLock=String(!!hovered);
 if(!shown)return;const targets=new Map(missiles.activeTargets().map(t=>[t.id,t]));if(hovered&&hovered.alive())targets.set(hovered.id,hovered);const flying=new Set(missiles.activeTargetIds());
 for(const [id,box] of lockBoxes)if(!targets.has(id)){box.remove();lockBoxes.delete(id);}
 const viewport=camera.viewport.toGlobal(engine.getRenderWidth(),engine.getRenderHeight()),bounds=canvas.getBoundingClientRect();
 for(const [id,target] of targets){let box=lockBoxes.get(id);if(!box){box=document.createElement('div');box.className='dl-lock-box';box.innerHTML='<i></i><i></i><i></i><i></i>';lockLayer.append(box);lockBoxes.set(id,box);}const p=Vector3.Project(target.position(),Matrix.Identity(),scene.getTransformMatrix(),viewport);const x=bounds.left+p.x*bounds.width/engine.getRenderWidth(),y=bounds.top+p.y*bounds.height/engine.getRenderHeight();box.hidden=p.z<0||p.z>1||x<0||x>window.innerWidth||y<0||y>window.innerHeight;box.style.transform=`translate3d(${x-25}px,${y-25}px,0)`;box.dataset.flight=String(flying.has(id));}
}

async function init(){
 try{const havok=await HavokPhysics({locateFile:()=>havokUrl});scene.enablePhysics(new Vector3(0,-22,0),new HavokPlugin(true,havok));scene.getPhysicsEngine()!.setTimeStep(1/60);scene.getPhysicsEngine()!.setSubTimeStep(1000/60);Scene.MaxDeltaTime=50;
  scene.onBeforePhysicsObservable.add(()=>{physicsAccumulator=Math.max(0,physicsAccumulator-1/60);for(const a of allActors()){if(a.mesh.isDisposed())continue;a.previousPosition.copyFrom(a.mesh.position);a.previousAngle=a.mesh.rotationQuaternion!.toEulerAngles().y;if(a.disabled||a.exploded)brakeDisabled(a,1/60);else if(!a.parkedId&&!a.roadblock)applyDrive(a,1/60);}});
  const ground=MeshBuilder.CreateBox('collisionGround',{width:200000,depth:200000,height:1},scene);ground.position.y=-.5;ground.isVisible=false;new PhysicsAggregate(ground,PhysicsShapeType.BOX,{mass:0,friction:.15,restitution:.05},scene);
  physicsReady=true;document.documentElement.dataset.ready='true';
 }catch(e){bootError='Не удалось запустить физику. Обнови страницу.';notice(bootError,30);console.error(e);}
}
void init();

function createActor(car:CarSpec,x:number,z:number,angle:number,kind:Actor['kind'],color:string):Actor {
 const visual=createVehicle(scene,car,color,kind);
 const mesh=MeshBuilder.CreateBox('carCollider',{width:car.width,depth:car.length,height:.85},scene);mesh.position.set(x,.7,z);mesh.rotationQuaternion=Quaternion.FromEulerAngles(0,angle,0);mesh.isVisible=false;
 visual.root.position.set(x,.275,z);visual.root.rotationQuaternion=Quaternion.FromEulerAngles(0,angle,0);visual.setTurretEnabled?.(kind==='player'&&turretAvailable(save,car.id));visual.root.getChildMeshes().forEach(m=>{m.isPickable=false;if(m===visual.body||m.name.startsWith('detachable-'))shadows.addShadowCaster(m,false);});
 const physics=new PhysicsAggregate(mesh,PhysicsShapeType.BOX,{mass:car.mass,friction:0,restitution:.08},scene);physics.body.setMassProperties({mass:car.mass,inertia:new Vector3(0,car.mass*(car.width*car.width+car.length*car.length)/12*1.25,0)});physics.body.setLinearDamping(.04);physics.body.setAngularDamping(.4);
 const hp=car.armor;return {visual,mesh,physics,spec:car,color,health:hp,maxHealth:hp,angle,hitTime:0,kind,prevSpeed:0,dynamics:handlingMemory(),slip:0,burnTime:0,exploded:false,disabled:false,control:{throttle:0,steer:0,handbrake:false,nitro:false},previousPosition:mesh.position.clone(),previousAngle:angle};
}
function disposeActor(a:Actor){a.physics.dispose();a.visual.dispose();a.mesh.dispose();}
function leaveGarage(){
 if(!player)return;const old=player,at=old.mesh.position;const garage=world.garages.reduce((best,g)=>Math.hypot(g.x-at.x,g.z-at.z)<Math.hypot(best.x-at.x,best.z-at.z)?g:best,world.garages[0]);
 const exitX=garage.exitX??garage.x,exitZ=garage.exitZ??garage.z-14,exitAngle=garage.exitAngle??Math.PI;
 carConditions.set(old.spec.id,{health:state.health,engine:state.engine,tires:state.tires,nitro:state.nitro});disposeActor(old);player=createActor(spec(),exitX,exitZ,exitAngle,'player',paintColor());
 state.maxHealth=spec().armor+carUpgrades(save).armor*30;Object.assign(state,carConditions.get(save.selected)||{health:state.maxHealth,engine:100,tires:100,nitro:100});state.health=Math.min(state.health,state.maxHealth);player.visual.setDamage(state.health/state.maxHealth,state.tires/100);
 state.mode='playing';state.turretEquipped=turretAvailable(save,player.spec.id);state.speed=0;lastSpeed=0;garageEntered=false;safeGarageTime=0;tracked.set(exitX,0,exitZ);notice('Машина готова. Хорошей дороги!');
}
function clearRun(){
 atlas.close();recoil.reset();rocketTarget=undefined;lockBoxes.forEach(box=>box.remove());lockBoxes.clear();
 if(player)disposeActor(player);player=undefined;police.forEach(disposeActor);traffic.forEach(disposeActor);parked.forEach(disposeActor);parked.clear();parkedStates.clear();destroyedParked.clear();helis.forEach(h=>h.visual.dispose());pickups.forEach(p=>p.visual.dispose());grenades.forEach(g=>g.mesh.dispose());police=[];traffic=[];helis=[];pickups=[];grenades=[];missiles.clear();
 for(const p of proxies.values()){p.aggregate.dispose();p.mesh.dispose();}proxies.clear();
 wrecks.forEach(w=>disposeActor(w.actor));wrecks.length=0;debris.forEach(p=>{p.physics.dispose();p.mesh.dispose(false,true);});debris.length=0;skids.clear();physicsAccumulator=0;
}
function startRun(){
 if(!save.owned.includes(save.selected)){notice('Эту машину нужно сначала купить.');return;}
 clearRun();carConditions.clear();roadblockLevel=1;contractIndex=contractProgress=contractKills=0;contractSawWanted=false;peakWanted=0;escapedFiveStars=false;speedStreak=0;challengeSaveClock=0;spawnSequence=0;helicopterSequence=0;heliClock=20;cameraZoom=23;Object.assign(state,{mode:'playing',health:spec().armor+carUpgrades(save).armor*30,maxHealth:spec().armor+carUpgrades(save).armor*30,engine:100,tires:100,nitro:100,heat:0,ammo:8,rockets:0,weapon:'turret',turretEquipped:turretAvailable(save),targetName:'',rocketReady:false,burnSeconds:0,wanted:state.sandbox&&state.wantedOverride>=0?state.wantedOverride:0,escape:0,seconds:0,earned:0,kills:0});
 player=createActor(spec(),3,10,0,'player',paintColor());tracked.set(3,0,10);world.update(3,10);navigation.discover(3,10);runActive=true;garageEntered=false;safeGarageTime=0;
 spawnSupply('rocket',3,24);spawnSupply('nitro',3,40);spawnSupply('cash',3,55);
 wantedClock=spawnClock=trafficClock=pickupClock=fireClock=grenadeClock=rocketClock=proxyClock=damageClock=collisionClock=parkedClock=0;startGrace=state.pursuitEnabled?6:0;peaceUntil=0;overheated=false;lastSpeed=0;state.messageTime=0;state.pickupNoticeTime=0;state.tutorialTime=settings.tutorialSeen?0:8;settings.tutorialSeen=true;persistSettings();
}
function enterGarage(){
 if(!player||state.wanted>0)return;state.mode='garage';if(!state.sandbox){save.credits+=state.earned;save.best=Math.max(save.best,Math.floor(state.seconds));awardChallenges(0,0,escapedFiveStars);}state.earned=0;persist();player.physics.body.setLinearVelocity(Vector3.Zero());player.physics.body.setAngularVelocity(Vector3.Zero());state.speed=0;refreshPreview();notice(state.sandbox?'Песочница: возвращение в мастерскую.':'Ты оторвался. Добыча сохранена — можно заняться машиной.',5);garageEntered=true;
}
function gameOver(){
 if(state.mode!=='playing')return;state.mode='gameover';runActive=false;if(!state.sandbox){save.best=Math.max(save.best,Math.floor(state.seconds));save.credits+=Math.floor(state.earned*.5);}persist();mouseDown=false;grenadeDown=false;audio.effect('boom');if(player){player.disabled=true;player.visual.setDamage(0,.25);collectDebris(player);effects.burst(player.mesh.position,'#ef8155',36,12);}
}
function hurt(amount:number){
 if(state.mode!=='playing'||!player||state.sandbox&&state.cheats.invincible)return;const armor=carUpgrades(save,player.spec.id).armor;amount/=1+armor*.12;state.health=Math.max(0,state.health-amount);state.engine=Math.max(25,state.engine-amount*.35);state.tires=Math.max(30,state.tires-amount*.23);player.visual.setDamage(state.health/state.maxHealth,state.tires/100);collectDebris(player);damageClock=.18;audio.effect('hit');if(state.health<=0)gameOver();
}
function wrapAngle(a:number){return Math.atan2(Math.sin(a),Math.cos(a));}
function carsTouch(a:Actor,b:Actor){const dx=b.mesh.position.x-a.mesh.position.x,dz=b.mesh.position.z-a.mesh.position.z,aa=a.mesh.rotationQuaternion!.toEulerAngles().y,ba=b.mesh.rotationQuaternion!.toEulerAngles().y;const ar={x:Math.cos(aa),z:-Math.sin(aa)},af={x:Math.sin(aa),z:Math.cos(aa)},br={x:Math.cos(ba),z:-Math.sin(ba)},bf={x:Math.sin(ba),z:Math.cos(ba)};for(const axis of [ar,af,br,bf]){const distance=Math.abs(dx*axis.x+dz*axis.z),ra=(Math.abs(ar.x*axis.x+ar.z*axis.z)*a.spec.width+Math.abs(af.x*axis.x+af.z*axis.z)*a.spec.length)/2,rb=(Math.abs(br.x*axis.x+br.z*axis.z)*b.spec.width+Math.abs(bf.x*axis.x+bf.z*axis.z)*b.spec.length)/2;if(distance>ra+rb+.08)return false;}return true;}
function allActors(){return [...(player?[player]:[]),...police,...traffic,...parked.values(),...wrecks.map(w=>w.actor)];}
function drive(a:Actor,throttle:number,steer:number,_dt:number,handbrake=false,nitro=false){a.control={throttle,steer,handbrake,nitro};}
function brakeDisabled(a:Actor,dt:number){stepDisabledVehiclePhysics(a.physics.body,dt,a.exploded?'wreck':'disabled');}
function applyDrive(a:Actor,dt:number){
 const {throttle,steer,handbrake,nitro}=a.control;
 const v=a.physics.body.getLinearVelocity();a.angle=a.mesh.rotationQuaternion!.toEulerAngles().y;
 const u=a.kind==='player'?carUpgrades(save,a.spec.id):{engine:0,tires:0,handling:0,armor:0,nitro:0},surface=world.surfaceAt(a.mesh.position.x,a.mesh.position.z);
 const output=stepHandling(a.dynamics,{vx:v.x,vz:v.z,yaw:a.physics.body.getAngularVelocity().y,angle:a.angle,throttle,steer,handbrake,nitro,offRoad:surface!=='asphalt',offroadCapable:a.spec.bodyStyle==='buggy'||a.spec.bodyStyle==='suv',speedLimit:a.spec.speed,handling:a.spec.handling,handlingLevel:u.handling,mass:a.spec.mass,length:a.spec.length,tireCondition:a.kind==='player'?state.tires:100,engineCondition:a.kind==='player'?state.engine:Math.max(0,a.health/a.maxHealth*100),engineLevel:u.engine,tireLevel:u.tires,ai:a.kind!=='player',profile:state.handlingProfile,dt});
 velTemp.set(output.vx,v.y,output.vz);a.physics.body.setLinearVelocity(velTemp);angTemp.set(0,output.yaw,0);a.physics.body.setAngularVelocity(angTemp);a.slip=output.slip;
 const chassis=a.visual.chassis||a.visual.root;const kick=a.kind==='player'?recoil.step(dt):{roll:0,pitch:0,barrel:0};chassis.rotation.z=output.roll+kick.roll;chassis.rotation.x=output.pitch+kick.pitch;if(a.kind==='player'){const elevation=a.visual.turret.getChildren().find(n=>n.name==='turret-elevation') as TransformNode|undefined;if(elevation)elevation.position.z=.23-kick.barrel;}
 a.visual.wheels.forEach((w,i)=>{w.rotation.x+=output.forward*dt*2.4;if(i<2)w.rotation.y=output.steerAngle;});
 const sliding=Math.abs(output.slip)>.15&&Math.hypot(v.x,v.z)>6;skids.track(a.visual.root.uniqueId,a.mesh.position.x,a.mesh.position.z,a.angle,a.spec.width,a.spec.length,sliding,surface);
 if(sliding&&surface==='asphalt'&&frame%4===0){const at=a.mesh.position.add(new Vector3(-Math.sin(a.angle)*a.spec.length*.3,.05,-Math.cos(a.angle)*a.spec.length*.3));effects.smoke(at);}
}
function aiDrive(a:Actor,tx:number,tz:number,dt:number,speed=1){const dx=tx-a.mesh.position.x,dz=tz-a.mesh.position.z;const wanted=Math.atan2(dx,dz);a.angle=a.mesh.rotationQuaternion!.toEulerAngles().y;const error=wrapAngle(wanted-a.angle),reverse=Math.abs(error)>2;drive(a,reverse?-.45:speed,Math.max(-1,Math.min(1,error*1.5*(reverse?-1:1))),dt);}
function followRoad(a:Actor,dt:number){
 if(a.disabled)return;const p=a.mesh.position,v=a.physics.body.getLinearVelocity(),speed=Math.hypot(v.x,v.z);a.angle=a.mesh.rotationQuaternion!.toEulerAngles().y;
 const road=world.roadAt?.(p.x,p.z,a.angle);if(!road){drive(a,0,0,dt);return;}
 const direction=Math.cos(road.angle-a.angle)>=0?1:-1,heading=road.angle+(direction<0?Math.PI:0),look=6+Math.min(9,speed*.65),next=world.roadAt!(road.x+Math.sin(heading)*look,road.z+Math.cos(heading)*look,heading),lane=next.width*.225*direction*(state.trafficSide==='right'?1:-1),tx=next.x+Math.cos(next.angle)*lane,tz=next.z-Math.sin(next.angle)*lane;
 const body=(other:Actor)=>{const ov=other.physics.body.getLinearVelocity();return {x:other.mesh.position.x,z:other.mesh.position.z,vx:ov.x,vz:ov.z,angle:other.mesh.rotationQuaternion!.toEulerAngles().y,length:other.spec.length,width:other.spec.width};};
 const nearby=allActors().filter(other=>other!==a&&!other.mesh.isDisposed()&&Vector3.DistanceSquared(p,other.mesh.position)<1600).map(body);
 for(const prop of world.propsNear(p.x,p.z,20))if(prop.active&&!prop.breakable)nearby.push({x:prop.x,z:prop.z,vx:0,vz:0,angle:0,length:Math.min(8,prop.depth??prop.radius*1.5),width:Math.min(8,prop.width??prop.radius*1.5)});
 const turn=wrapAngle(Math.atan2(tx-p.x,tz-p.z)-a.angle),cruise=a.spec.speed*(Math.abs(turn)>.6?.42:.78),safe=safeTrafficSpeed(body(a),nearby,cruise),throttle=Math.max(-1,Math.min(.75,(safe-speed)*.35));
 drive(a,throttle,Math.max(-1,Math.min(1,turn*1.7)),dt);
}
function safeSpawn(x:number,z:number,width=2.5,length=4.8,height=2,y=.7){
 if(!camera.orthoTop)return false;const viewport=camera.viewport.toGlobal(engine.getRenderWidth(),engine.getRenderHeight()),points=[];
 for(const dx of [-width/2,width/2])for(const dz of [-length/2,length/2])for(const dy of [0,height]){const p=Vector3.Project(new Vector3(x+dx,y+dy,z+dz),Matrix.Identity(),scene.getTransformMatrix(),viewport);points.push({x:p.x,y:p.y,z:p.z});}
 if(!outsideSpawnViewport(points,engine.getRenderWidth(),engine.getRenderHeight()))return false;
 return !allActors().some(a=>!a.mesh.isDisposed()&&Math.hypot(a.mesh.position.x-x,a.mesh.position.z-z)<(length+a.spec.length)/2+3);
}
function spawnPolice(){
 if(!player)return false;const p=player.mesh.position,c=policeSpec(choosePoliceRole(state.wanted,spawnSequence)),spawn=world.trafficSpawns(p.x,p.z,24).find(s=>Math.hypot(s.x-p.x,s.z-p.z)>42&&safeSpawn(s.x,s.z,c.width,c.length));if(!spawn)return false;
 police.push(createActor(c,spawn.x,spawn.z,Math.atan2(p.x-spawn.x,p.z-spawn.z),'police','#e3e4de'));spawnSequence++;return true;
}
function spawnTraffic(){
 if(!player)return;const p=player.mesh.position;const candidates=world.trafficSpawns(p.x,p.z,20,state.trafficSide);const s=candidates.find(s=>Math.hypot(s.x-p.x,s.z-p.z)>35&&safeSpawn(s.x,s.z));if(!s)return;
 const cs=CARS[Math.floor(Math.random()*CARS.length)];traffic.push(createActor({...cs,speed:11+Math.random()*7},s.x,s.z,s.angle,'traffic',['#d6c6b5','#e6aa63','#7d9f9b','#a7a6b7','#d8dcce'][Math.floor(Math.random()*5)]));
}
function spawnHeli(force=false){
 if(!player)return false;const p=player.mesh.position,live=helis.filter(h=>h.status==='flying');if(!force&&live.length>=PURSUIT_LEVELS[state.wanted].helis)return false;const slot=live.some(h=>h.slot===0)?1:0,phase=(helicopterSequence++*2.399)+slot*Math.PI;let at:Vector3|undefined;
 for(let i=0;i<12;i++){const angle=phase+i*Math.PI/6,candidate=new Vector3(p.x+Math.sin(angle)*85,20+slot*4,p.z+Math.cos(angle)*85);if(force||safeSpawn(candidate.x,candidate.z,7,7,4,candidate.y)){at=candidate;break;}}if(!at)return false;
 const visual=createHelicopter(scene);visual.root.position.copyFrom(at);visual.root.getChildMeshes().forEach(m=>shadows.addShadowCaster(m));helis.push({visual,health:130,fire:4,slot,phase,status:'flying',fallTime:0,verticalSpeed:0,drift:Vector3.Zero(),wreckLife:25});notice(state.wanted===3?'В воздухе наблюдатель. Используй здания как укрытие.':'Подключилась полицейская авиация.',4);return true;
}
function worldRayBlocked(from:Vector3,to:Vector3){const delta=to.subtract(from),distance=delta.length();if(distance<.1)return false;const ray=new Ray(from,delta.scale(1/distance),distance);
 return world.propsNear((from.x+to.x)/2,(from.z+to.z)/2,distance/2+20).some(p=>p.active&&!p.mesh.isDisposed()&&(p.interaction==='solid'||!p.breakable||p.interaction==='facade')&&(()=>{const hit=ray.intersectsMesh(p.mesh,false);return hit.hit&&hit.distance>.5&&hit.distance<distance-.8;})());
}
function lineBlocked(x:number,z:number,tx:number,tz:number){return worldRayBlocked(new Vector3(x,1.2,z),new Vector3(tx,1.2,tz));}
function updateWanted(dt:number){
 if(!player||!state.pursuitEnabled)return;wantedClock+=dt;heliClock=Math.max(0,heliClock-dt);const forced=state.sandbox&&state.wantedOverride>=0;if(forced){state.wanted=state.wantedOverride;startGrace=0;}peakWanted=Math.max(peakWanted,state.wanted);
 if(startGrace>0){startGrace-=dt;if(startGrace<=0)state.wanted=1;return;}
 if(state.wanted===0){peaceUntil-=dt;state.escape=100;return;}
 const level=Math.min(5,1+Math.floor(wantedClock/55)+Math.floor(state.kills/8));if(!forced&&level>state.wanted){state.wanted=level;notice(level===3?'Уровень 3: возможны наблюдательные вылеты.':`Уровень розыска ${level}. Подкрепление уже в пути.`);if(level===3)heliClock=Math.max(heliClock,12);}
 peakWanted=Math.max(peakWanted,state.wanted);const p=player.mesh.position;let seen=police.some(a=>!a.disabled&&Math.hypot(a.mesh.position.x-p.x,a.mesh.position.z-p.z)<42&&!lineBlocked(p.x,p.z,a.mesh.position.x,a.mesh.position.z));seen||=helis.some(h=>h.status==='flying'&&Vector3.Distance(h.visual.root.position,p)<48&&!worldRayBlocked(h.visual.root.position,p.add(new Vector3(0,1,0))));
 state.escape=Math.max(0,Math.min(100,state.escape+(seen?-38:9)*dt));
 if(state.escape>=100&&!forced){if(peakWanted>=5)escapedFiveStars=true;state.wanted=0;peaceUntil=20;wantedClock=0;police.forEach(disposeActor);police=[];for(const h of [...helis])if(h.status==='flying'){h.visual.dispose();helis=helis.filter(v=>v!==h);}heliClock=60;return;}
 const policy=PURSUIT_LEVELS[state.wanted];spawnClock-=dt;if(spawnClock<=0&&police.length<policy.cars){spawnClock=spawnPolice()?policy.interval:1;}
 if(state.wanted>=3&&heliClock<=0&&helis.filter(h=>h.status==='flying').length<policy.helis){if(spawnHeli())heliClock=state.wanted===5?18:policy.heliCooldown;else heliClock=2;}
 if(state.wanted>roadblockLevel){if(spawnRoadblock())roadblockLevel=state.wanted;}
}
function spawnRoadblock(){if(!player||state.wanted<2||police.length+2>PURSUIT_LEVELS[state.wanted].cars)return false;const p=player.mesh.position,candidate=world.trafficSpawns(p.x,p.z,24).find(s=>Math.hypot(s.x-p.x,s.z-p.z)>50&&safeSpawn(s.x,s.z,12,7));if(!candidate)return false;const road=world.roadAt?.(candidate.x,candidate.z)??{x:candidate.x,z:candidate.z,angle:candidate.angle};for(const side of [-1,1]){const a=createActor({...policeSpec(state.wanted>=4?'swat':'patrol'),speed:0},road.x+Math.cos(road.angle)*side*2.5,road.z-Math.sin(road.angle)*side*2.5,road.angle+Math.PI/2,'police','#e3e4de');a.roadblock=true;a.physics.body.setLinearDamping(1.5);police.push(a);}notice('Полиция готовит заграждение на дороге.');return true;}
function raiseWanted(){if(state.sandbox&&state.wantedOverride>=0)return;if(state.pursuitEnabled&&state.wanted===0&&startGrace<=0&&peaceUntil<=0){state.wanted=Math.min(5,1+Math.floor(wantedClock/60));state.escape=0;notice('Стрельба выдала твоё положение.');}}
function collectDebris(a:Actor){for(const mesh of a.visual.popDebris?.()??[]){while(debris.length>=32){const old=debris.shift()!;old.physics.dispose();old.mesh.dispose(false,true);}shadows.addShadowCaster(mesh);const physics=new PhysicsAggregate(mesh,PhysicsShapeType.BOX,{mass:14,friction:.7,restitution:.3},scene),v=a.physics.body.getLinearVelocity();physics.body.setLinearVelocity(new Vector3(v.x*.6+(Math.random()-.5)*9,3+Math.random()*4,v.z*.6+(Math.random()-.5)*9));physics.body.setAngularVelocity(new Vector3((Math.random()-.5)*12,(Math.random()-.5)*9,(Math.random()-.5)*12));debris.push({mesh,physics,life:13});}}
function killActor(a:Actor){if(a.exploded)return;a.exploded=true;a.disabled=true;const p=a.mesh.position.clone();a.health=0;configureWreckPhysics(a.physics.body,a.physics.shape);a.visual.setDamage(0,.3);collectDebris(a);effects.burst(p,'#ef8155',25,9);effects.burst(p,'#3f4943',14,6);audio.effect('boom');if(a.kind==='police'){state.kills++;state.earned+=125;police=police.filter(t=>t!==a);}else {traffic=traffic.filter(t=>t!==a);if(a.parkedId){parked.delete(a.parkedId);destroyedParked.add(a.parkedId);}raiseWanted();}wrecks.push({actor:a,life:25});while(wrecks.length>8)disposeActor(wrecks.shift()!.actor);}
function hitActor(a:Actor,damage:number){if(a.exploded||a.mesh.isDisposed())return;a.health-=damage;if(a.health/a.maxHealth<.3&&!a.disabled){a.disabled=true;configureWreckPhysics(a.physics.body,a.physics.shape,'disabled');}a.visual.setDamage(a.health/a.maxHealth,Math.max(.3,a.health/a.maxHealth));collectDebris(a);effects.burst(a.mesh.position,'#e6ef64',3,3);if(a.health<=0)killActor(a);}
function hitHeli(h:Heli,damage:number){if(h.status!=='flying')return;h.health-=damage;if(h.health>0)return;h.status='falling';h.fallTime=0;h.verticalSpeed=.7;h.visual.beginCrash();h.drift.set(Math.sin(h.phase)*3,0,Math.cos(h.phase)*3);state.kills++;state.earned+=350;heliClock=Math.max(heliClock,PURSUIT_LEVELS[state.wanted].heliCooldown);qaTrace('helicopter-falling',{y:h.visual.root.position.y,kills:state.kills,reward:350});audio.effect('hit');notice('Вертолёт теряет управление. Осторожно, обломки!',4);}
function updateHelicopters(dt:number){
 if(!player)return;const pos=player.mesh.position,v=player.physics.body.getLinearVelocity();
 for(const h of [...helis]){
  const hp=h.visual.root.position;
  if(h.status==='wreck'){h.wreckLife-=dt;if(h.wreckLife<=0){h.visual.dispose();helis=helis.filter(v=>v!==h);}continue;}
  if(h.status==='falling'){
   h.fallTime+=dt;h.verticalSpeed+=dt*4.8;hp.addInPlaceFromFloats(h.drift.x*dt,-h.verticalSpeed*dt,h.drift.z*dt);h.visual.root.rotation.z+=dt*(1.1+h.fallTime*.3);h.visual.root.rotation.x=Math.sin(h.fallTime*2)*.25;h.visual.root.rotation.y+=dt*.55;h.visual.rotor.rotation.y+=dt*Math.max(0,28-h.fallTime*7);
   effects.smoke(hp.add(new Vector3(0,1,0)),true);if(frame%3===0)effects.burst(hp,'#ff9b45',2,2);
   let groundY=.6;for(const p of world.propsNear(hp.x,hp.z,20)){if(p.interaction!=='solid')continue;const dx=hp.x-p.x,dz=hp.z-p.z,angle=p.angle??0,lx=dx*Math.cos(angle)-dz*Math.sin(angle),lz=dx*Math.sin(angle)+dz*Math.cos(angle);if(Math.abs(lx)<(p.width??p.radius*1.6)/2&&Math.abs(lz)<(p.depth??p.radius*1.6)/2)groundY=Math.max(groundY,(p.height??7)+.6);}
   if(hp.y<=groundY||h.fallTime>7){hp.y=Math.max(groundY,hp.y);const at=hp.clone();h.visual.root.computeWorldMatrix(true);for(const mesh of h.visual.releaseDebris()){while(debris.length>=48){const old=debris.shift()!;old.physics.dispose();old.mesh.dispose(false,true);}const mass=mesh.metadata?.debrisMass??30,physics=new PhysicsAggregate(mesh,PhysicsShapeType.BOX,{mass,friction:.9,restitution:.12},scene);physics.body.setLinearDamping(mass>100?1.4:.7);physics.body.setAngularDamping(1.5);physics.body.setLinearVelocity(new Vector3(h.drift.x+(Math.random()-.5)*9,mass>100?2:3+Math.random()*4,h.drift.z+(Math.random()-.5)*9));physics.body.setAngularVelocity(new Vector3((Math.random()-.5)*5,(Math.random()-.5)*6,(Math.random()-.5)*5));shadows.addShadowCaster(mesh);debris.push({mesh,physics,life:mass>100?30:22});}h.status='wreck';h.visual.root.setEnabled(false);qaTrace('helicopter-impact',{fallTime:h.fallTime,fragments:debris.filter(d=>d.mesh.metadata?.part).map(d=>d.mesh.metadata.part),kills:state.kills,y:at.y});explosion(at,150);}
   continue;
  }
  h.phase+=dt*.18;const radius=h.slot?22:18,target=new Vector3(pos.x+Math.sin(h.phase)*radius+v.x*.25,20+h.slot*4,pos.z+Math.cos(h.phase)*radius+v.z*.25);
  for(const other of helis)if(other!==h&&other.status==='flying'){const delta=hp.subtract(other.visual.root.position),distance=delta.length();if(distance<13&&distance>.01)target.addInPlace(delta.scale((13-distance)/distance));}
  hp.copyFrom(Vector3.Lerp(hp,target,1-Math.exp(-dt*.65)));h.visual.root.rotation.y=Math.atan2(pos.x-hp.x,pos.z-hp.z);h.visual.rotor.rotation.y+=dt*35;h.fire-=dt;
  if(h.fire<=0&&state.wanted>=4&&Vector3.Distance(hp,pos)<45&&!worldRayBlocked(hp,pos.add(new Vector3(0,1,0)))){effects.tracer(hp,pos.add(new Vector3((Math.random()-.5)*8,0,(Math.random()-.5)*8)));if(Math.hypot(v.x,v.z)<15)hurt(4);h.fire=2;}
 }
}
function updateAim(){
 if(!player)return;const ray=scene.createPickingRay(mouseX,mouseY,null,camera),distance=ray.intersectsPlane(new Plane(0,1,0,-1.1));if(distance!==null&&distance>0)aim=ray.origin.add(ray.direction.scale(distance));
 const previous=rocketTarget?.id,assist=state.weapon==='turret'?state.turretAssist:state.rocketAssist,mount=player.visual.turret.getAbsolutePosition();aimHeli=undefined;rocketTarget=undefined;state.targetName='';const viewport=camera.viewport.toGlobal(engine.getRenderWidth(),engine.getRenderHeight());let nearest=Infinity;
 const pixels=(p:Vector3)=>{const screen=Vector3.Project(p,Matrix.Identity(),scene.getTransformMatrix(),viewport);if(screen.z<0||screen.z>1)return Infinity;return Math.hypot(screen.x*canvas.clientWidth/engine.getRenderWidth()-mouseX,screen.y*canvas.clientHeight/engine.getRenderHeight()-mouseY);};
 for(const h of helis){if(h.status!=='flying')continue;const d=pixels(h.visual.root.position),exact=assist==='off'?ray.intersectsMeshes(h.visual.root.getChildMeshes() as Mesh[],false)[0]:undefined,radius=assist==='standard'?38:22,score=assist==='off'?(exact?.distance??Infinity):d*(previous===h.visual.root.uniqueId ? .72 : 1);if((assist==='off'?!!exact:d<radius*(previous===h.visual.root.uniqueId?1.25:1))&&score<nearest&&Vector3.Distance(h.visual.root.position,player.mesh.position)<90&&!worldRayBlocked(mount,h.visual.root.position)){nearest=score;aimHeli=h;aim=exact?.pickedPoint?.clone()??h.visual.root.position.clone();state.targetName='ВЕРТОЛЁТ';rocketTarget={id:h.visual.root.uniqueId,position:()=>h.visual.root.position.clone(),alive:()=>h.status==='flying'&&h.health>0};}}
 for(const a of [...police,...traffic,...parked.values()]){if(a.exploded)continue;const center=a.visual.root.position.add(new Vector3(0,.9,0)),d=pixels(center),exact=assist==='off'?ray.intersectsMeshes(a.visual.root.getChildMeshes() as Mesh[],false)[0]:undefined,radius=assist==='standard'?24:14,score=assist==='off'?(exact?.distance??Infinity):d*(previous===a.mesh.uniqueId ? .72 : 1);if((assist==='off'?exact?.hit:d<radius*(previous===a.mesh.uniqueId?1.25:1))&&score<nearest&&Vector3.Distance(a.mesh.position,player.mesh.position)<90&&!worldRayBlocked(mount,center)){nearest=score;aimHeli=undefined;aim=exact?.pickedPoint?.clone()??center;state.targetName=a.kind==='police'?'ПОЛИЦИЯ':'АВТОМОБИЛЬ';rocketTarget={id:a.mesh.uniqueId,position:()=>a.mesh.position.add(new Vector3(0,.4,0)),alive:()=>!a.exploded&&!a.mesh.isDisposed()};}}
 state.rocketReady=(state.rockets>0||state.sandbox&&state.cheats.unlimitedAmmo)&&rocketClock<=0&&!!rocketTarget;
 const turret=player.visual.turret;turret.parent?.computeWorldMatrix(true);const direction=aim.subtract(turret.getAbsolutePosition()),inverse=Matrix.Invert(turret.parent?.getWorldMatrix()??Matrix.Identity()),local=Vector3.TransformNormal(direction,inverse);turret.rotationQuaternion=null;turret.rotation.y=Math.atan2(local.x,local.z);const elevation=turret.getChildren().find(n=>n.name==='turret-elevation') as TransformNode|undefined;if(elevation){elevation.rotationQuaternion=null;elevation.rotation.x=-Math.atan2(local.y,Math.hypot(local.x,local.z));}
}
function shoot(){
 if(!player||!state.turretEquipped||fireClock>0||state.heat>=100||overheated)return;fireClock=.105;lastPrimary=performance.now();raiseWanted();const mount=player.visual.turret.getAbsolutePosition(),direction=aim.subtract(mount).normalize(),from=mount.add(direction.scale(.8)),ray=new Ray(from,direction,75);let end=from.add(direction.scale(65)),closest=65;let target:Actor|undefined,propTarget:WorldProp|undefined,heliTarget:Heli|undefined;
 for(const a of [...police,...traffic,...parked.values()]){if(a.exploded)continue;const hit=ray.intersectsMeshes(a.visual.root.getChildMeshes() as Mesh[],false)[0];if(hit?.hit&&hit.distance<closest){closest=hit.distance;target=a;end=hit.pickedPoint??end;}}
 for(const h of helis){if(h.status!=='flying')continue;const hit=ray.intersectsMeshes(h.visual.root.getChildMeshes() as Mesh[],false)[0];if(hit?.hit&&hit.distance<closest){closest=hit.distance;heliTarget=h;target=undefined;end=hit.pickedPoint??end;}}
 for(const p of world.propsNear(from.x,from.z,75)){if(!p.active||p.mesh.isDisposed())continue;const hit=ray.intersectsMesh(p.mesh,false);if(hit.hit&&hit.distance<closest){closest=hit.distance;target=undefined;heliTarget=undefined;propTarget=p;end=hit.pickedPoint??end;}}
 if(heliTarget){hitHeli(heliTarget,11);effects.burst(end,'#e6ef64',3,2);}else if(target)hitActor(target,13);else if(propTarget){world.damageProp?.(propTarget,15,direction.scale(1.5));effects.burst(end,'#c8b681',3,2);}
 const right=Math.cos(player.angle)*direction.x-Math.sin(player.angle)*direction.z,forward=Math.sin(player.angle)*direction.x+Math.cos(player.angle)*direction.z;recoil.kick(right,forward,900/player.spec.mass);effects.tracer(from,end);effects.burst(from,'#fff1a0',5,2.5);audio.effect('shoot');state.heat=state.sandbox&&state.cheats.noOverheat?0:Math.min(100,state.heat+6.5);if(state.heat>=100)overheated=true;
}
const grenadeMat=new StandardMaterial('grenade',scene);grenadeMat.diffuseColor=Color3.FromHexString('#ef8155');grenadeMat.emissiveColor=new Color3(.6,.2,.03);
const flameOrange=new StandardMaterial('engine-fire-orange',scene);flameOrange.disableLighting=true;flameOrange.emissiveColor=Color3.FromHexString('#ff631a');
const flameYellow=new StandardMaterial('engine-fire-core',scene);flameYellow.disableLighting=true;flameYellow.emissiveColor=Color3.FromHexString('#ffdb72');
const nitroBlue=new StandardMaterial('nitro-blue-flame',scene);nitroBlue.disableLighting=true;nitroBlue.emissiveColor=Color3.FromHexString('#268cff');
const nitroCore=new StandardMaterial('nitro-white-core',scene);nitroCore.disableLighting=true;nitroCore.emissiveColor=Color3.FromHexString('#c4f8ff');
function enableFire(a:Actor){if(a.fire)return;const root=new TransformNode('burning-engine',scene);root.parent=a.visual.chassis||a.visual.root;root.position.set(.08,1,a.spec.length*.28);for(let i=0;i<3;i++){const flame=MeshBuilder.CreateCylinder('engine-flame',{diameterBottom:i===2?.28:.52,diameterTop:.03,height:i===2?.85:1.25,tessellation:5},scene);flame.parent=root;flame.position.set((i-1)*.23,.28+(i===1?.15:0),i===1?.18:0);flame.material=i===2?flameYellow:flameOrange;flame.isPickable=false;}a.fire=root;}
function updateNitroFlames(a:Actor,active:boolean){
 if(!a.nitroJets&&active){a.nitroJets=a.visual.exhausts.map(outlet=>{const root=new TransformNode('nitro-jet',scene);root.parent=outlet;for(let i=0;i<2;i++){const length=i?.95:1.8,m=MeshBuilder.CreateCylinder('blue-exhaust-flame',{diameterBottom:i?.18:.34,diameterTop:0,height:length,tessellation:7},scene);m.parent=root;m.rotation.x=Math.PI/2;m.position.z=length/2;m.material=i?nitroCore:nitroBlue;m.isPickable=false;}return root;});}
 for(const [i,jet] of (a.nitroJets??[]).entries()){jet.setEnabled(active);if(active)jet.scaling.set(1,1,.9+Math.sin(frame*1.8+i)*.12+state.speed*.002);}
}
function throwGrenade(){
 if(!player||grenadeClock>0||state.ammo<=0&&!(state.sandbox&&state.cheats.unlimitedAmmo))return;grenadeClock=.85;lastSecondary=performance.now();raiseWanted();if(!(state.sandbox&&state.cheats.unlimitedAmmo))state.ammo--;const from=player.mesh.position.add(new Vector3(0,1.3,0)),delta=aim.subtract(from);if(delta.length()>42)delta.normalize().scaleInPlace(42);const end=from.add(delta);if(!aimHeli)end.y=.5;
 const mesh=MeshBuilder.CreateSphere('grenade',{diameter:.45,segments:4},scene);mesh.material=grenadeMat;mesh.position.copyFrom(from);grenades.push({mesh,start:from,end,time:0,duration:.85,air:aimHeli});audio.effect('shoot');
}
function fireRocket(){if(!player||rocketClock>0)return;if(state.rockets<=0&&!(state.sandbox&&state.cheats.unlimitedAmmo)){notice('Найди ракетницу: фиолетовая ракета с надписью «РАКЕТНИЦА».',2);return;}updateAim();if(!rocketTarget){notice('Наведи прицел на видимую машину или вертолёт.',2);return;}const from=player.visual.turret.getAbsolutePosition().add(new Vector3(0,.3,0));if(missiles.launch(from,rocketTarget)){if(!(state.sandbox&&state.cheats.unlimitedAmmo))state.rockets--;rocketClock=.7;lastPrimary=performance.now();raiseWanted();audio.effect('shoot');}}
function primaryFire(){if(state.weapon==='rocket')fireRocket();else shoot();}
function explosion(at:Vector3,damage=110,exclude?:Actor){effects.burst(at,'#ef8155',34,13);effects.burst(at,'#e6ef64',12,8);audio.effect('boom');for(const a of [...police,...traffic,...parked.values(),...wrecks.map(w=>w.actor)]){if(a===exclude||a.mesh.isDisposed())continue;const d=Vector3.Distance(a.mesh.position,at);if(d<10){hitActor(a,damage*(1-d/12));if(a.mesh.isDisposed())continue;const push=a.mesh.position.subtract(at).normalize().scale(7*(1-d/12));a.physics.body.setLinearVelocity(a.physics.body.getLinearVelocity().add(push));}}
 for(const h of [...helis])if(h.status==='flying'&&Vector3.Distance(h.visual.root.position,at)<10)hitHeli(h,damage+10);
 for(const p of world.propsNear(at.x,at.z,12)){const d=Math.hypot(p.x-at.x,p.z-at.z);if(d<12){world.damageProp?.(p,damage*(1-d/14),new Vector3(p.x-at.x,2,p.z-at.z).normalize().scale(12*(1-d/14)));}}
 if(player&&player!==exclude&&Vector3.Distance(player.mesh.position,at)<5)hurt(8);
}
function syncParked(){if(!player)return;const p=player.mesh.position;
 for(const [id,a] of parked){if(Vector3.Distance(a.mesh.position,p)>110){parkedStates.set(id,{x:a.mesh.position.x,z:a.mesh.position.z,angle:a.mesh.rotationQuaternion!.toEulerAngles().y,health:a.health,carId:a.spec.id,color:a.color});disposeActor(a);parked.delete(id);}}
 const candidates=new Map(world.parkedSpawnsNear(p.x,p.z,74).map(s=>[s.id,s]));
 for(const [id,saved] of parkedStates)if(Math.hypot(saved.x-p.x,saved.z-p.z)<74)candidates.set(id,{id,...saved});
 for(const spawn of candidates.values()){if(parked.size>=12)break;if(parked.has(spawn.id)||destroyedParked.has(spawn.id))continue;const saved=parkedStates.get(spawn.id),at=saved??spawn;if(Math.hypot(at.x-p.x,at.z-p.z)>100)continue;const car=CARS.find(c=>c.id===spawn.carId)??CARS[0],a=createActor(car,at.x,at.z,at.angle,'traffic',spawn.color);a.parkedId=spawn.id;a.physics.body.setLinearDamping(.65);a.physics.body.setAngularDamping(.6);if(saved){a.health=saved.health;a.visual.setDamage(a.health/a.maxHealth,1);a.visual.popDebris?.().forEach(m=>m.dispose(false,true));}a.visual.setCompact?.(true);parked.set(spawn.id,a);}
 while(parkedStates.size>256)parkedStates.delete(parkedStates.keys().next().value!);
}
function syncProxies(){
 if(!player)return;const p=player.mesh.position,near=world.propsNear(p.x,p.z,63).filter(prop=>(!prop.breakable||prop.kind==='small-building')&&prop.active),current=new Set(near);
 for(const [prop,v]of proxies)if(!current.has(prop)){v.aggregate.dispose();v.mesh.dispose();proxies.delete(prop);}
 for(const prop of near){if(proxies.has(prop))continue;const height=prop.height??7,mesh=MeshBuilder.CreateBox('worldCollider',{width:prop.width??prop.radius*1.6,depth:prop.depth??prop.radius*1.6,height},scene);mesh.position.set(prop.x,height/2,prop.z);mesh.rotation.y=prop.angle??0;mesh.isVisible=false;const aggregate=new PhysicsAggregate(mesh,PhysicsShapeType.BOX,{mass:0,friction:.35,restitution:.08},scene);proxies.set(prop,{mesh,aggregate});}
}
function spawnSupply(kind:PickupKind,x:number,z:number){const visual=createSupply(scene,kind);visual.root.position.set(x,.9,z);pickups.push({visual,mesh:visual.root,kind,phase:Math.random()*6});}
function updatePickups(dt:number){
 if(!player||state.mode!=='playing')return;pickupClock-=dt;const pos=player.mesh.position;
 if(pickupClock<0&&pickups.length<16){const candidates=world.trafficSpawns(pos.x,pos.z,18),s=candidates.find(s=>Math.hypot(s.x-pos.x,s.z-pos.z)>30&&safeSpawn(s.x,s.z,2,2,3)&&!pickups.some(p=>Math.hypot(p.mesh.position.x-s.x,p.mesh.position.z-s.z)<9));if(s){const kinds:PickupKind[]=['cash','cash','nitro','ammo','repair','rocket'];spawnSupply(kinds[Math.floor(Math.random()*kinds.length)],s.x,s.z);}pickupClock=2.6;}
 for(const p of [...pickups]){p.phase+=dt;p.visual.update(p.phase);const d=Math.hypot(p.mesh.position.x-pos.x,p.mesh.position.z-pos.z);p.visual.label.setEnabled(d<36);if(d<2.9){audio.effect('pickup');state.pickupNotice=PICKUP_INFO[p.kind].message;state.pickupNoticeTime=4;
   if(p.kind==='cash')state.earned+=80;
   if(p.kind==='nitro')state.nitro=Math.min(100,state.nitro+45);
   if(p.kind==='ammo')state.ammo=Math.min(24,state.ammo+3);
   if(p.kind==='rocket'){state.rockets=Math.min(12,state.rockets+3);}
   if(p.kind==='repair'){state.health=Math.min(state.maxHealth,state.health+25);state.engine=Math.min(100,state.engine+15);state.tires=Math.min(100,state.tires+15);player.visual.setDamage(state.health/state.maxHealth,state.tires/100);player.burnTime=0;}
   p.visual.dispose();pickups=pickups.filter(v=>v!==p);
  }else if(d>110){p.visual.dispose();pickups=pickups.filter(v=>v!==p);}}
}
function update(dt:number){
 if(state.messageTime>0)state.messageTime-=dt;if(state.pickupNoticeTime&&state.pickupNoticeTime>0)state.pickupNoticeTime-=dt;state.fps=engine.getFps();audio.update(state.wanted,state.speed,state.mode==='playing'&&!atlas.isOpen,state.mode);if(atlas.isOpen)return;if(state.mode==='playing'||state.mode==='gameover'){effects.update(dt);skids.update(dt);updateDamageEffects(dt);}
 if(state.mode!=='playing'||!player)return;state.seconds+=dt;state.tutorialTime=Math.max(0,state.tutorialTime-dt);state.earned+=dt*1.2;damageClock-=dt;collisionClock-=dt;const pos=player.mesh.position;
 world.update(pos.x,pos.z,dt);if(frame%18===0)navigation.discover(pos.x,pos.z);if(navigation.arrive(pos.x,pos.z))audio.effect('pickup');updateWaypoint();proxyClock-=dt;parkedClock-=dt;if(proxyClock<=0){syncProxies();proxyClock=.35;}if(parkedClock<=0){syncParked();parkedClock=.6;}
 if(garageEntered&&player.spec.id!==save.selected){const old=player,at=old.mesh.position.clone(),angle=old.angle;disposeActor(old);player=createActor(spec(),at.x,at.z,angle,'player',paintColor());}garageEntered=false;
 const v=player.physics.body.getLinearVelocity(),speed=Math.hypot(v.x,v.z);state.speed=speed*3.6;
 const throttle=(keys.has('KeyW')||keys.has('ArrowUp')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')?1:0),steer=(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0);
 const nitro=(keys.has('ShiftLeft')||keys.has('ShiftRight'))&&(state.nitro>1||state.sandbox&&state.cheats.unlimitedNitro)&&throttle>0;
 state.nitro=state.sandbox&&state.cheats.unlimitedNitro?100:Math.max(0,Math.min(100,state.nitro+(nitro?-(31-carUpgrades(save).nitro*4):7+carUpgrades(save).nitro*2)*dt));
 drive(player,throttle,steer,dt,keys.has('Space'),nitro);
 updateNitroFlames(player,nitro);
 if(!world.isRoad(pos.x,pos.z)&&speed>10&&frame%5===0)effects.burst(pos.add(new Vector3(0,-.2,0)),state.biome==='desert'?'#cfb182':'#a3ad7d',1,1);
 if(pos.y< -5){pos.y=2;player.physics.body.setLinearVelocity(Vector3.Zero());hurt(15);}
 if(!IS_QA||!qaFreeDrive)updateWanted(dt);updateAim();
 fireClock-=dt;grenadeClock-=dt;rocketClock-=dt;state.heat=coolTurret(state.heat,dt,mouseDown&&state.turretEquipped,overheated,save.turretCooling,state.sandbox&&state.cheats.noOverheat);if(state.heat<30)overheated=false;
 if(mouseDown&&state.weapon==='turret')shoot();if(grenadeDown)throwGrenade();if(missiles.count>0)missileBlockers=world.propsNear(pos.x,pos.z,125).filter(p=>p.active&&!p.breakable);missiles.update(dt);
 for(const g of [...grenades]){g.time+=dt;const t=Math.min(1,g.time/g.duration);g.mesh.position.copyFrom(Vector3.Lerp(g.start,g.end,t));g.mesh.position.y+=Math.sin(t*Math.PI)*8;g.mesh.rotation.x+=dt*9;effects.smoke(g.mesh.position);if(t>=1){explosion(g.end);g.mesh.dispose();grenades=grenades.filter(v=>v!==g);}}
 for(const a of [...police]){
  if(a.mesh.isDisposed())continue;const dist=Vector3.Distance(a.mesh.position,pos);if(dist>145){disposeActor(a);police=police.filter(v=>v!==a);continue;}if(!a.roadblock&&!a.disabled){const role=a.spec.policeRole??'patrol',lead=role==='interceptor'?1.55:role==='suv'?.8:.45,side=role==='suv'?Math.sin(a.mesh.uniqueId)*2.6:0;aiDrive(a,pos.x+v.x*lead+Math.cos(player.angle)*side,pos.z+v.z*lead-Math.sin(player.angle)*side,dt,role==='swat'?.8:1);}
  a.hitTime-=dt;if(carsTouch(player,a)&&a.hitTime<=0){const rel=Vector3.Distance(v,a.physics.body.getLinearVelocity());if(rel>3||speed<3&&!a.disabled){hurt(Math.min(13,2+rel*.45));hitActor(a,Math.max(4,rel*.8));effects.burst(pos,'#e6ef64',5,3);}a.hitTime=.85;}
 }
 trafficClock-=dt;if(trafficClock<=0&&traffic.length<16&&(!IS_QA||!qaFreeDrive)){spawnTraffic();trafficClock=.6;}
 for(const a of [...traffic]){const p=a.mesh.position;const dist=Vector3.Distance(p,pos);if(dist>120){disposeActor(a);traffic=traffic.filter(v=>v!==a);continue;}followRoad(a,dt);a.hitTime-=dt;if(carsTouch(player,a)&&a.hitTime<=0){const impact=Vector3.Distance(v,a.physics.body.getLinearVelocity());if(impact>6){hurt(Math.min(12,impact*.35));hitActor(a,impact);effects.burst(pos,'#e6ef64',6,3);}a.hitTime=1;}}
 for(const a of [...parked.values()]){a.hitTime-=dt;if(carsTouch(player,a)&&a.hitTime<=0){const impact=Vector3.Distance(v,a.physics.body.getLinearVelocity());if(impact>4){hurt(Math.min(10,impact*.3));hitActor(a,impact*.8);effects.burst(a.mesh.position,'#e6ef64',5,3);}a.hitTime=.8;}}
 updateHelicopters(dt);
 if(collisionClock<=0){for(const p of world.propsNear(pos.x,pos.z,5)){if(p.active&&speed>3&&player.mesh.intersectsMesh(p.mesh,true)){world.damageProp?.(p,speed*12,new Vector3(v.x*.65,1,v.z*.65));if(p.breakable)hurt(Math.min(5,(p.mass??50)/100));collisionClock=.3;}}
  if(lastSpeed-speed>6&&speed<lastSpeed*.7){hurt(Math.min(18,(lastSpeed-speed)*.65));effects.burst(pos,'#e6ef64',10,4);collisionClock=.6;}}
 lastSpeed=speed;
 if(state.mode!=='playing')return;
 updatePickups(dt);state.biome=world.biomeAt(pos.x,pos.z);
 state.canGarage=state.wanted===0&&startGrace<=0;state.garageDistance=Math.min(...world.garages.map(g=>Math.hypot(pos.x-g.x,pos.z-g.z)));
 if(state.canGarage&&state.garageDistance<11&&speed<2){safeGarageTime+=dt;if(safeGarageTime>1.2)enterGarage();}else safeGarageTime=0;
 state.traffic=traffic.length+police.length+helis.filter(h=>h.status==='flying').length;updateContract(dt,speed);awardChallenges(dt,speed);
}
function updateDamageEffects(dt:number){
 for(let i=debris.length-1;i>=0;i--){const d=debris[i];d.life-=dt;if(d.life<=0||player&&Vector3.Distance(d.mesh.position,player.mesh.position)>125){shadows.removeShadowCaster(d.mesh);d.physics.dispose();d.mesh.dispose(false,true);debris.splice(i,1);}}
 for(let i=wrecks.length-1;i>=0;i--){const w=wrecks[i];w.life-=dt;if(w.life<=0||player&&Vector3.Distance(w.actor.mesh.position,player.mesh.position)>125){disposeActor(w.actor);wrecks.splice(i,1);}}
 if(state.mode==='garage')return;
 const actors=[...police,...traffic,...parked.values(),...wrecks.map(w=>w.actor),...(player?[player]:[])];
 for(const a of actors){const ratio=a.kind==='player'?state.health/state.maxHealth:a.health/a.maxHealth;a.fire?.setEnabled(ratio<.3);if(ratio>=.3){a.burnTime=0;if(a===player)state.burnSeconds=0;}if(ratio>.72)continue;const p=a.mesh.position,angle=a.mesh.rotationQuaternion?.toEulerAngles().y??a.angle,hood=new Vector3(p.x+Math.sin(angle)*a.spec.length*.27,p.y+.6,p.z+Math.cos(angle)*a.spec.length*.27);
  if(frame%8===0)effects.smoke(ratio<.3?hood.add(new Vector3(0,1.05,0)):hood,ratio<.3);if(ratio<.3){enableFire(a);a.fire!.scaling.set(.9+Math.sin(frame*.7)*.1,.85+Math.sin(frame*.43+a.mesh.uniqueId)*.2,1);if(frame%6===0)effects.burst(hood,'#ffcf62',2,2.1);}
  if(ratio<.3&&!a.exploded&&state.mode==='playing'&&!(a===player&&state.sandbox&&state.cheats.invincible)){if(a!==player)a.disabled=true;a.burnTime+=dt;if(a===player)state.burnSeconds=Math.max(0,Math.ceil(8-a.burnTime));if(a.burnTime>=8){const at=p.clone();if(a===player){a.exploded=true;hurt(state.maxHealth*100);state.burnSeconds=0;}else killActor(a);explosion(at,90,a);}}
 }
}
function updateContract(dt:number,speed:number){const mission=contracts[contractIndex%contracts.length];if(state.wanted>0)contractSawWanted=true;switch(contractIndex%4){case 0:contractProgress+=speed*dt;break;case 1:if(speed*3.6>=60)contractProgress+=dt;break;case 2:contractProgress=state.kills-contractKills;break;case 3:if(contractSawWanted&&state.wanted===0)contractProgress=1;break;}state.objective=mission.label;state.objectiveTarget=mission.target;state.objectiveReward=mission.reward;state.objectiveProgress=Math.min(mission.target,Math.floor(contractProgress));if(contractProgress>=mission.target){state.earned+=mission.reward;notice(`Контракт выполнен · +${mission.reward} $`,4);audio.effect('pickup');contractIndex++;contractProgress=0;contractKills=state.kills;contractSawWanted=state.wanted>0;}}
function awardChallenges(dt:number,speed:number,returnedAfterFiveStars=false){if(state.sandbox)return;speedStreak=speed*3.6>=80?speedStreak+dt:0;const distance=Math.max(0,speed*dt),offroadDistance=player&&!world.isRoad(player.mesh.position.x,player.mesh.position.z)?distance:0;const awards=advanceChallenges(save,{distance,offroadDistance,speedStreak,returnedAfterFiveStars,sandbox:false});challengeSaveClock+=dt;if(awards.length){persist();notice(`Испытание выполнено! Открыта ${awards.map(id=>CARS.find(c=>c.id===id)!.name).join(', ')}.`,6);audio.effect('pickup');}else if(challengeSaveClock>=5){persist();challengeSaveClock=0;}}
// Rendering is interpolated between 60 Hz physics steps. The collider never follows the camera.
scene.onBeforeRenderObservable.add(()=>{if(!player)return;const alpha=Math.max(0,Math.min(1,physicsAccumulator*60));for(const a of allActors()){if(a.mesh.isDisposed())continue;const pos=a.mesh.position,angle=a.mesh.rotationQuaternion!.toEulerAngles().y,snap=Vector3.DistanceSquared(pos,a.previousPosition)>100||state.mode!=='playing';a.visual.root.position.copyFrom(snap?pos:Vector3.Lerp(a.previousPosition,pos,alpha));a.visual.root.position.y-=.425;a.visual.root.rotationQuaternion=Quaternion.FromEulerAngles(0,snap?angle:a.previousAngle+wrapAngle(angle-a.previousAngle)*alpha,0);a.visual.setCompact?.(a.kind!=='player'&&Vector3.DistanceSquared(pos,player.mesh.position)>18*18);}
 const pos=player.visual.root.position,v=player.physics.body.getLinearVelocity(),speed=Math.hypot(v.x,v.z),dt=renderDt;tracked.x+=(pos.x+v.x*.3-tracked.x)*(1-Math.exp(-dt*5));tracked.z+=(pos.z+v.z*.3-tracked.z)*(1-Math.exp(-dt*5));cameraZoom+=(23+Math.min(6,speed*.13)-cameraZoom)*(1-Math.exp(-dt*3));const aspect=canvas.clientWidth/canvas.clientHeight;camera.orthoTop=cameraZoom;camera.orthoBottom=-cameraZoom;camera.orthoLeft=-cameraZoom*aspect;camera.orthoRight=cameraZoom*aspect;camera.position.set(tracked.x+45,60,tracked.z-45);camera.setTarget(new Vector3(tracked.x,0,tracked.z));sun.position.set(pos.x+40,70,pos.z-35);world.updateOcclusion?.(camera.position,player.mesh.position,dt);
});

function renderMinimap(){if(!player)return;const markers:RadarMarker[]=[...police.map(a=>({x:a.mesh.position.x,z:a.mesh.position.z,type:'police' as const})),...traffic.map(a=>({x:a.mesh.position.x,z:a.mesh.position.z,type:'traffic' as const})),...helis.map(h=>({x:h.visual.root.position.x,z:h.visual.root.position.z,type:'helicopter' as const})),...pickups.map(p=>({x:p.mesh.position.x,z:p.mesh.position.z,type:'pickup' as const}))];ui.drawMinimap(world,player.mesh.position.x,player.mesh.position.z,player.angle,markers);atlas.update(player.mesh.position.x,player.mesh.position.z,player.angle,markers);}
function resize(){engine.resize();garage.resize();}
window.addEventListener('resize',resize);resize();
window.addEventListener('keydown',e=>{
 if(e.code==='Escape'&&atlas.isOpen){e.preventDefault();atlas.close();return;}
 const interactive=e.target instanceof Element&&!!e.target.closest('button,summary,a,select,input,textarea,[role="dialog"]');
 if(e.code==='Tab'&&player&&(atlas.isOpen||state.mode==='playing'&&!interactive)){e.preventDefault();if(!e.repeat)atlas.toggle();return;}
 if(atlas.isOpen)return;
 const textInput=e.target instanceof Element&&!!e.target.closest('select,input,textarea,[role="dialog"]');
 if(e.code!=='Escape'&&(textInput||interactive&&(state.mode!=='playing'||['Space','Enter','Tab','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))))return;
 if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();keys.add(e.code);if(e.repeat)return;
 if(e.code==='Escape'){if(state.mode==='playing'){state.mode='paused';mouseDown=grenadeDown=false;}else if(state.mode==='paused')state.mode='playing';ui.render(state,save);}
 if(e.code==='KeyG'&&state.mode==='playing'&&state.canGarage&&state.garageDistance<13)enterGarage();
 if(e.code==='Digit1')chooseWeapon('turret');if(e.code==='Digit2')chooseWeapon('rocket');
 if(e.code==='KeyM'){save.music=!save.music;audio.toggle(save.music);persist();}
});
window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>{keys.clear();mouseDown=grenadeDown=false;if(state.mode==='playing')state.mode='paused';});
function moveAim(e:MouseEvent){if(atlas.isOpen)return;const bounds=canvas.getBoundingClientRect();mouseX=e.clientX-bounds.left;mouseY=e.clientY-bounds.top;if(state.mode==='playing')updateAim();}
window.addEventListener('mousemove',moveAim);window.addEventListener('pointermove',moveAim);
function pointerDown(e:MouseEvent){if(state.mode!=='playing'||atlas.isOpen)return;const now=performance.now();if(now-lastPointerDown<25)return;lastPointerDown=now;moveAim(e);audio.start(save.music);if(e.button===0){primaryPointerHandled=true;mouseDown=state.weapon==='turret';primaryFire();}if(e.button===2){grenadeDown=true;throwGrenade();}document.documentElement.dataset.lastInput=e.type+':'+e.button;}
canvas.addEventListener('pointerdown',pointerDown);canvas.addEventListener('mousedown',pointerDown);
function pointerUp(e:MouseEvent){if(e.button===0)mouseDown=false;if(e.button===2)grenadeDown=false;}
window.addEventListener('pointerup',pointerUp);window.addEventListener('mouseup',pointerUp);
canvas.addEventListener('click',e=>{if(primaryPointerHandled){primaryPointerHandled=false;return;}if(state.mode==='playing'&&!atlas.isOpen&&performance.now()-lastPrimary>130){moveAim(e);primaryFire();}});
canvas.addEventListener('contextmenu',e=>{e.preventDefault();if(state.mode==='playing'&&!atlas.isOpen&&performance.now()-lastSecondary>850){mouseX=e.clientX;mouseY=e.clientY;updateAim();throwGrenade();}});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.mode==='playing'){state.mode='paused';keys.clear();mouseDown=grenadeDown=false;}});
engine.runRenderLoop(()=>{const dt=Math.min(.05,engine.getDeltaTime()/1000);renderDt=dt;frame++;update(dt);if(state.mode==='garage'){lockLayer.hidden=true;garage.update(dt);garageScene.render();}else {scene.physicsEnabled=state.mode==='playing'&&!atlas.isOpen;if(scene.physicsEnabled)physicsAccumulator=Math.min(.25,physicsAccumulator+dt);scene.render();renderLocks();}if(frame%6===0){ui.render(state,save);renderMinimap();document.documentElement.dataset.diagnostics=JSON.stringify({garageView:IS_QA&&state.mode==='garage'?garageScene.metadata?.garageView:undefined,mode:state.mode,ready:physicsReady,health:Math.round(state.health),engine:Math.round(state.engine),tires:Math.round(state.tires),wanted:state.wanted,ammo:state.ammo,heat:Math.round(state.heat),earned:Math.floor(state.earned),credits:save.credits,selected:save.selected,turretOwned:save.turretOwned,turretEquipped:state.turretEquipped,cooling:save.turretCooling,sandbox:state.sandbox,cheats:state.cheats,assists:{turret:state.turretAssist,rocket:state.rocketAssist},challengeProgress:save.challenges,owned:save.owned,position:player?{x:Math.round(player.mesh.position.x),z:Math.round(player.mesh.position.z)}:null,meshes:scene.meshes.length,active:scene.getActiveMeshes().length,bodies:proxies.size+police.length+traffic.length+debris.length+(player?1:0),police:police.length,helis:helis.length,skids:skids.count,debris:debris.length,wrecks:wrecks.length,slip:player?Math.round(player.slip*180/Math.PI):0,roll:player?Math.round(player.dynamics.roll*180/Math.PI):0,turretYaw:player?+player.visual.turret.rotation.y.toFixed(2):0,mouse:[Math.round(mouseX),Math.round(mouseY)],fps:Math.round(engine.getFps())});}canvas.style.filter=damageClock>0?'sepia(.25) saturate(1.5)':'none';});
ui.render(state,save);

// Read-only diagnostics for repeatable browser QA and performance inspection.
Object.defineProperty(window,'dustline',{value:{get state(){return {...state};},get save(){return JSON.parse(JSON.stringify(save));},get ready(){return physicsReady;},get position(){return player?{x:player.mesh.position.x,y:player.mesh.position.y,z:player.mesh.position.z}:null;},get diagnostics(){return {meshes:scene.meshes.length,active:scene.getActiveMeshes().length,bodies:proxies.size+police.length+traffic.length+(player?1:0),fps:engine.getFps(),drawCalls:engine._drawCalls?.current||0};}}});

// Development-only deterministic scenarios. Invisible in normal play and omitted from production.
if(IS_QA){
 const original=JSON.stringify(save),panel=document.createElement('aside');panel.setAttribute('aria-label','Проверка игры');panel.style.cssText='position:fixed;top:80px;left:50%;transform:translateX(-50%);z-index:90;display:flex;flex-wrap:wrap;max-width:96vw;gap:5px;padding:6px;background:#131b19;font:11px monospace;color:white;pointer-events:auto';
 function button(label:string,fn:()=>void){const b=document.createElement('button');b.textContent=label;b.style.cssText='background:#e6ef64;color:#172018;padding:7px;border:0;cursor:pointer;font:inherit';b.onclick=()=>{b.blur();fn();ui.render(state,save);};panel.append(b);}
 button('QA: гараж',()=>{if(!physicsReady)return;if(!player)startRun();state.mode='playing';state.health=55;state.engine=60;state.tires=65;state.earned=800;police.forEach(disposeActor);police=[];helis.forEach(h=>h.visual.dispose());helis=[];state.wanted=0;startGrace=0;peaceUntil=20;state.canGarage=true;state.garageDistance=0;player!.mesh.position.set(18,.6,18);player!.physics.body.disablePreStep=false;player!.physics.body.setLinearVelocity(Vector3.Zero());tracked.set(18,0,18);enterGarage();});
 button('QA: авиация',()=>{if(!physicsReady)return;if(!player)startRun();state.mode='playing';state.wanted=3;startGrace=0;state.health=state.maxHealth;state.engine=state.tires=100;wantedClock=90;spawnHeli(true);});
 button('QA: пустыня',()=>{if(!physicsReady)return;if(!player)startRun();state.mode='playing';let x=216;while(world.biomeAt(x,0)!=='desert'&&x<4320)x+=216;const at=new Vector3(x,.7,3);player!.mesh.position.copyFrom(at);player!.mesh.rotationQuaternion=Quaternion.FromEulerAngles(0,Math.PI/2,0);player!.physics.body.disablePreStep=false;player!.physics.body.setLinearVelocity(Vector3.Zero());tracked.copyFrom(at);world.update(at.x,at.z);});
 button('QA: отрыв',()=>{if(!physicsReady)return;if(!player)startRun();police.forEach(disposeActor);police=[];helis.forEach(h=>h.visual.dispose());helis=[];state.mode='playing';state.wanted=1;startGrace=0;wantedClock=0;spawnClock=0;state.escape=99.99;});
 button('QA: повреждения',()=>{if(!physicsReady)return;startRun();qaFreeDrive=true;state.wanted=0;startGrace=0;hurt(state.maxHealth*.8);const p=player!.mesh.position,cop=createActor({...CARS[0],mass:1100,speed:0},p.x+6,p.z+2,0,'police','#e3e4de');cop.roadblock=true;police.push(cop);hitActor(cop,96);notice('Тест: капот, двери, стёкла, дым и огонь',20);});
 button('QA: дрифт',()=>{if(!physicsReady)return;startRun();qaFreeDrive=true;state.wanted=0;startGrace=0;peaceUntil=999;notice('Тест: W → W + D + Space → контрруление',20);});
 button('QA: трасса',()=>{if(!physicsReady)return;startRun();qaFreeDrive=true;startGrace=0;state.wanted=0;let z=500;while(world.biomeAt(world.roadAt?.(0,z).x??0,z)==='city'&&z<2500)z+=200;const road=world.roadAt!(0,z),at=new Vector3(road.x,.7,road.z);player!.mesh.position.copyFrom(at);player!.mesh.rotationQuaternion=Quaternion.FromEulerAngles(0,road.angle,0);player!.physics.body.disablePreStep=false;player!.physics.body.setLinearVelocity(Vector3.Zero());lastSpeed=0;tracked.copyFrom(at);world.update(at.x,at.z);});
 button('QA: ракеты',()=>{if(!physicsReady)return;state.pursuitEnabled=false;startRun();qaFreeDrive=true;startGrace=0;state.rockets=6;state.weapon='rocket';state.tutorialTime=0;pickups.forEach(p=>p.visual.dispose());pickups=[];const p=player!.mesh.position,a=createActor({...CARS[0],mass:1100,speed:0},p.x,p.z+35,0,'police','#e3e4de');a.roadblock=true;police.push(a);spawnHeli(true);helis[0].visual.root.position.set(p.x-10,15,p.z+15);});
 button('QA: парковка',()=>{if(!physicsReady)return;state.pursuitEnabled=false;startRun();qaFreeDrive=true;startGrace=0;state.tutorialTime=0;const spawn=world.parkedSpawnsNear(0,0,600)[0];if(!spawn){notice('В этом seed рядом нет парковки.');return;}const at=new Vector3(spawn.x-Math.sin(spawn.angle)*11,.7,spawn.z-Math.cos(spawn.angle)*11);player!.mesh.position.copyFrom(at);player!.mesh.rotationQuaternion=Quaternion.FromEulerAngles(0,spawn.angle,0);player!.physics.body.disablePreStep=false;player!.physics.body.setLinearVelocity(Vector3.Zero());tracked.copyFrom(at);world.update(at.x,at.z);syncParked();});
 button('QA: предметы',()=>{if(!physicsReady)return;state.pursuitEnabled=false;startRun();qaFreeDrive=true;startGrace=0;state.tutorialTime=0;pickups.forEach(p=>p.visual.dispose());pickups=[];(['cash','repair','ammo','nitro','rocket'] as PickupKind[]).forEach((kind,i)=>spawnSupply(kind,-9+i*6,23));});
 button('QA: грунт',()=>{if(!physicsReady)return;state.pursuitEnabled=false;startRun();qaFreeDrive=true;startGrace=0;state.tutorialTime=0;let x=60,z=360;while(world.isRoad(x,z))x+=15;const at=new Vector3(x,.7,z);player!.mesh.position.copyFrom(at);player!.mesh.rotationQuaternion=Quaternion.Identity();player!.physics.body.disablePreStep=false;player!.physics.body.setLinearVelocity(Vector3.Zero());tracked.copyFrom(at);world.update(at.x,at.z);});
 button('QA: нитро',()=>{if(!physicsReady)return;state.pursuitEnabled=false;startRun();qaFreeDrive=true;startGrace=0;state.tutorialTime=0;keys.add('KeyW');keys.add('ShiftLeft');setTimeout(()=>{keys.delete('KeyW');keys.delete('ShiftLeft');},3000);});
 button('QA: ремкомплект',()=>{if(player&&state.mode==='playing')spawnSupply('repair',player.mesh.position.x,player.mesh.position.z);});
 button('QA: обучение',()=>{if(!physicsReady)return;settings.tutorialSeen=false;state.pursuitEnabled=false;startRun();qaFreeDrive=true;});
 button('QA: деньги',()=>{save.credits=7000;persist();notice('Тестовый баланс: 7000 $.');});
 button('QA: подбор ракет',()=>{if(!physicsReady)return;state.pursuitEnabled=false;startRun();qaFreeDrive=true;startGrace=0;state.weapon='turret';state.rockets=0;spawnSupply('rocket',player!.mesh.position.x,player!.mesh.position.z);});
 button('QA: падение',()=>{if(!physicsReady)return;state.pursuitEnabled=false;startRun();qaFreeDrive=true;startGrace=0;spawnHeli(true);const h=helis[helis.length-1];h.visual.root.position.copyFrom(player!.mesh.position).addInPlace(new Vector3(12,20,14));hitHeli(h,1000);});
 button('QA: остывание',()=>{if(!physicsReady)return;save.turretOwned=true;save.turretEquipped[save.selected]=true;state.pursuitEnabled=false;startRun();qaFreeDrive=true;startGrace=0;state.heat=100;overheated=true;mouseDown=true;});
 button('QA: погоня',()=>{if(!physicsReady)return;state.pursuitEnabled=true;startRun();qaFreeDrive=false;state.wanted=5;startGrace=0;wantedClock=230;heliClock=0;spawnClock=0;});
 button('QA: восстановить',()=>{save=JSON.parse(original);persist();clearRun();runActive=false;state.mode='garage';state.health=state.maxHealth=100;state.engine=state.tires=state.nitro=100;state.earned=0;refreshPreview();});
 button('QA: скрыть',()=>panel.style.display='none');
 setInterval(()=>{const viewport=camera.viewport.toGlobal(engine.getRenderWidth(),engine.getRenderHeight());const screen=(p:Vector3)=>{const at=Vector3.Project(p,Matrix.Identity(),scene.getTransformMatrix(),viewport);return {x:Math.round(at.x*canvas.clientWidth/engine.getRenderWidth()),y:Math.round(at.y*canvas.clientHeight/engine.getRenderHeight())};};document.documentElement.dataset.gameplay=JSON.stringify({profile:state.handlingProfile,pursuit:state.pursuitEnabled,hud:state.hudLayout,weapon:state.weapon,rockets:state.rockets,missiles:missiles.count,locks:missiles.activeTargetIds(),trafficSide:state.trafficSide,mapOpen:atlas.isOpen,explored:navigation.explored.size,waypoint:navigation.waypoint??null,target:state.targetName,ready:state.rocketReady,burn:state.burnSeconds,tutorial:state.tutorialTime,surface:player?world.surfaceAt(player.mesh.position.x,player.mesh.position.z):null,jets:player?.nitroJets?.filter(j=>j.isEnabled()).length??0,parked:[...parked].map(([id,a])=>({id,x:+a.mesh.position.x.toFixed(2),z:+a.mesh.position.z.toFixed(2),health:a.health,screen:screen(a.mesh.position)})),targets:[...police.map(a=>({type:'police',health:a.health,screen:screen(a.mesh.position.add(new Vector3(0,.65,0)))})),...helis.map(h=>({type:'heli',health:h.health,screen:screen(h.visual.root.position)}))]});},100);
 document.body.append(panel);
 setInterval(()=>{document.documentElement.dataset.implementation=JSON.stringify({physicsAccumulator,weapon:state.weapon,turretOwned:save.turretOwned,equipped:state.turretEquipped,cooling:save.turretCooling,heat:state.heat,overheated,sandbox:state.sandbox,wanted:state.wanted,heliClock,helis:helis.map(h=>({status:h.status,y:h.visual.root.position.y,x:h.visual.root.position.x,z:h.visual.root.position.z,slot:h.slot,health:h.health})),wrecks:wrecks.map(w=>({speed:w.actor.physics.body.getLinearVelocity().length(),disabled:w.actor.disabled})),traffic:traffic.map(a=>({x:a.mesh.position.x,z:a.mesh.position.z,speed:a.physics.body.getLinearVelocity().length(),disabled:a.disabled})),police:police.map(a=>({role:a.spec.policeRole,health:a.health,disabled:a.disabled,speed:a.physics.body.getLinearVelocity().length()})),debris:debris.map(d=>({part:d.mesh.metadata?.part??'car',life:d.life})),challenges:save.challenges,owned:save.owned,volumes:save.volumes});},100);
}
