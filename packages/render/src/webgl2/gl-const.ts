/**
 * WebGL2 enum values (Khronos registry). Used instead of `gl.CONSTANT` lookups so the backend
 * works against recording fakes in Node tests and avoids property reads in hot paths.
 */
export const GL = {
  // data types
  BYTE: 0x1400,
  UNSIGNED_BYTE: 0x1401,
  SHORT: 0x1402,
  UNSIGNED_SHORT: 0x1403,
  INT: 0x1404,
  UNSIGNED_INT: 0x1405,
  FLOAT: 0x1406,
  HALF_FLOAT: 0x140b,

  // buffers
  ARRAY_BUFFER: 0x8892,
  ELEMENT_ARRAY_BUFFER: 0x8893,
  UNIFORM_BUFFER: 0x8a11,
  COPY_WRITE_BUFFER: 0x8f37,
  STATIC_DRAW: 0x88e4,
  DYNAMIC_DRAW: 0x88e8,

  // primitives
  POINTS: 0x0000,
  LINES: 0x0001,
  LINE_STRIP: 0x0003,
  TRIANGLES: 0x0004,
  TRIANGLE_STRIP: 0x0005,

  // shaders
  VERTEX_SHADER: 0x8b31,
  FRAGMENT_SHADER: 0x8b30,
  COMPILE_STATUS: 0x8b81,
  LINK_STATUS: 0x8b82,
  INVALID_INDEX: 0xffffffff,

  // state
  DEPTH_TEST: 0x0b71,
  CULL_FACE: 0x0b44,
  BLEND: 0x0be2,
  FRONT: 0x0404,
  BACK: 0x0405,
  CW: 0x0900,
  CCW: 0x0901,
  NEVER: 0x0200,
  LESS: 0x0201,
  EQUAL: 0x0202,
  LEQUAL: 0x0203,
  GREATER: 0x0204,
  GEQUAL: 0x0206,
  ALWAYS: 0x0207,
  ZERO: 0,
  ONE: 1,
  SRC_ALPHA: 0x0302,
  ONE_MINUS_SRC_ALPHA: 0x0303,
  FUNC_ADD: 0x8006,
  COLOR_BUFFER_BIT: 0x4000,
  DEPTH_BUFFER_BIT: 0x0100,

  // textures
  TEXTURE_2D: 0x0de1,
  TEXTURE0: 0x84c0,
  TEXTURE_MAG_FILTER: 0x2800,
  TEXTURE_MIN_FILTER: 0x2801,
  TEXTURE_WRAP_S: 0x2802,
  TEXTURE_WRAP_T: 0x2803,
  NEAREST: 0x2600,
  LINEAR: 0x2601,
  CLAMP_TO_EDGE: 0x812f,
  REPEAT: 0x2901,
  UNPACK_ALIGNMENT: 0x0cf5,
  RGBA: 0x1908,
  RED: 0x1903,
  RG: 0x8227,
  RED_INTEGER: 0x8d94,
  RGBA8: 0x8058,
  R8: 0x8229,
  RG8: 0x822b,
  R16UI: 0x8234,
  R32UI: 0x8236,
  R32F: 0x822e,
  RGBA16F: 0x881a,

  // queries / parameters
  NO_ERROR: 0,
  MAX_UNIFORM_BLOCK_SIZE: 0x8a30,
  UNIFORM_BUFFER_OFFSET_ALIGNMENT: 0x8a34,
  MAX_VERTEX_ATTRIBS: 0x8869,
  MAX_TEXTURE_SIZE: 0x0d33,
  RENDERER: 0x1f01,
  QUERY_RESULT: 0x8866,
  QUERY_RESULT_AVAILABLE: 0x8867,
  // EXT_disjoint_timer_query_webgl2
  TIME_ELAPSED_EXT: 0x88bf,
  GPU_DISJOINT_EXT: 0x8fbb,
  // WEBGL_debug_renderer_info
  UNMASKED_RENDERER_WEBGL: 0x9246,
} as const;

/** Human-readable name for a GL error code. */
export function glErrorName(code: number): string {
  switch (code) {
    case 0x0500:
      return 'INVALID_ENUM';
    case 0x0501:
      return 'INVALID_VALUE';
    case 0x0502:
      return 'INVALID_OPERATION';
    case 0x0505:
      return 'OUT_OF_MEMORY';
    case 0x0506:
      return 'INVALID_FRAMEBUFFER_OPERATION';
    case 0x9242:
      return 'CONTEXT_LOST_WEBGL';
    default:
      return `0x${code.toString(16)}`;
  }
}
