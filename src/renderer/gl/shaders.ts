export const vertexShaderSource = `#version 300 es
precision highp float;

in vec2 a_startPos;   // source image position (0-1)
in vec2 a_endPos;     // target image position (0-1)
in vec3 a_color;      // RGB color (0-1)
in float a_delay;     // stagger delay (0 - staggerAmount)
in vec2 a_curvature;  // bezier control point offset

uniform float u_time;       // animation progress (0.0 - 1.0)
uniform float u_pointSize;  // pixel size
uniform vec2 u_scale;       // aspect ratio correction (1.0 on the fitted axis, <1.0 on the other)
uniform vec2 u_offset;      // centering offset in clip space

out vec3 v_color;

// Cubic ease-in-out
float ease(float t) {
    return t < 0.5
        ? 4.0 * t * t * t
        : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0;
}

void main() {
    // Staggered timing
    float maxDelay = a_delay;
    float localTime = clamp((u_time - maxDelay) / (1.0 - maxDelay), 0.0, 1.0);
    float t = ease(localTime);

    // Quadratic Bezier interpolation
    vec2 control = mix(a_startPos, a_endPos, 0.5) + a_curvature;
    vec2 pos = (1.0 - t) * (1.0 - t) * a_startPos
             + 2.0 * (1.0 - t) * t * control
             + t * t * a_endPos;

    // Map to clip space, fitting square image into rectangular canvas
    vec2 clipPos = pos * 2.0 - 1.0;
    clipPos.y *= -1.0; // flip Y for image coordinates
    clipPos = clipPos * u_scale + u_offset;

    gl_Position = vec4(clipPos, 0.0, 1.0);
    gl_PointSize = u_pointSize;
    v_color = a_color;
}
`;

export const fragmentShaderSource = `#version 300 es
precision mediump float;

in vec3 v_color;
out vec4 fragColor;

void main() {
    fragColor = vec4(v_color, 1.0);
}
`;
