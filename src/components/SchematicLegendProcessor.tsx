import React, { useState, useRef } from 'react';
import { Upload, Download, Loader2, X, FileText, CheckCircle2, AlertCircle, Eye } from 'lucide-react';
import { convertPdfToImage } from '../lib/pdf-utils';
import { classifyPage, extractSchematicLabels, extractLegendData, CorrelatedData, ExtractedHotspot, LegendEntry, ExtractedLabel } from '../lib/schematic-legend-processor';
import { saveAs } from 'file-saver';
import JSZip from 'jszip';

interface ProcessorProps {
  onClose: () => void;
}

export interface ProcessedFile {
  id: string;
  filename: string;
  status: 'pending' | 'processing' | 'success' | 'error';
  error?: string;
  pages: {
    index: number;
    dataUri: string;
    width: number;
    height: number;
    type?: 'SCHEMATIC' | 'LEGEND' | 'OTHER';
    labels?: ExtractedLabel[];
    legendEntries?: LegendEntry[];
    error?: string;
  }[];
  correlatedData?: {
    schematicPageIndex: number;
    legendPageIndex?: number;
    parts: {
      label: string;
      description?: string;
      partNumber?: string;
      quantity?: number;
    }[];
  }[];
}

export function SchematicLegendProcessor({ onClose }: ProcessorProps) {
  const [files, setFiles] = useState<ProcessedFile[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, message: '' });
  const [viewingFile, setViewingFile] = useState<ProcessedFile | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const formatError = (error: unknown): string => {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    try {
      return JSON.stringify(error);
    } catch {
      return 'Unknown error';
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFiles = e.target.files;
    if (!uploadedFiles || uploadedFiles.length === 0) return;

    const newFiles: ProcessedFile[] = [];

    for (let i = 0; i < uploadedFiles.length; i++) {
      const file = uploadedFiles[i];
      if (file.type === 'application/pdf') {
        try {
          const pagesData = await convertPdfToImage(file);
          newFiles.push({
            id: Math.random().toString(36).substr(2, 9),
            filename: file.name,
            status: 'pending',
            pages: pagesData.map((pageData, index) => ({
              index,
              dataUri: pageData.dataUri,
              width: pageData.width,
              height: pageData.height
            }))
          });
        } catch (err) {
          console.error("Error converting PDF:", err);
        }
      }
    }

    setFiles(prev => [...prev, ...newFiles]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const processFiles = async () => {
    if (files.length === 0) return;
    setIsProcessing(true);

    const pendingFiles = files.filter(f => f.status === 'pending' || f.status === 'error');
    
    for (let i = 0; i < pendingFiles.length; i++) {
      const file = pendingFiles[i];
      setFiles(prev => prev.map(f => f.id === file.id ? { ...f, status: 'processing' } : f));
      
      try {
        const updatedPages = [...file.pages];
        const warnings: string[] = [];
        
        // Step 1: Classify pages
        for (let p = 0; p < updatedPages.length; p++) {
          setProgress({ current: p + 1, total: updatedPages.length, message: `Classifying page ${p + 1} of ${file.filename}...` });
          const [mimeTypePart, base64Image] = updatedPages[p].dataUri.split(',');
          const mimeType = mimeTypePart.split(';')[0].split(':')[1];

          try {
            console.log(`[LegendProcessor] Classifying page ${p + 1}/${updatedPages.length} of ${file.filename}`);
            updatedPages[p].type = await classifyPage(base64Image, mimeType);
            console.log(`[LegendProcessor] Page ${p + 1} classified as ${updatedPages[p].type}`);
          } catch (error) {
            const message = formatError(error);
            updatedPages[p].type = 'OTHER';
            updatedPages[p].error = `Classification failed: ${message}`;
            warnings.push(`Page ${p + 1}: classification failed, treated as OTHER.`);
            console.error(`[LegendProcessor] Classification failed for page ${p + 1}: ${message}`);
          }
        }

        // Step 2: Extract data
        for (let p = 0; p < updatedPages.length; p++) {
          const page = updatedPages[p];
          const [mimeTypePart, base64Image] = page.dataUri.split(',');
          const mimeType = mimeTypePart.split(';')[0].split(':')[1];

          try {
            if (page.type === 'SCHEMATIC') {
              setProgress({ current: p + 1, total: updatedPages.length, message: `Extracting labels from page ${p + 1}...` });
              console.log(`[LegendProcessor] Extracting schematic labels from page ${p + 1}`);
              page.labels = await extractSchematicLabels(base64Image, mimeType);
              console.log(`[LegendProcessor] Extracted ${page.labels?.length ?? 0} schematic labels from page ${p + 1}`);
            } else if (page.type === 'LEGEND') {
              setProgress({ current: p + 1, total: updatedPages.length, message: `Extracting legend from page ${p + 1}...` });
              console.log(`[LegendProcessor] Extracting legend entries from page ${p + 1}`);
              page.legendEntries = await extractLegendData(base64Image, mimeType);
              console.log(`[LegendProcessor] Extracted ${page.legendEntries?.length ?? 0} legend entries from page ${p + 1}`);
            }
          } catch (error) {
            const message = formatError(error);
            page.error = `${page.type === 'LEGEND' ? 'Legend' : 'Schematic'} extraction failed: ${message}`;
            warnings.push(`Page ${p + 1}: ${page.type === 'LEGEND' ? 'legend' : 'schematic'} extraction failed.`);
            console.error(`[LegendProcessor] Extraction failed for page ${p + 1}: ${message}`);
            if (page.type === 'SCHEMATIC') {
              page.labels = [];
            } else if (page.type === 'LEGEND') {
              page.legendEntries = [];
            }
          }
        }

        // Step 3: Correlate
        setProgress({ current: updatedPages.length, total: updatedPages.length, message: `Correlating data for ${file.filename}...` });
        console.log(`[LegendProcessor] Correlating data for ${file.filename}`);
        
        const schematics = updatedPages.filter(p => p.type === 'SCHEMATIC');
        const legends = updatedPages.filter(p => p.type === 'LEGEND');
        const correlatedData: ProcessedFile['correlatedData'] = [];

        // Simple correlation: match schematic to nearest legend, or combine all legends
        const allLegendEntries = legends.flatMap(l => l.legendEntries || []);

        for (const schematic of schematics) {
          const matchedParts = (schematic.labels || []).map(item => {
            // Find matching legend entry by clean label
            const match = allLegendEntries.find(l => l.label.trim().toLowerCase() === item.cleanLabel.trim().toLowerCase());
            return {
              label: item.cleanLabel,
              description: match?.description,
              partNumber: match?.partNumber,
              quantity: item.quantity > 1 ? item.quantity : (match?.quantity || 1)
            };
          });

          correlatedData.push({
            schematicPageIndex: schematic.index,
            parts: matchedParts,
            // Just attach the first legend page index if available
            legendPageIndex: legends.length > 0 ? legends[0].index : undefined
          });
        }

        if (schematics.length === 0) {
          warnings.push('No schematic pages were classified successfully.');
        }

        if (legends.length === 0) {
          warnings.push('No legend pages were classified successfully.');
        }

        if (correlatedData.length === 0) {
          warnings.push('No correlated output was produced from this file.');
        }

        setFiles(prev => prev.map(f => f.id === file.id ? { 
          ...f, 
          status: correlatedData.length > 0 ? 'success' : 'error', 
          pages: updatedPages,
          correlatedData,
          error: warnings.length > 0 ? warnings.join(' ') : undefined
        } : f));
        console.log(`[LegendProcessor] Completed ${file.filename} with ${correlatedData.length} correlated schematic pages`);

      } catch (error: any) {
        console.error(`Error processing ${file.filename}:`, error);
        setFiles(prev => prev.map(f => f.id === file.id ? { 
          ...f, 
          status: 'error', 
          error: formatError(error)
        } : f));
      }
    }
    
    setIsProcessing(false);
    setProgress({ current: 0, total: 0, message: '' });
  };

  const downloadJson = async () => {
    const successfulFiles = files.filter(f => f.status === 'success' && f.correlatedData);
    if (successfulFiles.length === 0) return;

    const masterZip = new JSZip();

    for (const file of successfulFiles) {
      if (!file.correlatedData) continue;
      
      const fileFolderName = file.filename.replace(/\.pdf$/i, '');
      const fileFolder = masterZip.folder(fileFolderName);
      if (!fileFolder) continue;
      
      // We'll create a single JSON for this PDF file
      const parts: any[] = [];
      const coordinates: Record<string, any> = {};
      const diagramPages: number[] = [];
      let naturalWidth = 2400;
      let naturalHeight = 1792;

      for (let i = 0; i < file.correlatedData.length; i++) {
        const data = file.correlatedData[i];
        const schematicPage = file.pages.find(p => p.index === data.schematicPageIndex);
        if (!schematicPage) continue;

        diagramPages.push(data.schematicPageIndex + 1);

        // Get image dimensions for the first schematic page
        if (i === 0) {
          naturalWidth = schematicPage.width;
          naturalHeight = schematicPage.height;
        }

        const baseName = `schematic_page_${data.schematicPageIndex + 1}`;
        const imageFileName = `${baseName}.png`;
        
        // Add parts and coordinates
        data.parts.forEach(p => {
          parts.push({
            id: p.label,
            name: p.description || p.label,
            quantity: p.quantity || 1,
            sku: p.partNumber || p.label
          });

          // Only add to coordinates if not already present (keyed by ID)
          if (!coordinates[p.label]) {
            coordinates[p.label] = {
              id: p.label,
              x_pct: 0, // Placeholder
              y_pct: 0, // Placeholder
              shape: "rectangle",
              pageNumber: data.schematicPageIndex + 1,
              rotation: 0
            };
          }
        });
        
        const base64Data = schematicPage.dataUri.split(',')[1];
        fileFolder.file(imageFileName, base64Data, { base64: true });
      }

      const exportData = {
        id: Date.now().toString(),
        title: fileFolderName,
        diagramPages: Array.from(new Set(diagramPages)).sort((a, b) => a - b),
        legendPages: [],
        parts,
        coordinates,
        schema_version: "1.0",
        image_natural_width: naturalWidth,
        image_natural_height: naturalHeight
      };

      fileFolder.file('schematic_data.json', JSON.stringify(exportData, null, 2));
    }

    const content = await masterZip.generateAsync({ type: 'blob' });
    saveAs(content, 'batch_schematic_export.zip');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-neutral-900 border border-white/10 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="p-6 border-b border-white/10 flex items-center justify-between bg-neutral-800/50">
          <div>
            <h2 className="text-2xl font-bold text-white">Schematic & Legend Correlation</h2>
            <p className="text-neutral-400 text-sm mt-1">Upload multi-page PDFs to extract and correlate hotspots with legend tables.</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors text-neutral-400 hover:text-white">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 flex flex-col bg-neutral-900 overflow-hidden">
          {/* Toolbar */}
          <div className="p-4 border-b border-white/10 flex items-center justify-between bg-neutral-800/30">
            <div className="flex items-center gap-3">
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileUpload} 
                multiple 
                accept="application/pdf" 
                className="hidden" 
              />
              <button 
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessing}
                className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2 border border-white/10 disabled:opacity-50"
              >
                <Upload className="w-4 h-4" />
                Add PDFs
              </button>
              {files.length > 0 && (
                <button 
                  onClick={() => setFiles([])}
                  disabled={isProcessing}
                  className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg font-medium transition-colors disabled:opacity-50"
                >
                  Clear All
                </button>
              )}
            </div>
            
            <div className="flex items-center gap-3">
              {files.some(f => f.status === 'success') && (
                <button 
                  onClick={downloadJson}
                  disabled={isProcessing}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium transition-colors flex items-center gap-2 shadow-lg shadow-emerald-900/20 disabled:opacity-50"
                >
                  <Download className="w-4 h-4" />
                  Download JSON
                </button>
              )}
              
              <button 
                onClick={processFiles}
                disabled={isProcessing || files.filter(f => f.status === 'pending' || f.status === 'error').length === 0}
                className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-colors flex items-center gap-2 shadow-lg shadow-indigo-900/20 disabled:opacity-50"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  'Process PDFs'
                )}
              </button>
            </div>
          </div>

          {/* Progress Bar */}
          {isProcessing && (
            <div className="bg-neutral-800 w-full p-4 border-b border-white/10">
              <div className="flex justify-between text-sm text-neutral-400 mb-2">
                <span>{progress.message}</span>
                {progress.total > 0 && <span>{progress.current} / {progress.total}</span>}
              </div>
              <div className="h-2 bg-neutral-900 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-indigo-500 transition-all duration-300 ease-out"
                  style={{ width: progress.total > 0 ? `${(progress.current / progress.total) * 100}%` : '0%' }}
                />
              </div>
            </div>
          )}

          {/* File List */}
          <div className="flex-1 overflow-y-auto p-6">
            {files.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-neutral-500">
                <FileText className="w-12 h-12 mb-4 opacity-50" />
                <p className="text-lg font-medium text-neutral-400">No PDFs added</p>
                <p className="text-sm mt-2">Upload multi-page PDFs to begin</p>
              </div>
            ) : (
              <div className="space-y-4">
                {files.map(file => (
                  <div key={file.id} className="bg-neutral-800 rounded-xl border border-white/5 p-4">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <FileText className="w-6 h-6 text-indigo-400" />
                        <div>
                          <h3 className="text-white font-medium">{file.filename}</h3>
                          <p className="text-sm text-neutral-400">{file.pages.length} pages</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {file.status === 'processing' && <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />}
                        {file.status === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-500" />}
                        {file.status === 'error' && (
                          <span title={file.error}>
                            <AlertCircle className="w-5 h-5 text-red-500" aria-hidden />
                          </span>
                        )}
                        <span className="text-sm capitalize text-neutral-400 mr-2">
                          {file.status === 'error' ? 'Error' : file.status}
                        </span>
                      </div>
                    </div>
                    
                    {file.status === 'success' && file.correlatedData && (
                      <div className="mt-4 bg-neutral-900 rounded-lg p-4 border border-white/5">
                        <h4 className="text-sm font-medium text-white mb-2">Extraction Results</h4>
                        <div className="space-y-2">
                          {file.correlatedData.map((data, idx) => (
                            <div key={idx} className="text-sm text-neutral-300">
                              <span className="text-indigo-400 font-medium">Schematic Page {data.schematicPageIndex + 1}</span>
                              {' → '}
                              {data.legendPageIndex !== undefined ? (
                                <span className="text-emerald-400 font-medium">Legend Page {data.legendPageIndex + 1}</span>
                              ) : (
                                <span className="text-amber-400 font-medium">No Legend Found</span>
                              )}
                              <span className="text-neutral-500 ml-2">({data.parts.length} parts extracted)</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {file.error && (
                      <div className={`mt-4 rounded-lg p-4 border text-sm ${
                        file.status === 'success'
                          ? 'bg-amber-500/10 border-amber-500/20 text-amber-300'
                          : 'bg-red-500/10 border-red-500/20 text-red-300'
                      }`}>
                        {file.error}
                      </div>
                    )}

                    {file.pages.some(p => p.error) && (
                      <div className="mt-4 bg-neutral-900 rounded-lg p-4 border border-white/5">
                        <h4 className="text-sm font-medium text-white mb-2">Page Warnings</h4>
                        <div className="space-y-2">
                          {file.pages.filter(p => p.error).map(page => (
                            <div key={page.index} className="text-sm text-neutral-300">
                              <span className="text-amber-400 font-medium">Page {page.index + 1}</span>
                              <span className="text-neutral-400"> — {page.error}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
