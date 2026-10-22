import { EditorError, MAX_MODEL_BYTES } from './core.js';
import { buildPreset, printRect, type Finish, type MeshPart, type ModelGeometry } from './meshes.js';
import { parseGlb } from './glb.js';
import { createSoftBody, type SoftBody } from './softbody.js';
import type { Model3D, PrintSurface, SurfaceBinding } from './types.js';

/**
 * Optional WebGL2 turntable viewer. Editors import this module only when a shopper or merchant opens a 3D view,
 * so 2D-only embeds never download it. It renders prepared or generated meshes with print textures supplied by the editor.
 */
export type ViewerTool = 'orbit' | 'pull';
export interface Viewer {
  load(model: Model3D, surfaces: PrintSurface[], signal?: AbortSignal): Promise<void>;
  /** Re-place print areas after binding or surface edits, without rebuilding geometry. */
  setPlacement(model: Model3D, surfaces: PrintSurface[]): void;
  /** Print texture per surface; null removes it. */
  setPrint(surfaceId: string, source: TexImageSource | null): void;
  printableParts(): string[];
  focus(surfaceId: string): void;
  reset(): void;
  zoom(factor: number): void;
  setAutoRotate(on: boolean): void;
  /** `orbit` turns the model; `pull` drags soft products (garments, cushions, caps) like fabric. */
  setTool(tool: ViewerTool): void;
  /** Whether the loaded product can be pulled: generated soft products only, never mugs, boxes, cards or GLB files. */
  readonly deformable: boolean;
  /** Current looseness, 0 stiff … 1 loose. */
  readonly softness: number;
  /** Preview-only looseness; it never changes the design or the print. */
  setSoftness(value: number): void;
  /** Lets pulled fabric spring back to its rest shape. */
  resetShape(): void;
  resize(width: number, height: number, pixelRatio: number): void;
  snapshot(): Promise<Blob>;
  /** Renders a product photo facing a part, with where each print area on that part lands (normalized image coordinates). */
  still(part: string, width: number, height: number, background?: [string, string]): { image: HTMLCanvasElement; bindings: SurfaceBinding[] };
  dispose(): void;
}
export interface ViewerOptions { onContextLost?(): void; reducedMotion?: boolean; label?: string }

