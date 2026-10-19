import { clamp, mat4Invert, mat4LookAt, mat4Mul, mat4PerspectiveReversed, transformPoint, Vec3, v3, Mat4 } from '../math';
import type { Input } from '../input/input';
import { WORLD_SIZE } from '../sim/params';

/**
 * Isometric-style camera: long focal length, fixed downward tilt, yaw snapped to quarter turns
 * (animated). Pan with right/middle drag or WASD/ZQSD, zoom with the wheel, Q/E (A/E on AZERTY) to rotate.
 * Gamepad: left stick pans, right stick flicked sideways rotates, pushed up / down zooms.
 */
export class IsoCamera {
  target: Vec3 = [WORLD_SIZE * 0.5, 0, WORLD_SIZE * 0.5];
  yawStep = 0; // quarter turns
  yaw = Math.PI * 0.25;
  pitch = (36 * Math.PI) / 180;
  distance = 36;
  fovy = (20 * Math.PI) / 180;
  near = 2;
  far = 1200;
  aspect = 1;

  view: Mat4 = new Float32Array(16);
  proj: Mat4 = new Float32Array(16);
  viewProj: Mat4 = new Float32Array(16);
  invViewProj: Mat4 = new Float32Array(16);
  position: Vec3 = [0, 0, 0];
  /** Right stick is held sideways (one quarter turn per flick). */
  private stickTurned = false;

  update(input: Input, dt: number): void {
    if (input.hit('KeyQ')) this.yawStep += 1;
    if (input.hit('KeyE')) this.yawStep -= 1;
    const [rx, ry] = input.stickR;
    if (!this.stickTurned && Math.abs(rx) > 0.7 && Math.abs(rx) > Math.abs(ry)) {
      this.yawStep -= Math.sign(rx);
      this.stickTurned = true;
    } else if (Math.abs(rx) < 0.3) this.stickTurned = false;
    const targetYaw = Math.PI * 0.25 + (this.yawStep * Math.PI) / 2;
    this.yaw += (targetYaw - this.yaw) * Math.min(1, dt * 8);

    if (input.right || input.middle) this.pan(input.dragX, input.dragY);
    if (input.wheel) this.distance = clamp(this.distance * Math.exp(input.wheel * 0.0012), 12, 110);
    if (ry && Math.abs(ry) > Math.abs(rx)) this.distance = clamp(this.distance * Math.exp(ry * dt * 1.5), 12, 110);

    const sp = this.distance * 0.45 * dt;
    const fw: Vec3 = [-Math.sin(this.yaw), 0, -Math.cos(this.yaw)];
    const rt: Vec3 = [Math.cos(this.yaw), 0, -Math.sin(this.yaw)];
    let mv: Vec3 = [0, 0, 0];
    if (input.down('KeyW') || input.down('ArrowUp')) mv = v3.add(mv, fw);
    if (input.down('KeyS') || input.down('ArrowDown')) mv = v3.sub(mv, fw);
    if (input.down('KeyD') || input.down('ArrowRight')) mv = v3.add(mv, rt);
    if (input.down('KeyA') || input.down('ArrowLeft')) mv = v3.sub(mv, rt);
    const [lx, ly] = input.stickL;
    mv = v3.add(mv, v3.add(v3.scale(rt, lx), v3.scale(fw, -ly)));
    this.target = v3.add(this.target, v3.scale(mv, sp));
    this.target[0] = clamp(this.target[0], -2, WORLD_SIZE + 2);
    this.target[2] = clamp(this.target[2], -2, WORLD_SIZE + 2);
    this.computeMatrices();
  }

  private pan(dx: number, dy: number): void {
    // Screen-space drag: the ground under the cursor follows the mouse.
    const s = (this.distance * Math.tan(this.fovy / 2) * 2) / Math.max(window.innerHeight, 1);
    const rt: Vec3 = [Math.cos(this.yaw), 0, -Math.sin(this.yaw)];
    const fw: Vec3 = [-Math.sin(this.yaw), 0, -Math.cos(this.yaw)];
    this.target = v3.add(this.target, v3.add(v3.scale(rt, -dx * s), v3.scale(fw, (dy * s) / Math.sin(this.pitch))));
  }

  computeMatrices(): void {
    const cp = Math.cos(this.pitch);
    const off: Vec3 = [Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp];
    this.position = v3.add(this.target, v3.scale(off, this.distance));
    this.view = mat4LookAt(this.position, this.target, [0, 1, 0]);
    this.proj = mat4PerspectiveReversed(this.fovy, this.aspect, this.near, this.far);
    this.viewProj = mat4Mul(this.proj, this.view);
    this.invViewProj = mat4Invert(this.viewProj);
  }

  /** World-space ray through a pixel (CSS pixels relative to the canvas). */
  ray(px: number, py: number, w: number, h: number): { origin: Vec3; dir: Vec3 } {
    const nx = (px / w) * 2 - 1;
    const ny = 1 - (py / h) * 2;
    const a = transformPoint(this.invViewProj, [nx, ny, 1]);
    const b = transformPoint(this.invViewProj, [nx, ny, 0.001]);
    return { origin: a, dir: v3.norm(v3.sub(b, a)) };
  }
}
