import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { NullEngine, Scene, Vector3 } from '@babylonjs/core';

const temporary = await mkdtemp(join(tmpdir(), 'dustline-effects-tests-'));
const coreUrl = new URL('../node_modules/@babylonjs/core/index.js', import.meta.url).href;
for (const name of ['vehicle-concepts', 'effects']) {
  const source = await readFile(new URL(`../src/${name}.ts`, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  await writeFile(join(temporary, `${name}.mjs`), outputText.replace(/(['"])@babylonjs\/core\1/g, JSON.stringify(coreUrl)).replace(/(from\s+['"]\.\/[^'"]+)(['"])/g, '$1.mjs$2'));
}
const { createEffects, createHelicopter } = await import(pathToFileURL(join(temporary, 'effects.mjs')).href);
const engine = new NullEngine();
after(async () => {
  engine.dispose();
  assert.equal(dirname(resolve(temporary)), resolve(tmpdir()));
  assert.ok(basename(temporary).startsWith('dustline-effects-tests-'));
  await rm(temporary, { recursive: true, force: true });
});

test('explosion phases retire their flash and fire, then their smoke, with complete cleanup', () => {
  const scene = new Scene(engine), effects = createEffects(scene);
  try {
    effects.explosion(new Vector3(7, 1, -4), 'car');
    effects.update(.05);
    assert.equal(effects.getStats().byKind.flash, 1);
    assert.ok(effects.getStats().byKind.fire > 0);
    for (let i = 0; i < 4; i++) effects.update(.05);
    assert.equal(effects.getStats().byKind.flash, 0);
    assert.ok(effects.getStats().byKind.smoke > 0);
    for (let i = 0; i < 20; i++) effects.update(.05);
    assert.equal(effects.getStats().byKind.fire, 0);
    assert.ok(effects.getStats().byKind.ember > 0);
    assert.ok(effects.getStats().byKind.smoke > 0);
    for (let i = 0; i < 100; i++) effects.update(.05);
    assert.equal(effects.getStats().active, 0);
    assert.equal(effects.getStats().sequences, 0);
    assert.ok(scene.meshes.every(mesh => !mesh.isEnabled()));
    effects.dispose(); effects.dispose();
    assert.equal(scene.meshes.length, 0);
    assert.equal(scene.materials.filter(material => material.name !== 'default material').length, 0);
  } finally { effects.dispose(); scene.dispose(); }
});

test('chain explosions share four batches and bounded pools without allocating lights or meshes', () => {
  const scene = new Scene(engine), effects = createEffects(scene);
  try {
    const meshCount = scene.meshes.length, materialCount = scene.materials.length;
    effects.explosion(new Vector3(0, 12, 0), 'impact');
    assert.equal(effects.getStats().byKind.dust, 0, 'an airborne rocket hit must not draw a dust ring on the road');
    effects.clear();
    for (let i = 0; i < 120; i++) {
      effects.explosion(new Vector3(i % 8, .7, i % 5), i % 2 ? 'helicopter' : 'impact');
      effects.smoke(new Vector3(3, 1, 5), true);
      effects.tracer(new Vector3(1, 2, 3), new Vector3(8, 3, -4));
      effects.update(1 / 60);
      const stats = effects.getStats();
      assert.ok(stats.active <= stats.capacity && stats.sequences <= 8 && stats.batches <= 4);
      assert.equal(scene.meshes.length, meshCount);
      assert.equal(scene.materials.length, materialCount);
      assert.equal(scene.lights.length, 0);
    }
    for (const mesh of scene.meshes) for (const matrix of mesh.thinInstanceGetWorldMatrices()) assert.ok(Array.from(matrix.m).every(Number.isFinite));
    effects.clear();
    assert.equal(effects.getStats().active, 0);
    assert.equal(effects.getStats().sequences, 0);
    assert.ok(scene.meshes.every(mesh => !mesh.isEnabled()));
    effects.update(.06);
    assert.equal(effects.getStats().active, 0, 'cleared emitters must never restart');
  } finally { effects.dispose(); scene.dispose(); }
});

test('observer and transport have distinct silhouettes and retain five independent crash groups', () => {
  const scene = new Scene(engine);
  try {
    const observer = createHelicopter(scene, 'observer'), transport = createHelicopter(scene, 'transport');
    const light = observer.root.getHierarchyBoundingVectors(true), heavy = transport.root.getHierarchyBoundingVectors(true);
    assert.ok(heavy.max.z - heavy.min.z > light.max.z - light.min.z + .8);
    assert.ok(heavy.max.x - heavy.min.x > light.max.x - light.min.x + 1);
    assert.ok(observer.root.getChildMeshes().length < 30 && transport.root.getChildMeshes().length < 30);
    for (const visual of [observer, transport]) {
      visual.setWeapons(true); visual.beginCrash(); visual.setWeapons(true);
      assert.ok(visual.root.getChildMeshes().filter(mesh => mesh.name.includes('weapon')).every(mesh => !mesh.isEnabled()));
      const fragments = visual.releaseDebris();
      assert.equal(fragments.length, 5);
      assert.equal(new Set(fragments.map(mesh => mesh.metadata.part)).size, 5);
      for (const mesh of fragments) {
        assert.ok(Array.from(mesh.getVerticesData('position')).every(Number.isFinite));
        mesh.dispose(false, true);
      }
      visual.dispose();
    }
    assert.equal(scene.meshes.length, 0);
    assert.equal(scene.materials.filter(material => material.name !== 'default material').length, 0);
  } finally { scene.dispose(); }
});

test('smoke screen forms a broad low cloud in one batch with bounded occupancy', () => {
  const scene=new Scene(engine),effects=createEffects(scene),at=new Vector3(12,.7,-8);
  try {
    const meshCount=scene.meshes.length,materialCount=scene.materials.length;
    effects.smokeScreen(at);effects.update(.05);
    assert.equal(effects.getStats().byKind.smoke,7);assert.equal(effects.getStats().batches,1);
    const smoke=scene.meshes.find(mesh=>mesh.name==='effects-smoke'),matrices=smoke.thinInstanceGetWorldMatrices();
    assert.equal(matrices.length,7);
    for(const matrix of matrices){const scale=new Vector3(),position=new Vector3();matrix.decompose(scale,undefined,position);assert.ok(scale.x>=5.8,'screen needs broad overlapping lobes');assert.ok(scale.y<scale.x*.6,'cloud should sit low over the road');assert.ok(Math.hypot(position.x-at.x,position.z-at.z)<=4.1);}
    let emission=0;
    for(let tick=0;tick<160;tick++){emission-=.05;if(emission<=0){effects.smokeScreen(at);emission=.35;}effects.update(.05);assert.ok(effects.getStats().active<=35);assert.equal(effects.getStats().batches,1);}
    assert.equal(scene.meshes.length,meshCount);assert.equal(scene.materials.length,materialCount);assert.equal(scene.lights.length,0);
    effects.clear();for(let i=0;i<100;i++)effects.smokeScreen(at);effects.update(.01);assert.ok(effects.getStats().active<=240);
    for(let i=0;i<30;i++)effects.update(.05);assert.equal(effects.getStats().active,0);
  }finally{effects.dispose();scene.dispose();}
});
