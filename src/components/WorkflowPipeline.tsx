import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Upload, Settings, Play, CheckCircle2, AlertCircle, Loader2, X, FileText, Image as ImageIcon, Download, Layers, Sparkles, Cpu, Trash2, Eye, Maximize2 } from 'lucide-react';
import { convertPdfToImage } from '../lib/pdf-utils';
import { classifyPage, extractSchematicData, extractLegendData, auditAndUpdateJson, CorrelatedData, ExtractedHotspot, LegendEntry } from '../lib/schematic-legend-processor';
import { enhanceSchematic, extractHotspots as extractHotspotsGemini, SchematicStyle, sleep, rateLimit } from '../lib/gemini';
import { AspectRatioOption, ImageSize, ModelVersion, OutputQuality, ASPECT_RATIO_LABELS } from '../types';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

interface PipelineProps {
  onClose: () => void;
}

import { SchematicViewer } from './SchematicViewer';
import { PipelineFile } from '../types';

interface PipelineConfig {
  enablePdfCorrelation: boolean;
  pdfScale: number;
  enableEnhancement: boolean;
  enhancementStyle: SchematicStyle;
  enhancementKeepLabels: boolean;
  enhancementAspectRatio: AspectRatioOption;
  enhancementImageSize: ImageSize;
  enhancementModel: ModelVersion;
  enhancementCustomPrompt: string;
  enhancementPreserveGeometry: boolean;
  enhancementEnhanceDetails: boolean;
  enhancementOutputQuality: OutputQuality;
  enableHotspotExtraction: boolean;
  enhancementStyles: SchematicStyle[];
  enableHitlApproval: boolean;
}

