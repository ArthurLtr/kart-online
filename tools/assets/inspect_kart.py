"""Diagnóstico do kart: lista as ilhas conectadas da malha e renderiza vistas.

Uso: blender -b --python tools/assets/inspect_kart.py -- <kart.obj> <color.png> <pasta_saida>
Coordenadas no relatório estão no sistema do OBJ/glTF (Y para cima).
"""
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

obj_path, color_path, out_dir = sys.argv[sys.argv.index("--") + 1:][:3]
out = Path(out_dir)
out.mkdir(parents=True, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.obj_import(filepath=obj_path)
kart = bpy.context.selected_objects[0]
bpy.context.view_layer.objects.active = kart

# Material só com a cor, para as vistas.
mat = bpy.data.materials.new("preview")
mat.use_nodes = True
bsdf = mat.node_tree.nodes["Principled BSDF"]
tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
tex.image = bpy.data.images.load(color_path)
mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
kart.data.materials.clear()
kart.data.materials.append(mat)

bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.separate(type="LOOSE")
bpy.ops.object.mode_set(mode="OBJECT")

parts = []
for index, part in enumerate(sorted(bpy.context.scene.objects, key=lambda o: -len(o.data.vertices))):
    world = [part.matrix_world @ v.co for v in part.data.vertices]
    lo = Vector((min(v.x for v in world), min(v.y for v in world), min(v.z for v in world)))
    hi = Vector((max(v.x for v in world), max(v.y for v in world), max(v.z for v in world)))
    part.name = f"ilha_{index:03d}"
    # Blender (x, y, z) -> glTF/OBJ (x, z, -y)
    parts.append({
        "name": part.name,
        "verts": len(part.data.vertices),
        "min": [round(lo.x, 3), round(lo.z, 3), round(-hi.y, 3)],
        "max": [round(hi.x, 3), round(hi.z, 3), round(-lo.y, 3)],
    })
(out / "ilhas.json").write_text(json.dumps(parts, indent=1))
print(f"ILHAS: {len(parts)}")

# Vistas ortográficas e 3/4 com o Workbench (rápido, sem GPU pesada).
scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "TEXTURE"
scene.render.resolution_x = 900
scene.render.resolution_y = 700
scene.render.film_transparent = False

cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
target = Vector((0.0, 0.05, 0.35))

views = {
    "tres_quartos_a": (2.6, -2.6, 1.6),
    "tres_quartos_b": (-2.6, 2.6, 1.6),
    "lado": (4.0, 0.05, 0.4),
    "topo": (0.0, 0.05, 4.5),
    "ponta_y_neg": (0.0, -4.0, 0.5),
    "ponta_y_pos": (0.0, 4.0, 0.5),
}
for name, position in views.items():
    cam.location = Vector(position)
    direction = target - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    if name == "topo":
        cam.rotation_euler = (0.0, 0.0, 0.0)
    scene.render.filepath = str(out / f"{name}.png")
    bpy.ops.render.render(write_still=True)
print("OK")
