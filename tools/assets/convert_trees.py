"""Extrai de referencias/arvores as árvores leves (copa em cartões + tronco).

O arquivo traz 6 árvores; quatro têm de 0,4 a 3 milhões de triângulos e ficam
de fora. As duas restantes já são modelos de jogo.

Uso: blender -b --python convert_trees.py -- <arvores.glb> <saida.glb> <relatorio.json>
Saída: tree_a_bark, tree_a_leaves, tree_b_bark, tree_b_leaves, cada árvore com
a base do tronco na origem.
"""
import json
import sys

import bpy
from mathutils import Matrix, Vector

src, glb_path, report_path = sys.argv[sys.argv.index("--") + 1 :][:3]
TREES = {"tree_a": ("Bark_9.001", "Leaf_6.001"), "tree_b": ("Bark_9.002", "Leaf_6.002")}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

keep = {name for pair in TREES.values() for name in pair}
for obj in list(bpy.data.objects):
    if obj.name not in keep:
        bpy.data.objects.remove(obj, do_unlink=True)

report = {}
for tree, (bark_name, leaf_name) in TREES.items():
    bark = bpy.data.objects[bark_name]
    leaves = bpy.data.objects[leaf_name]
    for obj in (bark, leaves):
        world = obj.matrix_world.copy()
        obj.parent = None
        obj.data.transform(world)
        obj.matrix_world = Matrix.Identity(4)
    points = [v.co for v in bark.data.vertices]
    low = min(p.z for p in points)
    top = max(p.z for p in points)
    base = [p for p in points if p.z < low + 0.04 * (top - low)]
    origin = Vector((sum(p.x for p in base) / len(base), sum(p.y for p in base) / len(base), low))
    for obj in (bark, leaves):
        obj.data.transform(Matrix.Translation(-origin))
        obj.data.update()
        obj.data.calc_loop_triangles()
    bark.name = f"{tree}_bark"
    leaves.name = f"{tree}_leaves"
    crown_top = max(v.co.z for v in leaves.data.vertices)
    report[tree] = {
        "bark": len(bark.data.loop_triangles),
        "leaves": len(leaves.data.loop_triangles),
        "height": round(max(top - low, crown_top), 2),
    }

bpy.ops.export_scene.gltf(
    filepath=glb_path,
    export_format="GLB",
    export_yup=True,
    export_apply=True,
    export_normals=True,
    export_texcoords=True,
    export_materials="EXPORT",
    export_animations=False,
    export_cameras=False,
    export_lights=False,
)
with open(report_path, "w", encoding="utf-8") as handle:
    json.dump(report, handle, indent=2)
print("CONVERT_OK")
