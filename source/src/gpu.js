// ============================================================================
// renderer: device, samplers, textures, pipelines
// ============================================================================
const $ = (id) => document.getElementById(id);
const canvas = $('c'), info = $('i'), body = document.body;
// The menu is sized in em: its font is shrunk until all of it is on the screen - from the first moment, while the
// world is still being built behind the loading bar. Measured by where the title and the buttons end up: the menu is
// centred, so what does not fit sticks out at the top as much as at the bottom, and at the bottom it must also stay
// clear of the two links when they are shown.
function fitMenu() {
  const m = $('m'), h1 = m.firstElementChild, a = $('a'), ft = $('f'); let f = 1; m.style.fontSize = '';
  const fits = () => { const pad = m.clientHeight * 0.015, low = ft.style.display === 'none' ? m.clientHeight : ft.offsetTop; return h1.offsetTop >= pad && a.offsetTop + a.offsetHeight <= low - pad && h1.offsetWidth <= m.clientWidth && a.scrollWidth <= m.clientWidth; };
  while (!fits() && f > 0.2) { f -= 0.03; m.style.fontSize = f + 'em'; }
}
fitMenu(); addEventListener('resize', fitMenu);
// a phone held upright gets the page turned on its side (see template.html)
const rot = matchMedia('(orientation:portrait) and (pointer:coarse)');
// loading bar: each stage glides it to `to` (the share done) over ~`ms` on the compositor, so it moves while this
// thread is busy
let loaded = 0, dead; // dead: the graphics device was lost
const say = (m, to, ms) => {
  if (!dead) $('s').textContent = m;
  const a = $('b').animate({ transform: [`scaleX(${loaded})`, `scaleX(${to})`] }, { duration: ms, fill: 'forwards', easing: 'cubic-bezier(.3,.5,.5,1)' });
  loaded = to;
  // go on once the animation runs: one not started before the thread gets busy stays stuck (timer: hidden tabs)
  return new Promise((r) => { a.ready.then(() => setTimeout(r)); setTimeout(r, document.hidden ? 0 : 1e3); });
};
const fail = (m) => { throw new Error(m, { cause: 1 }); }; // cause marks a message that is shown as it is
if (!navigator.gpu) fail('This scene needs WebGPU. Try a current Chrome or Edge.');
const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
if (!adapter) fail('No WebGPU adapter found.');
$('w').hidden = !!navigator.userAgentData; // only Chromium-based browsers have it
const hasTS = adapter.features.has('timestamp-query');
const device = await adapter.requestDevice({ requiredFeatures: hasTS ? ['timestamp-query'] : [] });
device.addEventListener('uncapturederror', (e) => console.error('GPU: ' + e.error.message));
// out of memory or a GPU timeout: reload a level lower, or on Low say what happened
device.lost.then((l) => {
  if (l.reason === 'destroyed') return; // the page is closing
  if (LV < 2) { keep('abyssal', LV + 1); location.reload(); }
  dead = body.className = 'l e'; $('s').textContent = 'The graphics device was lost. Reload the page to try again.';
});
const ctx = canvas.getContext('webgpu'), FMT = navigator.gpu.getPreferredCanvasFormat();
// #offscreen: draw into a texture instead of the canvas (for automated tests where a canvas can't be presented; dev.js reads it back)
const OFF = location.hash.includes('offscreen'); let tOff = null;
const Q = device.queue, HDR = 'rgba16float', DEPTH = 'depth32float';
const TU = GPUTextureUsage, BU = GPUBufferUsage, SS = GPUShaderStage;

const mod = (code) => device.createShaderModule({ code });
const buf = (data, usage) => { const b = device.createBuffer({ size: (data.byteLength + 3) & ~3, usage: usage | BU.COPY_DST }); Q.writeBuffer(b, 0, data.buffer || data, data.byteOffset || 0, data.byteLength); return b; };
const tex = (w, h, format, usage, o = {}) => device.createTexture({ size: [w, h, o.d || 1], format, usage, mipLevelCount: o.mips || 1, sampleCount: o.samples || 1, dimension: o.d ? '3d' : '2d' });

