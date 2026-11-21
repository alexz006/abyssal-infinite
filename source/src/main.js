// ============================================================================
// world loading, camera, frame loop and input
// ============================================================================
// preset viewpoints (position, look-at), keys 1-6; the world generator dresses the scene around them
const POSES = [
  [10, 1.3, 7, -9, -31, -10],
  [50, 1.3, 34, 58, -23, 8],
  [-26, 2.2, -100, 0, -9, -108],
  [-55, 1.5, -18, -60, -30, 8],
  [10, 1.2, -62, 6, -22, -90],
  [3, 1.6, 62, 1, -28, 100],
];
// keys 7-0: four places further and further down, found when the world loads (see below)
const DEEPS = [];
// 60 s camera path (position + look-at, Catmull-Rom): the world generator keeps it clear, dev.js flies along it
const FLY = new Float32Array([
  10, -42.2, 7, -9, -31, -10,
  7.5, -41.8, 5.5, -10, -31, -12,
  9, -40.5, 18, 17, -37, 42,
  22, -39.2, 40, 48, -36, 45,
  38, -39.2, 46, 57, -27, 18,
  50, -40.4, 35, 58, -24, 8,
  55, -39, 20, 60, -18, -10,
  58, -34, -12, 40, -26, -60,
  50, -30, -44, 10, -26, -80,
  30, -30, -70, 4, -28, -90,
  12, -38.5, -62, 6, -27, -90,
  -4, -36.5, -70, 0, -14, -100,
  -16, -37, -84, 0, -22, -108,
  -29, -38, -90, -44, -34, -60,
  -41, -38, -70, -56, -34, -40,
  -53, -38, -50, -60, -34, -20,
  -58, -38, -28, -60, -32, 0,
  -57, -38, -10, -60, -30, 16,
  -60, -38, 10, -50, -36, 40,
  -52, -37, 36, -20, -35, 44,
  -22, -38, 43, 4, -38, 52,
  -6, -39.2, 44.5, 4, -37, 70,
  3, -40.6, 53, 3, -35, 84,
  3, -41.5, 62, 1, -30, 100,
  4, -39, 76, 3, -22, 100,
]);
const FLYN = FLY.length / 6, FLYT = 60, LUTN = 1024, flyLUT = new Float32Array(LUTN + 1);
const flyPts = [];
// per-frame float state lives in one preallocated array, so the frame loop allocates no heap numbers
const F = new Float64Array(32), P6 = new Float64Array(6);
const CX = 0, CY = 1, CZ = 2, YAW = 3, PIT = 4, FX = 5, FY = 6, FZ = 7, RX = 8, RZ = 9, UX = 10, UY = 11, UZ = 12, VX = 13, VY = 14, VZ = 15, TIME = 16, FLT = 17, LAST = 18, GPU = 19, HUDT = 20, SPL = 21, MX = 22, MY = 23, MZ = 24;
// aim the camera from P6 = position + look-at point
function aim() {
  const dx = P6[3] - P6[0], dy = P6[4] - P6[1], dz = P6[5] - P6[2];
  F[CX] = P6[0]; F[CY] = P6[1]; F[CZ] = P6[2];
  F[YAW] = atan2(dx, -dz); F[PIT] = atan2(dy, sqrt(dx * dx + dz * dz));
}
const lookAt = (x, y, z, tx, ty, tz) => { P6[0] = x; P6[1] = y; P6[2] = z; P6[3] = tx; P6[4] = ty; P6[5] = tz; aim(); };
// camera spline (Catmull-Rom over position + look-at) at parameter F[SPL]
function flyRaw() {
  const s = F[SPL]; let i = floor(s) | 0; if (i > FLYN - 2) i = FLYN - 2;
  const u = s - i, i0 = (i > 0 ? i - 1 : 0) * 6, i1 = i * 6, i2 = (i + 1) * 6, i3 = (i + 2 < FLYN ? i + 2 : FLYN - 1) * 6;
  for (let o = 0; o < 6; o++) {
    const a = FLY[i0 + o], b = FLY[i1 + o], c = FLY[i2 + o], d = FLY[i3 + o];
    P6[o] = 0.5 * (2 * b + (c - a) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (3 * b - a - 3 * c + d) * u * u * u);
  }
  aim();
}
{ // arc-length table: flyLUT[k] = spline parameter at fraction k/LUTN of the total path length
  const M = 4096, len = new Float32Array(M + 1); let px = 0, py = 0, pz = 0;
  for (let k = 0; k <= M; k++) { F[SPL] = k / M * (FLYN - 1); flyRaw(); if (k) len[k] = len[k - 1] + hypot(F[CX] - px, F[CY] - py, F[CZ] - pz); px = F[CX]; py = F[CY]; pz = F[CZ]; }
  for (let k = 0, j = 0; k <= LUTN; k++) { const d = k / LUTN * len[M]; while (j < M - 1 && len[j + 1] < d) j++; flyLUT[k] = (j + (d - len[j]) / max(len[j + 1] - len[j], 1e-6)) / M * (FLYN - 1); }
}
// camera on the scripted path at time F[FLT]
function flyAt() {
  let s = F[FLT] / FLYT; s = s < 0 ? 0 : s > 1 ? 1 : s; s = s * s * (3 - 2 * s) * 0.25 + s * 0.75;
  s *= LUTN; let k = floor(s) | 0; if (k > LUTN - 1) k = LUTN - 1;
  F[SPL] = flyLUT[k] + (flyLUT[k + 1] - flyLUT[k]) * (s - k); flyRaw();
}
for (let t = 0; t <= FLYT; t += 0.1) { F[FLT] = t; flyAt(); flyPts.push([F[CX], F[CY], F[CZ]]); }
for (const p of POSES) flyPts.push([p[0], -40, p[2]]);

// ---------------------------------------------------------------- set pieces
await say('Building set pieces…', 0.12, 600);
// marks a load in progress (quality.js); leaving the page before it ends is not a crash
keep('abyssalLoad', 1);
addEventListener('pagehide', () => keep('abyssalLoad', ''));
// mesh ids: 0-3 boulders, 4-6 sponges, 7-8 coral, 9 tube sponge, 10 whale fluke, 11 ship, 12 manta, 13 fish,
// 14-20 rock chunks + pebbles, 21-22 coral LOD, 23-25 far LOD of the large rock chunks
const meshes = [meshChunk(1, 3), meshChunk(7, 3), meshChunk(13, 3), meshChunk(22, 3),
  meshLathe([[0, 0, 0.5], [0.34, 0, 0.6], [0.5, 0.2, 0.85], [0.6, 0.6, 1], [0.55, 0.95, 1], [0.47, 1.08, 1], [0.38, 1.1, 0.9], [0.3, 1.0, 0.45], [0.26, 0.6, 0.15], [0, 0.35, 0.05]], 18, 0.3, 9),
  meshLathe([[0, 0, 0.5], [0.2, 0, 0.6], [0.26, 0.5, 0.85], [0.4, 1.25, 1], [0.4, 1.42, 1], [0.33, 1.48, 0.9], [0.26, 1.38, 0.4], [0.18, 0.8, 0.12], [0, 0.5, 0.05]], 16, 0.35, 8),
  meshLathe([[0, 0, 0.5], [0.5, 0, 0.7], [0.72, 0.18, 1], [0.74, 0.38, 1], [0.62, 0.5, 0.9], [0.48, 0.42, 0.45], [0.4, 0.2, 0.15], [0, 0.14, 0.06]], 18, 0.25, 10),
  meshCoral(0), meshCoral(1), meshTubes()].map((m) => m.build());
