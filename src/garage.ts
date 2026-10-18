import { Engine, Scene, FreeCamera, Vector3, Color3, Color4, HemisphericLight, SpotLight, PointLight, ShadowGenerator, Mesh, MeshBuilder, StandardMaterial, DynamicTexture, GlowLayer } from '@babylonjs/core';
import type { CarSpec, VehicleVisual, GarageTab } from './types';
import { createVehicle } from './vehicles';

/** A self-contained, life-size workshop. No physics, controls or rotating car. */
export function createGarage(engine: Engine, getCar: () => CarSpec, getColor: () => string, getTurret:()=>boolean=()=>false): { scene: Scene; update(dt: number): void; refresh(): void; setView(tab: GarageTab): void; setCondition(healthRatio: number, tiresRatio: number): void; resize(): void; dispose(): void } {
  const scene = new Scene(engine);
  scene.clearColor = Color4.FromHexString('#272318ff');
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = .009;
  scene.fogColor = Color3.FromHexString('#4a3d29');
  scene.imageProcessingConfiguration.contrast = 1.12;
  scene.imageProcessingConfiguration.exposure = 1.04;
  scene.imageProcessingConfiguration.vignetteEnabled = true;
  scene.imageProcessingConfiguration.vignetteWeight = .75;
  const camera = new FreeCamera('workshop-camera', new Vector3(7.4, 3.6, -8), scene);
  camera.minZ = .08; camera.maxZ = 65; camera.fov = .56;
  const target = new Vector3(-.78, .84, -.46);
  const views: Record<GarageTab, { angle: number; radius: number; height: number; targetY: number; offset: number; fov: number }> = {
    garage: { angle: 2.4, radius: 10.8, height: 4.3, targetY: .82, offset: .95, fov: .59 },
    cars: { angle: 2.22, radius: 11.1, height: 4.6, targetY: .8, offset: 1.45, fov: .58 },
    tuning: { angle: 2.35, radius: 8.7, height: 2.9, targetY: .78, offset: 1.32, fov: .65 },
    body: { angle: 3.95, radius: 8.9, height: 3, targetY: .86, offset: 1.32, fov: .65 }
  };
  let view = { ...views.garage }, viewFrom = { ...view }, viewTo = { ...view }, transition = 1;
  let activeTab: GarageTab = 'garage';
  let aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
  camera.setTarget(target);
  scene.activeCamera = camera;
  const ambient = new HemisphericLight('workshop-ambient', new Vector3(0, 1, 0), scene);
  ambient.diffuse = Color3.FromHexString('#e7d4ac'); ambient.groundColor = Color3.FromHexString('#8c7448'); ambient.intensity = .61;
  const key = new SpotLight('workshop-warm-key', new Vector3(-4, 5.3, -2.8), new Vector3(3, -4, 3), Math.PI / 1.7, 2, scene);
  key.diffuse = Color3.FromHexString('#ffd18a'); key.intensity = 2.15; key.range = 24; key.shadowMinZ = .2; key.shadowMaxZ = 28;
  const cool = new PointLight('workshop-overhead', new Vector3(2, 5.4, -.7), scene);
  cool.diffuse = Color3.FromHexString('#ffe7b5'); cool.intensity = 1.2; cool.range = 20;
  const back = new PointLight('workshop-sodium', new Vector3(-7.8, 3.8, 8.6), scene);
  back.diffuse = Color3.FromHexString('#fba64d'); back.intensity = 1.8; back.range = 17;
  const shadows = new ShadowGenerator(1024, key);
  shadows.useBlurExponentialShadowMap = true; shadows.blurKernel = 14;
  shadows.bias = .0005; shadows.normalBias = .025; shadows.setDarkness(.38);
  const glow = new GlowLayer('workshop-fixtures', scene, { mainTextureFixedSize: 512, blurKernelSize: 22 });
  glow.intensity = .3;
  const batches = new Map<StandardMaterial, Mesh[]>();
  const staticCasters: Mesh[] = [];
  let randomState = 7319;
  const random = () => { randomState = (Math.imul(randomState, 1664525) + 1013904223) | 0; return (randomState >>> 0) / 4294967296; };
  const mat = (name: string, hex: string, emissive = 0) => {
    const m = new StandardMaterial(`workshop-${name}`, scene);
    m.diffuseColor = Color3.FromHexString(hex); m.specularColor = new Color3(.06, .065, .06);
    m.specularPower = 32; m.maxSimultaneousLights = 4;
    if (emissive) m.emissiveColor = m.diffuseColor.scale(emissive);
    return m;
  };
  const concrete = mat('concrete', '#c3baa2'), brick = mat('brick', '#b1a58a');
  const darkConcrete = mat('lower-wall', '#615e50'), steel = mat('steel', '#545e58');
  const darkSteel = mat('dark-steel', '#29322e'), silver = mat('bare-metal', '#89918a');
  const yellow = mat('safety-yellow', '#d7ad35'), black = mat('rubber', '#1c2320');
  const liftBlue = mat('lift-blue', '#3b576b'), cardboard = mat('cardboard', '#967441'), tape = mat('packing-tape', '#c6ad76');
  const bayLight = mat('bay-light', '#f2cc26', .9), pegboard = mat('pegboard', '#b7aa86');
  // The strip emits its own saturated yellow; adding the workshop lights clips it white.
  bayLight.disableLighting = true; bayLight.specularColor = Color3.Black();
  const rust = mat('rust', '#72412d'), red = mat('tool-red', '#72382a');
  const wood = mat('wood', '#a38a59'), white = mat('tube', '#ffe1a1', 2.1);
  const sodium = mat('sodium-lamp', '#ffc568', 1.4), poster = mat('sign', '#e3c876', .13);

  function texture(name: string, width: number, height: number, paint: (ctx: CanvasRenderingContext2D) => void) {
    const t = new DynamicTexture(name, { width, height }, scene, false);
    // Canvas starts at the top-left; Babylon's plane UVs require the Y-flipped upload.
    paint(t.getContext() as unknown as CanvasRenderingContext2D); t.update(true);
    return t;
  }
  concrete.diffuseTexture = texture('concrete-floor-texture', 1024, 1024, ctx => {
    ctx.fillStyle = '#858170'; ctx.fillRect(0, 0, 1024, 1024);
    for (let row = 0; row < 32; row++) for (let col = 0; col < 32; col++) { const n = Math.floor(100 + random() * 27); ctx.fillStyle = `rgb(${n + 10},${n + 5},${n - 9})`; ctx.fillRect(col * 32 + 1, row * 32 + 1, 30, 30); }
    for (let i = 0; i < 15000; i++) { const n = Math.floor(70 + random() * 95); ctx.fillStyle = `rgba(${n},${n + 3},${n - 5},.2)`; ctx.fillRect(random() * 1024, random() * 1024, random() * 4 + 1, random() * 3 + 1); }
    ctx.strokeStyle = '#383f383b'; ctx.lineWidth = 2;
    for (let i = 1; i < 8; i++) { ctx.beginPath(); ctx.moveTo(i * 128, 0); ctx.lineTo(i * 128, 1024); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i * 128); ctx.lineTo(1024, i * 128); ctx.stroke(); }
    for (let i = 0; i < 28; i++) {
      let x = random() * 1024, y = random() * 1024; ctx.strokeStyle = '#282f2855'; ctx.lineWidth = .7 + random(); ctx.beginPath(); ctx.moveTo(x, y);
      for (let j = 0; j < 5; j++) { x += random() * 45 - 20; y += random() * 40; ctx.lineTo(x, y); } ctx.stroke();
    }
    for (let i = 0; i < 25; i++) { const x = 280 + random() * 480, y = 220 + random() * 580, r = 10 + random() * 40; const stain = ctx.createRadialGradient(x, y, 0, x, y, r); stain.addColorStop(0, '#151c1780'); stain.addColorStop(1, '#151c1700'); ctx.fillStyle = stain; ctx.beginPath(); ctx.ellipse(x, y, r, r * .6, random(), 0, Math.PI * 2); ctx.fill(); }
  });
  brick.diffuseTexture = texture('workshop-brick-texture', 1024, 512, ctx => {
    ctx.fillStyle = '#403f35'; ctx.fillRect(0, 0, 1024, 512);
    for (let row = 0; row < 13; row++) for (let col = -1; col < 10; col++) { const n = Math.floor(68 + random() * 35); ctx.fillStyle = `rgb(${n + 21},${n + 8},${n - 4})`; ctx.fillRect(col * 112 + row % 2 * 56 + 3, row * 40 + 3, 106, 34); }
    for (let i = 0; i < 1800; i++) { ctx.fillStyle = random() > .5 ? '#141c1618' : '#bcba8a09'; ctx.fillRect(random() * 1024, random() * 512, 20 + random() * 70, 2 + random() * 40); }
  });
  (brick.diffuseTexture as DynamicTexture).uScale = 4;
  pegboard.diffuseTexture = texture('perforated-tool-board', 512, 256, ctx => { ctx.fillStyle = '#9c8c67'; ctx.fillRect(0, 0, 512, 256); ctx.fillStyle = '#4b4839'; for (let x = 12; x < 512; x += 16) for (let y = 12; y < 256; y += 16) { ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill(); } });
  function register(mesh: Mesh, material: StandardMaterial, cast = true, batch = true) {
    mesh.material = material; mesh.isPickable = false; mesh.receiveShadows = true;
    if (batch) { const group = batches.get(material) || []; group.push(mesh); batches.set(material, group); }
    if (cast && !batch) staticCasters.push(mesh);
    return mesh;
  }
  function box(name: string, x: number, y: number, z: number, w: number, h: number, d: number, material: StandardMaterial, cast = true) {
    const m = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene); m.position.set(x, y, z); return register(m, material, cast, cast);
  }
  function cylinder(name: string, x: number, y: number, z: number, diameter: number, height: number, material: StandardMaterial) {
    const m = MeshBuilder.CreateCylinder(name, { diameter, height, tessellation: 12 }, scene); m.position.set(x, y, z); return register(m, material);
  }
  function tube(name: string, points: Vector3[], radius: number, material: StandardMaterial) {
    return register(MeshBuilder.CreateTube(name, { path: points, radius, tessellation: 8 }, scene), material);
  }
  const floor = MeshBuilder.CreateGround('workshop-floor', { width: 24, height: 27 }, scene);
  register(floor, concrete, false, false);
  box('back-wall-lower', 0, 1.25, 11.7, 24, 2.5, .4, darkConcrete);
  box('back-wall-brick', 0, 4.35, 11.7, 24, 3.7, .4, brick);
  for (const side of [-1, 1]) { box('side-wall-lower', side * 11.8, 1.25, 0, .4, 2.5, 24, darkConcrete); box('side-wall-brick', side * 11.8, 4.35, 0, .4, 3.7, 24, brick); }
  box('front-wall-lower', 0, 1.25, -12.3, 24, 2.5, .4, darkConcrete); box('front-wall-upper', 0, 4.35, -12.3, 24, 3.7, .4, brick);
  box('roof', 0, 6.35, 0, 24, .22, 25, darkSteel);
  for (const z of [-10, -5, 0, 5, 10]) {
    box('roof-crossbeam', 0, 5.98, z, 23.6, .28, .22, steel);
    for (const x of [-10.6, 10.6]) box('support-column', x, 3, z, .24, 6, .25, steel);
  }
  for (const x of [-7, 0, 7]) box('roof-long-beam', x, 6.1, 0, .17, .28, 24, steel);
  for (const z of [-4.4, 2.2, 8.4]) for (const x of [-4.8, 4.8]) {
    box('light-fixture', x, 5.68, z, 2.5, .12, .4, darkSteel);
    for (const dz of [-.1, .1]) { const light = box('fluorescent-tube', x, 5.59, z + dz, 2.24, .055, .075, white, false); glow.addIncludedOnlyMesh(light); }
    tube('light-suspension', [new Vector3(x - .8, 6.2, z), new Vector3(x - .8, 5.7, z)], .018, black);
  }
  for (const [x, z] of [[-1.8, -5.3], [6.5, 3.6]]) { cylinder('pendant-stem', x, 5.85, z, .06, 1.0, black); const shade = cylinder('pendant-shade', x, 5.25, z, .9, .5, darkSteel); const lamp = box('pendant-bulb', x, 4.99, z, .65, .03, .65, sodium, false); glow.addIncludedOnlyMesh(lamp); shade.receiveShadows = false; }
  // A real rolling shutter and side access door anchor the enclosed room.
  box('shutter-recess', 3.1, 2.6, 11.35, 7.7, 5.3, .22, black);
  box('shutter-sheet', 3.1, 2.5, 11.15, 7.2, 5, .12, steel);
  for (let i = 0; i < 29; i++) box('shutter-corrugation', 3.1, .14 + i * .17, 11.03, 7.2, .038, .07, i % 5 === 0 ? rust : silver);
  box('shutter-left-track', -.65, 2.65, 10.97, .16, 5.4, .3, darkSteel); box('shutter-right-track', 6.85, 2.65, 10.97, .16, 5.4, .3, darkSteel);
  box('shutter-handle', 3.1, .68, 10.89, .65, .06, .08, black);
  box('side-door-frame', -9.6, 1.58, 11.15, 1.65, 3.16, .2, steel); box('side-door', -9.6, 1.52, 11, 1.4, 3, .12, darkSteel);
  box('door-window', -9.6, 2.1, 10.9, .92, .55, .03, black); box('door-handle', -9.05, 1.4, 10.8, .1, .06, .15, silver);
  // Twin lift posts stay behind the car; the car itself rests on the concrete.
  for (const side of [-1, 1]) {
    box('lift-base', side * 4, .055, 2.1, 1.15, .11, 1.1, darkSteel);
    box('lift-post', side * 4, 2.07, 2.1, .52, 4.1, .58, liftBlue);
    box('lift-yellow-foot', side * 4, .36, 2.1, .78, .64, .8, yellow);
    box('lift-post-track', side * 4, 2.05, 1.81, .23, 3.6, .07, darkSteel);
    box('lift-arm', side * 2.8, .16, 1.9, 2.1, .14, .24, yellow);
    box('lift-pad', side * 1.75, .23, 1.9, .4, .07, .4, black);
    box('parking-line', side * 2.3, .008, -.4, .055, .012, 6.8, yellow, false);
    for (let i = 0; i < 6; i++) { const stripe = box('lift-caution-stripe', side * 4, .48 + i * .16, 1.84, .43, .075, .012, black); stripe.rotation.z = .18; }
  }
  box('parking-stop-line', 0, .008, -3.8, 4.65, .012, .06, yellow, false);
  for (const side of [-1, 1]) { const line = box('illuminated-bay-side', side * 3.05, .025, -.1, .065, .025, 6.6, bayLight, false); glow.addIncludedOnlyMesh(line); const edge = box('illuminated-bay-end', 0, .025, side * 3.3 - .1, 6.15, .025, .065, bayLight, false); glow.addIncludedOnlyMesh(edge); }
  for (let i = 0; i < 11; i++) { const mark = box('bay-caution-tile', -2.7 + i * .54, .019, -3.57, .22, .016, .46, tape, false); mark.rotation.y = -.3; }
  box('floor-drain', 5.2, .012, -.5, .62, .02, 6.6, darkSteel, false);
  for (let i = 0; i < 31; i++) box('drain-grate', 5.2, .028, -3.7 + i * .21, .56, .018, .035, silver, false);
  // Workbench, drawer cabinets and perforated tool board.
  box('workbench-top', -5.5, 1.16, 9.5, 5.2, .14, 1.35, wood);
  for (const x of [-7.7, -3.3]) for (const z of [9, 10]) box('bench-leg', x, .55, z, .13, 1.1, .13, darkSteel);
  box('drawer-cabinet', -6.9, .62, 9.4, 1.5, 1.1, 1.08, red);
  for (let i = 0; i < 4; i++) { box('drawer-front', -6.9, .25 + i * .25, 8.83, 1.37, .2, .05, red); box('drawer-pull', -6.9, .3 + i * .25, 8.78, .62, .035, .06, silver); }
  box('tool-board', -5.6, 2.7, 11.02, 5.3, 2.4, .08, pegboard);
  for (let i = 0; i < 13; i++) {
    const x = -7.9 + i * .38, y = 2.8 + Math.sin(i * 2) * .4;
    box('hanging-tool', x, y, 10.93, .05, .4 + i % 3 * .12, .06, silver);
    const head = cylinder('wrench-head', x, y + .23, 10.92, .12, .04, silver); head.rotation.x = Math.PI / 2;
  }
  box('bench-vise', -3.7, 1.35, 9.2, .42, .3, .4, darkSteel); box('vise-jaws', -3.7, 1.55, 9.2, .56, .1, .16, silver);
  for (let i = 0; i < 7; i++) box('parts-on-bench', -6 + random() * 2, 1.3, 9.1 + random() * .7, .12 + random() * .15, .13, .18, i % 2 ? steel : rust);
  box('tall-storage-cabinet', 8.8, 1.7, 9.6, 2.45, 3.4, 1.15, steel);
  box('cabinet-seam', 8.8, 1.7, 9, .025, 3.2, .03, black);
  for (const x of [8.62, 8.98]) box('cabinet-handle', x, 1.6, 8.94, .045, .35, .05, silver);
  for (let i = 0; i < 4; i++) {
    const tire = MeshBuilder.CreateTorus('spare-tire', { diameter: .94, thickness: .3, tessellation: 16 }, scene);
    tire.position.set(-8.9, .22 + i * .3, 5.9); register(tire, black);
  }
  for (const [x, z] of [[8, 5.6], [9.2, 5.9], [-9.6, 7.8]]) {
    cylinder('oil-barrel', x, .7, z, 1, 1.4, red);
    for (const y of [.12, .42, 1.07, 1.3]) { const band = MeshBuilder.CreateTorus('barrel-ring', { diameter: 1.015, thickness: .045, tessellation: 16 }, scene); band.position.set(x, y, z); register(band, darkSteel); }
    cylinder('barrel-cap', x + .25, 1.42, z, .13, .025, black);
  }
  const tank = cylinder('compressor-tank', 8.9, .68, 2.9, .8, 1.8, yellow); tank.rotation.z = Math.PI / 2;
  box('compressor-motor', 8.9, 1.24, 2.9, .75, .4, .55, darkSteel);
  for (const x of [8.3, 9.5]) box('compressor-foot', x, .21, 2.9, .12, .4, .65, steel);
  tube('air-hose', [new Vector3(8.3, 1, 2.9), new Vector3(7.7, .15, 2.2), new Vector3(7, .035, .6), new Vector3(6.2, .035, -.2), new Vector3(5.5, .04, .2)], .035, black);
  // A low floor jack and wheeled trolley provide foreground scale.
  box('floor-jack-base', -3.6, .13, -2.4, .5, .2, 1.1, red); const jackHandle = box('jack-handle', -3.6, .65, -2.85, .05, 1.2, .05, darkSteel); jackHandle.rotation.x = -.35;
  box('tool-trolley', -6.8, .66, -1.8, 1.4, .9, .85, red); box('tool-trolley-top', -6.8, 1.14, -1.8, 1.5, .08, .94, black);
  for (const x of [-7.3, -6.3]) for (const z of [-2.1, -1.5]) cylinder('trolley-caster', x, .18, z, .18, .12, black).rotation.z = Math.PI / 2;
  tube('water-main', [new Vector3(-11.42, 1, -10), new Vector3(-11.42, 4.7, -10), new Vector3(-11.42, 4.7, 10), new Vector3(-11.42, 3.9, 10), new Vector3(-8.3, 3.9, 10)], .095, rust);
  tube('back-wall-pipe', [new Vector3(-10, 5.4, 11.1), new Vector3(10.6, 5.4, 11.1), new Vector3(10.6, 2, 11.1)], .065, steel);
  for (const x of [-8.1, 7.2]) tube('hanging-cable', [new Vector3(x, 6.15, -1), new Vector3(x, 4.6, -.8), new Vector3(x + .15, 3.5, -.4), new Vector3(x + .2, 4.2, -.1), new Vector3(x, 6.15, 0)], .025, black);
  // Storage, stairs and an accessible-looking mezzanine give the room a real scale.
  function crate(x: number, y: number, z: number, w = .75, h = .65, d = .65) {
    box('storage-box', x, y + h / 2, z, w, h, d, cardboard);
    box('box-top-tape', x, y + h + .01, z, .12, .018, d + .015, tape);
    box('box-front-tape', x, y + h / 2, z - d / 2 - .009, .12, h, .012, tape);
  }
  function shelf(x: number, z: number, width = 2.2, height = 3.4) {
    for (const dx of [-width / 2, width / 2]) for (const dz of [-.43, .43]) box('shelf-post', x + dx, height / 2, z + dz, .075, height, .075, darkSteel);
    for (const y of height < 3.4 ? [.15, 1.13, 2.15] : [.15, 1.18, 2.2, 3.25]) { box('shelf-tray', x, y, z, width, .09, .98, steel); for (const dx of [-.55, .45]) if (random() > .16) crate(x + dx, y + .05, z, .55 + random() * .25, .43 + random() * .3, .62); }
  }
  shelf(-9.1, 9.1); shelf(5.8, 10.6, 2.1, 3.1); shelf(9.9, 8.6, 2, 3.1);
  for (const [x, z] of [[-5.8, -6.3], [-4.7, -6.6], [6.8, 7.2], [10.4, 1.6]]) crate(x, 0, z, .85, .85, .8);
  for (const x of [4.6, 10.8]) for (const z of [6.2, 10.5]) box('mezzanine-support', x, 1.7, z, .18, 3.4, .18, darkSteel);
  box('mezzanine-deck', 7.7, 3.45, 8.4, 6.6, .22, 4.7, steel);
  for (const z of [6.04, 10.73]) {
    for (const [start, end] of z < 7 ? [[4.4, 7.95], [9.65, 11.05]] : [[4.4, 11.05]]) { box('mezzanine-top-rail', (start + end) / 2, 4.52, z, end - start, .075, .075, yellow); box('mezzanine-middle-rail', (start + end) / 2, 3.99, z, end - start, .06, .06, yellow); }
    for (let x = 4.4; x <= 11.05; x += 1.1) if (z > 7 || x < 8 || x > 9.6) box('mezzanine-railing', x, 4, z, .065, 1.1, .065, yellow);
  }
  for (const x of [4.4, 11]) { box('mezzanine-side-rail', x, 4.52, 8.4, .075, .075, 4.7, yellow); for (const z of [6.2, 7.6, 9, 10.5]) box('mezzanine-side-post', x, 4, z, .065, 1.1, .065, yellow); }
  for (let i = 0; i < 12; i++) { const z = 1.65 + i * .36, y = .14 + i * .28; box('stair-tread', 8.8, y, z, 1.5, .13, .38, steel); box('stair-yellow-nosing', 8.8, y + .072, z - .17, 1.5, .02, .05, yellow); }
  for (const x of [8.12, 9.48]) tube('stair-stringer', [new Vector3(x, .06, 1.4), new Vector3(x, 3.36, 5.85)], .095, darkSteel);
  for (const x of [8, 9.6]) { tube('stair-handrail', [new Vector3(x, .95, 1.4), new Vector3(x, 4.37, 5.78)], .045, yellow); for (let i = 0; i < 12; i += 3) box('stair-rail-post', x, .64 + i * .28, 1.65 + i * .36, .055, 1, .055, yellow); }
  for (const [x, z] of [[5.3, 9.9], [6.3, 10], [7.7, 10.1]]) crate(x, 3.57, z, .75, .7, .7);
  for (let i = 0; i < 3; i++) { const tire = MeshBuilder.CreateTorus('mezzanine-spare-tire', { diameter: .94, thickness: .3, tessellation: 16 }, scene); tire.position.set(10, 3.77 + i * .3, 9.7); register(tire, black); }
  cylinder('workshop-stool-seat', -4.5, .88, 7.8, .7, .12, wood); for (const dx of [-.22, .22]) for (const dz of [-.22, .22]) box('stool-leg', -4.5 + dx, .42, 7.8 + dz, .065, .84, .065, steel);
  function wallGraphic(name: string, x: number, y: number, z: number, width: number, height: number, angle: number, lines: string[], logo = false) {
    const m = mat(name, '#f1d98c', .22);
    const t = texture(name + '-texture', 768, 512, ctx => {
      ctx.clearRect(0, 0, 768, 512);
      if (!logo) { ctx.fillStyle = '#292b23'; ctx.fillRect(0, 0, 768, 512); ctx.strokeStyle = '#827147'; ctx.lineWidth = 10; ctx.strokeRect(5, 5, 758, 502); }
      ctx.fillStyle = '#e6bf48';
      if (logo) { ctx.save(); ctx.translate(260, 35); ctx.transform(1, 0, -.3, 1, 0, 0); ctx.fillRect(0, 45, 52, 160); ctx.fillRect(73, 0, 52, 220); ctx.fillRect(146, 20, 52, 180); ctx.restore(); ctx.font = 'bold 104px Arial'; ctx.textAlign = 'center'; ctx.fillStyle = '#cfb57a'; ctx.fillText('DUSTLINE', 384, 370); }
      else { ctx.font = 'bold 64px Arial'; ctx.textAlign = 'left'; ctx.fillStyle = '#d5bc7f'; lines.forEach((line, i) => ctx.fillText(line, 55, 100 + i * 77)); ctx.strokeStyle = '#d5bc7f'; ctx.lineWidth = 12; ctx.beginPath(); ctx.moveTo(160, 485); ctx.lineTo(600, 360); ctx.lineTo(690, 485); ctx.stroke(); }
    });
    t.hasAlpha = true; m.diffuseTexture = t; m.useAlphaFromDiffuseTexture = true; m.backFaceCulling = true;
    const plane = MeshBuilder.CreatePlane(name, { width, height }, scene); plane.position.set(x, y, z); plane.rotation.y = angle; register(plane, m, false, false);
  }
  wallGraphic('dustline-back-logo', -6.1, 4.8, 11.43, 5.3, 2.3, 0, [], true);
  wallGraphic('dustline-front-logo', 3.7, 3.8, -12.04, 4.7, 3, Math.PI, [], true);
  wallGraphic('freedom-poster', 11.55, 3.3, -1, 2.35, 3.4, Math.PI / 2, ['БОЛЬШЕ', 'ДОРОГ', 'БОЛЬШЕ', 'СВОБОДЫ']);
  wallGraphic('speed-poster', -11.55, 3.3, -.5, 2.2, 3.3, -Math.PI / 2, ['СКОРОСТЬ', 'СОЗДАЁТ', 'СВОЙ', 'ПУТЬ']);
  wallGraphic('front-poster', -4.5, 3.6, -12.04, 2.2, 3.3, Math.PI, ['БОЛЬШЕ', 'ЧЕМ', 'ДОРОГА']);
  const signTexture = texture('workshop-bay-sign', 512, 192, ctx => {
    ctx.fillStyle = '#282d23'; ctx.fillRect(0, 0, 512, 192); ctx.strokeStyle = '#c6a35c'; ctx.lineWidth = 8; ctx.strokeRect(5, 5, 502, 182);
    ctx.fillStyle = '#cfb978'; ctx.font = 'bold 65px Arial'; ctx.fillText('DUSTLINE', 30, 91); ctx.font = '22px Arial'; ctx.fillText('SERVICE BAY 03 / KEEP CLEAR', 31, 144);
    for (let i = 0; i < 60; i++) { ctx.fillStyle = '#1e241e45'; ctx.fillRect(random() * 512, random() * 192, random() * 50, 2); }
  });
  poster.diffuseTexture = signTexture;
  const sign = MeshBuilder.CreatePlane('workshop-sign', { width: 3.4, height: 1.27 }, scene); sign.position.set(2.9, 5.55, 10.91); register(sign, poster, false, false);
  const amberFixture = box('sodium-wall-light', -8.5, 4, 11.05, .55, .22, .17, sodium, false); glow.addIncludedOnlyMesh(amberFixture);
  // Geometry is batched by material once; the hero vehicle remains independent.
  for (const [material, meshes] of batches) {
    const merged = Mesh.MergeMeshes(meshes, true, true);
    if (merged) { merged.name = `workshop-static-${material.name}`; merged.isPickable = false; merged.receiveShadows = true; merged.freezeWorldMatrix(); staticCasters.push(merged); }
  }
  for (const mesh of scene.meshes) { mesh.isPickable = false; if (!mesh.name.startsWith('vehicle')) mesh.freezeWorldMatrix(); }
  // Soft contact beneath the wheels complements the directional shadow map.
  const contactMat = mat('contact-shadow', '#050b08');
  contactMat.diffuseTexture = texture('car-contact-texture', 128, 256, ctx => {
    ctx.clearRect(0, 0, 128, 256); ctx.save(); ctx.scale(1, 2); const gradient = ctx.createRadialGradient(64, 64, 3, 64, 64, 64); gradient.addColorStop(0, '#06100bb8'); gradient.addColorStop(.55, '#06100b90'); gradient.addColorStop(1, '#06100b00'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128); ctx.restore();
  });
  contactMat.diffuseTexture.hasAlpha = true; contactMat.useAlphaFromDiffuseTexture = true; contactMat.disableLighting = true;
  const contact = MeshBuilder.CreateGround('hero-contact-shadow', { width: 3.5, height: 5.3 }, scene); contact.position.y = .012; contact.material = contactMat; contact.isPickable = false;
  let car: VehicleVisual;
  let conditionHealth = 1, conditionTires = 1, conditionCarId = '';
  function setCondition(healthRatio: number, tiresRatio: number) {
    conditionHealth = Math.max(0, Math.min(1, healthRatio));
    conditionTires = Math.max(0, Math.min(1, tiresRatio));
    car?.setDamage(conditionHealth, conditionTires);
    // Vehicle debris owns cloned materials and releases them in its dispose observer.
    // The workshop keeps the detached-panel appearance without loose flying parts.
    for (const debris of car?.popDebris?.() || []) debris.dispose(false, false);
  }
  function refresh() {
    const spec = getCar();
    if (conditionCarId !== spec.id) { conditionCarId = spec.id; conditionHealth = conditionTires = 1; }
    car?.dispose(); car = createVehicle(scene, spec, getColor()); car.root.position.set(0, .03, 0); car.root.rotation.y = Math.PI + .12;
    car.setTurretEnabled?.(getTurret());car.turret.rotation.y = -.16;
    setCondition(conditionHealth, conditionTires);
    const renderList = [...staticCasters, ...car.root.getChildMeshes()];
    if (shadows.getShadowMap()) shadows.getShadowMap()!.renderList = renderList;
  }
  function applyView() {
    const radius = Math.min(11.1, Math.max(7.8, view.radius));
    camera.position.set(Math.sin(view.angle) * radius, Math.max(2.5, Math.min(4.8, view.height)), Math.cos(view.angle) * radius);
    target.set(Math.cos(view.angle) * view.offset, view.targetY, -Math.sin(view.angle) * view.offset);
    camera.setTarget(target); camera.fov = view.fov * (aspect < 1.25 ? 1.34 : aspect < 1.6 ? 1.1 : 1);
  }
  function setView(tab: GarageTab) {
    const next = views[tab]; if (!next) return;
    activeTab = tab;
    const delta = Math.atan2(Math.sin(next.angle - view.angle), Math.cos(next.angle - view.angle));
    if (Math.abs(delta) < .001 && Math.abs(next.radius - view.radius) < .001 && Math.abs(next.height - view.height) < .001) return;
    viewFrom = { ...view }; viewTo = { ...next, angle: view.angle + delta }; transition = 0;
  }
  function resize() { aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight()); applyView(); }
  refresh(); resize();
  // Diagnostics return copies, so tests cannot move the real camera or preview car.
  scene.metadata = {};
  Object.defineProperty(scene.metadata, 'garageView', { enumerable: true, get: () => ({
    tab: activeTab, transition, view: { ...view }, destination: { ...viewTo },
    cameraPosition: camera.position.asArray(), cameraTarget: target.asArray(), fov: camera.fov,
    carId: conditionCarId, carPosition: car.root.position.asArray(), carRotation: car.root.rotation.asArray()
  }) });
  return {
    scene, refresh, setView, setCondition, resize,
    update(dt: number) { if (transition >= 1) return; transition = Math.min(1, transition + Math.min(.1, Math.max(0, dt)) / .95); const ease = 1 - (1 - transition) ** 3; for (const key of Object.keys(view) as (keyof typeof view)[]) view[key] = viewFrom[key] + (viewTo[key] - viewFrom[key]) * ease; applyView(); },
    dispose() { car?.dispose(); scene.dispose(); }
  };
}
