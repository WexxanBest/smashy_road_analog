import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3, VertexBuffer, VertexData, Matrix } from '@babylonjs/core';
import { conceptBox } from './vehicle-concepts';

interface Particle {
  mesh: Mesh;
  velocity: Vector3;
  life: number;
  duration: number;
  kind: 'spark' | 'smoke' | 'tracer';
  size: number;
}

export function createEffects(scene: Scene): {
  burst(position: Vector3, color: string, count?: number, power?: number): void;
  smoke(position: Vector3, dark?: boolean): void;
  tracer(from: Vector3, to: Vector3): void;
  update(dt: number): void;
  dispose(): void;
} {
  const materialCache = new Map<string, StandardMaterial>();
  function material(hex: string, smoke = false): StandardMaterial {
    const key = smoke ? 'smoke-' + hex : hex;
    let mat = materialCache.get(key);
    if (mat) return mat;
    mat = new StandardMaterial(`effect-${key}`, scene);
    mat.diffuseColor = Color3.FromHexString(hex);
    mat.specularColor = Color3.Black();
    if (smoke) {
      mat.emissiveColor = mat.diffuseColor.scale(0.08);
      mat.alpha = 0.57;
    } else {
      mat.disableLighting = true;
      mat.emissiveColor = mat.diffuseColor.clone();
    }
    materialCache.set(key, mat);
    return mat;
  }
  const smokeMaterial = material('#78817d', true);
  const darkSmokeMaterial = material('#282e2a', true);
  darkSmokeMaterial.alpha = 0.34;
  const tracerMaterial = material('#fff1ad');
  const seedMesh = MeshBuilder.CreateBox('effect-pool-source', { size: 1 }, scene);
  seedMesh.isPickable = false;
  seedMesh.setEnabled(false);
  const particles: Particle[] = [];
  for (let i = 0; i < 160; i++) {
    const mesh = seedMesh.clone(`effect-${i}`, null);
    mesh.isPickable = false;
    mesh.receiveShadows = false;
    mesh.material = tracerMaterial;
    mesh.setEnabled(false);
    particles.push({ mesh, velocity: Vector3.Zero(), life: 0, duration: 1, kind: 'spark', size: 0.1 });
  }
  let cursor = 0;
  let disposed = false;
  function take(kind: Particle['kind'], position: Vector3, life: number, size: number, mat: StandardMaterial): Particle {
    const p = particles[cursor];
    cursor = (cursor + 1) % particles.length;
    p.kind = kind;
    p.duration = life;
    p.life = life;
    p.size = size;
    p.mesh.material = mat;
    p.mesh.position.copyFrom(position);
    p.mesh.rotation.set(0, 0, 0);
    p.mesh.scaling.setAll(size);
    p.mesh.visibility = 1;
    p.mesh.setEnabled(true);
    p.velocity.set(0, 0, 0);
    return p;
  }
  return {
    burst(position: Vector3, color: string, count = 18, power = 5): void {
      if (disposed) return;
      const mat = material(color);
      const total = Math.max(0, Math.min(160, Math.floor(count)));
      for (let i = 0; i < total; i++) {
        const p = take('spark', position, 0.32 + Math.random() * 0.46, 0.07 + Math.random() * 0.13, mat);
        const angle = Math.random() * Math.PI * 2;
        const speed = power * (0.3 + Math.random() * 0.7);
        p.velocity.set(Math.cos(angle) * speed, power * (0.2 + Math.random() * 0.65), Math.sin(angle) * speed);
        p.mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      }
    },
    smoke(position: Vector3, dark = false): void {
      if (disposed) return;
      const p = take('smoke', position, 0.9 + Math.random() * 0.4, dark ? 0.4 + Math.random() * 0.2 : 0.15 + Math.random() * 0.13, dark ? darkSmokeMaterial : smokeMaterial);
      p.velocity.set((Math.random() - 0.5) * 0.6, (dark ? 1.5 : 0.65) + Math.random() * 0.65, (Math.random() - 0.5) * 0.6);
      p.mesh.rotation.set(Math.random(), Math.random(), Math.random());
    },
    tracer(from: Vector3, to: Vector3): void {
      if (disposed) return;
      const p = take('tracer', from, 0.07, 0.035, tracerMaterial);
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const dz = to.z - from.z;
      const horizontal = Math.sqrt(dx * dx + dz * dz);
      const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
      p.mesh.position.set((from.x + to.x) * 0.5, (from.y + to.y) * 0.5, (from.z + to.z) * 0.5);
      p.mesh.scaling.set(0.035, 0.035, Math.max(0.04, length));
      p.mesh.rotation.set(-Math.atan2(dy, horizontal), Math.atan2(dx, dz), 0);
    },
    update(dt: number): void {
      if (disposed) return;
      const step = Math.max(0, Math.min(dt, 0.06));
      for (const p of particles) {
        if (p.life <= 0) continue;
        p.life -= step;
        if (p.life <= 0) {
          p.mesh.setEnabled(false);
          continue;
        }
        const ratio = p.life / p.duration;
        if (p.kind === 'tracer') {
          p.mesh.visibility = Math.min(1, ratio * 3);
          continue;
        }
        p.mesh.position.addInPlaceFromFloats(p.velocity.x * step, p.velocity.y * step, p.velocity.z * step);
        if (p.kind === 'smoke') {
          const size = p.size + (1 - ratio) * 0.75;
          p.mesh.scaling.setAll(size);
          p.mesh.visibility = Math.min(0.85, ratio * 1.3);
          p.mesh.rotation.y += step * 0.2;
        } else {
          p.velocity.y -= step * 11;
          p.velocity.x *= 1 - step * 0.7;
          p.velocity.z *= 1 - step * 0.7;
          if (p.mesh.position.y < 0.04) {
            p.mesh.position.y = 0.04;
            p.velocity.y = Math.abs(p.velocity.y) * 0.28;
          }
          p.mesh.rotation.x += step * 4;
          p.mesh.rotation.z += step * 3;
          p.mesh.scaling.setAll(p.size * Math.min(1, ratio * 3));
          p.mesh.visibility = Math.min(1, ratio * 4);
        }
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const p of particles) p.mesh.dispose(false, false);
      seedMesh.dispose(false, false);
      for (const mat of materialCache.values()) mat.dispose();
      materialCache.clear();
    },
  };
}

