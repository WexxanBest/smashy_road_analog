import type { TransformNode, Scene, Mesh } from '@babylonjs/core';
export type Biome = 'city' | 'desert' | 'fields';
export type Mode = 'garage' | 'playing' | 'paused' | 'gameover';
export type SurfaceKind = 'asphalt' | 'sand' | 'grass' | 'dirt';
export type HandlingProfileId = 'arcade' | 'balanced' | 'drift' | 'grip';
export type TrafficSide = 'right' | 'left';
export type GarageTab = 'garage' | 'cars' | 'tuning' | 'body';
export type HudLayout = 'arcade' | 'minimal' | 'tactical';
export type WeaponKind = 'turret' | 'rocket';
export type UpgradeKey = 'engine' | 'armor' | 'tires' | 'nitro';
export interface CarSpec { id: string; name: string; subtitle: string; price: number; color: string; speed: number; handling: number; armor: number; mass: number; width: number; length: number; }
export const CARS: CarSpec[] = [
 {id:'comet',name:'COMET',subtitle:'Лёгкий городской беглец',price:0,color:'#e6ef64',speed:30,handling:1.05,armor:100,mass:900,width:1.85,length:3.6},
 {id:'rally',name:'DUNE',subtitle:'Ралли за пределами дорог',price:1800,color:'#ef8155',speed:34,handling:1.2,armor:115,mass:1100,width:1.95,length:3.8},
 {id:'brute',name:'BRUTE',subtitle:'Тяжёлый аргумент на дороге',price:3200,color:'#8aafbf',speed:27,handling:0.8,armor:180,mass:1800,width:2.25,length:4.3}
];
export const PAINTS = ['#e6ef64','#ef8155','#8aafbf','#ded9c9','#b69ad0','#252d32'];
export const UPGRADE_NAMES: Record<UpgradeKey,string> = {engine:'Двигатель',armor:'Броня',tires:'Сцепление',nitro:'Нитро'};
export interface SaveData { credits: number; selected: string; owned: string[]; colors: Record<string,string>; upgrades: Record<string,Record<UpgradeKey,number>>; best: number; music: boolean; }
export interface GameState { mode: Mode; speed: number; health: number; maxHealth: number; engine: number; tires: number; nitro: number; heat: number; ammo: number; wanted: number; escape: number; seconds: number; earned: number; kills: number; biome: Biome; garageDistance: number; canGarage: boolean; message: string; messageTime: number; fps: number; traffic: number; seed: number; handlingProfile:HandlingProfileId; pursuitEnabled:boolean; trafficSide:TrafficSide; hudLayout:HudLayout; rockets:number; weapon:WeaponKind; targetName:string; rocketReady:boolean; tutorialTime:number;pickupNotice?:string;pickupNoticeTime?:number;burnSeconds?:number; objective?:string; objectiveProgress?:number; objectiveTarget?:number; objectiveReward?:number; }
export interface VehicleVisual { root: TransformNode; chassis?:TransformNode; body: Mesh; turret: TransformNode; wheels: TransformNode[]; exhausts:TransformNode[]; setDamage(healthRatio:number,tiresRatio:number):void; setColor(hex:string):void;setCompact?(enabled:boolean):void; popDebris?():Mesh[]; dispose():void; }
export interface WorldProp { x:number; z:number; radius:number; mesh:Mesh; breakable:boolean; hp:number; active:boolean; }
export interface RoadSpawn { x:number; z:number; angle:number; }
export interface ParkedSpawn extends RoadSpawn {id:string;carId:string;color:string;}
export interface RoadSample { x:number;z:number;angle:number;distance:number;width:number; }
export interface GarageLocation {x:number;z:number;exitX?:number;exitZ?:number;exitAngle?:number;}
export interface MapData { biomeAt(x:number,z:number):Biome; isRoad(x:number,z:number):boolean; garages:GarageLocation[]; }
export interface World extends MapData { setTrafficSide?(side:TrafficSide):void; roadAt?(x:number,z:number,preferredAngle?:number):RoadSample; surfaceAt(x:number,z:number):SurfaceKind; parkedSpawnsNear(x:number,z:number,radius:number):ParkedSpawn[]; update(x:number,z:number):void; propsNear(x:number,z:number,radius:number):WorldProp[]; trafficSpawns(x:number,z:number,count:number,side?:TrafficSide):RoadSpawn[]; destroyProp(prop:WorldProp):void; dispose():void; }
export interface RadarMarker { x:number;z:number;type:'police'|'traffic'|'helicopter'|'pickup'; }
export interface UIActions { start():void; selectCar(id:string):void; buyCar(id:string):void; paint(hex:string):void; upgrade(key:UpgradeKey):void; repair():void; resume():void; garage():void; restart():void; toggleMusic():void; setHandling(profile:HandlingProfileId):void;togglePursuit():void;setHudLayout(layout:HudLayout):void;selectWeapon(weapon:WeaponKind):void; setTrafficSide(side:TrafficSide):void; garageTab(tab:GarageTab):void; openMap():void; }
export interface GameUI { render(state:GameState,save:SaveData):void; drawMinimap(map:MapData,x:number,z:number,angle:number,markers:RadarMarker[]):void; dispose():void; }
export function defaultSave():SaveData { return {credits:800,selected:'comet',owned:['comet'],colors:{},upgrades:{},best:0,music:true}; }
export function carUpgrades(save:SaveData,id=save.selected):Record<UpgradeKey,number> { return save.upgrades[id] || {engine:0,armor:0,tires:0,nitro:0}; }
export function upgradeCost(level:number):number { return 350+level*300; }
export type VehicleFactory = (scene:Scene,spec:CarSpec,color:string,kind?:'player'|'police'|'traffic')=>VehicleVisual;
