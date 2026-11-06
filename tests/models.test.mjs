// Run: node --test --experimental-test-isolation=none tests/models.test.mjs
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const temporary = await mkdtemp(join(tmpdir(), 'dustline-model-tests-'));
const coreUrl = new URL('../node_modules/@babylonjs/core/index.js', import.meta.url).href;
const { NullEngine, Scene, Mesh, MeshBuilder, TransformNode, Vector3, Color3, FreeCamera, DirectionalLight, ShadowGenerator } = await import(coreUrl);
const engine = new NullEngine({ renderWidth: 256, renderHeight: 256, textureSize: 128 });
after(async () => {
  engine.dispose();
  assert.equal(dirname(resolve(temporary)), resolve(tmpdir()));
  assert.ok(basename(temporary).startsWith('dustline-model-tests-'));
  await rm(temporary, { recursive: true, force: true });
});

// Absolute package URLs let the temporary modules use the installed engine
// without installing packages or depending on temp-directory module lookup.
for (const name of ['types', 'gameplay', 'vehicle-fleet', 'vehicle-concepts', 'special-vehicles', 'police-water', 'pickups', 'vehicles', 'effects', 'render-quality']) {
  const source = await readFile(new URL(`../src/${name}.ts`, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  const javascript = outputText
    .replace(/(['"])@babylonjs\/core\1/g, JSON.stringify(coreUrl))
    .replace(/(from\s+['"]\.\/[^'"]+)(['"])/g, '$1.mjs$2');
  await writeFile(join(temporary, `${name}.mjs`), javascript);
}
const { CARS } = await import(pathToFileURL(join(temporary, 'types.mjs')).href);
const { CIVILIAN_FLEET } = await import(pathToFileURL(join(temporary, 'vehicle-fleet.mjs')).href);
const { policeSpec } = await import(pathToFileURL(join(temporary, 'gameplay.mjs')).href);
const { createVehicle } = await import(pathToFileURL(join(temporary, 'vehicles.mjs')).href);
const { createHelicopter } = await import(pathToFileURL(join(temporary, 'effects.mjs')).href);
const { createPatrolBoat } = await import(pathToFileURL(join(temporary, 'special-vehicles.mjs')).href);
const { createPoliceWater } = await import(pathToFileURL(join(temporary, 'police-water.mjs')).href);
const { createSupply, PICKUP_INFO } = await import(pathToFileURL(join(temporary, 'pickups.mjs')).href);
const { qualityProfile } = await import(pathToFileURL(join(temporary, 'render-quality.mjs')).href);

test('moving world shadows keep their texture and light matrix in the same frame', () => {
  for (const [quality, level] of [['balanced', 0], ['quality', 0], ['auto', 0], ['auto', 1]]) {
    const scene = new Scene(engine);
    try {
      const camera = new FreeCamera('shadow-test-camera', new Vector3(10, 10, -10), scene);
      camera.setTarget(Vector3.Zero());
      const sun = new DirectionalLight('moving-sun', new Vector3(-.5, -1, .35), scene);
      sun.position.set(40, 70, -35);
      const shadows = new ShadowGenerator(128, sun);
      const caster = MeshBuilder.CreateBox('moving-caster', {}, scene);
      shadows.addShadowCaster(caster);
      const map = shadows.getShadowMap();
      map.refreshRate = qualityProfile(quality, level).shadowRefreshRate;
      // Keep Babylon's render-target scheduling, but skip GPU shader readiness in
      // NullEngine. Capture the transform that would be baked into each texture.
      map.customIsReadyFunction = () => true;
      let textureTransform;
      map.customRenderFunction = () => { textureTransform = shadows.getTransformMatrix().clone(); };
      for (let frame = 0; frame < 4; frame++) {
        sun.position.x += 1; caster.position.x += 1;
        scene.render();
        assert.ok(textureTransform?.equals(shadows.getTransformMatrix()), `${quality}/${level}, frame ${frame}: stale shadow texture`);
      }
    } finally { scene.dispose(); }
  }
});

const sceneFor = () => new Scene(engine);
const near = (actual, expected, tolerance = 2e-4) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected} by more than ${tolerance}`);
const activeMeshes = root => root.getChildMeshes().filter(mesh => mesh.isEnabled() && mesh.isVisible);
function validateGeometry(mesh) {
  assert.ok(mesh instanceof Mesh && !mesh.isDisposed(), `disposed or invalid mesh: ${mesh.name}`);
  const positions = mesh.getVerticesData('position'), normals = mesh.getVerticesData('normal'), indices = mesh.getIndices();
  assert.ok(positions?.length > 0 && positions.length % 3 === 0, `${mesh.name}: missing positions`);
  assert.equal(normals?.length, positions.length, `${mesh.name}: missing normals`);
  assert.ok(indices?.length > 0 && indices.length % 3 === 0, `${mesh.name}: missing triangles`);
  assert.ok(Array.from(positions).every(Number.isFinite), `${mesh.name}: non-finite positions`);
  assert.ok(Array.from(normals).every(Number.isFinite), `${mesh.name}: non-finite normals`);
  assert.ok(Array.from(indices).every(index => Number.isInteger(index) && index >= 0 && index < positions.length / 3), `${mesh.name}: invalid triangle index`);
}
function worldVertices(meshes) {
  const result = [];
  for (const mesh of meshes) {
    mesh.computeWorldMatrix(true);
    const values = mesh.getVerticesData('position');
    for (let i = 0; i < values.length; i += 3) {
      const world = Vector3.TransformCoordinates(new Vector3(values[i], values[i + 1], values[i + 2]), mesh.getWorldMatrix());
      result.push(world.x, world.y, world.z);
    }
  }
  return result;
}
function compareVertices(before, after) {
  assert.equal(after.length, before.length, 'detachment changed the number of vertices');
  // Detached child meshes are flattened, which changes traversal order. Match
  // the world-space vertex multiset with a spatial hash, including duplicates.
  const tolerance=2e-4,buckets=new Map();
  const key=p=>p.map(value=>Math.floor(value/tolerance)).join(',');
  for(let i=0;i<before.length;i+=3){const point=before.slice(i,i+3),id=key(point),bucket=buckets.get(id)??[];bucket.push(point);buckets.set(id,bucket);}
  for(let i=0;i<after.length;i+=3){
    const point=after.slice(i,i+3),cell=point.map(value=>Math.floor(value/tolerance));let found=false;
    search:for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++){
      const bucket=buckets.get([cell[0]+x,cell[1]+y,cell[2]+z].join(','));if(!bucket)continue;
      const index=bucket.findIndex(candidate=>candidate.every((value,axis)=>Math.abs(value-point[axis])<=tolerance));
      if(index>=0){bucket.splice(index,1);found=true;break search;}
    }
    assert.ok(found,`detached vertex has no world-space match: ${point.join(', ')}`);
  }
  assert.ok([...buckets.values()].every(bucket=>!bucket.length));
}
function disposeDebris(meshes) {
  for (const mesh of meshes) mesh.dispose(false, true);
}
function assertNoModelLeaks(scene) {
  assert.equal(scene.meshes.length, 0, 'a disposed model or fragment left meshes in the scene');
  const uniqueMaterials = scene.materials.filter(material => material.name !== 'shared-compact-vehicle-colors' && material.name !== 'default material');
  assert.deepEqual(uniqueMaterials.map(material => material.name), [], 'per-vehicle or per-fragment materials leaked');
}

test('all player cars have finite geometry, independent wheels and batched static parts', () => {
  const scene = sceneFor();
  try {
    assert.equal(new Set(CARS.map(car => car.bodyStyle)).size, 7);
    const heights = new Map();
    for (const car of CARS) {
      const vehicle = createVehicle(scene, car, car.color);
      vehicle.root.getChildMeshes().forEach(validateGeometry);
      assert.equal(vehicle.wheels.length, 4);
      assert.equal(new Set(vehicle.wheels).size, 4);
      assert.ok(vehicle.exhausts.length >= 1 && vehicle.exhausts.every(marker => marker.parent === vehicle.chassis));
      assert.ok(vehicle.wheels.every(wheel => wheel.getChildMeshes().length >= 2));
      assert.ok(activeMeshes(vehicle.root).length < 45, `${car.id} regressed to hundreds of draw calls`);
      const bounds = vehicle.root.getHierarchyBoundingVectors(true);
      assert.ok([bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z].every(Number.isFinite));
      assert.ok(bounds.max.z - bounds.min.z > 2.5);
      heights.set(car.bodyStyle, bounds.max.y);
      vehicle.dispose();
      assertNoModelLeaks(scene);
    }
    assert.ok(heights.get('suv') > heights.get('hatch'));
    assert.ok(heights.get('van') > heights.get('coupe') + .5, 'van must be a distinct silhouette');
  } finally { scene.dispose(); }
});

test('new traffic and police variants keep finite geometry, bounded meshes and repairable compact models', () => {
  const scene = sceneFor();
  try {
    assert.equal(CIVILIAN_FLEET.length,12);
    assert.equal(new Set(CIVILIAN_FLEET.map(car=>car.visualVariant)).size,12);
    const expandedPolice=[policeSpec('patrol',1),policeSpec('suv',1),policeSpec('swat',1),policeSpec('swat',2)];
    for(const car of [...CIVILIAN_FLEET,...expandedPolice]){
      const vehicle=createVehicle(scene,car,car.color,car.policeRole?'police':'traffic');
      vehicle.root.getChildMeshes().forEach(validateGeometry);
      assert.equal(vehicle.wheels.length,4+(car.extraAxles??0)*2,car.id);
      assert.ok(activeMeshes(vehicle.root).length<=62,`${car.id} exceeded the full model draw budget`);
      const vertices=activeMeshes(vehicle.root).reduce((n,m)=>n+m.getTotalVertices(),0);
      assert.ok(vertices<25000,`${car.id} has ${vertices} vertices`);
      if(car.visualVariant==='apc'){
        const window=vehicle.root.getChildMeshes().find(mesh=>mesh.name==='windscreen');
        const bounds=window.getBoundingInfo().boundingBox;
        assert.ok(bounds.maximum.y-bounds.minimum.y<.24,'APC must have narrow vision slits');
        assert.equal(window.getTotalVertices(),8,'APC uses two separate front apertures');
      }
      vehicle.setCompact(true);
      assert.equal(activeMeshes(vehicle.root).length,1,`${car.id} lost its one-mesh traffic representation`);
      vehicle.setDamage(.2,.3);
      const debris=vehicle.popDebris();
      assert.ok(debris.some(mesh=>mesh.metadata.panel==='detachable-hood'));
      vehicle.setDamage(1,1);
      assert.equal(activeMeshes(vehicle.root).length,1,'repair should restore compact mode');
      vehicle.setCompact(false);
      if(car.visualVariant==='convertible')assert.equal(vehicle.root.getChildMeshes().find(mesh=>mesh.name==='rear-window').isEnabled(),false,'repair must not add a rear window to an open car');
      vehicle.dispose();disposeDebris(debris);assertNoModelLeaks(scene);
    }
  } finally {scene.dispose();}
});

test('the new COMET is low and broad while the three new player silhouettes stay distinct',()=>{
  const scene=sceneFor();
  try{
    const comet=createVehicle(scene,CARS.find(c=>c.id==='comet'),'#70bda9');
    const points=worldVertices(activeMeshes(comet.root)),xs=points.filter((_,i)=>i%3===0),ys=points.filter((_,i)=>i%3===1);
    assert.ok(Math.max(...xs)-Math.min(...xs)>1.95,'hatch needs a broad stance');
    assert.ok(Math.max(...ys)<1.75,'hatch should not be tall and narrow');
    comet.dispose();
    const counts=[];
    for(const id of ['metro','pulse','nomad']){
      const car=CARS.find(c=>c.id===id);assert.ok(car);
      const vehicle=createVehicle(scene,car,car.color);
      counts.push(activeMeshes(vehicle.root).reduce((n,m)=>n+m.getTotalVertices(),0));vehicle.dispose();
    }
    assert.equal(new Set(counts).size,3,'new cars must have different geometry');assertNoModelLeaks(scene);
  }finally{scene.dispose();}
});

test('near/far changes reuse compact geometry and damaged vehicles remain batched',()=>{
  const scene=sceneFor();
  try{
    const car=CARS[0],vehicle=createVehicle(scene,car,car.color,'traffic');
    vehicle.setCompact(true);const compact=activeMeshes(vehicle.root)[0];
    for(let i=0;i<20;i++){vehicle.setCompact(false);vehicle.setCompact(true);assert.equal(activeMeshes(vehicle.root)[0],compact);}
    vehicle.setDamage(.4,.8);const debris=vehicle.popDebris(),damaged=activeMeshes(vehicle.root)[0];
    assert.ok(compact.isDisposed(),'damage invalidates old geometry');assert.equal(activeMeshes(vehicle.root).length,1,'damaged distant car should remain one draw');
    for(let i=0;i<20;i++)vehicle.setDamage(.4,.8);
    assert.equal(activeMeshes(vehicle.root)[0],damaged,'unchanged damage should not rebuild');
    vehicle.setCompact(false);assert.equal(vehicle.root.getChildMeshes().find(mesh=>mesh.name==='detachable-left-door').isEnabled(),false,'LOD restores actual damaged state');
    vehicle.dispose();disposeDebris(debris);assertNoModelLeaks(scene);
  }finally{scene.dispose();}
});

test('motorcycle has two centreline wheels; boat and bike stay below eight draw calls',()=>{
  const scene=sceneFor();
  try{
    const motorcycle=createVehicle(scene,{...policeSpec('patrol'),id:'police-motorcycle',visualVariant:'motorcycle',width:.96,length:2.7},'#e1e5dc','police');
    assert.equal(motorcycle.wheels.length,2);for(const wheel of motorcycle.wheels)near(wheel.parent.position.x,0);
    assert.ok(motorcycle.wheels[0].parent.position.z>0&&motorcycle.wheels[1].parent.position.z<0);
    for(const visual of[motorcycle,createPatrolBoat(scene)]){
      visual.root.getChildMeshes().forEach(validateGeometry);assert.ok(activeMeshes(visual.root).length<8);assert.ok(activeMeshes(visual.root).reduce((n,m)=>n+m.getTotalIndices()/3,0)<3000);
      visual.setCompact(true);assert.equal(activeMeshes(visual.root).length,1);visual.setDamage(.2,.3);disposeDebris(visual.popDebris());assert.equal(activeMeshes(visual.root).length,1);visual.setDamage(1,1);visual.setCompact(false);assert.ok(activeMeshes(visual.root).length>=3);visual.dispose();
    }
    assertNoModelLeaks(scene);
  }finally{scene.dispose();}
});

test('police boats obey water boundaries, LOS, EMP suppression, population and respawn limits',()=>{
  const scene=sceneFor();
  try{
    let shots=0,deaths=0,clearSight=true,scans=0;
    const fleet=createPoliceWater(scene,{onFire(){shots++;},onDestroyed(){deaths++;},lineOfSight(){return clearSight;}});
    const meshes=[0,40,80].map((x,i)=>{const mesh=new Mesh('basin-'+i,scene);mesh.metadata={waterBounds:{centerX:x,centerZ:0,halfWidth:11,halfDepth:8}};return mesh;});
    const props=meshes.map((mesh,i)=>({id:'basin-'+i,x:i*40,z:0,radius:12.5,active:true,kind:'harbour-basin',mesh}));
    const world={propsNear(){scans++;return props;}},player=new Vector3(12,0,11);
    fleet.update(.1,player,1,world);assert.equal(fleet.boats.length,0);
    for(let i=0;i<150;i++)fleet.update(.1,player,5,world);
    assert.equal(fleet.boats.length,2);assert.ok(shots>0);assert.ok(scans<20,'world queried at 1Hz, not each frame');
    for(const boat of fleet.boats){assert.ok(Math.abs(boat.visual.root.position.x-boat.bounds.centerX)<=boat.bounds.halfWidth-3+.001);assert.ok(Math.abs(boat.visual.root.position.z-boat.bounds.centerZ)<=boat.bounds.halfDepth-3+.001);}
    const before=shots,at=fleet.boats[0].visual.root.position.clone();for(let i=0;i<30;i++)fleet.update(.1,player,5,world,true,true);assert.equal(shots,before);near(Vector3.Distance(at,fleet.boats[0].visual.root.position),0);
    const otherAt=fleet.boats[1].visual.root.position.clone(),farPlayer=new Vector3(65,0,11),empCenter=at.add(new Vector3(-12,0,0));
    assert.ok(Vector3.Distance(otherAt,empCenter)>28);
    for(let i=0;i<10;i++)fleet.update(.1,farPlayer,5,world,true,empCenter);
    near(Vector3.Distance(at,fleet.boats[0].visual.root.position),0);assert.ok(Vector3.Distance(otherAt,fleet.boats[1].visual.root.position)>1,'EMP must not freeze boats beyond28m');
    const afterLocalEmp=shots;
    clearSight=false;for(let i=0;i<30;i++)fleet.update(.1,player,5,world);assert.equal(shots,afterLocalEmp);
    const dead=fleet.boats[0],basin=dead.basinId;fleet.hit(dead,500);fleet.hit(dead,500);assert.equal(deaths,1);
    for(let i=0;i<100;i++)fleet.update(.1,player,5,world);assert.ok(!fleet.boats.some(b=>b.basinId===basin));
    fleet.update(.1,player,5,world,false);assert.equal(fleet.boats.length,0);fleet.dispose();meshes.forEach(m=>m.dispose());assertNoModelLeaks(scene);
  }finally{scene.dispose();}
});

test('all twelve pickups share geometry and label resources across respawns',()=>{
  // NullEngine has no DOM; label painting needs only these canvas operations.
  const previous=globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas=class{constructor(width,height){this.width=width;this.height=height;}getContext(){return {clearRect(){},fillRect(){},strokeRect(){},fillText(){}};}};
  const scene=sceneFor();
  try{
    assert.equal(Object.keys(PICKUP_INFO).length,12);
    for(const kind of Object.keys(PICKUP_INFO)){
      const first=createSupply(scene,kind),second=createSupply(scene,kind),a=activeMeshes(first.root),b=activeMeshes(second.root);
      assert.equal(a.length,2);assert.equal(b.length,2);a.forEach(validateGeometry);b.forEach(validateGeometry);
      for(let i=0;i<2;i++){assert.equal(a[i].geometry,b[i].geometry,'spawn should reuse geometry');assert.equal(a[i].material,b[i].material,'spawn should reuse material');}
      first.dispose();b.forEach(validateGeometry);second.update(3);assert.ok(Number.isFinite(second.root.position.y));second.dispose();
    }
    for(const kind of ['drone','spikes']){
      const pickup=createSupply(scene,kind),deployed=createSupply(scene,kind,'equipment');
      assert.ok(activeMeshes(deployed.root)[0].getTotalVertices()<activeMeshes(pickup.root)[0].getTotalVertices(),'deployed equipment must omit the pickup pedestal');
      deployed.dispose();pickup.dispose();
    }
    const geometries=scene.geometries.length,materials=scene.materials.length,textures=scene.textures.length;
    for(let i=0;i<20;i++){const supply=createSupply(scene,'emp');supply.dispose();}
    assert.equal(scene.geometries.length,geometries);assert.equal(scene.materials.length,materials);assert.equal(scene.textures.length,textures);
    assert.equal(scene.meshes.filter(m=>m.isEnabled()).length,0,'only disabled templates may remain after despawn');
  }finally{scene.dispose();if(previous===undefined)delete globalThis.OffscreenCanvas;else globalThis.OffscreenCanvas=previous;}
});

test('four police roles retain distinct bodies, light bars and valid geometry', () => {
  const scene = sceneFor();
  try {
    const heights = new Map();
    for (const role of ['patrol', 'interceptor', 'suv', 'swat']) {
      const spec = policeSpec(role), vehicle = createVehicle(scene, spec, spec.color, 'police');
      vehicle.root.getChildMeshes().forEach(validateGeometry);
      assert.ok(activeMeshes(vehicle.root).some(mesh => mesh.material?.name === 'police-red'));
      assert.ok(activeMeshes(vehicle.root).some(mesh => mesh.material?.name === 'police-blue'));
      assert.equal(vehicle.turret.getChildMeshes().length, 0, 'police use a light bar, not player equipment');
      vehicle.setTurretEnabled(true);
      assert.equal(vehicle.turret.getChildMeshes().length, 0);
      heights.set(role, vehicle.root.getHierarchyBoundingVectors(true).max.y);
      vehicle.dispose();
      assertNoModelLeaks(scene);
    }
    assert.ok(heights.get('interceptor') < heights.get('suv'));
    assert.ok(heights.get('swat') > heights.get('patrol') + .5);
  } finally { scene.dispose(); }
});

test('turret is optional, and equipment or repainting invalidates the compact representation', () => {
  const scene = sceneFor();
  try {
    for (const car of CARS) {
      const vehicle = createVehicle(scene, car, car.color);
      assert.equal(vehicle.turret.isEnabled(), false, `${car.id} has free equipment by default`);
      vehicle.setCompact(true);
      assert.equal(vehicle.chassis.isEnabled(), false);
      assert.equal(activeMeshes(vehicle.root).length, 1);
      const oldCompact = activeMeshes(vehicle.root)[0], baseVertices = oldCompact.getTotalVertices();
      vehicle.setTurretEnabled(true);
      assert.ok(oldCompact.isDisposed(), 'equipment changed without rebuilding compact geometry');
      const equippedCompact = activeMeshes(vehicle.root)[0];
      assert.ok(equippedCompact.getTotalVertices() > baseVertices);
      vehicle.setColor('#426e83');
      assert.ok(equippedCompact.isDisposed(), 'repaint left stale baked vertex colours');
      const compact = activeMeshes(vehicle.root)[0], colors = compact.getVerticesData('color'), wanted = Color3.FromHexString('#426e83');
      let found = false;
      for (let i = 0; i < colors.length; i += 4) if (Math.abs(colors[i] - wanted.r) < 1e-6 && Math.abs(colors[i + 1] - wanted.g) < 1e-6 && Math.abs(colors[i + 2] - wanted.b) < 1e-6) { found = true; break; }
      assert.ok(found, 'chosen paint never reached rendered compact geometry');
      vehicle.setCompact(false);
      assert.equal(vehicle.chassis.isEnabled(), true);
      assert.equal(vehicle.turret.isEnabled(), true);
      assert.ok(vehicle.turret.getChildren().some(node => node.name === 'turret-elevation'));
      vehicle.setTurretEnabled(false);
      assert.equal(vehicle.turret.isEnabled(), false);
      vehicle.dispose();
      assertNoModelLeaks(scene);
    }
  } finally { scene.dispose(); }
});

test('damage releases semantic panels without transform jumps, and repair restores every body style', () => {
  const scene = sceneFor();
  try {
    for (const car of CARS) {
      const parent = new TransformNode(`test-physics-parent-${car.id}`, scene);
      parent.position.set(10, 2, -7); parent.rotation.set(.10, .60, -.05); parent.scaling.set(1.4, .9, 1.1);
      const vehicle = createVehicle(scene, car, car.color); vehicle.root.parent = parent;
      vehicle.root.position.set(.4, .3, .5); vehicle.chassis.rotation.set(.11, 0, .07);
      vehicle.setDamage(.60, .55);
      const glassFragments = vehicle.popDebris(); assert.ok(glassFragments.length >= 3);
      disposeDebris(glassFragments);
      const leftDoor = vehicle.root.getChildMeshes().find(mesh => mesh.name === 'detachable-left-door');
      assert.ok(leftDoor?.isEnabled());
      const original = worldVertices([leftDoor, ...leftDoor.getChildMeshes()]);
      vehicle.setDamage(.40, .45);
      const early = vehicle.popDebris(), detachedDoor = early.find(mesh => mesh.metadata?.panel === 'detachable-left-door');
      assert.ok(detachedDoor && detachedDoor.parent === null);
      assert.equal(leftDoor.isEnabled(), false);
      compareVertices(original, worldVertices([detachedDoor, ...detachedDoor.getChildMeshes()]));
      early.forEach(validateGeometry);
      vehicle.setDamage(.20, .35);
      const later = vehicle.popDebris(); assert.ok(later.some(mesh => mesh.metadata?.panel === 'detachable-hood'));
      assert.ok(later.some(mesh => mesh.metadata?.panel === 'detachable-right-door'));
      assert.deepEqual(vehicle.popDebris(), [], 'fragments were emitted twice');
      vehicle.setDamage(1, 1);
      assert.equal(leftDoor.isEnabled(), true);
      for (const wheel of vehicle.wheels) near(wheel.parent.scaling.y, 1);
      assert.ok(vehicle.root.getChildMeshes().find(mesh => mesh.name === 'detachable-hood').isEnabled());
      const fragments = [...early, ...later], materials = new Set(fragments.flatMap(mesh => [mesh, ...mesh.getChildMeshes()]).map(mesh => mesh.material));
      vehicle.dispose();
      assert.ok(fragments.every(mesh => !mesh.isDisposed()), 'destroying the car destroyed released fragments');
      assert.ok([...materials].every(material => scene.materials.includes(material)), 'destroying the car invalidated fragment materials');
      disposeDebris(fragments); parent.dispose();
      assertNoModelLeaks(scene);
    }
  } finally { scene.dispose(); }
});

test('helicopter releases five independent world-space fragments once and cleans up their materials', () => {
  const scene = sceneFor();
  try {
    const alive = createHelicopter(scene), crashed = createHelicopter(scene);
    const parent = new TransformNode('tilted-helicopter-parent', scene);
    parent.position.set(12, 8, -7); parent.rotation.set(.15, .35, -.1); parent.scaling.set(1.2, .85, 1.1);
    crashed.root.parent = parent; crashed.root.position.set(.3, 1.2, -.2); crashed.root.rotation.set(.4, .7, .2); crashed.rotor.rotation.y = 1.2;
    crashed.root.getChildMeshes().forEach(validateGeometry);
    crashed.beginCrash(); crashed.beginCrash();
    assert.equal(crashed.root.metadata.crashing, true);
    const groups = new Map([['hull', crashed.hull], ['tail', crashed.tail], ['main-rotor', crashed.rotor], ['left-skid', crashed.skids[0]], ['right-skid', crashed.skids[1]]]);
    const before = new Map([...groups].map(([name, node]) => [name, worldVertices(node.getChildMeshes().filter(mesh => mesh.isEnabled()))]));
    const aliveMaterials = new Set(alive.root.getChildMeshes().map(mesh => mesh.material));
    let aliveDisposals = 0; for (const material of aliveMaterials) material.onDisposeObservable.add(() => aliveDisposals++);
    const fragments = crashed.releaseDebris();
    assert.equal(fragments.length, 5);
    assert.deepEqual(new Set(fragments.map(mesh => mesh.metadata.part)), new Set(groups.keys()));
    assert.deepEqual(crashed.releaseDebris(), []);
    assert.equal(crashed.root.isEnabled(), false);
    const ownedMaterials = new Set(fragments.map(mesh => mesh.material)), disposedMaterials = new Set();
    assert.equal(ownedMaterials.size, 5, 'fragment materials must not be shared');
    for (const mesh of fragments) {
      validateGeometry(mesh);
      assert.equal(mesh.parent, null);
      assert.ok(mesh.metadata.debrisMass > 0);
      assert.ok(!aliveMaterials.has(mesh.material));
      compareVertices(before.get(mesh.metadata.part), worldVertices([mesh]));
      mesh.material.onDisposeObservable.add(() => disposedMaterials.add(mesh.material));
    }
    crashed.dispose(); crashed.dispose();
    assert.ok(fragments.every(mesh => !mesh.isDisposed()));
    assert.ok([...ownedMaterials].every(material => scene.materials.includes(material)));
    assert.equal(disposedMaterials.size, 0);
    disposeDebris(fragments);
    assert.equal(disposedMaterials.size, 5);
    assert.equal(aliveDisposals, 0, 'fragment cleanup disposed a live helicopter material');
    alive.root.getChildMeshes().forEach(validateGeometry);
    alive.dispose(); parent.dispose();
    assert.equal(aliveDisposals, aliveMaterials.size);
    assertNoModelLeaks(scene);
  } finally { scene.dispose(); }
});