// (the ship's mesh also makes the field that keeps the creatures out of its timbers, bots.js)
const flukeMesh = meshFluke(), shipMesh = meshShip(); shipBuild(shipMesh);
meshes.push(flukeMesh, shipMesh.build(), meshManta().build(), meshFish().build(),
  meshChunk(3).build(), meshChunk(11).build(), meshChunk(29).build(), meshChunk(5, 3).build(), meshChunk(17, 3).build(), meshChunk(41, 3).build(), meshChunk(9, 1).build(), meshCoral(0, 1).build(), meshCoral(1, 1).build(), meshChunk(5, 2, 1).build(), meshChunk(17, 2, 1).build(), meshChunk(41, 2, 1).build());
const CRIT0 = meshes.length; meshes.push(...critMeshes()); // the creatures' meshes (creatures.js), in the order of CRIT
let nV = 0, nI = 0;
for (const m of meshes) { m.v0 = nV; m.i0 = nI; nV += m.nv; nI += m.ib.length; }
const allV = new Uint8Array(nV * 16), allI = new Uint32Array(nI);
for (const m of meshes) { allV.set(new Uint8Array(m.vb), m.v0 * 16); allI.set(m.ib, m.i0); }
const vbMesh = buf(allV, BU.VERTEX), ibMesh = buf(allI, BU.INDEX);
const MANTA = meshes[12], FISH = meshes[13];
// drifting particles
rseed(15);
const snow = new Float32Array(9000 * 4); for (let i = 0; i < snow.length; i++) snow[i] = rnd();
const ibSnowB = buf(snow, BU.VERTEX), nSnow = snow.length / 4;

// ---------------------------------------------------------------- the first window of the world
await say('Sculpting the seabed…', 0.2, 600);
// the viewpoints are given as heights above the sea floor
for (const p of POSES) p[1] += await groundAt(p[0], p[2]);
{
  // the nearest far-from-home formation around (x, z) that passes `ok`: its cell's shapes
  const near = (x, z, ok) => { let best = null, bd = 1e18; for (let cz = -7; cz <= 7; cz++) for (let cx = -7; cx <= 7; cx++) { const f = cellShapes(floor(x / FC) + cx, floor(z / FC) + cz); if (ok(f)) { const p = f.clears[0], d = hypot(p[0] - x, p[1] - z); if (d < bd) { bd = d; best = f; } } } return best; };
  // stands the camera `up` metres over the floor at (x, z), looking at a point `dy` higher or lower
  const stand = async (x, z, up, tx, tz, dy) => { const y = await groundAt(x, z) + up; DEEPS.push([x, y, z, tx, y + dy, tz]); };
  // 7: over the gorge, looking down along it (the rim is 55 m down)
  const gy = await groundAt(gorgeX(60) + 45, 60);
  DEEPS.push([gorgeX(60) + 4, gy + 15, 60, gorgeX(125), gy - 30, 125]);
  // 8: over the rift (its rim is about 90 m down, its bed nearly 300)
  const ry = await groundAt(riftX(-420) + 70, -420);
  DEEPS.push([riftX(-420) + 3, ry + 10, -420, riftX(-340), ry - 70, -340]);
  // 9: a rock formation halfway down the slope, about 200 m deep, seen from upslope
  const a = near(-1700, -900, (f) => f.mesas.length > 0 && f.clears[0][0] < -1500), ac = a ? a.clears[0] : [-1700, -900];
  await stand(ac[0] + 56, ac[1] + 16, 12, ac[0], ac[1], -3);
  // 0: far out on the abyssal plain, the deepest water there is: the nearest formation, or the open plain
  const d = near(-8200, 2600, (f) => f.clears.length > 0), dc = d ? d.clears[0] : [-8200, 2600];
  await stand(dc[0] + 40, dc[1] + 22, 9, dc[0], dc[1], -3);
}
startWorkers(POSES, flyPts);
lookAt(...POSES[0]);
// The browser remembers where the player is (localStorage.abyssalAt, written by keepAt: every few seconds once the
// player has dived, when the page is left, and when settings are applied, which reloads it). The next visit builds
// the world there, not at home, with the view as it was (back: the camera's place and angles, then the creature's
// species, place, angles and health), and the dive puts the creature back. Key 1 is the way home.
const keepAt = () => keep('abyssalAt', JSON.stringify([F[CX], F[CY], F[CZ], F[YAW], F[PIT]].concat(me ? [me.s, me.x, me.y, me.z, me.yaw, me.pit, meHP] : [])));
let back = null; try { back = JSON.parse(localStorage.abyssalAt); } catch {}
if (Array.isArray(back) && back.length > 4 && back.every(isFinite)) for (let i = 0; i < 5; i++) F[i] = back[i]; else back = null;
moveWindow(F[CX], F[CZ]);
{
  const all = nWanted, names = ['Sculpting the seabed…', 'Carving canyons…', 'Growing kelp…'];
  for (let shown = -1; nWanted || shadowAll < 2;) {
    pump(true);
    const k = (1 - nWanted / all) * 3 | 0;
    if (k > shown && k < 3) { shown = k; await say(names[k], 0.2 + 0.25 * (k + 1), 2500); }
    await new Promise((r) => setTimeout(r, 8));
  }
}

// ---------------------------------------------------------------- one-time bake: detail texture
{
  const m = mod(W_DETAIL), p = await fullPipe(m, 'rgba8unorm');
  const e = device.createCommandEncoder();
  let r = e.beginRenderPass({ colorAttachments: [colorAtt(tDetail.createView({ baseMipLevel: 0, mipLevelCount: 1 }), true)] });
  r.setPipeline(p); r.draw(3); r.end();
  for (let i = 1; i < 11; i++) {
    r = e.beginRenderPass({ colorAttachments: [colorAtt(tDetail.createView({ baseMipLevel: i, mipLevelCount: 1 }), true)] });
    r.setPipeline(pMip8); r.setBindGroup(0, blitBG(tDetail.createView({ baseMipLevel: i - 1, mipLevelCount: 1 }))); r.draw(3); r.end();
  }
  Q.submit([e.finish()]);
}

