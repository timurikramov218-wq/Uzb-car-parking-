// Подготовка моделей города: убираем невидимые грани снизу, коллайдеры, дубли; сжимаем.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, instance, weld, simplify, simplifyPrimitive, prune, meshopt, textureCompress, flatten, join, resample } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import fs from 'fs';
const [,, inp, out, mode] = process.argv;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(inp), root = doc.getRoot();
// коллайдеры и служебное
for (const n of root.listNodes()) if (/collider/i.test(n.getName())) n.dispose();
// невидимые грани: смотрят вниз и лежат у самой земли
let dropped = 0;
for (const n of root.listNodes()) {
  const m = n.getMesh(); if (!m) continue;
  const W = n.getWorldMatrix();
  for (const p of m.listPrimitives()) {
    const pos = p.getAttribute('POSITION'), idx = p.getIndices(); if (!pos || !idx) continue;
    const v = i => { const a = pos.getElement(i, []); return [W[0] * a[0] + W[4] * a[1] + W[8] * a[2] + W[12], W[1] * a[0] + W[5] * a[1] + W[9] * a[2] + W[13], W[2] * a[0] + W[6] * a[1] + W[10] * a[2] + W[14]]; };
    const ia = idx.getArray(), keep = [];
    for (let t = 0; t < ia.length; t += 3) {
      const A = v(ia[t]), B = v(ia[t + 1]), C = v(ia[t + 2]);
      const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], wx = C[0] - A[0], wy = C[1] - A[1], wz = C[2] - A[2];
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, l = Math.hypot(nx, ny, nz) || 1;
      if (ny / l < -0.9 && Math.max(A[1], B[1], C[1]) < 0.12) { dropped++; continue; }
      keep.push(ia[t], ia[t + 1], ia[t + 2]);
    }
    idx.setArray(new (ia.constructor)(keep));
  }
}
if (mode === 'gas') {
  const img = fs.readFileSync('gas_tex_shell.png');
  for (const t of root.listTextures()) t.setImage(img).setMimeType('image/png');
}
if (process.env.FLAT) for (const m of root.listMeshes()) for (const p of m.listPrimitives()) { const n = p.getAttribute('NORMAL'); if (n) { p.setAttribute('NORMAL', null); } }
await MeshoptSimplifier.ready; await MeshoptEncoder.ready;
await doc.transform(weld());
if (mode === 'park') for (const m of root.listMeshes()) {          // упрощаем всё, кроме заборов и стен
  if (/prova|muro|recinz|fence|cancell/i.test(m.getName())) continue;
  for (const p of m.listPrimitives()) simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio: +(process.env.RATIO || 0.55), error: +(process.env.ERR || 0.0015) });
}
await doc.transform(
  dedup(), instance({ min: 2 }), weld(),
  prune(),
  ...(mode === 'park' ? [textureCompress({ encoder: (await import('sharp').catch(() => ({}))).default, targetFormat: 'webp', resize: [512, 512] })] : []),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
await io.write(out, doc);
console.log(mode, 'dropped down-faces', dropped, 'size', fs.statSync(out).size);
