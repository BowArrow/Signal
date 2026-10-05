"""Signal's fixed Blender renderer. Scene instructions are validated JSON, never code."""
import bpy
import json
import math
import os
import sys
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
with open(args[0], encoding='utf-8') as source:
    job = json.load(source)
folder = args[1]
shot = job['shot']
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 16
scene.cycles.use_denoising = True
scene.cycles.denoiser = 'OPENIMAGEDENOISE'
if hasattr(scene.cycles, 'denoising_use_gpu'):
    scene.cycles.denoising_use_gpu = False
scene.render.threads_mode = 'FIXED'
scene.render.threads = 4
scene.render.resolution_x, scene.render.resolution_y = {'16:9': (640, 360), '9:16': (360, 640), '1:1': (480, 480)}[job['ratio']]
scene.render.resolution_percentage = 100
scene.render.fps = 24
scene.frame_start = 1
scene.frame_end = job['frames']
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = os.path.join(folder, 'frames', '')
scene.world = bpy.data.worlds.new('Signal world')
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.6, 0.6, 0.6, 1)
scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.8

def material(name, color):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    shader = m.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Roughness'].default_value = 0.85
    return m

ground = material('Neutral set', (0.32, 0.35, 0.4))
bpy.ops.mesh.primitive_plane_add(size=36)
bpy.context.object.data.materials.append(ground)
if shot['environment'] == 'office':
    for x in [-2, 2]:
        bpy.ops.mesh.primitive_cube_add(size=1, location=(x, 1.5, 0.65))
        bpy.context.object.scale = (1.3, 0.75, 1.3)
        bpy.context.object.data.materials.append(ground)
elif shot['environment'] == 'outdoors':
    for x in [-5, 5]:
        bpy.ops.mesh.primitive_cone_add(vertices=10, radius1=1, depth=4, location=(x, 3, 2))
        bpy.context.object.data.materials.append(ground)

colors = [(0.8, 0.25, 0.2), (0.2, 0.5, 0.8), (0.8, 0.65, 0.15)]
for index, actor in enumerate(shot['actors']):
    root = bpy.data.objects.new('Character ' + actor['characterId'], None)
    scene.collection.objects.link(root)
    mat = material('Character proxy ' + str(index + 1), colors[index])
    limbs = []
    for part_index, (location, scale) in enumerate([((0, 0, 1.0), (0.25, 0.16, 0.42)), ((0, 0, 1.65), (0.2, 0.18, 0.24)), ((-0.14, 0, 0.35), (0.09, 0.1, 0.35)), ((0.14, 0, 0.35), (0.09, 0.1, 0.35)), ((-0.36, 0, 1.05), (0.09, 0.1, 0.35)), ((0.36, 0, 1.05), (0.09, 0.1, 0.35))]):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, location=location)
        part = bpy.context.object
        part.scale = scale
        part.parent = root
        part.data.materials.append(mat)
        if part_index >= 2:
            limbs.append((part, Vector(location), part_index))
    start, end = Vector(actor['start']), Vector(actor['end'])
    distance = (end - start).length
    # Bake motion at each frame: no easing from a frozen first frame and no
    # rigid sliding proxies. This is a blocking guide, not a finished rig.
    for frame in range(1, scene.frame_end + 1):
        fraction = (frame - 1) / max(1, scene.frame_end - 1)
        phase = fraction * distance * math.tau / 0.65 + math.pi / 4
        root.location = start.lerp(end, fraction)
        root.keyframe_insert(data_path='location', frame=frame)
        if distance > 0.05:
            root.rotation_euler.z = math.atan2(-(end.x - start.x), end.y - start.y)
            for part, location, part_index in limbs:
                swing = math.sin(phase + (math.pi if part_index % 2 else 0))
                part.rotation_euler.x = swing * 0.32
                part.location = location + Vector((0, swing * 0.10, abs(swing) * 0.035))
                part.keyframe_insert(data_path='rotation_euler', frame=frame)
                part.keyframe_insert(data_path='location', frame=frame)

bpy.ops.object.camera_add()
camera = bpy.context.object
camera.data.lens = shot['lensMm']
scene.camera = camera
for frame in range(1, scene.frame_end + 1):
    fraction = (frame - 1) / max(1, scene.frame_end - 1)
    camera.location = Vector(shot['cameraStart']).lerp(Vector(shot['cameraEnd']), fraction)
    direction = Vector(shot['lookAt']) - camera.location
    if direction.length < 0.1:
        raise ValueError('Camera must be separated from its target')
    camera.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    camera.keyframe_insert(data_path='location', frame=frame)
    camera.keyframe_insert(data_path='rotation_euler', frame=frame)
bpy.ops.object.light_add(type='AREA', location=(0, -3, 7))
bpy.context.object.data.energy = 700
bpy.context.object.data.shape = 'DISK'
bpy.context.object.data.size = 8
scene.frame_set(1)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(folder, 'blockout.blend'))
os.makedirs(os.path.join(folder, 'frames'), exist_ok=True)
bpy.ops.render.render(animation=True)
