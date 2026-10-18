// Real offline Havok regression. Run:
// node --test --experimental-test-isolation=none tests/wrecks.test.mjs
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import HavokPhysics from '@babylonjs/havok';

const temporary = await mkdtemp(join(tmpdir(), 'dustline-wreck-physics-tests-'));
const coreUrl = new URL('../node_modules/@babylonjs/core/index.js', import.meta.url).href;
const { NullEngine, Scene, HavokPlugin, PhysicsAggregate, PhysicsShapeType, MeshBuilder, Vector3 } = await import(coreUrl);
const wasmBinary = await readFile(new URL('../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm', import.meta.url));
const havok = await HavokPhysics({ wasmBinary });
const engine = new NullEngine({ renderWidth: 64, renderHeight: 64, textureSize: 64 });
after(async () => {
  engine.dispose();
  assert.equal(dirname(resolve(temporary)), resolve(tmpdir()));
  assert.ok(basename(temporary).startsWith('dustline-wreck-physics-tests-'));
  await rm(temporary, { recursive: true, force: true });
});
const source = await readFile(new URL('../src/wreck-physics.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});
await writeFile(join(temporary, 'wreck-physics.mjs'), outputText.replace(/(['"])@babylonjs\/core\1/g, JSON.stringify(coreUrl)));
const { configureWreckPhysics, stepDisabledVehiclePhysics } = await import(pathToFileURL(join(temporary, 'wreck-physics.mjs')).href);
const dt = 1 / 60;
const near = (actual, expected, tolerance = 1e-5) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected} by more than ${tolerance}`);
const nearVector = (actual, expected) => { near(actual.x, expected.x); near(actual.y, expected.y); near(actual.z, expected.z); };
const horizontalSpeed = body => { const v = body.getLinearVelocity(); return Math.hypot(v.x, v.z); };

function world({ ground = false, mass = 1150 } = {}) {
  const scene = new Scene(engine);
  scene.enablePhysics(new Vector3(0, ground ? -22 : 0, 0), new HavokPlugin(true, havok));
  scene.getPhysicsEngine().setTimeStep(dt);
  const aggregates = [];
  if (ground) {
    const floor = MeshBuilder.CreateBox('test-road', { width: 200, depth: 200, height: 1 }, scene); floor.position.y = -.5;
    aggregates.push(new PhysicsAggregate(floor, PhysicsShapeType.BOX, { mass: 0, friction: .15, restitution: .05 }, scene));
  }
  const mesh = MeshBuilder.CreateBox('test-moving-police-body', { width: 1.9, depth: 3.8, height: .85 }, scene);
  mesh.position.y = ground ? .45 : 5;
  const aggregate = new PhysicsAggregate(mesh, PhysicsShapeType.BOX, { mass, friction: 0, restitution: .08 }, scene);
  aggregate.body.setLinearDamping(.04); aggregate.body.setAngularDamping(.4); aggregates.push(aggregate);
  const { body, shape } = aggregate;
  const physicsStep = () => scene.getPhysicsEngine()._step(dt);
  // Advance the actual engine after the same per-tick helper used by main.
  const wreckStep = () => { stepDisabledVehiclePhysics(body, dt, 'wreck'); physicsStep(); };
  if (ground) for (let i = 0; i < 120; i++) physicsStep();
  return { scene, mesh, body, shape, mass, physicsStep, wreckStep,
    dispose() { for (const physics of aggregates) physics.dispose(); scene.dispose(); },
  };
}

test('wreck transition preserves linear and angular momentum before the real passive Havok step', () => {
  const fixture = world();
  try {
    const { body, shape } = fixture;
    body.setLinearVelocity(new Vector3(3, 2, 16)); body.setAngularVelocity(new Vector3(.1, .8, -.2));
    const velocity = body.getLinearVelocity(), angular = body.getAngularVelocity();
    // Destruction may follow the burning/disabled state within the same tick.
    // Its stronger active-braking settings must not leak into the wreck phase.
    configureWreckPhysics(body, shape, 'disabled');
    nearVector(body.getLinearVelocity(), velocity); nearVector(body.getAngularVelocity(), angular);
    configureWreckPhysics(body, shape, 'wreck');
    nearVector(body.getLinearVelocity(), velocity); nearVector(body.getAngularVelocity(), angular);
    stepDisabledVehiclePhysics(body, dt, 'wreck');
    nearVector(body.getLinearVelocity(), velocity); nearVector(body.getAngularVelocity(), angular);
    fixture.physicsStep();
    assert.ok(body.getLinearVelocity().length() > velocity.length() * .97, 'wreck still receives the active disabled-car brake on its first tick');
    assert.ok(body.getAngularVelocity().length() > angular.length() * .97, 'wreck rotation was killed instantly');
  } finally { fixture.dispose(); }
});

test('a road-contact wreck coasts a visible distance and slows smoothly instead of freezing', t => {
  const fixture = world({ ground: true });
  try {
    const { body, shape, mesh } = fixture;
    body.setLinearVelocity(new Vector3(0, 0, 16)); body.setAngularVelocity(Vector3.Zero());
    const start = mesh.position.clone(); configureWreckPhysics(body, shape, 'wreck');
    let previous = horizontalSpeed(body), afterOneSecond, stoppedAt;
    for (let frame = 0; frame < 600; frame++) {
      fixture.wreckStep(); const speed = horizontalSpeed(body);
      assert.ok(Number.isFinite(speed));
      assert.ok(previous - speed < .5, `nonphysical speed drop at tick ${frame}: ${previous} -> ${speed}`);
      assert.ok(speed - previous < .3, `an unforced wreck gained speed at tick ${frame}`);
      previous = speed;
      if(stoppedAt===undefined&&speed<.3)stoppedAt=(frame+1)*dt;
      if (frame === 59) afterOneSecond = { speed, distance: mesh.position.z - start.z };
    }
    assert.ok(afterOneSecond.distance > 8, `wreck only travelled ${afterOneSecond.distance}m in its first second`);
    assert.ok(afterOneSecond.speed > 3, `wreck almost stopped in one second (${afterOneSecond.speed}m/s)`);
    assert.ok(horizontalSpeed(body) < .3, 'wreck keeps sliding indefinitely');
    const travel = mesh.position.z - start.z;
    assert.ok(travel > 10 && travel < 45, `unexpected total coasting distance: ${travel}m`);
    t.diagnostic(`Havok: at 1s ${afterOneSecond.distance.toFixed(2)}m / ${afterOneSecond.speed.toFixed(2)}m/s; stopped below .3m/s at ${stoppedAt?.toFixed(2)}s; total ${travel.toFixed(2)}m`);
  } finally { fixture.dispose(); }
});

test('explosion impulse survives destruction and subsequent wreck updates', () => {
  const fixture = world({ mass: 900 });
  try {
    const { body, shape, mesh, mass } = fixture;
    body.setLinearVelocity(new Vector3(0, 0, 8));
    body.applyImpulse(new Vector3(mass * 5, 0, mass * 2.5), mesh.position);
    const kicked = body.getLinearVelocity(); assert.ok(kicked.x > 4.9 && kicked.z > 10.4);
    configureWreckPhysics(body, shape, 'wreck'); nearVector(body.getLinearVelocity(), kicked);
    fixture.wreckStep();
    assert.ok(body.getLinearVelocity().x > 4.7 && body.getLinearVelocity().z > 10, 'destruction or per-tick braking erased the blast');
    for (let frame = 0; frame < 5; frame++) fixture.wreckStep();
    const beforeSecondBlast = body.getLinearVelocity().z;
    body.applyImpulse(new Vector3(0, 0, mass * 4), mesh.position);
    // Havok packs physical mass/impulse values; allow a small solver tolerance
    // while still requiring the complete expected momentum change.
    const secondBlast = body.getLinearVelocity(); near(secondBlast.z, beforeSecondBlast + 4, .05);
    stepDisabledVehiclePhysics(body, dt, 'wreck'); nearVector(body.getLinearVelocity(), secondBlast);
    fixture.physicsStep();
    assert.ok(body.getLinearVelocity().z > beforeSecondBlast + 3.5, 'an existing wreck discarded the next external blast');
  } finally { fixture.dispose(); }
});

test('a settled wreck remains a dynamic object that another explosion can move', () => {
  const fixture = world({ ground: true, mass: 900 });
  try {
    const { body, shape, mesh, mass } = fixture;
    body.setLinearVelocity(new Vector3(0, 0, 10)); configureWreckPhysics(body, shape, 'wreck');
    for (let frame = 0; frame < 600; frame++) fixture.wreckStep();
    assert.ok(horizontalSpeed(body) < .3);
    const before = mesh.position.clone();
    body.applyImpulse(new Vector3(mass * 6, 0, 0), mesh.position);
    assert.ok(body.getLinearVelocity().x > 5.9, 'the settled wreck became immovable');
    for (let frame = 0; frame < 30; frame++) fixture.wreckStep();
    assert.ok(mesh.position.x - before.x > 1, 'wreck update erased the external impulse after waking');
  } finally { fixture.dispose(); }
});