// ---------------------------------------------------------------- render targets (rebuilt on resize)
// The scene is drawn at `pix` pixels and scaled up to the window. With the resolution setting on auto, frame() tunes
// it for 60 fps, starting where the last visit left it. `det` scales every draw distance and the haze that hides
// them together (1 = 135 m): DET0 is the distance setting, and frame() draws it in further while tiles are late.
const PIXMAX = 3840 * 2160, // auto never draws more than this (it was 2560 x 1440: an ultrawide window stayed at about 90%)
   PIXMIN = mob ? 25e4 : 5e5, DET0 = VIEWD / 135;
let W = 0, H = 0, DW = 0, DH = 0, pix = RESQ ? 1e9 : +SV[1] || (LV > 1 ? 41e4 : mob ? 1280 * 720 : PIXMAX), det = DET0, dynN = 0, dynT = 0, dynG = 0, dynGN = 0, dynBad = 0, dynOk = 0, dynWait = 3, dynFast = 1;
let passScene, passRays, passBlur, bgBlur, passPost, bgRays, bgPost, bloomPass = [], bloomBG = [], targets = [];
const NB = 6;
function resize() {
  DW = max(2, round(canvas.clientWidth * devicePixelRatio)); DH = max(2, round(canvas.clientHeight * devicePixelRatio));
  const s = RESQ || min(1, sqrt(pix / (DW * DH)));
  const w = max(2, round(DW * s) & ~1), h = max(2, round(DH * s) & ~1);
  if (w === W && h === H) return;
  dynN = dynG = dynGN = 0; dynT = -300; // let the new size settle before measuring again
  W = w; H = h; canvas.width = W; canvas.height = H;
  if (!OFF) ctx.configure({ device, format: FMT, alphaMode: 'opaque' });
  for (const t of targets) t.destroy();
  const tMS = tex(AA > 1 ? W : 1, H, HDR, TU.RENDER_ATTACHMENT, { samples: AA }), tDp = tex(W, H, DEPTH, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING, { samples: AA });
  const tRes = tex(W, H, HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING), tRay = tex(W / 2, H / 2, HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING), tRay2 = tex(W / 2, H / 2, HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING);
  targets = [tMS, tDp, tRes, tRay, tRay2];
  if (OFF) { tOff = tex(W, H, FMT, TU.RENDER_ATTACHMENT | TU.COPY_SRC); targets.push(tOff); }
  const bl = [];
  for (let i = 0; i < NB; i++) { const t = tex(max(1, W >> (i + 1)), max(1, H >> (i + 1)), HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING); bl.push(t); targets.push(t); }
  const vDp = tDp.createView(), vRes = tRes.createView(), vRay = tRay.createView(), vRay2 = tRay2.createView(), vBl = bl.map((t) => t.createView());
  // without anti-aliasing (Low) the scene goes straight into the resolve target, and tMS is one unused column
  passScene = { colorAttachments: [{ view: AA > 1 ? tMS.createView() : vRes, resolveTarget: AA > 1 ? vRes : undefined, loadOp: 'clear', storeOp: AA > 1 ? 'discard' : 'store', clearValue: [0, 0, 0, 1] }],
    depthStencilAttachment: { view: vDp, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'store' } };
  passRays = { colorAttachments: [colorAtt(vRay, true)] };
  passBlur = { colorAttachments: [colorAtt(vRay2, true)] };
  bgBlur = device.createBindGroup({ layout: pRB.getBindGroupLayout(0), entries: [{ binding: 0, resource: vRay }] });
  passPost = { colorAttachments: [{ view: null, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] };
  bgRays = device.createBindGroup({ layout: pRays.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubo } }, { binding: 1, resource: sRep }, { binding: 2, resource: sCmp },
    { binding: 3, resource: tShadow.createView() }, { binding: 4, resource: (tWS || tWater).createView() }, { binding: 5, resource: vDp }, { binding: 6, resource: tVol.createView() }, { binding: 7, resource: sWrap }] });
  bgPost = device.createBindGroup({ layout: pPost.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubo } }, { binding: 1, resource: sClamp }, { binding: 2, resource: vRes },
    { binding: 3, resource: vRay2 }, { binding: 4, resource: vBl[0] }, { binding: 5, resource: vDp }] });
  bloomPass = []; bloomBG = [];
  // down: res -> b0 -> ... -> b5 ; up: b5 -> b4 (additive) ... -> b0
  for (let i = 0; i < NB; i++) { bloomPass.push({ colorAttachments: [colorAtt(vBl[i], true)] }); bloomBG.push(blitBG(i ? vBl[i - 1] : vRes)); }
  for (let i = NB - 1; i > 0; i--) { bloomPass.push({ colorAttachments: [colorAtt(vBl[i - 1], false)] }); bloomBG.push(blitBG(vBl[i])); }
  UB[52] = W; UB[53] = H; UB[54] = 1 / W; UB[55] = 1 / H;
}
resize();
addEventListener('resize', resize);

// ---------------------------------------------------------------- timing (GPU timestamp queries)
let qs, qResolve, qRead = [], tsBegin, tsEnd;
if (hasTS) {
  qs = device.createQuerySet({ type: 'timestamp', count: 2 });
  qResolve = device.createBuffer({ size: 16, usage: BU.QUERY_RESOLVE | BU.COPY_SRC });
  for (let i = 0; i < 6; i++) {
    const b = device.createBuffer({ size: 16, usage: BU.MAP_READ | BU.COPY_DST });
    const o = { b, busy: false, done: null };
    o.done = () => {
      const a = new BigInt64Array(b.getMappedRange());
      const ms = Number(a[1] - a[0]) / 1e6; F[GPU] = ms; b.unmap(); o.busy = false;
      if (dynT > 0 && ms > 0 && ms < 1e3) { dynG += ms; dynGN++; }
    };
    qRead.push(o);
  }
  tsBegin = { querySet: qs, beginningOfPassWriteIndex: 0 }; tsEnd = { querySet: qs, endOfPassWriteIndex: 1 };
}

