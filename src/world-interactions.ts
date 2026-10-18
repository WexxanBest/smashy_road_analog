import { Color3, Matrix, Mesh, MeshBuilder, Ray, Scene, StandardMaterial, TransformNode, Vector3, VertexBuffer, type ShadowGenerator } from '@babylonjs/core';
import type { WorldProp } from './types';

type Interaction = 'movable' | 'breakable' | 'facade' | 'solid' | 'explosive';
type Prop = WorldProp & { id?: string; kind?: string; height?: number; mass?: number; interaction?: Interaction };
type SavedProp = { hp: number; destroyed: boolean; dx: number; dz: number; yaw: number };
type Runtime = {
  prop: Prop; state: SavedProp; originX: number; originZ: number; maxHp: number;
  colors: { mesh: Mesh; original: Float32Array }[]; remains?: Mesh;
  jet?: Mesh;
  velocity: Vector3; wobble: number; fade: number; blockedUntil: number;
  fadeMaterials: StandardMaterial[]; rotor?: TransformNode;
  group?: string;
};
type Fragment = { mesh: Mesh; velocity: Vector3; spin: Vector3; life: number };
export interface PropOptions { kind?: string; interaction?: Interaction; height?: number; mass?: number; width?: number; depth?: number; angle?: number; group?: string; }

