// Multiplayer: the client's side of the shared sea (the server is in ../../server, its protocol in server/src/sea.js).
// Only players are shared - every browser keeps its own bots. Another player is one more entry in `bots` (net: true)
// that is moved by what the server relays instead of by a bot's mind, so it is drawn, shown on the sonar, heard
// gurgling, counted against the population and can be bitten like anything else there.
// The server is where the page came from (wss://<host>/ws), or what ?server=... or localStorage.abyssalServer names;
// a page opened from a file has none and plays alone.
let netFull = false, netWS = null, netOn = false, netId = 0, netTries = 0, netNext = 0, netSendT = 0, netEver = false;
const netPeers = new Map(), netNames = new Map();
let netName = ''; try { netName = localStorage.abyssalName || ''; } catch {}
function netURL() {
  let u = null; try { u = new URLSearchParams(location.search).get('server') || localStorage.abyssalServer; } catch {}
  if (u) return /^wss?:\/\//.test(u) ? u : (/^https?:\/\//.test(u) ? u.replace(/^http/, 'ws') : 'wss://' + u).replace(/\/+$/, '') + '/ws';
  return /^https?:$/.test(location.protocol) ? location.protocol.replace('http', 'ws') + '//' + location.host + '/ws' : null;
}
const netSend = (m) => { if (netOn) try { netWS.send(typeof m === 'string' || m instanceof ArrayBuffer ? m : JSON.stringify(m)); } catch {} };
const netWho = (id) => netNames.get(id) || 'a diver';
function netDrop(id) { const b = netPeers.get(id); if (b) { b.gone = true; netPeers.delete(id); } }
function netConnect() {
  const url = netURL(); if (netWS || !url) return;
  let ws; try { ws = new WebSocket(url); } catch { return; }
  netWS = ws; ws.binaryType = 'arraybuffer';
  ws.onopen = () => { netOn = netEver = true; netTries = 0; netSend({ t: 'hi', name: netName }); };
  ws.onclose = ws.onerror = () => {
    if (netWS !== ws) return;
    netWS = null; netOn = false; netId = 0; for (const id of [...netPeers.keys()]) netDrop(id); netNames.clear();
    // again later, each time after longer; a host that never answered (a page not served by the game's server) is left alone
    netTries++; netNext = netEver || netTries < 3 ? performance.now() + min(30000, 2000 * 2 ** netTries) : Infinity;
  };
  ws.onmessage = (e) => { try { if (typeof e.data === 'string') netHear(JSON.parse(e.data)); else netPacket(e.data); } catch (err) { console.error(err); } };
}
// the small messages: who is in, who bit whom
function netHear(m) {
  if (m.t === 'hi') { netId = m.id; if (netFull) meSay('A place has come free · in the shared sea'); netFull = false; }
  else if (m.t === 'who') for (const [id, name] of m.list) netNames.set(id, name);
  else if (m.t === 'in') { netNames.set(m.id, m.name); const b = netPeers.get(m.id); if (b) b.name = m.name; }
  else if (m.t === 'out') { netNames.delete(m.id); netDrop(m.id); }
  // (the connection is closed and tried again every few seconds: said once, and again when a place has come free)
  else if (m.t === 'full') { if (!netFull) meSay('The sea is full · playing alone'); netFull = true; }
  else if (m.t === 'bit' && me && !meAway) {
    // bitten by another player (the server has checked that it could): as a hunter's bite; a crab's strike may cost a claw
    fx('bite', m.s); meHurt(m.dmg, m.s);
    const crab = m.s === CRAB && me.s === CRAB; meCause = (crab ? 'Beaten by ' : 'Eaten by ') + netWho(m.from); meSay((crab ? 'Struck by ' : 'Bitten by ') + netWho(m.from));
    if (crab && Math.random() < 0.2 && meLost !== 3) { meLost |= meLost & 1 ? 2 : meLost & 2 ? 1 : Math.random() < 0.5 ? 1 : 2; meSay('Lost a claw to ' + netWho(m.from)); }
    if (meHP <= 0) netSend({ t: 'ate' });
  } else if (m.t === 'fed') { meFeed(m.gain); meSay('Ate ' + netWho(m.id)); fx('eat'); }
}
// the players near, ten times a second: [2, 0, count] then for each [id, species, flags, talk, 0, x, y, z, yaw, pitch, speed]
function netPacket(buf) {
  const v = new DataView(buf); if (v.getUint8(0) !== 2) return;
  const n = v.getUint16(2, true), now = performance.now();
  for (let i = 0; i < n; i++) {
    const o = 4 + i * 30, id = v.getUint16(o, true), s = v.getUint8(o + 2), fl = v.getUint8(o + 3), x = v.getFloat32(o + 6, true), y = v.getFloat32(o + 10, true), z = v.getFloat32(o + 14, true), yaw = v.getFloat32(o + 18, true);
    if (s >= CRIT.length || id === netId) continue;
    let b = netPeers.get(id);
    if (!b || b.s !== s) { netDrop(id); if (netPeers.size >= PEERMAX) continue; b = botAdd(s, [x, y, z], yaw); b.net = true; b.id = id; b.name = netNames.get(id) || ''; b.pf = fl; netPeers.set(id, b); }
    b.nx = x; b.ny = y; b.nz = z; b.nyaw = yaw; b.npit = v.getFloat32(o + 22, true); b.v = v.getFloat32(o + 26, true); b.stamp = now;
    // flags: 1 gurgling, 2 its mouth or claws have just snapped, 4 and 8 the claws a crab has lost
    b.gur = (fl & 1) > 0; if (fl & 2 && !(b.pf & 2)) b.snap = 0.28; b.lost = fl >> 2 & 3; b.pf = fl;
  }
}
// a remote player between two packets: eased to where it was last said to be
function netMove(b, dt) {
  const c = CRIT[b.s], k = min(1, dt * 12);
  b.x += (b.nx - b.x) * k; b.y += (b.ny - b.y) * k; b.z += (b.nz - b.z) * k; b.yaw += wrapA(b.nyaw - b.yaw) * k; b.pit += (b.npit - b.pit) * k;
  b.ph += dt * c.freq * clamp(abs(b.v) / c.spd, 0.15, 2.5); b.turn = 0; b.mode = 0;
}
// every frame: the own state out eight times a second (who only watches says where its camera is, to be told who is
// near), the silent dropped, a lost connection tried again
function netFrame(dt) {
  const now = performance.now();
  if (!netWS) { if (netEver || netTries) { if (now > netNext) netConnect(); } return; }
  if (!netOn) return;
  for (const [id, b] of netPeers) if (now - b.stamp > 1500) netDrop(id);
  if ((netSendT += dt) < 0.125) return;
  netSendT = 0;
  const buf = new ArrayBuffer(28), v = new DataView(buf), b = me, away = !b || meAway;
  v.setUint8(0, 1); v.setUint8(1, away ? 255 : b.s); v.setUint8(2, away ? 0 : (b.gur ? 1 : 0) | (b.snap > 0 ? 2 : 0) | meLost << 2); v.setUint8(3, 0);
  [b ? b.x : F[CX], b ? b.y : F[CY], b ? b.z : F[CZ], b ? b.yaw : 0, b && b.s !== CRAB ? b.pit : 0, b ? b.v : 0].forEach((f, i) => v.setFloat32(4 + i * 4, f, true));
  netSend(buf);
}
