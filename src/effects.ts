import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3, VertexBuffer, VertexData, Matrix, Quaternion } from '@babylonjs/core';
import { conceptBox } from './vehicle-concepts';

export type ExplosionKind = 'car' | 'helicopter' | 'impact';
type ParticleKind = 'spark' | 'smoke' | 'tracer' | 'flash' | 'fire' | 'dust' | 'ember';
type ParticleShape = 'shard' | 'glow' | 'smoke' | 'ring';
interface Particle {
  position: Vector3;
  velocity: Vector3;
  rotation: Vector3;
  scale: Vector3;
  color: Color3;
  life: number;
  duration: number;
  kind: ParticleKind;
  shape: ParticleShape;
  size: number;
  stretch: number;
}
interface ExplosionSequence {
  position: Vector3;
  life: number;
  age: number;
  size: number;
  smokeStarted: boolean;
  emberClock: number;
}
const PARTICLE_CAPACITY = 240;
const EXPLOSION_CAPACITY = 8;

/** Four shared geometry/material batches, regardless of how many explosions are
 * active. Tiny shards are visual particles; only the caller's large pieces use
 * Havok. Emission creates no new meshes, materials, lights or physics bodies. */
export function createEffects(scene: Scene) {
  const palettes = new Map<string, Color3>();
  function color(hex: string): Color3 {
    let tint = palettes.get(hex);
    if (!tint) { tint = Color3.FromHexString(hex); palettes.set(hex, tint); }
    return tint;
  }
  const cream = color('#fff0a3'), yellow = color('#ffd04f'), orange = color('#ff842b');
  const darkOrange = color('#ec5921'), ash = color('#363d38'), grey = color('#69736a'), dustColor = color('#c9b27c'), screenGrey = color('#93a3a1');
  const unlit = new StandardMaterial('effects-unlit', scene);
  unlit.diffuseColor = Color3.White(); unlit.emissiveColor = Color3.White();
  unlit.disableLighting = true; unlit.specularColor = Color3.Black();
  const smokeMat = new StandardMaterial('effects-faceted-smoke', scene);
  smokeMat.diffuseColor = Color3.White(); smokeMat.specularColor = Color3.Black();
  smokeMat.emissiveColor.set(.1, .1, .1);
  const sources = {
    shard: MeshBuilder.CreateBox('effects-shards', { size: 1 }, scene),
    glow: MeshBuilder.CreateIcoSphere('effects-fire', { radius: .5, subdivisions: 1, flat: true }, scene),
    smoke: MeshBuilder.CreateIcoSphere('effects-smoke', { radius: .5, subdivisions: 1, flat: true }, scene),
    ring: MeshBuilder.CreateTorus('effects-dust-rings', { diameter: 1, thickness: .055, tessellation: 16 }, scene),
  };
  // Keep the fire's facets readable even though it is unlit. This one-time
  // vertex tint multiplies each instance's orange/yellow colour in the shader.
  const glowNormals = sources.glow.getVerticesData(VertexBuffer.NormalKind)!;
  const glowColors = new Float32Array(sources.glow.getTotalVertices() * 4);
  for (let i = 0; i < sources.glow.getTotalVertices(); i++) {
    const facing = glowNormals[i * 3] * -.35 + glowNormals[i * 3 + 1] * .8 + glowNormals[i * 3 + 2] * .48;
    const shade = .92 + facing * .08;
    glowColors.set([shade, shade, shade, 1], i * 4);
  }
  sources.glow.setVerticesData(VertexBuffer.ColorKind, glowColors);
  const batches = (Object.keys(sources) as ParticleShape[]).map(shape => {
    const mesh = sources[shape];
    mesh.material = shape === 'smoke' ? smokeMat : unlit;
    mesh.isPickable = false; mesh.receiveShadows = false;
    mesh.alwaysSelectAsActiveMesh = true; mesh.doNotSyncBoundingInfo = true;
    mesh.hasVertexAlpha = shape === 'smoke';
    const matrices = new Float32Array(PARTICLE_CAPACITY * 16);
    const colors = new Float32Array(PARTICLE_CAPACITY * 4);
    mesh.thinInstanceSetBuffer('matrix', matrices, 16, false);
    mesh.thinInstanceSetBuffer('color', colors, 4, false);
    mesh.thinInstanceCount = 0; mesh.setEnabled(false);
    return { shape, mesh, matrices, colors, count: 0 };
  });
  const batchFor = Object.fromEntries(batches.map(batch => [batch.shape, batch])) as Record<ParticleShape, typeof batches[number]>;
  const particles: Particle[] = Array.from({ length: PARTICLE_CAPACITY }, () => ({
    position: Vector3.Zero(), velocity: Vector3.Zero(), rotation: Vector3.Zero(), scale: Vector3.One(),
    color: Color3.White(), life: 0, duration: 1, kind: 'spark', shape: 'shard', size: 1, stretch: 1,
  }));
  const sequences: ExplosionSequence[] = Array.from({ length: EXPLOSION_CAPACITY }, () => ({
    position: Vector3.Zero(), life: 0, age: 0, size: 1, smokeStarted: false, emberClock: 0,
  }));
  let cursor = 0, sequenceCursor = 0, disposed = false;
  const instanceMatrix = Matrix.Identity(), instanceRotation = Quaternion.Identity();
  function take(kind: ParticleKind, shape: ParticleShape, at: Vector3, duration: number, size: number, tint: Color3): Particle {
    // Prefer a vacant slot; overload recycles the oldest pool slot without
    // allocating another mesh, material, light or physics object.
    for (let i = 0; i < particles.length; i++) {
      if (particles[cursor].life <= 0) break;
      cursor = (cursor + 1) % particles.length;
    }
    const p = particles[cursor]; cursor = (cursor + 1) % particles.length;
    p.kind = kind; p.shape = shape; p.life = p.duration = duration; p.size = size; p.stretch = 1;
    p.position.copyFrom(at); p.velocity.setAll(0); p.rotation.setAll(0); p.scale.setAll(size); p.color.copyFrom(tint);
    return p;
  }
  function emitSmoke(at: Vector3, size: number, life: number, dark: boolean) {
    const p = take('smoke', 'smoke', at, life, size, dark ? ash : grey);
    p.velocity.set((Math.random() - .5) * .8, dark ? 1.5 : .8, (Math.random() - .5) * .8);
    p.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    return p;
  }
  function emitFlame(at: Vector3, size: number, duration: number, ember = false) {
    const p = take(ember ? 'ember' : 'fire', 'glow', at, duration, size, Math.random() > .45 ? orange : yellow);
    p.velocity.set((Math.random() - .5) * 1.4, ember ? 1.2 : 2.1, (Math.random() - .5) * 1.4);
    p.rotation.set(Math.random() * 2, Math.random() * 2, Math.random() * 2);
    return p;
  }
  function burst(position: Vector3, hex: string, count = 18, power = 5) {
    if (disposed) return;
    const tint = color(hex), total = Math.max(0, Math.min(PARTICLE_CAPACITY, Math.floor(count)));
    for (let i = 0; i < total; i++) {
      const p = take('spark', 'shard', position, .32 + Math.random() * .46, .07 + Math.random() * .13, tint);
      const angle = Math.random() * Math.PI * 2, speed = power * (.3 + Math.random() * .7);
      p.velocity.set(Math.cos(angle) * speed, power * (.2 + Math.random() * .65), Math.sin(angle) * speed);
      p.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      p.stretch = 1 + Math.random() * 3;
    }
  }
  function clear() {
    for (const p of particles) p.life = 0;
    for (const s of sequences) s.life = 0;
    for (const batch of batches) { batch.count = 0; batch.mesh.thinInstanceCount = 0; batch.mesh.setEnabled(false); }
  }
  return {
    burst,
    smoke(position: Vector3, dark = false): void {
      if (!disposed) emitSmoke(position, dark ? .55 : .23, dark ? 1.8 : 1.1, dark);
    },
    /** Call every .35 s while the smoke canister is active. Seven overlapping
     * low lobes cover the playable 8 m radius using the existing smoke batch. */
    smokeScreen(position: Vector3): void {
      if (disposed) return;
      for (let i = 0; i < 7; i++) {
        const p = emitSmoke(position, i === 0 ? 7 : 5.8, 1.35, false);
        const angle = (i - 1) * Math.PI / 3;
        if (i > 0) p.position.addInPlaceFromFloats(Math.cos(angle) * 4, 0, Math.sin(angle) * 4);
        p.position.y += .9 + (i % 2) * .25;
        p.velocity.set(i > 0 ? Math.cos(angle) * .12 : 0, .28, i > 0 ? Math.sin(angle) * .12 : 0);
        p.color.copyFrom(screenGrey).scaleInPlace(.9 + (i % 3) * .06);
        p.rotation.set(0, Math.random() * Math.PI * 2, 0);
        p.stretch = .55;
      }
    },
    explosion(position: Vector3, kind: ExplosionKind = 'car'): void {
      if (disposed) return;
      const camera = scene.activeCamera;
      const distant = !!camera && Vector3.DistanceSquared(camera.globalPosition, position) > 95 * 95;
      const size = (kind === 'helicopter' ? 1.5 : kind === 'impact' ? .72 : 1) * (distant ? .8 : 1);
      const sequence = sequences[sequenceCursor]; sequenceCursor = (sequenceCursor + 1) % sequences.length;
      sequence.position.copyFrom(position); sequence.life = distant ? 1.5 : 2.8;
      sequence.age = 0; sequence.size = size; sequence.smokeStarted = false; sequence.emberClock = .6;
      const flash = take('flash', 'glow', position, .12, 2.3 * size, cream);
      flash.position.y += .35;
      const core = emitFlame(position, 1.25 * size, .34);
      core.color.copyFrom(cream); core.position.y += .55;
      core.velocity.set(0, 1.4 * size, 0);
      // Two bright tongues clear the outer orange lobes. Their upward motion
      // leaves the hot centre visible from the elevated gameplay camera.
      for (const side of [-1, 1]) {
        const tongue = emitFlame(position, .95 * size, .5);
        tongue.color.copyFrom(side < 0 ? cream : yellow);
        tongue.position.addInPlaceFromFloats(side * .85 * size, .95 * size, .55 * size);
        tongue.velocity.set(side * .5 * size, 5 * size, 1.2 * size);
      }
      if (position.y < 3) {
        const ring = take('dust', 'ring', position, .55, 1.2 * size, dustColor);
        ring.position.y = .09; ring.stretch = 9 * size;
      }
      for (let i = 0; i < (distant ? 3 : 7); i++) {
        const p = emitFlame(position, (1.3 + Math.random()) * size, .42 + Math.random() * .23);
        const angle = i * 2.399;
        p.velocity.set(Math.cos(angle) * size * 2.7, (1.7 + Math.random() * 3.2) * size, Math.sin(angle) * size * 2.7);
        p.position.y += .25; p.color.copyFrom(i % 3 ? orange : yellow);
      }
      burst(position, '#ffd04f', distant ? 5 : 12, size * 10);
      burst(position, '#42483e', distant ? 3 : 7, size * 7);
    },
    tracer(from: Vector3, to: Vector3): void {
      if (disposed) return;
      const p = take('tracer', 'shard', from, .07, .035, cream);
      const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
      p.position.set((from.x + to.x) * .5, (from.y + to.y) * .5, (from.z + to.z) * .5);
      p.scale.set(.035, .035, Math.max(.04, Math.hypot(dx, dy, dz)));
      p.rotation.set(-Math.atan2(dy, Math.hypot(dx, dz)), Math.atan2(dx, dz), 0);
    },
    update(dt: number): void {
      if (disposed || !Number.isFinite(dt)) return;
      const step = Math.max(0, Math.min(dt, .06));
      for (const s of sequences) {
        if (s.life <= 0) continue;
        s.age += step; s.life -= step;
        if (!s.smokeStarted && s.age >= .10) {
          s.smokeStarted = true;
          for (let i = 0; i < 7; i++) {
            const p = emitSmoke(s.position, (.57 + Math.random() * .53) * s.size, 1.8 + Math.random() * .9, true);
            const angle = i * 2.399;
            p.velocity.set(Math.cos(angle) * s.size, 1.8 + (i % 3) * .95, Math.sin(angle) * s.size);
            p.position.y += .3 + i * .12; p.color.scaleInPlace(.9 + (i % 3) * .16);
          }
        }
        s.emberClock -= step;
        if (s.emberClock <= 0 && s.age > .55 && s.life > .2) {
          s.emberClock = .2;
          const p = emitFlame(s.position, (.38 + Math.random() * .35) * s.size, .55, true);
          p.position.x += (Math.random() - .5) * 1.9 * s.size;
          p.position.z += (Math.random() - .5) * 1.9 * s.size;
          p.position.y += .1;
          if (s.life > 1) emitSmoke(p.position, .45 * s.size, 1.5, true);
        }
      }
      for (const batch of batches) batch.count = 0;
      for (const p of particles) {
        if (p.life <= 0) continue;
        p.life -= step; if (p.life <= 0) continue;
        const ratio = p.life / p.duration, age = 1 - ratio;
        p.position.addInPlaceFromFloats(p.velocity.x * step, p.velocity.y * step, p.velocity.z * step);
        let alpha = 1;
        if (p.kind === 'smoke') {
          const screen = p.stretch < 1, size = p.size * (1 + age * (screen ? .35 : 1.5));
          p.scale.set(size, size * p.stretch, size);
          p.rotation.y += step * .18; alpha = Math.min(screen ? .72 : .94, ratio * 3);
        } else if (p.kind === 'flash') {
          p.scale.setAll(p.size * (.55 + age * 1.5) * Math.min(1, ratio * 4));
        } else if (p.kind === 'fire' || p.kind === 'ember') {
          const pulse = Math.pow(Math.sin(Math.PI * age), .6), size = p.size * (.18 + pulse) * Math.min(1, ratio * 3);
          p.scale.set(size, size * (p.kind === 'ember' ? 1.7 : 1.15), size);
          if (age > .55) Color3.LerpToRef(p.color, darkOrange, step * 8, p.color);
        } else if (p.kind === 'dust') {
          const diameter = p.size + age * p.stretch;
          p.scale.set(diameter, Math.max(.03, ratio * .35), diameter);
        } else if (p.kind === 'spark') {
          p.velocity.y -= step * 11;
          p.velocity.x *= 1 - step * .7; p.velocity.z *= 1 - step * .7;
          if (p.position.y < .04) { p.position.y = .04; p.velocity.y = Math.abs(p.velocity.y) * .28; }
          p.rotation.x += step * 4; p.rotation.z += step * 3;
          const size = p.size * Math.min(1, ratio * 3);
          p.scale.set(size, size * p.stretch, size);
        }
        const batch = batchFor[p.shape], index = batch.count++;
        Quaternion.FromEulerAnglesToRef(p.rotation.x, p.rotation.y, p.rotation.z, instanceRotation);
        Matrix.ComposeToRef(p.scale, instanceRotation, p.position, instanceMatrix);
        instanceMatrix.copyToArray(batch.matrices, index * 16);
        const offset = index * 4;
        batch.colors[offset] = p.color.r; batch.colors[offset + 1] = p.color.g;
        batch.colors[offset + 2] = p.color.b; batch.colors[offset + 3] = alpha;
      }
      for (const batch of batches) {
        batch.mesh.thinInstanceCount = batch.count; batch.mesh.setEnabled(batch.count > 0);
        if (!batch.count) continue;
        batch.mesh.thinInstanceBufferUpdated('matrix');
        batch.mesh.thinInstanceBufferUpdated('color');
      }
    },
    clear,
    getStats() {
      const byKind: Record<ParticleKind, number> = { spark: 0, smoke: 0, tracer: 0, flash: 0, fire: 0, dust: 0, ember: 0 };
      for (const p of particles) if (p.life > 0) byKind[p.kind]++;
      return { capacity: PARTICLE_CAPACITY, active: Object.values(byKind).reduce((a, b) => a + b, 0),
        sequences: sequences.filter(s => s.life > 0).length, batches: batches.filter(b => b.count > 0).length, byKind };
    },
    dispose(): void {
      if (disposed) return; clear(); disposed = true;
      for (const batch of batches) batch.mesh.dispose(false, false);
      unlit.dispose(); smokeMat.dispose(); palettes.clear();
    },
  };
}

