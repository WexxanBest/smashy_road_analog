import { Color3, Mesh, Scene, StandardMaterial, TransformNode, Vector3, VertexBuffer, VertexData, type ShadowGenerator } from '@babylonjs/core';
import type { Biome, GarageLocation, ParkedSpawn, RoadSample, RoadSpawn, SurfaceKind, World, WorldProp } from './types';
import { createWorldInteractions, type PropOptions } from './world-interactions';

const CHUNK = 72;
const ROAD = 12;
const HALF = CHUNK / 2;
const NS_GAP = 960;
const EW_GAP = 1100;
const LOCAL = [-104, -48, 48, 104];
const STREETS = [-104, -48, 0, 48, 104];
type Chunk = { x: number; z: number; mesh: Mesh; props: WorldProp[]; visuals: WorldProp[] };
type Point = { x: number; z: number };
type District = Point & { id: string; enabled: boolean };
type GarageSite = GarageLocation & { id: string; rotation: number };
type Access = { id: string; points: Point[] };
type ParkingLot = Point & { id: string; rotation: number; width: number; depth: number; entrance: Point; street: Point; slots: ParkedSpawn[] };
type RoadRoute = { id: string; width: number; dirt: boolean; from: number; to: number; sample(t:number):RoadSample; distance(x:number,z:number):number };
type ArrowRange = { start: number; count: number; x: number; z: number; rightPositions: Float32Array };
type Part = {
  primitive: VertexData;
  x: number; y: number; z: number;
  width: number; height: number; depth: number;
  color: Color3;
  rotation: { x: number; y: number; z: number };
  topRatio?: number;
  emissive?: boolean;
  arrow?: { x: number; z: number; rightPositions: Float32Array };
};
// Topology is shared; tapered cylinder rings and normals are baked below.
const unitBox = VertexData.CreateBox({ size: 1 });
const unitPanel = VertexData.CreatePlane({ size: 1 });
const unitCrown = VertexData.CreateIcoSphere({ radius: 0.5, subdivisions: 1, flat: true });
const unitCylinders = new Map<number, VertexData>();

