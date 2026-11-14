// Здания: перевод материалов в metal/rough, удаление вспышек/служебного, сжатие геометрии и текстур (WebP, до 1024 px — чётко, но без лишнего веса)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, weld, prune, meshopt, textureCompress, metalRough } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'fs';
const [,, inp, out, size = '1024'] = process.argv;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(inp), root = doc.getRoot();
for (const n of root.listNodes()) if (/collider|flare/i.test(n.getName())) n.dispose();
await MeshoptEncoder.ready;
await doc.transform(metalRough(), dedup(), weld(), prune(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [+size, +size], quality: 86 }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await io.write(out, doc);
console.log(out, fs.statSync(inp).size, '->', fs.statSync(out).size);