export interface HelicopterVisual {
  root: TransformNode;
  rotor: TransformNode;
  hull: TransformNode;
  tail: TransformNode;
  skids: TransformNode[];
  beginCrash(): void;
  releaseDebris(): Mesh[];
  dispose(): void;
}

/** Separate semantic groups survive material batching: the caller owns the crash
 * trajectory, rotor speed and the physics/lifetime of released fragments. */
export function createHelicopter(scene: Scene): HelicopterVisual {
  const root=new TransformNode('police-helicopter',scene);
  const hullGroup=new TransformNode('helicopter-hull',scene);hullGroup.parent=root;
  const tailGroup=new TransformNode('helicopter-tail',scene);tailGroup.parent=root;tailGroup.position.set(0,.10,-1.18);
  const rotor=new TransformNode('helicopter-main-rotor',scene);rotor.parent=root;rotor.position.set(0,1.01,-.17);
  const skidGroups=[-1,1].map(side=>{const node=new TransformNode(side<0?'helicopter-left-skid':'helicopter-right-skid',scene);node.parent=root;node.position.set(side*.92,-.84,.03);return node;});
  const semantic=[{node:hullGroup,id:'hull',mass:90},{node:tailGroup,id:'tail',mass:20},{node:rotor,id:'main-rotor',mass:12},{node:skidGroups[0],id:'left-skid',mass:8},{node:skidGroups[1],id:'right-skid',mass:8}];
  const materials:StandardMaterial[]=[],weapons:Mesh[]=[];
  const batches=new Map<TransformNode,Map<StandardMaterial,Mesh[]>>();
  function material(name:string,hex:string):StandardMaterial {
    const mat=new StandardMaterial(name,scene);mat.diffuseColor=Color3.FromHexString(hex);mat.specularColor=new Color3(.12,.14,.13);mat.backFaceCulling=false;materials.push(mat);return mat;
  }
  const hull=material('helicopter-charcoal','#384640'),trim=material('helicopter-trim','#202a27'),canopy=material('helicopter-canopy','#203d42'),stripe=material('helicopter-ivory','#d9dfca'),red=material('helicopter-warning','#ed6949');
  canopy.specularColor=new Color3(.25,.37,.35);red.emissiveColor=new Color3(.5,.06,.01);
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
  const sections=[{z:1.40,w:1.12,lo:-.25,hi:.20},{z:.50,w:1.75,lo:-.55,hi:.60},{z:-1.0,w:1.05,lo:-.35,hi:.38},{z:-1.40,w:.42,lo:-.15,hi:.20}];
  const rings=sections.map(s=>[[-s.w/2+.10,s.lo,s.z],[s.w/2-.10,s.lo,s.z],[s.w/2,s.lo+.10,s.z],[s.w/2,s.hi-.10,s.z],[s.w/2-.10,s.hi,s.z],[-s.w/2+.10,s.hi,s.z],[-s.w/2,s.hi-.10,s.z],[-s.w/2,s.lo+.10,s.z]]);
  const faces:number[][][]=[rings[0],rings.at(-1)!.slice().reverse()];for(let r=0;r<rings.length-1;r++)for(let i=0;i<8;i++){const j=(i+1)%8;faces.push([rings[r][i],rings[r+1][i],rings[r+1][j],rings[r][j]]);}poly('faceted-fuselage',faces,hull);
  poly('sloped-helicopter-windscreen',[[[-.48,.02,1.42],[.48,.02,1.42],[.67,.46,.86],[-.67,.46,.86]]],canopy);
  box('windscreen-divider',.045,.56,.055,0,.24,1.15,hull).rotation.x=-.87;
  box('belly-armor',1.12,.19,1.75,0,-.48,-.04,trim);
  box('engine-cowling',.94,.34,1.17,0,.66,-.40,hull);
  const boom=MeshBuilder.CreateCylinder('tapered-tail-boom',{diameterTop:.43,diameterBottom:.15,height:2.52,tessellation:8},scene);boom.rotation.x=Math.PI/2;boom.rotation.z=.03;boom.position.set(0,.04,-1.16);register(boom,hull,tailGroup);
  box('vertical-tail-fin',.11,.92,.68,0,.45,-2.23,hull,tailGroup).rotation.x=-.14;
  box('tail-stabilizer',1.15,.075,.43,0,.13,-1.98,stripe,tailGroup);
  box('tail-rotor-vertical',.035,.85,.07,.21,.40,-2.24,trim,tailGroup);
  box('tail-rotor-horizontal',.035,.07,.85,.21,.40,-2.24,trim,tailGroup);
  box('short-wings',3.0,.10,.43,0,-.19,-.17,hull);
  for(const side of [-1,1]) {
    const sideGlass=[[side*.89,-.04,.48],[side*.745,-.04,-.25],[side*.745,.35,-.25],[side*.89,.43,.48]];if(side<0)sideGlass.reverse();poly('side-canopy',[sideGlass],canopy);
    box('door-stripe',.035,.12,.91,side*.83,-.09,-.20,stripe);
    const pod=MeshBuilder.CreateCylinder('helicopter-weapon-pod',{diameter:.25,height:.92,tessellation:8},scene);pod.position.set(side*1.30,-.27,.10);pod.rotation.x=Math.PI/2;register(pod,trim,hullGroup,false);weapons.push(pod);
    box('navigation-light',.11,.09,.09,side*1.46,-.10,-.17,red);
  }
  for(let i=0;i<2;i++) {
    const side=i===0?-1:1,node=skidGroups[i];box('landing-skid',.09,.09,2.48,0,0,0,trim,node);
    box('upturned-skid-tip',.09,.08,.34,0,.055,1.34,trim,node).rotation.x=-.33;
    for(const z of [-.65,.67])box('skid-strut',.075,.60,.075,-side*.16,.28,z,trim,node).rotation.z=side*.53;
  }
  box('rotor-shaft',.09,.36,.09,0,.86,-.17,trim);
  box('rotor-blade-x',5.75,.032,.15,0,0,0,trim,rotor);
  box('rotor-blade-z',.15,.032,5.75,0,0,0,trim,rotor);
  box('rotor-hub',.25,.10,.25,0,.03,0,hull,rotor);

  // Merge inside a part, never across the tail, skids or rotor pivots.
  for(const [parent,map] of batches)for(const [mat,meshes] of map) {
    if(meshes.length<2)continue;parent.computeWorldMatrix(true);const inverse=parent.getWorldMatrix().clone().invert();
    const merged=Mesh.MergeMeshes(meshes,true,true,undefined,false,false);if(!merged)continue;
    merged.parent=null;merged.bakeTransformIntoVertices(inverse);merged.position.setAll(0);merged.rotation.setAll(0);merged.rotationQuaternion=null;merged.scaling.setAll(1);merged.parent=parent;merged.material=mat;merged.isPickable=false;merged.receiveShadows=true;merged.name='helicopter-'+parent.name+'-'+mat.name;
  }
  let disposed=false,crashing=false,released=false;
  return {
    root,rotor,hull:hullGroup,tail:tailGroup,skids:skidGroups,
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
