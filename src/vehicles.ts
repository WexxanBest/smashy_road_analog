import { Color3, Matrix, Mesh, MeshBuilder, Quaternion, Scene, StandardMaterial, TransformNode, Vector3, VertexData } from '@babylonjs/core';
import type { ShadowGenerator } from '@babylonjs/core';
import type { CarSpec, VehicleVisual } from './types';

type Point = [number, number, number];
type Panel = { mesh: Mesh; position: Vector3; rotation: Vector3; scaling: Vector3 };
const compactMaterials = new WeakMap<Scene, StandardMaterial>();
function compactMaterial(scene: Scene): StandardMaterial {
  let mat = compactMaterials.get(scene);
  if (!mat) {
    mat = new StandardMaterial('shared-compact-vehicle-colors', scene);
    mat.diffuseColor = Color3.White(); mat.specularColor = new Color3(0.12, 0.13, 0.12);
    mat.backFaceCulling = false; compactMaterials.set(scene, mat);
  }
  return mat;
}

/** Static trim is batched; removable panels retain independent geometry and pivots. */
export function createVehicle(scene: Scene, spec: CarSpec, color: string, kind: 'player' | 'police' | 'traffic' = 'player'): VehicleVisual {
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
  const pickup = spec.id === 'brute', rally = spec.id === 'rally';
  const chassisY = rally || pickup ? 0.82 : 0.72;
  const roofY = pickup ? 1.72 : rally ? 1.66 : 1.48;
  let stage = 0, disposed = false;
  let health = 1, tires = 1, compactRequested = false, compactShown = false;
  let compactMesh: Mesh | undefined;
  let baseColor = Color3.FromHexString(kind === 'police' ? '#e7e9e2' : color);
  const charredColor = Color3.FromHexString('#343834');

  function material(name: string, hex: string, glow = 0): StandardMaterial {
    const mat = new StandardMaterial(name, scene);
    mat.diffuseColor = Color3.FromHexString(hex);
    mat.specularColor = new Color3(0.08, 0.09, 0.1);
    mat.specularPower = 24;
    if (glow) mat.emissiveColor = mat.diffuseColor.scale(glow);
    materials.push(mat);
    return mat;
  }
  const paint = material('body-paint', kind === 'police' ? '#e7e9e2' : color);
  paint.specularColor = new Color3(0.24, 0.24, 0.2);
  const dark = material('rubber-trim', '#222b2f');
  const metal = material('wheel-metal', '#a4b5b9');
  const black = material('police-panels', '#25323a');
  const glass = material('opaque-blue-glass', '#345968');
  glass.specularColor = new Color3(0.3, 0.4, 0.42);
  const lights = material('warm-headlights', '#fff1bf', 0.5);
  const tail = material('tail-lights', '#d95247', 0.35);
  const exposed = material('exposed-damaged-metal', '#c2c2aa');
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
    const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, scene);
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
    VertexData.ComputeNormals(positions, indices, normals);
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

  // A low sill, separate fenders and a dark floor create real openings after panel loss.
  const halfW = w * 0.47, halfL = l * 0.48, corner = 0.2;
  const outline = [[-halfW + corner, halfL], [halfW - corner, halfL], [halfW, halfL - corner], [halfW, -halfL + corner], [halfW - corner, -halfL], [-halfW + corner, -halfL], [-halfW, -halfL + corner], [-halfW, halfL - corner]];
  const lower: Point[] = outline.map(([x, z]) => [x * 0.95, chassisY - 0.25, z]);
  const upper: Point[] = outline.map(([x, z]) => [x, chassisY - 0.015, z * 0.98]);
  const bodyFaces: Point[][] = [lower.slice().reverse(), upper];
  for (let i = 0; i < outline.length; i++) { const j = (i + 1) % outline.length; bodyFaces.push([lower[i], lower[j], upper[j], upper[i]]); }
  poly('chamfered-sill-body', bodyFaces, paint, chassis, true);
  box('underbody', w * 0.78, 0.15, l * 0.87, 0, chassisY - 0.27, 0, dark);
  box('interior-floor', w * 0.77, 0.055, l * 0.88, 0, chassisY + 0.025, 0, dark);
  const cabinCenter = pickup ? 0.18 : -0.19;
  const frontBottom = cabinCenter + (pickup ? 0.75 : 0.84), rearBottom = cabinCenter - (pickup ? 0.67 : 0.86);
  const frontTop = cabinCenter + 0.43, rearTop = cabinCenter - 0.57;
  const cabinBottom = chassisY + 0.2, baseW = w * 0.43, topW = w * 0.355;
  const hoodDepth = l * 0.47 - frontBottom, hoodCenter = frontBottom + hoodDepth * 0.5;
  const hood = panel(box('detachable-hood', w * 0.76, 0.1, hoodDepth, 0, chassisY + 0.24, hoodCenter, paint, chassis, false));
  const trunkDepth = Math.max(0.45, rearBottom + l * 0.47), trunkCenter = rearBottom - trunkDepth * 0.5;
  const trunk = panel(box(pickup ? 'detachable-pickup-tailgate' : 'detachable-trunk', w * 0.78, pickup ? 0.2 : 0.11, pickup ? 0.15 : trunkDepth, 0, chassisY + (pickup ? 0.3 : 0.23), pickup ? -l * 0.45 : trunkCenter, paint, chassis, false));
  const frontBumper = panel(box('detachable-front-bumper', w * 0.94, pickup ? 0.23 : 0.18, 0.2, 0, chassisY - 0.08, l * 0.49, dark, chassis, false));
  const rearBumper = panel(box('detachable-rear-bumper', w * 0.89, 0.16, 0.17, 0, chassisY - 0.1, -l * 0.49, dark, chassis, false));
  box('front-grille', w * 0.36, 0.17, 0.035, 0, chassisY + 0.06, l * 0.482, dark);
  box('grille-bar', w * 0.31, 0.026, 0.045, 0, chassisY + 0.06, l * 0.489, metal);
  for (const side of [-1, 1]) {
    box('front-fender', w * 0.115, 0.41, hoodDepth + 0.1, side * w * 0.415, chassisY + 0.025, hoodCenter, paint);
    box('rear-fender', w * 0.115, 0.41, trunkDepth + 0.13, side * w * 0.415, chassisY + 0.025, trunkCenter, paint);
    box('headlight', w * 0.18, 0.14, 0.045, side * w * 0.33, chassisY + 0.1, l * 0.482, lights);
    box('tail-light', w * 0.12, 0.13, 0.04, side * w * 0.35, chassisY + 0.08, -l * 0.483, tail);
    box('side-sill', 0.09, 0.09, l * 0.48, side * w * 0.46, chassisY - 0.23, 0, dark);
    box('bucket-seat', 0.42, 0.17, 0.52, side * w * 0.19, chassisY + 0.14, cabinCenter - 0.13, seats);
    box('seat-back', 0.43, 0.39, 0.13, side * w * 0.19, chassisY + 0.3, cabinCenter - 0.4, seats);
  }
  box('engine-block', w * 0.43, 0.21, hoodDepth * 0.71, 0, chassisY + 0.11, hoodCenter, metal);
  for (const side of [-1, 1]) {
    box('engine-cylinder-bank', 0.12, 0.08, hoodDepth * 0.62, side * w * 0.14, chassisY + 0.19, hoodCenter, dark);
    box('engine-red-cable', 0.04, 0.025, hoodDepth * 0.6, side * w * 0.09, chassisY + 0.22, hoodCenter, tail);
  }
  box('cabin-roof', topW * 2 + 0.08, 0.095, frontTop - rearTop + 0.08, 0, roofY, (frontTop + rearTop) * 0.5, paint);
  for (const side of [-1, 1]) {
    segment('front-cabin-pillar', [side * baseW, cabinBottom, frontBottom], [side * topW, roofY, frontTop], 0.085, paint, chassis, true);
    segment('rear-cabin-pillar', [side * baseW, cabinBottom, rearBottom], [side * topW, roofY, rearTop], 0.085, paint, chassis, true);
    segment('center-cabin-pillar', [side * baseW, cabinBottom, cabinCenter - 0.08], [side * topW, roofY, cabinCenter - 0.08], 0.065, paint, chassis, true);
  }
  const lowY = cabinBottom + 0.08, highY = roofY - 0.075;
  const lo = (lowY - cabinBottom) / (roofY - cabinBottom), hi = (highY - cabinBottom) / (roofY - cabinBottom);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const lowW = lerp(baseW, topW, lo), highW = lerp(baseW, topW, hi);
  const lowFront = lerp(frontBottom, frontTop, lo), highFront = lerp(frontBottom, frontTop, hi);
  const lowRear = lerp(rearBottom, rearTop, lo), highRear = lerp(rearBottom, rearTop, hi);
  const frontPoints: Point[] = [[-lowW + 0.06, lowY, lowFront + 0.012], [lowW - 0.06, lowY, lowFront + 0.012], [highW - 0.05, highY, highFront + 0.012], [-highW + 0.05, highY, highFront + 0.012]];
  const windshield = panel(poly('windscreen', [frontPoints], glass));
  const rearWindow = panel(poly('rear-window', [[[-lowW + 0.08, lowY, lowRear - 0.012], [-highW + 0.06, highY, highRear - 0.012], [highW - 0.06, highY, highRear - 0.012], [lowW - 0.08, lowY, lowRear - 0.012]]], glass));
  const center: Point = [0.12, lerp(lowY, highY, 0.52), lerp(lowFront, highFront, 0.52) + 0.025];
  for (const end of frontPoints) {
    const crack = segment('windscreen-crack', center, [lerp(center[0], end[0], 0.86), lerp(center[1], end[1], 0.86), lerp(center[2], end[2], 0.86) + 0.02], 0.018, crackMat, windshield);
    crack.setEnabled(false); cracks.push(crack);
  }
  const shardPoints: Point[][] = [[frontPoints[0], frontPoints[1], center], [frontPoints[1], frontPoints[2], center], [frontPoints[2], frontPoints[3], center]];
  for (const points of shardPoints) { const shard = poly('windscreen-shard', [points], glass); shard.setEnabled(false); shards.push(shard); }

  const doors: Mesh[] = [];
  for (const side of [-1, 1]) {
    const door = panel(box(side < 0 ? 'detachable-left-door' : 'detachable-right-door', 0.095, 0.43, frontBottom - rearBottom - 0.08, side * w * 0.451, chassisY + 0.01, cabinCenter, paint, chassis, false));
    doors.push(door);
    const split = cabinCenter - 0.08;
    const glassFaces: Point[][] = [
      [[side * (lowW + 0.014), lowY, lowFront - 0.07], [side * (lowW + 0.014), lowY, split + 0.045], [side * (highW + 0.014), highY, split + 0.045], [side * (highW + 0.014), highY, highFront - 0.06]],
      [[side * (lowW + 0.014), lowY, split - 0.045], [side * (lowW + 0.014), lowY, lowRear + 0.07], [side * (highW + 0.014), highY, highRear + 0.06], [side * (highW + 0.014), highY, split - 0.045]],
    ];
    const pane = poly('door-glass-panes', glassFaces, glass, door);
    pane.position.copyFrom(door.position).negateInPlace();
    const crackFrom: Point = [side * (lerp(lowW, highW, 0.5) + 0.027), lerp(lowY, highY, 0.5), cabinCenter + 0.22];
    for (const z of [lowFront - 0.17, split + 0.12]) {
      const crack = segment('side-glass-crack', crackFrom, [side * (highW + 0.028), highY - 0.025, z], 0.018, crackMat, pane);
      crack.setEnabled(false); cracks.push(crack);
    }
    box('door-handle', 0.03, 0.045, 0.17, side * 0.06, 0.12, -0.21, metal, door);
    box('mirror-arm', 0.19, 0.055, 0.07, side * 0.11, 0.34, frontBottom - cabinCenter - 0.15, dark, door);
    box('mirror', 0.13, 0.13, 0.22, side * 0.22, 0.35, frontBottom - cabinCenter - 0.15, dark, door);
    if (kind === 'police') box('police-door-band', 0.018, 0.16, 1.1, side * 0.056, 0.01, 0, black, door);
    scratch('broad-door-scrape', [side * 0.06, -0.08, -0.61], [side * 0.06, 0.12, 0.57], door, 0.06);
    scratch('lower-door-scrape', [side * 0.064, -0.14, -0.43], [side * 0.064, -0.015, 0.63], door, 0.035);
    scratch('dark-door-gouge', [side * 0.064, -0.015, -0.56], [side * 0.064, 0.19, 0.48], door, 0.035, dark);
  }
  scratch('bonnet-long-scrape', [-w * 0.25, 0.058, -hoodDepth * 0.33], [w * 0.25, 0.058, hoodDepth * 0.3], hood, 0.045);
  scratch('bonnet-short-scrape', [-w * 0.14, 0.06, -hoodDepth * 0.4], [w * 0.3, 0.06, hoodDepth * 0.07], hood, 0.03);
  if (pickup) {
    box('bed-floor', w * 0.69, 0.045, trunkDepth, 0, chassisY + 0.075, trunkCenter, dark);
    for (const side of [-1, 1]) {
      box('bed-rail', 0.14, 0.21, trunkDepth, side * w * 0.405, chassisY + 0.31, trunkCenter, paint);
      box('bed-rail-cap', 0.16, 0.045, trunkDepth, side * w * 0.405, chassisY + 0.43, trunkCenter, dark);
      box('bullbar-leg', 0.09, 0.34, 0.1, side * w * 0.31, 0.08, 0.13, metal, frontBumper);
    }
    box('bullbar-cross', w * 0.68, 0.09, 0.1, 0, 0.22, 0.13, metal, frontBumper);
    box('hood-power-bulge', 0.81, 0.09, hoodDepth * 0.7, 0, 0.09, 0, paint, hood);
    box('hood-intake', 0.5, 0.08, 0.1, 0, 0.1, hoodDepth * 0.33, dark, hood);
  } else if (rally) {
    box('rally-hood-stripe', w * 0.38, 0.014, hoodDepth * 0.85, 0, 0.058, 0, dark, hood);
    box('rally-roof-vent', 0.38, 0.1, 0.34, 0, roofY + 0.1, -0.45, dark);
    for (const side of [-1, 1]) {
      box('rally-fender-front', 0.15, 0.13, 0.92, side * w * 0.46, chassisY + 0.04, l * 0.3, dark);
      box('rally-fender-rear', 0.15, 0.13, 0.92, side * w * 0.46, chassisY + 0.04, -l * 0.3, dark);
      box('rally-lamp', 0.23, 0.19, 0.1, side * 0.27, 0.27, 0.03, lights, frontBumper);
    }
    box('rally-spoiler', w * 0.75, 0.065, 0.24, 0, 0.22, -trunkDepth * 0.32, dark, trunk);
  } else {
    for (const side of [-1, 1]) {
      box('hood-stripe', 0.12, 0.012, hoodDepth * 0.91, side * 0.17, 0.057, 0, kind === 'police' ? black : dark, hood);
      box('spoiler-stay', 0.055, 0.13, 0.07, side * 0.49, 0.1, -trunkDepth * 0.28, dark, trunk);
    }
    box('rear-spoiler', w * 0.79, 0.06, 0.24, 0, 0.18, -trunkDepth * 0.28, paint, trunk);
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
  const wheelRadius = pickup ? 0.46 : rally ? 0.44 : 0.39, axle = l * (pickup ? 0.32 : 0.305);
  for (const z of [axle, -axle]) for (const side of [-1, 1]) {
    const frame = new TransformNode('wheel-frame', scene); frame.parent = root; frame.position.set(side * w * 0.475, wheelRadius + 0.035, z);
    const wheel = new TransformNode('wheel', scene); wheel.parent = frame;
    wheels.push(wheel); wheelFrames.push(frame); wheelHeights.push(frame.position.y);
    const tire = MeshBuilder.CreateCylinder('low-poly-tire', { diameter: wheelRadius * 2, height: pickup ? 0.34 : 0.27, tessellation: 12 }, scene);
    tire.rotation.z = Math.PI / 2; register(tire, dark, wheel);
    const rim = MeshBuilder.CreateCylinder('alloy-wheel', { diameter: wheelRadius * 1.12, height: pickup ? 0.35 : 0.28, tessellation: 8 }, scene);
    rim.rotation.z = Math.PI / 2; register(rim, metal, wheel);
    const hub = MeshBuilder.CreateCylinder('wheel-hub', { diameter: wheelRadius * 0.43, height: 0.025, tessellation: 6 }, scene);
    hub.position.x = side * (pickup ? 0.19 : 0.155); hub.rotation.z = Math.PI / 2; register(hub, dark, wheel);
  }
  // Yaw uses the returned node; pitch is isolated in the named child pivot.
  turret.position.set(0, roofY + 0.09, pickup ? 0.04 : -0.16);
  if (kind === 'player') {
    const ring = MeshBuilder.CreateCylinder('turret-ring', { diameter: 0.75, height: 0.14, tessellation: 10 }, scene);
    ring.position.y = 0.025; register(ring, dark, turret);
    box('turret-armor', 0.57, 0.26, 0.62, 0, 0.16, -0.03, paint, turret);
    const elevation = new TransformNode('turret-elevation', scene); elevation.parent = turret; elevation.position.set(0, 0.18, 0.23);
    box('turret-mantlet', 0.29, 0.23, 0.22, 0, 0, 0.04, metal, elevation);
    const barrel = MeshBuilder.CreateCylinder('turret-barrel', { diameter: 0.12, height: 1.12, tessellation: 8 }, scene);
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0, 0.63); register(barrel, dark, elevation);
    box('turret-top-rail', 0.065, 0.05, 0.7, 0, 0.075, 0.53, metal, elevation);
    box('muzzle-brake', 0.19, 0.17, 0.18, 0, 0, 1.21, dark, elevation);
    box('muzzle-opening', 0.1, 0.085, 0.012, 0, 0, 1.307, black, elevation);
  } else if (kind === 'police') {
    box('black-hood', w * 0.72, 0.013, hoodDepth * 0.9, 0, 0.058, 0, black, hood);
    box('lightbar-base', w * 0.7, 0.08, 0.24, 0, roofY + 0.09, -0.21, dark);
    box('red-lightbar', w * 0.3, 0.13, 0.19, -w * 0.18, roofY + 0.185, -0.21, red);
    box('blue-lightbar', w * 0.3, 0.13, 0.19, w * 0.18, roofY + 0.185, -0.21, blue);
    const glyphs: Record<string, string[]> = { P: ['110', '101', '110', '100', '100'], O: ['111', '101', '101', '101', '111'], L: ['100', '100', '100', '100', '111'], I: ['111', '010', '010', '010', '111'], C: ['111', '100', '100', '100', '111'], E: ['111', '100', '110', '100', '111'] };
    const unit = w * 0.026;
    for (let letter = 0; letter < 6; letter++) { const rows = glyphs['POLICE'[letter]]; for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++) if (rows[r][c] === '1') box('police-label-pixel', unit * 0.9, 0.008, unit * 0.9, (letter * 4 + c - 11) * unit, roofY + 0.053, 0.15 - r * unit, black); }
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
  for (const part of [hood, trunk, frontBumper, rearBumper, windshield, ...doors, turret]) batchAttachedChildren(part);
  const originalMeshes = root.getChildMeshes().filter(mesh => mesh instanceof Mesh) as Mesh[];
  const shadow = (scene.metadata as { shadowGenerator?: ShadowGenerator } | null)?.shadowGenerator;

  function showFull(): void {
    if (!compactShown) return;
    compactShown = false;
    compactMesh?.setEnabled(false);
    if (compactMesh) shadow?.removeShadowCaster(compactMesh);
    chassis.setEnabled(true);
    for (const frame of wheelFrames) frame.setEnabled(true);
    for (const mesh of originalMeshes) shadow?.addShadowCaster(mesh);
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
    if (!compactRequested || health <= .85 || stage > 0 || disposed) return;
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
    paint.diffuseColor.copyFrom(baseColor);
  }
  return {
    root, chassis, body, turret, wheels, exhausts,
    setColor(hex: string): void { invalidateCompact(); baseColor = Color3.FromHexString(hex); if (stage < 4) paint.diffuseColor.copyFrom(baseColor); else Color3.LerpToRef(baseColor, charredColor, 0.88, paint.diffuseColor); showCompact(); },
    setCompact(enabled: boolean): void { compactRequested = enabled; if (enabled) showCompact(); else invalidateCompact(); },
    setDamage(healthRatio: number, tiresRatio: number): void {
      if (disposed) return;
      const nextHealth = Math.max(0, Math.min(1, healthRatio)), nextTires = Math.max(0, Math.min(1, tiresRatio));
      if (nextHealth <= .85 || nextTires !== tires || nextHealth >= .985 && stage > 0) invalidateCompact();
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
