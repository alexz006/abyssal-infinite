#!/usr/bin/env python3
"""A resident crab for the sea: a scripted player that stands at one place, spars with crabs and answers their gurgle.

It speaks the game's protocol as any browser does (see ../README.md), so the server needs no changes.
Only the standard library is used.

    python3 krabs.py wss://sea.example.com/ws [--connect 127.0.0.1] [--name "Mr. Krabs"] [--at 8,-43.3,18]

--connect: the address to open the socket to (the host of the URL stays in the TLS and HTTP handshake);
           with it the certificate is not checked - it is meant for the server's own loopback.
--at:      x,y,z of the crab; y is the sea floor there.
"""
import argparse, base64, json, math, os, random, select, socket, ssl, struct, sys, time
from urllib.parse import urlparse

# the rules of a fight, as in source/src/bots.js
REACH, DOWN, CLAWT, SHOVE, CLAWP = 0.53, 8.0, 45.0, 1.5, 0.1
HEAR = 6.0   # how far away a crab's gurgle is answered
WALK, NEAR, ROAM = 1.1, 0.4, 3.0   # its walk, m/s; how close it comes to a rival; how far from home it goes
DT = 0.125   # one state packet every DT seconds


def log(s):
    print(s, flush=True)


class WS:
    """a minimal WebSocket client: text and binary messages, ping/pong, close"""

    def __init__(self, url, connect=None):
        u = urlparse(url)
        tls = u.scheme == 'wss'
        port = u.port or (443 if tls else 80)
        s = socket.create_connection((connect or u.hostname, port), timeout=15)
        if tls:
            ctx = ssl.create_default_context()
            if connect:
                ctx.check_hostname = False
                ctx.verify_mode = ssl.CERT_NONE
            s = ctx.wrap_socket(s, server_hostname=u.hostname)
        key = base64.b64encode(os.urandom(16)).decode()
        host = u.hostname + ('' if port in (80, 443) else ':%d' % port)
        s.sendall(('GET %s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: %s\r\n'
                   'Sec-WebSocket-Version: 13\r\nOrigin: %s://%s\r\n\r\n' % (u.path or '/', host, key, 'https' if tls else 'http', host)).encode())
        buf = b''
        while b'\r\n\r\n' not in buf:
            d = s.recv(4096)
            if not d:
                raise ConnectionError('closed during the handshake')
            buf += d
        head, self.buf = buf.split(b'\r\n\r\n', 1)
        if b' 101 ' not in head.split(b'\r\n', 1)[0]:
            raise ConnectionError('no upgrade: ' + head.split(b'\r\n', 1)[0].decode('latin1'))
        s.setblocking(False)
        self.s, self.part = s, None

    def send(self, data, op=None):
        if isinstance(data, str):
            data, op = data.encode(), op or 1
        op = op or 2
        n, mask = len(data), os.urandom(4)
        head = bytes([0x80 | op]) + (bytes([0x80 | n]) if n < 126 else bytes([0x80 | 126]) + struct.pack('>H', n) if n < 65536 else bytes([0x80 | 127]) + struct.pack('>Q', n))
        frame = head + mask + bytes(b ^ mask[i & 3] for i, b in enumerate(data))
        self.s.setblocking(True)
        try:
            self.s.sendall(frame)
        finally:
            self.s.setblocking(False)

    def poll(self, timeout):
        """the messages that have arrived, waiting up to `timeout` seconds for the first: [(is_text, bytes)]"""
        out = []
        if not self.buf or not self._frames(out):
            r, _, _ = select.select([self.s], [], [], max(timeout, 0))
            if r:
                while True:
                    try:
                        d = self.s.recv(65536)
                    except (ssl.SSLWantReadError, BlockingIOError):
                        break
                    if not d:
                        raise ConnectionError('closed by the server')
                    self.buf += d
                    if len(d) < 65536 and not (hasattr(self.s, 'pending') and self.s.pending()):
                        break
                self._frames(out)
        return out

    def _frames(self, out):
        b = self.buf
        while len(b) >= 2:
            op, n, o = b[0] & 15, b[1] & 127, 2
            if n == 126:
                if len(b) < 4: break
                n, o = struct.unpack('>H', b[2:4])[0], 4
            elif n == 127:
                if len(b) < 10: break
                n, o = struct.unpack('>Q', b[2:10])[0], 10
            if len(b) < o + n: break
            data, fin, b = b[o:o + n], b[0] & 0x80, b[o + n:]
            if op == 8:
                raise ConnectionError('closed by the server')
            if op == 9:
                self.buf = b
                self.send(data, 10)
            elif op in (0, 1, 2):
                if op: self.part = [op == 1, b'']
                if self.part:
                    self.part[1] += data
                    if fin:
                        out.append(tuple(self.part)); self.part = None
        self.buf = b
        return len(out)

    def close(self):
        try: self.s.close()
        except OSError: pass


