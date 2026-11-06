import { Color3, Matrix, Mesh, MeshBuilder, Quaternion, Scene, StandardMaterial, TransformNode, Vector3, VertexData } from '@babylonjs/core';
import type { ShadowGenerator } from '@babylonjs/core';
import type { CarSpec, VehicleVisual } from './types';
import { conceptArch, conceptBox, conceptWheelRing } from './vehicle-concepts';
import { createMotorcycle } from './special-vehicles';

type Point = [number, number, number];
type Panel = { mesh: Mesh; position: Vector3; rotation: Vector3; scaling: Vector3 };
const compactMaterials = new WeakMap<Scene, StandardMaterial>();
function compactMaterial(scene: Scene): StandardMaterial {
  let mat = compactMaterials.get(scene);
  if (!mat) {
    mat = new StandardMaterial('shared-compact-vehicle-colors', scene);
    mat.diffuseColor = Color3.White(); mat.specularColor = Color3.Black();
    mat.backFaceCulling = false; compactMaterials.set(scene, mat);
  }
  return mat;
}

/** Static trim is batched; removable panels retain independent geometry and pivots. */
export function createVehicle(scene: Scene, spec: CarSpec, color: string, kind: 'player' | 'police' | 'traffic' = 'player'): VehicleVisual & { setTurretEnabled(enabled: boolean): void } {
  if (spec.visualVariant === 'motorcycle') return createMotorcycle(scene, spec);
  const root = new TransformNode(`vehicle-${kind}-${spec.id}`, scene);
  const chassis = new TransformNode('chassis', scene);
  chassis.parent = root;
  const turret = new TransformNode('turret', scene);
  turret.parent = chassis;
  const materials: StandardMaterial[] = [];
  const batches = new Map<StandardMaterial, Mesh[]>();
  const wheels: TransformNode[] = [], wheelFrames: TransformNode[] = [];
  const exhausts: TransformNode[] = [];
  const wheelHeights: number[] = [];
  const panels: Panel[] = [];
  const scratches: Mesh[] = [], cracks: Mesh[] = [], shards: Mesh[] = [];
  let debrisQueue: Mesh[] = [];
  const emptyDebris: Mesh[] = [];
  const w = spec.width, l = spec.length;
  const conceptSpec = spec;
  const role = kind === 'police' ? conceptSpec.policeRole ?? 'patrol' : undefined;
  const defaultStyles: Record<string, NonNullable<typeof conceptSpec.bodyStyle>> = {rally:'suv',brute:'pickup',kestrel:'coupe',sandfox:'buggy',cobra:'muscle',bastion:'van'};
  const style = conceptSpec.bodyStyle??defaultStyles[spec.id]??'hatch';
  const variant = spec.visualVariant ?? (spec.id==='comet'?'sport-hatch':undefined);
  const sportHatch=variant==='sport-hatch',retroHatch=variant==='retro-hatch',rallyHatch=variant==='rally-hatch';
  const wagon=variant==='wagon',convertible=variant==='convertible',apc=variant==='apc';
  const truck = ['tow','fire','ambulance','garbage','mixer','camper','command'].includes(variant??'');
  const civilianVan = ['minibus','stepvan','bus'].includes(variant??'');
  const pickup = style === 'pickup', rally = style === 'suv', buggy = style === 'buggy', coupe = style === 'coupe', muscle = style === 'muscle', van = style === 'van';
  const sedan = variant==='sedan'||kind === 'police' && !rally && !van && !pickup && !rallyHatch;
  const chassisY = van ? .87 : pickup ? .85 : rally ? .88 : buggy ? .61 : coupe ? .67 : .73;
  const roofY = apc?2.03:van ? (civilianVan?2.52:truck?2.14:2.32) : rally ? 2.00 : pickup ? 1.91 : buggy ? 1.69 : coupe ? 1.47 : muscle ? 1.51 : sportHatch?1.43:rallyHatch?1.56:retroHatch?1.52:wagon?1.72:sedan?1.62:1.56;
  const bodyWidth = w * (buggy ? .72 : .88), bodyHalf = bodyWidth / 2;
  const wheelRadius = van ? .47 : pickup ? .48 : rally ? .46 : buggy ? .45 : .39;
  const wheelWidth = pickup || rally || buggy || van ? .31 : .25;
  const axle = l * (pickup ? .33 : van ? .32 : .305), wheelX = w * .455;
  let stage = 0, disposed = false;
  let health = 1, tires = 1, compactRequested = false, compactShown = false;
  let compactMesh: Mesh | undefined;
  let turretEnabled = false;
  const policeColor=variant==='sheriff'?'#b9a273':role==='swat'?'#354653':'#e7e9e2';
  let baseColor = Color3.FromHexString(kind === 'police' ? policeColor : color);
  const charredColor = Color3.FromHexString('#343834');

  function material(name: string, hex: string, glow = 0): StandardMaterial {
    const mat = new StandardMaterial(name, scene);
    mat.diffuseColor = Color3.FromHexString(hex);
    mat.specularColor = Color3.Black();
    mat.specularPower = 24;
    // Procedural gallery faces use outward CCW normals; retain two-sided glass
    // and panel backs so detached doors remain visible from either direction.
    mat.backFaceCulling = false;
    if (glow) mat.emissiveColor = mat.diffuseColor.scale(glow);
    materials.push(mat);
    return mat;
  }
  const paint = material('body-paint', kind === 'police' ? policeColor : color);
  const dark = material('rubber-trim', '#222925');
  const metal = material('wheel-metal', '#a7afa1');
  const black = material('police-panels', '#25323a');
  const glass = material('opaque-blue-glass', '#172d30');
  const lights = material('warm-headlights', '#fff1bf', 0.5);
  const tail = material('tail-lights', '#d95247', 0.35);
  const exposed = material('exposed-damaged-metal', '#d9d5bd');
  const amber = material('amber-markers', '#e6a846', .15);
  const crackMat = material('cracked-glass-edges', '#b9d0cd', 0.16);
  const seats = material('car-interior', '#51564b');
  const red = kind === 'police' ? material('police-red', '#fa514e', 0.8) : tail;
  const blue = kind === 'police' ? material('police-blue', '#70c5ed', 0.8) : glass;

  function register(mesh: Mesh, mat: StandardMaterial, parent: TransformNode = chassis, batch = false): Mesh {
    mesh.material = mat; mesh.parent = parent; mesh.isPickable = false; mesh.receiveShadows = true;
    if (batch) { const group = batches.get(mat) ?? []; group.push(mesh); batches.set(mat, group); }
    return mesh;
  }
  function box(name: string, width: number, height: number, depth: number, x: number, y: number, z: number, mat: StandardMaterial, parent: TransformNode = chassis, batch = parent === chassis): Mesh {
    // Tiny trim reads as a colour block at game distance; bevel only silhouette parts.
    const mesh = Math.min(width,height,depth)<.085 ? MeshBuilder.CreateBox(name,{width,height,depth},scene) : conceptBox(scene, name, width, height, depth, Math.min(.045, height*.22));
    mesh.position.set(x, y, z);
    return register(mesh, mat, parent, batch);
  }
  function poly(name: string, faces: Point[][], mat: StandardMaterial, parent: TransformNode = chassis, batch = false): Mesh {
    const positions: number[] = [], indices: number[] = [], normals: number[] = [];
    for (const face of faces) {
      const offset = positions.length / 3;
      for (const p of face) positions.push(...p);
      for (let i = 1; i < face.length - 1; i++) indices.push(offset, offset + i, offset + i + 1);
    }
    // Gallery geometry is outward CCW; normals must follow that winding even
    // when the game scene itself uses Babylon's left-handed camera convention.
    VertexData.ComputeNormals(positions,indices,normals,{useRightHandedSystem:true});
    const data = new VertexData();
    data.positions = positions; data.indices = indices; data.normals = normals;
    data.uvs = new Array((positions.length / 3) * 2).fill(0);
    const mesh = new Mesh(name, scene); data.applyToMesh(mesh);
    mat.backFaceCulling = false;
    return register(mesh, mat, parent, batch);
  }
  function panel(mesh: Mesh): Mesh {
    panels.push({ mesh, position: mesh.position.clone(), rotation: mesh.rotation.clone(), scaling: mesh.scaling.clone() });
    return mesh;
  }
  function segment(name: string, from: Point, to: Point, width: number, mat: StandardMaterial, parent: TransformNode = chassis, batch = false): Mesh {
    const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const mesh = box(name, width, width, length, (from[0] + to[0]) * 0.5, (from[1] + to[1]) * 0.5, (from[2] + to[2]) * 0.5, mat, parent, batch);
    mesh.rotation.set(-Math.atan2(dy, Math.hypot(dx, dz)), Math.atan2(dx, dz), 0);
    return mesh;
  }
  function scratch(name: string, from: Point, to: Point, parent: TransformNode, thickness = 0.045, mat = exposed): void {
    const mesh = segment(name, from, to, thickness, mat, parent);
    mesh.setEnabled(false); scratches.push(mesh);
  }
  function cylinder(name:string,diameter:number,length:number,x:number,y:number,z:number,mat:StandardMaterial,axis:'x'|'y'|'z'='y',top=diameter):Mesh {
    const mesh=MeshBuilder.CreateCylinder(name,{diameterBottom:diameter,diameterTop:top,height:length,tessellation:8},scene);
    if(axis==='x')mesh.rotation.z=Math.PI/2;if(axis==='z')mesh.rotation.x=Math.PI/2;
    mesh.position.set(x,y,z);return register(mesh,mat,chassis,true);
  }

  // A low sill, separate fenders and a dark floor create real openings after panel loss.
  const halfW = bodyHalf, halfL = l * .47, corner = buggy ? .30 : .14;
  const outline = [[-halfW + corner, halfL], [halfW - corner, halfL], [halfW, halfL - corner], [halfW, -halfL + corner], [halfW - corner, -halfL], [-halfW + corner, -halfL], [-halfW, -halfL + corner], [-halfW, halfL - corner]];
  const lower: Point[] = outline.map(([x, z]) => [x * 0.95, chassisY - 0.25, z]);
  const upper: Point[] = outline.map(([x, z]) => [x, chassisY - 0.015, z * 0.98]);
  const bodyFaces: Point[][] = [lower.slice().reverse(), upper];
  for (let i = 0; i < outline.length; i++) { const j = (i + 1) % outline.length; bodyFaces.push([lower[i], lower[j], upper[j], upper[i]]); }
  poly('chamfered-sill-body', bodyFaces, paint, chassis, true);
  box('underbody', w * .69, .15, l * .86, 0, chassisY-.27, 0, dark);
  box('interior-floor', bodyWidth*.92, .055, l*.87, 0, chassisY+.025, 0, dark);
  const frontBottom = apc ? l*.28 : truck ? l*.36 : van ? l*.40 : pickup ? l*.18 : rally ? l*.16 : buggy ? l*.14 : coupe ? l*.13 : muscle ? l*.10 : l*.18;
  const rearBottom = truck ? l*.10 : van ? -l*.43 : pickup ? -l*.165 : wagon?-l*.40:rally ? -l*.395 : buggy ? -l*.17 : coupe ? -l*.29 : muscle ? -l*.28 : sedan ? -l*.29 : -l*.36;
  const frontTop = apc ? l*.18 : truck ? l*.30 : van ? l*.36 : pickup ? l*.07 : rally ? l*.068 : buggy ? l*.085 : coupe ? l*.015 : muscle ? -l*.01 : l*.042;
  const rearTop = truck ? l*.11 : van ? -l*.40 : pickup ? -l*.132 : wagon?-l*.35:rally ? -l*.34 : buggy ? -l*.135 : coupe ? -l*.18 : muscle ? -l*.19 : sedan ? -l*.19 : -l*.278;
  const cabinCenter = (frontBottom+rearBottom)/2;
  const cabinBottom = chassisY+.20, baseW = bodyHalf*.97, topW = bodyHalf*(van?.91:rally?.88:coupe?.77:.82);
  const hoodDepth = l * 0.47 - frontBottom, hoodCenter = frontBottom + hoodDepth * 0.5;
  let hood:Mesh;
  if(apc){
    const x=bodyHalf*.98,z=hoodDepth*.5;
    hood=poly('detachable-hood',[
      [[-x,.03,z],[x,.03,z],[x*.87,.26,-z],[-x*.87,.26,-z]],
      [[-x,-.10,z],[x,-.10,z],[x,.03,z],[-x,.03,z]],
      [[-x,-.10,z],[-x,.03,z],[-x*.87,.26,-z],[-x*.87,-.10,-z]],
      [[x,-.10,z],[x*.87,-.10,-z],[x*.87,.26,-z],[x,.03,z]],
      [[-x*.87,-.10,-z],[-x*.87,.26,-z],[x*.87,.26,-z],[x*.87,-.10,-z]],
    ],paint);hood.position.set(0,chassisY+.24,hoodCenter);panel(hood);
  }else hood=panel(box('detachable-hood', bodyWidth*(buggy?.72:.95), .105, hoodDepth, 0, chassisY+.24, hoodCenter, kind==='police'&&!van?black:paint, chassis, false));
  const trunkDepth = Math.max(0.45, rearBottom + l * 0.47), trunkCenter = rearBottom - trunkDepth * 0.5;
  const trunk = panel(box(pickup ? 'detachable-pickup-tailgate' : 'detachable-trunk', bodyWidth*.94, pickup||van ? .30 : .11, pickup||van ? .15 : trunkDepth, 0, chassisY+(pickup||van?.30:.23), pickup||van ? -l*.455 : trunkCenter, paint, chassis, false));
  const frontBumper = panel(box('detachable-front-bumper', w*(apc?.98:.91), apc?.40:pickup||van||rally?.26:.21, apc?.32:.22, 0, chassisY-.18, l*.49, apc?paint:dark, chassis, false));
  const rearBumper = panel(box('detachable-rear-bumper', w*.9, .20, .19, 0, chassisY-.18, -l*.49, dark, chassis, false));
  box('front-grille', bodyWidth*(apc?.26:pickup?.65:.56), apc?.075:pickup||van?.28:.17, .035, 0, chassisY+.06, l*.477, dark);
  if(!apc)for(const row of pickup||muscle ? [-1,0,1]:[0]) box('grille-bar', bodyWidth*.53, .023, .025, 0, chassisY+.06+row*.075, l*.486, metal);
  for (const side of [-1, 1]) {
    box('front-fender', bodyWidth*.105, buggy?.25:.41, hoodDepth+.1, side*bodyHalf*.895, chassisY+.025, hoodCenter, paint);
    box('rear-fender', bodyWidth*.105, buggy?.25:.41, trunkDepth+.13, side*bodyHalf*.895, chassisY+.025, trunkCenter, paint);
    box('headlight-recess',bodyWidth*(apc?.11:.23),apc?.19:rally||van||pickup?.28:.21,.055,side*bodyWidth*.37,chassisY+.10,l*.475,dark);
    box('headlight', bodyWidth*(apc?.07:.18), apc?.13:sportHatch?.055:rally||van||pickup?.22:.16, .045, side*bodyWidth*.37, chassisY+.10, l*.49, lights);
    if(sportHatch)box('headlight-lower-segment',bodyWidth*.18,.045,.04,side*bodyWidth*.37,chassisY+.02,l*.49,lights);
    box('amber-turn-signal',.085,.11,.045,side*bodyWidth*.475,chassisY+.07,l*.48,amber);
    box('tail-light', bodyWidth*.14, .19, .04, side*bodyWidth*.38, chassisY+.08, -l*.478, tail);
    box('side-sill', .10, .11, l*.48, side*bodyHalf, chassisY-.23, 0, dark);
    box('bucket-seat', 0.42, 0.17, 0.52, side * w * 0.19, chassisY + 0.14, cabinCenter - 0.13, seats);
    box('seat-back', 0.43, 0.39, 0.13, side * w * 0.19, chassisY + 0.3, cabinCenter - 0.4, seats);
  }
  box('engine-block', w * 0.43, 0.21, hoodDepth * 0.71, 0, chassisY + 0.11, hoodCenter, metal);
  for (const side of [-1, 1]) {
    box('engine-cylinder-bank', 0.12, 0.08, hoodDepth * 0.62, side * w * 0.14, chassisY + 0.19, hoodCenter, dark);
    box('engine-red-cable', 0.04, 0.025, hoodDepth * 0.6, side * w * 0.09, chassisY + 0.22, hoodCenter, tail);
  }
  if(!convertible)box('cabin-roof', topW*2+.055, buggy?.045:.095, frontTop-rearTop+.07, 0, roofY, (frontTop+rearTop)*.5, sportHatch||buggy?dark:retroHatch||muscle||sedan||civilianVan?exposed:paint);
  for (const side of [-1, 1]) {
    segment('front-cabin-pillar', [side * baseW, cabinBottom, frontBottom], [side * topW, roofY, frontTop], 0.085, paint, chassis, true);
    if(!convertible){segment('rear-cabin-pillar', [side * baseW, cabinBottom, rearBottom], [side * topW, roofY, rearTop], 0.085, paint, chassis, true);
    segment('center-cabin-pillar', [side * baseW, cabinBottom, cabinCenter - 0.08], [side * topW, roofY, cabinCenter - 0.08], 0.065, paint, chassis, true);}
  }
  const lowY = apc ? roofY-.34 : van ? roofY-.65 : cabinBottom+.08, highY = roofY-(apc?.13:buggy?.17:.075);
  const lo = (lowY - cabinBottom) / (roofY - cabinBottom), hi = (highY - cabinBottom) / (roofY - cabinBottom);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const lowW = lerp(baseW, topW, lo), highW = lerp(baseW, topW, hi);
  const lowFront = lerp(frontBottom, frontTop, lo), highFront = lerp(frontBottom, frontTop, hi);
  const lowRear = lerp(rearBottom, rearTop, lo), highRear = lerp(rearBottom, rearTop, hi);
  const frontPoints: Point[] = [[-lowW + 0.06, lowY, lowFront + 0.012], [lowW - 0.06, lowY, lowFront + 0.012], [highW - 0.05, highY, highFront + 0.012], [-highW + 0.05, highY, highFront + 0.012]];
  const windshieldFaces:Point[][]=apc?[-1,1].map(side=>{
    const a=side<0?-.70:.12,b=side<0?-.12:.70;
    return [[a,lowY,lowFront+.024],[b,lowY,lowFront+.024],[b*.96,highY,highFront+.024],[a*.96,highY,highFront+.024]];
  }):[frontPoints];
  const windshield = panel(poly('windscreen', windshieldFaces, glass));
  const rearWindow = panel(poly('rear-window', [[[-lowW + 0.08, lowY, lowRear - 0.012], [-highW + 0.06, highY, highRear - 0.012], [highW - 0.06, highY, highRear - 0.012], [lowW - 0.08, lowY, lowRear - 0.012]]], glass));
  if(buggy||convertible||apc) rearWindow.setEnabled(false);
  if(apc){
    poly('apc-sloped-front-armor',[[[-baseW,cabinBottom,frontBottom],[baseW,cabinBottom,frontBottom],[topW,roofY,frontTop],[-topW,roofY,frontTop]]],paint,chassis,true);
    for(const side of [-1,1])poly('apc-upper-side-armor',[[[side*baseW,1.53,frontBottom],[side*baseW,1.53,rearBottom],[side*topW,roofY,rearTop],[side*topW,roofY,frontTop]]],paint,chassis,true);
  }
  if(van) {
    box('armored-windscreen-bulkhead',bodyWidth*.94,.57,.14,0,1.36,frontBottom-.055,paint);
    box('van-rear-bulkhead',bodyWidth*.94,.61,.13,0,1.36,rearBottom+.035,paint);
    box('armored-roof-rib',topW*1.96,.09,.13,0,roofY+.07,cabinCenter-.25,dark);
  }
  const center: Point = [0.12, lerp(lowY, highY, 0.52), lerp(lowFront, highFront, 0.52) + 0.025];
  for (const end of frontPoints) {
    const crack = segment('windscreen-crack', center, [lerp(center[0], end[0], 0.86), lerp(center[1], end[1], 0.86), lerp(center[2], end[2], 0.86) + 0.02], 0.018, crackMat, windshield);
    crack.setEnabled(false); cracks.push(crack);
  }
  const shardPoints: Point[][] = apc?windshieldFaces.flatMap(face=>[[face[0],face[1],face[2]],[face[0],face[2],face[3]]]):[[frontPoints[0], frontPoints[1], center], [frontPoints[1], frontPoints[2], center], [frontPoints[2], frontPoints[3], center]];
  for (const points of shardPoints) { const shard = poly('windscreen-shard', [points], glass); shard.setEnabled(false); shards.push(shard); }

  const doors: Mesh[] = [];
  for (const side of [-1, 1]) {
    const door = panel(box(side < 0 ? 'detachable-left-door' : 'detachable-right-door', .095, buggy?.10:van?1.0:.43, frontBottom-rearBottom-.08, side*bodyHalf*.99, chassisY+(van?.30:.01), cabinCenter, buggy?dark:paint, chassis, false));
    doors.push(door);
    const split = cabinCenter - 0.08;
    const twoWindows=split-.065>Math.max(lowRear+.07,highRear+.06);
    const glassFaces: Point[][] = twoWindows ? [
      [[side * (lowW + 0.014), lowY, lowFront - 0.07], [side * (lowW + 0.014), lowY, split + 0.045], [side * (highW + 0.014), highY, split + 0.045], [side * (highW + 0.014), highY, highFront - 0.06]],
      [[side * (lowW + 0.014), lowY, split - 0.045], [side * (lowW + 0.014), lowY, lowRear + 0.07], [side * (highW + 0.014), highY, highRear + 0.06], [side * (highW + 0.014), highY, split - 0.045]],
    ] : [[[side*(lowW+.014),lowY,lowFront-.07],[side*(lowW+.014),lowY,lowRear+.07],[side*(highW+.014),highY,highRear+.06],[side*(highW+.014),highY,highFront-.06]]];
    if(side<0)for(const face of glassFaces)face.reverse();
    const pane = poly('door-glass-panes', glassFaces, glass, door);
    if(buggy||convertible||apc) pane.setEnabled(false);
    pane.position.copyFrom(door.position).negateInPlace();
    const crackFrom: Point = [side * (lerp(lowW, highW, 0.5) + 0.027), lerp(lowY, highY, 0.5), cabinCenter + 0.22];
    for (const z of [lowFront - 0.17, split + 0.12]) {
      const crack = segment('side-glass-crack', crackFrom, [side * (highW + 0.028), highY - 0.025, z], 0.018, crackMat, pane);
      crack.setEnabled(false); cracks.push(crack);
    }
    if(!buggy)box('door-handle',.03,.045,.17,side*.06,van?.23:.12,-.21,dark,door);
    box('mirror-arm', 0.19, 0.055, 0.07, side * 0.11, 0.34, frontBottom - cabinCenter - 0.15, dark, door);
    box('mirror', 0.13, 0.13, 0.22, side * 0.22, 0.35, frontBottom - cabinCenter - 0.15, dark, door);
    if (kind === 'police') {
      box('police-door-band',.018,.16,Math.min(1.6,frontBottom-rearBottom-.2),side*.056,van?.32:.01,0,role==='swat'?metal:black,door);
      const badge=MeshBuilder.CreateCylinder('police-door-badge',{diameter:.25,height:.018,tessellation:6},scene);badge.rotation.z=Math.PI/2;badge.position.set(side*.07,van?.37:.08,.02);register(badge,role==='swat'?black:exposed,door);
    }
    scratch('broad-door-scrape', [side * 0.06, -0.08, -0.61], [side * 0.06, 0.12, 0.57], door, 0.06);
    scratch('lower-door-scrape', [side * 0.064, -0.14, -0.43], [side * 0.064, -0.015, 0.63], door, 0.035);
    scratch('dark-door-gouge', [side * 0.064, -0.015, -0.56], [side * 0.064, 0.19, 0.48], door, 0.035, dark);
  }
  scratch('bonnet-long-scrape', [-w * 0.25, 0.058, -hoodDepth * 0.33], [w * 0.25, 0.058, hoodDepth * 0.3], hood, 0.045);
  scratch('bonnet-short-scrape', [-w * 0.14, 0.06, -hoodDepth * 0.4], [w * 0.3, 0.06, hoodDepth * 0.07], hood, 0.03);
  if (pickup) {
    box('bed-floor', bodyWidth*.88, .045, trunkDepth, 0, chassisY+.075, trunkCenter, dark);
    for (const side of [-1, 1]) {
      box('bed-rail', .16, .31, trunkDepth, side*bodyHalf*.94, chassisY+.31, trunkCenter, paint);
      box('bed-rail-cap', .18, .045, trunkDepth, side*bodyHalf*.94, chassisY+.49, trunkCenter, dark);
      box('bullbar-leg', 0.09, 0.34, 0.1, side * w * 0.31, 0.08, 0.13, metal, frontBumper);
    }
    box('bullbar-cross', w * 0.68, 0.09, 0.1, 0, 0.22, 0.13, metal, frontBumper);
    box('hood-power-bulge', 0.81, 0.09, hoodDepth * 0.7, 0, 0.09, 0, paint, hood);
    box('hood-intake', 0.5, 0.08, 0.1, 0, 0.1, hoodDepth * 0.33, dark, hood);
  } else if (rally) {
    box('safari-hood-panel',bodyWidth*.33,.014,hoodDepth*.60,0,.058,0,dark,hood);
    box('safari-roof-panel',topW*1.98,.035,frontTop-rearTop+.03,0,roofY+.065,(frontTop+rearTop)*.5,exposed);
    for (const side of [-1, 1]) {
      box('rally-lamp', 0.23, 0.19, 0.1, side * 0.27, 0.27, 0.03, lights, frontBumper);
      box('safari-roof-rail',.07,.11,frontTop-rearTop+.08,side*topW*.86,roofY+.15,(frontTop+rearTop)*.5,dark);
      box('side-step',.20,.11,l*.45,side*bodyHalf*1.10,.51,0,dark);
    }
    box('roof-front-crossbar',topW*1.78,.07,.07,0,roofY+.15,frontTop,dark);
    box('roof-rear-crossbar',topW*1.78,.07,.07,0,roofY+.15,rearTop,dark);
    const spare=MeshBuilder.CreateCylinder('safari-spare-tire',{diameter:.76,height:.22,tessellation:12},scene);spare.rotation.x=Math.PI/2;spare.position.set(0,1.24,-l*.49-.14);register(spare,dark,chassis,true);
    const spareRim=MeshBuilder.CreateCylinder('safari-spare-rim',{diameter:.40,height:.025,tessellation:8},scene);spareRim.rotation.x=Math.PI/2;spareRim.position.set(0,1.24,-l*.49-.266);register(spareRim,metal,chassis,true);
  } else if(buggy) {
    for(const side of [-1,1]) {
      segment('buggy-roll-cage',[side*baseW,cabinBottom,rearBottom],[side*topW,roofY+.08,rearTop],.105,dark,chassis,true);
      segment('buggy-side-crash-bar',[side*baseW,cabinBottom-.10,frontBottom],[side*baseW,cabinBottom-.10,rearBottom],.075,metal,chassis,true);
      box('buggy-hood-vent',.12,.014,hoodDepth*.58,side*.17,.059,0,dark,hood);
    }
    box('buggy-rear-engine',bodyWidth*.58,.25,.45,0,chassisY+.25,trunkCenter,metal);
  } else if(van&&!truck&&!civilianVan) {
    for(const side of [-1,1]) {
      box('armored-body-plate',.07,.37,l*.30,side*bodyHalf*1.02,chassisY+.21,-l*.13,black);
      box('van-side-step',.22,.12,l*.60,side*bodyHalf*1.1,.48,-.08,dark);
      box('roof-armored-rail',.10,.10,l*.67,side*topW*.90,roofY+.09,-l*.02,dark);
    }
  } else if(coupe||muscle) {
    for(const side of [-1,1])box('sports-hood-stripe',muscle?.16:.10,.014,hoodDepth*.89,side*.20,.058,0,dark,hood);
    if(muscle){box('muscle-hood-scoop',.58,.13,hoodDepth*.47,0,.11,0,paint,hood);box('scoop-opening',.43,.075,.02,0,.14,hoodDepth*.235+.014,dark,hood);}
    box('sports-ducktail',bodyWidth*.92,.065,.23,0,.14,-trunkDepth*.28,dark,trunk);
  } else {
    for (const side of [-1, 1]) {
      box('hood-highlight',bodyWidth*.40,.012,.16,side*bodyWidth*.20,.057,hoodDepth*.33,kind==='police'?black:sportHatch||retroHatch?paint:exposed,hood);
    }
    box('rear-hatch-lip',bodyWidth*.90,.055,.15,0,.085,-trunkDepth*.24,paint,trunk);
  }

  // Broad panels and equipment make silhouettes legible from the chase camera.
  for(const side of [-1,1]) {
    if(!apc){box('bumper-intake',bodyWidth*.19,.13,.035,side*bodyWidth*.34,-.01,.125,dark,frontBumper);
    box('fog-light',.15,.075,.04,side*bodyWidth*.37,.055,.15,amber,frontBumper);}
    box('rear-reflector',.18,.055,.025,side*bodyWidth*.35,.01,-.11,tail,rearBumper);
    box('beltline-trim',.025,.045,frontBottom-rearBottom-.12,side*.063,.17,0,dark,doors[side<0?0:1]);
    box('lower-sill-blade',.10,.07,l*.48,side*bodyHalf*1.04,chassisY-.20,0,dark);
    if(!apc)segment('windshield-wiper',[side*.10,lowY+.035,lowFront+.024],[side*.38,lowY+.08,lowFront-.03],.018,dark,chassis,true);
    for(const z of [axle,-axle]) {
      const flare=conceptArch(scene,'painted-fender-flare',wheelRadius+.10,wheelRadius+.19,wheelWidth*.78);
      flare.position.set(side*(wheelX-.065),wheelRadius+.025,z);register(flare,buggy?dark:paint,chassis,true);
    }
  }
  if(!apc)box('front-number-plate',.34,.10,.024,0,-.015,.14,exposed,frontBumper);
  box('rear-number-plate',.34,.10,.024,0,.02,-.116,exposed,rearBumper);
  if(sportHatch||rallyHatch||retroHatch||coupe&&!convertible||muscle) {
    const spoilerZ=rearTop-.07,spoilerY=roofY+(coupe||muscle?-.12:.11);
    for(const side of [-1,1])box('spoiler-stanchion',.07,.18,.08,side*bodyWidth*.30,spoilerY,spoilerZ,dark);
    box('rear-wing',bodyWidth*1.02,.07,.22,0,spoilerY+.10,spoilerZ,sportHatch||coupe||muscle?dark:paint);
  }
  if(rallyHatch) {
    box('rally-roof-scoop',.48,.12,.32,0,roofY+.11,frontTop-.22,exposed);
    box('roof-scoop-opening',.35,.07,.02,0,roofY+.12,frontTop-.05,dark);
    for(const x of [-.51,-.17,.17,.51]){
      cylinder('rally-lamp-housing',.29,.12,x,chassisY+.26,l*.50,dark,'z');
      cylinder('rally-lamp-lens',.23,.025,x,chassisY+.26,l*.52,lights,'z');
    }
    for(const side of [-1,1]){
      box('rally-hood-vent',.20,.018,hoodDepth*.32,side*.33,.064,0,dark,hood);
      box('rally-door-stripe',.023,.19,frontBottom-rearBottom-.12,side*.063,.03,0,exposed,doors[side<0?0:1]);
      for(const z of [axle,-axle])box('rally-mudflap',.31,.27,.045,side*wheelX,.28,z-.40,dark);
    }
    box('rally-skid-plate',bodyWidth*.56,.22,.08,0,-.16,.16,metal,frontBumper);
  }
  if(wagon) {
    for(const side of [-1,1]){
      box('wagon-cream-stripe',.025,.16,frontBottom-rearBottom-.12,side*.063,.02,0,exposed,doors[side<0?0:1]);
      box('wagon-roof-rail',.065,.12,frontTop-rearTop+.05,side*topW*.8,roofY+.12,cabinCenter,dark);
    }
    for(const z of [rearTop+.2,frontTop-.2])box('luggage-crossbar',topW*1.75,.07,.07,0,roofY+.15,z,dark);
    box('roof-luggage-case',topW*1.4,.22,l*.20,0,roofY+.30,cabinCenter-.09,kind==='traffic'?seats:dark);
    for(const x of [-.27,.27])box('luggage-strap',.055,.025,l*.20,x,roofY+.42,cabinCenter-.09,metal);
  }
  if(convertible){
    box('folded-convertible-roof',bodyWidth*.79,.17,.36,0,chassisY+.35,rearBottom+.10,dark);
    for(const side of [-1,1]){
      box('headrest',.23,.17,.13,side*w*.19,chassisY+.60,cabinCenter-.40,dark);
      segment('seat-belt',[side*w*.19-.14,chassisY+.16,cabinCenter-.25],[side*w*.19+.11,chassisY+.49,cabinCenter-.34],.045,amber,chassis,true);
    }
    segment('windshield-header',[-topW,roofY,frontTop],[topW,roofY,frontTop],.07,exposed,chassis,true);
  }
  if(pickup&&!truck){
    for(const side of [-1,1]){
      segment('bed-rollbar',[side*bodyHalf*.77,chassisY+.40,-l*.23],[side*bodyHalf*.77,roofY+.09,-l*.20],.085,dark,chassis,true);
      box('pickup-cream-stripe',.026,.14,frontBottom-rearBottom-.12,side*.063,.01,0,exposed,doors[side<0?0:1]);
    }
    segment('bed-crossbar',[-bodyHalf*.77,roofY+.09,-l*.20],[bodyHalf*.77,roofY+.09,-l*.20],.085,dark,chassis,true);
    cylinder('bed-spare',.77,.23,0,chassisY+.58,-l*.32,dark,'z');
    cylinder('bed-spare-hub',.39,.025,0,chassisY+.58,-l*.344,metal,'z');
    box('expedition-fuel-can',.25,.42,.20,bodyHalf*.57,chassisY+.43,-l*.33,tail);
    box('front-winch',.42,.20,.22,0,.15,.17,metal,frontBumper);
    box('winch-dark-drum',.29,.08,.24,0,.16,.19,dark,frontBumper);
  }
  if(rally){
    box('safari-cargo-crate',.65,.25,.52,0,roofY+.30,cabinCenter-.1,exposed);
    for(const x of [-.23,.23])box('cargo-crate-strap',.05,.027,.54,x,roofY+.44,cabinCenter-.1,dark);
    segment('snorkel',[bodyHalf*.99,chassisY+.21,frontBottom+.1],[bodyHalf*1.02,roofY+.12,frontTop+.1],.09,dark,chassis,true);
    box('snorkel-head',.18,.12,.15,bodyHalf*1.02,roofY+.14,frontTop+.1,dark);
    box('safari-skid-plate',bodyWidth*.62,.23,.08,0,-.16,.15,metal,frontBumper);
  }
  if(buggy){
    for(const side of [-1,1]){
      segment('front-suspension',[0,.34,axle],[side*wheelX,.40,axle],.07,metal,chassis,true);
      segment('rear-suspension',[0,.34,-axle],[side*wheelX,.40,-axle],.07,metal,chassis,true);
      segment('yellow-seat-harness',[side*w*.19-.12,chassisY+.20,cabinCenter-.28],[side*w*.19-.12,chassisY+.48,cabinCenter-.34],.055,amber,chassis,true);
      cylinder('buggy-roof-spot',.23,.10,side*.35,roofY+.12,frontTop,lights,'z');
    }
    cylinder('buggy-rear-spare',.74,.23,0,chassisY+.58,-l*.37,dark,'z');
    box('buggy-front-skid',bodyWidth*.65,.24,.09,0,-.12,.14,metal,frontBumper);
  }
  if(coupe&&!convertible)for(const side of [-1,1]){
    box('gt-side-air-inlet',.05,.25,.40,side*bodyHalf*1.02,chassisY+.14,-l*.20,dark);
    for(const y of [-.06,.03,.12])box('gt-intake-fin',.06,.025,.32,side*bodyHalf*1.04,chassisY+.14+y,-l*.20,metal);
  }
  if(muscle)for(const side of [-1,1])for(const x of [.27,.40])cylinder('muscle-quad-lamp',.18,.035,side*bodyWidth*x,chassisY+.1,l*.505,lights,'z');

  if(civilianVan){
    for(const side of [-1,1]){
      // These are flat panels; mullions split the existing continuous cabin glass.
      box('van-lower-side',.065,.40,l*.64,side*bodyHalf,chassisY+.36,-l*.08,paint);
      box('van-roof-gutter',.07,.065,l*.88,side*topW,roofY+.035,0,exposed);
      if(variant==='stepvan')box('delivery-blank-side',.075,1.0,l*.55,side*bodyHalf,roofY-.64,-l*.12,paint);
      else for(let i=0;i<(variant==='bus'?5:3);i++)box('passenger-window-mullion',.07,.66,.065,side*bodyHalf*.94,roofY-.38,-l*.34+i*l*.12,exposed);
      box('van-company-stripe',.022,.18,l*.60,side*bodyHalf*1.045,chassisY+.35,-l*.10,exposed);
      const doorZ=variant==='bus'?l*.29:l*.19;
      box('passenger-entry-door',.08,1.35,l*.12,side*bodyHalf*1.03,chassisY+.53,doorZ,dark);
      box('entry-door-window',.09,.69,l*.095,side*bodyHalf*1.04,chassisY+.81,doorZ,glass);
      box('entry-step',.19,.10,l*.14,side*bodyHalf*1.08,.41,doorZ,metal);
      for(let i=0;i<3;i++)box('rear-engine-vent',.03,.055,.40,side*bodyHalf*1.05,chassisY+.10+i*.11,-l*.34,dark);
    }
    if(variant==='bus'){box('route-display',bodyWidth*.72,.21,.04,0,roofY-.16,l*.382,dark);box('route-digits',.50,.08,.045,0,roofY-.16,l*.387,amber);}
  }
  if(truck){
    const rearZ=-l*.18,rearDepth=l*.53;
    for(const side of [-1,1]){
      box('truck-frame-rail',.16,.16,l*.87,side*w*.27,.48,0,dark);
      box('truck-running-board',.25,.12,l*.21,side*bodyHalf*1.04,.49,l*.21,metal);
      box('truck-cab-stripe',.025,.17,frontBottom-rearBottom-.10,side*.064,.12,0,exposed,doors[side<0?0:1]);
      box('truck-side-storage',.35,.33,.65,side*bodyHalf*.84,.70,-l*.04,metal);
    }
    if(variant==='tow'){
      box('tow-bed',bodyWidth,.16,rearDepth,0,1.03,rearZ,dark);
      for(const side of [-1,1])segment('tow-boom-brace',[side*.5,1.13,0],[0,2.08,-l*.32],.14,metal,chassis,true);
      segment('tow-boom',[0,1.35,l*.03],[0,2.3,-l*.38],.21,dark,chassis,true);
      segment('tow-cable',[0,2.3,-l*.38],[0,1.43,-l*.38],.035,dark,chassis,true);
      box('tow-hook-back',.09,.20,.09,0,1.34,-l*.38,metal);box('tow-hook-foot',.21,.07,.09,.06,1.25,-l*.38,metal);
    } else if(variant==='mixer'){
      cylinder('mixer-drum',1.70,1.9,0,1.72,-l*.15,exposed,'z');
      cylinder('mixer-drum-front',1.70,.70,0,1.72,l*.045,amber,'z',.65);
      cylinder('mixer-drum-rear',.65,.70,0,1.72,-l*.345,exposed,'z',1.70);
      box('mixer-hopper',.70,.37,.58,0,2.07,-l*.43,metal);
      const chute=box('concrete-chute',.33,.15,.95,.1,1.10,-l*.43,metal);chute.rotation.x=-.35;
    } else {
      const tall=variant==='camper'||variant==='ambulance'||variant==='command',cargoTop=tall?2.95:2.54;
      box('service-body',bodyWidth*.99,cargoTop-1.08,rearDepth,0,(cargoTop+1.08)/2,rearZ,variant==='garbage'?metal:tall?exposed:paint);
      box('service-roof',bodyWidth*1.03,.09,rearDepth+.06,0,cargoTop,rearZ,exposed);
      for(const side of [-1,1]){
        box('service-body-stripe',.025,.23,rearDepth,side*bodyHalf*1.01,1.39,rearZ,variant==='ambulance'?amber:paint);
        if(variant==='fire'){
          for(let i=0;i<3;i++){
            const z=-l*.39+i*l*.16;box('fire-equipment-locker',.04,.75,l*.14,side*bodyHalf*1.02,1.72,z,metal);
            for(let j=0;j<4;j++)box('locker-shutter-slat',.045,.024,l*.13,side*bodyHalf*1.03,1.45+j*.17,z,dark);
          }
          cylinder('hose-reel',.54,.07,side*bodyHalf*1.055,1.75,-l*.01,dark,'x');
          cylinder('hose-reel-centre',.36,.08,side*bodyHalf*1.06,1.75,-l*.01,tail,'x');
        } else if(variant==='garbage'){
          for(const z of [-l*.36,-l*.16,l*.04])box('compactor-rib',.09,1.49,.13,side*bodyHalf*1.02,1.83,z,exposed);
        } else {
          for(const z of [-l*.30,-l*.08])box('service-box-window',.036,.43,.52,side*bodyHalf*1.02,2.26,z,glass);
          box('service-door',.04,1.32,.63,side*bodyHalf*1.03,1.84,-l*.13,metal);
          box('service-door-inset',.045,1.23,.54,side*bodyHalf*1.04,1.84,-l*.13,exposed);
          box('service-door-handle',.06,.14,.045,side*bodyHalf*1.05,1.66,-l*.17,dark);
        }
      }
      if(variant==='fire'){
        for(const side of [-1,1])box('ladder-rail',.09,.11,rearDepth+.55,side*.38,cargoTop+.24,rearZ,metal);
        for(let i=0;i<9;i++)box('ladder-rung',.76,.055,.07,0,cargoTop+.24,-l*.44+i*l*.065,metal);
      }
      if(variant==='garbage'){
        box('rear-compactor',bodyWidth*.88,1.45,.45,0,1.66,-l*.46,paint);
        box('rear-refuse-opening',bodyWidth*.66,.50,.04,0,1.35,-l*.498,dark);
        for(const side of [-1,1])segment('compactor-hydraulic',[side*.64,1.01,-l*.49],[side*.64,2.31,-l*.48],.075,metal,chassis,true);
      }
      if(variant==='ambulance')for(const side of [-1,1]){
        box('medical-cross-horizontal',.03,.16,.56,side*bodyHalf*1.04,2.40,-l*.32,tail);
        box('medical-cross-vertical',.03,.56,.16,side*bodyHalf*1.04,2.40,-l*.32,tail);
      }
      if(variant==='camper'){
        box('camper-overcab',bodyWidth*.99,.57,l*.34,0,2.77,l*.24,exposed);
        box('camper-overcab-window',bodyWidth*.63,.23,.04,0,2.79,l*.414,glass);
        box('camper-awning',.16,.13,rearDepth*.93,bodyHalf*1.06,cargoTop-.10,rearZ,dark);
        box('camper-roof-vent',.50,.12,.44,0,cargoTop+.10,rearZ,metal);
      }
      if(variant==='command'){
        cylinder('command-dish',.82,.14,.2,cargoTop+.38,-l*.08,exposed,'z',.48);
        segment('dish-support',[.2,cargoTop,-l*.08],[.2,cargoTop+.38,-l*.08],.12,dark,chassis,true);
        box('radio-mast',.055,1.02,.055,-.58,cargoTop+.48,-l*.32,dark);
        box('radio-panel',.18,.37,.12,-.58,cargoTop+.88,-l*.32,exposed);
      }
    }
    if(kind!=='police'&&variant!=='camper'){
      box('service-beacon-base',bodyWidth*.61,.08,.22,0,roofY+.09,l*.23,dark);
      box('service-beacon',bodyWidth*.56,.13,.19,0,roofY+.19,l*.23,variant==='ambulance'||variant==='fire'?tail:amber);
    }
  }
  if(apc){
    box('apc-roof-hatch',.73,.13,.80,0,roofY+.12,-l*.10,dark);
    for(const side of [-1,1]){
      box('apc-armor-cheek',.12,.61,l*.51,side*bodyHalf*1.01,1.52,-l*.14,exposed);
      for(const z of [-l*.29,-l*.12,l*.05])box('apc-vision-port',.13,.17,.27,side*bodyHalf*1.02,1.77,z,glass);
      box('apc-rear-antenna',.035,.63,.035,side*.48,roofY+.35,-l*.36,dark);
      box('apc-tow-eye',.12,.16,.10,side*.64,-.02,.21,metal,frontBumper);
      box('apc-eye-opening',.065,.075,.018,side*.64,-.02,.268,dark,frontBumper);
    }
  }

  // Outlet markers point local +Z rearward, so VFX can follow chassis lean naturally.
  const exhaustXs = pickup || rally ? [-w * 0.31, w * 0.31] : [-w * 0.28];
  for (const x of exhaustXs) {
    const pipe = MeshBuilder.CreateCylinder('visible-exhaust-pipe', { diameter: pickup ? 0.24 : 0.2, height: 0.48, tessellation: 8 }, scene);
    pipe.rotation.x = Math.PI / 2; pipe.position.set(x, chassisY - 0.12, -l * 0.485); register(pipe, metal, chassis, true);
    const opening = MeshBuilder.CreateCylinder('dark-exhaust-opening', { diameter: pickup ? 0.18 : 0.145, height: 0.018, tessellation: 8 }, scene);
    opening.rotation.x = Math.PI / 2; opening.position.set(x, chassisY - 0.12, -l * 0.485 - 0.246); register(opening, dark, chassis, true);
    const outlet = new TransformNode('exhaust-outlet', scene); outlet.parent = chassis;
    outlet.position.set(x, chassisY - 0.12, -l * 0.485 - 0.27); outlet.rotation.y = Math.PI;
    exhausts.push(outlet);
  }
  const axlePositions=[axle,-axle,...(spec.extraAxles===2?[-axle/3,axle/3]:spec.extraAxles===1?[-axle+wheelRadius*2.18]:[])];
  for (const z of axlePositions) for (const side of [-1, 1]) {
    const frame = new TransformNode('wheel-frame', scene); frame.parent = root; frame.position.set(side*wheelX,wheelRadius+.025,z);
    const wheel = new TransformNode('wheel', scene); wheel.parent = frame;
    wheels.push(wheel); wheelFrames.push(frame); wheelHeights.push(frame.position.y);
    const tire = MeshBuilder.CreateCylinder('low-poly-tire', { diameter: wheelRadius * 2, height: wheelWidth, tessellation: 12 }, scene);
    tire.rotation.z = Math.PI / 2; register(tire, dark, wheel);
    const rim = MeshBuilder.CreateCylinder('recessed-wheel-disc', { diameter: wheelRadius*1.20, height: wheelWidth+.012, tessellation: 12 }, scene);
    rim.rotation.z = Math.PI / 2; register(rim,black,wheel);
    register(conceptWheelRing(scene,'faceted-alloy-rim',wheelRadius*.49,wheelRadius*.63,wheelWidth+.027),metal,wheel);
    for(let i=0;i<5;i++) {
      const a=i*Math.PI*2/5, center=wheelRadius*.35;
      const spoke=box('alloy-spoke',.027,wheelRadius*.35,.06,side*(wheelWidth/2+.026),Math.cos(a)*center,Math.sin(a)*center,metal,wheel);
      spoke.rotation.x=a;
    }
    const hub = MeshBuilder.CreateCylinder('wheel-hub', { diameter: wheelRadius * 0.43, height: 0.025, tessellation: 6 }, scene);
    hub.position.x=side*(wheelWidth/2+.045);hub.rotation.z=Math.PI/2;register(hub,metal,wheel);
    if(rally||pickup||buggy||van)for(let i=0;i<12;i++){
      const a=i*Math.PI/6, tread=box('offroad-tread',wheelWidth*.90,.028,wheelRadius*.22,0,Math.cos(a)*(wheelRadius-.005),Math.sin(a)*(wheelRadius-.005),dark,wheel);tread.rotation.x=a;
    }
    const arch=conceptArch(scene,'open-fender-arch',wheelRadius+.025,wheelRadius+.105,wheelWidth*.65);arch.position.set(side*(wheelX-.025),wheelRadius+.025,z);register(arch,dark,chassis,true);
  }
  // Yaw uses the returned node; pitch is isolated in the named child pivot.
  turret.position.set(0,roofY+.09,pickup?.04:(frontTop+rearTop)*.5);
  if (kind === 'player') {
    const ring = MeshBuilder.CreateCylinder('turret-ring', { diameter: .53, height: .11, tessellation: 12 }, scene);
    ring.position.y = 0.025; register(ring, dark, turret);
    box('turret-armor', .48, .23, .54, 0, .17, -.025, paint, turret);
    const elevation = new TransformNode('turret-elevation', scene); elevation.parent = turret; elevation.position.set(0, 0.18, 0.23);
    box('turret-mantlet', 0.29, 0.23, 0.22, 0, 0, 0.04, metal, elevation);
    const barrel = MeshBuilder.CreateCylinder('turret-barrel', { diameter: 0.12, height: 1.12, tessellation: 8 }, scene);
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0, 0.63); register(barrel, dark, elevation);
    box('turret-top-rail', 0.065, 0.05, 0.7, 0, 0.075, 0.53, metal, elevation);
    box('muzzle-brake', 0.19, 0.17, 0.18, 0, 0, 1.21, dark, elevation);
    box('muzzle-opening', 0.1, 0.085, 0.012, 0, 0, 1.307, black, elevation);
    turret.setEnabled(false);
  } else if (kind === 'police') {
    if(!apc)box('black-hood', w * 0.72, 0.013, hoodDepth * 0.9, 0, 0.058, 0, black, hood);
    box('lightbar-base',topW*1.75,.08,.24,0,roofY+.09,cabinCenter,dark);
    box('red-lightbar',topW*.73,.13,.19,-topW*.46,roofY+.185,cabinCenter,red);
    box('blue-lightbar',topW*.73,.13,.19,topW*.46,roofY+.185,cabinCenter,blue);
    if(!apc&&(role==='swat'||role==='suv'||role==='patrol')){
      for(const side of [-1,1]){box('police-pushbar-upright',.08,.36,.08,side*bodyWidth*.32,.13,.17,metal,frontBumper);}
      box('police-pushbar-cross',bodyWidth*.67,.07,.08,0,.30,.17,metal,frontBumper);
    }
    const glyphs: Record<string, string[]> = { P: ['110', '101', '110', '100', '100'], O: ['111', '101', '101', '101', '111'], L: ['100', '100', '100', '100', '111'], I: ['111', '010', '010', '010', '111'], C: ['111', '100', '100', '100', '111'], E: ['111', '100', '110', '100', '111'] };
    const unit = w * 0.026;
    for (let letter=0;letter<6;letter++){const rows=glyphs['POLICE'[letter]];for(let r=0;r<rows.length;r++)for(let c=0;c<rows[r].length;c++)if(rows[r][c]==='1')box('police-label-pixel',unit*.9,.008,unit*.9,(letter*4+c-11)*unit,roofY+.053,frontTop-.20-r*unit,role==='swat'?exposed:black);}
    for(const side of [-1,1])box('police-radio-whip',.025,.48,.025,side*bodyWidth*.28,roofY+.28,rearTop+.08,dark);
  }
  let body: Mesh | undefined;
  for (const [mat, meshes] of batches) {
    const merged = meshes.length === 1 ? meshes[0] : Mesh.MergeMeshes(meshes, true, true, undefined, false, false);
    if (!merged) continue;
    merged.name = `vehicle-${mat.name}`; merged.parent = chassis; merged.material = mat; merged.isPickable = false;
    if (mat === paint) body = merged;
  }
  if (!body) throw new Error('Could not build vehicle chassis');

  // Merge trim within each removable part without combining different damage states.
  function batchAttachedChildren(parent: TransformNode): void {
    const children = parent.getChildren(undefined, true);
    for (const child of children) if (child instanceof TransformNode) batchAttachedChildren(child);
    const groups = new Map<string, Mesh[]>();
    for (const child of children) {
      if (!(child instanceof Mesh) || child.isDisposed() || child.getChildren().length || !child.material) continue;
      const key = `${child.material.uniqueId}-${child.isEnabled(false)}`;
      const group = groups.get(key) ?? []; group.push(child); groups.set(key, group);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      parent.computeWorldMatrix(true);
      const inverseParent = parent.getWorldMatrix().clone().invert();
      const enabled = group[0].isEnabled(false), mat = group[0].material;
      const merged = Mesh.MergeMeshes(group, true, true, undefined, false, false);
      if (!merged) continue;
      merged.parent = null;
      merged.bakeTransformIntoVertices(inverseParent);
      merged.position.setAll(0); merged.rotation.setAll(0); merged.rotationQuaternion = null; merged.scaling.setAll(1);
      merged.parent = parent; merged.material = mat; merged.name = `attached-${mat?.name}`;
      merged.isPickable = false; merged.setEnabled(enabled);
      for (const tracked of [scratches, cracks]) {
        let replaced = false;
        for (const source of group) { const index = tracked.indexOf(source); if (index >= 0) { tracked.splice(index, 1); replaced = true; } }
        if (replaced) tracked.push(merged);
      }
    }
  }
  for (const part of [hood,trunk,frontBumper,rearBumper,windshield,...doors,turret,...wheels]) batchAttachedChildren(part);
  const originalMeshes = root.getChildMeshes().filter(mesh => mesh instanceof Mesh) as Mesh[];
  const shadow = (scene.metadata as { shadowGenerator?: ShadowGenerator } | null)?.shadowGenerator;
  const silhouetteCasters = originalMeshes.filter(mesh => mesh === body || mesh.name.startsWith('detachable-'));

  function showFull(): void {
    if (!compactShown) return;
    compactShown = false;
    compactMesh?.setEnabled(false);
    if (compactMesh) shadow?.removeShadowCaster(compactMesh);
    chassis.setEnabled(true);
    for (const frame of wheelFrames) frame.setEnabled(true);
    for (const mesh of silhouetteCasters) if (mesh.isEnabled()) shadow?.addShadowCaster(mesh, false);
  }
  function invalidateCompact(): void {
    showFull();
    if (compactMesh) { shadow?.removeShadowCaster(compactMesh); compactMesh.dispose(false, false); compactMesh = undefined; }
  }
  function visibleOriginal(mesh: Mesh): boolean {
    if (mesh.isDisposed() || !mesh.isVisible || mesh.visibility <= 0) return false;
    let node: TransformNode | null = mesh;
    while (node && node !== root) { if (!node.isEnabled(false)) return false; node = node.parent instanceof TransformNode ? node.parent : null; }
    return true;
  }
  function showCompact(): void {
    if (!compactRequested || disposed || compactShown) return;
    if (!compactMesh) {
      showFull(); root.computeWorldMatrix(true); chassis.computeWorldMatrix(true);
      const inverseRoot = root.getWorldMatrix().clone().invert(), parts: VertexData[] = [];
      for (const source of originalMeshes) {
        if (!visibleOriginal(source)) continue;
        source.computeWorldMatrix(true);
        const data = VertexData.ExtractFromMesh(source, false, true);
        data.transform(source.getWorldMatrix().multiply(inverseRoot));
        const mat = source.material instanceof StandardMaterial ? source.material : paint;
        const count = source.getTotalVertices(), colors = new Float32Array(count * 4);
        for (let i = 0; i < count; i++) { colors[i * 4] = mat.diffuseColor.r; colors[i * 4 + 1] = mat.diffuseColor.g; colors[i * 4 + 2] = mat.diffuseColor.b; colors[i * 4 + 3] = mat.alpha * source.visibility; }
        data.colors = colors; parts.push(data);
      }
      if (!parts.length) return;
      const geometry = parts[0]; geometry.merge(parts.slice(1), true, false, false, true);
      compactMesh = new Mesh(`compact-vehicle-${spec.id}`, scene); geometry.applyToMesh(compactMesh);
      compactMesh.parent = root; compactMesh.material = compactMaterial(scene);
      compactMesh.isPickable = false; compactMesh.receiveShadows = true;
      compactMesh.metadata = { compactVehicle: true };
    }
    chassis.setEnabled(false);
    for (const frame of wheelFrames) frame.setEnabled(false);
    for (const mesh of originalMeshes) shadow?.removeShadowCaster(mesh);
    compactMesh.setEnabled(true); shadow?.addShadowCaster(compactMesh); compactShown = true;
  }

  function detach(source: Mesh, allowDisabled = false): void {
    if (!allowDisabled && !source.isEnabled(false)) return;
    root.computeWorldMatrix(true); chassis.computeWorldMatrix(true); source.computeWorldMatrix(true);
    const world = source.getWorldMatrix().clone();
    const localCenter = source.getBoundingInfo().boundingBox.center.clone();
    const sourceMeshes = [source, ...source.getChildMeshes()];
    const sourceTransforms = sourceMeshes.map(mesh => { mesh.computeWorldMatrix(true); return mesh.getWorldMatrix().clone(); });
    const debris = source.clone(`debris-${source.name}`, null, false, false);
    debris.parent = null;
    debris.rotationQuaternion = new Quaternion();
    world.decompose(undefined, debris.rotationQuaternion);
    debris.scaling.setAll(1);
    debris.position.copyFrom(Vector3.TransformCoordinates(localCenter, world));
    debris.rotation.setAll(0);
    // Bake scale/shear into unique geometry. Every world vertex stays exact even
    // when the physics parent is scaled and the chassis is simultaneously leaning.
    const inverseDebrisWorld = Matrix.Compose(Vector3.One(), debris.rotationQuaternion, debris.position).invert();
    const cloneMeshes = [debris, ...debris.getChildMeshes()] as Mesh[];
    const ownedMaterials: StandardMaterial[] = [];
    for (let i = 0; i < cloneMeshes.length; i++) {
      const mesh = cloneMeshes[i];
      mesh.makeGeometryUnique();
      mesh.bakeTransformIntoVertices(sourceTransforms[i].multiply(inverseDebrisWorld));
      if (i > 0) { mesh.parent = debris; mesh.position.setAll(0); mesh.rotation.setAll(0); mesh.rotationQuaternion = null; mesh.scaling.setAll(1); }
      if (mesh.material instanceof StandardMaterial) { const own = mesh.material.clone(`debris-${mesh.material.name}`); mesh.material = own; ownedMaterials.push(own); }
      mesh.isPickable = false;
    }
    debris.setEnabled(true); debris.metadata = { vehicleDebris: true, panel: source.name };
    debris.onDisposeObservable.addOnce(() => { for (const mat of ownedMaterials) mat.dispose(); });
    debris.computeWorldMatrix(true); debrisQueue.push(debris); source.setEnabled(false);
  }
  function restore(): void {
    stage = 0;
    for (const p of panels) { p.mesh.position.copyFrom(p.position); p.mesh.rotation.copyFrom(p.rotation); p.mesh.scaling.copyFrom(p.scaling); p.mesh.setEnabled(true); }
    for (const mesh of scratches) mesh.setEnabled(false);
    for (const mesh of cracks) mesh.setEnabled(false);
    for (const mesh of shards) mesh.setEnabled(false);
    if(buggy||convertible||apc)rearWindow.setEnabled(false);
    paint.diffuseColor.copyFrom(baseColor);
  }
  return {
    root, chassis, body, turret, wheels, exhausts,
    setTurretEnabled(enabled: boolean): void {
      const next=kind==='player'&&enabled;if(next===turretEnabled)return;
      invalidateCompact();turretEnabled=next;turret.setEnabled(next);showCompact();
    },
    setColor(hex: string): void { invalidateCompact(); baseColor = Color3.FromHexString(hex); if (stage < 4) paint.diffuseColor.copyFrom(baseColor); else Color3.LerpToRef(baseColor, charredColor, 0.88, paint.diffuseColor); showCompact(); },
    setCompact(enabled: boolean): void { if (compactRequested === enabled) return; compactRequested = enabled; if (enabled) showCompact(); else showFull(); },
    setDamage(healthRatio: number, tiresRatio: number): void {
      if (disposed) return;
      const nextHealth = Math.max(0, Math.min(1, healthRatio)), nextTires = Math.max(0, Math.min(1, tiresRatio));
      const upcomingStage = nextHealth <= .25 ? 4 : nextHealth <= .45 ? 3 : nextHealth <= .65 ? 2 : nextHealth <= .85 ? 1 : 0;
      const changed = upcomingStage > stage || nextTires !== tires || nextHealth >= .985 && stage > 0;
      if (changed) invalidateCompact();
      health = nextHealth; tires = nextTires;
      if (health >= 0.985 && stage > 0) restore();
      const nextStage = health <= 0.25 ? 4 : health <= 0.45 ? 3 : health <= 0.65 ? 2 : health <= 0.85 ? 1 : 0;
      if (stage < 1 && nextStage >= 1) { for (const mesh of scratches) mesh.setEnabled(true); for (const mesh of cracks) mesh.setEnabled(true); }
      if (stage < 2 && nextStage >= 2) {
        hood.rotation.set(-0.14, 0.045, 0.1); hood.scaling.set(0.94, 1, 0.85); hood.position.y += 0.045;
        frontBumper.rotation.z = 0.12; frontBumper.position.z -= 0.1;
        doors[0].rotation.z = -0.1; trunk.rotation.z = -0.055;
        windshield.setEnabled(false); for (const shard of shards) detach(shard, true);
      }
      if (stage < 3 && nextStage >= 3) { detach(doors[0]); detach(frontBumper); }
      if (stage < 4 && nextStage >= 4) { detach(hood); detach(doors[1]); detach(trunk); detach(rearBumper); detach(rearWindow); Color3.LerpToRef(baseColor, charredColor, 0.88, paint.diffuseColor); }
      stage = Math.max(stage, nextStage);
      const tireDamage = 1 - Math.max(0, Math.min(1, tiresRatio));
      for (let i = 0; i < wheelFrames.length; i++) { const severity = Math.max(0, Math.min(1, (tireDamage - i * 0.12) * 1.6)); wheelFrames[i].scaling.y = 1 - severity * 0.4; wheelFrames[i].position.y = wheelHeights[i] - severity * wheelRadius * 0.3; }
      showCompact();
    },
    popDebris(): Mesh[] { if (!debrisQueue.length) return emptyDebris; const result = debrisQueue; debrisQueue = []; return result; },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (compactMesh) shadow?.removeShadowCaster(compactMesh);
      for (const mesh of debrisQueue) mesh.dispose(false, false);
      debrisQueue = []; root.dispose(false, false);
      for (const mat of materials) mat.dispose();
    },
  };
}