// ---------------------------------------------------------------- frame
let hud = false;
let kf = 0, kb = 0, kl = 0, kr = 0, ku = 0, kd = 0, ks = 0, mdx = 0, mdy = 0, lkx = 0, lky = 0, l2x = 0, l2y = 0, hN = 0, hMax = 0, hMin = 1e9, hPer = 1e9, hLate = 0, hTot = 0, tId = -1, tN = 0, tx0 = 0, ty0 = 0, tx = 0, ty = 0;
const TANH = 0.6, NEAR = 0.1, EXPO = 0.62; let RAYS = GFX[5] ? 0.54 : 0, HIDE = 0; // HIDE: dev.js can leave passes out (1 terrain, 2 solids, 4 mantas, 8 fish, 16 leaves, 32 surface)
const submitList = [null];
function render() {
  // camera basis (right vector is horizontal)
  const cx = F[CX], cy = F[CY], cz = F[CZ], pitch = F[PIT], yaw = F[YAW];
  const cp = cos(pitch), fy = sin(pitch), rx = cos(yaw), rz = sin(yaw), fx = cp * rz, fz = -cp * rx;
  const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
  F[FX] = fx; F[FY] = fy; F[FZ] = fz; F[RX] = rx; F[RZ] = rz; F[UX] = ux; F[UY] = uy; F[UZ] = uz;
  const asp = W / H, sx = 1 / (TANH * asp), sy = 1 / TANH, m = UB;
  m[0] = rx * sx; m[4] = 0; m[8] = rz * sx; m[12] = -(rx * cx + rz * cz) * sx;
  m[1] = ux * sy; m[5] = uy * sy; m[9] = uz * sy; m[13] = -(ux * cx + uy * cy + uz * cz) * sy;
  m[2] = 0; m[6] = 0; m[10] = 0; m[14] = NEAR;
  m[3] = fx; m[7] = fy; m[11] = fz; m[15] = -(fx * cx + fy * cy + fz * cz);
  m[32] = cx; m[33] = cy; m[34] = cz; m[35] = F[TIME];
  m[36] = rx; m[37] = 0; m[38] = rz; m[39] = TANH * asp;
  m[40] = ux; m[41] = uy; m[42] = uz; m[43] = TANH;
  m[44] = fx; m[45] = fy; m[46] = fz; m[47] = NEAR;
  m[51] = zoneL(cx, cz);
  let ek = (-cy - 8) / 26; ek = ek < 0 ? 0 : ek > 1 ? 1 : ek;
  let es = -cy / 22; es = es > 1 ? 1 : es; // the glare of the shallows
  // the eye gets used to the dark of the deep: from 60 m down, and once more in the abyss below 300 m
  let dq = (-cy - 60) / 240; dq = dq < 0 ? 0 : dq > 1 ? 1 : dq;
  let da = (-cy - 300) / 400; da = da < 0 ? 0 : da > 1 ? 1 : da;
  m[56] = EXPO * (0.6 + 0.4 * ek) * (0.55 + 0.45 * es) * (1 + 15 * dq * dq * (3 - 2 * dq) + 12 * da);
  m[57] = RAYS; m[58] = det;
  m[59] = dq * dq * (3 - 2 * dq); // how far into the dark: the deep's own faint glow (see amb() and fog())
  botShadows(UB);
  Q.writeBuffer(ubo, 0, UB);
  WT[0] = F[TIME]; Q.writeBuffer(uboW, 0, WT);

  sortTiles();
  const e = device.createCommandEncoder();
  let slot = null;
  if (hasTS) { for (let i = 0; i < qRead.length; i++) if (!qRead[i].busy) { slot = qRead[i]; break; } }
  waterPass[0].timestampWrites = slot ? tsBegin : undefined;
  passPost.timestampWrites = slot ? tsEnd : undefined;
  // animated water texture + mips
  let r = e.beginRenderPass(waterPass[0]); r.setPipeline(pWater); r.setBindGroup(0, bgWater); r.draw(3); r.end();
  for (let i = 1; i < 5; i++) { r = e.beginRenderPass(waterPass[i]); r.setPipeline(pMip16); r.setBindGroup(0, waterBG[i - 1]); r.draw(3); r.end(); }
  if (wave) { const c = e.beginComputePass(); wave.sim(c); c.end(); } // the simulated waves (waves.js)
  // scene
  r = e.beginRenderPass(passScene);
  r.setBindGroup(0, bg0);
  // every loaded tile brings its own buffers; `order` has them nearest first
  r.setPipeline(pTerrain); r.setVertexBuffer(1, ibIdent);
  for (let k = 0; k < nOrder; k++) { const t = order[k]; if (t.vis && t.ib && !(HIDE & 1)) { r.setVertexBuffer(0, t.vb); r.setIndexBuffer(t.ib, 'uint32'); drawPart(r, t, t.terr, 1.5, 1, 0, 0, 137 * det + 1); } }
  r.setPipeline(pSolid); r.setVertexBuffer(0, vbMesh); r.setIndexBuffer(ibMesh, 'uint32');
  for (let k = 0; k < nOrder; k++) {
    const t = order[k]; if (!t.solB || HIDE & 2) continue;
    r.setVertexBuffer(1, t.solB);
    for (let i = 0; i < 12; i++) { const n = t.solids[i * 2 + 1]; if (n) r.drawIndexed(meshes[i].ib.length, n, meshes[i].i0, meshes[i].v0, t.solids[i * 2]); }
    if (!t.vis || t.d2 > 22500) continue;
    for (let i = 0; i < NCHUNK; i++) {
      const c = t.chunks[i], big = i > 2 && i < 6;
      drawPart(r, t, c, 3, meshes[14 + i], 0, 0, i > 5 ? 30 : big ? 40 : 96);
      if (big) drawPart(r, t, c, 3, meshes[20 + i], 0, 40, 150);
    }
    for (let i = 0; i < 6; i++) {
      const lod = i === 3 || i === 4;
      drawPart(r, t, t.props[i], 3, meshes[4 + i], 0, 0, lod ? 6 : 132);
      if (lod) drawPart(r, t, t.props[i], 3, meshes[18 + i], 0, 6, 132);
    }
  }
  r.setPipeline(pManta);
  for (let k = 0; k < nOrder; k++) { const t = order[k], n = t.misc[7]; if (n && !(HIDE & 4)) { r.setVertexBuffer(1, t.miscB); r.drawIndexed(MANTA.ib.length, n, MANTA.i0, MANTA.v0, t.misc[6]); } }
  botDraw(r, CRIT0);
  r.setPipeline(pFish);
  for (let k = 0; k < nOrder; k++) { const t = order[k], n = t.misc[5]; if (n && t.d2 < 32400) { r.setVertexBuffer(1, t.miscB); r.drawIndexed(FISH.ib.length, n, FISH.i0, FISH.v0, t.misc[4]); } }
  // kelp and plants: 9-row blades up close, 5 rows mid-range, a decimated set far away
  r.setPipeline(pLeaf);
  for (let k = 0; k < nOrder; k++) { const t = order[k]; if (t.vis && t.leafB && t.d2 < 576) { r.setVertexBuffer(0, t.leafB); drawPart(r, t, t.big, 5, false, 18, 0, 24); } }
  r.setPipeline(pLeaf5);
  for (let k = 0; k < nOrder; k++) { const t = order[k]; if (t.vis && t.leafB && t.d2 < 3364) { r.setVertexBuffer(0, t.leafB); drawPart(r, t, t.big, 5, false, 10, 24, 58); } }
  r.setPipeline(pLeafF);
  for (let k = 0; k < nOrder; k++) { const t = order[k]; if (t.vis && t.leafB && t.d2 < 22500) { r.setVertexBuffer(0, t.leafB); drawPart(r, t, t.bigF, 5, false, 6, 58, 150); } }
  r.setPipeline(pLeafS);
  for (let k = 0; k < nOrder; k++) { const t = order[k]; if (t.vis && t.leafB && t.d2 < 4900) { r.setVertexBuffer(0, t.leafB); drawPart(r, t, t.small, 1.5, false, 6, 0, 70); } }
  if (!(HIDE & 32)) { if (wave) { r.setPipeline(wave.pipe); r.setVertexBuffer(0, wave.vb); r.setIndexBuffer(wave.ib, 'uint16'); r.drawIndexed(wave.n); } else { r.setPipeline(pSurf); r.draw(4); } }
  r.setPipeline(pBack); r.draw(4);
  r.setPipeline(pBub);
  for (let k = 0; k < nOrder; k++) { const t = order[k], n = t.misc[1]; if (n && t.d2 < 14400) { r.setVertexBuffer(0, t.miscB); r.draw(4, n, 0, t.misc[0]); } }
  gurDraw(r);
  r.setPipeline(pGl);
  for (let k = 0; k < nOrder; k++) { const t = order[k], n = t.misc[3]; if (n && t.vis && t.d2 < 14400) { r.setVertexBuffer(0, t.miscB); r.draw(4, n, 0, t.misc[2]); } }
  r.setPipeline(pSnow); r.setVertexBuffer(0, ibSnowB); r.draw(4, nSnow);
  r.end();
  // light shafts
  r = e.beginRenderPass(passRays); r.setPipeline(pRays); r.setBindGroup(0, bgRays); r.draw(3); r.end();
  r = e.beginRenderPass(passBlur); r.setPipeline(pRB); r.setBindGroup(0, bgBlur); r.draw(3); r.end();
  // bloom
  for (let i = 0; i < bloomPass.length; i++) {
    r = e.beginRenderPass(bloomPass[i]); r.setPipeline(i === 0 ? pDown0 : i < NB ? pDown : pUp); r.setBindGroup(0, bloomBG[i]); r.draw(3); r.end();
  }
  // composite
  passPost.colorAttachments[0].view = (OFF ? tOff : ctx.getCurrentTexture()).createView();
  r = e.beginRenderPass(passPost); r.setPipeline(pPost); r.setBindGroup(0, bgPost); r.draw(3); r.end();
  if (slot) { e.resolveQuerySet(qs, 0, 2, qResolve, 0); e.copyBufferToBuffer(qResolve, 0, slot.b, 0, 16); }
  submitList[0] = e.finish();
  Q.submit(submitList);
  if (slot) { slot.busy = true; slot.b.mapAsync(GPUMapMode.READ).then(slot.done); }
}

