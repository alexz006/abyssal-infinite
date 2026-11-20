// ============================================================================
// quality level, chosen before anything is built
// ============================================================================
// LV: 0 High, 1 Medium, 2 Low. Medium and Low keep every 2nd / 4th leaf, glint and pebble and bake fewer shadows;
// Low also uses coarser meshes and cheaper filtering, and sets every graphics setting to its least (see gdef).
// localStorage.abyssal = "level,pixels,detail". abyssalLoad is set while the world is built: still set on the next
// visit means that load crashed the tab, so this one runs a level lower.
const mob = matchMedia('(pointer:coarse)').matches, mem = navigator.deviceMemory;
const keep = (k, v) => { try { localStorage[k] = v; } catch {} };
let SV = [], LV, bad;
try { SV = (localStorage.abyssal || '').split(','); bad = localStorage.abyssalLoad; } catch {}
LV = SV[0] ? +SV[0] : mob || mem <= 4 ? 2 : 0; // a first visit: Low on every phone (its memory says nothing of its graphics chip)
if (bad && LV < 2) { SV = [++LV]; keep('abyssal', LV); }
// water: 0 lagoon (the original's green-blue haze), 1 clear, 2 crystal (blue and far-seeing, like an aquarium; the default);
// localStorage.abyssalWater. sig: scattering, kd: absorption on the way down, col: the water's colour, amb: skylight
let WQ = 2; try { const v = localStorage.abyssalWater; if (v != null && v !== '') WQ = Math.min(2, Math.max(0, +v | 0)); } catch {}
const WATERQ = [
  { sig: '.058, .0235, .0195', kd: '.056, .0245, .0170', col: '.16, .58, .90', amb: '.22, .60, .80', zs: 1 },
  { sig: '.041, .0168, .0135', kd: '.056, .0215, .0150', col: '.12, .52, .98', amb: '.18, .55, .90', zs: 0.72 },
  { sig: '.019, .0079, .0062', kd: '.056, .0180, .0125', col: '.08, .44, 1.08', amb: '.14, .48, 1.0', zs: 0.36 },
][WQ];
// graphics settings: each one follows the detail level until it is set by hand in the menu's graphics panel.
// localStorage.abyssalGfx = "distance,resolution,plants,shadows,smoothing,rays,animal shadows", an option's number or empty.
//   distance   0 near (80 m), 1 medium (105 m), 2 far (135 m): where the water's haze closes over everything
//   resolution 0 auto (tuned for 60 fps), 1 50%, 2 75%, 3 100% of the window's pixels
//   plants     0 sparse (every 4th leaf, glint and pebble), 1 medium (every 2nd), 2 dense
//   shadows    0 low (1024), 1 medium (2048), 2 high (4096, and rocks cast them too)
//   smoothing  0 off, 1 4x anti-aliasing
//   rays       0 off, 1 low (12 steps), 2 high (34 steps)
//   animal shadows  0 off, 1 few (the 8 creatures that matter most to the view), 2 all (24)
let GS = []; try { GS = (localStorage.abyssalGfx || '').split(','); } catch {}
if (bad) { GS = []; keep('abyssalGfx', ''); } // the last load crashed: back to the level's own settings
const gset = (i, n, d) => (GS[i] !== undefined && GS[i] !== '' && +GS[i] >= 0 && +GS[i] < n ? +GS[i] : d);
const gdef = (lv) => (lv > 1 ? [0, 0, 0, 0, 0, 0, 0] : [2, 0, 2 - lv, 2 - lv, 1, 2, 2 - lv]); // what a detail level picks: Low is the least of everything
const GFX = gdef(LV).map((d, i) => gset(i, [3, 4, 3, 3, 2, 3, 3][i], d));
const VIEWD = [80, 105, 135][GFX[0]], RESQ = [0, 0.5, 0.75, 1][GFX[1]];
const THIN = 4 >> GFX[2], SHADOW = 1024 << GFX[3], AA = GFX[4] ? 4 : 1, WATER = LV > 1 ? 256 : 512, RAYN = [2, 12, 34][GFX[5]], CSN = [0, 8, 24][GFX[6]];
// Sound settings (the menu's sound panel): localStorage.abyssalSnd = "volume,water,music,sea life,gurgling", each
// 0 off, 1 low, 2 medium, 3 high. Water: rumble, surface wash, rush. Music: the drone and the chimes. Sea life: the
// stock bubbles and the distant whale calls. Gurgling: the players' creatures. They take effect at once.
const SNDLV = [0, 0.45, 1, 1.8], SND = [1, 1, 2, 2, 3]; let SNDG = null; // until set: a low volume, quiet water, loud gurgling
try { (localStorage.abyssalSnd || '').split(',').forEach((v, i) => { if (i < 5 && v !== '' && +v >= 0 && +v <= 3) SND[i] = +v; }); } catch {}
