import { ParticleSystem } from './particle-system.js';

export type AnimationState = 'idle' | 'playing' | 'paused' | 'finished';

export class AnimationController {
  private state: AnimationState = 'idle';
  private startTime: number = 0;
  private pausedAt: number = 0;
  private rafId: number = 0;
  private currentTime: number = 0;

  constructor(
    private particles: ParticleSystem,
    private duration: number = 3.0,
    private onStateChange?: (state: AnimationState) => void,
    private onTimeUpdate?: (time: number) => void
  ) {}

  get animationState(): AnimationState {
    return this.state;
  }

  get progress(): number {
    return this.currentTime;
  }

  setDuration(d: number) {
    this.duration = d;
  }

  play() {
    if (this.state === 'playing') return;

    if (this.state === 'paused') {
      // Resume from paused position
      this.startTime = performance.now() - this.pausedAt * this.duration * 1000;
    } else {
      // Start from beginning
      this.startTime = performance.now();
    }

    this.state = 'playing';
    this.onStateChange?.(this.state);
    this.tick();
  }

  pause() {
    if (this.state !== 'playing') return;
    cancelAnimationFrame(this.rafId);
    this.pausedAt = this.currentTime;
    this.state = 'paused';
    this.onStateChange?.(this.state);
  }

  reset() {
    cancelAnimationFrame(this.rafId);
    this.currentTime = 0;
    this.pausedAt = 0;
    this.state = 'idle';
    this.particles.render(0);
    this.onStateChange?.(this.state);
    this.onTimeUpdate?.(0);
  }

  /** Jump to a specific time (0-1) */
  seek(t: number) {
    this.currentTime = Math.max(0, Math.min(1, t));
    this.particles.render(this.currentTime);
    this.onTimeUpdate?.(this.currentTime);

    if (this.state === 'playing') {
      this.startTime = performance.now() - this.currentTime * this.duration * 1000;
    } else {
      this.pausedAt = this.currentTime;
    }
  }

  /** Render a single frame at source positions (t=0) */
  renderSource() {
    this.currentTime = 0;
    this.state = 'idle';
    this.particles.render(0);
    this.onStateChange?.(this.state);
    this.onTimeUpdate?.(0);
  }

  /** Render a single frame at target positions (t=1) */
  renderTarget() {
    this.currentTime = 1;
    this.state = 'finished';
    this.particles.render(1);
    this.onStateChange?.(this.state);
    this.onTimeUpdate?.(1);
  }

  private tick = () => {
    const elapsed = (performance.now() - this.startTime) / 1000;
    this.currentTime = Math.min(1, elapsed / this.duration);

    this.particles.render(this.currentTime);
    this.onTimeUpdate?.(this.currentTime);

    if (this.currentTime >= 1) {
      this.state = 'finished';
      this.onStateChange?.(this.state);
      return;
    }

    this.rafId = requestAnimationFrame(this.tick);
  };

  destroy() {
    cancelAnimationFrame(this.rafId);
  }
}