// CS[j] = distance to the rock (metres, < 0 in water) at the camera + CE[3j..3j+2]: the camera, then ±0.375 m on
// each axis for the gradient
const CE = new Float64Array([0, 0, 0, .375, 0, 0, -.375, 0, 0, 0, .375, 0, 0, -.375, 0, 0, 0, .375, 0, 0, -.375]), CS = new Float64Array(7);
function sd(j) {
  const x = (F[CX] + CE[j * 3]) / VS, y = (F[CY] + CE[j * 3 + 1] - OY) / VS, z = (F[CZ] + CE[j * 3 + 2]) / VS;
  const ix = floor(x), iy = floor(y), iz = floor(z), u = x - ix, v = y - iy, a = cv(ix, iy, iz), b = cv(ix, iy + 1, iz), c = cv(ix, iy, iz + 1), d = cv(ix, iy + 1, iz + 1);
  const p = a + (cv(ix + 1, iy, iz) - a) * u, q = b + (cv(ix + 1, iy + 1, iz) - b) * u, r = c + (cv(ix + 1, iy, iz + 1) - c) * u, s = d + (cv(ix + 1, iy + 1, iz + 1) - d) * u;
  const e = p + (q - p) * v; CS[j] = (e + (r + (s - r) * v - e) * (z - iz)) / 127;
}
// Moves the camera by F[MX..MZ] in steps shorter than its radius CR (so it can't pass through thin rock), pushing it
// back out after each step and dropping velocity into the rock, so it slides along.
const CR = 0.5;
function collide() {
  const n = floor(sqrt(F[MX] * F[MX] + F[MY] * F[MY] + F[MZ] * F[MZ]) / 0.4) + 1;
  for (let i = 0; i < n; i++) {
    F[CX] += F[MX] / n; F[CY] += F[MY] / n; F[CZ] += F[MZ] / n;
    for (let k = 0; k < 2; k++) {
      sd(0); const s = CS[0] + CR; if (s <= 0) break;
      for (let j = 1; j < 7; j++) sd(j);
      let gx = CS[1] - CS[2], gy = CS[3] - CS[4], gz = CS[5] - CS[6]; const l = sqrt(gx * gx + gy * gy + gz * gz);
      if (l < 0.075) break; // flat: deep in rock
      gx /= l; gy /= l; gz /= l; const vn = F[VX] * gx + F[VY] * gy + F[VZ] * gz;
      F[CX] -= gx * s; F[CY] -= gy * s; F[CZ] -= gz * s;
      if (vn > 0) { F[VX] -= gx * vn; F[VY] -= gy * vn; F[VZ] -= gz * vn; }
    }
  }
}