// ---------------------------------------------------------------- static resources
const sRep = device.createSampler({ addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: LV > 1 ? 1 : 8 });
const sClamp = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
// the world textures and the shadow map wrap around (see stream.js)
const sWrap = device.createSampler({ addressModeU: 'repeat', addressModeV: 'repeat', addressModeW: 'repeat', magFilter: 'linear', minFilter: 'linear' });
const sCmp = device.createSampler({ compare: 'less-equal', addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear' });
const tShadow = tex(SHADOW, SHADOW, DEPTH, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING);
const tDummy = tex(1, 1, DEPTH, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING);
const tWater = tex(WATER, WATER, HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING, { mips: 5 });
const tDetail = tex(1024, 1024, 'rgba8unorm', TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING, { mips: 11 });
const VOLN = WIN * TILE / 2; // the loaded window at half resolution
const tVol = tex(VOLN, NY / 2, 'rg8unorm', TU.TEXTURE_BINDING | TU.COPY_DST, { d: VOLN });
const tMap = tex(512, 512, 'rgba8unorm', TU.TEXTURE_BINDING | TU.COPY_DST);

// (after the 60 floats of the scene: two vec4 for each creature that casts a shadow, see critSh in shaders.js)
const UB = new Float32Array(60 + CSN * 8), UBS = new Float32Array(60 + CSN * 8);
const ubo = device.createBuffer({ size: UB.byteLength, usage: BU.UNIFORM | BU.COPY_DST }), uboS = device.createBuffer({ size: UB.byteLength, usage: BU.UNIFORM | BU.COPY_DST });
const WT = new Float32Array(4), uboW = device.createBuffer({ size: 16, usage: BU.UNIFORM | BU.COPY_DST });

const VF = SS.VERTEX | SS.FRAGMENT;
const bgl0 = device.createBindGroupLayout({ entries: [
  { binding: 0, visibility: VF, buffer: {} },
  { binding: 1, visibility: VF, sampler: {} }, { binding: 2, visibility: VF, sampler: {} }, { binding: 3, visibility: VF, sampler: { type: 'comparison' } },
  { binding: 4, visibility: VF, texture: { sampleType: 'depth' } },
  { binding: 5, visibility: VF, texture: {} }, { binding: 6, visibility: VF, texture: {} },
  { binding: 7, visibility: VF, texture: { viewDimension: '3d' } }, { binding: 8, visibility: VF, texture: {} }] });
const mkBG0 = (u, sh) => device.createBindGroup({ layout: bgl0, entries: [
  { binding: 0, resource: { buffer: u } }, { binding: 1, resource: sRep }, { binding: 2, resource: sWrap }, { binding: 3, resource: sCmp },
  { binding: 4, resource: sh.createView() }, { binding: 5, resource: tWater.createView() }, { binding: 6, resource: tDetail.createView() },
  { binding: 7, resource: tVol.createView() }, { binding: 8, resource: tMap.createView() }] });
const bg0 = mkBG0(ubo, tShadow), bg0s = mkBG0(uboS, tDummy);
const pl0 = device.createPipelineLayout({ bindGroupLayouts: [bgl0] });

const bglBlit = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: SS.FRAGMENT, texture: {} }, { binding: 1, visibility: SS.FRAGMENT, sampler: {} }] });
const plBlit = device.createPipelineLayout({ bindGroupLayouts: [bglBlit] });
const mBlit = mod(W_BLIT);
const blitPipe = (entry, format, add) => device.createRenderPipeline({ layout: plBlit, vertex: { module: mBlit, entryPoint: 'vs' },
  fragment: { module: mBlit, entryPoint: entry, targets: [{ format, blend: add ? { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } } : undefined }] } });
const pMip8 = blitPipe('fsMip', 'rgba8unorm'), pMip16 = blitPipe('fsMip', HDR), pDown0 = blitPipe('fsDown0', HDR), pDown = blitPipe('fsDown', HDR), pUp = blitPipe('fsUp', HDR, true);
const blitBG = (view) => device.createBindGroup({ layout: bglBlit, entries: [{ binding: 0, resource: view }, { binding: 1, resource: sClamp }] });
const colorAtt = (view, clear) => ({ view, loadOp: clear ? 'clear' : 'load', storeOp: 'store', clearValue: [0, 0, 0, 0] });

// vertex layouts
const A = (shaderLocation, offset, format) => ({ shaderLocation, offset, format });
const vbSolid = { arrayStride: 16, attributes: [A(0, 0, 'float32x3'), A(1, 12, 'snorm8x4')] };
const ibSolid = { arrayStride: 48, stepMode: 'instance', attributes: [A(2, 0, 'float32x4'), A(3, 16, 'float32x4'), A(4, 32, 'float32x4')] };
const ibLeaf = { arrayStride: 36, stepMode: 'instance', attributes: [A(0, 0, 'float32x4'), A(1, 16, 'float32x4'), A(2, 32, 'unorm8x4')] };
const ibAnim = { arrayStride: 32, stepMode: 'instance', attributes: [A(2, 0, 'float32x4'), A(3, 16, 'float32x4')] };
const ibBub = { arrayStride: 32, stepMode: 'instance', attributes: [A(0, 0, 'float32x4'), A(1, 16, 'float32x4')] };
const ibSnow = { arrayStride: 16, stepMode: 'instance', attributes: [A(0, 0, 'float32x4')] };

const scenePipe = (m, vsE, fsE, buffers, o = {}) => device.createRenderPipeline({ layout: pl0,
  vertex: { module: m, entryPoint: vsE, buffers, constants: o.constants },
  fragment: { module: m, entryPoint: fsE, targets: [{ format: HDR, blend: o.blend }] },
  primitive: { topology: o.strip ? 'triangle-strip' : 'triangle-list', cullMode: o.cull || 'none' },
  depthStencil: { format: DEPTH, depthWriteEnabled: !o.blend, depthCompare: 'greater' }, multisample: { count: AA } });
