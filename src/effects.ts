import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3, VertexBuffer } from '@babylonjs/core';

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

export function createHelicopter(scene: Scene): { root: TransformNode; rotor: TransformNode; dispose(): void } {
  const root = new TransformNode('police-helicopter', scene);
  const rotor = new TransformNode('helicopter-rotor', scene);
  rotor.parent = root;
  rotor.position.set(0, 1.01, -0.17);
  const materials: StandardMaterial[] = [];
  const parts = new Map<StandardMaterial, Mesh[]>();
  function material(name: string, hex: string): StandardMaterial {
    const mat = new StandardMaterial(name, scene);
    mat.diffuseColor = Color3.FromHexString(hex);
    mat.specularColor = new Color3(0.12, 0.14, 0.15);
    materials.push(mat);
    return mat;
  }
  const hull = material('helicopter-charcoal', '#38454a');
  const trim = material('helicopter-dark-trim', '#202d33');
  const canopy = material('helicopter-canopy', '#699ba7');
  const stripe = material('helicopter-ivory-marking', '#e3e5d9');
  const red = material('helicopter-warning-red', '#f27154');
  red.emissiveColor = new Color3(0.7, 0.08, 0.015);
  function register(mesh: Mesh, mat: StandardMaterial, parent: TransformNode = root): Mesh {
    mesh.material = mat;
    mesh.parent = parent;
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    if (parent === root) {
      const meshes = parts.get(mat) ?? [];
      meshes.push(mesh);
      parts.set(mat, meshes);
    }
    return mesh;
  }
  function box(name: string, width: number, height: number, depth: number, x: number, y: number, z: number, mat: StandardMaterial, parent: TransformNode = root): Mesh {
    const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, scene);
    mesh.position.set(x, y, z);
    return register(mesh, mat, parent);
  }
  const body = MeshBuilder.CreateSphere('faceted-helicopter-hull', { diameter: 1, segments: 4 }, scene);
  body.scaling.set(1.8, 1.25, 2.8);
  register(body, hull);
  box('cockpit-glass', 1.26, 0.66, 0.82, 0, 0.11, 0.86, canopy).rotation.x = -0.16;
  box('windscreen-divider', 0.055, 0.7, 0.87, 0, 0.11, 0.87, hull).rotation.x = -0.16;
  box('cockpit-brow', 1.34, 0.1, 0.93, 0, 0.46, 0.81, hull);
  box('belly-armor', 1.1, 0.23, 1.8, 0, -0.45, -0.05, trim);
  box('engine-cowling', 1.0, 0.38, 1.22, 0, 0.61, -0.39, hull);
  box('tail-boom', 0.29, 0.32, 2.52, 0, 0.11, -2.3, hull).rotation.x = 0.09;
  box('tail-fin', 0.12, 0.95, 0.74, 0, 0.45, -3.4, hull).rotation.x = -0.14;
  box('tail-stabilizer', 1.12, 0.09, 0.46, 0, 0.12, -3.13, stripe);
  box('short-wings', 3.1, 0.12, 0.45, 0, -0.19, -0.17, hull);
  for (const side of [-1, 1]) {
    box('landing-skid', 0.09, 0.09, 2.62, side * 0.93, -0.85, 0.03, trim);
    for (const z of [-0.65, 0.67]) box('skid-strut', 0.075, 0.6, 0.075, side * 0.75, -0.58, z, trim).rotation.z = side * 0.53;
    box('door-stripe', 0.035, 0.12, 0.95, side * 0.85, -0.05, -0.23, stripe);
    const pod = MeshBuilder.CreateCylinder('weapon-pod', { diameter: 0.25, height: 0.95, tessellation: 8 }, scene);
    pod.position.set(side * 1.33, -0.27, 0.1);
    pod.rotation.x = Math.PI / 2;
    register(pod, trim);
    box('navigation-light', 0.1, 0.09, 0.09, side * 1.51, -0.1, -0.17, red);
  }
  box('rotor-shaft', 0.09, 0.38, 0.09, 0, 0.87, -0.17, trim);
  box('rotor-blade-x', 5.75, 0.035, 0.16, 0, 0, 0, trim, rotor);
  box('rotor-blade-z', 0.16, 0.035, 5.75, 0, 0, 0, trim, rotor);
  box('rotor-hub', 0.24, 0.11, 0.24, 0, 0.02, 0, hull, rotor);
  box('tail-rotor-vertical', 0.035, 0.8, 0.075, 0.21, 0.39, -3.42, trim);
  box('tail-rotor-horizontal', 0.035, 0.075, 0.8, 0.21, 0.39, -3.42, trim);
  for (const [mat, meshes] of parts) {
    const merged = meshes.length === 1 ? meshes[0] : Mesh.MergeMeshes(meshes, true, true, undefined, false, false);
    if (merged) {
      merged.parent = root;
      merged.material = mat;
      merged.isPickable = false;
    }
  }
  let disposed = false;
  return { root, rotor, dispose(): void {
    if (disposed) return;
    disposed = true;
    root.dispose(false, false);
    for (const mat of materials) mat.dispose();
  } };
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
