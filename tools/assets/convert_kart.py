"""Converte o kart da pasta referencias/ em GLB organizado, sem alterar a forma.

Uso: blender -b --python tools/assets/convert_kart.py -- <kart.obj> <saida.glb> <relatorio.json> <comprimento_m>

O que faz:
  - separa a malha única em ilhas conectadas e as agrupa em partes nomeadas
    (nomes de @kart/shared KART_PARTS);
  - escala uniforme para o comprimento pedido, em metros;
  - pivô do kart no chão, no centro do eixo traseiro; frente para +Z (glTF);
  - pivô de cada roda no centro do próprio eixo (gira em torno do X local);
  - grava em `extras` o raio de cada roda e o eixo de giro do volante.

Convenção: o Blender usa Z para cima; o glTF, Y para cima.
Blender (x, y, z) equivale a glTF (x, z, -y). A frente do kart é -Y no Blender.
"""
import json
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

obj_path, glb_path, report_path, length_arg = sys.argv[sys.argv.index("--") + 1:][:4]
TARGET_LENGTH = float(length_arg)


def coords(obj):
    data = np.empty(len(obj.data.vertices) * 3, dtype=np.float64)
    obj.data.vertices.foreach_get("co", data)
    return data.reshape(-1, 3)


def bounds(obj):
    c = coords(obj)
    return c.min(axis=0), c.max(axis=0)


def to_gltf(v):
    return [round(float(v[0]), 4), round(float(v[2]), 4), round(float(-v[1]), 4)]