function hash(x: number, z: number, seed: number): number {
  let n = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ Math.imul(seed, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
function random(seed: number): () => number {
  let value = seed | 0;
  return () => {
    value += 0x6d2b79f5;
    let n = Math.imul(value ^ (value >>> 15), 1 | value);
    n ^= n + Math.imul(n ^ (n >>> 7), 61 | n);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}
/** A streamed, seeded road network. Static scenery and emissive panels use two batches per urban tile. */
export function createWorld(scene: Scene, seed: number): World {
  const chunks = new Map<string, Chunk>();
  const material = new StandardMaterial('world-vertex-colors', scene);
  material.diffuseColor = Color3.White();
  material.specularColor = Color3.Black();
  material.backFaceCulling = true;
  const lightMaterial = new StandardMaterial('world-emissive-panels', scene);
  lightMaterial.diffuseColor = Color3.White();
  lightMaterial.emissiveColor = Color3.White();
  lightMaterial.specularColor = Color3.Black();
  lightMaterial.disableLighting = true;
  const colors = new Map<string, Color3>();
  let trafficSerial = 0;
  let trafficMarkingSide: 'right'|'left' = 'right';
  const arrowRanges = new WeakMap<Mesh,ArrowRange[]>();
  let disposed = false;
  const shadow = (scene.metadata as { shadowGenerator?: ShadowGenerator } | null)?.shadowGenerator;
  const interactions = createWorldInteractions(scene, shadow);
  const garages: GarageSite[] = [];
  const districts = new Map<string, District>();
  const accesses = new Map<string, Access | null>();
  const phases = new Map<string, { a: number; b: number; origin: number }>();
  const parking = new Map<string, ParkingLot[]>();
  const soilPatches = new Map<string, Point[][]>();
  const climate = hash(7, 13, seed) * 700;

  function rawCurve(kind: 0 | 1, index: number, t: number): { value: number; slope: number } {
    const key = kind + ':' + index;
    let phase = phases.get(key);
    if (!phase) {
      const a = hash(index, kind + 771, seed) * Math.PI * 2;
      const secondary = hash(index, kind + 993, seed);
      // Keep the initial approach gentle for every seed while rural curves stay pronounced.
      const b = kind === 0 && index === 0 ? Math.PI / 2 + (secondary - 0.5) * 0.35 : secondary * Math.PI * 2;
      phase = { a, b, origin: (kind === 0 ? 35 : 44) * Math.sin(a) + (kind === 0 ? 24 : 28) * Math.sin(b) };
      phases.set(key, phase);
      if (phases.size > 128) phases.delete(phases.keys().next().value!);
    }
    const amplitude = kind === 0 ? 35 : 44;
    const minor = kind === 0 ? 24 : 28;
    const scale = kind === 0 ? 230 : 270;
    const scale2 = kind === 0 ? 65 : 75;
    const a = t / scale + phase.a;
    const b = t / scale2 + phase.b;
    return { value: index * (kind === 0 ? NS_GAP : EW_GAP) + amplitude * Math.sin(a) + minor * Math.sin(b) - phase.origin, slope: amplitude / scale * Math.cos(a) + minor / scale2 * Math.cos(b) };
  }
  function artery(kind: 0 | 1, index: number, t: number): RoadSample {
    const c = curve(kind, index, t);
    return kind === 0 ? { x: c.value, z: t, angle: Math.atan2(c.slope, 1), width: ROAD, distance: 0 } : { x: t, z: c.value, angle: Math.atan2(1, c.slope), width: ROAD, distance: 0 };
  }
  function district(ix: number, iz: number): District {
    const key = ix + ':' + iz;
    let value = districts.get(key);
    if (!value) {
      let x = ix * NS_GAP, z = iz * EW_GAP;
      for (let i = 0; i < 6; i++) { x = rawCurve(0, ix, z).value; z = rawCurve(1, iz, x).value; }
      value = { x, z, id: key, enabled: key === '0:0' || hash(ix, iz, seed + 7321) < 0.58 };
      districts.set(key, value);
      if (districts.size > 128) districts.delete(districts.keys().next().value!);
    }
    return value;
  }
  function curve(kind: 0 | 1, index: number, t: number): { value: number; slope: number } {
    const raw = rawCurve(kind, index, t);
    const other = Math.round(t / (kind === 0 ? EW_GAP : NS_GAP));
    const d = kind === 0 ? district(index, other) : district(other, index);
    const along = kind === 0 ? d.z : d.x, target = kind === 0 ? d.x : d.z;
    const delta = t - along, distance = Math.abs(delta);
    if (!d.enabled || distance >= 300) return raw;
    if (distance <= 120) return { value: target, slope: 0 };
    const u = (distance - 120) / 180, blend = u * u * (3 - 2 * u);
    const derivative = 6 * u * (1 - u) / 180 * Math.sign(delta);
    return { value: target + (raw.value - target) * blend, slope: raw.slope * blend + (raw.value - target) * derivative };
  }
  function nearbyDistrict(x: number, z: number): District | undefined {
    const d = district(Math.round(x / NS_GAP), Math.round(z / EW_GAP));
    return d.enabled && Math.abs(x - d.x) < 156 && Math.abs(z - d.z) < 146 ? d : undefined;
  }
  function biomeAt(x: number, z: number): Biome {
    const d = nearbyDistrict(x, z);
    if (d && Math.max(Math.abs(x - d.x) / 136, Math.abs(z - d.z) / 128) < 1 + 0.06 * Math.sin((x + z) / 29)) return 'city';
    const humidity = Math.sin((x + climate) / 410) + 0.75 * Math.sin((z - climate) / 360) + 0.45 * Math.sin((x + z) / 180);
    return humidity > 0.25 ? 'desert' : 'fields';
  }
  function nearestLine(kind: 0 | 1, index: number, x: number, z: number): RoadSample {
    const along = kind === 0 ? z : x;
    const across = kind === 0 ? x : z;
    let t = along;
    for (let i = 0; i < 3; i++) {
      const c = curve(kind, index, t);
      t -= ((c.value - across) * c.slope + t - along) / (1 + c.slope * c.slope);
    }
    const result = artery(kind, index, t);
    result.distance = Math.hypot(result.x - x, result.z - z);
    return result;
  }
  function segmentRoad(a: Point, b: Point, x: number, z: number, width: number): RoadSample {
    const dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
    const px = a.x + t * dx, pz = a.z + t * dz;
    return { x: px, z: pz, angle: Math.atan2(dx, dz), width, distance: Math.hypot(x - px, z - pz) };
  }
  function access(index: number, number: number): Access | undefined {
    const id = index + ':' + number;
    if (accesses.has(id)) return accesses.get(id) ?? undefined;
    let value: Access | null = null;
    if (hash(index, number, seed + 879) < 0.25) {
      const start = artery(0, index, number * 650 + 120 + hash(index, number, seed + 88) * 180);
      if (!nearbyDistrict(start.x, start.z)) {
        const side = hash(index, number, seed + 65) < 0.5 ? -1 : 1;
        const nx = Math.cos(start.angle) * side, nz = -Math.sin(start.angle) * side;
        value = { id, points: [start, { x: start.x + nx * 42 + Math.sin(start.angle) * 9, z: start.z + nz * 42 + Math.cos(start.angle) * 9 }, { x: start.x + nx * 93 + Math.sin(start.angle) * 24, z: start.z + nz * 93 + Math.cos(start.angle) * 24 }] };
      }
    }
    accesses.set(id, value);
    if (accesses.size > 128) accesses.delete(accesses.keys().next().value!);
    return value ?? undefined;
  }
  function roadAt(x: number, z: number, preferredAngle?: number): RoadSample {
    const ni = Math.round(x / NS_GAP), ei = Math.round(z / EW_GAP);
    let best = nearestLine(0, ni, x, z);
    const candidates = [nearestLine(1, ei, x, z)];
    if (best.distance > NS_GAP * 0.35) candidates.push(nearestLine(0, ni + (x > ni * NS_GAP ? 1 : -1), x, z));
    if (candidates[0].distance > EW_GAP * 0.35) candidates.push(nearestLine(1, ei + (z > ei * EW_GAP ? 1 : -1), x, z));
    const d = nearbyDistrict(x, z);
    if (d) for (const offset of LOCAL) {
      candidates.push(segmentRoad({ x: d.x + offset, z: d.z - 104 }, { x: d.x + offset, z: d.z + 104 }, x, z, 9));
      candidates.push(segmentRoad({ x: d.x - 104, z: d.z + offset }, { x: d.x + 104, z: d.z + offset }, x, z, 9));
    }
    if (Math.abs(x - ni * NS_GAP) < 220) for (let k = Math.floor(z / 650) - 1; k <= Math.floor(z / 650) + 1; k++) {
      const a = access(ni, k);
      if (a) for (let i = 0; i < a.points.length - 1; i++) candidates.push(segmentRoad(a.points[i], a.points[i + 1], x, z, 4.5));
    }
    const all = [best, ...candidates];
    for (const candidate of candidates) if (candidate.distance < best.distance) best = candidate;
    if (preferredAngle !== undefined) {
      const limit = best.distance + 4;
      let score = Infinity;
      for (const candidate of all) {
        const value = candidate.distance + Math.abs(Math.sin(candidate.angle - preferredAngle)) * 5;
        if (candidate.distance <= limit && value < score) { best = candidate; score = value; }
      }
    }
    return best;
  }
  function isRoad(x: number, z: number): boolean {
    const n = Math.round(x / NS_GAP), e = Math.round(z / EW_GAP);
    const ns = curve(0, n, z), ew = curve(1, e, x);
    if (Math.abs(ns.value - x) < ROAD * 0.5 * Math.sqrt(1 + ns.slope * ns.slope) || Math.abs(ew.value - z) < ROAD * 0.5 * Math.sqrt(1 + ew.slope * ew.slope)) return true;
    const d = nearbyDistrict(x, z);
    if (d && Math.abs(x - d.x) <= 108.5 && Math.abs(z - d.z) <= 108.5) {
      if (LOCAL.some(offset => Math.abs(x - d.x - offset) <= 4.5 || Math.abs(z - d.z - offset) <= 4.5)) return true;
    }
    if (Math.abs(x - ns.value) < 115) for (let k = Math.floor(z / 650) - 1; k <= Math.floor(z / 650) + 1; k++) {
      const a = access(n, k);
      if (a && a.points.some((p, i) => i > 0 && segmentRoad(a.points[i - 1], p, x, z, 4.5).distance <= 2.25)) return true;
    }
    return false;
  }
  function localPoint(site: Point & { rotation: number }, x: number, z: number): Point {
    const c = Math.cos(site.rotation), s = Math.sin(site.rotation);
    return { x: site.x + c * x + s * z, z: site.z - s * x + c * z };
  }
  function parkingLots(d: District): ParkingLot[] {
    const cached = parking.get(d.id);
    if (cached) return cached;
    const result: ParkingLot[] = [];
    for (const ox of [-76, -24, 24, 76]) for (const oz of [-76, -24, 24, 76]) {
      if (d.id === '0:0' && ox === 24 && oz === 24) continue;
      const r = random((hash(ox + Math.round(d.x), oz + Math.round(d.z), seed + 312) * 2147483647) | 0);
      const kind = r();
      if (!(kind >= 0.2 && kind < 0.36) && !(d.id === '0:0' && ox === -24 && oz === 24)) continue;
      const x = d.x + ox, z = d.z + oz, side = Math.floor(r() * 4);
      const rotation = [0, Math.PI, Math.PI / 2, -Math.PI / 2][side];
      const lot: ParkingLot = { id: d.id + '-parking-' + ox + ':' + oz, x, z, rotation, width: 24, depth: 24, entrance: { x: 0, z: 0 }, street: { x: 0, z: 0 }, slots: [] };
      lot.entrance = localPoint(lot, 0, -12);
      const axis = side < 2 ? oz : ox;
      const boundaries = axis === -76 ? [-104, -48] : axis === -24 ? [-48, 0] : axis === 24 ? [0, 48] : [48, 104];
      const boundary = side === 0 || side === 2 ? boundaries[0] : boundaries[1];
      const streetWidth = boundary === 0 ? ROAD : 9;
      lot.street = side < 2 ? { x, z: d.z + boundary + (side === 0 ? 1 : -1) * streetWidth / 2 } : { x: d.x + boundary + (side === 2 ? 1 : -1) * streetWidth / 2, z };
      for (let row = -1; row <= 1; row++) for (const bay of [-1, 1]) {
        if (r() > 0.72) continue;
        const p = localPoint(lot, bay * 7.3, row * 6);
        const colors = ['#ded9c9', '#8aafbf', '#ef8155', '#b69ad0', '#d6b875', '#65777a'];
        lot.slots.push({ ...p, id: lot.id + '-car-' + row + ':' + bay, angle: rotation + (bay < 0 ? Math.PI / 2 : -Math.PI / 2), carId: r() < 0.12 ? 'brute' : r() < 0.35 ? 'rally' : 'comet', color: colors[Math.floor(r() * colors.length)] });
      }
      result.push(lot);
    }
    parking.set(d.id, result);
    if (parking.size > 96) parking.delete(parking.keys().next().value!);
    return result;
  }
  function containsPolygon(points: Point[], x: number, z: number): boolean {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[i], b = points[j];
      if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) inside = !inside;
    }
    return inside;
  }
  function parkingContains(lot: ParkingLot, x: number, z: number, margin = 0): boolean {
    const c = Math.cos(lot.rotation), s = Math.sin(lot.rotation), dx = x - lot.x, dz = z - lot.z;
    if (Math.abs(dx * c - dz * s) <= lot.width / 2 + margin && Math.abs(dx * s + dz * c) <= lot.depth / 2 + margin) return true;
    return segmentRoad(lot.entrance, lot.street, x, z, 5.6).distance < 2.8 + margin;
  }
  function parkedSpawnsNear(x: number, z: number, radius: number): ParkedSpawn[] {
    const result: ParkedSpawn[] = [];
    const rx = Math.ceil(radius / NS_GAP) + 1, rz = Math.ceil(radius / EW_GAP) + 1;
    for (let ix = Math.round(x / NS_GAP) - rx; ix <= Math.round(x / NS_GAP) + rx; ix++) for (let iz = Math.round(z / EW_GAP) - rz; iz <= Math.round(z / EW_GAP) + rz; iz++) {
      const d = district(ix, iz);
      if (!d.enabled || Math.hypot(d.x - x, d.z - z) > radius + 160) continue;
      for (const lot of parkingLots(d)) for (const slot of lot.slots) if (Math.hypot(slot.x - x, slot.z - z) <= radius) result.push({ ...slot });
    }
    return result;
  }
  function surfaceAt(x: number, z: number): SurfaceKind {
    if (isRoad(x, z)) {
      const road = roadAt(x, z);
      if (road.width >= 7 || nearestLine(0, Math.round(x / NS_GAP), x, z).distance <= 6 || nearestLine(1, Math.round(z / EW_GAP), x, z).distance <= 6) return 'asphalt';
      return 'dirt';
    }
    const d = nearbyDistrict(x, z);
    if (d && parkingLots(d).some(lot => parkingContains(lot, x, z))) return 'asphalt';
    for (const g of garages) {
      const c = Math.cos(g.rotation), s = Math.sin(g.rotation), dx = x - g.x, dz = z - g.z;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) <= 9 && lz >= -23 && lz <= 7) return 'asphalt';
    }
    const cx = Math.round(x / CHUNK), cz = Math.round(z / CHUNK);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (soilPatches.get((cx + dx) + ':' + (cz + dz))?.some(p => containsPolygon(p, x, z))) return 'dirt';
    return biomeAt(x, z) === 'desert' ? 'sand' : 'grass';
  }
  function ensureGarages(x: number, z: number): void {
    if (!garages.some(g => g.id === 'origin')) {
      const x = Math.max(18, curve(0, 0, 30).value + 15);
      const exit = roadAt(x, 0);
      garages.push({ x, z: 22, id: 'origin', rotation: 0, exitX: exit.x + Math.cos(exit.angle) * 2.7, exitZ: exit.z - Math.sin(exit.angle) * 2.7, exitAngle: exit.angle });
    }
    for (const kind of [0, 1] as const) {
      const index = Math.round((kind === 0 ? x : z) / (kind === 0 ? NS_GAP : EW_GAP));
      const t = kind === 0 ? z : x;
      for (let k = Math.floor(t / 780) - 2; k <= Math.floor(t / 780) + 2; k++) {
        const id = kind + ':' + index + ':' + k;
        if (garages.some(g => g.id === id) || hash(index + kind * 77, k, seed + 831) > 0.4) continue;
        const road = artery(kind, index, k * 780 + 300 + hash(index, k, seed + 921) * 180);
        if (nearbyDistrict(road.x, road.z)) continue;
        const nx = Math.cos(road.angle), nz = -Math.sin(road.angle);
        garages.push({ x: road.x + nx * 22, z: road.z + nz * 22, id, rotation: road.angle + Math.PI / 2, exitX: road.x + nx * 2.7, exitZ: road.z + nz * 2.7, exitAngle: road.angle });
      }
    }
    if (garages.length > 160) garages.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z)).splice(120);
  }
  function color(hex: string): Color3 {
    let value = colors.get(hex);
    if (!value) { value = Color3.FromHexString(hex); colors.set(hex, value); }
    return value;
  }
  function box(list: Part[], x: number, y: number, z: number, w: number, h: number, d: number, hex: string, rotation = 0): Part {
    const part: Part = { primitive: unitBox, x, y, z, width: w, height: h, depth: d, color: color(hex), rotation: { x: 0, y: rotation, z: 0 } };
    list.push(part);
    return part;
  }
  function litBox(list: Part[], x: number, y: number, z: number, w: number, h: number, d: number, hex: string, rotation = 0): Part {
    const part = box(list,x,y,z,w,h,d,hex,rotation); part.emissive = true; return part;
  }
  function panel(list: Part[],x:number,y:number,z:number,w:number,h:number,hex:string,rotation=0,emissive=false):void {
    list.push({primitive:unitPanel,x,y,z,width:w,height:h,depth:1,color:color(hex),rotation:{x:0,y:rotation,z:0},emissive});
  }
  function crown(list: Part[], x:number,y:number,z:number,w:number,h:number,d:number,hex:string,rotation=0):void {
    list.push({primitive:unitCrown,x,y,z,width:w,height:h,depth:d,color:color(hex),rotation:{x:0,y:rotation,z:0}});
  }
  function planter(list:Part[],x:number,z:number,width=1.7,depth=1.4,rotation=0):void {
    box(list,x,.3,z,width,.5,depth,'#aa9774',rotation);
    box(list,x,.565,z,width-.2,.07,depth-.2,'#6b7650',rotation);
    for(let i=0;i<3;i++) {
      const p=localPoint({x,z,rotation},(i-1)*width*.24,0);
      crown(list,p.x,1.04+(i%2)*.15,p.z,width*.57,.98,depth*.86,i%2?'#8b9d52':'#738b42',i*.8+rotation);
    }
  }
  function forecourt(list:Part[],x:number,z:number,width:number,depth:number):void {
    // Paving meets the sidewalk inside the free block; it never spans a carriageway.
    const points=[{x:x-width/2,z:z-depth/2},{x:x+width/2,z:z-depth/2},{x:x+width/2,z:z+depth/2},{x:x-width/2,z:z+depth/2}];
    polygon(list,points,.089,'#c5bfa8');
    for(let u=-width/2+2.4;u<width/2;u+=2.4)polygon(list,[{x:x+u-.016,z:z-depth/2},{x:x+u+.016,z:z-depth/2},{x:x+u+.016,z:z+depth/2},{x:x+u-.016,z:z+depth/2}],.092,'#aaa99a');
    for(let v=-depth/2+2.4;v<depth/2;v+=2.4)polygon(list,[{x:x-width/2,z:z+v-.016},{x:x+width/2,z:z+v-.016},{x:x+width/2,z:z+v+.016},{x:x-width/2,z:z+v+.016}],.092,'#aaa99a');
  }
  const glyphs: Record<string,string[]> = {
    A:['010','101','111','101','101'], C:['111','100','100','100','111'],
    D:['110','101','101','101','110'], E:['111','100','110','100','111'],
    F:['111','100','110','100','100'], G:['111','100','101','101','111'],
    I:['111','010','010','010','111'], L:['100','100','100','100','111'],
    M:['101','111','111','101','101'], N:['101','111','111','111','101'],
    P:['110','101','110','100','100'], R:['110','101','110','101','101'],
    S:['111','100','111','001','111'], T:['111','010','010','010','010'],
    U:['101','101','101','101','111'], V:['101','101','101','101','010'],
    '2':['111','001','111','100','111'], '4':['101','101','111','001','001']
  };
  // Four vertices per lit pixel; labels share the same small emissive batch as windows.
  function lettering(list:Part[],text:string,x:number,y:number,z:number,unit:number,hex:string,rotation=0,emissive=false):void {
    const width=(text.length*4-1)*unit;
    for(let i=0;i<text.length;i++) {
      const glyph=glyphs[text[i]];
      if(!glyph)continue;
      for(let row=0;row<5;row++)for(let col=0;col<3;col++)if(glyph[row][col]==='1') {
        const p=localPoint({x,z,rotation},-width/2+(i*4+col+.5)*unit,0);
        panel(list,p.x,y+(2-row)*unit,p.z,unit*.86,unit*.86,hex,rotation,emissive);
      }
    }
  }
  function cylinder(list: Part[], x: number, y: number, z: number, diameter: number, height: number, hex: string, top = diameter, sides = 6): Part {
    let primitive = unitCylinders.get(sides);
    if (!primitive) {
      primitive = VertexData.CreateCylinder({ diameter: 1, height: 1, tessellation: sides });
      unitCylinders.set(sides, primitive);
    }
    const part: Part = { primitive, x, y, z, width: diameter, height, depth: diameter, color: color(hex), rotation: { x: 0, y: 0, z: 0 }, topRatio: top / diameter };
    list.push(part);
    return part;
  }
  function merge(list: Part[], name: string, singleBatch=false): Mesh {
    if(!singleBatch&&list.some(part=>part.emissive)){
      const mesh=merge(list.filter(part=>!part.emissive),name,true);
      const light=merge(list.filter(part=>part.emissive),name+'-lights',true);
      light.material=lightMaterial;light.receiveShadows=false;light.parent=mesh;light.metadata={emissiveBatch:true};
      return mesh;
    }
    let vertices = 0;
    let triangles = 0;
    for (const part of list) {
      vertices += part.primitive.positions!.length / 3;
      triangles += part.primitive.indices!.length;
    }
    const positions = new Float32Array(vertices * 3);
    const normals = new Float32Array(vertices * 3);
    const vertexColors = new Float32Array(vertices * 4);
    const indices = vertices > 65535 ? new Uint32Array(triangles) : new Uint16Array(triangles);
    let offset = 0;
    let indexOffset = 0;
    const arrows:ArrowRange[]=[];
    for (const part of list) {
      const source = part.primitive.positions!;
      const sourceNormals = part.primitive.normals!;
      const sourceIndices = part.primitive.indices!;
      const count = source.length / 3;
      const cx = Math.cos(part.rotation.x), sx = Math.sin(part.rotation.x);
      const cy = Math.cos(part.rotation.y), sy = Math.sin(part.rotation.y);
      const cz = Math.cos(part.rotation.z), sz = Math.sin(part.rotation.z);
      // Babylon yaw/pitch/roll is Y*X*Z; bake that matrix once per part.
      const m00 = cy * cz + sy * sx * sz, m01 = -cy * sz + sy * sx * cz, m02 = sy * cx;
      const m10 = cx * sz, m11 = cx * cz, m12 = -sx;
      const m20 = -sy * cz + cy * sx * sz, m21 = sy * sz + cy * sx * cz, m22 = cy * cx;
      for (let v = 0; v < count; v++) {
        const from = v * 3;
        const to = (offset + v) * 3;
        const taper = part.topRatio === undefined ? 1 : 1 + (part.topRatio - 1) * (source[from + 1] + 0.5);
        const px = source[from] * part.width * taper;
        const py = source[from + 1] * part.height;
        const pz = source[from + 2] * part.depth * taper;
        positions[to] = part.x + m00 * px + m01 * py + m02 * pz;
        positions[to + 1] = part.y + m10 * px + m11 * py + m12 * pz;
        positions[to + 2] = part.z + m20 * px + m21 * py + m22 * pz;
        const nx = sourceNormals[from] / part.width;
        let ny = sourceNormals[from + 1] / part.height;
        const nz = sourceNormals[from + 2] / part.depth;
        if (part.topRatio !== undefined && Math.abs(sourceNormals[from + 1]) < 0.5) ny = (1 - part.topRatio) / (2 * part.height);
        const length = Math.hypot(nx, ny, nz) || 1;
        normals[to] = (m00 * nx + m01 * ny + m02 * nz) / length;
        normals[to + 1] = (m10 * nx + m11 * ny + m12 * nz) / length;
        normals[to + 2] = (m20 * nx + m21 * ny + m22 * nz) / length;
        const colorOffset = (offset + v) * 4;
        vertexColors[colorOffset] = part.color.r;
        vertexColors[colorOffset + 1] = part.color.g;
        vertexColors[colorOffset + 2] = part.color.b;
        vertexColors[colorOffset + 3] = 1;
      }
      for (let i = 0; i < sourceIndices.length; i++) indices[indexOffset + i] = sourceIndices[i] + offset;
      if(part.arrow)arrows.push({start:offset,count,x:part.arrow.x,z:part.arrow.z,rightPositions:part.arrow.rightPositions});
      indexOffset += sourceIndices.length;
      offset += count;
    }
    const data = new VertexData();
    data.positions = positions;
    data.normals = normals;
    data.colors = vertexColors;
    data.indices = indices;
    const mesh = new Mesh(name, scene);
    data.applyToMesh(mesh);
    mesh.material = material;
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    mesh.freezeWorldMatrix();
    if(arrows.length)arrowRanges.set(mesh,arrows);
    return mesh;
  }
  function collision(list: WorldProp[], id: string, x: number, z: number, radius: number, visual?: Mesh, breakable = false, hp = 50, options: PropOptions = {}): WorldProp {
    const mesh = visual ?? new Mesh('collision-' + id, scene);
    if (!visual) {
      mesh.position.set(x, -20, z);
      mesh.setEnabled(false);
    } else {
      mesh.receiveShadows = true;
      shadow?.addShadowCaster(mesh);
    }
    const prop: WorldProp = { x, z, radius, mesh, breakable, hp, active: true };
    interactions.register(prop, id, options, !!visual);
    list.push(prop);
    return prop;
  }
  function tree(props: WorldProp[], id: string, x: number, z: number, r: () => number, autumn = false, scale = 1): void {
    const meshes: Part[] = [];
    const height = (5 + r() * 2.2) * scale;
    box(meshes, x, height * 0.27, z, .45, height * .54, .45, '#796c52');
    box(meshes,x,.14,z,1.65,.28,1.65,'#a59e80');box(meshes,x,.295,z,1.32,.035,1.32,'#728764');
    crown(meshes,x,height*.71,z,height*.72,height*.67,height*.68,autumn?'#b8ae5e':'#6b874a',r()*2);
    crown(meshes,x+.48,height*.88,z+.25,height*.45,height*.44,height*.48,autumn?'#c2b76c':'#8fa75c',r()*2);
    collision(props, id, x, z, 0.65, merge(meshes, 'tree'), true, 70, { kind: 'tree', height, mass: 260 });
  }
  function fence(props: WorldProp[], id: string, x: number, z: number, length: number, alongZ = false): void {
    const pieces: Part[] = [];
    const angle = alongZ ? Math.PI / 2 : 0;
    box(pieces, x, 0.85, z, length, 0.18, 0.17, '#bda88a', angle);
    box(pieces, x, 0.4, z, length, 0.15, 0.15, '#bda88a', angle);
    for (let i = -1; i <= 1; i++) box(pieces, x + (alongZ ? 0 : i * length * 0.45), 0.64, z + (alongZ ? i * length * 0.45 : 0), 0.19, 1.28, 0.19, '#8c7b60');
    collision(props, id, x, z, length * 0.38, merge(pieces, 'breakable-fence'), true, 25);
  }
  function building(_background: Part[], props: WorldProp[], id: string, x: number, z: number, w: number, d: number, h: number, color: string, r: () => number): void {
    // A building is one static object, rather than part of the ground batch.
    // Its lower window bays and canopies are independently damageable objects.
    const meshes: Part[] = [];
    const storefronts = new Map<number, Part[]>();
    box(meshes, x, h * 0.5, z, w, h, d, color);
    box(meshes, x, .35, z, w+.28, .6, d+.28, '#aea58f');
    box(meshes, x, h+.12, z, w+.6, .28, d+.6, '#ded6bd');
    box(meshes, x, h+.27, z, w-.8, .08, d-.8, '#95958b');
    for(const side of[-1,1]) {
      box(meshes,x+side*(w/2-.12),h+.43,z,.25,.4,d,'#e1d8bf');
      box(meshes,x,h+.43,z+side*(d/2-.12),w,.4,.25,'#e1d8bf');
      box(meshes,x+side*(w/2-.2),h/2,z-d/2-.055,.4,h,.12,'#e5dcc5');
      box(meshes,x+side*(w/2-.2),h/2,z+d/2+.055,.4,h,.12,'#e5dcc5');
    }
    const floors = Math.max(1, Math.floor((h-.25) / 2.7));
    const window=(px:number,pz:number,y:number,rotation:number,lit:boolean)=>{
      const site={x:px,z:pz,rotation};
      let parts = meshes;
      if (y < 3) {
        parts = storefronts.get(rotation) ?? []; storefronts.set(rotation, parts);
        // A dark recess survives broken glass instead of exposing a blank wall.
        const recess = localPoint(site, 0, .008);
        panel(meshes,recess.x,y,recess.z,1.56,1.36,'#273c38',rotation);
      }
      panel(parts,px,y,pz,1.92,1.65,'#eee0bf',rotation);
      const glass=localPoint(site,0,-.018);
      panel(parts,glass.x,y,glass.z,1.5,1.3,lit?'#ffd590':'#526b6b',rotation,lit);
      const mullion=localPoint(site,0,-.034);
      panel(parts,mullion.x,y,mullion.z,.075,1.3,'#c7ae86',rotation);
      const sill=localPoint(site,0,-.09);
      box(parts,sill.x,y-.85,sill.z,2.02,.12,.28,'#e8ddc2',rotation);
    };
    for (let floor = 0; floor < floors; floor++) {
      const y = 1.7 + floor * 2.7;
      for (let xx = -w/2+2; xx < w/2-1; xx += 3.8) {
        window(x+xx,z-d/2-.025,y,0,r()>.13);
        window(x+xx,z+d/2+.025,y,Math.PI,r()>.22);
      }
      for (let zz = -d/2+2; zz < d/2-1; zz += 3.8) {
        window(x-w/2-.025,z+zz,y,Math.PI/2,r()>.22);
        window(x+w/2+.025,z+zz,y,-Math.PI/2,r()>.13);
      }
      if(floor>0)for(const side of[-1,1]) {
        box(meshes,x,y-1.08,z+side*(d/2+.06),w+.25,.15,.16,'#dfd3b7');
        box(meshes,x+side*(w/2+.06),y-1.08,z,.16,.15,d+.25,'#dfd3b7');
      }
    }
    for(const offset of[-1,1]) {
      const vx=x+offset*w*.24,vz=z+d*.16;
      box(meshes,vx,h+1.02,vz,3.5,1.45,2.9,'#a6aaa0');
      box(meshes,vx,h+1.78,vz,3.7,.13,3.08,'#c2c1ae');
      cylinder(meshes,vx,h+1.88,vz,1.82,.1,'#526b65',1.82,8);
      for(let l=0;l<5;l++)box(meshes,vx,h+.59+l*.19,vz-1.465,2.7,.08,.04,'#5d756d');
      box(meshes,vx,h+.61,z-.4,1.1,.64,Math.max(1.2,d*.2),'#b2b3a3');
      cylinder(meshes,x+offset*w*.32,h+1.1,z-d*.28,.9,1.7,'#9d9e8d',.9,6);
      cylinder(meshes,x+offset*w*.32,h+2.02,z-d*.28,1.3,.15,'#d2c7ad',1.3,6);
    }
    box(meshes,x,h+.72,z-1.4,w*.5,.64,1.1,'#a8ad9f');
    const awningColor=r()>.5?'#a85843':'#3c7060';
    const awning=(px:number,pz:number,width:number,rotation:number,label:string)=>{
      const canopy: Part[] = [];
      const site={x:px,z:pz,rotation};
      const at=(u:number,v:number)=>localPoint(site,u,v);
      for(let a=-width/2;a<width/2-.01;a+=.7) {
        const stripe=Math.min(.7,width/2-a),shade=Math.round((a+width/2)/.7)%2===0?awningColor:'#ede4c7';
        const p=at(a+stripe/2,-.76);
        box(canopy,p.x,2.84,p.z,stripe,.09,1.62,shade,rotation).rotation.x=-.16;
        const edge=at(a+stripe/2,-1.57);
        box(canopy,edge.x,2.59,edge.z,stripe,.3,.075,shade,rotation);
      }
      const sign=at(0,-.12);
      box(canopy,sign.x,3.36,sign.z,Math.min(width,8.2),.75,.16,'#425e53',rotation);
      const face=at(0,-.215);
      lettering(canopy,label,face.x,3.37,face.z,.112,'#ffe1a6',rotation,true);
      const center=at(0,-.7);
      collision(props,id+'-awning-'+rotation,center.x,center.z,width*.5,merge(canopy,'shop-awning'),true,75,{kind:'awning',interaction:'facade',height:3.8,mass:120,width,depth:1.8,angle:rotation,group:id});
    };
    awning(x,z-d/2-.06,w*.78,0,r()>.5?'MARKET':'CAFE');
    if(r()>.4)awning(x+w/2+.06,z,d*.66,-Math.PI/2,'24');
    box(meshes,x,1.15,z-d/2-.075,1.65,2.3,.1,'#34584f');
    panel(meshes,x,1.42,z-d/2-.135,1.25,1.42,'#edc989',0,true);
    box(meshes,x+.56,1.04,z-d/2-.17,.1,.3,.04,'#dfc889');
    box(meshes,x,2.41,z-d/2-.16,2.05,.18,.3,'#e5d9b9');
    box(meshes,x-.93,1.14,z-d/2-.13,.18,2.4,.21,'#e5d9b9');
    box(meshes,x+.93,1.14,z-d/2-.13,.18,2.4,.21,'#e5d9b9');
    for(const side of[-1,1]) {
      planter(meshes,x+side*(w/2+.85),z-d/2-1.05,1.6,1.3);
      const sx=x+side*(w*.31),sz=z-d/2-.4;
      box(meshes,sx,3.5,sz,.28,.14,.56,'#506657');
      litBox(meshes,sx,3.38,sz-.14,.24,.18,.25,'#ffe1a2');
    }
    for(const [rotation,parts] of storefronts) {
      const sideZ=Math.abs(Math.sin(rotation))<.5;
      const sx=x-Math.sin(rotation)*(w/2+.05),sz=z-Math.cos(rotation)*(d/2+.05);
      collision(props,id+'-glass-'+rotation,sx,sz,(sideZ?w:d)*.5,merge(parts,'shop-window-bays'),true,65,{kind:'storefront',interaction:'facade',height:2.6,mass:35,width:sideZ?w:d,depth:.3,angle:rotation,group:id});
    }
    collision(props, id, x, z, Math.max(w, d) / 1.6,merge(meshes,'city-building'),false,1200,{kind:'building',interaction:'solid',height:h+2.2,mass:50000,width:w,depth:d,group:id});
  }
  function garage(meshes: Part[], props: WorldProp[], id: string, x: number, z: number): void {
    // The entire apron and bay remain driveable; side pillars and rear wall collide.
    box(meshes, x, 0.04, z - 8, 18, 0.12, 30, '#68746d');
    box(meshes, x, 0.13, z - 9, 8.2, 0.05, 9, '#9cae59');
    for (const side of [-1, 1]) {
      box(meshes, x + side * 6, 2.4, z + 2, 2.4, 4.8, 10, '#e1dac5');
      box(meshes, x + side * 6, 0.6, z + 2, 2.55, 1.2, 10.2, '#699287');
      collision(props, id + '-side-' + side, x + side * 6, z + 2, 1.3);
    }
    box(meshes, x, 2.4, z + 6.5, 14, 4.8, 1, '#c7c6b4');
    collision(props, id + '-back', x, z + 6.5, 3.7);
    box(meshes, x, 5.05, z + 1.8, 15.6, 0.6, 11.2, '#537268');
    box(meshes,x,5.45,z+1.8,16,.2,11.6,'#698b67');
    litBox(meshes,x,5.39,z-3.97,16,.13,.12,'#b7ee76');
    box(meshes,x,4.86,z-3.98,15.6,.9,.2,'#355b4d');
    lettering(meshes,'DUSTLINE',x+.4,4.87,z-4.09,.19,'#e0f5a0',0,true);
    box(meshes,x-4.4,4.87,z-4.105,.9,.16,.06,'#bfe98a');
    cylinder(meshes,x-4.82,4.87,z-4.13,.45,.06,'#bfe98a',.45,6).rotation.x=Math.PI/2;
    for(let sx=-6;sx<7;sx+=2)box(meshes,x+sx,5.57,z+1.8,.035,.02,11.2,'#507257');
    box(meshes,x-3.9,5.95,z+3.4,2.8,.8,2.3,'#89a18a');
    cylinder(meshes,x-3.9,6.39,z+3.4,1.5,.1,'#526e5a',1.5,8);
    box(meshes,x+3.5,5.91,z+2,1,.8,4.3,'#8ea28b');
    box(meshes,x+3.5,6.38,z+3.6,1.5,.18,1.5,'#bcc6a3');
    for(const side of[-1,1]) {
      // Bright workshop windows and recessed warm light under the canopy.
      panel(meshes,x+side*6,2.65,z-3.025,1.72,1.4,'#e4dcc0');
      panel(meshes,x+side*6,2.65,z-3.045,1.4,1.08,'#ffd99a',0,true);
      box(meshes,x+side*6,2.65,z-3.065,.06,1.1,.04,'#8fa58a');
      litBox(meshes,x+side*3.5,4.7,z+1.5,.35,.1,2.8,'#ffe0a2');
      box(meshes,x+side*7.25,.12,z-10,1.2,.2,1.2,'#d2cab0');
      cylinder(meshes,x+side*7.25,.55,z-10,.65,.75,'#da8554',.12,6);
      cylinder(meshes,x+side*7.25,.65,z-10,.39,.14,'#eee0b8',.32,6);
    }
    // Tools and consumables sit against bay walls, leaving the full central aisle open.
    box(meshes,x+3.35,.85,z+4.45,2.1,1.1,1.05,'#a17d55');
    box(meshes,x+3.35,1.45,z+4.45,2.35,.13,1.15,'#d0c0a0');
    box(meshes,x+3.25,2.45,z+5.9,2.7,1.4,.12,'#6c8176');
    for(let i=0;i<5;i++)box(meshes,x+2.2+i*.43,2.4+(i%2)*.23,z+5.81,.08,.56,.06,'#d4cdb1');
    for(let n=0;n<3;n++)cylinder(meshes,x-3.6,.3+n*.45,z+4.8,1.4,.43,'#384c45',1.4,8);
    box(meshes,x-3.55,1.87,z+5.95,2.6,.15,1,'#b6aa8a');
    box(meshes,x-3.95,2.22,z+5.8,.7,.55,.6,'#9b8060');
    box(meshes,x-3.05,2.18,z+5.8,.65,.48,.6,'#bca484');
    cylinder(meshes,x+6.15,1,z-5.1,.65,2,'#c27b55',.65,6);
    panel(meshes,x+6.15,1.25,z-5.44,.44,.55,'#eee3bf');
    for(const side of[-1,1]) {
      planter(meshes,x+side*9.85,z+2,1.8,5.2);
      box(meshes,x+side*5.95,.62,z-7.1,1.35,1.15,1.1,'#597b62');
      box(meshes,x+side*5.95,1.24,z-7.1,1.5,.13,1.2,'#344f41');
      box(meshes,x+side*5.95,.77,z-7.67,.7,.08,.04,'#d5c8a0');
    }
    box(meshes,x+8.5,.15,z-14.1,2.6,.25,1.1,'#9d9275');
    box(meshes,x+8.5,2.1,z-14.1,2.5,3.6,.22,'#385a47');
    lettering(meshes,'24',x+8.5,3.3,z-14.23,.2,'#e2efaa',0,true);
    lettering(meshes,'FUEL',x+8.5,2.4,z-14.23,.13,'#d9dfb9');
    lettering(meshes,'REPAIR',x+8.5,1.45,z-14.23,.09,'#d9dfb9');
    for(const side of[-1,1])litBox(meshes,x+side*6,4.35,z-3.1,.8,.18,.22,'#ffe1a6');
    box(meshes, x - 4.8, 0.17, z - 7, 0.18, 0.04, 7, '#dce67c');
    box(meshes, x + 4.8, 0.17, z - 7, 0.18, 0.04, 7, '#dce67c');
    for (let i = 0; i < 3; i++) {
      box(meshes, x - 0.55, 0.18, z - 9 + i * 1.8, 1.3, 0.04, 0.22, '#e4eb9b', -0.65);
      box(meshes, x + 0.55, 0.18, z - 9 + i * 1.8, 1.3, 0.04, 0.22, '#e4eb9b', 0.65);
    }
  }

  function polygon(list: Part[], points: Point[], y: number, hex: string, heights?: number[]): void {
    if (points.length < 3) return;
    const data = new VertexData();
    const positions: number[] = [], indices: number[] = [];
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const p = points[i], q = points[(i + 1) % points.length];
      positions.push(p.x, heights?.[i] ?? y, p.z);
      area += p.x * q.z - q.x * p.z;
    }
    if (Math.abs(area) < 0.00001) return;
    for (let i = 1; i < points.length - 1; i++) indices.push(0, area > 0 ? i : i + 1, area > 0 ? i + 1 : i);
    const normals: number[] = new Array(positions.length).fill(0);
    if (heights) VertexData.ComputeNormals(positions, indices, normals);
    else for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    data.positions = positions; data.normals = normals; data.indices = indices;
    list.push({ primitive: data, x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1, color: color(hex), rotation: { x: 0, y: 0, z: 0 } });
  }
  function clip(points: Point[], x: number, z: number): Point[] {
    let result = points;
    for (const [axis, boundary, side] of [['x', x - HALF, 1], ['x', x + HALF, -1], ['z', z - HALF, 1], ['z', z + HALF, -1]] as const) {
      const output: Point[] = [];
      for (let i = 0; i < result.length; i++) {
        const a = result[i], b = result[(i + 1) % result.length];
        const ai = (a[axis] - boundary) * side >= -0.000001, bi = (b[axis] - boundary) * side >= -0.000001;
        if (ai) output.push(a);
        if (ai !== bi) {
          const t = (boundary - a[axis]) / (b[axis] - a[axis]);
          const p = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
          p[axis] = boundary;
          output.push(p);
        }
      }
      result = output;
      if (result.length < 3) break;
    }
    return result;
  }
  function strip(list: Part[], sample: (t: number) => RoadSample, from: number, to: number, width: number, y: number, hex: string, x: number, z: number, offset = 0, accept?: (p: Point) => boolean, step = 8): void {
    for (let t = from; t < to - 0.001; t += step) {
      const a = sample(t), b = sample(Math.min(to, t + step));
      const an = { x: Math.cos(a.angle), z: -Math.sin(a.angle) }, bn = { x: Math.cos(b.angle), z: -Math.sin(b.angle) };
      const points = [
        { x: a.x + an.x * (offset - width / 2), z: a.z + an.z * (offset - width / 2) },
        { x: a.x + an.x * (offset + width / 2), z: a.z + an.z * (offset + width / 2) },
        { x: b.x + bn.x * (offset + width / 2), z: b.z + bn.z * (offset + width / 2) },
        { x: b.x + bn.x * (offset - width / 2), z: b.z + bn.z * (offset - width / 2) }
      ];
      if (accept && points.some(p => !accept(p))) continue;
      polygon(list, clip(points, x, z), y, hex);
    }
  }
  function roadRoutes(x: number, z: number): RoadRoute[] {
    const routes: RoadRoute[] = [];
    for (const kind of [0, 1] as const) {
      const index = Math.round((kind === 0 ? x : z) / (kind === 0 ? NS_GAP : EW_GAP));
      const middle = kind === 0 ? z : x;
      routes.push({ id: kind + ':' + index, width: ROAD, dirt: false, from: Math.floor((middle - HALF - 16) / 8) * 8, to: Math.ceil((middle + HALF + 16) / 8) * 8,
        sample: t => artery(kind, index, t), distance: (px,pz) => {const c=curve(kind,index,kind===0?pz:px);return Math.abs(c.value-(kind===0?px:pz))/Math.sqrt(1+c.slope*c.slope);} });
    }
    const d = nearbyDistrict(x, z);
    if (d) for (const offset of LOCAL) for (const vertical of [true, false]) {
      const a = { x: d.x + (vertical ? offset : -104), z: d.z + (vertical ? -104 : offset) };
      const b = { x: d.x + (vertical ? offset : 104), z: d.z + (vertical ? 104 : offset) };
      const middle = vertical ? z-d.z : x-d.x;
      routes.push({ id: 'local-' + d.id + '-' + vertical + '-' + offset, width: 9, dirt: false, from: Math.max(-104,Math.floor((middle-HALF-12)/8)*8), to: Math.min(104,Math.ceil((middle+HALF+12)/8)*8),
        sample: t => ({x:d.x+(vertical?offset:t),z:d.z+(vertical?t:offset),angle:vertical?0:Math.PI/2,width:9,distance:0}), distance:(px,pz)=>segmentRoad(a,b,px,pz,9).distance });
    }
    const ni = Math.round(x / NS_GAP);
    for (let k = Math.floor(z / 650) - 1; k <= Math.floor(z / 650) + 1; k++) {
      const a = access(ni, k);
      if (!a) continue;
      for (let i=1;i<a.points.length;i++) {
        const p=a.points[i-1],q=a.points[i],length=Math.hypot(q.x-p.x,q.z-p.z),angle=Math.atan2(q.x-p.x,q.z-p.z);
        routes.push({id:'access-'+a.id+'-'+i,width:4.5,dirt:true,from:0,to:length,sample:t=>({x:p.x+(q.x-p.x)*t/length,z:p.z+(q.z-p.z)*t/length,angle,width:4.5,distance:0}),distance:(px,pz)=>segmentRoad(p,q,px,pz,4.5).distance});
      }
    }
    return routes;
  }
  function roads(meshes: Part[], props: WorldProp[], x: number, z: number): void {
    const routes=roadRoutes(x,z),d=nearbyDistrict(x,z),lots=d?parkingLots(d):[];
    const entranceClear=(p:Point)=>!lots.some(lot=>segmentRoad(lot.entrance,lot.street,p.x,p.z,5.6).distance<3.2);
    for(const route of routes) {
      const samples=[route.sample(route.from),route.sample((route.from+route.to)/2),route.sample(route.to)],padding=route.width/2+8;
      if(Math.min(...samples.map(p=>p.x))>x+HALF+padding||Math.max(...samples.map(p=>p.x))<x-HALF-padding||Math.min(...samples.map(p=>p.z))>z+HALF+padding||Math.max(...samples.map(p=>p.z))<z-HALF-padding)continue;
      const otherClear=(p:Point,margin:number)=>routes.every(other=>other.id===route.id||other.distance(p.x,p.z)>other.width/2+margin);
      // All carriageways share one height. Decorations are cut against every other road.
      strip(meshes,route.sample,route.from,route.to,route.width,route.dirt?.045:.065,route.dirt?'#b5a17b':'#626c68',x,z);
      if(route.dirt)continue;
      for(const side of[-1,1]) {
        const walkWidth=d?2.4:1.5,walkHeight=d?.105:.02,walkOffset=side*(route.width/2+walkWidth/2);
        strip(meshes,route.sample,route.from,route.to,walkWidth,walkHeight,d?'#c8c5b1':'#b8b29a',x,z,walkOffset,p=>otherClear(p,.12)&&entranceClear(p),2);
        if(d) {
          const tileClear=(p:Point)=>biomeAt(p.x,p.z)==='city'&&otherClear(p,.18)&&entranceClear(p);
          strip(meshes,route.sample,route.from,route.to,.035,.108,'#aaa99a',x,z,walkOffset,tileClear,2);
          for(let t=Math.ceil(route.from/2.4)*2.4;t<route.to;t+=2.4) {
            const p=route.sample(t),c=Math.cos(p.angle),s=Math.sin(p.angle);
            const points=[[-walkWidth/2,-.018],[walkWidth/2,-.018],[walkWidth/2,.018],[-walkWidth/2,.018]].map(([u,v])=>({x:p.x+c*(walkOffset+u)+s*v,z:p.z-s*(walkOffset+u)+c*v}));
            if(points.every(tileClear))polygon(meshes,clip(points,x,z),.108,'#aaa99a');
          }
        }
        strip(meshes,route.sample,route.from,route.to,.18,.115,'#d1d0bd',x,z,side*(route.width/2+.1),p=>biomeAt(p.x,p.z)==='city'&&otherClear(p,.25)&&entranceClear(p),2);
        if(route.width===ROAD)strip(meshes,route.sample,route.from,route.to,.13,.073,'#d3d3bb',x,z,side*(route.width/2-.6),p=>otherClear(p,.25)&&entranceClear(p),2);
      }
      for(let t=Math.ceil(route.from/14)*14;t<route.to-5;t+=14)strip(meshes,route.sample,t,t+5,.17,.075,'#d8cf9c',x,z,0,p=>otherClear(p,6),2);
      if(d)for(let t=Math.ceil((route.from-16)/32)*32+16;t<route.to;t+=32)for(const direction of[-1,1]) {
        const road=route.sample(t),angle=road.angle+(direction<0?Math.PI:0),c=Math.cos(angle),s=Math.sin(angle);
        const center={x:road.x+Math.cos(road.angle)*direction*route.width*.225,z:road.z-Math.sin(road.angle)*direction*route.width*.225};
        // Complete arrows belong to one tile by their center, so live 180-degree flips
        // never rotate a clipped fragment across a neighboring chunk's seam.
        if(!owned(center.x,center.z,Math.round(x/CHUNK),Math.round(z/CHUNK)))continue;
        const rightPoints=[[0,2],[-.85,.5],[-.28,.5],[-.28,-1.5],[.28,-1.5],[.28,.5],[.85,.5]].map(([u,v])=>({x:center.x+c*u+s*v,z:center.z-s*u+c*v}));
        const leftPoints=rightPoints.map(p=>({x:center.x*2-p.x,z:center.z*2-p.z}));
        if([...rightPoints,...leftPoints].every(p=>biomeAt(p.x,p.z)==='city'&&otherClear(p,6))) {
          const before=meshes.length;
          polygon(meshes,trafficMarkingSide==='left'?leftPoints:rightPoints,.077,'#d8d8c5');
          if(meshes.length>before)meshes[meshes.length-1].arrow={x:center.x,z:center.z,rightPositions:new Float32Array(rightPoints.flatMap(p=>[p.x,.077,p.z]))};
        }
      }
    }
    if(d)for(let ix=0;ix<STREETS.length;ix++)for(let iz=0;iz<STREETS.length;iz++) {
      const px=d.x+STREETS[ix],pz=d.z+STREETS[iz];
      if(Math.abs(px-x)>HALF+12||Math.abs(pz-z)>HALF+12)continue;
      const verticalWidth=ix===2?ROAD:9,horizontalWidth=iz===2?ROAD:9;
      const arms=[{vertical:true,side:-1,exists:iz>0||ix===2},{vertical:true,side:1,exists:iz<4||ix===2},{vertical:false,side:-1,exists:ix>0||iz===2},{vertical:false,side:1,exists:ix<4||iz===2}];
      for(const arm of arms) {
        if(!arm.exists)continue;
        const width=arm.vertical?verticalWidth:horizontalWidth,approach=(arm.vertical?horizontalWidth:verticalWidth)/2+3;
        for(let stripe=-width/2+1;stripe<width/2-.5;stripe+=1.4) {
          const p=arm.vertical?{x:px+stripe,z:pz+arm.side*approach}:{x:px+arm.side*approach,z:pz+stripe};
          const w=arm.vertical?.75:2.2,depth=arm.vertical?2.2:.75;
          polygon(meshes,clip([{x:p.x-w/2,z:p.z-depth/2},{x:p.x+w/2,z:p.z-depth/2},{x:p.x+w/2,z:p.z+depth/2},{x:p.x-w/2,z:p.z+depth/2}],x,z),.079,'#dddcc5');
        }
      }
      if(ix>0&&ix<4&&iz>0&&iz<4)for(const [sideX,sideZ] of[[-1,-1],[1,1],[-1,1],[1,-1]]) {
        const sx=px+sideX*(verticalWidth/2+1.9),sz=pz+sideZ*(horizontalWidth/2+1.9);
        if(!owned(sx,sz,Math.round(x/CHUNK),Math.round(z/CHUNK))||!clearSpace(sx,sz,.18))continue;
        const lights: Part[]=[];
        cylinder(lights,sx,.24,sz,.6,.43,'#a79f86',.5,6);
        cylinder(lights,sx,2.4,sz,.2,4.55,'#3f594b',.15,6);
        const rotation=sideX===sideZ?(sideX>0?Math.PI:0):(sideX>0?-Math.PI/2:Math.PI/2),front=localPoint({x:sx,z:sz,rotation},0,-.22);
        box(lights,sx,4.05,sz,.63,1.45,.38,'#293e33',rotation);
        const green=hash(ix,iz,seed+8)>.5;
        for(let light=0;light<3;light++)panel(lights,front.x,4.49-light*.42,front.z,.3,.3,light===2?(green?'#bde985':'#526552'):light===0?(!green?'#ef9273':'#68574a'):'#8e8059',rotation,(light===2&&green)||(light===0&&!green));
        collision(props,`signal-${d.id}-${ix}-${iz}-${sideX}-${sideZ}`,sx,sz,.4,merge(lights,'traffic-light'),true,65,{kind:'traffic-light',height:4.8,mass:130});
        // Short bollards guard sidewalk corners while leaving zebra approaches open.
        const bx=sx-sideX*.85,bz=sz+sideZ*1.2;
        if(clearSpace(bx,bz,.08)) {
          const bollard:Part[]=[];
          cylinder(bollard,bx,.65,bz,.23,1.2,'#405e49',.23,6);
          cylinder(bollard,bx,1.12,bz,.25,.16,'#dfd7ae',.25,6);
          collision(props,`bollard-${d.id}-${ix}-${iz}-${sideX}-${sideZ}`,bx,bz,.18,merge(bollard,'bollard'),true,35,{kind:'bollard',mass:50});
        }
      }
    }
    if(d)for(const route of routes.filter(r=>!r.dirt))for(let t=Math.ceil(route.from/32)*32;t<route.to;t+=32)for(const side of[-1,1]) {
      const road=route.sample(t),p={x:road.x+Math.cos(road.angle)*side*(route.width/2+2.1),z:road.z-Math.sin(road.angle)*side*(route.width/2+2.1)};
      if(!owned(p.x,p.z,Math.round(x/CHUNK),Math.round(z/CHUNK))||biomeAt(p.x,p.z)!=='city'||!clearSpace(p.x,p.z,.1))continue;
      const rotation=road.angle+(side<0?Math.PI:0),head=localPoint({x:p.x,z:p.z,rotation},-.6,0);
      const lamp:Part[]=[];
      cylinder(lamp,p.x,.15,p.z,.4,.3,'#aba68e',.32,6);
      cylinder(lamp,p.x,2.65,p.z,.15,5.3,'#56685b',.105,6);
      box(lamp,head.x,5.22,head.z,1.45,.11,.15,'#56685b',rotation);
      box(lamp,head.x,5.18,head.z,.78,.18,.43,'#63755e',rotation);
      litBox(lamp,head.x,5.075,head.z,.64,.045,.32,'#ffe1a2',rotation);
      collision(props,`lamp-${route.id}-${t}-${side}`,p.x,p.z,.3,merge(lamp,'street-lamp'),true,65,{kind:'lamp',height:5.4,mass:150});
    }
    // Stable roadside rhythm: posts, signs, low shrubs. Everything stays beyond the lanes.
    for(const route of routes.filter(r=>r.width===ROAD))for(let t=Math.ceil(route.from/42)*42;t<route.to;t+=42) {
      const road=route.sample(t),side=hash(Math.round(t),route.id.charCodeAt(0),seed)<.5?-1:1;
      const p={x:road.x+Math.cos(road.angle)*side*8.5,z:road.z-Math.sin(road.angle)*side*8.5};
      if(!owned(p.x,p.z,Math.round(x/CHUNK),Math.round(z/CHUNK))||!clearSpace(p.x,p.z,.25))continue;
      if(biomeAt(p.x,p.z)==='city')continue;
      const kind=hash(Math.round(t),route.id.charCodeAt(0),seed+19);
      const roadside:Part[]=[];
      if(kind<.45){cylinder(roadside,p.x,.6,p.z,.13,1.2,'#dddcc5',.13,5);box(roadside,p.x,.92,p.z,.15,.16,.15,'#ce795d');}
      else if(kind<.72){cylinder(roadside,p.x,1.3,p.z,.13,2.6,'#73857b',.13,5);box(roadside,p.x,2.35,p.z,1.6,.7,.12,'#8ca69a',road.angle);box(roadside,p.x,2.35,p.z-.08,1,.1,.04,'#e0dfbc',road.angle);}
      else for(let n=0;n<3;n++)cylinder(roadside,p.x+n*.55,.35,p.z+(n%2)*.7,1.3,.8,biomeAt(p.x,p.z)==='desert'?'#a4a477':'#7e9969',.7,5);
      collision(props,`roadside-${route.id}-${t}`,p.x,p.z,kind>.72?1:.3,merge(roadside,'roadside-prop'),true,kind>.72?20:35,{kind:kind>.72?'shrub':'sign',mass:25});
    }
  }
  function groundHeight(x: number, z: number): number { return -0.18 - (1 + Math.sin(x / 53) * Math.cos(z / 67)) * 0.16; }
  function ground(meshes: Part[], x: number, z: number): void {
    for (let dx = -36; dx < 36; dx += 18) for (let dz = -36; dz < 36; dz += 18) {
      const points = [{ x: x + dx, z: z + dz }, { x: x + dx + 18, z: z + dz }, { x: x + dx + 18, z: z + dz + 18 }, { x: x + dx, z: z + dz + 18 }];
      const biome = biomeAt(x + dx + 9, z + dz + 9);
      const variant = hash(Math.floor((x + dx) / 18), Math.floor((z + dz) / 18), seed + 18);
      const hex = biome === 'city' ? '#98ad86' : biome === 'desert' ? (variant < 0.5 ? '#d2b083' : '#cdb084') : (variant < 0.5 ? '#94a975' : '#91a572');
      polygon(meshes, points, -0.2, hex, points.map(p => groundHeight(p.x, p.z)));
    }
  }
  function owned(px: number, pz: number, cx: number, cz: number): boolean { return Math.round(px / CHUNK) === cx && Math.round(pz / CHUNK) === cz; }
  function clearSpace(x: number, z: number, radius: number): boolean {
    const road = roadAt(x, z);
    const d = nearbyDistrict(x, z);
    return road.distance > road.width / 2 + radius + 1.5 && !garages.some(g => Math.hypot(g.x - x, g.z - z) < radius + 21) && !(d && parkingLots(d).some(lot => parkingContains(lot, x, z, radius)));
  }
  function placeParking(meshes: Part[], lot: ParkingLot): void {
    polygon(meshes, [localPoint(lot,-12,-12),localPoint(lot,12,-12),localPoint(lot,12,12),localPoint(lot,-12,12)], .04, '#7d8780');
    const n = {x:Math.cos(lot.rotation)*2.8,z:-Math.sin(lot.rotation)*2.8};
    polygon(meshes,[{x:lot.entrance.x-n.x,z:lot.entrance.z-n.z},{x:lot.entrance.x+n.x,z:lot.entrance.z+n.z},{x:lot.street.x+n.x,z:lot.street.z+n.z},{x:lot.street.x-n.x,z:lot.street.z-n.z}],.041,'#7d8780');
    const localBox=(lx:number,lz:number,w:number,d:number,hex:string,y=.08,h=.16)=>{const p=localPoint(lot,lx,lz);box(meshes,p.x,y,p.z,w,h,d,hex,lot.rotation);};
    for(const side of[-1,1]){
      localBox(side*12,0,.2,24,'#c5c6b3');
      localBox(side*7.45,-12,9.1,.2,'#c5c6b3');
    }
    localBox(0,12,24,.2,'#c5c6b3');
    for(let row=-1;row<=1;row++)for(const side of[-1,1])for(const edge of[-1,1])localBox(side*7.3,row*6+edge*1.6,6.8,.12,'#d5d2b6',.056,.018);
    // The central aisle is empty; physical cars are supplied through parkedSpawnsNear.
    localBox(0,-7,.12,2,'#d5d2b6',.056,.018);
    for(const side of[-1,1]) {
      const p=localPoint(lot,side*13.3,10.7);
      planter(meshes,p.x,p.z,1.5,2.8,lot.rotation);
    }
    const sign=localPoint(lot,-5,-14.2),front=localPoint(lot,-5,-14.29);
    cylinder(meshes,sign.x,1.7,sign.z,.14,3.4,'#5e7561',.14,6);
    box(meshes,sign.x,3.04,sign.z,1.1,1.05,.13,'#46746b',lot.rotation);
    lettering(meshes,'P',front.x,3.04,front.z,.15,'#edf0d7',lot.rotation);
  }
  function furniture(props: WorldProp[], id: string, x: number, z: number, angle: number, kind: number): void {
    const size=1.35;
    if (!clearSpace(x,z,(kind<.25?1.2:.5)*size)) return;
    const pieces: Part[]=[];
    if(kind<.25){
      for(const row of[-1,0,1]){const p=localPoint({x,z,rotation:angle},0,row*.22);box(pieces,p.x,.62,p.z,2.6,.12,.18,'#b39c7c',angle);}
      for(const row of[0,1]){const p=localPoint({x,z,rotation:angle},0,.34);box(pieces,p.x,.9+row*.22,p.z,2.6,.16,.12,'#b39c7c',angle);}
      for(const side of[-1,1]){const p=localPoint({x,z,rotation:angle},side*.95,0);box(pieces,p.x,.29,p.z,.14,.58,.55,'#61796c',angle);box(pieces,p.x,.84,p.z,.12,.1,.65,'#61796c',angle);}
    }else if(kind<.5){
      box(pieces,x,.55,z,.78,1.1,.78,'#617e70',angle);box(pieces,x,1.13,z,.9,.14,.9,'#45675d',angle);
      const slot=localPoint({x,z,rotation:angle},0,-.4);panel(pieces,slot.x,.95,slot.z,.5,.15,'#2c4b40',angle);
      for(const side of[-1,1]){const p=localPoint({x,z,rotation:angle},side*.39,0);box(pieces,p.x,.59,p.z,.025,.65,.035,'#90a18b',angle);}
    }else if(kind<.75){
      cylinder(pieces,x,.45,z,.36,.9,'#b65b3f',.33,6);cylinder(pieces,x,.97,z,.4,.16,'#e1b384',.24,6);box(pieces,x,.59,z,.8,.18,.18,'#b65b3f',angle);
      for(const side of[-1,1]){const p=localPoint({x,z,rotation:angle},side*.44,0);box(pieces,p.x,.59,p.z,.1,.22,.24,'#dcc59a',angle);}
    }else{
      box(pieces,x,.12,z,1.45,.2,1.1,'#8d8066',angle);box(pieces,x-.18,.53,z,.8,.65,.8,'#bdab88',angle);box(pieces,x+.4,.4,z+.35,.55,.45,.6,'#a59375',angle);
    }
    for(const p of pieces){p.x=x+(p.x-x)*size;p.z=z+(p.z-z)*size;p.y*=size;p.width*=size;p.height*=size;p.depth*=size;}
    collision(props,id,x,z,(kind<.25?1.2:.5)*size,merge(pieces,'street-furniture'),true,kind<.25?55:35,{kind:kind<.25?'bench':kind<.5?'bin':kind<.75?'hydrant':'crates',interaction:kind>=.25&&kind<.5||kind>=.75?'movable':'breakable',mass:kind<.25?90:kind<.5?45:75});
  }
  function themedObject(props:WorldProp[],id:string,x:number,z:number,kind:'barrel'|'hay'|'crates'|'gate'|'barrier'|'kiosk'|'container',angle=0):void {
    const pieces:Part[]=[];
    let radius=.65,hp=90,mass=60,height=1.25,width=1.2,depth=1.2;
    let interaction:PropOptions['interaction']='movable';
    if(kind==='barrel') {
      cylinder(pieces,x,.66,z,.82,1.24,'#ab573b',.82,10);
      for(const y of[.16,.65,1.12])cylinder(pieces,x,y,z,.86,.08,'#463e32',.86,10);
      box(pieces,x,.69,z-.42,.38,.37,.025,'#e4be4e',angle);hp=40;mass=55;interaction='explosive';
    } else if(kind==='hay') {
      box(pieces,x,.62,z,1.65,1.15,1.25,'#bba15f',angle);
      for(const side of[-1,1])box(pieces,x+side*.48,.65,z,.06,1.22,1.29,'#7a6b40',angle);
      radius=.9;hp=120;mass=110;width=1.65;depth=1.25;
    } else if(kind==='crates') {
      for(const side of[-1,1])box(pieces,x+side*.42,.46,z,.78,.84,.9,'#9e7d51',angle);
      box(pieces,x,.99,z,.72,.35,.8,'#b2996d',angle);
      for(const side of[-1,1])box(pieces,x+side*.42,.46,z-.46,.66,.1,.05,'#594f36',angle);
      hp=75;mass=80;radius=.95;width=1.7;
    } else if(kind==='gate'||kind==='barrier') {
      const length=kind==='gate'?4.5:3.3;
      const site={x,z,rotation:angle};
      for(const side of[-1,1]) {const p=localPoint(site,side*(length/2-.1),0);box(pieces,p.x,.65,p.z,.17,1.3,.27,'#6c7665',angle);}
      box(pieces,x,.99,z,length,.38,.15,kind==='gate'?'#98aa8a':'#ce9657',angle);
      box(pieces,x,.43,z,length,.12,.13,'#75846d',angle);
      if(kind==='barrier')for(let i=-2;i<=2;i++){const p=localPoint(site,i*.55,-.09);box(pieces,p.x,1.0,p.z,.27,.32,.025,'#eee3b8',angle);}
      radius=length*.42;hp=kind==='gate'?85:55;mass=90;interaction='breakable';width=length;depth=.35;
    } else if(kind==='container') {
      box(pieces,x,1.18,z,4.8,2.35,2.3,'#627e74',angle);
      for(let i=-3;i<=3;i++) {const p=localPoint({x,z,rotation:angle},i*.58,-1.17);box(pieces,p.x,1.2,p.z,.07,2.17,.06,'#87988b',angle);}
      radius=2.3;hp=550;mass=1100;height=2.4;width=4.8;depth=2.3;
    } else {
      box(pieces,x,1.45,z,4.8,2.9,3.5,'#a88362',angle);
      box(pieces,x,3.03,z,5.25,.25,4,'#557e70',angle);
      const front=localPoint({x,z,rotation:angle},0,-1.79);
      box(pieces,front.x,1.55,front.z,3.2,1.25,.08,'#385d58',angle);
      box(pieces,front.x,2.48,front.z,3.45,.38,.12,'#e0bc72',angle);
      radius=2.4;hp=240;mass=1500;height=3.2;width=4.8;depth=3.5;interaction='breakable';
    }
    collision(props,id,x,z,radius,merge(pieces,'interactive-'+kind),true,hp,{kind:kind==='kiosk'?'small-building':kind,interaction,height,mass,width,depth,angle});
  }
  function placeGarage(meshes: Part[], props: WorldProp[], site: GarageSite, visuals:WorldProp[]): void {
    const local: Part[] = [], colliders: WorldProp[] = [];
    garage(local, colliders, 'garage-' + site.id, 0, 0);
    const c = Math.cos(site.rotation), s = Math.sin(site.rotation);
    for (const p of local) {
      const px = p.x, pz = p.z;
      p.x = site.x + c * px + s * pz; p.z = site.z - s * px + c * pz; p.rotation.y += site.rotation;
      if(p.y<.22&&p.height<.4)meshes.push(p);
    }
    const shell=local.filter(p=>!(p.y<.22&&p.height<.4));
    // The workshop's existing wall colliders keep its drive-through bay open.
    // Its roof and shell participate in occlusion without adding a solid box.
    collision(visuals,'garage-shell-'+site.id,site.x,site.z,11,merge(shell,'garage-shell'),false,6000,{kind:'garage',height:6.5,group:'garage-'+site.id});
    for (const p of colliders) {
      const px = p.x, pz = p.z;
      p.x = site.x + c * px + s * pz; p.z = site.z - s * px + c * pz;
      p.mesh.position.set(p.x, -20, p.z);
      props.push(p);
    }
    if (site.id !== 'origin') {
      // Rural service stops occasionally combine a repair bay and two fuel pumps.
      const gx = site.x + c * 12, gz = site.z - s * 12;
      box(meshes, gx, 3.9, gz, 8, 0.35, 6, '#d9c9a7', site.rotation);
      for (const sign of [-1, 1]) {
        const px = gx + c * sign * 2.7, pz = gz - s * sign * 2.7;
        const pump:Part[]=[];
        box(pump, px, 1, pz, 0.85, 2, 0.7, '#c38569', site.rotation);
        box(pump,px,1.35,pz-.37,.5,.35,.04,'#314d44',site.rotation);
        collision(props, 'pump-' + site.id + sign, px, pz, 0.5,merge(pump,'fuel-pump'),true,85,{kind:'fuel-pump',interaction:'explosive',height:2,mass:250});
        cylinder(meshes, px, 2, pz + 1.5, 0.17, 4, '#d6ceb2', 0.17);
      }
    }
  }

  function createChunk(cx: number, cz: number): Chunk {
    const x = cx * CHUNK, z = cz * CHUNK;
    const biome = biomeAt(x, z);
    const r = random((hash(cx, cz, seed) * 2147483647) | 0);
    const id = cx + ':' + cz;
    const meshes: Part[] = [], props: WorldProp[] = [], visuals:WorldProp[]=[];
    soilPatches.set(id, []);
    ground(meshes, x, z);
    roads(meshes, props, x, z);
    for (const site of garages) if (owned(site.x, site.z, cx, cz)) placeGarage(meshes, props, site,visuals);
    const town = nearbyDistrict(x, z);
    if (town) {
      const palette = ['#d4c7ad', '#c7bca6', '#cdbba3', '#b8c5b8', '#c4b59b', '#c7bcae'];
      for (const ox of [-76, -24, 24, 76]) for (const oz of [-76, -24, 24, 76]) {
        const bx = town.x + ox, bz = town.z + oz;
        if (!owned(bx, bz, cx, cz) || garages.some(g => Math.hypot(g.x - bx, g.z - bz) < 27)) continue;
        const lotId = town.id + '-lot-' + ox + ':' + oz;
        const lr = random((hash(ox + Math.round(town.x), oz + Math.round(town.z), seed + 312) * 2147483647) | 0);
        const kind = lr();
        const parkingLot = parkingLots(town).find(lot => lot.x === bx && lot.z === bz);
        if (parkingLot) {
          placeParking(meshes, parkingLot);
        } else if (kind < 0.2) {
          // Pocket parks: open escape routes and coherent little groves.
          box(meshes, bx, -0.005, bz, 25, 0.08, 26, '#7f9b78');
          box(meshes, bx, 0.04, bz, 2.2, 0.08, 26, '#c5bd9e');
          for (let i = 0; i < 5; i++) {
            const px = bx + (i % 2 ? -1 : 1) * (5 + lr() * 4), pz = bz - 9 + i * 4.5;
            if (clearSpace(px, pz, 2)) tree(props, lotId + '-tree-' + i, px, pz, lr);
          }
          furniture(props,lotId+'-park-bench',bx+4,bz,0,.1);
          if(clearSpace(bx,bz+7,3))themedObject(props,lotId+'-kiosk',bx,bz+7,'kiosk');
          if(clearSpace(bx-9,bz-10,2))themedObject(props,lotId+'-barrier',bx-9,bz-10,'barrier',Math.PI/2);
        } else if (kind > 0.79 && Math.abs(ox) > 40) {
          if (clearSpace(bx, bz, 14)) {
            forecourt(meshes,bx,bz,Math.abs(ox)>40?45:35,Math.abs(oz)>40?45:35);
            building(meshes, props, lotId, bx, bz, 23, 20, 5.2, '#b4b8a9', lr);
            if(clearSpace(bx+16,bz+5,3))themedObject(props,lotId+'-container',bx+16,bz+5,'container',Math.PI/2);
            for(const side of[-1,1])if(clearSpace(bx+side*7,bz-13,1.2))themedObject(props,lotId+'-barrel-'+side,bx+side*7,bz-13,'barrel');
            if(clearSpace(bx-15,bz+6,1.5))themedObject(props,lotId+'-crates',bx-15,bz+6,'crates');
          }
        } else {
          const w = 21 + lr() * 6, d = 21 + lr() * 6;
          if (clearSpace(bx, bz, Math.max(w, d) * 0.6)) {
            const h = Math.abs(ox) < 40 && Math.abs(oz) < 40 ? 9 + lr() * 6 : 5.8 + lr() * 4.5;
            forecourt(meshes,bx,bz,Math.abs(ox)>40?45:35,Math.abs(oz)>40?45:35);
            building(meshes, props, lotId, bx, bz, w, d, h, palette[Math.floor(lr() * palette.length)], lr);
            // Trees are planted along sidewalks below, rather than inside denser footprints.
          }
        }
        const nearest = roadAt(bx, bz);
        const side = (bx-nearest.x)*Math.cos(nearest.angle)-(bz-nearest.z)*Math.sin(nearest.angle)>=0?1:-1;
        const lx = nearest.x + Math.cos(nearest.angle) * side * (nearest.width / 2 + 3.15), lz = nearest.z - Math.sin(nearest.angle) * side * (nearest.width / 2 + 3.15);
        furniture(props, lotId + '-furniture', lx, lz, nearest.angle+Math.PI/2, lr());
      }
      for(const route of roadRoutes(x,z).filter(route=>!route.dirt))for(let t=Math.ceil((route.from-16)/40)*40+16;t<route.to;t+=40) {
        const road=route.sample(t),side=hash(Math.round(t),route.id.charCodeAt(0),seed+109)<.5?-1:1;
        const tx=road.x+Math.cos(road.angle)*side*(road.width/2+2.1),tz=road.z-Math.sin(road.angle)*side*(road.width/2+2.1);
        if(owned(tx,tz,cx,cz)&&biomeAt(tx,tz)==='city'&&clearSpace(tx,tz,.35)) {
          const tr=random((hash(Math.round(tx),Math.round(tz),seed+72)*2147483647)|0);
          tree(props,'city-planter-'+route.id+'-'+t,tx,tz,tr,tr()>.8,.84);
        }
      }
      for(const route of roadRoutes(x,z).filter(route=>!route.dirt))for(let t=Math.ceil(route.from/32)*32;t<route.to;t+=32) {
        const road=route.sample(t),side=hash(Math.round(t),route.id.charCodeAt(0),seed+310)<.5?-1:1;
        const fx=road.x+Math.cos(road.angle)*side*(road.width/2+3.15),fz=road.z-Math.sin(road.angle)*side*(road.width/2+3.15);
        if(owned(fx,fz,cx,cz)&&biomeAt(fx,fz)==='city') {
          const kind=hash(Math.round(fx),Math.round(fz),seed+311);
          furniture(props,'city-furniture-'+route.id+'-'+t,fx,fz,road.angle+Math.PI/2,kind*.74);
        }
        const px=road.x+Math.cos(road.angle)*side*(road.width/2+1.85),pz=road.z-Math.sin(road.angle)*side*(road.width/2+1.85);
        if(owned(px,pz,cx,cz)&&biomeAt(px,pz)==='city'&&clearSpace(px,pz,.18)) {
          cylinder(meshes,px,.65,pz,.25,1.2,'#455e4b',.21,6);
          cylinder(meshes,px,1.13,pz,.26,.15,'#d8ceaa',.26,6);
        }
      }
    } else if (biome === 'fields') {
      const px = x + (r() - 0.5) * 16, pz = z + (r() - 0.5) * 16;
      if (r() < 0.62 && clearSpace(px, pz, 24)) {
        const angle = Math.floor(r() * 6) * Math.PI / 6;
        const c = Math.cos(angle), s = Math.sin(angle);
        const w = 21 + r() * 15, d = 26 + r() * 18;
        const points: Point[] = [];
        for (const [u,v] of [[-0.5,-0.35],[-0.35,-0.5],[0.45,-0.5],[0.5,0.3],[0.3,0.5],[-0.5,0.45]]) points.push({x:px+c*u*w+s*v*d,z:pz-s*u*w+c*v*d});
        polygon(meshes, points, -0.025, r() < 0.5 ? '#a39b68' : '#a7ad74');
        soilPatches.get(id)!.push(points);
        for (let row = -w / 2 + 3; row < w / 2 - 2; row += 2.5) {
          const rx=px+c*row,rz=pz-s*row;
          if(clearSpace(rx,rz,Math.hypot(.7,d*.76)/2))box(meshes, rx, 0.1, rz, 0.7, 0.22, d * 0.76, row % 5 < 2.5 ? '#7d9559' : '#899d61', angle);
        }
        if (r() < 0.3 && clearSpace(px,pz-d*.55,6)) fence(props, id + '-field-fence', px, pz - d * 0.55, 11);
        for(const side of[-1,1])if(clearSpace(px+side*w*.3,pz+d*.5,1.2))themedObject(props,id+'-field-hay-'+side,px+side*w*.3,pz+d*.5,'hay',angle);
      }
      if (r() < 0.4) {
        const gx = x + (r() - 0.5) * 28, gz = z + (r() - 0.5) * 28;
        for (let i = 0; i < 6; i++) {
          const a = i * 2.4, radius = 5 + r() * 8;
          const tx = gx + Math.sin(a) * radius, tz = gz + Math.cos(a) * radius;
          if (clearSpace(tx, tz, 2)) tree(props, id + '-grove-' + i, tx, tz, r, r() < 0.15);
        }
      }
      if (r() < 0.12 && clearSpace(x - 18, z + 17, 9)) {
        const wx = x - 18, wz = z + 17;
        const tower:Part[]=[], blades:Part[]=[];
        cylinder(tower, wx, 4.5, wz, 1.3, 9, '#d1cfb7', 0.65, 8);
        box(tower,wx,9,wz-.45,.9,.65,1.9,'#c0c5b0');
        const hub=cylinder(blades,0,0,0,.65,.4,'#c0c5b0',.4,10); hub.rotation.x=Math.PI/2;
        for(let blade=0;blade<3;blade++) {
          const angle=blade*Math.PI*2/3;
          const part=box(blades,-Math.sin(angle)*1.72,Math.cos(angle)*1.72,0,.3,3.3,.14,'#e1dfc7'); part.rotation.z=angle;
          const tip=box(blades,-Math.sin(angle)*3.12,Math.cos(angle)*3.12,-.01,.22,.38,.17,'#b96d50'); tip.rotation.z=angle;
        }
        const prop=collision(props,id+'-windmill',wx,wz,.8,merge(tower,'wind-turbine'),true,450,{kind:'turbine',height:12.5,mass:1800});
        const rotor=new TransformNode('wind-turbine-rotor',scene);rotor.parent=prop.mesh;rotor.position.set(0,9,-1.5);
        const rotorMesh=merge(blades,'wind-turbine-blades');rotorMesh.unfreezeWorldMatrix();rotorMesh.parent=rotor;shadow?.addShadowCaster(rotorMesh);
        interactions.attachRotor(prop,rotor);
      }
    } else if (biome === 'desert') {
      const px = x + (r() - 0.5) * 26, pz = z + (r() - 0.5) * 26;
      if (r() < 0.23 && clearSpace(px, pz, 14)) {
        // Stepped mesas and their smaller broken shelves give the desert a silhouette.
        const rock:Part[]=[];
        cylinder(rock, px, 1.1, pz, 24, 2.2, '#bb926e', 20, 6).rotation.y = 0.2;
        cylinder(rock, px - 1.1, 3.4, pz + 0.8, 19, 2.7, '#c49b73', 14, 6).rotation.y = 0.2;
        cylinder(rock, px - 1.3, 4.9, pz + 1, 14, 0.4, '#d3b086', 13.5, 6).rotation.y = 0.2;
        collision(props, id + '-mesa', px, pz, 11,merge(rock,'mesa'),false,1800,{kind:'rock',height:5.2,mass:50000});
        for (let i = 0; i < 3; i++) {
          const rx=px+12+i*2,rz=pz-6+i*4;
          if(!clearSpace(rx,rz,2.5))continue;
          const shelf:Part[]=[];cylinder(shelf,rx,.7,rz,4,1.8,'#b88c66',2.5,5);
          collision(props,id+'-mesa-shelf-'+i,rx,rz,1.6,merge(shelf,'rock-shelf'),true,170,{kind:'rock-shelf',mass:1200});
        }
      }
      if (r() < 0.7) for (let i = 0; i < 3; i++) {
        const tx = px + (r() - 0.5) * 24, tz = pz + (r() - 0.5) * 24;
        if (!clearSpace(tx, tz, 2)) continue;
        const pieces: Part[] = [], h = 2.5 + r() * 1.6;
        cylinder(pieces, tx, h / 2, tz, 0.6, h, '#779776', 0.48, 5);
        box(pieces, tx + 0.7, h * 0.54, tz, 1.3, 0.38, 0.4, '#779776');
        cylinder(pieces, tx + 1.2, h * 0.7, tz, 0.4, h * 0.4, '#779776', 0.35, 5);
        collision(props, id + '-cactus-' + i, tx, tz, 0.65, merge(pieces, 'cactus'), true, 28);
      }
      if(r()<.13&&clearSpace(x-15,z-13,5)) {
        themedObject(props,id+'-desert-kiosk',x-15,z-13,'kiosk');
        themedObject(props,id+'-desert-barrel',x-11,z-11,'barrel');
        themedObject(props,id+'-desert-crates',x-19,z-10,'crates');
      }
    }
    // Farm access lanes finish at real barns, rather than at a chunk boundary.
    const ni = Math.round(x / NS_GAP);
    for (let k = Math.floor(z / 650) - 1; k <= Math.floor(z / 650) + 1; k++) {
      const a = access(ni, k);
      if (!a) continue;
      const end = a.points[2], before = a.points[1];
      const angle = Math.atan2(end.x - before.x, end.z - before.z);
      const bx = end.x + Math.cos(angle) * 12, bz = end.z - Math.sin(angle) * 12;
      if (!owned(bx, bz, cx, cz) || !clearSpace(bx, bz, 5)) continue;
      const barn:Part[]=[];
      box(barn, bx, 2.4, bz, 10, 4.8, 9, biomeAt(bx,bz)==='desert' ? '#c7a181' : '#ba8065');
      cylinder(barn, bx, 5.1, bz, 13, 2, '#d3b191', 1, 4).rotation.y = Math.PI / 4;
      box(barn, bx, 1.6, bz - 4.55, 3.5, 3.2, 0.14, '#d8d4b7');
      collision(props, 'farm-' + a.id, bx, bz, 5,merge(barn,'farm-barn'),true,400,{kind:'small-building',height:6.1,mass:3000,width:10,depth:9});
      for(const side of[-1,1])themedObject(props,'farm-'+a.id+'-hay-'+side,bx+side*7,bz+2,'hay');
      themedObject(props,'farm-'+a.id+'-gate',end.x,end.z,'gate',angle);
    }
    const mesh = merge(meshes, 'world-chunk-' + id);
    mesh.metadata = { worldChunk: true, biome, roadHierarchy: true, parkingLots: town ? parkingLots(town).filter(lot=>owned(lot.x,lot.z,cx,cz)).map(lot=>({id:lot.id,x:lot.x,z:lot.z,rotation:lot.rotation,width:lot.width,depth:lot.depth,entrance:lot.entrance,street:lot.street})) : [] };
    shadow?.addShadowCaster(mesh, false);
    return { x: cx, z: cz, mesh, props,visuals };
  }

  function dropChunk(chunk: Chunk): void {
    soilPatches.delete(chunk.x + ':' + chunk.z);
    shadow?.removeShadowCaster(chunk.mesh);
    chunk.mesh.dispose();
    for (const prop of [...chunk.props,...chunk.visuals]) {
      interactions.release(prop);
    }
  }
  function update(x: number, z: number, dt = 1 / 60): void {
    if (disposed) return;
    interactions.update(dt, x, z);
    ensureGarages(x, z);
    const cx = Math.round(x / CHUNK);
    const cz = Math.round(z / CHUNK);
    for (const [key, chunk] of chunks) {
      if (Math.abs(chunk.x - cx) > 3 || Math.abs(chunk.z - cz) > 3) {
        dropChunk(chunk);
        chunks.delete(key);
      }
    }
    const pending: { cx: number; cz: number; distance: number }[] = [];
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      const tx = cx + dx;
      const tz = cz + dz;
      if (!chunks.has(tx + ':' + tz)) pending.push({ cx: tx, cz: tz, distance: dx * dx + dz * dz });
    }
    pending.sort((a, b) => a.distance - b.distance);
    const buildStarted = performance.now();
    for (const next of pending.slice(0, 2)) {
      chunks.set(next.cx + ':' + next.cz, createChunk(next.cx, next.cz));
      if (performance.now() - buildStarted > 7) break;
    }
  }
  function propsNear(x: number, z: number, radius: number): WorldProp[] {
    const result: WorldProp[] = [];
    for (const chunk of chunks.values()) {
      if (Math.abs(chunk.x * CHUNK - x) > radius + HALF + 36 || Math.abs(chunk.z * CHUNK - z) > radius + HALF + 36) continue;
      for (const prop of chunk.props) if (prop.active && Math.hypot(prop.x - x, prop.z - z) < radius + prop.radius) result.push(prop);
    }
    return result;
  }
  function trafficSpawns(x: number, z: number, count: number, trafficSide: 'right'|'left' = 'right'): RoadSpawn[] {
    const r = random(seed + 9013 + trafficSerial++ * 907);
    const output: RoadSpawn[] = [];
    const anchor = roadAt(x, z);
    for (let attempts = 0; attempts < count * 24 && output.length < count; attempts++) {
      const along = (r() > 0.5 ? 1 : -1) * (29 + r() * 105);
      const lateral = r() > 0.7 ? (r() > 0.5 ? 48 : -48) : 0;
      const road = roadAt(anchor.x + Math.sin(anchor.angle) * along + Math.cos(anchor.angle) * lateral, anchor.z + Math.cos(anchor.angle) * along - Math.sin(anchor.angle) * lateral);
      if (road.width < 7) continue;
      const forward = r() > 0.5;
      const side = (forward ? 1 : -1) * (trafficSide==='right'?1:-1) * road.width * 0.225;
      const px = road.x + Math.cos(road.angle) * side, pz = road.z - Math.sin(road.angle) * side;
      if (Math.hypot(px - x, pz - z) < 27 || Math.hypot(px - x, pz - z) > 175) continue;
      if (output.some(p => Math.hypot(p.x - px, p.z - pz) < 9)) continue;
      output.push({ x: px, z: pz, angle: road.angle + (forward ? 0 : Math.PI) });
    }
    return output;
  }
  function setTrafficSide(side:'right'|'left'):void {
    if(disposed||side===trafficMarkingSide)return;
    trafficMarkingSide=side;
    for(const chunk of chunks.values()) {
      const arrows=arrowRanges.get(chunk.mesh);
      if(!arrows?.length)continue;
      const positions=chunk.mesh.getVerticesData(VertexBuffer.PositionKind);
      if(!positions)continue;
      for(const arrow of arrows)for(let i=0;i<arrow.count;i++) {
        const to=(arrow.start+i)*3,from=i*3;
        positions[to]=side==='left'?arrow.x*2-arrow.rightPositions[from]:arrow.rightPositions[from];
        positions[to+1]=arrow.rightPositions[from+1];
        positions[to+2]=side==='left'?arrow.z*2-arrow.rightPositions[from+2]:arrow.rightPositions[from+2];
      }
      // Replacing this static position buffer is a settings-only GPU upload. Indices,
      // normals, materials, glow meshes, props and physics references remain intact.
      chunk.mesh.setVerticesData(VertexBuffer.PositionKind,positions,false);
    }
  }
  // The first visible neighbourhood is ready before the intro is dismissed.
  ensureGarages(0, 0);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) chunks.set(cx + ':' + cz, createChunk(cx, cz));
  return {
    biomeAt,
    isRoad,
    roadAt,
    surfaceAt,
    parkedSpawnsNear,
    garages,
    update,
    propsNear,
    trafficSpawns,
    setTrafficSide,
    updateOcclusion: interactions.updateOcclusion,
    damageProp: interactions.damageProp,
    setExplosionHandler: interactions.setExplosionHandler,
    destroyProp: interactions.destroyProp,
    dispose() {
      disposed = true;
      for (const chunk of chunks.values()) dropChunk(chunk);
      chunks.clear();
      colors.clear();
      districts.clear();
      accesses.clear();
      phases.clear();
      parking.clear();
      soilPatches.clear();
      interactions.dispose();
      material.dispose();
      lightMaterial.dispose();
    }
  };
}