const VERTEX = `#version 300 es
in vec3 aPosition; in vec3 aNormal; in vec2 aPartUV; in vec2 aBaseUV; in vec2 aAO; in vec4 aDetail; in vec3 aRest;
uniform mat4 uModel; uniform mat4 uViewProjection; uniform mat4 uLight; uniform vec3 uLightDir; uniform float uNormalOffset;
out vec3 vNormal; out vec3 vWorld; out vec2 vPartUV; out vec2 vBaseUV; out vec2 vAO; out vec4 vDetail; out vec3 vRest; out vec4 vShadow;
void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vec3 normal = normalize(mat3(uModel) * aNormal);
  vWorld = world.xyz; vNormal = normal; vPartUV = aPartUV; vBaseUV = aBaseUV; vAO = aAO; vDetail = aDetail; vRest = aRest;
  // Look the shadow up slightly off the surface, on the side facing the light, so thin two-sided cloth does not shadow itself.
  // Surfaces lit at a grazing angle need a larger offset.
  float facing = dot(normal, uLightDir);
  vShadow = uLight * vec4(world.xyz + normal * (facing >= 0.0 ? 1.0 : -1.0) * uNormalOffset * (1.0 + 3.0 * (1.0 - abs(facing))), 1.0);
  gl_Position = uViewProjection * world;
}`;
/** Depth from the key light, for shadows. Shares attribute location 0 (aPosition) with the main program's vertex arrays. */
const DEPTH_VERTEX = `#version 300 es
in vec3 aPosition; uniform mat4 uModel; uniform mat4 uLight;
void main() { gl_Position = uLight * uModel * vec4(aPosition, 1.0); }`;
const DEPTH_FRAGMENT = `#version 300 es
precision mediump float;
void main() {}`;
// Studio lighting fixed to the camera: a warm key softbox, a cool fill strip, a rim light and a sky/floor hemisphere.
// Fabric gets a procedural weave/knit relief (bump mapped from screen-space derivatives) and a sheen lobe; glazes reflect the softboxes.
const FRAGMENT = `#version 300 es
precision highp float;
in vec3 vNormal; in vec3 vWorld; in vec2 vPartUV; in vec2 vBaseUV; in vec2 vAO; in vec4 vDetail; in vec3 vRest; in vec4 vShadow;
uniform vec3 uColor; uniform bool uHasBase; uniform sampler2D uBase;
uniform int uPrints; uniform sampler2D uPrint0; uniform sampler2D uPrint1; uniform sampler2D uPrint2; uniform sampler2D uPrint3; uniform vec4 uRect[4];
uniform vec3 uCamera; uniform float uRoughness; uniform int uFinish; uniform vec4 uMaterial; uniform vec2 uPartSize;
uniform highp sampler2DShadow uShadowMap; uniform float uShadowTexel; uniform float uShadowStrength; uniform vec3 uLightDir; uniform float uDepthTexel;
out vec4 outColor;
const float PI = 3.14159265;
const vec2 DISK[12] = vec2[12](vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457), vec2(-0.203, 0.621), vec2(0.962, -0.195), vec2(0.473, -0.480),
  vec2(0.519, 0.767), vec2(0.185, -0.893), vec2(0.507, 0.064), vec2(0.896, 0.412), vec2(-0.322, -0.933), vec2(-0.792, -0.598));
// Soft shadow from the key light: percentage-closer filtering over a Poisson disk, turned per pixel
// (interleaved gradient noise) so a wide, soft penumbra shows fine grain instead of banding.
float lightVisible(vec4 coord, float spread, float bias) {
  vec3 p = coord.xyz / coord.w * 0.5 + 0.5;
  if (p.z >= 1.0 || p.x <= 0.0 || p.y <= 0.0 || p.x >= 1.0 || p.y >= 1.0) return 1.0;
  float angle = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) * 6.2831853;
  mat2 turn = mat2(cos(angle), sin(angle), -sin(angle), cos(angle));
  float sum = 0.0;
  for (int i = 0; i < 12; i++) sum += texture(uShadowMap, vec3(p.xy + turn * DISK[i] * uShadowTexel * spread, p.z - bias));
  return sum / 12.0;
}
vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
// Gradient noise: unlike value noise, its slope does not vanish on lattice planes, which would show as contour lines in the bump.
vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.103, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx) * 2.0 - 1.0;
}
float corner(vec3 i, vec3 f, vec3 o) { return dot(hash33(i + o), f - o); }
float noise3(vec3 x) {
  vec3 i = floor(x), f = fract(x), u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(mix(mix(corner(i, f, vec3(0, 0, 0)), corner(i, f, vec3(1, 0, 0)), u.x), mix(corner(i, f, vec3(0, 1, 0)), corner(i, f, vec3(1, 1, 0)), u.x), u.y),
             mix(mix(corner(i, f, vec3(0, 0, 1)), corner(i, f, vec3(1, 0, 1)), u.x), mix(corner(i, f, vec3(0, 1, 1)), corner(i, f, vec3(1, 1, 1)), u.x), u.y), u.z) * 0.6 + 0.5;
}
vec4 printAt(sampler2D s, vec4 rect) {
  vec2 uv = (vPartUV - rect.xy) / rect.zw;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec4(0.0);
  return texture(s, uv);
}
// Fades a pattern of 'period' millimeters out before it would alias (below about three pixels per period).
float visible(float period, float footprint) { return 1.0 - smoothstep(0.15, 0.34, footprint / period); }
float panel(vec3 r, vec3 axis, vec2 size, float soft) {
  float t = dot(r, axis);
  vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), axis)), up = cross(axis, side);
  vec2 q = abs(vec2(dot(r, side), dot(r, up)) / max(t, 1e-3)) - size;
  return t > 0.0 ? 1.0 - smoothstep(-soft, soft, max(q.x, q.y)) : 0.0;
}
vec3 studio(vec3 r, float rough) {
  float soft = 0.03 + rough * 0.6;
  vec3 c = mix(vec3(0.07, 0.065, 0.06), vec3(0.42, 0.44, 0.47), smoothstep(-0.3, 0.55, r.y));
  c += vec3(1.0, 0.97, 0.92) * 5.5 * panel(r, normalize(vec3(0.5, 0.6, 0.62)), vec2(0.55, 0.38), soft);
  c += vec3(0.8, 0.86, 1.0) * 2.4 * panel(r, normalize(vec3(-0.85, 0.12, 0.5)), vec2(0.12, 0.8), soft);
  c += vec3(1.0) * 2.0 * panel(r, normalize(vec3(0.0, 1.0, 0.2)), vec2(0.45, 0.45), soft);
  return c;
}
// Bump mapping without tangents (Mikkelsen 2010). The height gradient comes in pre-faded,
// so fading a pattern out never adds a gradient of its own (which would show as rings).
vec3 perturb(vec3 n, vec3 p, float dhdx, float dhdy) {
  vec3 dpdx = dFdx(p), dpdy = dFdy(p);
  vec3 r1 = cross(dpdy, n), r2 = cross(n, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (dhdx * r1 + dhdy * r2);
  return normalize(abs(det) * n - grad);
}
vec3 aces(vec3 x) { return clamp(x * (2.51 * x + 0.03) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
void main() {
  vec3 view = normalize(uCamera - vWorld);
  vec3 n = normalize(vNormal);
  bool backSide = dot(n, view) < 0.0;
  if (backSide) n = -n;
  float ao = backSide ? vAO.y : vAO.x;
  // Pattern coordinates: millimeters in part space where it exists, otherwise the rest position.
  bool hasPart = vPartUV.x > -0.5 && uPartSize.x > 0.0;
  vec2 mm = vPartUV * uPartSize;
  float footprint = max(length(fwidth(vRest)), 1e-4);
  float partFootprint = max(length(fwidth(mm)), 1e-4);
  float ribFootprint = max(fwidth(vDetail.y), 1e-4);
  float seamFootprint = max(fwidth(vDetail.z), 1e-4), alongFootprint = max(fwidth(abs(vDetail.w)), 1e-4);
  float n1 = noise3(vRest * 0.3), n2 = noise3(vRest * 1.1 + 7.0), n3 = noise3(vRest * 3.2 + 3.0);
  // Two height layers, each with its own fade: coarse (slub, pills, weave) and fine (stitches, ribs).
  float coarse = 0.0, fine = 0.0, coarseFade = 0.0, fineFade = 0.0, tint = 0.0;
  if (uFinish == 0) { // cotton jersey: slub and heather
    coarse = n1 * 0.16 + n2 * 0.1; coarseFade = visible(3.0, footprint);
    tint = (n1 - 0.5) * 0.045 + (n2 - 0.5) * 0.03;
  } else if (uFinish == 1) { // brushed fleece
    coarse = n1 * 0.1 + n2 * 0.14; coarseFade = visible(2.4, footprint);
    tint = (n2 - 0.5) * 0.05;
  } else if (uFinish == 2) { // knitted stitches: wales with V-shaped loops
    coarse = n1 * 0.15; coarseFade = visible(3.0, footprint);
    if (hasPart) {
      vec2 k = mm / vec2(4.2, 4.6);
      float fx = fract(k.x) - 0.5;
      float loop = 1.0 - abs(fract(k.y + abs(fx) * 0.9) - 0.5) * 2.0;
      fine = ((1.0 - abs(fx) * 2.0) * 0.5 + loop * 0.4) * 0.55; fineFade = visible(4.2, partFootprint);
    }
    tint = (n1 - 0.5) * 0.06;
  } else if (uFinish == 3) { // twill: diagonal wales
    coarse = n2 * 0.06; coarseFade = visible(2.0, footprint);
    fine = abs(fract((vRest.x + vRest.y + vRest.z * 0.5) / 1.8) - 0.5) * 0.24; fineFade = visible(1.8, footprint);
    tint = (n1 - 0.5) * 0.04;
  } else if (uFinish == 4) { // canvas: plain weave
    coarse = n1 * 0.12; coarseFade = visible(3.0, footprint);
    vec2 w = (hasPart ? mm : vRest.xy) / 2.6;
    fine = sin(w.x * 2.0 * PI) * sin(w.y * 2.0 * PI) * 0.08; fineFade = visible(2.6, hasPart ? partFootprint : footprint);
    tint = (n2 - 0.5) * 0.05;
  } else if (uFinish == 7 || uFinish == 8) { // paper and card: fibres
    tint = (n2 - 0.5) * 0.02;
  }
  float rib = clamp(vDetail.x, 0.0, 1.0);
  float ribHeight = (1.0 - abs(fract(vDetail.y / 2.8) - 0.5) * 2.0) * 0.5;
  fine = mix(fine, ribHeight, rib); fineFade = mix(fineFade, visible(2.8, ribFootprint), rib);
  // Seams: the fabric dips into the seam and puckers slightly along it; topstitched seams add a double row of raised stitches.
  float across = vDetail.z, along = abs(vDetail.w), topstitched = step(0.0, vDetail.w);
  float groove = -0.7 * exp(-across * across / 2.5) + 0.18 * sin(along / 6.5 + n1 * 3.0) * exp(-across * across / 40.0);
  float phase = fract(along / 2.8);
  float dash = mix(0.55, smoothstep(0.05, 0.25, phase) * (1.0 - smoothstep(0.7, 0.9, phase)), visible(2.8, alongFootprint));
  float rows = exp(-pow((abs(across) - 3.0) / 0.42, 2.0)) + exp(-pow((abs(across) - 6.4) / 0.42, 2.0));
  float thread = rows * dash * 0.28 * topstitched * step(-20.0, -abs(across));
  // Fade by the feature's width: the groove is about 5 mm across, a stitch row about 2.4 mm apart from its neighbour.
  float grooveFade = visible(5.0, seamFootprint), threadFade = visible(2.4, seamFootprint);
  n = perturb(n, vWorld,
    dFdx(coarse) * coarseFade + dFdx(fine) * fineFade + dFdx(groove) * grooveFade + dFdx(thread) * threadFade,
    dFdy(coarse) * coarseFade + dFdy(fine) * fineFade + dFdy(groove) * grooveFade + dFdy(thread) * threadFade);
  tint += thread * threadFade * 0.7 - exp(-across * across / 3.0) * grooveFade * 0.12;

  vec3 albedo = toLinear(uColor) * (1.0 + tint);
  if (uHasBase) albedo *= toLinear(texture(uBase, vBaseUV).rgb);
  float ink = 0.0;
  vec4 p;
  if (uPrints > 0) { p = printAt(uPrint0, uRect[0]); albedo = mix(albedo, toLinear(p.rgb), p.a); ink = max(ink, p.a); }
  if (uPrints > 1) { p = printAt(uPrint1, uRect[1]); albedo = mix(albedo, toLinear(p.rgb), p.a); ink = max(ink, p.a); }
  if (uPrints > 2) { p = printAt(uPrint2, uRect[2]); albedo = mix(albedo, toLinear(p.rgb), p.a); ink = max(ink, p.a); }
  if (uPrints > 3) { p = printAt(uPrint3, uRect[3]); albedo = mix(albedo, toLinear(p.rgb), p.a); ink = max(ink, p.a); }

  float sheenStrength = uMaterial.x * (1.0 - ink * 0.6), wrap = uMaterial.y, specularScale = uMaterial.z, reflectance = uMaterial.w;
  bool metal = uFinish == 6;
  float rough = clamp(uRoughness, 0.06, 1.0), a = rough * rough, a2 = a * a;
  // Specular anti-aliasing: where the normal changes faster than a pixel (curved glossy edges), widen the highlight instead of letting it sparkle.
  vec3 dndx = dFdx(n), dndy = dFdy(n);
  a2 = clamp(a2 + min(0.5 * (dot(dndx, dndx) + dot(dndy, dndy)), 0.18), 0.0, 1.0);
  float NoV = max(dot(n, view), 1e-3);
  vec3 f0 = metal ? albedo : vec3(0.045);
  vec3 diffuse = metal ? vec3(0.0) : albedo;
  vec3 sheenColor = sqrt(max(albedo, vec3(0.0))) * sheenStrength;
  vec3 color = diffuse * mix(vec3(0.15, 0.14, 0.13), vec3(0.4, 0.42, 0.45), n.y * 0.5 + 0.5) * ao;
  vec3 lights[4] = vec3[4](normalize(vec3(0.5, 0.72, 0.62)), normalize(vec3(-0.78, 0.18, 0.5)), normalize(vec3(-0.15, 0.45, -1.0)), normalize(vec3(0.1, 1.0, 0.05)));
  vec3 tints[4] = vec3[4](vec3(1.0, 0.96, 0.9) * 1.05, vec3(0.72, 0.8, 0.95) * 0.3, vec3(1.0) * 0.45, vec3(1.0, 0.98, 0.95) * 0.2);
  float shade = mix(1.0, ao, 0.55);
  // Receiver-slope bias: across the soft-shadow filter a tilted surface spans more depth, so the bias grows
  // with the filter radius and the tangent of the light's angle; otherwise cloth lit at a grazing angle shadows itself.
  float facingLight = dot(normalize(vNormal) * (backSide ? -1.0 : 1.0), uLightDir);
  float cosLight = clamp(abs(facingLight), 0.08, 1.0);
  float tanLight = min(sqrt(1.0 - cosLight * cosLight) / cosLight, 8.0);
  // Near the terminator the (wrapped) diffuse term already fades the light; a shadow there would only trace every wrinkle.
  float keyVisible = mix(1.0, lightVisible(vShadow, 6.0, uDepthTexel * (2.0 + tanLight * 6.5)), uShadowStrength * smoothstep(0.03, 0.32, facingLight));
  for (int i = 0; i < 4; i++) {
    vec3 l = lights[i];
    float NoLraw = dot(n, l), NoL = max(NoLraw, 0.0);
    vec3 halfway = normalize(l + view);
    float NoH = max(dot(n, halfway), 0.0), VoH = max(dot(view, halfway), 0.0);
    vec3 F = f0 + (1.0 - f0) * pow(1.0 - VoH, 5.0);
    float d = NoH * NoH * (a2 - 1.0) + 1.0;
    float D = a2 / (PI * d * d);
    float Vis = 0.5 / (NoL * sqrt(NoV * NoV * (1.0 - a2) + a2) + NoV * sqrt(NoL * NoL * (1.0 - a2) + a2) + 1e-5);
    vec3 specular = F * D * Vis * NoL * PI * specularScale;
    float inv = 1.0 / max(rough, 0.07);
    float sheenD = (2.0 + inv) * pow(max(1.0 - NoH * NoH, 1e-4), inv * 0.5) / (2.0 * PI);
    float sheenV = 1.0 / (4.0 * (NoL + NoV - NoL * NoV) + 1e-3);
    vec3 sheen = sheenColor * sheenD * sheenV * NoL * PI;
    float lambert = max((NoLraw + wrap) / (1.0 + wrap), 0.0);
    color += (diffuse * lambert + specular + sheen) * tints[i] * shade * (i == 0 ? keyVisible : 1.0);
  }
  vec3 r = reflect(-view, n);
  vec3 envF = f0 + (max(vec3(1.0 - rough), f0) - f0) * pow(1.0 - NoV, 5.0);
  color += studio(r, rough) * envF * reflectance * mix(1.0, ao, 0.8) * mix(0.55, 1.0, keyVisible);
  outColor = vec4(pow(aces(color * 0.8), vec3(1.0 / 2.2)), 1.0);
}`;
/** The floor: a soft contact shadow under the product plus the key light's cast shadow, fading out with distance. */
const FLOOR_VERTEX = `#version 300 es
in vec2 aCorner; uniform mat4 uModel; uniform mat4 uViewProjection; uniform mat4 uLight; uniform vec4 uFloor; out vec2 vPlane; out vec4 vShadow;
void main() {
  vPlane = aCorner * 1.8;
  vec4 world = uModel * vec4(uFloor.x + vPlane.x * uFloor.w, uFloor.y, uFloor.z + vPlane.y * uFloor.w, 1.0);
  vShadow = uLight * world;
  gl_Position = uViewProjection * world;
}`;
const FLOOR_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vPlane; in vec4 vShadow;
uniform vec2 uStretch; uniform float uStrength; uniform float uCast; uniform highp sampler2DShadow uShadowMap; uniform float uShadowTexel;
out vec4 outColor;
const vec2 DISK[12] = vec2[12](vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457), vec2(-0.203, 0.621), vec2(0.962, -0.195), vec2(0.473, -0.480),
  vec2(0.519, 0.767), vec2(0.185, -0.893), vec2(0.507, 0.064), vec2(0.896, 0.412), vec2(-0.322, -0.933), vec2(-0.792, -0.598));