function frame(now) {
  if (!OFF) requestAnimationFrame(frame); // offscreen: dev.js steps the frames
  const dtr = now - F[LAST]; F[LAST] = now;
  let dt = dtr / 1000; if (dt > 0.1) dt = 0.1;
  // Dynamic resolution for 60 fps: every second (0.4 s behind the menu, and until the first period at full pace) scale the load by k
  if (!RESQ && dtr < 1e3 && (dynT += dtr) > 0 && (dynN++, dynT > (menu || dynFast ? 400 : 1000))) {
    const a = dynT / dynN, g = dynGN ? dynG / dynGN : 0; let k = 1;
    // with GPU timing: keep it between 9.8 and 13.6 ms
    if (g) { if (g > 13.6 || g < 9.8) k = 11.7 / g; }
    // without: slow for two periods in a row means fewer pixels, and twice as long before trying to go back up
    // (at the start one slow period is enough, so a visit does not begin with seconds of stutter)
    else if (a > 17.6) { dynOk = 0; if (dynFast) k = 15 / a; else if (++dynBad > 1) { k = 15 / a; dynBad = 0; dynWait = min(dynWait * 2, 60); } }
    // at the display's rate there is no telling if there is room, so try a little more now and then
    else { dynFast = dynBad = 0; if (a < 12.5) k = 15 / a; else if (++dynOk > dynWait) { k = 1.17; dynOk = 0; } }
    k = k < 0.5 ? 0.5 : k > 1.7 ? 1.7 : k; const top = min(PIXMAX, DW * DH), was = pix;
    if (!RESQ) { pix = min(pix, top) * k; pix = pix < PIXMIN ? PIXMIN : pix > top ? top : pix; }
    if (was !== pix) keep('abyssal', [LV, pix < top ? pix | 0 : '']); // nothing kept at full resolution
    dynN = dynT = dynG = dynGN = 0; resize();
  }
  F[TIME] += dt;
  {
    // touch, one finger: holding the finger away from where it went down keeps turning, like a joystick
    if (tId >= 0 && !TJ) {
      const tr = 4 / (innerWidth < innerHeight ? innerWidth : innerHeight); let jx = (tx - tx0) * tr, jy = (ty - ty0) * tr;
      jx = jx > 1 ? 1 : jx < -1 ? -1 : jx; jy = jy > 1 ? 1 : jy < -1 ? -1 : jy;
      lkx += jx * 1.5 * dt; lky += jy * dt;
    }
    // mouse look through two cascaded low-pass stages
    const kq = 1 - exp(-dt * 30); lkx += mdx * 0.0022; lky += mdy * 0.0022; mdx = 0; mdy = 0;
    const ax = lkx * kq, ay = lky * kq; lkx -= ax; lky -= ay; l2x += ax; l2y += ay;
    const dyw = l2x * kq, dpt = l2y * kq; l2x -= dyw; l2y -= dpt;
    // what the fingers ask for: one finger swims ahead (a second one: faster); the stick swims any way, and faster pushed far out
    const jm = hypot(jmx, jmy), jk = jm > 1 ? 1 / jm : 1, tf = TJ ? -jmy * jk : tId >= 0 ? 0.7 : 0, tr = TJ ? jmx * jk : 0, tfast = TJ ? jm > 1.7 : tN > 1;
    if (me) me.gur = !menu && kg > 0;
    if (kz && me) meZoom = clamp(meZoom + kz * dt * 1.3, 0, 2); // a phone's camera button is held
    meAway = menu; meHeld = !menu && kbt > 0;
    netFrame(dt);
    if (me && menu) { /* the creature waits while the menu is up */ }
    else if (me) meStep(dt, dyw, dpt, tf || kf - kb, tr || kr - kl, ku - kd, ks || tfast); // playing a creature (bots.js)
    else {
    const yaw = F[YAW] + dyw; let pitch = F[PIT] - dpt; pitch = pitch < -1.55 ? -1.55 : pitch > 1.55 ? 1.55 : pitch;
    const sp = ks || tfast ? 26 : 7, k = 1 - exp(-dt * 4.5), mf = tf || kf - kb, mr = tr || kr - kl, mu = ku - kd, cp = cos(pitch), sy = sin(yaw), cw = cos(yaw);
    const vx = F[VX] + ((sy * cp * mf + cw * mr) * sp - F[VX]) * k, vy = F[VY] + ((sin(pitch) * mf + mu) * sp - F[VY]) * k, vz = F[VZ] + ((-cw * cp * mf + sy * mr) * sp - F[VZ]) * k;
    let x = F[CX] + vx * dt, y = F[CY] + vy * dt; const z = F[CZ] + vz * dt, ox = F[CX], oy = F[CY], oz = F[CZ];
    if (x > SHOREX) x = SHOREX; // the beach
    const yb = gridBase(x) + 5; y = y < yb ? yb : y > -1.2 ? -1.2 : y; // between the band's floor and the surface
    F[YAW] = yaw; F[PIT] = pitch; F[VX] = vx; F[VY] = vy; F[VZ] = vz; F[MX] = x - F[CX]; F[MY] = y - F[CY]; F[MZ] = z - F[CZ];
    collide();
    // pushed up through the surface by rising ground (the shallows, an islet): no way through, stay where it was
    if (F[CY] > -1.2) { F[CX] = ox; F[CZ] = oz; F[CY] = oy < -1.2 ? oy : -1.2; F[VX] = F[VY] = F[VZ] = 0; }
    }
  }
  // the world follows the camera: tiles ahead are started, finished ones come in
  moveWindow(F[CX], F[CZ]); pump(false);
  if (!menu || bots.length) botStep(dt); // the creatures live on behind the menu once they are there
  if (!menu && !OFF) { sonarDraw($('sn'), dt); if (me) { $('sb').style.width = round(meStamina * 100) + '%'; const h = clamp(meHP, 0, 1); $('hf').style.width = round(h * 100) + '%'; $('hf').style.background = h < 0.25 ? '#ff5e5b' : h < 0.5 ? '#ffc061' : '#7fe08a'; $('hb').className = meHurtT > -0.4 ? 'h' : ''; $('hm').textContent = meMsgT > 0 ? meMsg : ''; } const on = netOn ? 'Online · ' + (netNames.size + 1) + ' in the sea' : ''; if (on !== netShown) $('hn').textContent = netShown = on; }
  if (menu) pickDraw(now);
  {
    // the haze reaches as far as the setting says, but never past what is loaded: quick to close, slow to open
    let k = (reach(F[CX], F[CZ]) - 2) / 135; k = k > DET0 ? DET0 : k < 0.2 ? 0.2 : k;
    det = k < det ? max(k, det - dt * 0.8) : min(k, det + dt * 0.12);
  }
  render();
  if (hud) {
    hN++; if (dtr > hMax) hMax = dtr; if (dtr < hMin) hMin = dtr; if (dtr > hPer * 1.5) { hLate++; hTot++; }
    F[HUDT] += dtr / 1000;
    if (F[HUDT] > 0.5) { info.textContent = `${(hN / F[HUDT]).toFixed(0)} fps  ·  worst frame ${hMax.toFixed(1)} ms  ·  late frames ${hLate} (total ${hTot})  ·  GPU ${F[GPU].toFixed(2)} ms  ·  ${W}x${H} (${W * 100 / DW | 0}%)  ·  x ${F[CX].toFixed(0)} z ${F[CZ].toFixed(0)}  ·  tiles ${nLoaded}/${WIN * WIN}`; F[HUDT] = 0; hPer = hMin; hN = 0; hMax = 0; hMin = 1e9; hLate = 0; }
  }
}