class Crab:
    def __init__(self, name, home):
        self.name, self.home = name, home
        self.hp, self.lost, self.down, self.claw_t = 1.0, 0, 0.0, 0.0
        self.angry = self.snap = self.block_t = 0.0
        self.strike_t = 1.0
        self.x, self.z, self.kx, self.kz, self.yaw = home[0], home[2], 0.0, 0.0, 0.0
        self.wins, self.eat_at, self.last_hit = 0, 0.0, 0.0
        # answering a gurgle: waits rw, then holds its claws up for rt, then keeps quiet for rc
        self.rw = self.rt = self.rc = 0.0
        self.id, self.names, self.near, self.full = 0, {}, {}, False

    def who(self, i):
        return self.names.get(i) or '#%d' % i

    def respawn(self):
        self.hp, self.lost, self.claw_t, self.down, self.angry = 0.3, random.choice((1, 2)), 0.0, 0.0, 0.0
        self.kx = self.kz = 0.0
        self.x, self.z = self.home[0], self.home[2]
        log('a new crab (hp 0.3, one claw)')

    def state(self):
        up = (self.block_t > 0 or self.rt > 0) and self.lost != 3 and self.down <= 0
        flags = (1 if up else 0) | (2 if self.snap > 0 else 0) | self.lost << 2 | (16 if self.down > 0 else 0)
        return struct.pack('<BBBB6f', 1, 0, flags, 0, self.x, self.home[1], self.z, self.yaw, 0.0, math.hypot(self.kx, self.kz))

    def on_binary(self, d):
        if len(d) < 4 or d[0] != 2: return
        n, m = struct.unpack_from('<H', d, 2)[0], {}
        for i in range(n):
            o = 4 + i * 30
            if o + 30 > len(d): break
            pid, s, fl = struct.unpack_from('<HBB', d, o)
            x, y, z = struct.unpack_from('<3f', d, o + 6)
            m[pid] = (s, fl, x, y, z)
        self.near = m

    def on_json(self, m, ws):
        t = m.get('t')
        if t == 'hi':
            self.id, self.full = m['id'], False
            log('in the sea as #%d, max %s' % (self.id, m.get('max')))
        elif t == 'who':
            for i, n in m['list']: self.names[i] = n
            log('online: ' + (', '.join(self.names.values()) or 'nobody else'))
        elif t == 'in':
            self.names[m['id']] = m['name']; log('%s came in' % m['name'])
        elif t == 'out':
            log('%s left' % self.who(m['id'])); self.names.pop(m['id'], None)
        elif t == 'bit':
            if self.down > 0:
                log('bitten while on its back by %s: dies' % self.who(m['from'])); self.respawn(); return
            self.hp -= m['dmg']; self.angry, self.last_hit = 10.0, time.time()
            self.rw = self.rt = 0.0
            a = self.near.get(m['from'])
            if a:
                dx, dz = self.x - a[2], self.z - a[4]
                l = math.hypot(dx, dz) or 1
                self.kx, self.kz = dx / l * SHOVE, dz / l * SHOVE
            note = ''
            if m.get('s') == 0 and not m.get('blk') and self.lost != 3 and random.random() < CLAWP:
                self.lost |= 2 if self.lost & 1 else 1 if self.lost & 2 else random.choice((1, 2))
                note = ', lost a claw'
            log('struck by %s: %s%s -> hp %.3f%s' % (self.who(m['from']), m['dmg'], ' (blocked)' if m.get('blk') else '', self.hp, note))
            if self.hp <= 0:
                self.down, self.hp = DOWN, 0.02; log('beaten: on its back')
        elif t == 'eaten':
            log('eaten by %s' % self.who(m['from'])); self.respawn()
        elif t == 'fed':
            log('ate %s' % self.who(m['id']))
        elif t == 'full':
            self.full = True

    def step(self, ws):
        now, H = time.time(), self.home
        # the nearest crab of another player
        t, td, tid = None, 1e9, 0
        for i, p in self.near.items():
            if p[0] == 0:
                d = math.hypot(p[2] - self.x, p[3] - H[1], p[4] - self.z)
                if d < td: t, td, tid = p, d, i
        # the shove of a strike, and the way back home
        self.x += self.kx * DT; self.z += self.kz * DT
        k = math.exp(-DT * 8); self.kx *= k; self.kz *= k
        if self.down <= 0:
            # in a fight it walks up to its rival (not further than ROAM from home), otherwise back home
            gx, gz = H[0], H[2]
            if t and (self.angry > 0 or self.eat_at) and math.hypot(t[2] - H[0], t[4] - H[2]) < ROAM and td > 0.05:
                gx, gz = t[2] + (self.x - t[2]) / td * NEAR, t[4] + (self.z - t[4]) / td * NEAR
            dx, dz = gx - self.x, gz - self.z
            l = math.hypot(dx, dz)
            if l > 0.01:
                m = min(l, WALK * DT) / l
                self.x += dx * m; self.z += dz * m
        self.snap -= DT; self.angry -= DT; self.block_t -= DT; self.strike_t -= DT
        if t and td < 12 and self.down <= 0: self.yaw = math.atan2(t[4] - self.z, t[2] - self.x)
        if self.down > 0:
            self.down -= DT
            if self.down <= 0:
                self.hp, self.lost, self.claw_t = 0.25, 3, 0.0; log('back on its feet, no claws')
        elif t and td < REACH:
            if t[1] & 16:
                # the other one lies beaten: every second win it is eaten (after three seconds), otherwise left to get up
                if not self.eat_at:
                    self.wins += 1; self.eat_at = now + 3
                    log('%s is on its back: %s' % (self.who(tid), 'lets it get up' if self.wins % 2 else 'will eat it'))
                elif self.wins % 2 == 0 and now > self.eat_at and self.strike_t <= 0:
                    self.strike_t = 0.6; ws.send(json.dumps({'t': 'bite', 'to': tid}))
            else:
                self.eat_at = 0.0
                if self.angry > 0 and self.lost != 3:
                    # a round: about three seconds of strikes, then a second and a half with the claws up
                    if self.block_t <= -3: self.block_t = 1.5
                    elif self.block_t <= 0 and self.strike_t <= 0:
                        self.strike_t, self.snap = 0.9 + random.random() * 0.6, 0.28
                        ws.send(json.dumps({'t': 'bite', 'to': tid}))
        else:
            self.eat_at = 0.0
        # a crab that gurgles nearby (its claws are up) is answered in kind, unless there is a fight on
        if self.rw > 0:
            self.rw -= DT
            if self.rw <= 0: self.rt = random.uniform(1.2, 2.8)
        elif self.rt > 0:
            self.rt -= DT
            if self.rt <= 0: self.rc = random.uniform(0.8, 2.5)
        else:
            self.rc -= DT
            if self.rc <= 0 and self.angry <= 0 and self.down <= 0 and self.lost != 3 and t and td < HEAR and t[1] & 1 and not t[1] & 16:
                self.rw = random.uniform(0.4, 1.3); log('answers the gurgle of %s' % self.who(tid))
        # a lost claw grows back; left alone for a minute, it is healed
        if self.lost and self.down <= 0:
            self.claw_t += DT
            if self.claw_t >= CLAWT:
                self.claw_t, self.lost = 0.0, (random.choice((1, 2)) if self.lost == 3 else 0)
        else:
            self.claw_t = 0.0
        if self.down <= 0 and self.last_hit and now - self.last_hit > 60 and self.hp < 1:
            self.hp, self.last_hit = 1.0, 0.0; log('rested: hp 1')


