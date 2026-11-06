import type { TransformNode, Scene, Mesh, Vector3 } from '@babylonjs/core';
export type Biome = 'city' | 'desert' | 'fields' | 'port' | 'forest' | 'snow';
export const BIOME_NAMES: Record<Biome,string> = {city:'ГОРОД',desert:'ПУСТЫНЯ',fields:'ПОЛЯ',port:'ПОРТ',forest:'ХВОЙНЫЙ ЛЕС',snow:'СНЕЖНЫЕ ГОРЫ'};
export const BIOME_COLORS: Record<Biome,string> = {city:'#38423b',desert:'#746447',fields:'#41553e',port:'#425a5f',forest:'#244b3d',snow:'#a6bac0'};
export type Mode = 'garage' | 'playing' | 'paused' | 'gameover';
export type SurfaceKind = 'asphalt' | 'sand' | 'grass' | 'dirt' | 'snow';
export type HandlingProfileId = 'arcade' | 'balanced' | 'drift' | 'grip';
export type TrafficSide = 'right' | 'left';
export type GarageTab = 'garage' | 'cars' | 'tuning' | 'body';
export type HudLayout = 'arcade' | 'minimal' | 'tactical';
export type GraphicsQuality = 'auto' | 'performance' | 'balanced' | 'quality';
export type WeaponKind = 'turret' | 'rocket';
export type AimAssist = 'off' | 'weak' | 'standard';
export type CheatKey = 'invincible' | 'unlimitedNitro' | 'unlimitedAmmo' | 'noOverheat';
export type AudioChannel = 'music' | 'sfx' | 'engine';
export type UpgradeKey = 'engine' | 'armor' | 'tires' | 'handling' | 'nitro';
export type VehicleVariant = 'sport-hatch'|'retro-hatch'|'rally-hatch'|'sedan'|'wagon'|'convertible'|'minibus'|'stepvan'|'camper'|'tow'|'fire'|'ambulance'|'garbage'|'mixer'|'bus'|'sheriff'|'command'|'apc'|'motorcycle';
export interface CarSpec { id: string; name: string; subtitle: string; price: number; color: string; speed: number; handling: number; armor: number; mass: number; width: number; length: number; bodyStyle?:'hatch'|'suv'|'pickup'|'coupe'|'buggy'|'muscle'|'van';policeRole?:'patrol'|'interceptor'|'suv'|'swat';challengeId?:string;visualVariant?:VehicleVariant;extraAxles?:1|2; }
export const CARS: CarSpec[] = [
 {id:'comet',name:'COMET MK2',subtitle:'Широкий и низкий городской хэтч',price:0,color:'#70bda9',speed:30,handling:1.05,armor:100,mass:900,width:2.02,length:3.7,bodyStyle:'hatch',visualVariant:'sport-hatch'},
 {id:'rally',name:'DUNE SCOUT',subtitle:'Внедорожник для коротких путей',price:1800,color:'#859c4a',speed:34,handling:1.2,armor:115,mass:1100,width:1.95,length:3.8,bodyStyle:'suv'},
 {id:'brute',name:'BRUTE RUNNER',subtitle:'Тяжёлый пикап для прорыва',price:3200,color:'#b54526',speed:27,handling:.8,armor:180,mass:1800,width:2.25,length:4.3,bodyStyle:'pickup'},
 {id:'kestrel',name:'KESTREL',subtitle:'Лёгкое купе для городского слалома',price:0,color:'#64bec9',speed:36,handling:1.3,armor:85,mass:800,width:1.8,length:3.7,bodyStyle:'coupe',challengeId:'city-runner'},
 {id:'sandfox',name:'SANDFOX',subtitle:'Багги с уверенным сцеплением вне дорог',price:0,color:'#e6be55',speed:32,handling:1.25,armor:95,mass:850,width:1.95,length:3.5,bodyStyle:'buggy',challengeId:'trailblazer'},
 {id:'cobra',name:'COBRA',subtitle:'Маслкар для скорости и силового заноса',price:0,color:'#aa79bd',speed:40,handling:.98,armor:125,mass:1300,width:2.05,length:4.5,bodyStyle:'muscle',challengeId:'speed-streak'},
 {id:'bastion',name:'BASTION',subtitle:'Бронированный фургон последнего шанса',price:0,color:'#6f8b82',speed:25,handling:.82,armor:240,mass:2300,width:2.25,length:4.6,bodyStyle:'van',challengeId:'most-wanted'},
 {id:'metro',name:'METRO RETRO',subtitle:'Приземистый ретро-компакт с широкими арками',price:1400,color:'#da715c',speed:29,handling:1.18,armor:105,mass:940,width:2.02,length:3.65,bodyStyle:'hatch',visualVariant:'retro-hatch'},
 {id:'pulse',name:'PULSE RALLY',subtitle:'Раллийный хот-хэтч для асфальта и грунта',price:2600,color:'#568fb6',speed:35,handling:1.23,armor:110,mass:1050,width:2.08,length:3.85,bodyStyle:'hatch',visualVariant:'rally-hatch'},
 {id:'nomad',name:'NOMAD GT',subtitle:'Быстрый универсал с багажником на крыше',price:3600,color:'#7ba99b',speed:37,handling:1.06,armor:140,mass:1430,width:2.05,length:4.65,bodyStyle:'hatch',visualVariant:'wagon'}
];
export const PAINTS = ['#fa661b','#70bda9','#da715c','#568fb6','#859c4a','#b54526','#ded9c9','#8aafbf','#b69ad0','#e6ef64','#252d32'];
export const UPGRADE_NAMES: Record<UpgradeKey,string> = {engine:'Двигатель',armor:'Броня',tires:'Шины',handling:'Управляемость',nitro:'Нитро'};
export const TURRET_PRICE=1200;
export interface Challenge {id:string;title:string;description:string;carId:string;target:number;difficulty:'Лёгкое'|'Среднее'|'Сложное'|'Экспертное';}
export const CHALLENGES:Challenge[]=[
 {id:'city-runner',title:'Первый маршрут',description:'Проедь суммарно 2 000 метров в обычных заездах.',carId:'kestrel',target:2000,difficulty:'Лёгкое'},
 {id:'trailblazer',title:'Вне дорог',description:'Проедь суммарно 1 500 метров по грунту, полям или песку.',carId:'sandfox',target:1500,difficulty:'Среднее'},
 {id:'speed-streak',title:'Полминуты на пределе',description:'Держи не менее 80 км/ч 30 секунд подряд в одном обычном заезде.',carId:'cobra',target:30,difficulty:'Сложное'},
 {id:'most-wanted',title:'Последний выход',description:'Уйди от погони с 5 звёздами и вернись в гараж.',carId:'bastion',target:1,difficulty:'Экспертное'}
];
export interface SaveData {schemaVersion:2;credits:number;selected:string;owned:string[];colors:Record<string,string>;upgrades:Record<string,Record<UpgradeKey,number>>;best:number;music:boolean;turretOwned:boolean;turretEquipped:Record<string,boolean>;turretCooling:number;challenges:Record<string,number>;completedChallenges:string[];volumes:Record<AudioChannel,number>;}
export interface GameState { mode: Mode; speed: number; health: number; maxHealth: number; engine: number; tires: number; nitro: number; heat: number; ammo: number; wanted: number; escape: number; seconds: number; earned: number; kills: number; biome: Biome; garageDistance: number; canGarage: boolean; message: string; messageTime: number; fps: number; traffic: number; seed: number; handlingProfile:HandlingProfileId; pursuitEnabled:boolean; trafficSide:TrafficSide; hudLayout:HudLayout; rockets:number; weapon:WeaponKind; targetName:string; rocketReady:boolean; tutorialTime:number;pickupNotice?:string;pickupNoticeTime?:number;burnSeconds?:number; objective?:string; objectiveProgress?:number; objectiveTarget?:number; objectiveReward?:number; }
export interface GameState {turretEquipped:boolean;turretAssist:AimAssist;rocketAssist:AimAssist;sandbox:boolean;cheats:Record<CheatKey,boolean>;wantedOverride:number;}
export interface GameState {graphicsQuality:GraphicsQuality;powerups?:Array<{kind:'magnet'|'smoke'|'emp'|'drone';label:string;seconds:number}>;}
export interface VehicleVisual { root: TransformNode; chassis?:TransformNode; body: Mesh; turret: TransformNode; wheels: TransformNode[]; exhausts:TransformNode[]; setDamage(healthRatio:number,tiresRatio:number):void; setColor(hex:string):void;setTurretEnabled?(enabled:boolean):void;setCompact?(enabled:boolean):void; popDebris?():Mesh[]; dispose():void; }
export interface WorldProp { x:number; z:number; radius:number; mesh:Mesh; breakable:boolean; hp:number; active:boolean;id?:string;kind?:string;height?:number;mass?:number;width?:number;depth?:number;angle?:number;interaction?:'movable'|'breakable'|'facade'|'solid'|'explosive'; }
export interface RoadSpawn { x:number; z:number; angle:number; }
export interface ParkedSpawn extends RoadSpawn {id:string;carId:string;color:string;}
export interface RoadSample { x:number;z:number;angle:number;distance:number;width:number; }
export interface GarageLocation {x:number;z:number;exitX?:number;exitZ?:number;exitAngle?:number;}
export interface MapData { biomeAt(x:number,z:number):Biome; isRoad(x:number,z:number):boolean; garages:GarageLocation[]; }
export interface World extends MapData { setTrafficSide?(side:TrafficSide):void; roadAt?(x:number,z:number,preferredAngle?:number):RoadSample; surfaceAt(x:number,z:number):SurfaceKind; parkedSpawnsNear(x:number,z:number,radius:number):ParkedSpawn[]; update(x:number,z:number,dt?:number):void;updateOcclusion?(cameraPosition:Vector3,target:Vector3,dt:number):void;damageProp?(prop:WorldProp,damage:number,impulse?:Vector3):void;setExplosionHandler?(handler:(at:Vector3,damage:number)=>void):void; propsNear(x:number,z:number,radius:number):WorldProp[]; trafficSpawns(x:number,z:number,count:number,side?:TrafficSide):RoadSpawn[]; destroyProp(prop:WorldProp):void; dispose():void; }
export interface RadarMarker { x:number;z:number;type:'police'|'traffic'|'helicopter'|'pickup'; }
export interface UIActions { start():void; selectCar(id:string):void; buyCar(id:string):void; paint(hex:string):void; upgrade(key:UpgradeKey):void; repair():void; resume():void; garage():void; restart():void; toggleMusic():void; setHandling(profile:HandlingProfileId):void;togglePursuit():void;setHudLayout(layout:HudLayout):void;selectWeapon(weapon:WeaponKind):void; setTrafficSide(side:TrafficSide):void; garageTab(tab:GarageTab):void; openMap():void; }
export interface UIActions {buyTurret():void;toggleTurret():void;upgradeTurret():void;setAimAssist(weapon:WeaponKind,level:AimAssist):void;toggleSandbox():void;setCheat(key:CheatKey,enabled:boolean):void;setWanted(level:number):void;setVolume(channel:AudioChannel,value:number):void;}
export interface UIActions {pause():void;setGraphicsQuality(quality:GraphicsQuality):void;}
export interface GameUI { render(state:GameState,save:SaveData):void; drawMinimap(map:MapData,x:number,z:number,angle:number,markers:RadarMarker[],viewRange?:number):void; dispose():void; }
export const emptyUpgrades=():Record<UpgradeKey,number>=>({engine:0,armor:0,tires:0,handling:0,nitro:0});
export function defaultSave():SaveData {return {schemaVersion:2,credits:800,selected:'comet',owned:['comet'],colors:{},upgrades:{},best:0,music:true,turretOwned:false,turretEquipped:{},turretCooling:0,challenges:{},completedChallenges:[],volumes:{music:.7,sfx:.8,engine:.55}};}
const finite=(value:unknown,fallback=0)=>typeof value==='number'&&Number.isFinite(value)?value:fallback;
const level=(value:unknown)=>Math.max(0,Math.min(3,Math.floor(finite(value))));
/** Existing players keep their built-in turret; fresh saves start without equipment. */
export function normalizeSave(raw:unknown):SaveData {
 const base=defaultSave();if(!raw||typeof raw!=='object'||Array.isArray(raw))return base;
 const r=raw as Record<string,unknown>,legacy=r.schemaVersion!==2;
 const ids=new Set(CARS.map(c=>c.id));base.credits=Math.max(0,finite(r.credits,800));base.best=Math.max(0,finite(r.best));base.music=r.music!==false;
 base.owned=Array.isArray(r.owned)?[...new Set(['comet',...r.owned.filter((id):id is string=>typeof id==='string'&&ids.has(id))])]:['comet'];
 base.selected=typeof r.selected==='string'&&base.owned.includes(r.selected)?r.selected:'comet';
 const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
 for(const [id,color]of Object.entries(record(r.colors)))if(ids.has(id)&&typeof color==='string'&&/^#[0-9a-f]{6}$/i.test(color))base.colors[id]=color;
 for(const [id,values]of Object.entries(record(r.upgrades))){if(!ids.has(id))continue;const u=record(values),normalized=emptyUpgrades();for(const key of Object.keys(normalized)as UpgradeKey[])normalized[key]=level(u[key]);base.upgrades[id]=normalized;}
 base.turretOwned=legacy||r.turretOwned===true;base.turretCooling=level(r.turretCooling);
 for(const id of base.owned)base.turretEquipped[id]=base.turretOwned&&(legacy||record(r.turretEquipped)[id]===true);
 for(const c of CHALLENGES)base.challenges[c.id]=Math.min(c.target,Math.max(0,finite(record(r.challenges)[c.id])));
 base.completedChallenges=Array.isArray(r.completedChallenges)?CHALLENGES.filter(c=>(r.completedChallenges as unknown[]).includes(c.id)).map(c=>c.id):[];
 for(const c of CHALLENGES)if(base.completedChallenges.includes(c.id)){base.challenges[c.id]=c.target;if(!base.owned.includes(c.carId))base.owned.push(c.carId);}
 for(const key of Object.keys(base.volumes)as AudioChannel[])base.volumes[key]=Math.max(0,Math.min(1,finite(record(r.volumes)[key],base.volumes[key])));
 return base;
}
export function carUpgrades(save:SaveData,id=save.selected):Record<UpgradeKey,number> {return {...emptyUpgrades(),...save.upgrades[id]};}
export function upgradeCost(value:number,key:UpgradeKey='armor'):number {return ({engine:400,armor:350,tires:300,handling:350,nitro:400}[key])+Math.max(0,value)*300;}
export function turretCoolingCost(value:number):number {return 450+Math.max(0,value)*350;}
export function turretAvailable(save:SaveData,id=save.selected):boolean {return save.turretOwned&&save.owned.includes(id)&&save.turretEquipped[id]===true;}
export function challengeProgress(save:SaveData,id:string):number {return save.challenges[id]||0;}
export type VehicleFactory = (scene:Scene,spec:CarSpec,color:string,kind?:'player'|'police'|'traffic')=>VehicleVisual;