export interface HelicopterVisual {
  root: TransformNode;
  rotor: TransformNode;
  hull: TransformNode;
  tail: TransformNode;
  skids: TransformNode[];
  setWeapons(enabled: boolean): void;
  beginCrash(): void;
  releaseDebris(): Mesh[];
  dispose(): void;
}

/** Separate semantic groups survive material batching: the caller owns the crash
 * trajectory, rotor speed and the physics/lifetime of released fragments. */
export function createHelicopter(scene: Scene, variant: 'observer' | 'transport' = 'observer'): HelicopterVisual {
  const heavy = variant === 'transport';
  const root=new TransformNode('police-helicopter',scene);
  root.metadata = { variant };
  const hullGroup=new TransformNode('helicopter-hull',scene);hullGroup.parent=root;
  const tailGroup=new TransformNode('helicopter-tail',scene);tailGroup.parent=root;tailGroup.position.set(0,.10,heavy ? -2.03 : -1.18);
  const rotor=new TransformNode('helicopter-main-rotor',scene);rotor.parent=root;rotor.position.set(0,heavy ? 1.35 : 1.01,heavy ? -.42 : -.17);
  const skidGroups=[-1,1].map(side=>{const node=new TransformNode(side<0?'helicopter-left-skid':'helicopter-right-skid',scene);node.parent=root;node.position.set(side*(heavy?1.12:.92),heavy?-.98:-.84,heavy?-.25:.03);return node;});
  const semantic=[{node:hullGroup,id:'hull',mass:heavy?155:90},{node:tailGroup,id:'tail',mass:25},{node:rotor,id:'main-rotor',mass:15},{node:skidGroups[0],id:'left-skid',mass:8},{node:skidGroups[1],id:'right-skid',mass:8}];
  const materials:StandardMaterial[]=[],weapons:Mesh[]=[];
  const batches=new Map<TransformNode,Map<StandardMaterial,Mesh[]>>();
  function material(name:string,hex:string):StandardMaterial {
    const mat=new StandardMaterial(name,scene);mat.diffuseColor=Color3.FromHexString(hex);mat.specularColor=Color3.Black();mat.backFaceCulling=false;materials.push(mat);return mat;
  }
  const hull=material('helicopter-charcoal','#354d5a'),trim=material('helicopter-trim','#202c30'),canopy=material('helicopter-canopy','#15343b'),stripe=material('helicopter-ivory','#e8e3ce'),red=material('helicopter-warning','#ed6949');
  red.emissiveColor=new Color3(.5,.06,.01);
  function register(mesh:Mesh,mat:StandardMaterial,parent=hullGroup,batch=true):Mesh {
    mesh.material=mat;mesh.parent=parent;mesh.isPickable=false;mesh.receiveShadows=true;
    if(batch){let map=batches.get(parent);if(!map){map=new Map();batches.set(parent,map);}const group=map.get(mat)??[];group.push(mesh);map.set(mat,group);}return mesh;
  }
  function box(name:string,w:number,h:number,d:number,x:number,y:number,z:number,mat:StandardMaterial,parent=hullGroup,batch=true):Mesh {
    const mesh=conceptBox(scene,name,w,h,d,.035);mesh.position.set(x,y,z);return register(mesh,mat,parent,batch);
  }
  function poly(name:string,faces:number[][][],mat:StandardMaterial,parent=hullGroup):Mesh {
    const positions:number[]=[],indices:number[]=[],normals:number[]=[];
    for(const face of faces){const at=positions.length/3;for(const p of face)positions.push(...p);for(let i=1;i<face.length-1;i++)indices.push(at,at+i,at+i+1);}
    VertexData.ComputeNormals(positions,indices,normals,{useRightHandedSystem:true});const data=new VertexData();data.positions=positions;data.indices=indices;data.normals=normals;data.uvs=new Array(positions.length/3*2).fill(0);const mesh=new Mesh(name,scene);data.applyToMesh(mesh);return register(mesh,mat,parent);
  }
  // Angular fuselage with an actual sloping windscreen, not a glass box.
  const sections=heavy
    ? [{z:1.72,w:1.35,lo:-.30,hi:.26},{z:.63,w:2.02,lo:-.65,hi:.86},{z:-1.57,w:1.88,lo:-.56,hi:.76},{z:-2.30,w:.48,lo:-.13,hi:.30}]
    : [{z:1.40,w:1.12,lo:-.25,hi:.20},{z:.50,w:1.75,lo:-.55,hi:.60},{z:-1.0,w:1.05,lo:-.35,hi:.38},{z:-1.40,w:.42,lo:-.15,hi:.20}];
  const rings=sections.map(s=>[[-s.w/2+.10,s.lo,s.z],[s.w/2-.10,s.lo,s.z],[s.w/2,s.lo+.10,s.z],[s.w/2,s.hi-.10,s.z],[s.w/2-.10,s.hi,s.z],[-s.w/2+.10,s.hi,s.z],[-s.w/2,s.hi-.10,s.z],[-s.w/2,s.lo+.10,s.z]]);
  const faces:number[][][]=[rings[0],rings.at(-1)!.slice().reverse()];for(let r=0;r<rings.length-1;r++)for(let i=0;i<8;i++){const j=(i+1)%8;faces.push([rings[r][i],rings[r+1][i],rings[r+1][j],rings[r][j]]);}poly('faceted-fuselage',faces,hull);
  poly('sloped-helicopter-windscreen',heavy
    ? [[[-.60,.04,1.75],[.60,.04,1.75],[.83,.74,.81],[-.83,.74,.81]]]
    : [[[-.48,.02,1.42],[.48,.02,1.42],[.67,.46,.86],[-.67,.46,.86]]],canopy);
  box('windscreen-divider',.055,heavy?.95:.64,.07,0,heavy?.40:.24,heavy?1.28:1.15,stripe).rotation.x=-.87;
  box('nose-ivory-chin',heavy?1.25:1.04,.17,.16,0,-.18,heavy?1.73:1.40,stripe);
  box('belly-armor',heavy?1.50:1.12,.19,heavy?3.1:1.75,0,heavy?-.61:-.48,heavy?-.43:-.04,trim);
  box('engine-cowling',heavy?1.30:.94,heavy?.38:.34,heavy?1.65:1.17,0,heavy?.95:.66,heavy?-.65:-.40,hull);
  const boom=MeshBuilder.CreateCylinder('tapered-tail-boom',{diameterTop:.43,diameterBottom:.15,height:2.52,tessellation:8},scene);boom.rotation.x=Math.PI/2;boom.rotation.z=.03;boom.position.set(0,.04,-1.16);register(boom,hull,tailGroup);
  box('vertical-tail-fin',.11,.92,.68,0,.45,-2.23,hull,tailGroup).rotation.x=-.14;
  box('tail-ivory-tip',.12,.21,.49,0,.88,-2.26,stripe,tailGroup);
  box('tail-warning-light',.10,.10,.10,0,1.02,-2.20,red,tailGroup);
  box('tail-stabilizer',1.15,.075,.43,0,.13,-1.98,stripe,tailGroup);
  box('tail-rotor-vertical',.035,.85,.07,.21,.40,-2.24,trim,tailGroup);
  box('tail-rotor-horizontal',.035,.07,.85,.21,.40,-2.24,trim,tailGroup);
  const wing=box('short-wings',heavy?3.35:3.0,.10,.43,0,-.19,-.17,hull,hullGroup,false);weapons.push(wing);
  for(const side of [-1,1]) {
    const sideGlass=heavy
      ? [[side*1.02,-.05,.57],[side*1.00,-.05,-.12],[side*1.00,.59,-.12],[side*1.02,.70,.57]]
      : [[side*.89,-.04,.48],[side*.745,-.04,-.25],[side*.745,.35,-.25],[side*.89,.43,.48]];
    if(side<0)sideGlass.reverse();poly('side-canopy',[sideGlass],canopy);
    box('door-stripe',.045,.16,heavy?2.18:.91,side*(heavy?.99:.83),-.16,heavy?-.52:-.20,stripe);
    box('door-handle',.055,.045,.19,side*(heavy?1.025:.82),-.20,heavy?-.39:-.30,trim);
    if(heavy) {
      box('cargo-door',.055,1.12,.78,side*.99,.04,-.62,stripe);
      box('cargo-door-panel',.065,.96,.59,side*1.025,.04,-.62,hull);
      box('cargo-window',.035,.32,.33,side*1.065,.24,-.62,canopy);
      box('cargo-door-rail',.07,.055,1.38,side*1.02,.65,-.89,trim);
      for(const z of [-1.23,-1.57])box('rear-cabin-window',.045,.32,.24,side*.955,.29,z,canopy);
      box('cargo-step',.24,.055,1.10,side*1.07,-.70,-.67,stripe);
      box('engine-intake',.14,.22,.51,side*.67,.99,-.39,trim);
      for(const z of [-.63,-.51,-.39,-.27])box('intake-louvre',.16,.026,.035,side*.69,1.00,z,hull);
    } else {
      box('ivory-door-pillar',.065,.59,.085,side*.80,.15,-.28,stripe);
      box('rear-cabin-ivory',.055,.48,.40,side*.67,.07,-.61,stripe);
      box('rear-cabin-window',.065,.29,.21,side*.70,.12,-.61,canopy);
    }
    const pod=MeshBuilder.CreateCylinder('helicopter-weapon-pod',{diameter:.25,height:.92,tessellation:8},scene);pod.position.set(side*1.30,-.27,.10);pod.rotation.x=Math.PI/2;register(pod,trim,hullGroup,false);weapons.push(pod);
    box('navigation-light',.11,.09,.09,side*(heavy?1.03:.89),.46,.38,red);
  }
  if(!heavy) {
    const sensor=MeshBuilder.CreateIcoSphere('observation-camera',{radius:.21,subdivisions:1,flat:true},scene);sensor.position.set(0,-.66,.70);register(sensor,trim);
    box('camera-lens',.14,.12,.055,0,-.65,.91,canopy);
    box('searchlight-arm',.42,.06,.06,-.57,-.45,.89,trim);
    box('searchlight-housing',.26,.25,.24,-.79,-.45,.92,trim);
    box('searchlight-lens',.20,.18,.035,-.79,-.45,1.06,stripe);
  }
  box('roof-antenna',.025,.43,.025,0,heavy?1.20:.92,heavy?-1.46:-.92,trim);
  for(let i=0;i<2;i++) {
    const side=i===0?-1:1,node=skidGroups[i];box('landing-skid',.11,.10,heavy?3.55:2.48,0,0,0,trim,node);
    box('upturned-skid-tip',.11,.09,.34,0,.055,heavy?1.86:1.34,trim,node).rotation.x=-.33;
    for(const z of heavy?[-1.09,1.02]:[-.65,.67])box('skid-strut',.085,.66,.085,-side*.16,.30,z,trim,node).rotation.z=side*.53;
  }
  box('rotor-shaft',.12,.36,.12,0,heavy?1.20:.86,heavy?-.42:-.17,trim);
  box('rotor-blade-x',heavy?7.3:5.75,.042,.18,0,0,0,trim,rotor);
  box('rotor-blade-z',.18,.042,heavy?7.3:5.75,0,0,0,trim,rotor);
  box('rotor-hub',.25,.10,.25,0,.03,0,hull,rotor);
  for(const side of [-1,1]) {
    box('rotor-tip-x',.28,.045,.18,side*(heavy?3.47:2.70),0,0,stripe,rotor);
    box('rotor-tip-z',.18,.045,.28,0,0,side*(heavy?3.47:2.70),stripe,rotor);
  }

  // Merge inside a part, never across the tail, skids or rotor pivots.
  for(const [parent,map] of batches)for(const [mat,meshes] of map) {
    if(meshes.length<2)continue;parent.computeWorldMatrix(true);const inverse=parent.getWorldMatrix().clone().invert();
    const merged=Mesh.MergeMeshes(meshes,true,true,undefined,false,false);if(!merged)continue;
    merged.parent=null;merged.bakeTransformIntoVertices(inverse);merged.position.setAll(0);merged.rotation.setAll(0);merged.rotationQuaternion=null;merged.scaling.setAll(1);merged.parent=parent;merged.material=mat;merged.isPickable=false;merged.receiveShadows=true;merged.name='helicopter-'+parent.name+'-'+mat.name;
  }
  let disposed=false,crashing=false,released=false;
  for(const weapon of weapons)weapon.setEnabled(heavy);
  return {
    root,rotor,hull:hullGroup,tail:tailGroup,skids:skidGroups,
    setWeapons(enabled:boolean):void {if(disposed||crashing)return;for(const weapon of weapons)weapon.setEnabled(enabled);},
    beginCrash():void {
      if(disposed||crashing)return;crashing=true;root.metadata={...root.metadata,crashing:true};
      for(const weapon of weapons)weapon.setEnabled(false);
      for(const mat of [hull,trim,stripe])Color3.LerpToRef(mat.diffuseColor,new Color3(.095,.11,.10),.42,mat.diffuseColor);
      red.emissiveColor.setAll(0);
    },
    releaseDebris():Mesh[] {
      if(disposed||released)return [];released=true;root.computeWorldMatrix(true);const debris:Mesh[]=[];
      for(const part of semantic) {
        const sources=part.node.getChildMeshes().filter(m=>m instanceof Mesh&&m.isEnabled()&&!m.isDisposed()) as Mesh[];
        if(!sources.length)continue;
        for(const source of sources)source.computeWorldMatrix(true);
        const bounds=part.node.getHierarchyBoundingVectors(true),center=bounds.min.add(bounds.max).scale(.5),inverse=Matrix.Translation(-center.x,-center.y,-center.z),pieces:VertexData[]=[];
        for(const source of sources) {
          const data=VertexData.ExtractFromMesh(source,false,true);data.transform(source.getWorldMatrix().multiply(inverse));
          const mat=source.material instanceof StandardMaterial?source.material:hull,colors=new Float32Array(source.getTotalVertices()*4);
          for(let i=0;i<source.getTotalVertices();i++){colors[i*4]=mat.diffuseColor.r;colors[i*4+1]=mat.diffuseColor.g;colors[i*4+2]=mat.diffuseColor.b;colors[i*4+3]=1;}data.colors=colors;pieces.push(data);
        }
        const data=pieces[0];data.merge(pieces.slice(1),true,false,false,true);
        const mesh=new Mesh('helicopter-debris-'+part.id,scene);data.applyToMesh(mesh);mesh.position.copyFrom(center);mesh.isPickable=false;mesh.receiveShadows=true;
        // Each fragment owns its material, so cleanup cannot invalidate a live heli.
        const own=new StandardMaterial('helicopter-debris-material-'+part.id,scene);own.diffuseColor=Color3.White();own.specularColor=new Color3(.06,.07,.06);own.backFaceCulling=false;mesh.material=own;mesh.metadata={helicopterDebris:true,part:part.id,debrisMass:part.mass};mesh.onDisposeObservable.addOnce(()=>own.dispose());debris.push(mesh);part.node.setEnabled(false);
      }
      root.setEnabled(false);return debris;
    },
    dispose():void {if(disposed)return;disposed=true;root.dispose(false,false);for(const mat of materials)mat.dispose();}
  };
}

