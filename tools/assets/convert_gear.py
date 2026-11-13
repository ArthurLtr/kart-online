"""Converte a bota e a luva de referencias/ em peças leves para o piloto.

Uso: blender -b --python convert_gear.py -- <bota.obj> <luva.obj> <saida.glb> <relatorio.json>
        <comprimento da bota (m)> <recuo do calcanhar (m)> <altura do tornozelo (m)>
        <comprimento da luva (m)> <punho abaixo do pulso (m)>

Saída (glTF, Y para cima):
- shoe_upper / shoe_sole: um pé, origem no tornozelo (sobre o eixo do cano), bico para +Z.
- glove_main / glove_trim: mão ESQUERDA, origem no pulso, dedos para +Y, palma para +Z,
  polegar para -X.
"""
import json
import sys

import bpy
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index("--") + 1 :]
shoe_path, glove_path, glb_path, report_path = args[:4]
shoe_length, heel_back, ankle_height, glove_length, cuff_below = (float(v) for v in args[4:9])

bpy.ops.wm.read_factory_settings(use_empty=True)
report = {}


def import_obj(path):
    before = set(bpy.data.objects)
    bpy.ops.wm.obj_import(filepath=path)
    objs = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
    select(objs)
    if len(objs) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return obj


def select(objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def triangles(obj):
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles)


def transform(obj, matrix):
    obj.data.transform(matrix)
    obj.data.update()


def bounds(obj):
    xs = [v.co for v in obj.data.vertices]
    lo = Vector((min(v.x for v in xs), min(v.y for v in xs), min(v.z for v in xs)))
    hi = Vector((max(v.x for v in xs), max(v.y for v in xs), max(v.z for v in xs)))
    return lo, hi


def decimate(obj, target):
    count = triangles(obj)
    if count > target:
        select([obj])
        mod = obj.modifiers.new("decimate", "DECIMATE")
        mod.ratio = target / count
        bpy.ops.object.modifier_apply(modifier=mod.name)
    select([obj])
    bpy.ops.object.shade_smooth()
    obj.data.materials.clear()


def split_faces(obj, predicate, name):
    """Separa em outro objeto as faces que passam no teste."""
    select([obj])
    for poly in obj.data.polygons:
        poly.select = predicate(poly)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_mode(type="FACE")
    bpy.ops.mesh.separate(type="SELECTED")
    bpy.ops.object.mode_set(mode="OBJECT")
    other = [o for o in bpy.context.selected_objects if o is not obj][0]
    other.name = name
    return other


# --- bota -------------------------------------------------------------------
shoe = import_obj(shoe_path)
lo, hi = bounds(shoe)
height = hi.z - lo.z
# O cano fica sobre o calcanhar: o bico é o lado oposto.
shaft = [v.co for v in shoe.data.vertices if v.co.z > lo.z + 0.65 * height]
shaft_x = sum(v.x for v in shaft) / len(shaft)
shaft_y = sum(v.y for v in shaft) / len(shaft)
toe_sign = -1 if shaft_y > (lo.y + hi.y) / 2 else 1
scale = shoe_length / (hi.y - lo.y)
heel_y = hi.y if toe_sign < 0 else lo.y
# Origem no tornozelo; bico para -Y do Blender (= +Z do glTF).
transform(shoe, Matrix.Translation((-shaft_x, -heel_y, -lo.z)))
transform(shoe, Matrix.Diagonal((scale, scale, scale, 1)))
if toe_sign > 0:
    transform(shoe, Matrix.Rotation(3.141592653589793, 4, "Z"))
# A origem (tornozelo) fica no eixo do cano, para a bota girar em torno da canela.
band = [v.co for v in shoe.data.vertices if 0.5 * height * scale < v.co.z < 0.8 * height * scale]
axis_x = sum(v.x for v in band) / len(band)
axis_y = sum(v.y for v in band) / len(band)
radii = [((v.x - axis_x) ** 2 + (v.y - axis_y) ** 2) ** 0.5 for v in band]
transform(shoe, Matrix.Translation((-axis_x, -axis_y, -ankle_height)))
lo, hi = bounds(shoe)
sole_top = -ankle_height + 0.075 * shoe_length
sole = split_faces(shoe, lambda poly: poly.center.z < sole_top, "shoe_sole")
shoe.name = "shoe_upper"
decimate(shoe, 3200)
decimate(sole, 500)
report["shoe"] = {
    "upper": triangles(shoe),
    "sole": triangles(sole),
    "toe_sign": toe_sign,
    "heel": round(hi.y, 3),
    "toe": round(-lo.y, 3),
    "top": round(hi.z, 3),
    "shaft_radius": [round(min(radii), 3), round(sum(radii) / len(radii), 3), round(max(radii), 3)],
}

# --- luva -------------------------------------------------------------------
glove = import_obj(glove_path)
lo, hi = bounds(glove)
height = hi.z - lo.z
wrist = [v.co for v in glove.data.vertices if v.co.z < lo.z + 0.12 * height]
wrist_x = sum(v.x for v in wrist) / len(wrist)
wrist_y = sum(v.y for v in wrist) / len(wrist)
scale = (glove_length + cuff_below) / height
transform(glove, Matrix.Translation((-wrist_x, -wrist_y, -lo.z)))
transform(glove, Matrix.Diagonal((scale, scale, scale, 1)))
transform(glove, Matrix.Translation((0, 0, -cuff_below)))
cuff = [v.co for v in glove.data.vertices if v.co.z < -0.5 * cuff_below]
cuff_radii = [(v.x**2 + v.y**2) ** 0.5 for v in cuff]

# O tecido de maior área é a cor principal; os outros painéis viram o detalhe escuro.
areas = {}
for poly in glove.data.polygons:
    areas[poly.material_index] = areas.get(poly.material_index, 0) + poly.area
main_index = max(areas, key=areas.get)
trim = split_faces(glove, lambda poly: poly.material_index != main_index, "glove_trim")
glove.name = "glove_main"
decimate(glove, 2400)
decimate(trim, 1200)
lo, hi = bounds(glove)
report["glove"] = {
    "main": triangles(glove),
    "trim": triangles(trim),
    "size": [round(hi[i] - lo[i], 3) for i in range(3)],
    "cuff_radius": [round(min(cuff_radii), 3), round(sum(cuff_radii) / len(cuff_radii), 3), round(max(cuff_radii), 3)],
}

bpy.ops.export_scene.gltf(
    filepath=glb_path,
    export_format="GLB",
    export_yup=True,
    export_apply=True,
    export_normals=True,
    export_texcoords=False,
    export_materials="NONE",
    export_animations=False,
    export_cameras=False,
    export_lights=False,
)
with open(report_path, "w", encoding="utf-8") as handle:
    json.dump(report, handle, indent=2)
print("CONVERT_OK")
