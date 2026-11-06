import { ArcRotateCamera, Color3, Color4, DirectionalLight, Engine, HemisphericLight, Mesh, MeshBuilder, Scene, StandardMaterial, Vector3 } from '@babylonjs/core';
import { createEffects, createHelicopter } from '../src/effects';
import { createVehicle } from '../src/vehicles';
import { CARS, type VehicleVisual } from '../src/types';

const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!;
const engine = new Engine(canvas, true, { stencil: true }), scene = new Scene(engine);
scene.clearColor = new Color4(.18, .23, .19, 1);
const camera = new ArcRotateCamera('review-camera', -.93, 1.10, 13, new Vector3(0, 1, 0), scene);
camera.attachControl(canvas, true); camera.lowerRadiusLimit = 6; camera.upperRadiusLimit = 25;
camera.minZ = .05; camera.wheelPrecision = 30;
new HemisphericLight('sky', new Vector3(.2, 1, .2), scene).intensity = .85;
const sun = new DirectionalLight('sun', new Vector3(-.5, -1, .6), scene); sun.intensity = .7;
const ground = MeshBuilder.CreateGround('ground', { width: 100, height: 100 }, scene);
const groundMaterial = new StandardMaterial('ground', scene); groundMaterial.diffuseColor = Color3.FromHexString('#68705a'); groundMaterial.specularColor = Color3.Black(); ground.material = groundMaterial;
const effects = createEffects(scene);
const slider = document.querySelector<HTMLInputElement>('#time')!, label = document.querySelector<HTMLOutputElement>('#time-label')!, status = document.querySelector<HTMLParagraphElement>('#status')!;
type ReviewMode = 'car' | 'helicopter' | 'observer' | 'transport';
let mode: ReviewMode = 'car', elapsed = .25, playing = false;
let vehicle: VehicleVisual | undefined, helicopter: ReturnType<typeof createHelicopter> | undefined;
let fragments: { mesh: Mesh; position: Vector3; velocity: Vector3; spin: number }[] = [];
function reset() {
  effects.clear(); vehicle?.dispose(); helicopter?.dispose();
  vehicle = undefined; helicopter = undefined;
  fragments.forEach(part => part.mesh.dispose(false, true)); fragments = [];
  if (mode === 'car') {
    vehicle = createVehicle(scene, CARS[0], '#fa661b');
    vehicle.setDamage(0, .25);
    const pieces = vehicle.popDebris?.() ?? [];
    const size = (mesh: Mesh) => { const bounds = mesh.getHierarchyBoundingVectors(true), extent = bounds.max.subtract(bounds.min); return extent.x * extent.y * extent.z; };
    pieces.sort((a, b) => size(b) - size(a));
    const largePieces = pieces.slice(0, 6);
    for (const mesh of pieces) if (!largePieces.includes(mesh)) mesh.dispose(false, true);
    fragments = largePieces.map((mesh, i) => ({ mesh, position: mesh.position.clone(), velocity: new Vector3(Math.cos(i * 2.4) * 4, 3 + (i % 3), Math.sin(i * 2.4) * 4), spin: i % 2 ? 3 : -2 }));
    effects.explosion(new Vector3(0, .8, .3), 'car');
  } else {
    helicopter = createHelicopter(scene, mode === 'observer' ? 'observer' : 'transport');
    helicopter.root.position.y = 1.05;
    if (mode === 'helicopter') {
      helicopter.root.rotation.set(.1, .25, -.4); helicopter.beginCrash();
      fragments = helicopter.releaseDebris().map((mesh, i) => ({ mesh, position: mesh.position.clone(), velocity: new Vector3(Math.cos(i * 2.4) * (i ? 3 : .6), i ? 2.6 : .7, Math.sin(i * 2.4) * (i ? 3 : .6)), spin: i ? (i % 2 ? 2 : -3) : -.6 }));
      effects.explosion(new Vector3(0, .6, 0), 'helicopter');
    }
  }
}
function updateFragments(time: number) {
  for (const part of fragments) {
    const ballisticTime = Math.min(time, .9), scale = 1 - Math.exp(-ballisticTime * 2);
    part.mesh.position.set(part.position.x + part.velocity.x * scale, Math.max(.14, part.position.y + part.velocity.y * ballisticTime - 5 * ballisticTime * ballisticTime), part.position.z + part.velocity.z * scale);
    part.mesh.rotation.x = part.spin * Math.min(time, .9); part.mesh.rotation.z = part.spin * .5 * Math.min(time, .9);
  }
  if (helicopter && mode !== 'helicopter') helicopter.rotor.rotation.y = time * 30;
}
function report() {
  slider.value = String(elapsed); label.value = elapsed.toFixed(2).replace('.', ',') + ' с';
  const stats = effects.getStats();
  status.textContent = 'Частицы: ' + stats.active + '/' + stats.capacity + ' · пакеты: ' + stats.batches + '/4 · крупные части: ' + fragments.length;
  document.documentElement.dataset.effects = JSON.stringify({ mode, time: elapsed, ...stats, fragments: fragments.length });
}
function seek(time: number) {
  reset(); elapsed = Math.max(0, Math.min(4, time));
  for (let t = 0; t < elapsed;) { const dt = Math.min(1 / 120, elapsed - t); effects.update(dt); t += dt; }
  updateFragments(elapsed); report();
}
document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => button.addEventListener('click', () => {
  mode = button.dataset.mode as ReviewMode; playing = false;
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
  seek(.25);
}));
document.querySelectorAll<HTMLButtonElement>('[data-time]').forEach(button => button.addEventListener('click', () => { playing = false; seek(Number(button.dataset.time)); }));
slider.addEventListener('input', () => { playing = false; seek(Number(slider.value)); });
document.querySelector('#play')!.addEventListener('click', () => { seek(0); playing = true; });
seek(.25);
engine.runRenderLoop(() => {
  if (playing) { const dt = Math.min(.05, engine.getDeltaTime() / 1000); elapsed += dt; effects.update(dt); updateFragments(elapsed); report(); if (elapsed >= 4) playing = false; }
  scene.render();
});
window.addEventListener('resize', () => engine.resize());