export function WorkflowPipeline({ onClose }: PipelineProps) {
  const [files, setFiles] = useState<PipelineFile[]>([]);
  const [config, setConfig] = useState<PipelineConfig>({
    enablePdfCorrelation: true,
    pdfScale: 3.0,
    enableEnhancement: true,
    enhancementStyles: ['blueprint'],
    enhancementStyle: 'blueprint', // Added this line
    enhancementKeepLabels: true,
    enhancementAspectRatio: '1:1',
    enhancementImageSize: '1K',
  enhancementModel: 'gemini-3.1-flash-image-preview',
    enhancementCustomPrompt: '',
    enhancementPreserveGeometry: true,
    enhancementEnhanceDetails: true,
    enhancementOutputQuality: 'high',
    enableHotspotExtraction: true,
    enableHitlApproval: true,
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeTab, setActiveTab] = useState<'files' | 'config' | 'execution'>('files');
  const [viewingFile, setViewingFile] = useState<{file: PipelineFile, pageIndex: number} | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFiles = e.target.files;
    if (!uploadedFiles || uploadedFiles.length === 0) return;

    const newFiles: PipelineFile[] = Array.from(uploadedFiles).map((file: File) => ({
      id: Math.random().toString(36).substr(2, 9),
      file,
      filename: file.name,
      type: file.type === 'application/pdf' ? 'pdf' : 'image',
      status: 'pending',
      workflowState: 'pending',
      progress: 0,
      currentStep: 'Waiting in queue...',
    }));

    setFiles(prev => [...prev, ...newFiles]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleReferenceImageUpload = (fileId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    
    const refFile = e.target.files[0];
    const reader = new FileReader();
    reader.onload = () => {
      const dataUri = reader.result as string;
      setFiles(prev => prev.map(f => {
        if (f.id === fileId) {
          const newRefs = f.referenceImages ? [...f.referenceImages] : [];
          newRefs.push({ url: dataUri, mimeType: refFile.type });
          return { ...f, referenceImages: newRefs };
        }
        return f;
      }));
    };
    reader.readAsDataURL(refFile);
    e.target.value = ''; // Reset input
  };

  const handleExistingJsonUpload = (fileId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    
    const jsonFile = e.target.files[0];
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const jsonData = JSON.parse(reader.result as string);
        setFiles(prev => prev.map(f => {
          if (f.id === fileId) {
            return { ...f, existingJsonFile: jsonFile, existingJsonData: jsonData };
          }
          return f;
        }));
      } catch (err) {
        console.error("Failed to parse JSON file", err);
        alert("Invalid JSON file.");
      }
    };
    reader.readAsText(jsonFile);
    e.target.value = ''; // Reset input
  };

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  const updateFileState = (id: string, updates: Partial<PipelineFile>) => {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f));
  };

  const runClassification = async (file: PipelineFile) => {
    updateFileState(file.id, { status: 'processing', progress: 20, currentStep: 'Classifying pages...' });
    const pages = file.pages || [];
    
    // 1. Classify
    for (let p = 0; p < pages.length; p++) {
      const [mimeTypePart, base64Image] = pages[p].originalImage.split(',');
      const mimeType = mimeTypePart.split(';')[0].split(':')[1];
      await rateLimit();
      pages[p].type = await classifyPage(base64Image, mimeType);
    }

    // 2. Extract Legend
    updateFileState(file.id, { status: 'processing', progress: 35, currentStep: 'Extracting legend data...' });
    for (let p = 0; p < pages.length; p++) {
      if (pages[p].type === 'LEGEND') {
        const [mimeTypePart, base64Image] = pages[p].originalImage.split(',');
        const mimeType = mimeTypePart.split(';')[0].split(':')[1];
        await rateLimit();
        pages[p].legendEntries = await extractLegendData(base64Image, mimeType);
      }
    }

    if (config.enableHitlApproval) {
      updateFileState(file.id, { pages, workflowState: 'legend_approval', currentStep: 'Waiting for legend approval...' });
    } else {
      const filteredPages = pages.filter(p => p.type !== 'LEGEND');
      const allLegendEntries = pages.reduce((acc, p) => {
        if (p.legendEntries) acc.push(...p.legendEntries);
        return acc;
      }, [] as LegendEntry[]);
      
      const updatedFile = { ...file, pages: filteredPages, legendEntries: allLegendEntries };
      
      if (config.enableEnhancement) {
        updateFileState(file.id, { pages: filteredPages, legendEntries: allLegendEntries, workflowState: 'enhancing', currentStep: 'Enhancing schematic...' });
        await runEnhancement(updatedFile);
      } else if (config.enableHotspotExtraction) {
        updateFileState(file.id, { pages: filteredPages, legendEntries: allLegendEntries, workflowState: 'extracting_hotspots', currentStep: 'Extracting hotspots...' });
        await runHotspotExtraction(updatedFile);
      } else {
        updateFileState(file.id, { pages: filteredPages, legendEntries: allLegendEntries, workflowState: 'success', status: 'success', currentStep: 'Complete' });
      }
    }
  };

  const runEnhancement = async (file: PipelineFile) => {
    console.log('Starting enhancement for file:', file.filename, 'Pages:', file.pages?.length);
    updateFileState(file.id, { status: 'processing', progress: 50, currentStep: 'Enhancing schematic...' });
    const pages = file.pages || [];
    for (let p = 0; p < pages.length; p++) {
      console.log(`Processing page ${p}, type: ${pages[p].type}`);
      if (pages[p].type === 'SCHEMATIC') {
        const [mimeTypePart, base64Image] = pages[p].originalImage.split(',');
        const mimeType = mimeTypePart.split(';')[0].split(':')[1];
        
        console.log(`Calling enhanceSchematic for page ${p}`);
        try {
          await rateLimit();
          const enhanced = await enhanceSchematic(
            base64Image, mimeType, config.enhancementStyles, config.enhancementKeepLabels,
            config.enhancementAspectRatio, config.enhancementImageSize, config.enhancementModel,
            config.enhancementCustomPrompt, config.enhancementPreserveGeometry,
            config.enhancementEnhanceDetails, config.enhancementOutputQuality,
            file.referenceImages
          );
          console.log(`enhanceSchematic result for page ${p}:`, enhanced);
          if (enhanced) pages[p].enhancedImage = enhanced.imageUrl;
          else console.warn(`enhanceSchematic returned no result for page ${p}`);
        } catch (error) {
          console.error(`enhanceSchematic failed for page ${p}:`, error);
          throw error; // Rethrow to be caught by processFileStep
        }
      } else {
        console.log(`Skipping enhancement for page ${p}, type: ${pages[p].type}`);
      }
    }
    if (config.enableHitlApproval) {
      updateFileState(file.id, { pages, workflowState: 'enhancement_approval', currentStep: 'Waiting for enhancement approval...' });
    } else {
      if (config.enableHotspotExtraction) {
        updateFileState(file.id, { pages, workflowState: 'extracting_hotspots', currentStep: 'Extracting hotspots...' });
        await runHotspotExtraction({ ...file, pages, legendEntries: file.legendEntries });
      } else {
        updateFileState(file.id, { pages, workflowState: 'success', status: 'success', currentStep: 'Complete' });
      }
    }
  };

  const runHotspotExtraction = async (file: PipelineFile) => {
    updateFileState(file.id, { status: 'processing', progress: 80, currentStep: 'Extracting hotspots...' });
    const pages = file.pages || [];
    const correlatedData: CorrelatedData[] = [];

    const legendEntries = file.legendEntries || pages.find(p => p.type === 'LEGEND')?.legendEntries || [];
    const normalizeLabel = (label: string) => label.trim().toLowerCase().replace(/^0+/, '');
    
    console.log('DEBUG: Correlation - Hotspots:', pages.filter(p => p.type === 'SCHEMATIC').flatMap(p => p.hotspots || []).length);
    console.log('DEBUG: Correlation - Legend Entries:', legendEntries.length);

    for (let p = 0; p < pages.length; p++) {
      if (pages[p].type === 'SCHEMATIC') {
        const [mimeTypePart, base64Image] = pages[p].originalImage.split(',');
        const mimeType = mimeTypePart.split(';')[0].split(':')[1];
        await rateLimit();
        pages[p].hotspots = await extractSchematicData(base64Image, mimeType);
        
        let updatedJsonData = undefined;
        let mapping = undefined;
        if (file.existingJsonData) {
          updateFileState(file.id, { currentStep: 'Auditing and updating JSON...' });
          await rateLimit();
          const result = await auditAndUpdateJson(base64Image, mimeType, pages[p].hotspots!, file.existingJsonData);
          updatedJsonData = result.updatedJsonData;
          mapping = result.mapping;
        }

        const hotspots = pages[p].hotspots!.map(h => {
            const legendEntry = legendEntries.find(le => normalizeLabel(le.label) === normalizeLabel(h.label));
            if (!legendEntry) {
                console.warn(`DEBUG: Correlation - No match for hotspot label: "${h.label}" (normalized: "${normalizeLabel(h.label)}")`);
            }
            return {
                id: h.id,
                label: h.label,
                box_2d: h.box_2d,
                description: legendEntry?.description,
                partNumber: legendEntry?.partNumber
            };
        });

        correlatedData.push({
            hotspots,
            schematicPageIndex: pages[p].index,
            legendPageIndex: pages.find(p => p.type === 'LEGEND')?.index,
            updatedJsonData,
            mapping
        });
      }
    }
    updateFileState(file.id, { pages, correlatedData, workflowState: 'success', status: 'success', currentStep: 'Complete' });
  };

  const processFileStep = async (file: PipelineFile, action?: 'approve' | 'reject') => {
    try {
      switch (file.workflowState) {
        case 'pending':
          // Ingestion logic would go here, currently handled in runPipeline
          await runClassification(file);
          break;
        case 'classifying':
          await runClassification(file);
          break;
        case 'legend_approval':
          if (action === 'approve') {
            // Remove legend pages from memory and UI
            const filteredPages = file.pages?.filter(p => p.type !== 'LEGEND') || [];
            
            if (config.enableEnhancement) {
              updateFileState(file.id, { 
                pages: filteredPages, 
                workflowState: 'enhancing', 
                currentStep: 'Enhancing schematic...' 
              });
              await runEnhancement({ ...file, pages: filteredPages });
            } else if (config.enableHotspotExtraction) {
              updateFileState(file.id, { 
                pages: filteredPages, 
                workflowState: 'extracting_hotspots', 
                currentStep: 'Extracting hotspots...' 
              });
              await runHotspotExtraction({ ...file, pages: filteredPages });
            } else {
              updateFileState(file.id, { 
                pages: filteredPages, 
                workflowState: 'success', 
                status: 'success',
                currentStep: 'Complete' 
              });
            }
          } else if (action === 'reject') {
            await runClassification(file);
          }
          break;
        case 'enhancing':
          await runEnhancement(file);
          break;
        case 'enhancement_approval':
          if (action === 'approve') {
            if (config.enableHotspotExtraction) {
              updateFileState(file.id, { workflowState: 'extracting_hotspots', currentStep: 'Extracting hotspots...' });
              await runHotspotExtraction(file);
            } else {
              updateFileState(file.id, { workflowState: 'success', status: 'success', currentStep: 'Complete' });
            }
          } else if (action === 'reject') {
            await runEnhancementWithFeedback(file);
          }
          break;
        case 'extracting_hotspots':
          await runHotspotExtraction(file);
          break;
      }
    } catch (error: any) {
      console.error(`Pipeline error for ${file.filename} at state ${file.workflowState}:`, error);
      updateFileState(file.id, { 
        status: 'error', 
        progress: 100,
        currentStep: 'Failed',
        error: error.message || 'Unknown error occurred'
      });
    }
  };

  const [enhancementFeedback, setEnhancementFeedback] = useState<Record<string, string>>({});

  const runPipeline = async () => {
    if (files.length === 0) return;
    setIsProcessing(true);
    setActiveTab('execution');

    for (const file of files) {
      if (file.status === 'success') continue;

      updateFileState(file.id, { status: 'processing', progress: 5, currentStep: 'Initializing...' });

      try {
        let pages: PipelineFile['pages'] = [];

        // 1. Ingestion / Conversion
        if (file.type === 'pdf') {
          updateFileState(file.id, { progress: 10, currentStep: 'Converting PDF to images...' });
          const pagesData = await convertPdfToImage(file.file, config.pdfScale);
          pages = pagesData.map((pageData, index) => ({
            index,
            originalImage: pageData.dataUri,
            width: pageData.width,
            height: pageData.height
          }));
        } else {
          updateFileState(file.id, { progress: 10, currentStep: 'Reading image...' });
          const dataUri = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file.file);
          });
          
          const img = new Image();
          img.src = dataUri;
          await new Promise(resolve => {
            img.onload = () => resolve(null);
          });
          pages = [{ index: 0, originalImage: dataUri, type: 'SCHEMATIC', width: img.width, height: img.height }];
        }

        updateFileState(file.id, { pages, workflowState: 'classifying', progress: 20 });
        
        // Trigger the first step
        await processFileStep({ ...file, pages, workflowState: 'classifying' });

      } catch (error: any) {
        console.error(`Pipeline error for ${file.filename}:`, error);
        updateFileState(file.id, { 
          status: 'error', 
          progress: 100,
          currentStep: 'Failed',
          error: error.message || 'Unknown error occurred'
        });
      }
    }

    setIsProcessing(false);
  };

  const runEnhancementWithFeedback = async (file: PipelineFile) => {
    const feedback = enhancementFeedback[file.id] || '';
    const originalPrompt = config.enhancementCustomPrompt;
    
    // Temporarily update prompt with feedback
    const updatedPrompt = feedback ? `${originalPrompt}\n\nRefinement feedback: ${feedback}` : originalPrompt;
    
    // Run enhancement with updated prompt
    updateFileState(file.id, { status: 'processing', progress: 50, currentStep: 'Enhancing schematic...' });
    const pages = file.pages || [];
    for (let p = 0; p < pages.length; p++) {
      if (pages[p].type === 'SCHEMATIC') {
        const [mimeTypePart, base64Image] = pages[p].originalImage.split(',');
        const mimeType = mimeTypePart.split(';')[0].split(':')[1];
        
        await rateLimit();
        const enhanced = await enhanceSchematic(
          base64Image, mimeType, config.enhancementStyles, config.enhancementKeepLabels,
          config.enhancementAspectRatio, config.enhancementImageSize, config.enhancementModel,
          updatedPrompt, config.enhancementPreserveGeometry,
          config.enhancementEnhanceDetails, config.enhancementOutputQuality,
          file.referenceImages
        );
        if (enhanced) pages[p].enhancedImage = enhanced.imageUrl;
      }
    }
    updateFileState(file.id, { pages, workflowState: 'enhancement_approval', currentStep: 'Waiting for enhancement approval...' });
  };

  const downloadResults = async () => {
    const successfulFiles = files.filter(f => f.status === 'success');
    if (successfulFiles.length === 0) return;

    const zip = new JSZip();

    for (const file of successfulFiles) {
      const fileFolderName = file.filename.replace(/\.[^/.]+$/, "");
      const fileFolder = zip.folder(fileFolderName);
      if (!fileFolder) continue;

      if (file.correlatedData && file.correlatedData.length > 0) {
        for (let i = 0; i < file.correlatedData.length; i++) {
          const data = file.correlatedData[i];
          const schematicPage = file.pages?.find(p => p.index === data.schematicPageIndex);
          if (!schematicPage) continue;

          // Get image dimensions
          let imgWidth = 1000;
          let imgHeight = 1000;
          const targetImage = schematicPage.enhancedImage || schematicPage.originalImage;
          
          await new Promise<void>((resolve) => {
            const img = new Image();
            img.onload = () => {
              imgWidth = img.width;
              imgHeight = img.height;
              resolve();
            };
            img.onerror = () => resolve();
            img.src = targetImage;
          });

          // Save JSON
          const coordinates = data.hotspots.reduce((acc, hotspot) => {
            const ymin_pct = (hotspot.box_2d[0] / 1000) * 100;
            const xmin_pct = (hotspot.box_2d[1] / 1000) * 100;
            const ymax_pct = (hotspot.box_2d[2] / 1000) * 100;
            const xmax_pct = (hotspot.box_2d[3] / 1000) * 100;
            
            const width_pct = xmax_pct - xmin_pct;
            const height_pct = ymax_pct - ymin_pct;

            acc[hotspot.label] = {
              id: hotspot.label,
              x_pct: xmin_pct + width_pct / 2,
              y_pct: ymin_pct + height_pct / 2,
              shape: (hotspot as any).shape || 'rectangle',
              pageNumber: 1,
              rotation: 0
            };
            return acc;
          }, {} as Record<string, any>);

          const exportData = data.updatedJsonData || {
            id: `${file.id}-${i}`,
            title: `${fileFolderName} - Schematic ${i + 1}`,
            parts: data.hotspots.map(h => ({
              id: h.label,
              name: h.description || h.label,
              quantity: 1,
              sku: h.partNumber || ""
            })),
            coordinates,
            schema_version: "1.0",
            image_natural_width: imgWidth,
            image_natural_height: imgHeight
          };

          const baseName = `schematic_${i + 1}`;
          fileFolder.file(`${baseName}_data.json`, JSON.stringify(exportData, null, 2));
          
          // Save Image (Prefer enhanced)
          if (targetImage.startsWith('data:')) {
            const base64Data = targetImage.split(',')[1];
            fileFolder.file(`${baseName}_image.png`, base64Data, { base64: true });
          } else {
            // Fetch remote image and save
            try {
              const response = await fetch(targetImage);
              const blob = await response.blob();
              fileFolder.file(`${baseName}_image.png`, blob);
            } catch (e) {
              console.error("Failed to fetch enhanced image for zip", e);
            }
          }
        }
      } else if (file.pages) {
        // Just save images if no correlation data
        for (let i = 0; i < file.pages.length; i++) {
          const page = file.pages[i];
          const targetImage = page.enhancedImage || page.originalImage;
          if (targetImage.startsWith('data:')) {
            const base64Data = targetImage.split(',')[1];
            fileFolder.file(`page_${i + 1}.png`, base64Data, { base64: true });
          }
        }
      }
    }

    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, 'pipeline_export.zip');
  };

  return (
    <div className="fixed inset-0 z-70 flex bg-black/80 backdrop-blur-xl">
      <div className="flex-1 flex flex-col max-w-6xl mx-auto w-full h-full bg-neutral-900/80 shadow-2xl border-x border-white/10">
        {/* Header */}
        <div className="p-6 border-b border-white/10 flex items-center justify-between bg-black/20">
          <div>
            <h2 className="text-2xl font-bold text-white flex items-center gap-3">
              <div className="p-2 bg-indigo-500/20 rounded-lg">
                <Cpu className="w-6 h-6 text-indigo-400" />
              </div>
              All-in-One Processing Pipeline
            </h2>
            <p className="text-neutral-400 mt-1">Configure and run advanced multi-step workflows on your schematics.</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl transition-colors text-neutral-400 hover:text-white">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/10 bg-black/10">
          <button
            onClick={() => setActiveTab('files')}
            className={`flex-1 py-4 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
              activeTab === 'files' ? 'text-indigo-400 border-b-2 border-indigo-500 bg-indigo-500/5' : 'text-neutral-400 hover:text-neutral-300 hover:bg-white/5'
            }`}
          >
            <Layers className="w-4 h-4" />
            1. Input Files ({files.length})
          </button>
          <button
            onClick={() => setActiveTab('config')}
            className={`flex-1 py-4 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
              activeTab === 'config' ? 'text-indigo-400 border-b-2 border-indigo-500 bg-indigo-500/5' : 'text-neutral-400 hover:text-neutral-300 hover:bg-white/5'
            }`}
          >
            <Settings className="w-4 h-4" />
            2. Workflow Configuration
          </button>
          <button
            onClick={() => setActiveTab('execution')}
            className={`flex-1 py-4 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
              activeTab === 'execution' ? 'text-indigo-400 border-b-2 border-indigo-500 bg-indigo-500/5' : 'text-neutral-400 hover:text-neutral-300 hover:bg-white/5'
            }`}
          >
            <Play className="w-4 h-4" />
            3. Execution & Results
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar relative">
          <AnimatePresence mode="wait">
            {activeTab === 'files' && (
              <motion.div
                key="files"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6 max-w-4xl mx-auto w-full"
              >
                <div className="border-2 border-dashed border-white/10 rounded-2xl p-12 flex flex-col items-center justify-center bg-white/5 hover:bg-white/10 transition-colors cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                  <div className="w-16 h-16 bg-indigo-500/20 rounded-full flex items-center justify-center mb-4">
                    <Upload className="w-8 h-8 text-indigo-400" />
                  </div>
                  <h3 className="text-xl font-medium text-white mb-2">Upload Schematics</h3>
                  <p className="text-neutral-400 text-center max-w-md">
                    Drag and drop or click to upload PDF documents or images. You can process multiple files in bulk.
                  </p>
                  <input type="file" ref={fileInputRef} onChange={handleFileUpload} multiple accept="application/pdf,image/*" className="hidden" />
                </div>

                {files.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-medium text-white">Selected Files</h3>
                      <button onClick={() => setFiles([])} className="text-sm text-red-400 hover:text-red-300">Clear All</button>
                    </div>
                    {files.map(file => (
                      <div key={file.id} className="flex flex-col gap-3 p-4 bg-neutral-800/50 rounded-xl border border-white/5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-4">
                            {file.type === 'pdf' ? <FileText className="w-8 h-8 text-rose-400" /> : <ImageIcon className="w-8 h-8 text-emerald-400" />}
                            <div>
                              <p className="text-white font-medium">{file.filename}</p>
                              <p className="text-xs text-neutral-400 uppercase tracking-wider">{file.type}</p>
                            </div>
                          </div>
                          <button onClick={() => removeFile(file.id)} className="p-2 text-neutral-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors">
                            <Trash2 className="w-5 h-5" />
                          </button>
                        </div>
                        
                        {/* Reference Images and JSON Section */}
                        <div className="pl-12 pt-2 border-t border-white/5 flex flex-col gap-3">
                          <div className="flex flex-wrap items-center gap-3">
                            {file.referenceImages?.map((ref, idx) => (
                              <div key={idx} className="relative w-12 h-12 rounded-lg overflow-hidden border border-white/10 group">
                                <img src={ref.url} alt="Reference" className="w-full h-full object-cover" />
                                <button 
                                  onClick={() => {
                                    setFiles(prev => prev.map(f => {
                                      if (f.id === file.id && f.referenceImages) {
                                        return { ...f, referenceImages: f.referenceImages.filter((_, i) => i !== idx) };
                                      }
                                      return f;
                                    }));
                                  }}
                                  className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
                                >
                                  <X className="w-4 h-4 text-white" />
                                </button>
                              </div>
                            ))}
                            
                            <label className="w-12 h-12 rounded-lg border border-dashed border-white/20 flex items-center justify-center text-neutral-400 hover:text-white hover:border-white/40 hover:bg-white/5 transition-colors cursor-pointer" title="Add Reference Image (for realistic materials/colors)">
                              <Upload className="w-4 h-4" />
                              <input 
                                type="file" 
                                accept="image/*" 
                                className="hidden" 
                                onChange={(e) => handleReferenceImageUpload(file.id, e)} 
                              />
                            </label>
                            <span className="text-xs text-neutral-500">Add reference images for accurate colors & materials</span>
                          </div>

                          <div className="flex flex-wrap items-center gap-3">
                            {file.existingJsonFile ? (
                              <div className="flex items-center gap-2 px-3 py-1.5 bg-indigo-500/10 border border-indigo-500/20 rounded-lg">
                                <FileText className="w-4 h-4 text-indigo-400" />
                                <span className="text-xs text-indigo-300">{file.existingJsonFile.name}</span>
                                <button 
                                  onClick={() => {
                                    setFiles(prev => prev.map(f => f.id === file.id ? { ...f, existingJsonFile: undefined, existingJsonData: undefined } : f));
                                  }}
                                  className="ml-2 text-indigo-400 hover:text-indigo-300"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            ) : (
                              <label className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-dashed border-white/20 text-neutral-400 hover:text-white hover:border-white/40 hover:bg-white/5 transition-colors cursor-pointer" title="Upload existing schematic_data.json">
                                <Upload className="w-4 h-4" />
                                <span className="text-xs">Upload existing schematic_data.json</span>
                                <input 
                                  type="file" 
                                  accept=".json,application/json" 
                                  className="hidden" 
                                  onChange={(e) => handleExistingJsonUpload(file.id, e)} 
                                />
                              </label>
                            )}
                            <span className="text-xs text-neutral-500">Optional: Provide an existing JSON file to audit and update</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === 'config' && (
              <motion.div
                key="config"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="max-w-3xl mx-auto w-full space-y-6"
              >
                <div className="bg-neutral-800/50 rounded-2xl border border-white/5 p-6 space-y-6">
                  <div className="flex items-start gap-4">
                    <div className="mt-1">
                      <input 
                        type="checkbox" 
                        id="hitlApproval"
                        checked={config.enableHitlApproval}
                        onChange={(e) => setConfig(prev => ({ ...prev, enableHitlApproval: e.target.checked }))}
                        className="w-5 h-5 rounded border-white/20 bg-neutral-900 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-neutral-900"
                      />
                    </div>
                    <div className="flex-1">
                      <label htmlFor="hitlApproval" className="text-lg font-medium text-white cursor-pointer block">Enable Human-in-the-Loop (HITL) Approval</label>
                      <p className="text-neutral-400 text-sm mt-1 mb-3">Requires manual approval for legend data extraction and schematic enhancement steps.</p>
                    </div>
                  </div>

                  <div className="h-px bg-white/5" />

                  <div className="flex items-start gap-4">
                    <div className="mt-1">
                      <input 
                        type="checkbox" 
                        id="pdfCorrelation"
                        checked={config.enablePdfCorrelation}
                        onChange={(e) => setConfig(prev => ({ ...prev, enablePdfCorrelation: e.target.checked }))}
                        className="w-5 h-5 rounded border-white/20 bg-neutral-900 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-neutral-900"
                      />
                    </div>
                    <div className="flex-1">
                      <label htmlFor="pdfCorrelation" className="text-lg font-medium text-white cursor-pointer block">PDF Schematic & Legend Correlation</label>
                      <p className="text-neutral-400 text-sm mt-1 mb-3">Automatically classifies pages in PDFs, extracts legends, and correlates part numbers with schematic hotspots.</p>
                      
                      {config.enablePdfCorrelation && (
                        <div className="bg-neutral-900/50 p-4 rounded-xl border border-white/5">
                          <label className="block text-sm font-medium text-neutral-300 mb-2">PDF Conversion Quality (Scale)</label>
                          <select 
                            value={config.pdfScale}
                            onChange={(e) => setConfig(prev => ({ ...prev, pdfScale: parseFloat(e.target.value) }))}
                            className="w-full bg-neutral-800 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          >
                            <option value={1.0}>1.0x (Fastest, Lowest Quality)</option>
                            <option value={2.0}>2.0x (Balanced)</option>
                            <option value={3.0}>3.0x (High Quality, Default)</option>
                            <option value={4.0}>4.0x (Maximum Quality, Slower)</option>
                          </select>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="h-px bg-white/5" />

                  <div className="flex items-start gap-4">
                    <div className="mt-1">
                      <input 
                        type="checkbox" 
                        id="enhancement"
                        checked={config.enableEnhancement}
                        onChange={(e) => setConfig(prev => ({ ...prev, enableEnhancement: e.target.checked }))}
                        className="w-5 h-5 rounded border-white/20 bg-neutral-900 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-neutral-900"
                      />
                    </div>
                    <div className="flex-1">
                      <label htmlFor="enhancement" className="text-lg font-medium text-white cursor-pointer block">AI Image Enhancement</label>
                      <p className="text-neutral-400 text-sm mt-1 mb-3">Redraws and enhances the schematic using advanced AI models for better clarity.</p>
                      
                      {config.enableEnhancement && (
                        <div className="bg-neutral-900/50 p-4 rounded-xl border border-white/5 space-y-4">
                          <div>
                            <label className="block text-sm font-medium text-neutral-300 mb-2">Enhancement Styles</label>
                            <div className="grid grid-cols-2 gap-2">
                              {['modern', 'blueprint', 'patent', 'artistic', 'minimalist', 'isometric', 'vintage', 'realistic', 'production', 'hybrid-realism'].map((style) => (
                                <label key={style} className="flex items-center space-x-2 text-sm text-neutral-300 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={config.enhancementStyles.includes(style as SchematicStyle)}
                                    onChange={(e) => {
                                      const newStyles = e.target.checked
                                        ? [...config.enhancementStyles, style as SchematicStyle]
                                        : config.enhancementStyles.filter((s) => s !== style);
                                      setConfig(prev => ({ ...prev, enhancementStyles: newStyles }));
                                    }}
                                    className="rounded border-neutral-700 bg-neutral-800 text-indigo-500 focus:ring-indigo-500"
                                  />
                                  <span className="capitalize">{style}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className="block text-sm font-medium text-neutral-300 mb-2">Aspect Ratio</label>
                              <select 
                                value={config.enhancementAspectRatio}
                                onChange={(e) => setConfig(prev => ({ ...prev, enhancementAspectRatio: e.target.value as AspectRatioOption }))}
                                className="w-full bg-neutral-800 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              >
                                {Object.entries(ASPECT_RATIO_LABELS).map(([value, label]) => (
                                  <option key={value} value={value}>{label}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-neutral-300 mb-2">Image Size</label>
                              <select 
                                value={config.enhancementImageSize}
                                onChange={(e) => setConfig(prev => ({ ...prev, enhancementImageSize: e.target.value as ImageSize }))}
                                className="w-full bg-neutral-800 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              >
                                <option value="512px">512px (Fastest)</option>
                                <option value="1K">1K (Standard)</option>
                                <option value="2K">2K (High Quality)</option>
                                <option value="4K">4K (Ultra HD)</option>
                              </select>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className="block text-sm font-medium text-neutral-300 mb-2">AI Model</label>
                              <select 
                                value={config.enhancementModel}
                                onChange={(e) => setConfig(prev => ({ ...prev, enhancementModel: e.target.value as ModelVersion }))}
                                className="w-full bg-neutral-800 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              >
                                <option value="gemini-3.1-flash-image-preview">Gemini 3.1 Flash Preview</option>
                                <option value="gemini-3-pro-image-preview">Gemini 3 Pro Image</option>
                                <option value="gemini-2.5-flash-image">Gemini 2.5 Flash Image</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-neutral-300 mb-2">Output Quality</label>
                              <select 
                                value={config.enhancementOutputQuality}
                                onChange={(e) => setConfig(prev => ({ ...prev, enhancementOutputQuality: e.target.value as OutputQuality }))}
                                className="w-full bg-neutral-800 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              >
                                <option value="standard">Standard</option>
                                <option value="high">High</option>
                                <option value="maximum">Maximum</option>
                              </select>
                            </div>
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-neutral-300 mb-2">Custom Prompt (Optional)</label>
                            <textarea 
                              value={config.enhancementCustomPrompt}
                              onChange={(e) => setConfig(prev => ({ ...prev, enhancementCustomPrompt: e.target.value }))}
                              placeholder="Add specific instructions for the AI (e.g., 'Make the lines thicker', 'Add a red border')"
                              className="w-full bg-neutral-800 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 h-20 resize-none"
                            />
                          </div>

                          <div className="flex flex-wrap items-center gap-6 pt-2">
                            <label className="flex items-center gap-2 text-sm text-neutral-300 cursor-pointer">
                              <input 
                                type="checkbox"
                                checked={config.enhancementKeepLabels}
                                onChange={(e) => setConfig(prev => ({ ...prev, enhancementKeepLabels: e.target.checked }))}
                                className="w-4 h-4 rounded border-white/20 bg-neutral-900 text-indigo-500 focus:ring-indigo-500"
                              />
                              Keep Original Labels
                            </label>
                            <label className="flex items-center gap-2 text-sm text-neutral-300 cursor-pointer">
                              <input 
                                type="checkbox"
                                checked={config.enhancementPreserveGeometry}
                                onChange={(e) => setConfig(prev => ({ ...prev, enhancementPreserveGeometry: e.target.checked }))}
                                className="w-4 h-4 rounded border-white/20 bg-neutral-900 text-indigo-500 focus:ring-indigo-500"
                              />
                              Preserve Geometry
                            </label>
                            <label className="flex items-center gap-2 text-sm text-neutral-300 cursor-pointer">
                              <input 
                                type="checkbox"
                                checked={config.enhancementEnhanceDetails}
                                onChange={(e) => setConfig(prev => ({ ...prev, enhancementEnhanceDetails: e.target.checked }))}
                                className="w-4 h-4 rounded border-white/20 bg-neutral-900 text-indigo-500 focus:ring-indigo-500"
                              />
                              Enhance Details
                            </label>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="h-px bg-white/5" />

                  <div className="flex items-start gap-4">
                    <div className="mt-1">
                      <input 
                        type="checkbox" 
                        id="hotspots"
                        checked={config.enableHotspotExtraction}
                        onChange={(e) => setConfig(prev => ({ ...prev, enableHotspotExtraction: e.target.checked }))}
                        className="w-5 h-5 rounded border-white/20 bg-neutral-900 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-neutral-900"
                      />
                    </div>
                    <div>
                      <label htmlFor="hotspots" className="text-lg font-medium text-white cursor-pointer block">Hotspot Extraction</label>
                      <p className="text-neutral-400 text-sm mt-1">Detects and extracts bounding boxes for all part callouts in the schematic.</p>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}


            {activeTab === 'execution' && (
              <motion.div
                key="execution"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="max-w-5xl mx-auto w-full space-y-6"
              >
                {files.length === 0 ? (
                  <div className="text-center p-12">
                    <AlertCircle className="w-12 h-12 text-neutral-500 mx-auto mb-4" />
                    <p className="text-neutral-400">No files selected. Go back to step 1 to add files.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {files.map(file => (
                      <div key={file.id} className="bg-neutral-800/50 rounded-2xl border border-white/5 overflow-hidden">
                        <div className="p-4 flex items-center justify-between bg-black/20">
                          <div className="flex items-center gap-3">
                            {file.status === 'processing' ? (
                              <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />
                            ) : file.status === 'success' ? (
                              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                            ) : file.status === 'error' ? (
                              <AlertCircle className="w-5 h-5 text-red-500" />
                            ) : (
                              <div className="w-5 h-5 rounded-full border-2 border-neutral-600" />
                            )}
                            <span className="font-medium text-white">{file.filename}</span>
                          </div>
                          <span className="text-sm text-neutral-400">{file.currentStep}</span>
                        </div>
                        
                        {(file.status === 'processing' || file.status === 'success') && (
                          <div className="h-1.5 bg-neutral-900">
                            <div 
                              className={`h-full transition-all duration-500 ${file.status === 'success' ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                              style={{ width: `${file.progress}%` }}
                            />
                          </div>
                        )}

                        {file.status === 'error' && (
                          <div className="p-4 bg-red-500/10 text-red-400 text-sm border-t border-red-500/20">
                            {file.error}
                          </div>
                        )}

                        {file.workflowState === 'legend_approval' && (
                          <div className="p-4 bg-amber-500/10 border-t border-amber-500/20 flex items-center justify-between">
                            <span className="text-amber-400 text-sm">Legend extraction needs approval</span>
                            <div className="flex gap-2">
                              <button onClick={() => processFileStep(file, 'reject')} className="px-3 py-1 bg-neutral-800 text-white rounded text-sm hover:bg-neutral-700">Reject</button>
                              <button onClick={() => processFileStep(file, 'approve')} className="px-3 py-1 bg-amber-600 text-white rounded text-sm hover:bg-amber-500">Approve</button>
                            </div>
                          </div>
                        )}
                        {file.workflowState === 'enhancement_approval' && (
                          <div className="p-4 bg-amber-500/10 border-t border-amber-500/20 flex flex-col gap-3">
                            <div className="flex items-center justify-between">
                              <span className="text-amber-400 text-sm">Enhancement needs approval</span>
                              <div className="flex gap-2">
                                <button onClick={() => processFileStep(file, 'reject')} className="px-3 py-1 bg-neutral-800 text-white rounded text-sm hover:bg-neutral-700">Reject</button>
                                <button onClick={() => processFileStep(file, 'approve')} className="px-3 py-1 bg-amber-600 text-white rounded text-sm hover:bg-amber-500">Approve</button>
                              </div>
                            </div>
                            <textarea 
                              placeholder="Feedback for refinement (optional)..."
                              value={enhancementFeedback[file.id] || ''}
                              onChange={(e) => setEnhancementFeedback(prev => ({ ...prev, [file.id]: e.target.value }))}
                              className="w-full bg-neutral-900 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                          </div>
                        )}

                        {/* Glass Box Visualization */}
                        {(file.status === 'processing' || file.status === 'success') && file.pages && file.pages.length > 0 && (
                          <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {file.pages.map((page, idx) => (
                              <div key={idx} className="relative group rounded-xl overflow-hidden bg-black/40 border border-white/5 aspect-3/4 flex items-center justify-center">
                                {/* Background Image */}
                                {page.enhancedImage || page.originalImage ? (
                                  <img 
                                    src={page.enhancedImage || page.originalImage} 
                                    alt={`Page ${idx + 1}`}
                                    className="absolute inset-0 w-full h-full object-contain opacity-50 group-hover:opacity-100 transition-opacity"
                                  />
                                ) : null}
                                
                                {/* Overlay Info */}
                                <div className="absolute inset-0 bg-linear-to-t from-black/80 via-black/20 to-transparent flex flex-col justify-end p-4">
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs font-bold text-white bg-black/50 px-2 py-1 rounded backdrop-blur-md">
                                      Page {page.index + 1}
                                    </span>
                                    <div className="flex items-center gap-2">
                                      {page.type && (
                                        <span className={`text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wider backdrop-blur-md ${
                                          page.type === 'SCHEMATIC' ? 'bg-indigo-500/80 text-white' : 
                                          page.type === 'LEGEND' ? 'bg-emerald-500/80 text-white' : 
                                          'bg-neutral-500/80 text-white'
                                        }`}>
                                          {page.type}
                                        </span>
                                      )}
                                      <button 
                                        onClick={() => setViewingFile({file, pageIndex: idx})}
                                        className="text-white bg-indigo-500/80 p-1.5 rounded-full hover:bg-indigo-400 transition-colors"
                                      >
                                        <Maximize2 className="w-4 h-4" />
                                      </button>
                                    </div>
                                  </div>
                                  
                                  <div className="mt-2 flex flex-wrap gap-1">
                                    {page.enhancedImage && <span className="text-[10px] bg-indigo-500/20 text-indigo-300 px-1.5 py-0.5 rounded border border-indigo-500/20">Enhanced</span>}
                                    {page.hotspots && <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded border border-emerald-500/20">{page.hotspots.length} Hotspots</span>}
                                    {page.legendEntries && <span className="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded border border-amber-500/20">{page.legendEntries.length} Entries</span>}
                                  </div>
                                </div>

                                {/* Hotspot Overlays */}
                                <svg 
                                  className="absolute inset-0 w-full h-full pointer-events-none" 
                                  viewBox="0 0 1000 1000" 
                                  preserveAspectRatio="none"
                                >
                                  {file.correlatedData?.find(c => c.schematicPageIndex === page.index)?.hotspots.map((h, hIdx) => {
                                    if ((h as any).polygon_2d && (h as any).polygon_2d.length > 0) {
                                      const points = (h as any).polygon_2d.map(([y, x]) => `${x},${y}`).join(' ');
                                      return (
                                        <polygon
                                          key={hIdx}
                                          points={points}
                                          fill="rgba(52, 211, 153, 0.1)"
                                          stroke="rgba(52, 211, 153, 0.5)"
                                          strokeWidth="2"
                                        />
                                      );
                                    } else {
                                      const [ymin, xmin, ymax, xmax] = h.box_2d;
                                      const width = xmax - xmin;
                                      const height = ymax - ymin;
                                      
                                      if ((h as any).shape === 'circle') {
                                        return (
                                          <ellipse
                                            key={hIdx}
                                            cx={xmin + width / 2}
                                            cy={ymin + height / 2}
                                            rx={width / 2}
                                            ry={height / 2}
                                            fill="rgba(52, 211, 153, 0.1)"
                                            stroke="rgba(52, 211, 153, 0.5)"
                                            strokeWidth="2"
                                          />
                                        );
                                      }
                                      
                                      return (
                                        <rect
                                          key={hIdx}
                                          x={xmin}
                                          y={ymin}
                                          width={width}
                                          height={height}
                                          fill="rgba(52, 211, 153, 0.1)"
                                          stroke="rgba(52, 211, 153, 0.5)"
                                          strokeWidth="2"
                                        />
                                      );
                                    }
                                  })}
                                </svg>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {viewingFile && (
          <SchematicViewer 
            file={viewingFile.file} 
            pageIndex={viewingFile.pageIndex} 
            onClose={() => setViewingFile(null)} 
            onUpdateFile={(fileId, updates) => {
              setFiles(prev => prev.map(f => f.id === fileId ? { ...f, ...updates } : f));
              setViewingFile(prev => prev ? { ...prev, file: { ...prev.file, ...updates } } : null);
            }}
          />
        )}
        {/* Footer Actions */}
        <div className="p-6 border-t border-white/10 bg-black/20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {activeTab !== 'files' && (
              <button 
                onClick={() => setActiveTab(activeTab === 'execution' ? 'config' : 'files')}
                className="px-4 py-2 text-neutral-400 hover:text-white transition-colors"
                disabled={isProcessing}
              >
                Back
              </button>
            )}
          </div>
          
          <div className="flex items-center gap-3">
            {activeTab === 'files' && (
              <button 
                onClick={() => setActiveTab('config')}
                disabled={files.length === 0}
                className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                Next: Configuration
              </button>
            )}
            
            {activeTab === 'config' && (
              <button 
                onClick={runPipeline}
                className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-colors flex items-center gap-2 shadow-[0_0_20px_rgba(99,102,241,0.4)]"
              >
                <Sparkles className="w-4 h-4" />
                Start Processing
              </button>
            )}

            {activeTab === 'execution' && files.some(f => f.status === 'success') && (
              <button 
                onClick={downloadResults}
                disabled={isProcessing}
                className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium transition-colors flex items-center gap-2 shadow-[0_0_20px_rgba(16,185,129,0.4)] disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                Download All Results (ZIP)
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
