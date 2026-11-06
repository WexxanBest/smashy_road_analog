import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { NullEngine, Scene, Vector3 } from '@babylonjs/core';
import ts from 'typescript';

// Resource/geometry audit for the expansion. These are not GPU frame-rate measurements.
const temporary = await mkdtemp(join(tmpdir(), 'dustline-variety-'));
try {
  const phase = ['baseline','before-optimization','optimized'].includes(process.argv[2]) ? process.argv[2] : 'after';
  const sourceRoot=process.argv[3]??'src';
  const babylonUrl = pathToFileURL(resolve('node_modules/@babylonjs/core/index.js')).href;
  for (const name of ['world', 'world-interactions']) {
    const source = await readFile(`${sourceRoot}/${name}.ts`, 'utf8');
    const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
    const code = outputText.replace(/(['"])@babylonjs\/core\1/g, JSON.stringify(babylonUrl)).replace(/(from\s+['"]\.\/[^'"]+)(['"])/g, '$1.mjs$2');
    await writeFile(join(temporary, name + '.mjs'), code);
  }
  const { createWorld } = await import(pathToFileURL(join(temporary, 'world.mjs')).href);
  const samples = [];
  for (const [x, z] of [[0, 0], [-144, 288], [400, 650], [900, 0], [1800, 0], [2700, 0], [0, -216]]) {
    const engine = new NullEngine(), scene = new Scene(engine), casters=new Set();
    scene.metadata={shadowGenerator:{addShadowCaster(mesh,children=true){casters.add(mesh);if(children)for(const child of mesh.getChildMeshes())casters.add(child);},removeShadowCaster(mesh){casters.delete(mesh);}}};
    const world = createWorld(scene, 42);
    for (let i = 0; i < 30; i++) world.update(x, z, 0);
    const timing=[];
    if(phase==='before-optimization'||phase==='optimized'){
      const camera=new Vector3(x+12,32,z-28),target=new Vector3(x,0,z);
      for(let pass=0;pass<6;pass++){
        const start=performance.now();
        for(let frame=0;frame<120;frame++){
          world.update(x,z,1/60);world.updateOcclusion(camera,target,1/60);
          for(let actor=0;actor<12;actor++)world.propsNear(x+Math.sin(actor)*45,z+Math.cos(actor)*45,12);
        }
        if(pass)timing.push((performance.now()-start)/120);
      }
      timing.sort((a,b)=>a-b);
    }
    samples.push({ x, z, biome: world.biomeAt(x, z), meshes: scene.meshes.length, materials: scene.materials.length,
      shadowCasters:[...casters].filter(mesh=>mesh.isEnabled()&&mesh.getTotalVertices()).length,
      shadowTriangles:[...casters].filter(mesh=>mesh.isEnabled()).reduce((sum,mesh)=>sum+mesh.getTotalIndices()/3,0),
      frozenMeshes:scene.meshes.filter(mesh=>mesh.isWorldMatrixFrozen).length,
      ...(timing.length?{worldCpuMsPerFrameMedian:timing[2],timingScope:'NullEngine: streaming update + occlusion + 12 collision queries; excludes graphics rendering and physics'}:{}),
      vertices: scene.meshes.reduce((sum, mesh) => sum + mesh.getTotalVertices(), 0),
      triangles: scene.meshes.reduce((sum, mesh) => sum + mesh.getTotalIndices() / 3, 0),
      props: world.propsNear(x, z, 250).map(p => ({ id: p.id, kind:p.kind, x: p.x, z: p.z, radius: p.radius })).sort((a, b) => a.id.localeCompare(b.id)) });
    world.dispose(); scene.dispose(); engine.dispose();
  }
  await writeFile(`verification/world-expansion-${phase}.json`, JSON.stringify(samples, null, 2));
  console.log(samples.map(({ props, ...sample }) => ({ ...sample, propCount: props.length })));
  if(phase==='after'||phase==='optimized') {
    for(const sample of samples) {
      if(sample.meshes>850||sample.triangles>120000||sample.materials>(phase==='optimized'?25:5))throw Error(`Scenery budget exceeded at ${sample.x},${sample.z}`);
      if(new Set(sample.props.map(p=>p.id)).size!==sample.props.length)throw Error('Duplicate streamed prop IDs');
    }
    const before=JSON.parse(await readFile('verification/world-expansion-baseline.json','utf8'));
    console.log(samples.map(a=>{const b=before.find(b=>a.x===b.x&&a.z===b.z);return {x:a.x,z:a.z,biome:a.biome,meshDelta:b?a.meshes-b.meshes:null,triangleDelta:b?a.triangles-b.triangles:null,landmarks:[...new Set(a.props.filter(p=>p.kind?.startsWith('landmark-')).map(p=>p.kind))]};}));
    console.log('All sampled streamed scenes remain under 850 meshes, 120k triangles and 5 shared base materials (up to 20 temporary occluder materials).');
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
