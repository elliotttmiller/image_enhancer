import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';

// Set worker source to the local file resolved by Vite
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export interface PdfPageData {
  dataUri: string;
  width: number;
  height: number;
}

export async function convertPdfToImage(file: File, scale: number = 3.0): Promise<PdfPageData[]> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    
    if (pdf.numPages === 0) {
      throw new Error("PDF has no pages");
    }

    const pages: PdfPageData[] = [];

    for (let i = 1; i <= pdf.numPages; i++) {
        console.log(`Processing page ${i} of ${pdf.numPages}`);
        const page = await pdf.getPage(i);
        
        // Get original dimensions
        const originalViewport = page.getViewport({ scale: 1.0 });
        const width = originalViewport.width;
        const height = originalViewport.height;

        // Set scale for high quality rendering
        const viewport = page.getViewport({ scale });
        
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        
        if (!context) {
          throw new Error("Could not create canvas context");
        }
        
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        
        const renderContext = {
          canvasContext: context,
          viewport: viewport,
        };
        
        console.log(`Rendering page ${i}`);
        await page.render(renderContext as any).promise;
        console.log(`Rendered page ${i}`);
        
        // Convert to base64 image
        pages.push({
          dataUri: canvas.toDataURL('image/png'),
          width,
          height
        });
    }
    
    return pages;
  } catch (error) {
    console.error("Error converting PDF to image:", error);
    throw new Error(`Failed to process PDF file: ${error instanceof Error ? error.message : String(error)}`);
  }
}