def run(args):
    crab = Crab(args.name, [float(v) for v in args.at.split(',')])
    wait = 3
    while True:
        ws = None
        try:
            ws = WS(args.url, args.connect)
            crab.id, crab.names, crab.near = 0, {}, {}
            ws.send(json.dumps({'t': 'hi', 'name': crab.name}))
            log('connected')
            nxt, hello = time.monotonic(), time.monotonic()
            while True:
                for text, data in ws.poll(nxt - time.monotonic()):
                    if text: crab.on_json(json.loads(data), ws)
                    else: crab.on_binary(data)
                now = time.monotonic()
                if now >= nxt:
                    nxt = max(nxt + DT, now - 1)
                    if crab.id:
                        wait = 3; crab.step(ws); ws.send(crab.state())
                    elif now - hello > 30:
                        # the sea is full (or silent): ask again
                        hello = now; ws.send(json.dumps({'t': 'hi', 'name': crab.name}))
        except KeyboardInterrupt:
            return
        except Exception as e:  # the connection is lost, the server reloads: again after a pause
            log('disconnected (%s), again in %d s' % (e, wait))
        finally:
            if ws: ws.close()
        time.sleep(wait); wait = min(wait * 2, 60)


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description='A resident crab for the sea')
    ap.add_argument('url'); ap.add_argument('--connect'); ap.add_argument('--name', default='Mr. Krabs'); ap.add_argument('--at', default='8,-43.3,18')
    run(ap.parse_args())