def join(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    joined.name = name
    joined.data.name = name
    return joined


def set_origin(obj, origin):
    """Move o pivô para `origin` sem mover a malha no mundo."""
    obj.data.transform(Matrix.Translation(-Vector(origin)))
    obj.location = Vector(origin)


# --- importação -----------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.obj_import(filepath=obj_path)
source = bpy.context.selected_objects[0]
bpy.context.view_layer.objects.active = source
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

material = bpy.data.materials.new("kart_paint")
source.data.materials.clear()
source.data.materials.append(material)

bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.separate(type="LOOSE")
bpy.ops.object.mode_set(mode="OBJECT")
islands = [o for o in bpy.context.scene.objects if o.type == "MESH"]

# --- classificação das ilhas (medidas na unidade original do modelo) -------
all_lo = np.min([bounds(o)[0] for o in islands], axis=0)
all_hi = np.max([bounds(o)[1] for o in islands], axis=0)
length = all_hi[1] - all_lo[1]
front_y, rear_y = all_lo[1], all_hi[1]  # frente é -Y no Blender

groups = {"tire": [], "hub": [], "steering": [], "exhaust": [], "fairing": [], "body": []}
for island in islands:
    lo, hi = bounds(island)
    size, center = hi - lo, (lo + hi) / 2
    count = len(island.data.vertices)
    outboard = abs(center[0]) > 0.25 * (all_hi[0] - all_lo[0])
    if outboard and size[0] < 0.25 and abs(size[1] - size[2]) < 0.02 and size[2] > 0.3:
        groups["tire"].append(island)  # anel largo, redondo no plano Y-Z
    elif outboard and abs(size[1] - size[2]) < 0.02 and size[2] < 0.15:
        groups["hub"].append(island)  # cubo/ponta de eixo, concêntrico à roda
    elif hi[1] > rear_y - 0.02 * length and lo[2] > 0.3:
        groups["exhaust"].append(island)  # sai pela traseira, no alto
    elif abs(center[0]) < 0.05 and lo[2] > 0.4 and size[1] < 0.06 and size[2] < 0.2:
        groups["steering"].append(island)  # aro e raios do volante, quase num plano
    elif lo[1] < front_y + 0.02 * length and hi[1] < -0.2 and size[0] > 0.5:
        groups["fairing"].append(island)  # bico e carenagem frontal
    else:
        groups["body"].append(island)

expected = {"tire": 4, "hub": 4, "steering": 2, "exhaust": 2, "fairing": 1}
for key, count in expected.items():
    if len(groups[key]) != count:
        raise SystemExit(f"ERRO: esperava {count} ilhas '{key}', achei {len(groups[key])}")

# --- escala e pivô do kart ------------------------------------------------
tire_centers = [(sum(bounds(t)) / 2) for t in groups["tire"]]
rear_tires = sorted(tire_centers, key=lambda c: -c[1])[:2]
pivot = Vector((
    float(np.mean([c[0] for c in rear_tires])),
    float(np.mean([c[1] for c in rear_tires])),
    float(all_lo[2]),
))
scale = TARGET_LENGTH / length
to_game = Matrix.Scale(scale, 4) @ Matrix.Translation(-pivot)
for island in islands:
    island.data.transform(to_game)

# --- montagem das partes --------------------------------------------------
root = bpy.data.objects.new("kart", None)
bpy.context.scene.collection.objects.link(root)
report = {"scale": round(scale, 5), "parts": {}}


def side_of(center):
    # Olhando para a frente (+Z no glTF), +X é a esquerda.
    return ("f" if center[1] < -0.5 * TARGET_LENGTH * 0.5 else "r") + ("l" if center[0] > 0 else "r")


wheels = {}
for island in groups["tire"] + groups["hub"]:
    lo, hi = bounds(island)
    wheels.setdefault(side_of((lo + hi) / 2), []).append(island)
if sorted(wheels) != ["fl", "fr", "rl", "rr"] or any(len(v) != 2 for v in wheels.values()):
    raise SystemExit(f"ERRO: rodas mal agrupadas: { {k: len(v) for k, v in wheels.items()} }")

parts = []
for key, members in wheels.items():
    tire = max(members, key=lambda o: bounds(o)[1][2] - bounds(o)[0][2])
    lo, hi = bounds(tire)
    center, radius = (lo + hi) / 2, float((hi[2] - lo[2]) / 2)
    wheel = join(members, f"wheel_{key}")
    set_origin(wheel, center)
    wheel["radius"] = round(radius, 4)
    wheel["width"] = round(float(hi[0] - lo[0]), 4)
    parts.append(wheel)

rim = max(groups["steering"], key=lambda o: len(o.data.vertices))
rim_coords = coords(rim)
rim_center = rim_coords.mean(axis=0)
# Eixo de giro = normal do plano do aro (direção de menor variância).
_, _, axes = np.linalg.svd(rim_coords - rim_center)
axis = axes[2] if axes[2][1] < 0 else -axes[2]  # aponta para a frente do kart
steering = join(groups["steering"], "steering_wheel")
set_origin(steering, rim_center)
steering["axis"] = to_gltf(axis)
parts.append(steering)

parts.append(join(groups["fairing"], "fairing"))
parts.append(join(groups["exhaust"], "exhaust"))
parts.append(join(groups["body"], "kart_body"))

for part in parts:
    part.parent = root
    lo, hi = bounds(part)
    world_lo, world_hi = lo + np.array(part.location), hi + np.array(part.location)
    part.data.calc_loop_triangles()
    report["parts"][part.name] = {
        "triangles": len(part.data.loop_triangles),
        "origin": to_gltf(part.location),
        "min": to_gltf((world_lo[0], world_hi[1], world_lo[2])),
        "max": to_gltf((world_hi[0], world_lo[1], world_hi[2])),
        **{k: (list(part[k]) if hasattr(part[k], "__len__") else part[k]) for k in part.keys()},
    }

report["triangles"] = sum(p["triangles"] for p in report["parts"].values())
report["size_m"] = {
    "width": round(float((all_hi[0] - all_lo[0]) * scale), 3),
    "height": round(float((all_hi[2] - all_lo[2]) * scale), 3),
    "length": round(float(length * scale), 3),
}

bpy.ops.export_scene.gltf(
    filepath=glb_path,
    export_format="GLB",
    export_yup=True,
    export_apply=True,
    export_extras=True,
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