// ---------------------------------------------------------------- input
let shiftAt = -1e9, netShown = '';
// the name other players see (the menu's field, kept between visits); without a server to reach the field is not shown
{ const nm = $('nm'); nm.value = netName; if (!netURL()) $('cr').className = 'o'; nm.oninput = () => { netName = nm.value.trim().slice(0, 16); keep('abyssalName', netName); if (netOn) netSend({ t: 'hi', name: netName }); }; }
const key = (e, v) => {
  switch (e.code) {
    case 'KeyW': kf = v; break; case 'KeyS': kb = v; break; case 'KeyA': kl = v; break; case 'KeyD': kr = v; break;
    case 'KeyE': ku = v; break; case 'KeyQ': kd = v; break;
    // Shift held: a dash; tapped twice quickly: a burst of speed
    case 'ShiftLeft': case 'ShiftRight': if (v && !e.repeat) { if (e.timeStamp - shiftAt < 350) meBurst(); shiftAt = e.timeStamp; } ks = v; break;
    default: if (v && !e.repeat) {
      if (e.code === 'KeyH') { hud = !hud; hTot = 0; hPer = 1e9; info.textContent = ''; }
      else if (e.code === 'KeyM') mute();
      else if (e.code === 'KeyZ') sonarZoom();
      else if (e.code === 'Escape') ui(true);
      else if (e.code >= 'Digit1' && e.code <= 'Digit6') { lookAt(...POSES[e.code.charCodeAt(5) - 49]); meWarp(); }
      else if (/^Digit[7890]$/.test(e.code)) { lookAt(...DEEPS[(e.code.charCodeAt(5) - 45) % 10]); meWarp(); }
    }
  }
};
// behind the menu only the stats and mute keys work
addEventListener('keydown', (e) => { if (e.target && e.target.tagName === 'INPUT') return; if (menu && e.code !== 'KeyH' && e.code !== 'KeyM') return; sound(); key(e, 1); });
addEventListener('keyup', (e) => key(e, 0));
const release = () => { kf = kb = kl = kr = ku = kd = ks = kg = kbt = 0; tId = jId = sId = -1; tN = jmx = jmy = kz = 0; $('tj').style.display = ''; };
// the right mouse button: the creature in play gurgles for as long as it is held; the left: it bites, strikes, feeds (bots.js)
let kg = 0, kbt = 0, kz = 0;
addEventListener('mousedown', (e) => { if (e.button === 0 && !menu && document.pointerLockElement === canvas) kbt = 1; });
addEventListener('mouseup', (e) => { if (e.button === 0) kbt = 0; });
addEventListener('mousedown', (e) => { if (e.button === 2 && !menu) { sound(); kg = 1; } });
addEventListener('mouseup', (e) => { if (e.button === 2) kg = 0; });
addEventListener('contextmenu', (e) => { if (!menu) e.preventDefault(); });
const capture = () => { sound(); const p = canvas.requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch(() => canvas.requestPointerLock()).catch(() => 0); };
canvas.addEventListener('click', capture);
addEventListener('mousemove', (e) => { if (document.pointerLockElement === canvas) { mdx += e.movementX; mdy += e.movementY; } });
addEventListener('blur', release);
// Touch, two ways (TJ, the Controls row of a phone's menu, localStorage.abyssalTouch):
//   one finger (0): hold to swim forward, slide to steer, a second finger to go faster;
//   joystick (1): a finger on the left half is a stick to swim by (jmx, jmy: how far it is pushed, 1 = the ring),
//   one on the right half turns the view.
// Only the fingers on the scene count: the round action buttons take their own.
// A short tap on the sonar's disc is its next range (sId: the finger that went down there, sAt, sx, sy: when and
// where); held longer or slid, it is a finger like any other.
let TJ = 0, jId = -1, jx0 = 0, jy0 = 0, jmx = 0, jmy = 0, sId = -1, sAt = 0, sx = 0, sy = 0;
try { TJ = +localStorage.abyssalTouch === 1 ? 1 : 0; } catch {}
const touch = (e) => {
  e.preventDefault(); sound(); const T = e.targetTouches, r = rot.matches, tj = $('tj'); tN = T.length;
  // the touch axes turn with the page when it lies on its side
  const X = (t) => (r ? t.clientY : t.clientX), Y = (t) => (r ? innerWidth - t.clientX : t.clientY);
  // iOS can hand out negative identifiers, but a negative tId means "no finger": compare them as unsigned
  const c = e.changedTouches[0];
  if (e.type === 'touchstart') { const b = $('so').getBoundingClientRect(); if (c.clientX > b.left && c.clientX < b.right && c.clientY > b.top && c.clientY < b.bottom) { sId = c.identifier >>> 0; sAt = e.timeStamp; sx = c.clientX; sy = c.clientY; } }
  else if (e.type === 'touchend' && c.identifier >>> 0 === sId) { sId = -1; if (e.timeStamp - sAt < 300 && hypot(c.clientX - sx, c.clientY - sy) < 12) sonarZoom(); }
  let f = null, j = null, first = false;
  for (let i = 0; i < tN; i++) { const id = T[i].identifier >>> 0; if (id === tId) f = T[i]; else if (id === jId) j = T[i]; }
  if (!f) tId = -1; if (!j) jId = -1;
  const half = (r ? innerHeight : innerWidth) / 2, side = min(innerWidth, innerHeight);
  if (TJ) {
    const R = side * 0.14;
    for (let i = 0; i < tN; i++) {
      const t = T[i], id = t.identifier >>> 0; if (id === tId || id === jId) continue;
      if (X(t) < half) { if (jId < 0) { jId = id; j = t; jx0 = X(t); jy0 = Y(t); tj.style.left = jx0 + 'px'; tj.style.top = jy0 + 'px'; } }
      else if (tId < 0) { tId = id; f = t; first = true; }
    }
    if (j) { jmx = (X(j) - jx0) / R; jmy = (Y(j) - jy0) / R; const k = R / max(1, hypot(jmx, jmy)); tj.firstChild.style.transform = 'translate(' + jmx * k + 'px,' + jmy * k + 'px)'; } else jmx = jmy = 0;
    tj.style.display = j ? 'block' : '';
  } else if (!f && tN) { f = T[0]; tId = f.identifier >>> 0; first = true; }
  if (f) {
    const x = X(f), y = Y(f), s = 1100 / side;
    if (first) { tx0 = x; ty0 = y; } else { mdx += (x - tx) * s; mdy += (y - ty) * s; } // the view follows the finger at once
    tx = x; ty = y;
  }
};
// the round buttons: the mouth (the left mouse button), the gurgle (the right one, held), a burst (Shift twice)
[['t1', (v) => { kbt = v; }], ['t2', (v) => { kg = v; }], ['t3', (v) => { if (v) meBurst(); }]].forEach(([id, fn]) => {
  const b = $(id), h = (v) => (e) => { e.preventDefault(); sound(); b.className = v ? 'on' : ''; fn(v); };
  b.addEventListener('touchstart', h(1), { passive: false }); b.addEventListener('touchend', h(0)); b.addEventListener('touchcancel', h(0));
});
for (const n of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) canvas.addEventListener(n, touch, { passive: false });

