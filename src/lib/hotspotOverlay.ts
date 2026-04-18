import { createCanvas, loadImage } from 'canvas';
import { RawHotspot } from '../types';
import { normalizedToPixelBBox } from './coordUtils';

export async function drawHotspotsOnImage(base64Image: string, mimeType: string, hotspots: RawHotspot[]): Promise<string> {
  const img = await loadImage(`data:${mimeType};base64,${base64Image}`);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);

  ctx.lineWidth = 5;

  for (const hotspot of hotspots) {
    // Draw label box
    if (hotspot.box_2d) {
      const [ymin, xmin, ymax, xmax] = hotspot.box_2d;
      const bbox = normalizedToPixelBBox({ yMin: ymin, xMin: xmin, yMax: ymax, xMax: xmax }, img.width, img.height);
      ctx.strokeStyle = 'red';
      ctx.strokeRect(bbox.x, bbox.y, bbox.w, bbox.h);
      ctx.fillStyle = 'red';
      ctx.font = '20px Arial';
      ctx.fillText(hotspot.label, bbox.x, bbox.y - 10);
    }

    // Draw part box
    if (hotspot.part_box_2d) {
      const [ymin, xmin, ymax, xmax] = hotspot.part_box_2d;
      const bbox = normalizedToPixelBBox({ yMin: ymin, xMin: xmin, yMax: ymax, xMax: xmax }, img.width, img.height);
      ctx.strokeStyle = 'blue';
      ctx.strokeRect(bbox.x, bbox.y, bbox.w, bbox.h);
    }
  }

  return canvas.toDataURL().split(',')[1];
}
