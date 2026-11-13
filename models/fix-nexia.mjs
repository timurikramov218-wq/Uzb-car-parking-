import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { metalRough, prune } from '@gltf-transform/functions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(process.argv[2]);
await doc.transform(metalRough());
const root = doc.getRoot();
const drop = [/^Spoller1/, /^Spoller2/, /^spoller_steklo/, /^txi_shahka/, /^steklo_DN_ton1/, /^steklo_DN_ton2/, /^steklo_DN_water/, /^flag/];
let removed = [];
for (const n of root.listNodes()) if (drop.some(r => r.test(n.getName()))) { removed.push(n.getName()); n.dispose(); }
for (const n of root.listNodes()) { const me = n.getMesh(); if (me && me.listPrimitives().some(p => /kolpakDN[23]/.test(p.getMaterial()?.getName() || ''))) { removed.push(n.getName()); n.dispose(); } }
const glass = doc.createMaterial('glass').setBaseColorFactor([0.04, 0.06, 0.08, 0.55]).setAlphaMode('BLEND').setMetallicFactor(0.3).setRoughnessFactor(0.05).setDoubleSided(true);
for (const n of root.listNodes()) if (/^steklo_DN_Default/.test(n.getName())) for (const p of n.getMesh().listPrimitives()) p.setMaterial(glass);
for (const m of root.listMaterials()) if (m.getName() === 'Default_Material') m.setName('paint');
await doc.transform(prune());
await io.write(process.argv[3], doc);
console.log('removed', removed);