// ---------------------------------------------------------------- menu
// The scene keeps rendering (blurred by CSS) behind the menu. Esc, losing the mouse or the corner button open it.
let menu = true;
// the focus ring shows from the first Tab until the next click or touch (template.html)
addEventListener('keydown', (e) => e.code === 'Tab' && document.documentElement.classList.add('k'), true);
addEventListener('pointerdown', () => document.documentElement.classList.remove('k'), true);
const bDive = $('d');
$('dh').hidden = !mob; // a phone has no key 1: the way home is a button beside the dive button
const ui = (m) => {
  if (dead) return;
  menu = m; body.className = m ? 'm' : document.pointerLockElement ? 'g p' : 'g';
  // focus the dive button so Enter works (delayed: it can't take focus while still hidden)
  if (m) { release(); setTimeout(() => menu && bDive.focus(), 100); fitMenu(); } else document.activeElement.blur();
};
let first = true;
setInterval(() => first || keepAt(), 3000); addEventListener('pagehide', () => first || keepAt());
const go = () => {
  meSync();
  // the first dive starts as key 1 does: the creature at the first viewpoint, heading the way it looks
  if (first && !back) { lookAt(...POSES[0]); meWarp(); } first = false;
  if (back && me && me.s === back[5]) { me.x = back[6]; me.y = back[7]; me.z = back[8]; me.yaw = me.ty = back[9]; me.pit = back[10]; meHP = back[11]; } back = null;
  hudWho(); pickClose(); netConnect();
  sound(); ui(false); bDive.textContent = 'Resume';
  // phones: go fullscreen and ask for landscape; where that is refused the CSS rotation still applies
  if (mob) document.documentElement.requestFullscreen?.()?.then(() => screen.orientation.lock('landscape')).catch(() => 0);
  if (!mob) capture();
};
bDive.onclick = go; $('o').onclick = () => ui(true);
// The graphics and the world panels: each opens in place of the list of controls. Their rows are one list of choices:
// detail level, water, the settings of GFX, then those of WORLD (creatures, time of day, colours).
// Choices are only marked until the panels are left: the question asked then keeps them and reloads (they are compiled into the shaders and the
// world's buffers). Picking a detail level marks the settings that level comes with.
{
  const yr = [...$('y').querySelectorAll('p')], wr = [...document.querySelectorAll('#yw p:not(.h)')];
  const was = [2 - LV, WQ, ...GFX, ...WORLD], pick = was.slice(), rows = [yr[0], wr[0], ...yr.slice(1), ...wr.slice(1)];
  const mark = () => { rows.forEach((r, k) => r.querySelectorAll('button').forEach((b, i) => { b.className = i === pick[k] ? 'on' : ''; })); };
  rows.forEach((r, k) => r.querySelectorAll('button').forEach((b, i) => { b.onclick = () => { pick[k] = i; if (!k) pick.splice(2, GFX.length, ...gdef(2 - i)); mark(); }; }));
  // the three settings buttons share a row; each opens its panel in place of the list of controls and closes it again
  const panel = (id) => {
    const open = $(id).hidden;
    PANELS.forEach(([p, b, name]) => { const on = open && p === id; $(p).hidden = !on; $(b).innerHTML = on ? BACK + 'Menu' : name; });
    $('k').style.display = $('f').style.display = $('cr').style.display = open ? 'none' : ''; fitMenu();
  };
  // Leaving the graphics and world panels with choices that were not applied (to the main menu, to the sound panel,
  // or diving) asks first: apply and reload, drop them, or stay. Going from one of the two to the other does not.
  let after = null;
  const leave = (then) => { if (($('y').hidden && $('yw').hidden) || pick.join() === was.join()) then(); else { after = then; $('u').hidden = false; $('ua').focus(); } };
  const sw = (id) => () => ($(id).hidden ? panel(id) : leave(() => panel(id)));
  $('ud').onclick = () => { $('u').hidden = true; pick.splice(0, pick.length, ...was); mark(); after(); };
  $('uk').onclick = () => { $('u').hidden = true; };
  $('ua').onclick = () => {
    if (pick[0] !== was[0] || pick[3] !== was[3]) keep('abyssal', 2 - pick[0]); // another level or resolution: the tuned resolution is forgotten
    keep('abyssalWater', pick[1]); keep('abyssalGfx', pick.slice(2, 2 + GFX.length).join()); keep('abyssalWorld', pick.slice(2 + GFX.length).join());
    keepAt();
    location.reload();
  };
  $('x').onclick = sw('y'); $('xw').onclick = sw('yw'); $('xs').onclick = () => leave(() => panel('ys')); bDive.onclick = () => leave(go);
  $('dh').onclick = () => leave(() => { back = null; lookAt(...POSES[0]); meWarp(); go(); }); // (back: the place kept from the last visit is dropped)
  // the sound panel: a choice is heard at once (audio.js)
  const srows = [...$('ys').querySelectorAll('p')], smark = () => srows.forEach((r, k) => r.querySelectorAll('button').forEach((b, i) => { b.className = i === SND[k] ? 'on' : ''; }));
  srows.forEach((r, k) => r.querySelectorAll('button').forEach((b, i) => { b.onclick = () => { SND[k] = i; sound(); sndApply(); smark(); }; }));
  smark();
  // the World panel's last row, HUD: the sonar and the lines at the bottom left, shown or hidden at once, with no
  // reload (HUD in quality.js)
  const hb = [...document.querySelectorAll('#yw p.h button')];
  const hmark = () => { hb.forEach((b, i) => { b.className = i === HUD ? 'on' : ''; }); $('so').style.visibility = $('hu').style.visibility = HUD ? '' : 'hidden'; };
  hb.forEach((b, i) => { b.onclick = () => { HUD = i; keep('abyssalHud', i); hmark(); }; });
  hmark();
  mark();
}
// a phone's Controls row: taken at once, and the hint under it says how that way works
{
  const bs = [...$('tc').querySelectorAll('button')], mk = () => { bs.forEach((b, i) => { b.className = i === TJ ? 'on' : ''; }); $('h').textContent = TJ ? 'Left thumb swims · right thumb looks · push the stick far to go faster' : 'Hold to swim forward · slide to steer · second finger to go faster'; };
  bs.forEach((b, i) => { b.onclick = () => { TJ = i; keep('abyssalTouch', i); release(); mk(); fitMenu(); }; }); mk();
}
// a phone's two buttons beside the menu button: the camera further from the creature in play, and nearer to it (the mouse wheel)
// Held, they keep moving it (kz, see frame()), also while other fingers swim and steer; let go, the distance is kept.
[['tm', 1], ['tp', -1]].forEach(([id, d]) => {
  const b = $(id), h = (v) => (e) => { e.preventDefault(); kz = v; meZoomBy(v * 0.08); };
  b.addEventListener('touchstart', h(d), { passive: false }); b.addEventListener('touchend', h(0)); b.addEventListener('touchcancel', h(0));
});
pickInit();
// the line at the bottom left: who the player is (the score will stand here too)
function hudWho() { $('hw').innerHTML = me ? 'Playing as <b>' + CRITNAME[me.s] + '</b>' : 'Free camera'; $('st').style.display = $('hb').style.display = me ? '' : 'none'; $('tb').className = $('tz').className = me ? 'c' : ''; if (me) { $('t1').textContent = me.s === CRAB ? 'Strike' : 'Bite'; $('t2').textContent = me.s === CRAB ? 'Block' : 'Gurgle'; } if (!me) $('hm').textContent = ''; }
// the mouse wheel: the camera nearer to the creature in play, or further from it
addEventListener('wheel', (e) => { if (!menu && me) meZoomBy(e.deltaY > 0 ? 0.12 : -0.12); }, { passive: true });
document.addEventListener('pointerlockchange', () => ui(!document.pointerLockElement));

// draw the first frame and wait for the GPU to finish it (pipelines get compiled on first use) before the reveal
await say('Letting the light in…', 1, 400);
render(); await Q.onSubmittedWorkDone();
setTimeout(keep, 15e3, 'abyssalLoad', ''); // the load counts as survived after 15 s of frames
ui(true);
if (!OFF) requestAnimationFrame((t) => { F[LAST] = t; requestAnimationFrame(frame); });
