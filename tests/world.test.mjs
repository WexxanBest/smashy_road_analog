// Run: node --test --experimental-test-isolation=none tests/world.test.mjs
// Uses real Babylon meshes and streamed world geometry; no browser or Havok required.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { NullEngine, Scene, StandardMaterial, Vector3 } from '@babylonjs/core';
import ts from 'typescript';

// Emit only the two world modules. Absolute Babylon URLs also resolve when the
// temporary directory is on another drive and outside the project's node_modules.
const temporary = await mkdtemp(join(tmpdir(), 'dustline-world-regression-'));
after(async () => {
  assert.equal(dirname(resolve(temporary)), resolve(tmpdir()));
  assert.ok(basename(temporary).startsWith('dustline-world-regression-'));
  await rm(temporary, { recursive: true, force: true });
});
const babylonUrl = pathToFileURL(fileURLToPath(new URL('../node_modules/@babylonjs/core/index.js', import.meta.url))).href;
for (const name of ['world', 'world-interactions']) {
  const source = await readFile(new URL(`../src/${name}.ts`, import.meta.url), 'utf8');
  const { outputText, diagnostics } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
  });
  assert.ok(!diagnostics?.some(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error), `${name} failed to transpile`);
  const javascript = outputText
    .replace(/(['"])@babylonjs\/core\1/g, JSON.stringify(babylonUrl))
    .replace(/(from\s+['"]\.\/[^'"]+)(['"])/g, '$1.mjs$2');
  await writeFile(join(temporary, `${name}.mjs`), javascript);
}
const { createWorld } = await import(pathToFileURL(join(temporary, 'world.mjs')).href);
const near = (actual, expected, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected} by more than ${tolerance}`);

test('streamed world interactions preserve state, animate and release resources', async t => {
  const engine = new NullEngine(), scene = new Scene(engine), world = createWorld(scene, 42);
  t.after(() => { world.dispose(); scene.dispose(); engine.dispose(); });
  const load = (x = 0, z = 0, frames = 18) => {
    for (let frame = 0; frame < frames; frame++) world.update(x, z, 1 / 60);
    return world.propsNear(x, z, 220);
  };
  const requireProp = (props, predicate, label) => {
    const prop = props.find(predicate);
    assert.ok(prop, `seed 42 must include ${label} in the sampled neighbourhood`);
    return prop;
  };
  load();

  await t.test('every loaded collider has a unique stable object ID', () => {
    const props = world.propsNear(0, 0, 220), ids = props.map(prop => prop.id);
    assert.ok(props.length > 100, 'fixture must exercise a populated city');
    assert.ok(ids.every(id => typeof id === 'string' && id.length > 0));
    assert.equal(new Set(ids).size, ids.length);
  });

  await t.test('large building damage never collapses its main structure', () => {
    const building = requireProp(world.propsNear(0, 0, 220), prop => prop.kind === 'building', 'large building');
    const initialHp = building.hp;
    world.damageProp(building, initialHp * 100);
    assert.ok(building.hp > 0 && building.hp < initialHp);
    assert.equal(building.active, true);
    assert.equal(building.mesh.isEnabled(), true);
    assert.equal(building.interaction, 'solid');
  });

  await t.test('facade damage, moved props and destroyed scenery survive actual chunk unload/reload', () => {
    const props = world.propsNear(0, 0, 220);
    const facade = requireProp(props, prop => prop.kind === 'storefront', 'damageable facade');
    const movable = requireProp(props, prop => prop.interaction === 'movable', 'movable prop');
    const lamp = requireProp(props, prop => prop.kind === 'lamp', 'street lamp');
    const facadeId = facade.id, expectedHp = facade.hp - 10;
    const movableId = movable.id, startX = movable.x;
    const lampId = lamp.id;
    world.damageProp(facade, 10);
    world.damageProp(movable, 12, new Vector3(12, 0, 2));
    for (let frame = 0; frame < 120; frame++) world.update(0, 0, 1 / 60);
    const movedX = movable.x, movedZ = movable.z;
    assert.ok(movedX > startX + .05, 'a real impulse must change the prop position');
    near(movable.mesh.position.x, movedX);
    near(movable.mesh.position.z, movedZ);
    world.destroyProp(lamp);
    assert.equal(lamp.active, false);
    assert.ok(scene.meshes.some(mesh => mesh.name === `remains-${lampId}`), 'destruction must leave visible remains');

    world.update(1000, 1000, 1 / 60);
    assert.equal(facade.mesh.isDisposed(), true, 'the original facade must actually unload');
    assert.equal(movable.mesh.isDisposed(), true, 'the original movable mesh must actually unload');
    assert.equal(lamp.mesh.isDisposed(), true);
    const reloaded = load();
    const restoredFacade = requireProp(reloaded, prop => prop.id === facadeId, 'restored facade');
    const restoredMovable = requireProp(reloaded, prop => prop.id === movableId, 'restored movable prop');
    assert.notEqual(restoredFacade, facade, 'reload must reconstruct geometry, not retain the old object');
    near(restoredFacade.hp, expectedHp);
    near(restoredMovable.x, movedX, .03);
    near(restoredMovable.z, movedZ, .03);
    assert.ok(!reloaded.some(prop => prop.id === lampId), 'destroyed scenery must not respawn active');
    assert.ok(scene.meshes.some(mesh => mesh.name === `remains-${lampId}`), 'reload must restore the remains');
  });

  await t.test('an explosive barrel emits its gameplay callback exactly once', () => {
    const barrel = requireProp(world.propsNear(0, 0, 220), prop => prop.kind === 'barrel', 'explosive barrel');
    const events = [];
    world.setExplosionHandler((at, damage) => events.push({ at: at.clone(), damage }));
    world.damageProp(barrel, barrel.hp + 1);
    world.damageProp(barrel, 1000);
    world.destroyProp(barrel);
    assert.equal(events.length, 1);
    near(events[0].at.x, barrel.x);
    near(events[0].at.z, barrel.z);
    assert.ok(events[0].damage > 0);
    assert.equal(barrel.active, false);
    assert.equal(barrel.mesh.isEnabled(), false);
    assert.ok(scene.meshes.some(mesh => mesh.name === 'barrel-fireball'));
  });

  await t.test('a broken hydrant produces a persistent water jet beside its remains', () => {
    const hydrant = requireProp(world.propsNear(0, 0, 220), prop => prop.kind === 'hydrant', 'hydrant');
    world.destroyProp(hydrant);
    const water = scene.meshes.find(mesh => mesh.name === 'hydrant-water-jet' && Math.abs(mesh.position.x - hydrant.x) < .01 && Math.abs(mesh.position.z - hydrant.z) < .01);
    assert.ok(water, 'a destroyed hydrant must visibly release water');
    assert.ok(water.isEnabled());
    assert.ok(scene.meshes.some(mesh => mesh.name === `remains-${hydrant.id}`));
    for (let frame = 0; frame < 120; frame++) world.update(0, 0, 1 / 60);
    assert.equal(water.isDisposed(), false, 'water must outlast the short explosion/debris flash');
    assert.ok(water.scaling.y > 0);
  });

  await t.test('occluding building and its facade fade together, ground stays opaque and visibility recovers', () => {
    const props = world.propsNear(0, 0, 220);
    const building = requireProp(props, prop => prop.kind === 'building', 'occluding building');
    const facade = requireProp(props, prop => prop.id.startsWith(`${building.id}-glass-`), 'facade belonging to the occluder');
    const target = new Vector3(building.x + building.width / 2 + 5, 0, building.z);
    const camera = new Vector3(building.x - building.width, 20, building.z);
    for (let frame = 0; frame < 90; frame++) {
      world.update(0, 0, 1 / 60);
      world.updateOcclusion(camera, target, 1 / 60);
    }
    assert.ok(building.mesh.material instanceof StandardMaterial);
    assert.ok(building.mesh.material.alpha >= .2 && building.mesh.material.alpha <= .4, 'the hero must remain visible through the occluder');
    near(facade.mesh.material.alpha, building.mesh.material.alpha, .01);
    const ground = scene.meshes.filter(mesh => mesh.name.startsWith('world-chunk-'));
    assert.ok(ground.length > 0);
    for (const mesh of ground) assert.equal(mesh.material.alpha, 1, 'roads and ground cannot inherit object fade');
    for (let frame = 0; frame < 120; frame++) {
      world.update(0, 0, 1 / 60);
      world.updateOcclusion(new Vector3(500, 20, 500), new Vector3(510, 0, 510), 1 / 60);
    }
    near(building.mesh.material.alpha, 1, .01);
    near(facade.mesh.material.alpha, 1, .01);
  });

  await t.test('a small countryside structure can collapse completely', () => {
    // A deterministic rural sample avoids assuming that every city seed has a kiosk.
    const props = load(-144, 288);
    const small = requireProp(props, prop => prop.kind === 'small-building', 'small countryside structure');
    world.damageProp(small, small.hp + 1);
    assert.equal(small.active, false);
    assert.equal(small.mesh.isEnabled(), false);
    assert.ok(scene.meshes.some(mesh => mesh.name === `remains-${small.id}`));
    assert.ok(scene.meshes.some(mesh => mesh.name === 'prop-debris-small-building'));
  });

  await t.test('the separate turbine rotor moves by elapsed time consistently at 30 and 60 FPS', () => {
    let turbine;
    for (let z = 350; z < 2500 && !turbine; z += 180) {
      const props = load(0, z, 12);
      turbine = props.find(prop => prop.kind === 'turbine');
    }
    assert.ok(turbine, 'sampled fields must include a turbine');
    load(turbine.x, turbine.z);
    const rotor = turbine.mesh.getChildren().find(node => node.name === 'wind-turbine-rotor');
    assert.ok(rotor, 'rotation must use a separate pivot, not a whole static chunk');
    assert.equal(rotor.getChildMeshes().length, 1);
    const initial = rotor.rotation.z;
    world.update(turbine.x, turbine.z, 0);
    near(rotor.rotation.z, initial);
    for (let frame = 0; frame < 30; frame++) world.update(turbine.x, turbine.z, 1 / 30);
    const at30 = rotor.rotation.z;
    for (let frame = 0; frame < 60; frame++) world.update(turbine.x, turbine.z, 1 / 60);
    const at60 = rotor.rotation.z;
    assert.ok(at30 > initial);
    near(at30 - initial, at60 - at30);
    const speedBeforeDamage = at60 - at30;
    world.damageProp(turbine, turbine.hp / 2);
    for (let frame = 0; frame < 60; frame++) world.update(turbine.x, turbine.z, 1 / 60);
    const damagedSpeed = rotor.rotation.z - at60;
    assert.ok(damagedSpeed > 0 && damagedSpeed < speedBeforeDamage, 'damage must slow the turbine');
  });

  await t.test('world disposal removes meshes, pivots, custom materials and does not recreate scenery', () => {
    world.dispose();
    assert.equal(scene.meshes.length, 0);
    assert.equal(scene.transformNodes.length, 0);
    assert.ok(!scene.materials.some(material => /^(world-|broken-hydrant-water)/.test(material.name)), 'world-owned materials must be released');
    world.update(0, 0, 1 / 60);
    assert.equal(scene.meshes.length, 0);
    assert.equal(world.propsNear(0, 0, 1000).length, 0);
  });
});