/** Object state outlives streamed geometry. Only nearby moving debris receives updates. */
export function createWorldInteractions(scene: Scene, shadow?: ShadowGenerator) {
  const saved = new Map<string, SavedProp>();
  const active = new Map<WorldProp, Runtime>();
  const fragments: Fragment[] = [];
  const rubbleMaterial = new StandardMaterial('world-rubble', scene);
  rubbleMaterial.diffuseColor = Color3.FromHexString('#8c806b');
  rubbleMaterial.specularColor = Color3.Black();
  const waterMaterial = new StandardMaterial('broken-hydrant-water', scene);
  waterMaterial.diffuseColor = Color3.FromHexString('#a2d6db'); waterMaterial.emissiveColor = Color3.FromHexString('#497f88'); waterMaterial.alpha = .72;
  const flashMaterial = new StandardMaterial('world-explosion', scene);
  flashMaterial.diffuseColor = Color3.FromHexString('#ff8f36');
  flashMaterial.emissiveColor = Color3.FromHexString('#ffad3b');
  const flashes: { mesh: Mesh; life: number }[] = [];
  let clock = 0, nextOcclusion = 0;
  let explosionHandler: ((at: Vector3, damage: number) => void) | undefined;

  function rubble(runtime: Runtime): void {
    if (runtime.remains) return;
    const p = runtime.prop, pieces: Mesh[] = [];
    // One low static batch remains after destruction, including after a chunk reload.
    const spread = Math.min(4.5, Math.max(.55, p.radius * .7));
    const count = p.kind === 'small-building' ? 8 : 5;
    for (let i = 0; i < count; i++) {
      const mesh = MeshBuilder.CreateBox('rubble-piece', { width: .25 + spread * .25, height: .15 + (i % 3) * .12, depth: .3 + spread * .2 }, scene);
      mesh.position.set(p.x + Math.sin(i * 2.4) * spread, .12 + (i % 3) * .055, p.z + Math.cos(i * 2.4) * spread);
      mesh.rotation.set(i * .17, i * 1.3, i * .13); pieces.push(mesh);
    }
    const mesh = Mesh.MergeMeshes(pieces, true, true)!;
    mesh.name = 'remains-' + p.id; mesh.material = rubbleMaterial;
    mesh.isPickable = false; mesh.receiveShadows = true; mesh.freezeWorldMatrix();
    runtime.remains = mesh;
    if(p.kind==='hydrant') {
      const jet=MeshBuilder.CreateCylinder('hydrant-water-jet',{height:3.4,diameterBottom:.18,diameterTop:.7,tessellation:7},scene);
      jet.position.set(p.x,1.9,p.z);jet.material=waterMaterial;jet.isPickable=false;runtime.jet=jet;
    }
  }
  function paintDamage(runtime: Runtime): void {
    const amount = runtime.prop.interaction === 'solid' ? Math.min(.38, (1 - runtime.state.hp / runtime.maxHp) * .5) : Math.min(.65, (1 - runtime.state.hp / runtime.maxHp) * .7);
    for (const { mesh, original } of runtime.colors) {
      const values = original.slice();
      for (let i = 0; i < values.length; i += 4) {
        values[i] = values[i] * (1 - amount) + .22 * amount;
        values[i + 1] = values[i + 1] * (1 - amount) + .19 * amount;
        values[i + 2] = values[i + 2] * (1 - amount) + .15 * amount;
      }
      mesh.setVerticesData(VertexBuffer.ColorKind, values, false);
    }
  }
  function register(prop: WorldProp, id: string, options: PropOptions = {}, visible = true): void {
    const p = prop as Prop;
    const prior = saved.get(id), initial: SavedProp = { hp: p.hp, destroyed: false, dx: 0, dz: 0, yaw: 0 };
    const state = prior ?? initial;
    Object.assign(p, { id, kind: options.kind ?? (p.breakable ? 'street-prop' : 'solid'), interaction: options.interaction ?? (p.breakable ? 'breakable' : 'solid'), mass: options.mass ?? (p.breakable ? 30 : 10000), width: options.width, depth: options.depth, angle: options.angle ?? 0 });
    const originX = p.x, originZ = p.z, mesh = p.mesh;
    const colors: Runtime['colors'] = [];
    if (visible) {
      // Geometry is authored in world coordinates. Rebase all batches together,
      // including emissive children, so moving a prop cannot move another object.
      for (const part of [mesh, ...mesh.getChildMeshes()]) {
        if (!(part instanceof Mesh)) continue;
        part.unfreezeWorldMatrix(); part.bakeTransformIntoVertices(Matrix.Translation(-originX, 0, -originZ));
        const original = part.getVerticesData(VertexBuffer.ColorKind);
        if (original) colors.push({ mesh: part, original: Float32Array.from(original) });
      }
      mesh.position.set(originX + state.dx, 0, originZ + state.dz);
      mesh.rotation.y = state.yaw; mesh.computeWorldMatrix(true);
      const bounds = mesh.getBoundingInfo().boundingBox;
      p.height = options.height ?? Math.max(.3, bounds.maximumWorld.y);
      mesh.metadata = { ...mesh.metadata, worldPropId: id, interaction: p.interaction, occluder: p.height > 2.4 };
    } else p.height = options.height ?? 2;
    p.hp = state.hp; p.x += state.dx; p.z += state.dz; p.active = !state.destroyed;
    const runtime: Runtime = { prop: p, state, originX, originZ, maxHp: initial.hp, colors, velocity: Vector3.Zero(), wobble: 0, fade: 1, blockedUntil: 0, fadeMaterials: [], group: options.group };
    active.set(prop, runtime);
    if (state.destroyed) { mesh.setEnabled(false); rubble(runtime); }
    else if (prior && state.hp < runtime.maxHp) paintDamage(runtime);
  }
  function release(prop: WorldProp): void {
    const runtime = active.get(prop);
    if (!runtime) return;
    if (runtime.state.hp < runtime.maxHp || runtime.state.destroyed || runtime.state.dx || runtime.state.dz) saved.set(runtime.prop.id!, runtime.state);
    runtime.remains?.dispose();
    runtime.jet?.dispose();
    for (const mat of runtime.fadeMaterials) mat.dispose();
    for (const mesh of [prop.mesh, ...prop.mesh.getChildMeshes()]) shadow?.removeShadowCaster(mesh as Mesh);
    prop.mesh.dispose(); active.delete(prop);
  }
  function shatter(runtime: Runtime, impulse?: Vector3): void {
    const p = runtime.prop;
    // No physics-engine bodies for small shrapnel: bounded ballistic visuals settle
    // over the static rubble, while important moving props retain their own state.
    const count = p.kind === 'small-building' ? 10 : p.interaction === 'facade' ? 5 : 6;
    for (let i = 0; i < count; i++) {
      if (fragments.length >= 42) fragments.shift()!.mesh.dispose();
      const mesh = MeshBuilder.CreateBox('prop-debris-' + p.kind, { width: .15 + Math.random() * .45, height: .12 + Math.random() * .25, depth: .2 + Math.random() * .3 }, scene);
      mesh.position.set(p.x + (Math.random() - .5) * Math.min(p.radius, 3), Math.min(p.height ?? 1, 3) * .6, p.z + (Math.random() - .5) * Math.min(p.radius, 3));
      mesh.material = rubbleMaterial; mesh.isPickable = false;
      fragments.push({ mesh, velocity: new Vector3((Math.random() - .5) * 7 + (impulse?.x ?? 0) * .08, 3 + Math.random() * 4, (Math.random() - .5) * 7 + (impulse?.z ?? 0) * .08), spin: new Vector3(Math.random() * 5, Math.random() * 5, Math.random() * 5), life: 9 });
    }
  }
  function damageProp(prop: WorldProp, damage: number, impulse?: Vector3): void {
    const runtime = active.get(prop);
    if (!runtime || !prop.active || !Number.isFinite(damage) || damage <= 0) return;
    const p = runtime.prop;
    runtime.state.hp = Math.max(p.interaction === 'solid' ? runtime.maxHp * .3 : 0, runtime.state.hp - damage);
    p.hp = runtime.state.hp; runtime.wobble = p.interaction === 'solid' ? 0 : .25;
    if (p.interaction === 'movable') {
      const push = impulse ?? new Vector3(1, 0, .4);
      const force = Math.min(8, damage * 18 / Math.max(20, p.mass ?? 30));
      const direction = new Vector3(push.x, 0, push.z).normalize();
      runtime.velocity.addInPlace(direction.scale(force)); runtime.state.yaw += force * .025;
    }
    paintDamage(runtime); saved.set(p.id!, runtime.state);
    if (p.hp > 0) return;
    runtime.state.destroyed = true; p.active = false; p.mesh.setEnabled(false);
    for (const mesh of [p.mesh, ...p.mesh.getChildMeshes()]) shadow?.removeShadowCaster(mesh as Mesh);
    shatter(runtime, impulse); rubble(runtime);
    if (p.interaction === 'explosive') {
      const at = new Vector3(p.x, .8, p.z);
      const flash = MeshBuilder.CreateSphere('barrel-fireball', { diameter: 3.8, segments: 6 }, scene);
      flash.position.copyFrom(at); flash.material = flashMaterial; flash.isPickable = false; flashes.push({ mesh: flash, life: .35 });
      // Mark this barrel dead before the callback: chain reactions cannot hit it twice.
      if (explosionHandler) explosionHandler(at, 100);
      else for (const other of active.values()) if (other !== runtime && other.prop.active && Math.hypot(other.prop.x - p.x, other.prop.z - p.z) < 7) damageProp(other.prop, 80, other.prop.mesh.position.subtract(at));
    }
  }
  function attachRotor(prop: WorldProp, rotor: TransformNode): void { const runtime = active.get(prop); if (runtime) runtime.rotor = rotor; }
  function update(dt: number, x: number, z: number): void {
    const step = Math.max(0, Math.min(.05, dt)); clock += step;
    for (const runtime of active.values()) {
      const p = runtime.prop;
      if(runtime.jet)runtime.jet.scaling.y=.92+Math.sin(clock*12+p.x)*.08;
      if (!p.active) continue;
      if (runtime.rotor && Math.hypot(p.x - x, p.z - z) < 180) runtime.rotor.rotation.z += step * .85 * (.2 + .8 * p.hp / runtime.maxHp);
      if (runtime.wobble > 0) { runtime.wobble = Math.max(0, runtime.wobble - step); p.mesh.rotation.z = Math.sin(runtime.wobble * 55) * runtime.wobble * .12; }
      else if (!runtime.rotor) p.mesh.rotation.z = 0;
      if (runtime.velocity.lengthSquared() > .0001) {
        const delta = runtime.velocity.scale(step);
        const nextX=p.x+delta.x,nextZ=p.z+delta.z;
        let blocked=false;
        for(const other of active.values()) {
          const obstacle=other.prop;
          if(other===runtime||!obstacle.active||obstacle.breakable||obstacle.interaction!=='solid'||obstacle.kind==='garage')continue;
          const angle=obstacle.angle??0,dx=nextX-obstacle.x,dz=nextZ-obstacle.z;
          const localX=Math.cos(angle)*dx-Math.sin(angle)*dz,localZ=Math.sin(angle)*dx+Math.cos(angle)*dz;
          if(Math.abs(localX)<(obstacle.width??obstacle.radius*1.6)/2+p.radius*.65&&Math.abs(localZ)<(obstacle.depth??obstacle.radius*1.6)/2+p.radius*.65){blocked=true;break;}
        }
        if(blocked){runtime.velocity.setAll(0);continue;}
        runtime.state.dx += delta.x; runtime.state.dz += delta.z;
        p.x = runtime.originX + runtime.state.dx; p.z = runtime.originZ + runtime.state.dz;
        p.mesh.position.x = p.x; p.mesh.position.z = p.z; p.mesh.rotation.y = runtime.state.yaw;
        runtime.velocity.scaleInPlace(Math.exp(-step * 3.2)); saved.set(p.id!, runtime.state);
      }
    }
    for (let i = fragments.length - 1; i >= 0; i--) {
      const f = fragments[i]; f.life -= step;
      if (f.life <= 0 || Math.hypot(f.mesh.position.x - x, f.mesh.position.z - z) > 150) { f.mesh.dispose(); fragments.splice(i, 1); continue; }
      if (f.mesh.position.y > .15 || f.velocity.y > 0) {
        f.velocity.y -= 9.8 * step; f.mesh.position.addInPlace(f.velocity.scale(step)); f.mesh.rotation.addInPlace(f.spin.scale(step));
        if (f.mesh.position.y < .15) { f.mesh.position.y = .15; f.velocity.setAll(0); f.spin.setAll(0); }
      }
      if (f.life < 1) f.mesh.scaling.setAll(Math.max(.05, f.life));
    }
    for (let i = flashes.length - 1; i >= 0; i--) { const f = flashes[i]; f.life -= step; if (f.life <= 0) { f.mesh.dispose(); flashes.splice(i, 1); } else f.mesh.scaling.setAll(1 + (.35 - f.life) * 4); }
  }
  function updateOcclusion(cameraPosition: Vector3, target: Vector3, dt: number): void {
    // Rays test object meshes, never the batched ground, roads, or collider proxies.
    if (clock >= nextOcclusion) {
      nextOcclusion = clock + .1;
      const points = [new Vector3(0, .6, 0), new Vector3(1, .7, 0), new Vector3(-1, .7, 0), new Vector3(0, .7, 1.5), new Vector3(0, 1.6, -.8)].map(offset => target.add(offset));
      const rays = points.map(point => { const delta = point.subtract(cameraPosition), distance = delta.length(); return new Ray(cameraPosition, delta.scale(1 / Math.max(.001, distance)), Math.max(0, distance - .5)); });
      const blockedGroups = new Set<string>();
      for (const runtime of active.values()) {
        const p = runtime.prop;
        if (!p.active || !p.mesh.isEnabled() || (p.height ?? 0) < 2.4 || Math.hypot(p.x - target.x, p.z - target.z) > 95) continue;
        p.mesh.computeWorldMatrix(true);
        if (rays.some(ray => ray.intersectsMesh(p.mesh, false).hit)) { runtime.blockedUntil = clock + .22; if (runtime.group) blockedGroups.add(runtime.group); }
      }
      for (const runtime of active.values()) if (runtime.group && blockedGroups.has(runtime.group)) runtime.blockedUntil = clock + .22;
    }
    const factor = 1 - Math.exp(-Math.max(0, dt) * 8);
    for (const runtime of active.values()) {
      const wanted = runtime.blockedUntil > clock ? .28 : 1;
      runtime.fade += (wanted - runtime.fade) * factor;
      if (Math.abs(runtime.fade - wanted) < .005) runtime.fade = wanted;
      if (runtime.fade === 1 && !runtime.fadeMaterials.length) continue;
      const meshes = [runtime.prop.mesh, ...runtime.prop.mesh.getChildMeshes()].filter(mesh => mesh instanceof Mesh) as Mesh[];
      if (!runtime.fadeMaterials.length) {
        const clones = new Map<StandardMaterial, StandardMaterial>();
        for (const mesh of meshes) if (mesh.material instanceof StandardMaterial) {
          const source = mesh.material; let clone = clones.get(source);
          if (!clone) { clone = source.clone(source.name + '-fade-' + runtime.prop.id); clones.set(source, clone); runtime.fadeMaterials.push(clone); }
          mesh.material = clone;
        }
      }
      for (const mat of runtime.fadeMaterials) { mat.alpha = runtime.fade; mat.needDepthPrePass = runtime.fade < .99; }
    }
  }
  return { register, release, attachRotor, damageProp, update, updateOcclusion,
    setExplosionHandler(handler: (at: Vector3, damage: number) => void) { explosionHandler = handler; },
    destroyProp(prop: WorldProp) { if (prop.breakable) damageProp(prop, Math.max(1, prop.hp)); },
    dispose() { for (const prop of [...active.keys()]) release(prop); fragments.forEach(f => f.mesh.dispose()); flashes.forEach(f => f.mesh.dispose()); fragments.length = flashes.length = 0; saved.clear(); rubbleMaterial.dispose(); waterMaterial.dispose(); flashMaterial.dispose(); }
  };
}
