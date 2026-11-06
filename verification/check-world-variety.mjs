import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { NullEngine, Scene } from '@babylonjs/core';
import ts from 'typescript';

// Capture with "baseline" before scenery edits; run without arguments afterward.
// This checks resource/geometry budgets, not GPU frame rate.
const temporary = await mkdtemp(join(tmpdir(), 'dustline-variety-'));
try {
  const phase = process.argv[2] === 'baseline' ? 'baseline' : 'after';
  const babylonUrl = pathToFileURL(resolve('node_modules/@babylonjs/core/index.js')).href;
  for (const name of ['world', 'world-interactions']) {
    const source = await readFile(`src/${name}.ts`, 'utf8');
    const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
    const code = outputText.replace(/(['"])@babylonjs\/core\1/g, JSON.stringify(babylonUrl)).replace(/(from\s+['"]\.\/[^'"]+)(['"])/g, '$1.mjs$2');
    await writeFile(join(temporary, name + '.mjs'), code);
  }
  const { createWorld } = await import(pathToFileURL(join(temporary, 'world.mjs')).href);
  const samples = [];
  for (const [x, z] of [[0, 0], [-144, 288], [400, 650], [0, 1500], [-609, 1242]]) {
    const engine = new NullEngine(), scene = new Scene(engine), world = createWorld(scene, 42);
    for (let i = 0; i < 30; i++) world.update(x, z, 0);
    samples.push({ x, z, biome: world.biomeAt(x, z), meshes: scene.meshes.length, materials: scene.materials.length,
      vertices: scene.meshes.reduce((sum, mesh) => sum + mesh.getTotalVertices(), 0),
      triangles: scene.meshes.reduce((sum, mesh) => sum + mesh.getTotalIndices() / 3, 0),
      props: world.propsNear(x, z, 250).map(p => ({ id: p.id, x: p.x, z: p.z, radius: p.radius })).sort((a, b) => a.id.localeCompare(b.id)) });
    world.dispose(); scene.dispose(); engine.dispose();
  }
  await writeFile(`verification/world-variety-${phase}.json`, JSON.stringify(samples, null, 2));
  console.log(samples.map(({ props, ...sample }) => ({ ...sample, propCount: props.length })));
  if (phase === 'after') {
    const before = JSON.parse(await readFile('verification/world-variety-baseline.json', 'utf8'));
    for (let i = 0; i < samples.length; i++) {
      const a = samples[i], b = before[i];
      if (JSON.stringify(a.props) !== JSON.stringify(b.props)) throw Error(`Collision layout changed at ${a.x},${a.z}`);
      if (a.meshes !== b.meshes || a.materials !== b.materials) throw Error(`Draw resource count changed at ${a.x},${a.z}`);
      if (a.triangles > b.triangles * 1.03) throw Error(`Geometry increase above 3% at ${a.x},${a.z}`);
    }
    console.log('Identical colliders, mesh/material counts; geometry increase below 3% in every sample.');
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
