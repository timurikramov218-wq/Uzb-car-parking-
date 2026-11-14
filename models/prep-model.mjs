// Универсальная подготовка модели: удаление лишнего (по имени узла/материала), перекраска серых материалов,
// упрощение только тяжёлых мешей, удаление граней снизу, WebP-текстуры, meshopt.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, weld, prune, meshopt, textureCompress, metalRough, simplifyPrimitive } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'fs';
const [,, inp, out, cfgJson = '{}'] = process.argv;
const cfg = JSON.parse(cfgJson);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(inp), root = doc.getRoot();
const dropN = cfg.dropNode && new RegExp(cfg.dropNode, 'i'), dropM = cfg.dropMat && new RegExp(cfg.dropMat, 'i');
for (const n of root.listNodes()) {
  if (/collider|flare/i.test(n.getName()) || (dropN && dropN.test(n.getName()))) { n.dispose(); continue; }
  const m = n.getMesh(); if (m && dropM) for (const p of m.listPrimitives()) if (dropM.test(p.getMaterial()?.getName() || '')) p.dispose();
}
await doc.transform(metalRough(), weld());
for (const mat of root.listMaterials()) {
  const c = cfg.color?.[mat.getName()];
  if (c) { mat.setBaseColorFactor([...c.slice(0, 3), 1]); mat.setRoughnessFactor(c[3] ?? 0.7); mat.setMetallicFactor(c[4] ?? 0); }
}
await MeshoptSimplifier.ready; await MeshoptEncoder.ready;
const maxTri = cfg.maxTri || 1e9, ratio = cfg.ratio || 0.5;
for (const m of root.listMeshes()) for (const p of m.listPrimitives()) {
  const t = (p.getIndices()?.getCount() || 0) / 3;
  if (t > maxTri) simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio: Math.max(ratio, maxTri / t * 0.5), error: cfg.err || 0.01, lockBorder: true });
}
await doc.transform(dedup(), prune(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [cfg.tex || 1024, cfg.tex || 1024], quality: 86 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await io.write(out, doc);
let tri = 0; for (const m of root.listMeshes()) for (const p of m.listPrimitives()) tri += (p.getIndices()?.getCount() || 0) / 3;
console.log(out, (fs.statSync(inp).size / 1024 | 0) + 'KB ->', (fs.statSync(out).size / 1024 | 0) + 'KB', 'tris', tri);
