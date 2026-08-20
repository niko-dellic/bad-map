import { BAYER_4X4 } from "./shaders.js";

export function smoothstep(
  edge0: number,
  edge1: number,
  value: number,
): number {
  const amount = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return amount * amount * (3 - 2 * amount);
}

export function bayer4Threshold(x: number, y: number): number {
  const column = ((Math.floor(x) % 4) + 4) % 4;
  const row = ((Math.floor(y) % 4) + 4) % 4;
  return (BAYER_4X4[row * 4 + column]! + 0.5) / 16;
}

export function fogBoundaryAmount(
  point: readonly [number, number],
  bounds: readonly [number, number, number, number],
  halo = 0.06,
): number {
  const width = Math.max(Number.EPSILON, bounds[2] - bounds[0]);
  const height = Math.max(Number.EPSILON, bounds[3] - bounds[1]);
  const x = (point[0] - bounds[0]) / width;
  const y = (point[1] - bounds[1]) / height;
  const edgeDistance = Math.min(x, 1 - x, y, 1 - y);
  return 1 - smoothstep(0, Math.max(Number.EPSILON, halo), edgeDistance);
}

export function invertMatrix4(
  matrix: ArrayLike<number>,
): Float32Array | undefined {
  if (matrix.length < 16) return undefined;
  const a00 = matrix[0]!,
    a01 = matrix[1]!,
    a02 = matrix[2]!,
    a03 = matrix[3]!;
  const a10 = matrix[4]!,
    a11 = matrix[5]!,
    a12 = matrix[6]!,
    a13 = matrix[7]!;
  const a20 = matrix[8]!,
    a21 = matrix[9]!,
    a22 = matrix[10]!,
    a23 = matrix[11]!;
  const a30 = matrix[12]!,
    a31 = matrix[13]!,
    a32 = matrix[14]!,
    a33 = matrix[15]!;
  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;
  const determinant =
    b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-15)
    return undefined;
  const inverseDeterminant = 1 / determinant;
  return new Float32Array([
    (a11 * b11 - a12 * b10 + a13 * b09) * inverseDeterminant,
    (a02 * b10 - a01 * b11 - a03 * b09) * inverseDeterminant,
    (a31 * b05 - a32 * b04 + a33 * b03) * inverseDeterminant,
    (a22 * b04 - a21 * b05 - a23 * b03) * inverseDeterminant,
    (a12 * b08 - a10 * b11 - a13 * b07) * inverseDeterminant,
    (a00 * b11 - a02 * b08 + a03 * b07) * inverseDeterminant,
    (a32 * b02 - a30 * b05 - a33 * b01) * inverseDeterminant,
    (a20 * b05 - a22 * b02 + a23 * b01) * inverseDeterminant,
    (a10 * b10 - a11 * b08 + a13 * b06) * inverseDeterminant,
    (a01 * b08 - a00 * b10 - a03 * b06) * inverseDeterminant,
    (a30 * b04 - a31 * b02 + a33 * b00) * inverseDeterminant,
    (a21 * b02 - a20 * b04 - a23 * b00) * inverseDeterminant,
    (a11 * b07 - a10 * b09 - a12 * b06) * inverseDeterminant,
    (a00 * b09 - a01 * b07 + a02 * b06) * inverseDeterminant,
    (a31 * b01 - a30 * b03 - a32 * b00) * inverseDeterminant,
    (a20 * b03 - a21 * b01 + a22 * b00) * inverseDeterminant,
  ]);
}

export interface GroundRayIntersection {
  point: readonly [number, number, number];
  distance: number;
}

export function groundRayIntersection(
  inverseMatrix: ArrayLike<number>,
  ndc: readonly [number, number],
): GroundRayIntersection | undefined {
  const unproject = (z: number): [number, number, number] | undefined => {
    const x = ndc[0],
      y = ndc[1];
    const w =
      inverseMatrix[3]! * x +
      inverseMatrix[7]! * y +
      inverseMatrix[11]! * z +
      inverseMatrix[15]!;
    if (!Number.isFinite(w) || Math.abs(w) < 1e-12) return undefined;
    return [
      (inverseMatrix[0]! * x +
        inverseMatrix[4]! * y +
        inverseMatrix[8]! * z +
        inverseMatrix[12]!) /
        w,
      (inverseMatrix[1]! * x +
        inverseMatrix[5]! * y +
        inverseMatrix[9]! * z +
        inverseMatrix[13]!) /
        w,
      (inverseMatrix[2]! * x +
        inverseMatrix[6]! * y +
        inverseMatrix[10]! * z +
        inverseMatrix[14]!) /
        w,
    ];
  };
  const near = unproject(-1);
  const far = unproject(1);
  if (!near || !far) return undefined;
  const ray: [number, number, number] = [
    far[0] - near[0],
    far[1] - near[1],
    far[2] - near[2],
  ];
  if (Math.abs(ray[2]) < 1e-12) return undefined;
  const t = -near[2] / ray[2];
  if (!Number.isFinite(t) || t < 0) return undefined;
  const travel: [number, number, number] = [ray[0] * t, ray[1] * t, ray[2] * t];
  return {
    point: [near[0] + travel[0], near[1] + travel[1], 0],
    distance: Math.hypot(...travel),
  };
}
