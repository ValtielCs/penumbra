// Assemble browser-encoded WebP frames into one looping animated WebP (no re-encoding).
// Usage: node tools/make-webp-anim.mjs docs/_frames docs/penumbra-hero.webp [frameMs=110]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [, , dir = 'docs/_frames', out = 'docs/penumbra-hero.webp', ms = '110'] = process.argv;
const files = readdirSync(dir).filter(f => /^frame-\d{3}\.webp$/.test(f)).sort();
if (!files.length) throw new Error(`no frames in ${dir}`);

const u24 = v => Buffer.from([v & 255, (v >> 8) & 255, (v >> 16) & 255]);
const u32 = v => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
const chunk = (id, data) => Buffer.concat([Buffer.from(id), u32(data.length), data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);

function parse(buf) {                       // -> { width, height, chunks: [{id, data}] }
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') throw new Error('not a WebP');
  const chunks = []; let p = 12, width = 0, height = 0;
  while (p + 8 <= buf.length) {
    const id = buf.toString('ascii', p, p + 4), len = buf.readUInt32LE(p + 4), data = buf.subarray(p + 8, p + 8 + len);
    chunks.push({ id, data });
    if (id === 'VP8X') { width = 1 + data.readUIntLE(4, 3); height = 1 + data.readUIntLE(7, 3); }
    if (id === 'VP8 ' && !width) { width = data.readUInt16LE(6) & 0x3fff; height = data.readUInt16LE(8) & 0x3fff; }
    if (id === 'VP8L' && !width) { const b = data.readUInt32LE(1); width = (b & 0x3fff) + 1; height = ((b >> 14) & 0x3fff) + 1; }
    p += 8 + len + (len % 2);
  }
  return { width, height, chunks };
}

const frames = files.map(f => parse(readFileSync(join(dir, f))));
const { width, height } = frames[0];
let alpha = false;
const anmf = frames.map(fr => {
  const img = fr.chunks.filter(c => ['ALPH', 'VP8 ', 'VP8L'].includes(c.id));
  if (img.some(c => c.id === 'ALPH' || c.id === 'VP8L')) alpha = true;
  const header = Buffer.concat([u24(0), u24(0), u24(fr.width - 1), u24(fr.height - 1), u24(+ms), Buffer.from([0x02])]); // no blending
  return chunk('ANMF', Buffer.concat([header, ...img.map(c => chunk(c.id, c.data))]));
});
const vp8x = chunk('VP8X', Buffer.concat([Buffer.from([0x02 | (alpha ? 0x10 : 0), 0, 0, 0]), u24(width - 1), u24(height - 1)]));
const anim = chunk('ANIM', Buffer.concat([Buffer.from([5, 7, 13, 255]), Buffer.from([0, 0])]));   // background, loop forever
const body = Buffer.concat([Buffer.from('WEBP'), vp8x, anim, ...anmf]);
writeFileSync(out, Buffer.concat([Buffer.from('RIFF'), u32(body.length), body]));
console.log(`${files.length} frames, ${width}x${height}, ${(body.length / 1e6).toFixed(2)} MB -> ${out}`);
