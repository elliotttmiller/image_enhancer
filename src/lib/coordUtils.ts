export interface NormalizedBBox {
  yMin: number; xMin: number; yMax: number; xMax: number; // Gemini 0-1000 space
}
export interface PixelBBox { x: number; y: number; w: number; h: number }
export interface PixelPoint { x: number; y: number }

export function normalizedToPixelBBox(
  norm: NormalizedBBox,
  imgW: number,
  imgH: number
): PixelBBox {
  const x = Math.round((norm.xMin / 1000) * imgW)
  const y = Math.round((norm.yMin / 1000) * imgH)
  const w = Math.round(((norm.xMax - norm.xMin) / 1000) * imgW)
  const h = Math.round(((norm.yMax - norm.yMin) / 1000) * imgH)
  return { x, y, w, h }
}

export interface PercentageBBox {
  x: number; y: number; w: number; h: number; // 0-100
}

export function percentageToPixelBBox(
  pct: PercentageBBox,
  imgW: number,
  imgH: number
): PixelBBox {
  const x = Math.round((pct.x / 100) * imgW);
  const y = Math.round((pct.y / 100) * imgH);
  const w = Math.round((pct.w / 100) * imgW);
  const h = Math.round((pct.h / 100) * imgH);
  return { x, y, w, h };
}

export function normalizedToPixelPoint(
  normX: number, normY: number,
  imgW: number, imgH: number
): PixelPoint {
  return {
    x: Math.round((normX / 1000) * imgW),
    y: Math.round((normY / 1000) * imgH)
  }
}

export function bboxCenter(bbox: PixelBBox): PixelPoint {
  return { x: bbox.x + Math.round(bbox.w / 2), y: bbox.y + Math.round(bbox.h / 2) }
}
