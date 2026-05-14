export type PngExportOptions = {
  includeBackground?: boolean;
  backgroundColor?: string;
};

function getTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');

  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

function createExportCanvas(canvas: HTMLCanvasElement, options: PngExportOptions): HTMLCanvasElement {
  if (!options.includeBackground) {
    return canvas;
  }

  const exportCanvas = document.createElement('canvas');
  const context = exportCanvas.getContext('2d');

  if (!context) {
    throw new Error('Could not create PNG export context.');
  }

  exportCanvas.width = canvas.width;
  exportCanvas.height = canvas.height;
  context.fillStyle = options.backgroundColor ?? '#080a10';
  context.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
  context.drawImage(canvas, 0, 0);

  return exportCanvas;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Could not encode canvas as PNG.'));
        return;
      }

      resolve(blob);
    }, 'image/png');
  });
}

export async function exportCanvasAsPng(
  canvas: HTMLCanvasElement,
  options: PngExportOptions = {},
): Promise<string> {
  const exportCanvas = createExportCanvas(canvas, options);
  const blob = await canvasToBlob(exportCanvas);
  const url = URL.createObjectURL(blob);
  const filename = `unanchor-export-${getTimestamp(new Date())}.png`;
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);

  return filename;
}