// Soft shadow from the key light: percentage-closer filtering over a Poisson disk, turned per pixel
// (interleaved gradient noise) so a wide, soft penumbra shows fine grain instead of banding.
float lightVisible(vec4 coord, float spread, float bias) {
  vec3 p = coord.xyz / coord.w * 0.5 + 0.5;
  if (p.z >= 1.0 || p.x <= 0.0 || p.y <= 0.0 || p.x >= 1.0 || p.y >= 1.0) return 1.0;
  float angle = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) * 6.2831853;
  mat2 turn = mat2(cos(angle), sin(angle), -sin(angle), cos(angle));
  float sum = 0.0;
  for (int i = 0; i < 12; i++) sum += texture(uShadowMap, vec3(p.xy + turn * DISK[i] * uShadowTexel * spread, p.z - bias));
  return sum / 12.0;
}
void main() {
  float r = length(vPlane / max(uStretch, vec2(0.05)));
  float contact = (pow(max(1.0 - r, 0.0), 2.2) * 0.75 + pow(max(1.0 - r * 1.6, 0.0), 3.0) * 0.6) * uStrength;
  float castShadow = (1.0 - lightVisible(vShadow, 12.0, 0.0006)) * uCast * (1.0 - smoothstep(0.35, 1.25, length(vPlane)));
  outColor = vec4(0.0, 0.0, 0.0, clamp(max(contact, castShadow) + contact * castShadow * 0.5, 0.0, 0.85));
}`;

type Mat4 = Float32Array;
type Vec3 = [number, number, number];
function perspective(fov: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}
function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return out;
}
const rotationX = (a: number): Mat4 => new Float32Array([1, 0, 0, 0, 0, Math.cos(a), Math.sin(a), 0, 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1]);
const rotationY = (a: number): Mat4 => new Float32Array([Math.cos(a), 0, -Math.sin(a), 0, 0, 1, 0, 0, Math.sin(a), 0, Math.cos(a), 0, 0, 0, 0, 1]);
const translation = (x: number, y: number, z: number): Mat4 => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
const orthographic = (extent: number, near: number, far: number): Mat4 => new Float32Array([1 / extent, 0, 0, 0, 0, 1 / extent, 0, 0, 0, 0, -2 / (far - near), 0, 0, 0, -(far + near) / (far - near), 1]);
/** A view matrix looking from `eye` at the origin. */
function lookAtOrigin(eye: Vec3): Mat4 {
  const length = Math.hypot(...eye), z: Vec3 = [eye[0] / length, eye[1] / length, eye[2] / length];
  const xRaw: Vec3 = [z[2], 0, -z[0]], xLength = Math.hypot(...xRaw) || 1, x: Vec3 = [xRaw[0] / xLength, 0, xRaw[2] / xLength];
  const y: Vec3 = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]), -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]), -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]), 1]);
}
/** The key light, fixed to the camera like a studio softbox (matches the first light in the fragment shader). */
const KEY_LIGHT: Vec3 = (() => { const l = Math.hypot(.5, .72, .62); return [.5 / l, .72 / l, .62 / l]; })();
const SHADOW_SIZE = 2048;
/** Fixed attribute locations, so the depth pass can draw the main program's vertex arrays. */
const LOCATIONS: Record<string, number> = { aPosition: 0, aNormal: 1, aPartUV: 2, aBaseUV: 3, aAO: 4, aDetail: 5, aRest: 6 };

/** Shader material per finish: sheen, wrapped diffuse, specular scale, studio reflection. */
const FINISH: Record<Finish, { id: number; material: [number, number, number, number] }> = {
  jersey: { id: 0, material: [.22, .3, .25, 0] },
  fleece: { id: 1, material: [.4, .42, .12, 0] },
  knit: { id: 2, material: [.3, .4, .12, 0] },
  twill: { id: 3, material: [.18, .22, .3, 0] },
  canvas: { id: 4, material: [.1, .25, .2, 0] },
  ceramic: { id: 5, material: [0, 0, 1, 1] },
  metal: { id: 6, material: [0, 0, 1, 1] },
  paper: { id: 7, material: [.12, .15, .3, .04] },
  card: { id: 8, material: [.1, .1, .45, .12] },
  standard: { id: 9, material: [.05, .05, .6, .35] },
};

function compile(gl: WebGL2RenderingContext, vertex: string, fragment: string, locations: Record<string, number> = {}): WebGLProgram {
  const program = gl.createProgram()!;
  for (const [name, location] of Object.entries(locations)) gl.bindAttribLocation(program, location, name);
  for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new EditorError('webgl-unavailable', `3D shader failed: ${gl.getShaderInfoLog(shader)}`);
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) throw new EditorError('webgl-unavailable', '3D shader program failed to link.');
  return program;
}

export async function loadModelGeometry(model: Model3D, signal?: AbortSignal): Promise<ModelGeometry> {
  if (model.kind === 'preset') return buildPreset(model);
  const response = await fetch(model.src!, { signal, credentials: 'omit' }).catch(error => {
    if (signal?.aborted) throw error;
    throw new EditorError('model-load', 'The 3D model could not be loaded. Check its URL and CORS settings.');
  });
  if (!response.ok) throw new EditorError('model-load', 'The 3D model could not be loaded. Check its URL and CORS settings.');
  const declared = Number(response.headers.get('content-length'));
  if (declared > MAX_MODEL_BYTES) throw new EditorError('model-too-large', 'Choose a 3D model smaller than 15 MB.');
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_MODEL_BYTES) throw new EditorError('model-too-large', 'Choose a 3D model smaller than 15 MB.');
  return { ...parseGlb(buffer), partSizes: {}, facing: {} };
}

export async function createViewer(canvas: HTMLCanvasElement, options: ViewerOptions = {}): Promise<Viewer> {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: false });
  if (!gl) throw new EditorError('webgl-unavailable', '3D preview isn’t available on this device.');
  const events = new AbortController();
  const signal = events.signal;
  const program = compile(gl, VERTEX, FRAGMENT, LOCATIONS);
  const depthProgram = compile(gl, DEPTH_VERTEX, DEPTH_FRAGMENT, { aPosition: 0 });
  const shadowProgram = compile(gl, FLOOR_VERTEX, FLOOR_FRAGMENT, { aCorner: 0 });
  const u = (name: string) => gl.getUniformLocation(program, name);
  const uniforms = {
    model: u('uModel'), viewProjection: u('uViewProjection'), color: u('uColor'), hasBase: u('uHasBase'), base: u('uBase'), prints: u('uPrints'),
    print: [u('uPrint0'), u('uPrint1'), u('uPrint2'), u('uPrint3')], rect: u('uRect'), camera: u('uCamera'), roughness: u('uRoughness'),
    finish: u('uFinish'), material: u('uMaterial'), partSize: u('uPartSize'),
    light: u('uLight'), lightDir: u('uLightDir'), normalOffset: u('uNormalOffset'), shadowMap: u('uShadowMap'), shadowTexel: u('uShadowTexel'), shadowStrength: u('uShadowStrength'), depthTexel: u('uDepthTexel'),
  };
  const depthUniforms = { model: gl.getUniformLocation(depthProgram, 'uModel'), light: gl.getUniformLocation(depthProgram, 'uLight') };
  const f = (name: string) => gl.getUniformLocation(shadowProgram, name);
  const shadowUniforms = {
    model: f('uModel'), viewProjection: f('uViewProjection'), floor: f('uFloor'), stretch: f('uStretch'), strength: f('uStrength'),
    light: f('uLight'), cast: f('uCast'), shadowMap: f('uShadowMap'), shadowTexel: f('uShadowTexel'),
  };
  // Shadow map: depth from the key light, compared in the shader for soft shadows.
  const shadowMap = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, shadowMap);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, SHADOW_SIZE, SHADOW_SIZE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
  const shadowFramebuffer = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFramebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, shadowMap, 0);
  gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
  // Without a usable depth target the viewer still works, just without cast shadows.
  const shadowsReady = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const anisotropy = gl.getExtension('EXT_texture_filter_anisotropic');
  const shadowVao = gl.createVertexArray()!;
  gl.bindVertexArray(shadowVao);
  const shadowBuffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, shadowBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  interface GpuPart {
    part: MeshPart; vao: WebGLVertexArrayObject; buffers: WebGLBuffer[]; position: WebGLBuffer; normal: WebGLBuffer; count: number;
    layers: Array<{ surfaceId: string; rect: [number, number, number, number] }>;
    /** Deformed copies while the soft body moves. */
    live: { positions: Float32Array; normals: Float32Array } | null;
  }
  let parts: GpuPart[] = [];
  let baseTextures: WebGLTexture[] = [];
  const prints = new Map<string, WebGLTexture>();
  let geometry: ModelGeometry | null = null;
  let center: Vec3 = [0, 0, 0], radius = 1, floorY = 0, footprint: [number, number] = [1, 1];
  let width = 1, height = 1;
  let homePitch = .2;
  let yaw = 0, pitch = homePitch, zoomFactor = 1;
  let velocity = 0, autoRotate = false, frame = 0, last = 0, lost = false, disposed = false;
  let tween: { from: [number, number, number]; to: [number, number, number]; start: number; duration: number } | null = null;
  let homeYaw = 0;
  let tool: 'orbit' | 'pull' = 'orbit';
  let soft: SoftBody | null = null, softness = 0, deformable = false, deformed = false, softTimer = 0;
  const empty = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, empty);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));

  const texture = (source: TexImageSource, existing?: WebGLTexture) => {
    const tex = existing ?? gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (anisotropy) gl.texParameterf(gl.TEXTURE_2D, anisotropy.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    return tex;
  };
  const releaseGeometry = () => {
    for (const p of parts) { gl.deleteVertexArray(p.vao); for (const buffer of p.buffers) gl.deleteBuffer(buffer); }
    for (const tex of baseTextures) gl.deleteTexture(tex);
    parts = []; baseTextures = [];
    soft = null; deformed = false; clearTimeout(softTimer);
  };
  const upload = (part: MeshPart, dynamic: boolean): GpuPart => {
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buffers: WebGLBuffer[] = [];
    const attribute = (name: string, data: Float32Array, size: number, usage: number = gl.STATIC_DRAW, existing?: WebGLBuffer) => {
      const location = LOCATIONS[name];
      const buffer = existing ?? gl.createBuffer()!;
      if (!existing) { buffers.push(buffer); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, data, usage); }
      else gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      if (location >= 0) { gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0); }
      return buffer;
    };
    const position = attribute('aPosition', part.positions, 3, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
    const normal = attribute('aNormal', part.normals, 3, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
    // The rest position keeps fabric texture attached to the cloth while it deforms.
    if (dynamic) attribute('aRest', part.positions, 3); else attribute('aRest', part.positions, 3, gl.STATIC_DRAW, position);
    attribute('aPartUV', part.partUV, 2); attribute('aBaseUV', part.baseUV ?? part.partUV, 2);
    if (part.ao) attribute('aAO', part.ao, 2);
    if (part.detail) attribute('aDetail', part.detail, 4);
    const indexBuffer = gl.createBuffer()!; buffers.push(indexBuffer);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, part.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { part, vao, buffers, position, normal, count: part.indices.length, layers: [], live: null };
  };

  const angleOf = (surfaceId: string): number | null => {
    if (!geometry || !current) return null;
    const binding = current.model.bindings.find(b => b.surfaceId === surfaceId);
    if (!binding) return null;
    // The mug wrap starts at the handle, so the facing angle follows the print's horizontal center.
    // A slight turn shows the handle in three-quarter view.
    if (current.model.kind === 'preset' && current.model.preset === 'mug') return -(Math.PI / 2 + binding.x * Math.PI * 2) - .3;
    return geometry.facing[binding.part] ?? null;
  };
  let current: { model: Model3D; surfaces: PrintSurface[] } | null = null;
  const place = (model: Model3D, surfaces: PrintSurface[]) => {
    current = { model, surfaces };
    for (const gpu of parts) {
      gpu.layers = gpu.part.printable && geometry ? model.bindings.filter(b => b.part === gpu.part.name).slice(0, 4).flatMap(b => {
        const surface = surfaces.find(s => s.id === b.surfaceId);
        return surface ? [{ surfaceId: b.surfaceId, rect: printRect(model, b, surface, geometry!) }] : [];
      }) : [];
    }
  };

  // Soft body: created shortly after load (or on first use) for soft presets only.
  const ensureSoft = (): SoftBody | null => {
    if (!deformable || !geometry) return null;
    soft ??= createSoftBody(geometry.parts, { softness, pin: geometry.pin });
    return soft;
  };
  const writeShape = (live: boolean) => {
    for (let i = 0; i < parts.length; i++) {
      const gpu = parts[i];
      if (live) {
        gpu.live ??= { positions: new Float32Array(gpu.part.positions.length), normals: new Float32Array(gpu.part.normals.length) };
        soft!.deform(i, gpu.live.positions, gpu.live.normals);
      } else gpu.live = null;
      const positions = gpu.live?.positions ?? gpu.part.positions, normals = gpu.live?.normals ?? gpu.part.normals;
      gl.bindBuffer(gl.ARRAY_BUFFER, gpu.position); gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions);
      gl.bindBuffer(gl.ARRAY_BUFFER, gpu.normal); gl.bufferSubData(gl.ARRAY_BUFFER, 0, normals);
    }
    deformed = live;
  };

  const requestRender = () => { if (!frame && !disposed) frame = requestAnimationFrame(tick); };
  let lastYaw = 0;
  const tick = (time: number) => {
    frame = 0;
    const dt = last ? Math.min(.05, (time - last) / 1000) : 1 / 60;
    last = time;
    let animating = false, userTurn = false;
    if (tween) {
      const k = Math.min(1, (time - tween.start) / tween.duration), e = 1 - (1 - k) ** 3;
      yaw = tween.from[0] + (tween.to[0] - tween.from[0]) * e; pitch = tween.from[1] + (tween.to[1] - tween.from[1]) * e; zoomFactor = tween.from[2] + (tween.to[2] - tween.from[2]) * e;
      if (k >= 1) tween = null; else animating = true;
    } else if (Math.abs(velocity) > .0004 && !drag) { yaw += velocity; velocity *= .93; animating = true; userTurn = true; }
    else if (autoRotate && !drag && !pulling) { yaw += dt * .45; animating = true; }
    if (drag) userTurn = true;
    // Loose fabric lags when the shopper spins the product.
    if (userTurn && !options.reducedMotion && Math.abs(yaw - lastYaw) > 1e-4) ensureSoft()?.sway(yaw - lastYaw, center);
    lastYaw = yaw;
    if (soft?.moving) {
      const still = !soft.step();
      writeShape(!still);
      animating = true;
    } else if (deformed) writeShape(false);
    draw();
    if (animating) requestRender(); else last = 0;
  };
  const camera = () => {
    const fov = .5;
    const aspect = width / Math.max(1, height);
    // Fit the whole model at every aspect ratio.
    const distance = radius / Math.sin(fov / 2) * Math.max(1, 1.05 / Math.min(1, aspect)) * 1.04;
    const eye = distance * zoomFactor;
    const viewProjection = multiply(perspective(fov, aspect, eye * .05, eye * 4), translation(0, 0, -eye));
    const model = multiply(rotationX(pitch), multiply(rotationY(yaw), translation(-center[0], -center[1], -center[2])));
    return { fov, aspect, eye, viewProjection, model };
  };
  const draw = () => {
    if (lost || disposed) return;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!geometry) return;
    const { eye, viewProjection, model } = camera();
    gl.disable(gl.CULL_FACE);
    // The key light is fixed to the camera, so its shadows are re-rendered whenever the model turns.
    const extent = radius * 1.7;
    const light = multiply(orthographic(extent, radius * .5, radius * 6.5), lookAtOrigin([KEY_LIGHT[0] * radius * 3, KEY_LIGHT[1] * radius * 3, KEY_LIGHT[2] * radius * 3]));
    if (shadowsReady) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFramebuffer);
      gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE);
      gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1.5, 3);
      gl.useProgram(depthProgram);
      gl.uniformMatrix4fv(depthUniforms.model, false, model);
      gl.uniformMatrix4fv(depthUniforms.light, false, light);
      for (const gpu of parts) { gl.bindVertexArray(gpu.vao); gl.drawElements(gl.TRIANGLES, gpu.count, gl.UNSIGNED_INT, 0); }
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, shadowMap);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(shadowProgram);
    gl.uniformMatrix4fv(shadowUniforms.model, false, model);
    gl.uniformMatrix4fv(shadowUniforms.viewProjection, false, viewProjection);
    gl.uniformMatrix4fv(shadowUniforms.light, false, light);
    gl.uniform4f(shadowUniforms.floor, center[0], floorY - radius * .004, center[2], radius);
    gl.uniform2f(shadowUniforms.stretch, footprint[0], footprint[1]);
    gl.uniform1f(shadowUniforms.strength, .3);
    gl.uniform1f(shadowUniforms.cast, shadowsReady ? .13 : 0);
    gl.uniform1i(shadowUniforms.shadowMap, 5);
    gl.uniform1f(shadowUniforms.shadowTexel, 1 / SHADOW_SIZE);
    gl.depthMask(false); gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(shadowVao); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.depthMask(true); gl.enable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.useProgram(program);
    gl.uniformMatrix4fv(uniforms.model, false, model);
    gl.uniformMatrix4fv(uniforms.viewProjection, false, viewProjection);
    gl.uniform3f(uniforms.camera, 0, 0, eye);
    gl.uniformMatrix4fv(uniforms.light, false, light);
    gl.uniform3f(uniforms.lightDir, ...KEY_LIGHT);
    gl.uniform1f(uniforms.normalOffset, extent * 2 / SHADOW_SIZE * 1.6);
    gl.uniform1i(uniforms.shadowMap, 5);
    gl.uniform1f(uniforms.shadowTexel, 1 / SHADOW_SIZE);
    gl.uniform1f(uniforms.shadowStrength, shadowsReady ? .88 : 0);
    // One shadow-map texel, in the depth range of the light's projection.
    gl.uniform1f(uniforms.depthTexel, extent * 2 / SHADOW_SIZE / (radius * 6));
    for (const gpu of parts) {
      const { part } = gpu, finish = FINISH[part.finish] ?? FINISH.standard;
      gl.uniform3f(uniforms.color, ...part.color);
      gl.uniform1f(uniforms.roughness, part.roughness); gl.uniform1i(uniforms.finish, finish.id); gl.uniform4f(uniforms.material, ...finish.material);
      const size = geometry.partSizes[part.name];
      gl.uniform2f(uniforms.partSize, size?.width ?? 0, size?.height ?? 0);
      // Parts without baked data read these constant values.
      gl.vertexAttrib2f(LOCATIONS.aAO, 1, 1);
      gl.vertexAttrib4f(LOCATIONS.aDetail, 0, 0, 1000, -1);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, part.image !== undefined ? baseTextures[part.image] ?? empty : empty);
      gl.uniform1i(uniforms.base, 0); gl.uniform1i(uniforms.hasBase, part.image !== undefined && !!baseTextures[part.image] ? 1 : 0);
      const layers = gpu.layers.filter(layer => prints.has(layer.surfaceId));
      const rects = new Float32Array(16);
      layers.forEach((layer, i) => {
        gl.activeTexture(gl.TEXTURE1 + i); gl.bindTexture(gl.TEXTURE_2D, prints.get(layer.surfaceId)!);
        gl.uniform1i(uniforms.print[i], 1 + i);
        rects.set(layer.rect, i * 4);
      });
      for (let i = layers.length; i < 4; i++) { gl.activeTexture(gl.TEXTURE1 + i); gl.bindTexture(gl.TEXTURE_2D, empty); gl.uniform1i(uniforms.print[i], 1 + i); }
      gl.uniform4fv(uniforms.rect, rects);
      gl.uniform1i(uniforms.prints, layers.length);
      gl.bindVertexArray(gpu.vao);
      gl.drawElements(gl.TRIANGLES, gpu.count, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);
  };

  // Model-space rays for picking and pulling.
  const toModel = (v: Vec3, point: boolean): Vec3 => {
    const cx = Math.cos(-pitch), sx = Math.sin(-pitch), cy = Math.cos(-yaw), sy = Math.sin(-yaw);
    const y1 = cx * v[1] - sx * v[2], z1 = sx * v[1] + cx * v[2];
    const x2 = cy * v[0] + sy * z1, z2 = -sy * v[0] + cy * z1;
    return point ? [x2 + center[0], y1 + center[1], z2 + center[2]] : [x2, y1, z2];
  };
  const rayAt = (clientX: number, clientY: number) => {
    const box = canvas.getBoundingClientRect(), { fov, aspect, eye } = camera(), f = Math.tan(fov / 2);
    const nx = (clientX - box.left) / Math.max(1, box.width) * 2 - 1, ny = 1 - (clientY - box.top) / Math.max(1, box.height) * 2;
    return { origin: toModel([0, 0, eye], true), direction: toModel([nx * aspect * f, ny * f, -1], false) };
  };
  const pick = (clientX: number, clientY: number) => {
    const { origin: o, direction: d } = rayAt(clientX, clientY);
    let best: { part: number; t: number; a: number; b: number; c: number; u: number; v: number } | null = null;
    for (let index = 0; index < parts.length; index++) {
      const gpu = parts[index], pos = gpu.live?.positions ?? gpu.part.positions, ids = gpu.part.indices;
      for (let i = 0; i < ids.length; i += 3) {
        const a = ids[i] * 3, b = ids[i + 1] * 3, c = ids[i + 2] * 3;
        const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2];
        const e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2];
        const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-9) continue;
        const inv = 1 / det, tx = o[0] - pos[a], ty = o[1] - pos[a + 1], tz = o[2] - pos[a + 2];
        const uu = (tx * px + ty * py + tz * pz) * inv;
        if (uu < 0 || uu > 1) continue;
        const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
        const vv = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
        if (vv < 0 || uu + vv > 1) continue;
        const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (t > 0 && (!best || t < best.t)) best = { part: index, t, a: ids[i], b: ids[i + 1], c: ids[i + 2], u: uu, v: vv };
      }
    }
    if (!best) return null;
    const hit = best;
    const restPositions = parts[hit.part].part.positions, w = 1 - hit.u - hit.v;
    const rest: Vec3 = [0, 1, 2].map(k => restPositions[hit.a * 3 + k] * w + restPositions[hit.b * 3 + k] * hit.u + restPositions[hit.c * 3 + k] * hit.v) as Vec3;
    const point: Vec3 = [o[0] + d[0] * hit.t, o[1] + d[1] * hit.t, o[2] + d[2] * hit.t];
    return { part: hit.part, rest, point };
  };

  // Turntable controls: drag rotates (or pulls fabric with the pull tool), Ctrl/⌘ + wheel or pinch zooms, keys rotate in steps, double-click resets.
  let drag: { id: number; x: number; y: number; time: number } | null = null;
  let pulling: { id: number; point: Vec3; normal: Vec3 } | null = null;
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch = 0;
  const clampPitch = (value: number) => Math.max(-.6, Math.min(.85, value));
  const endPull = () => { if (pulling) { soft?.release(); pulling = null; requestRender(); } };
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    tween = null; velocity = 0;
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); drag = null; endPull(); return; }
    try { canvas.setPointerCapture(event.pointerId); } catch { /* synthetic pointers cannot be captured */ }
    canvas.focus({ preventScroll: true });
    event.preventDefault();
    if (tool === 'pull' && deformable) {
      const hit = pick(event.clientX, event.clientY);
      const body = hit ? ensureSoft() : null;
      if (hit && body?.grab(hit.part, hit.rest, hit.point)) {
        pulling = { id: event.pointerId, point: hit.point, normal: toModel([0, 0, 1], false) };
        requestRender();
        return;
      }
    }
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, time: performance.now() };
  }, { signal });
  canvas.addEventListener('pointermove', event => {
    if (pointers.has(event.pointerId)) pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()], next = Math.hypot(a.x - b.x, a.y - b.y);
      if (next > 0) { zoomFactor = Math.max(.45, Math.min(2.4, zoomFactor * pinch / next)); pinch = next; requestRender(); }
      return;
    }
    if (pulling?.id === event.pointerId) {
      // Follow the pointer on a plane through the grabbed point that faces the camera.
      const { origin, direction } = rayAt(event.clientX, event.clientY), n = pulling.normal;
      const denominator = direction[0] * n[0] + direction[1] * n[1] + direction[2] * n[2];
      if (Math.abs(denominator) > 1e-6) {
        const t = ((pulling.point[0] - origin[0]) * n[0] + (pulling.point[1] - origin[1]) * n[1] + (pulling.point[2] - origin[2]) * n[2]) / denominator;
        soft?.drag([origin[0] + direction[0] * t, origin[1] + direction[1] * t, origin[2] + direction[2] * t]);
        requestRender();
      }
      return;
    }
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y, now = performance.now();
    yaw += dx * .0095; pitch = clampPitch(pitch + dy * .007);
    velocity = dx * .0095 * Math.min(1, 16 / Math.max(1, now - drag.time));
    drag = { ...drag, x: event.clientX, y: event.clientY, time: now };
    requestRender();
  }, { signal });
  const release = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = 0;
    if (pulling?.id === event.pointerId) endPull();
    if (drag?.id === event.pointerId) { drag = null; if (options.reducedMotion) velocity = 0; requestRender(); }
  };
  canvas.addEventListener('pointerup', release, { signal });
  canvas.addEventListener('pointercancel', release, { signal });
  canvas.addEventListener('dblclick', () => { if (tool === 'orbit') viewer.reset(); }, { signal });
  canvas.addEventListener('wheel', event => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    zoomFactor = Math.max(.45, Math.min(2.4, zoomFactor * Math.exp(event.deltaY * .0022)));
    requestRender();
  }, { signal, passive: false });
  canvas.addEventListener('keydown', event => {
    const steps: Record<string, () => void> = {
      ArrowLeft: () => { yaw -= Math.PI / 12; }, ArrowRight: () => { yaw += Math.PI / 12; },
      ArrowUp: () => { pitch = clampPitch(pitch - .14); }, ArrowDown: () => { pitch = clampPitch(pitch + .14); },
      '+': () => viewer.zoom(1 / 1.2), '=': () => viewer.zoom(1 / 1.2), '-': () => viewer.zoom(1.2), Home: () => viewer.reset(), '0': () => viewer.reset(),
    };
    const step = steps[event.key];
    if (!step || event.altKey) return;
    event.preventDefault(); event.stopPropagation();
    const before = yaw;
    tween = null; step();
    // Keyboard turns sway loose fabric as well.
    if (yaw !== before && !options.reducedMotion) ensureSoft()?.sway((yaw - before) * .35, center);
    lastYaw = yaw;
    requestRender();
  }, { signal });
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); lost = true; options.onContextLost?.(); }, { signal });

  const project = (p: Vec3, viewProjection: Mat4, model: Mat4): [number, number] => {
    const m = multiply(viewProjection, model);
    const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    return [(x / w * .5 + .5) * width, (1 - (y / w * .5 + .5)) * height];
  };
  /** The model-space point at part coordinates (u, v), found by locating the containing triangle in part space. */
  const pointAt = (part: MeshPart, u: number, v: number): Vec3 | null => {
    const uv = part.partUV, pos = part.positions, ids = part.indices;
    for (let i = 0; i < ids.length; i += 3) {
      const a = ids[i], b = ids[i + 1], c = ids[i + 2];
      const x0 = uv[a * 2], y0 = uv[a * 2 + 1], x1 = uv[b * 2], y1 = uv[b * 2 + 1], x2 = uv[c * 2], y2 = uv[c * 2 + 1];
      const det = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
      if (Math.abs(det) < 1e-12) continue;
      const l0 = ((y1 - y2) * (u - x2) + (x2 - x1) * (v - y2)) / det, l1 = ((y2 - y0) * (u - x2) + (x0 - x2) * (v - y2)) / det, l2 = 1 - l0 - l1;
      if (l0 < -1e-6 || l1 < -1e-6 || l2 < -1e-6) continue;
      return [0, 1, 2].map(k => pos[a * 3 + k] * l0 + pos[b * 3 + k] * l1 + pos[c * 3 + k] * l2) as Vec3;
    }
    return null;
  };

  const viewer: Viewer = {
    async load(model, surfaces, abort) {
      const next = await loadModelGeometry(model, abort);
      if (disposed) return;
      const images = await Promise.all(next.images.map(async image => {
        try { return await createImageBitmap(new Blob([image.bytes as BlobPart], { type: image.mime }), { imageOrientation: 'none', premultiplyAlpha: 'none' }); }
        catch { return null; }
      }));
      if (disposed) { for (const image of images) image?.close(); return; }
      releaseGeometry();
      geometry = next;
      softness = model.kind === 'preset' ? model.softness ?? next.softness ?? 0 : 0;
      deformable = model.kind === 'preset' && softness > 0 && !!next.pin;
      baseTextures = images.map(image => { const tex = image && image.width <= 8192 && image.height <= 8192 ? texture(image) : empty; image?.close(); return tex; });
      parts = next.parts.map(part => upload(part, deformable));
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (const part of next.parts) for (let i = 0; i < part.positions.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], part.positions[i + k]); max[k] = Math.max(max[k], part.positions[i + k]); }
      center = [0, 1, 2].map(k => (min[k] + max[k]) / 2) as Vec3;
      radius = Math.max(1e-6, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2);
      floorY = min[1];
      footprint = [Math.max(.25, (max[0] - min[0]) / radius * .62), Math.max(.2, (max[2] - min[2]) / radius * .62)];
      homePitch = next.pitch ?? .22;
      place(model, surfaces);
      const first = model.bindings[0] ? angleOf(model.bindings[0].surfaceId) : null;
      homeYaw = first ?? 0;
      yaw = homeYaw - .5; pitch = homePitch; zoomFactor = 1;
      tween = options.reducedMotion ? null : { from: [yaw, pitch, zoomFactor], to: [homeYaw, homePitch, 1], start: performance.now(), duration: 900 };
      if (!tween) yaw = homeYaw;
      lastYaw = yaw;
      // Prepare the soft body off the critical path so the first pull responds at once.
      if (deformable) softTimer = window.setTimeout(() => { if (!disposed) ensureSoft(); }, 600);
      requestRender();
    },
    setPlacement(model, surfaces) {
      place(model, surfaces);
      if (model.kind === 'preset' && deformable && model.softness !== undefined && model.softness !== softness) viewer.setSoftness(model.softness);
      requestRender();
    },
    setPrint(surfaceId, source) {
      const existing = prints.get(surfaceId);
      if (!source) { if (existing) { gl.deleteTexture(existing); prints.delete(surfaceId); } }
      else prints.set(surfaceId, texture(source, existing));
      requestRender();
    },
    printableParts() { return geometry ? [...new Set(geometry.parts.filter(p => p.printable).map(p => p.name))] : []; },
    focus(surfaceId) {
      const target = angleOf(surfaceId);
      if (target === null) return;
      // Turn the shortest way round.
      const to = yaw + ((((target - yaw) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
      velocity = 0;
      if (options.reducedMotion) { yaw = to; pitch = homePitch; lastYaw = yaw; requestRender(); return; }
      tween = { from: [yaw, pitch, zoomFactor], to: [to, homePitch, zoomFactor], start: performance.now(), duration: 650 };
      requestRender();
    },
    reset() {
      velocity = 0;
      const to = yaw + ((((homeYaw - yaw) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
      if (options.reducedMotion) { yaw = to; pitch = homePitch; zoomFactor = 1; lastYaw = yaw; requestRender(); return; }
      tween = { from: [yaw, pitch, zoomFactor], to: [to, homePitch, 1], start: performance.now(), duration: 600 };
      requestRender();
    },
    zoom(factor) { zoomFactor = Math.max(.45, Math.min(2.4, zoomFactor * factor)); requestRender(); },
    setAutoRotate(on) { autoRotate = on; requestRender(); },
    setTool(next) {
      tool = next === 'pull' && deformable ? 'pull' : 'orbit';
      canvas.dataset.mdtTool = tool;
      if (tool === 'pull') { velocity = 0; ensureSoft(); }
      else endPull();
    },
    get deformable() { return deformable; },
    get softness() { return softness; },
    setSoftness(value) {
      if (!deformable) return;
      softness = Math.max(.05, Math.min(1, value));
      soft?.setSoftness(softness);
      // A small nudge shows the new stiffness, also for keyboard users.
      if (!options.reducedMotion) { ensureSoft()?.sway(.06, center); requestRender(); }
    },
    resetShape() { soft?.reset(); if (deformed) writeShape(false); requestRender(); },
    resize(nextWidth, nextHeight, pixelRatio) {
      width = Math.max(1, nextWidth); height = Math.max(1, nextHeight);
      let ratio = Math.min(2, pixelRatio);
      if (width * height * ratio * ratio > 6_000_000) ratio = Math.sqrt(6_000_000 / (width * height));
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
      draw();
    },
    snapshot() {
      // Read the frame in the same task it was drawn, before the browser may discard it.
      draw();
      return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new EditorError('export-failed', 'PNG export failed. Try a smaller output.')), 'image/png'));
    },
    still(part, stillWidth, stillHeight, background = ['#f3f2ee', '#e4e3de']) {
      const saved = { width, height, canvasWidth: canvas.width, canvasHeight: canvas.height, yaw, pitch, zoomFactor, tween };
      const binding = current?.model.bindings.find(b => b.part === part);
      tween = null;
      yaw = (binding ? angleOf(binding.surfaceId) : null) ?? geometry?.facing[part] ?? 0;
      pitch = Math.max(.04, Math.min(.26, homePitch * .6)); zoomFactor = .86;
      width = stillWidth; height = stillHeight; canvas.width = stillWidth; canvas.height = stillHeight;
      if (deformed) writeShape(false);
      draw();
      const image = document.createElement('canvas');
      image.width = stillWidth; image.height = stillHeight;
      const ctx = image.getContext('2d');
      if (!ctx) throw new EditorError('export-failed', 'This browser cannot create a 2D canvas.');
      const backdrop = ctx.createLinearGradient(0, 0, 0, stillHeight);
      backdrop.addColorStop(0, background[0]); backdrop.addColorStop(1, background[1]);
      ctx.fillStyle = backdrop; ctx.fillRect(0, 0, stillWidth, stillHeight);
      ctx.drawImage(canvas, 0, 0);
      // Where each print area lands: the box around its projected outline, turned with the area's projected up direction.
      const bindings: SurfaceBinding[] = [];
      const gpu = parts.find(p => p.part.name === part && p.part.printable);
      const { viewProjection, model } = camera();
      for (const layer of gpu?.layers ?? []) {
        const [left, top, w, h] = layer.rect, cx = left + w / 2, cy = top + h / 2;
        const center = pointAt(gpu!.part, cx, cy), up = pointAt(gpu!.part, cx, top + h * .25);
        if (!center || !up) continue;
        const c = project(center, viewProjection, model), t = project(up, viewProjection, model);
        let angle = Math.atan2(t[0] - c[0], -(t[1] - c[1]));
        // Perspective tilts of a few degrees would only look like mistakes on a flat photo.
        if (Math.abs(angle) < .05) angle = 0;
        const cos = Math.cos(-angle), sin = Math.sin(-angle);
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let i = 0; i <= 16; i++) {
          const k = i / 16;
          for (const [u, v] of [[left + w * k, top], [left + w * k, top + h], [left, top + h * k], [left + w, top + h * k]]) {
            const point = pointAt(gpu!.part, u, v);
            if (!point) continue;
            const [px, py] = project(point, viewProjection, model), dx = px - c[0], dy = py - c[1];
            const rx = dx * cos - dy * sin, ry = dx * sin + dy * cos;
            minX = Math.min(minX, rx); maxX = Math.max(maxX, rx); minY = Math.min(minY, ry); maxY = Math.max(maxY, ry);
          }
        }
        if (!Number.isFinite(minX)) continue;
        const mx = (minX + maxX) / 2, my = (minY + maxY) / 2;
        const centerX = c[0] + mx * Math.cos(angle) - my * Math.sin(angle), centerY = c[1] + mx * Math.sin(angle) + my * Math.cos(angle);
        const boxWidth = maxX - minX, boxHeight = maxY - minY;
        // Keep the placement inside the photo, as templates require.
        const x = Math.max(0, (centerX - boxWidth / 2) / stillWidth), y = Math.max(0, (centerY - boxHeight / 2) / stillHeight);
        const fitWidth = Math.min(boxWidth / stillWidth, 1 - x), fitHeight = Math.min(boxHeight / stillHeight, 1 - y);
        if (fitWidth > .002 && fitHeight > .002) bindings.push({ surfaceId: layer.surfaceId, x, y, width: fitWidth, height: fitHeight, rotation: Math.round(angle * 1800 / Math.PI) / 10 });
      }
      ({ width, height, yaw, pitch, zoomFactor, tween } = saved);
      canvas.width = saved.canvasWidth; canvas.height = saved.canvasHeight;
      requestRender();
      return { image, bindings };
    },
    dispose() {
      if (disposed) return;
      disposed = true; cancelAnimationFrame(frame); events.abort();
      releaseGeometry();
      for (const tex of prints.values()) gl.deleteTexture(tex);
      prints.clear();
      gl.deleteTexture(empty); gl.deleteBuffer(shadowBuffer); gl.deleteVertexArray(shadowVao);
      gl.deleteProgram(program); gl.deleteProgram(shadowProgram); gl.deleteProgram(depthProgram);
      gl.deleteFramebuffer(shadowFramebuffer); gl.deleteTexture(shadowMap);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      canvas.width = canvas.height = 1;
    },
  };
  if (options.label) canvas.setAttribute('aria-label', options.label);
  canvas.dataset.mdtTool = tool;
  return viewer;
}

export interface ProductPhoto { part: string; image: HTMLCanvasElement; bindings: SurfaceBinding[] }
/**
 * Renders studio product photos from a 3D model, one per bound part (front, back, a sleeve, the mug wrap …),
 * with each print area's placement on the photo, so a template's 2D views can be created from its 3D model.
 * Requires WebGL2; throws `webgl-unavailable` otherwise.
 */
export async function renderProductPhotos(model: Model3D, surfaces: PrintSurface[], options: { width?: number; height?: number; background?: [string, string]; signal?: AbortSignal } = {}): Promise<ProductPhoto[]> {
  const canvas = document.createElement('canvas');
  const viewer = await createViewer(canvas, { reducedMotion: true });
  try {
    await viewer.load(model, surfaces, options.signal);
    const parts = [...new Set(model.bindings.filter(b => surfaces.some(s => s.id === b.surfaceId)).map(b => b.part))];
    return parts.map(part => ({ part, ...viewer.still(part, options.width ?? 900, options.height ?? 1000, options.background) }));
  } finally { viewer.dispose(); }
}
