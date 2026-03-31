import { vertexShaderSource, fragmentShaderSource } from './shaders.js';

export class ParticleSystem {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private particleCount: number = 0;
  private imageSize: number = 0;

  // Uniform locations
  private u_time: WebGLUniformLocation;
  private u_pointSize: WebGLUniformLocation;
  private u_scale: WebGLUniformLocation;
  private u_offset: WebGLUniformLocation;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL 2 not supported');
    this.gl = gl;

    // Compile shaders
    const vs = this.compileShader(gl.VERTEX_SHADER, vertexShaderSource);
    const fs = this.compileShader(gl.FRAGMENT_SHADER, fragmentShaderSource);

    // Link program
    this.program = gl.createProgram()!;
    gl.attachShader(this.program, vs);
    gl.attachShader(this.program, fs);
    gl.linkProgram(this.program);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      throw new Error('Program link failed: ' + gl.getProgramInfoLog(this.program));
    }

    gl.useProgram(this.program);

    // Get uniform locations
    this.u_time = gl.getUniformLocation(this.program, 'u_time')!;
    this.u_pointSize = gl.getUniformLocation(this.program, 'u_pointSize')!;
    this.u_scale = gl.getUniformLocation(this.program, 'u_scale')!;
    this.u_offset = gl.getUniformLocation(this.program, 'u_offset')!;

    // Create VAO
    this.vao = gl.createVertexArray()!;

    // Setup GL state
    gl.clearColor(0.04, 0.04, 0.04, 1.0);
    gl.disable(gl.DEPTH_TEST);
  }

  private compileShader(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error('Shader compile failed: ' + gl.getShaderInfoLog(shader));
    }
    return shader;
  }

  /**
   * Upload particle data to GPU.
   * @param sourceRGBA - Source image RGBA pixels
   * @param targetRGBA - Target image RGBA pixels
   * @param assignment - assignment[sourceIdx] = targetIdx
   * @param width - Image width
   * @param height - Image height
   * @param staggerAmount - Max stagger delay (0-1)
   * @param curvatureAmount - Bezier curvature magnitude
   */
  uploadParticles(
    sourceRGBA: Uint8ClampedArray | number[],
    targetRGBA: Uint8ClampedArray | number[],
    assignment: number[] | Uint32Array,
    width: number,
    height: number,
    staggerAmount: number = 0.3,
    curvatureAmount: number = 0.4
  ) {
    const gl = this.gl;
    this.particleCount = width * height;
    this.imageSize = width; // square image

    // Build interleaved vertex data:
    // [startX, startY, endX, endY, r, g, b, delay, curveX, curveY] per pixel
    // = 10 floats per particle
    const stride = 10;
    const data = new Float32Array(this.particleCount * stride);

    for (let i = 0; i < this.particleCount; i++) {
      const sx = (i % width) / width;
      const sy = Math.floor(i / width) / height;

      const ti = assignment[i];
      const tx = (ti % width) / width;
      const ty = Math.floor(ti / width) / height;

      // Color from source pixel (normalized to 0-1)
      const rgbaOffset = i * 4;
      const r = (sourceRGBA[rgbaOffset] ?? 0) / 255;
      const g = (sourceRGBA[rgbaOffset + 1] ?? 0) / 255;
      const b = (sourceRGBA[rgbaOffset + 2] ?? 0) / 255;

      // Random stagger delay
      const delay = Math.random() * staggerAmount;

      // Random perpendicular curvature
      const dx = tx - sx;
      const dy = ty - sy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const perpX = -dy;
      const perpY = dx;
      const curveMag = (Math.random() - 0.5) * 2 * curvatureAmount * dist;
      const curveX = perpX * curveMag;
      const curveY = perpY * curveMag;

      const offset = i * stride;
      data[offset] = sx;
      data[offset + 1] = sy;
      data[offset + 2] = tx;
      data[offset + 3] = ty;
      data[offset + 4] = r;
      data[offset + 5] = g;
      data[offset + 6] = b;
      data[offset + 7] = delay;
      data[offset + 8] = curveX;
      data[offset + 9] = curveY;
    }

    gl.bindVertexArray(this.vao);

    const buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);

    const FLOAT_SIZE = 4;
    const STRIDE = stride * FLOAT_SIZE;

    // a_startPos (location 0)
    const loc0 = gl.getAttribLocation(this.program, 'a_startPos');
    gl.enableVertexAttribArray(loc0);
    gl.vertexAttribPointer(loc0, 2, gl.FLOAT, false, STRIDE, 0);

    // a_endPos (location 1)
    const loc1 = gl.getAttribLocation(this.program, 'a_endPos');
    gl.enableVertexAttribArray(loc1);
    gl.vertexAttribPointer(loc1, 2, gl.FLOAT, false, STRIDE, 2 * FLOAT_SIZE);

    // a_color (location 2)
    const loc2 = gl.getAttribLocation(this.program, 'a_color');
    gl.enableVertexAttribArray(loc2);
    gl.vertexAttribPointer(loc2, 3, gl.FLOAT, false, STRIDE, 4 * FLOAT_SIZE);

    // a_delay (location 3)
    const loc3 = gl.getAttribLocation(this.program, 'a_delay');
    gl.enableVertexAttribArray(loc3);
    gl.vertexAttribPointer(loc3, 1, gl.FLOAT, false, STRIDE, 7 * FLOAT_SIZE);

    // a_curvature (location 4)
    const loc4 = gl.getAttribLocation(this.program, 'a_curvature');
    gl.enableVertexAttribArray(loc4);
    gl.vertexAttribPointer(loc4, 2, gl.FLOAT, false, STRIDE, 8 * FLOAT_SIZE);

    gl.bindVertexArray(null);
  }

  /**
   * Render a single frame at the given animation time.
   * @param time - Animation progress (0 = source positions, 1 = target positions)
   */
  render(time: number) {
    const gl = this.gl;

    // Resize canvas to match display size
    const dpr = window.devicePixelRatio || 1;
    const displayWidth = Math.floor(this.canvas.clientWidth * dpr);
    const displayHeight = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== displayWidth || this.canvas.height !== displayHeight) {
      this.canvas.width = displayWidth;
      this.canvas.height = displayHeight;
    }
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);

    gl.clear(gl.COLOR_BUFFER_BIT);

    if (this.particleCount === 0) return;

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    gl.uniform1f(this.u_time, time);

    // Fit square image into rectangular canvas (contain)
    const canvasAspect = displayWidth / displayHeight;
    let scaleX = 1.0, scaleY = 1.0;
    if (canvasAspect > 1) {
      // Canvas is wider than tall — fit to height, shrink X
      scaleX = 1.0 / canvasAspect;
    } else {
      // Canvas is taller than wide — fit to width, shrink Y
      scaleY = canvasAspect;
    }
    gl.uniform2f(this.u_scale, scaleX, scaleY);
    gl.uniform2f(this.u_offset, 0, 0); // centered since scale is symmetric

    // Point size: fitted dimension in pixels / image pixels
    const fittedPixels = Math.min(displayWidth, displayHeight);
    const pointSize = Math.max(1, Math.ceil(fittedPixels / this.imageSize));
    gl.uniform1f(this.u_pointSize, pointSize);

    gl.drawArrays(gl.POINTS, 0, this.particleCount);
    gl.bindVertexArray(null);
  }

  /** Clear the canvas without drawing any particles */
  clear() {
    const gl = this.gl;
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.particleCount = 0;
  }

  /** Get a screenshot of the current frame as a data URL */
  captureFrame(): string {
    return this.canvas.toDataURL('image/png');
  }

  destroy() {
    this.gl.deleteProgram(this.program);
    this.gl.deleteVertexArray(this.vao);
  }
}