const shadowPipe = (m, vsE, buffers, o = {}) => device.createRenderPipeline({ layout: pl0,
  vertex: { module: m, entryPoint: vsE, buffers, constants: o.constants },
  primitive: { topology: o.strip ? 'triangle-strip' : 'triangle-list', cullMode: o.cull || 'none' },
  depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 1.5 } });

await say('Compiling shaders…', 0.05, 300);
const mSolid = mod(W_SOLID), mLeaf = mod(W_LEAF), mAnim = mod(W_ANIM), mSurf = mod(W_SURF), mSpr = mod(W_SPR);
const pTerrain = scenePipe(mSolid, 'vs', 'fs', [vbSolid, ibSolid], { cull: 'back' });
const pSolid = scenePipe(mSolid, 'vs', 'fs', [vbSolid, ibSolid]);
const pLeaf = scenePipe(mLeaf, 'vs', 'fs', [ibLeaf], { strip: true, constants: { ROWS: 9 } });
const pLeaf5 = scenePipe(mLeaf, 'vs', 'fs', [ibLeaf], { strip: true, constants: { ROWS: 5 } });
const pLeafS = scenePipe(mLeaf, 'vs', 'fs', [ibLeaf], { strip: true, constants: { ROWS: 3, FAR: 70, LODW: 0 } });
const pLeafF = scenePipe(mLeaf, 'vs', 'fs', [ibLeaf], { strip: true, constants: { ROWS: 3 } });
const pFish = scenePipe(mAnim, 'vsFish', 'fsFish', [vbSolid, ibAnim]);
const pManta = scenePipe(mAnim, 'vsManta', 'fsManta', [vbSolid, ibAnim]);
const pCrit = scenePipe(mod(W_CRIT), 'vs', 'fs', [vbSolid, ibAnim]);
const pSurf = scenePipe(mSurf, 'vs', 'fs', [], { strip: true }), pBack = scenePipe(mSurf, 'vsB', 'fsB', [], { strip: true });
const pBub = scenePipe(mSpr, 'vsBub', 'fsBub', [ibBub], { strip: true, blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } } });
const ADD = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } };
const pSnow = scenePipe(mSpr, 'vsSnow', 'fsSnow', [ibSnow], { strip: true, blend: ADD });
const pGl = scenePipe(mLeaf, 'vsGl', 'fsGl', [ibBub], { strip: true, blend: ADD, constants: { ROWS: 7 } });
const pSolidSh = shadowPipe(mSolid, 'vs', [vbSolid, ibSolid]), pTerrSh = shadowPipe(mSolid, 'vs', [vbSolid, ibSolid], { cull: 'front' });
const pLeafSh = shadowPipe(mLeaf, 'vs', [ibLeaf], { strip: true, constants: { ROWS: 3 } });

const mWater = mod(W_WATER);
const pWater = device.createRenderPipeline({ layout: 'auto', vertex: { module: mWater, entryPoint: 'vs' }, fragment: { module: mWater, entryPoint: 'fs', targets: [{ format: HDR }] } });
const bgWater = device.createBindGroup({ layout: pWater.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uboW } }] });
const waterViews = [0, 1, 2, 3, 4].map((m) => tWater.createView({ baseMipLevel: m, mipLevelCount: 1 }));
const waterBG = waterViews.map((v) => blitBG(v));
const waterPass = waterViews.map((v) => ({ colorAttachments: [colorAtt(v, true)] }));

const mRays = mod(W_RAYS), mPost = mod(W_POST), mRB = mod(W_RBLUR);
const pRB = device.createRenderPipeline({ layout: 'auto', vertex: { module: mRB, entryPoint: 'vs' }, fragment: { module: mRB, entryPoint: 'fs', targets: [{ format: HDR }] } });
const pRays = device.createRenderPipeline({ layout: 'auto', vertex: { module: mRays, entryPoint: 'vs' }, fragment: { module: mRays, entryPoint: 'fs', targets: [{ format: HDR }] } });
const pPost = device.createRenderPipeline({ layout: 'auto', vertex: { module: mPost, entryPoint: 'vs' }, fragment: { module: mPost, entryPoint: 'fs', targets: [{ format: FMT }] } });


// ---------------------------------------------------------------- sun
const SUN = (() => { const v = [0.27, 1, -0.24], l = hypot(...v); return v.map((c) => c / l); })();
for (let i = 0; i < 3; i++) { UB[48 + i] = UBS[48 + i] = SUN[i]; }
UBS[32] = 0; UBS[33] = -20; UBS[34] = 0; UBS[35] = 0; UBS[58] = 1;
// one instance that leaves a mesh where it is: the terrain is drawn with the solids' pipeline
const ibIdent = buf(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0]), BU.VERTEX);