const pickupMaterials = new WeakMap<Scene, StandardMaterial>();

export function createPickup(scene: Scene, kind: 'cash' | 'repair' | 'ammo' | 'nitro'): Mesh {
  let sharedMaterial = pickupMaterials.get(scene);
  if (!sharedMaterial) {
    sharedMaterial = new StandardMaterial('pickup-vertex-colors', scene);
    sharedMaterial.diffuseColor = Color3.White();
    sharedMaterial.specularColor = Color3.Black();
    sharedMaterial.emissiveColor = new Color3(0.26, 0.26, 0.26);
    pickupMaterials.set(scene, sharedMaterial);
  }
  const palette = { cash: '#dfe970', repair: '#82d7b1', ammo: '#ed9a69', nitro: '#7eb5d7' };
  const color = Color3.FromHexString(palette[kind]);
  const bright = new Color3(1, 0.98, 0.84);
  const parts: Mesh[] = [];
  function add(mesh: Mesh, tint: Color3): Mesh {
    const values: number[] = [];
    for (let i = 0; i < mesh.getTotalVertices(); i++) values.push(tint.r, tint.g, tint.b, 1);
    mesh.setVerticesData(VertexBuffer.ColorKind, values);
    mesh.material = sharedMaterial!;
    mesh.isPickable = false;
    parts.push(mesh);
    return mesh;
  }
  function box(name: string, width: number, height: number, depth: number, x: number, y: number, z: number, tint: Color3): Mesh {
    const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, scene);
    mesh.position.set(x, y, z);
    return add(mesh, tint);
  }
  box('supply-crate', 0.65, 0.6, 0.65, 0, 0, 0, color.scale(0.68));
  box('crate-lid', 0.72, 0.075, 0.72, 0, 0.3, 0, color);
  box('crate-bottom', 0.7, 0.07, 0.7, 0, -0.3, 0, color);
  for (const side of [-1, 1]) box('crate-band', 0.075, 0.58, 0.68, side * 0.21, 0, 0, color);
  if (kind === 'repair') {
    box('repair-cross-x', 0.42, 0.055, 0.12, 0, 0.365, 0, bright);
    box('repair-cross-z', 0.12, 0.055, 0.42, 0, 0.365, 0, bright);
  } else if (kind === 'ammo') {
    for (const x of [-0.16, 0, 0.16]) {
      box('ammo-round', 0.075, 0.05, 0.28, x, 0.365, 0, bright);
      box('ammo-tip', 0.045, 0.05, 0.06, x, 0.365, 0.16, bright);
    }
  } else if (kind === 'nitro') {
    box('nitro-bolt-top', 0.12, 0.055, 0.26, 0.05, 0.365, 0.1, bright).rotation.y = -0.48;
    box('nitro-bolt-mid', 0.23, 0.055, 0.1, 0, 0.365, 0, bright);
    box('nitro-bolt-bottom', 0.12, 0.055, 0.26, -0.05, 0.365, -0.1, bright).rotation.y = -0.48;
  } else {
    for (let i = 0; i < 2; i++) {
      const coin = MeshBuilder.CreateCylinder('cash-coins', { diameter: 0.36, height: 0.055, tessellation: 8 }, scene);
      coin.position.set(i ? 0.07 : -0.04, 0.365 + i * 0.055, i ? 0.04 : -0.04);
      add(coin, bright);
    }
  }
  const mesh = Mesh.MergeMeshes(parts, true, true, undefined, false, false);
  if (!mesh) throw new Error('Could not build pickup crate');
  mesh.name = `pickup-${kind}`;
  mesh.material = sharedMaterial;
  mesh.isPickable = false;
  mesh.receiveShadows = true;
  return mesh;
}
