/** 쪽 이미지 영역 잘라 내기(sharp). bbox 는 0~1 비율 [x0, y0, x1, y1] */
import type { ImageCropper } from '@k-raildex/domain';
import sharp from 'sharp';

export const sharpCropper: ImageCropper = async (png, bbox) => {
  const img = sharp(png);
  const meta = await img.metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  const left = Math.min(W - 1, Math.max(0, Math.floor(bbox[0] * W)));
  const top = Math.min(H - 1, Math.max(0, Math.floor(bbox[1] * H)));
  const width = Math.max(1, Math.min(W - left, Math.ceil(bbox[2] * W) - left));
  const height = Math.max(1, Math.min(H - top, Math.ceil(bbox[3] * H) - top));
  const { data, info } = await img.extract({ left, top, width, height }).png().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
};
