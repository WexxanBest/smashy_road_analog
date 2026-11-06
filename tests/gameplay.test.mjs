// Run: node --test tests/gameplay.test.mjs
// Restricted Windows sandbox: node --test --experimental-test-isolation=none tests/gameplay.test.mjs
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// Exercise the real pure TypeScript modules with Node's built-in runner. The
// temporary JS is never checked in and no browser or physics engine is mocked.
const temporary = await mkdtemp(join(tmpdir(), 'dustline-regression-'));
after(async () => {
  assert.equal(dirname(resolve(temporary)), resolve(tmpdir()));
  assert.ok(basename(temporary).startsWith('dustline-regression-'));
  await rm(temporary, { recursive: true, force: true });
});
for (const name of ['types', 'gameplay', 'handling']) {
  const source = await readFile(new URL(`../src/${name}.ts`, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  const javascript = outputText.replace(/(from\s+['"]\.\/[^'"]+)(['"])/g, '$1.mjs$2');
  await writeFile(join(temporary, `${name}.mjs`), javascript);
}
const types = await import(pathToFileURL(join(temporary, 'types.mjs')).href);
const gameplay = await import(pathToFileURL(join(temporary, 'gameplay.mjs')).href);
const handling = await import(pathToFileURL(join(temporary, 'handling.mjs')).href);
const { defaultSave, normalizeSave, carUpgrades, turretAvailable, CHALLENGES } = types;
const { advanceChallenges, safeTrafficSpeed, coolTurret, outsideSpawnViewport, policeSpec, choosePoliceRole, PURSUIT_LEVELS } = gameplay;
const { stepHandling, handlingMemory } = handling;
const near = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected} by more than ${tolerance}`);
const tick = (overrides = {}) => ({ distance: 0, offroadDistance: 0, speedStreak: 0, returnedAfterFiveStars: false, sandbox: false, ...overrides });

test('fresh save and its first persisted reload start without a turret', () => {
  const fresh = defaultSave();
  for (const save of [fresh, normalizeSave(JSON.parse(JSON.stringify(fresh)))]) {
    assert.equal(save.turretOwned, false);
    assert.equal(turretAvailable(save, 'comet'), false);
    assert.ok(!Object.values(save.turretEquipped).some(Boolean));
    assert.deepEqual(save.owned, ['comet']);
    assert.equal(save.selected, 'comet');
  }
});

test('expanded garage preserves purchases, paint, equipment and upgrades after reload', () => {
  const save=normalizeSave(defaultSave());
  for(const id of ['metro','pulse','nomad']) {
    const car=types.CARS.find(car=>car.id===id);
    assert.ok(car && car.price>0 && !car.challengeId, `${id} must be purchasable`);
    save.owned.push(id);save.colors[id]='#568fb6';save.upgrades[id]={engine:2,armor:1,tires:1,handling:3,nitro:0};save.turretEquipped[id]=true;
  }
  save.turretOwned=true;save.selected='nomad';
  assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(save))),save);
  assert.equal(new Set(types.CARS.map(car=>car.id)).size,types.CARS.length);
});

test('expanded police fleet preserves pursuit roles with a lighter motorcycle tradeoff', () => {
  const ids=new Set();
  for(const role of ['patrol','interceptor','suv','swat'])for(let index=0;index<12;index++) {
    const base=policeSpec(role),car=policeSpec(role,index);ids.add(car.id);
    assert.equal(car.policeRole,role);
    if(car.visualVariant==='motorcycle'){
      assert.equal(role,'patrol');assert.ok(car.armor<base.armor&&car.mass<base.mass*.5,'motorcycle must lose protection and ramming weight');
      assert.ok(car.speed>base.speed&&car.handling>=base.handling,'motorcycle trades protection for agility');
      assert.ok(car.width<1.1&&car.length<3);
    }else{
      for(const key of ['armor','speed','mass','handling'])assert.equal(car[key],base[key]);
      assert.ok(car.width>1.7&&car.width<2.6&&car.length<6);
    }
  }
  assert.equal(ids.size,9);
  assert.deepEqual(policeSpec('swat',Infinity),policeSpec('swat',0));
});

test('legacy progress keeps the built-in turret and adds finite handling upgrades', () => {
  const legacy = { credits: 1742, selected: 'brute', owned: ['comet', 'rally', 'brute'], colors: { rally: '#ef8155' }, upgrades: { brute: { engine: 2, armor: 1, tires: 3, nitro: 2 } }, best: 91, music: false };
  const save = normalizeSave(legacy);
  assert.equal(save.schemaVersion, 2);
  assert.equal(save.credits, legacy.credits);
  assert.equal(save.selected, 'brute');
  assert.equal(save.best, 91);
  assert.equal(save.music, false);
  assert.equal(save.turretOwned, true);
  for (const id of save.owned) {
    assert.equal(turretAvailable(save, id), true, `${id} lost legacy equipment`);
    const upgrades = carUpgrades(save, id);
    assert.deepEqual(Object.keys(upgrades).sort(), ['armor', 'engine', 'handling', 'nitro', 'tires']);
    assert.ok(Object.values(upgrades).every(Number.isFinite));
    assert.equal(upgrades.handling, 0);
  }
  assert.equal(carUpgrades(save, 'brute').engine, 2);
  assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(save))), save, 'migration must be idempotent');
});

test('corrupt versioned saves cannot inject NaN, unknown cars or invalid paint', () => {
  const raw = { schemaVersion: 2, credits: NaN, best: -8, selected: 'missing', owned: ['brute', 'brute', 'ghost', null], colors: { brute: '#abcdef', ghost: '#123456', rally: 'red' }, upgrades: { brute: { engine: Infinity, armor: -2, tires: 2.8, handling: '3', nitro: 99 }, ghost: { engine: 3 }, comet: null }, turretOwned: false, turretEquipped: { comet: true, brute: true }, turretCooling: Infinity, challenges: { 'city-runner': NaN, trailblazer: -1, 'speed-streak': Infinity }, completedChallenges: ['garbage'], volumes: { music: Infinity, sfx: -1, engine: 5 } };
  const snapshot = structuredClone(raw), save = normalizeSave(raw);
  assert.deepEqual(raw, snapshot, 'normalizing must not mutate source data');
  assert.deepEqual(save.owned, ['comet', 'brute']);
  assert.equal(save.selected, 'comet');
  assert.deepEqual(save.colors, { brute: '#abcdef' });
  assert.deepEqual(carUpgrades(save, 'brute'), { engine: 0, armor: 0, tires: 2, handling: 0, nitro: 3 });
  assert.equal(save.upgrades.ghost, undefined);
  assert.ok(Number.isFinite(save.credits) && save.credits >= 0);
  assert.equal(save.best, 0);
  assert.equal(save.turretCooling, 0);
  assert.ok(!Object.values(save.turretEquipped).some(Boolean));
  assert.ok(Object.values(save.challenges).every(value => Number.isFinite(value) && value >= 0));
  assert.deepEqual(save.volumes, { music: .7, sfx: 0, engine: 1 });
  for (const malformed of [null, undefined, [], 'bad', 45]) assert.deepEqual(normalizeSave(malformed), defaultSave());
});

test('all challenge rewards are awarded once and survive persisted reload', () => {
  const save = defaultSave();
  const completion = tick({ distance: 2000, offroadDistance: 1500, speedStreak: 30, returnedAfterFiveStars: true });
  const expected = CHALLENGES.map(challenge => challenge.carId);
  assert.deepEqual(advanceChallenges(save, completion), expected);
  assert.deepEqual(advanceChallenges(save, completion), []);
  assert.equal(new Set(save.owned).size, save.owned.length);
  const reloaded = normalizeSave(JSON.parse(JSON.stringify(save)));
  assert.deepEqual(advanceChallenges(reloaded, completion), []);
  for (const challenge of CHALLENGES) {
    assert.ok(reloaded.completedChallenges.includes(challenge.id));
    assert.ok(reloaded.owned.includes(challenge.carId));
    assert.equal(reloaded.challenges[challenge.id], challenge.target);
  }
});

test('sandbox progress never modifies ordinary challenges or ownership', () => {
  const save = defaultSave();
  advanceChallenges(save, tick({ distance: 150, speedStreak: 12 }));
  const snapshot = structuredClone(save);
  assert.deepEqual(advanceChallenges(save, tick({ distance: 100000, offroadDistance: 100000, speedStreak: 60, returnedAfterFiveStars: true, sandbox: true })), []);
  assert.deepEqual(save, snapshot);
});

test('completed challenge markers recover an unlock even if the saved owned list is incomplete', () => {
  const save = normalizeSave({ ...defaultSave(), completedChallenges: ['city-runner'], challenges: { 'city-runner': 7 } });
  assert.ok(save.owned.includes('kestrel'));
  assert.equal(save.challenges['city-runner'], 2000);
  assert.deepEqual(advanceChallenges(save, tick({ distance: 1 })), []);
});

test('fragmented speed streaks do not add up to the continuous 30-second reward', () => {
  const save = defaultSave();
  for (let fragment = 0; fragment < 20; fragment++) {
    assert.deepEqual(advanceChallenges(save, tick({ speedStreak: 12 })), []);
    assert.deepEqual(advanceChallenges(save, tick({ speedStreak: 0 })), []);
  }
  assert.equal(save.challenges['speed-streak'], 12);
  assert.ok(!save.owned.includes('cobra'));
  advanceChallenges(save, tick({ speedStreak: 29.99 }));
  assert.ok(!save.owned.includes('cobra'));
  assert.deepEqual(advanceChallenges(save, tick({ speedStreak: 30 })), ['cobra']);
});

const traffic = (overrides = {}) => ({ x: 0, z: 0, vx: 0, vz: 10, angle: 0, length: 4, width: 2, ...overrides });
test('traffic approaches a stopped car slowly and stops before contact', () => {
  const car = traffic(), far = traffic({ z: 100, vz: 0 }), approach = traffic({ z: 16, vz: 0 }), close = traffic({ z: 7, vz: 0 });
  assert.equal(safeTrafficSpeed(car, [far], 10), 10);
  const target = safeTrafficSpeed(car, [approach], 10);
  assert.ok(target > 0 && target < 6, `expected a reduced approach speed, got ${target}`);
  assert.equal(safeTrafficSpeed(car, [close], 10), 0);
});

test('projected crossing traffic causes yielding before trajectories meet', () => {
  const crossing = traffic({ x: -10, z: 12, vx: 10, vz: 0, angle: Math.PI / 2 });
  const target = safeTrafficSpeed(traffic(), [crossing], 10);
  assert.ok(target >= 0 && target < 5, `crossing conflict was ignored: ${target}`);
});

test('traffic avoidance behaves the same after turning the entire road layout', () => {
  const car = traffic(), crossing = traffic({ x: -10, z: 12, vx: 10, vz: 0, angle: Math.PI / 2 });
  const baseline = safeTrafficSpeed(car, [crossing], 10);
  const rotate = (body, angle) => {
    const c = Math.cos(angle), s = Math.sin(angle);
    return { ...body, x: body.x*c + body.z*s, z: body.z*c - body.x*s, vx: body.vx*c + body.vz*s, vz: body.vz*c - body.vx*s, angle: body.angle + angle };
  };
  for (const angle of [Math.PI / 2, -Math.PI / 2, Math.PI, .73]) near(safeTrafficSpeed(rotate(car, angle), [rotate(crossing, angle)], 10), baseline);
});

test('rear cars and an occupied adjacent lane do not brake clear forward travel', () => {
  const car = traffic();
  assert.equal(safeTrafficSpeed(car, [traffic({ z: -12, vz: 20 })], 10), 10);
  assert.equal(safeTrafficSpeed(car, [traffic({ x: 3.6, z: 8, vz: 0 })], 10), 10);
  // Rectangles remain separated by a metre throughout the prediction. A round
  // proximity threshold alone must not interpret this as crossing traffic.
  assert.equal(safeTrafficSpeed(car, [traffic({ x: 3, z: 8, vz: 0 })], 10), 10);
});

test('overheat cools at the same rate with fire held or released', () => {
  for (const level of [0, 1, 2, 3]) {
    near(coolTurret(100, .5, true, true, level), coolTurret(100, .5, false, true, level));
  }
  assert.ok(coolTurret(100, 1, true, false, 0) > coolTurret(100, 1, false, false, 0), 'normal sustained fire should cool less than released fire');
  const baseLoss = 100 - coolTurret(100, 1, true, true, 0);
  const upgradedLoss = 100 - coolTurret(100, 1, true, true, 3);
  near(upgradedLoss / baseLoss, 1.45);
  assert.equal(coolTurret(10, 100, false, false, 3), 0);
  assert.equal(coolTurret(100, 1, true, true, 0, true), 0);
});

test('spawn safety uses the entire expanded wide viewport, including touching bounds', () => {
  const width = 3440, height = 1440, margin = .16;
  const box = (minX, maxX, minY = 500, maxY = 550) => [{ x: minX, y: minY, z: .5 }, { x: maxX, y: maxY, z: .5 }];
  assert.equal(outsideSpawnViewport(box(3500, 3600), width, height, margin), false, 'offscreen centre can still be in the safety margin');
  assert.equal(outsideSpawnViewport(box(width * 1.16, width * 1.16 + 40), width, height, margin), false, 'touching the margin must remain rejected');
  assert.equal(outsideSpawnViewport(box(width * 1.16 + 1, width * 1.16 + 40), width, height, margin), true);
  assert.equal(outsideSpawnViewport(box(-100, width + 100), width, height, margin), false, 'an object spanning the view is visible even if its corners are outside');
  assert.equal(outsideSpawnViewport(box(-width * margin - 40, -width * margin), width, height, margin), false);
  assert.equal(outsideSpawnViewport(box(500, 550, height * 1.16 + 1, height * 1.16 + 40), width, height, margin), true);
  assert.equal(outsideSpawnViewport([{ x: 100, y: 100, z: -1 }], width, height, margin), true);
  assert.equal(outsideSpawnViewport([], width, height, margin), false);
  assert.equal(outsideSpawnViewport(box(9000, 9010), 0, height, margin), false);
});

test('pursuit tiers enforce readable budgets and introduce distinct roles', () => {
  assert.deepEqual(PURSUIT_LEVELS.map(level => level.cars), [0, 3, 4, 5, 6, 8]);
  assert.deepEqual(PURSUIT_LEVELS.map(level => level.helis), [0, 0, 0, 1, 1, 2]);
  assert.ok(PURSUIT_LEVELS[3].heliCooldown >= 45, 'destroying the 3-star helicopter must not cause instant replacement');
  assert.ok(PURSUIT_LEVELS.slice(1).every(level => level.interval >= 3.5 && level.heliCooldown >= 30));
  const roles = stars => new Set(Array.from({ length: 12 }, (_, i) => choosePoliceRole(stars, i)));
  assert.deepEqual(roles(1), new Set(['patrol']));
  assert.deepEqual(roles(2), new Set(['patrol', 'interceptor']));
  assert.ok(roles(3).has('suv') && !roles(3).has('swat'));
  assert.ok(roles(4).has('swat'));
  const patrol = policeSpec('patrol'), interceptor = policeSpec('interceptor'), suv = policeSpec('suv'), swat = policeSpec('swat');
  assert.ok(interceptor.speed > patrol.speed);
  assert.ok(swat.armor > suv.armor && suv.armor > patrol.armor);
  assert.ok(swat.mass > patrol.mass && swat.speed < interceptor.speed);
  assert.equal(swat.bodyStyle, 'van');
  assert.equal(suv.bodyStyle, 'suv');
  assert.equal(new Set([patrol.id, interceptor.id, suv.id, swat.id]).size, 4);
});

const control = (overrides = {}) => ({ vx: 0, vz: 26, yaw: 0, angle: 0, throttle: 1, steer: 0, handbrake: false, nitro: false, offRoad: false, speedLimit: 30, handling: 1.05, mass: 900, length: 3.6, tireCondition: 100, engineCondition: 100, engineLevel: 0, tireLevel: 0, handlingLevel: 0, ai: false, profile: 'arcade', dt: 1 / 60, ...overrides });
test('straight high-speed driving has no spontaneous steering or alternating yaw at different frame intervals', () => {
  const results = [];
  for (const dt of [1 / 30, 1 / 60, 1 / 120]) {
    const memory = handlingMemory();
    let input = control({ vz: 30, dt }), previousYaw = 0;
    for (let frame = 0; frame < Math.round(3 / dt); frame++) {
      const output = stepHandling(memory, input);
      near(output.vx, 0); near(output.yaw, 0); near(output.steerAngle, 0); near(output.roll, 0);
      assert.ok(Number.isFinite(output.vz));
      near(output.yaw, previousYaw); previousYaw = output.yaw;
      input = { ...input, vx: output.vx, vz: output.vz, yaw: output.yaw };
    }
    results.push(input.vz);
  }
  results.forEach(speed => near(speed, results[0], 1e-7));
  near(results[0], 30, 1e-7);
});

test('small straight-line yaw disturbances decay without changing sign at every supported dt', () => {
  for (const dt of [1 / 30, 1 / 60, 1 / 120]) {
    const memory = handlingMemory();let yaw = .30;
    for (let frame = 0; frame < Math.round(1.5 / dt); frame++) {
      const output = stepHandling(memory, control({ yaw, dt }));
      assert.ok(output.yaw >= 0 && output.yaw <= yaw, `unstable damping at dt=${dt}`);
      yaw = output.yaw;
    }
    assert.ok(yaw < 1e-7);
  }
});

test('handling upgrade improves measured steering response by 10% per level', () => {
  const measured = level => {
    const memory = handlingMemory(), input = control({ vz: 0, steer: 1, dt: .03, handlingLevel: level });
    stepHandling(memory, input);
    // Infer the response rate from the observable steering state, without
    // depending on the controller's chosen base rate or profile constants.
    return -Math.log(1 - memory.steer) / input.dt;
  };
  const base = measured(0);
  near(measured(1) / base, 1.10);
  near(measured(3) / base, 1.30);
});

test('handling upgrade increases the actual lateral acceleration cap by 5% per level', () => {
  const saturatedYaw = level => {
    const memory = handlingMemory(); let yaw = 0;
    for (let frame = 0; frame < 180; frame++) yaw = stepHandling(memory, control({ vz: 45, steer: 1, handlingLevel: level, yaw })).yaw;
    return yaw;
  };
  const base = saturatedYaw(0);
  assert.ok(base > 0 && base < 1, 'test must be traction-limited, rather than the absolute yaw cap');
  near(saturatedYaw(1) / base, 1.05, 1e-8);
  near(saturatedYaw(3) / base, 1.15, 1e-8);
});
