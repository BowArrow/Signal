export const directorGuidance={
  source:'Joey cinema-director-v3',engine:'LTX 2.5 image-to-video',
  adaptation:'Joey supplies the cinematography structure. LTX limits come from the installed workflow, not the Seedance limits in the original skill.',
  rules:['One clear, timed action per shot.','Lock identity, wardrobe, screen direction and depth.','Describe observable movement rather than mood labels.','Keep the source composition and name the first-frame action.','Lock lens/FOV, camera behavior, motivated lighting and physical contact.','Keep generated frames free of text and interfaces; add marketing copy during editing.','Use real captured product footage for demonstrations.','Review consecutive generated frames for identity drift, hands, ghosting and geometry before using the take.'],
};
export function directorPrompt(d){
  return [
    `1 continuous shot. Total ${d.duration} seconds. No cuts. Real-time throughout, no speed changes.`,
    'STYLE: Natural photographic detail, continuous motion, consistent exposure. No ghosting, double images or morphing. NOT a 3D render, NOT a game engine, NOT a game-cutscene aesthetic, NOT a cartoon.',
    'NO ON-SCREEN TEXT: No captions, titles, logos, watermarks, product interfaces or invented readable text. Keep the frame clean.',
    'CRITICAL: Preserve the supplied reference identity, wardrobe and geometry throughout. No additional subjects.',
    `ASSETS: ${d.subject}. The supplied image controls identity, wardrobe and the opening composition.`,
    `GEOMETRY MAP: ${d.geometry}`,
    `FIRST FRAME: ${d.firstFrame}`,
    `OPTICS: ${d.fov} degree field of view, fixed focal length throughout.`,
    `CAMERA: ${d.camera}`,
    `LIGHT & COLOUR: ${d.lighting}`,
    `ATMOSPHERE: ${d.atmosphere}`,
    'ACTION TIMING: '+d.beats.map(b=>`${b.start}-${b.end}s: ${b.action}`).join(' '),
    `PHYSICS: ${d.physics}`,
    `ACTING: ${d.acting}`,
    'AUDIO: Silent output. No talking, singing or invented dialogue. Narration and music belong in the edit.',
    `LOCKS: ${d.locks}`,
  ].join('\n\n');
}
