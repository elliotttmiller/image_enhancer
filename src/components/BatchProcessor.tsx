import React, { useState, useRef, useEffect } from 'react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { Upload, Download, Loader2, X, CheckCircle2, AlertCircle, FolderOpen, RefreshCw, Target } from 'lucide-react';
import { enhanceSchematic, SchematicStyle } from '../lib/gemini';
import { SchematicExtractionSession } from '../lib/SchematicExtractionSession';
import { convertPdfToImage } from '../lib/pdf-utils';
import { BatchItem, AspectRatioOption, ImageSize, ModelVersion, OutputQuality } from '../types';
import { Project } from '../types';

interface BatchProcessorProps {
  project: Project;
  onUpdateProject: (id: string, updates: Partial<Project>) => void;
  onClose: () => void;
}

export function BatchProcessor({ project, onUpdateProject, onClose }: BatchProcessorProps) {
  const [items, setItems] = useState<BatchItem[]>(project.batchItems || []);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Save items to project whenever they change
  useEffect(() => {
    onUpdateProject(project.id, { batchItems: items });
  }, [items, project.id, onUpdateProject]);

  // Settings
  const [styles, setStyles] = useState<SchematicStyle[]>(['modern']);
  const [keepLabels, setKeepLabels] = useState(true);
  const [aspectRatio, setAspectRatio] = useState<AspectRatioOption>('auto');
  const [imageSize, setImageSize] = useState<ImageSize>('1K');
  const [model, setModel] = useState<ModelVersion>('gemini-3.1-flash-image-preview');
  const [customPrompt, setCustomPrompt] = useState('');
  const [refinePrompt, setRefinePrompt] = useState('');
  const [selectedItem, setSelectedItem] = useState<BatchItem | null>(null);

  const styleOptions: SchematicStyle[] = ['modern', 'blueprint', 'patent', 'artistic', 'minimalist', 'isometric', 'vintage', 'realistic'];

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newItems: BatchItem[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      // @ts-ignore
      const relativePath = file.webkitRelativePath;
      const groupName = relativePath ? relativePath.split('/')[0] : file.name;

      if (file.name.endsWith('.zip')) {
        const zip = new JSZip();
        const loadedZip = await zip.loadAsync(file);
        for (const [filename, zipEntry] of Object.entries(loadedZip.files)) {
          if (!zipEntry.dir && filename.match(/\.(jpg|jpeg|png|webp)$/i)) {
            const base64 = await zipEntry.async('base64');
            const ext = filename.split('.').pop()?.toLowerCase();
            const mimeType = ext === 'jpg' ? 'jpeg' : ext;
            newItems.push({
              id: Math.random().toString(36).substr(2, 9),
              filename,
              groupName: file.name,
              originalDataUri: `data:image/${mimeType};base64,${base64}`,
              status: 'pending',
            });
          }
        }
      } else if (file.type.startsWith('image/')) {
        const dataUri = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as string);
          reader.readAsDataURL(file);
        });
        newItems.push({
          id: Math.random().toString(36).substr(2, 9),
          filename: file.name,
          groupName,
          originalDataUri: dataUri,
          status: 'pending',
        });
      } else if (file.type === 'application/pdf') {
        const pagesData = await convertPdfToImage(file);
        pagesData.forEach((pageData, index) => {
          newItems.push({
            id: Math.random().toString(36).substr(2, 9),
            filename: `${file.name}_page_${index + 1}.png`,
            groupName,
            originalDataUri: pageData.dataUri,
            status: 'pending',
          });
        });
      }
    }

    setItems((prev) => [...prev, ...newItems]);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (folderInputRef.current) folderInputRef.current.value = '';
  };

  const startBatch = async () => {
    if (items.length === 0) return;
    setIsProcessing(true);
    setProgress(0);

    const pendingItems = items.filter(item => item.status === 'pending' || item.status === 'error');
    
    for (let i = 0; i < pendingItems.length; i++) {
      const item = pendingItems[i];
      
      setItems(prev => prev.map(p => p.id === item.id ? { ...p, status: 'processing' } : p));

      try {
        const [mimeTypePart, base64Image] = item.originalDataUri.split(',');
        const mimeType = mimeTypePart.split(';')[0].split(':')[1];
        
        const result = await enhanceSchematic(
          base64Image,
          mimeType,
          styles,
          keepLabels,
          aspectRatio,
          imageSize,
          model,
          customPrompt,
          true,
          true,
          'standard'
        );

        setItems(prev => prev.map(p => p.id === item.id ? { 
          ...p, 
          status: 'success', 
          enhancedDataUri: result.imageUrl 
        } : p));
      } catch (error: any) {
        console.error(`Error processing ${item.filename}:`, error);
        setItems(prev => prev.map(p => p.id === item.id ? { 
          ...p, 
          status: 'error', 
          error: error.message || 'Unknown error' 
        } : p));
      }

      setProgress(((i + 1) / pendingItems.length) * 100);
    }
    setIsProcessing(false);
  };

  const extractHotspotsBatch = async () => {
    setIsProcessing(true);
    const itemsToExtract = items.filter(item => item.status === 'success');
    
    for (let i = 0; i < itemsToExtract.length; i++) {
      const item = itemsToExtract[i];
      setItems(prev => prev.map(p => p.id === item.id ? { ...p, status: 'extracting_hotspots' } : p));
      
      try {
        const session = new SchematicExtractionSession(item.id, []);
        const img = new Image();
        img.src = item.enhancedDataUri!;
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
        });
        const hotspots = await session.run(item.enhancedDataUri!.split(',')[1], img.width, img.height);
        
        setItems(prev => prev.map(p => p.id === item.id ? { ...p, status: 'success', hotspots } : p));
      } catch (error: any) {
        console.error(`Error extracting hotspots for ${item.filename}:`, error);
        setItems(prev => prev.map(p => p.id === item.id ? { ...p, status: 'error', error: error.message } : p));
      }
    }
    setIsProcessing(false);
  };

  const downloadAll = async () => {
    const zip = new JSZip();
    const successfulItems = items.filter(item => item.status === 'success' && item.enhancedDataUri);
    
    if (successfulItems.length === 0) return;

    successfulItems.forEach(item => {
      const base64Data = item.enhancedDataUri!.split(',')[1];
      const ext = item.enhancedDataUri!.split(';')[0].split('/')[1];
      const filename = `enhanced_${item.filename.replace(/\.[^/.]+$/, "")}.${ext}`;
      zip.file(filename, base64Data, { base64: true });
    });

    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, 'enhanced_schematics.zip');
  };

  const removeAll = () => {
    if (confirm('Are you sure you want to clear all items?')) {
      setItems([]);
    }
  };

  const approveItem = (id: string) => {
    setItems(prev => prev.map(p => p.id === id ? { ...p, status: 'approved' } : p));
  };

  const refineItem = async (id: string, prompt?: string) => {
    const item = items.find(p => p.id === id);
    if (!item) return;

    setItems(prev => prev.map(p => p.id === id ? { ...p, status: 'processing', error: undefined } : p));

    try {
      const [mimeTypePart, base64Image] = (item.enhancedDataUri || item.originalDataUri).split(',');
      const mimeType = mimeTypePart.split(';')[0].split(':')[1];
      
      const result = await enhanceSchematic(
        base64Image,
        mimeType,
        styles,
        keepLabels,
        aspectRatio,
        imageSize,
        model,
        prompt || customPrompt,
        true,
        true,
        'standard'
      );

      setItems(prev => prev.map(p => p.id === id ? { 
        ...p, 
        status: 'success', 
        enhancedDataUri: result.imageUrl 
      } : p));
    } catch (error: any) {
      console.error(`Error refining ${item.filename}:`, error);
      setItems(prev => prev.map(p => p.id === id ? { 
        ...p, 
        status: 'error', 
        error: error.message || 'Unknown error' 
      } : p));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-neutral-900 border border-white/10 rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="p-6 border-b border-white/10 flex items-center justify-between bg-neutral-800/50">
          <div>
            <h2 className="text-2xl font-bold text-white">Batch Processing</h2>
            <p className="text-neutral-400 text-sm mt-1">Upload multiple images or a ZIP file to process them in bulk.</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors text-neutral-400 hover:text-white">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar Settings */}
          <div className="w-80 border-r border-white/10 p-6 overflow-y-auto bg-neutral-900/50">
            <h3 className="text-lg font-semibold text-white mb-4">Settings</h3>
            
            <div className="space-y-6">
              <div>
                <label className="text-sm text-neutral-400 block mb-2">Model</label>
                <select 
                  value={model}
                  onChange={(e) => setModel(e.target.value as ModelVersion)}
                  className="w-full bg-neutral-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  disabled={isProcessing}
                >
                  <option value="gemini-3.1-flash-image-preview">Gemini 3.1 Flash Image</option>
                  <option value="gemini-3-pro-image-preview">Gemini 3 Pro Image</option>
                  <option value="gemini-2.5-flash-image">Gemini 2.5 Flash Image</option>
                </select>
              </div>

              <div>
                <label className="text-sm text-neutral-400 block mb-2">Styles</label>
                <div className="grid grid-cols-2 gap-2">
                  {styleOptions.map((style) => (
                    <label key={style} className="flex items-center gap-2 text-sm text-neutral-300 cursor-pointer capitalize">
                      <input
                        type="checkbox"
                        checked={styles.includes(style)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setStyles([...styles, style]);
                          } else {
                            setStyles(styles.filter((s) => s !== style));
                          }
                        }}
                        className="w-4 h-4 rounded border-neutral-600 bg-neutral-700 text-indigo-600 focus:ring-indigo-500"
                        disabled={isProcessing}
                      />
                      {style}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-sm text-neutral-400 block mb-2">Image Size</label>
                <select 
                  value={imageSize}
                  onChange={(e) => setImageSize(e.target.value as ImageSize)}
                  className="w-full bg-neutral-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  disabled={isProcessing}
                >
                  <option value="512px">Fast (512px)</option>
                  <option value="1K">Standard (1K)</option>
                  <option value="2K">High Res (2K)</option>
                  <option value="4K">Ultra Res (4K)</option>
                </select>
              </div>

              <div>
                <label className="text-sm text-neutral-400 block mb-2">Aspect Ratio</label>
                <select 
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio(e.target.value as AspectRatioOption)}
                  className="w-full bg-neutral-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  disabled={isProcessing}
                >
                  <option value="auto">Auto-detect</option>
                  <option value="1:1">Square (1:1)</option>
                  <option value="16:9">Landscape (16:9)</option>
                  <option value="9:16">Portrait (9:16)</option>
                </select>
              </div>

              <div>
                <label className="flex items-center gap-2 text-sm text-neutral-300 cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={keepLabels}
                    onChange={(e) => setKeepLabels(e.target.checked)}
                    className="w-4 h-4 rounded border-neutral-600 bg-neutral-700 text-indigo-600 focus:ring-indigo-500"
                    disabled={isProcessing}
                  />
                  Keep Labels & Annotations
                </label>
              </div>

              <div>
                <label className="text-sm text-neutral-400 block mb-2">Custom Prompt (Optional)</label>
                <textarea 
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="Additional instructions..."
                  className="w-full bg-neutral-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 h-24 resize-none"
                  disabled={isProcessing}
                />
              </div>
            </div>
          </div>

          {/* Main Content */}
          <div className="flex-1 flex flex-col bg-neutral-900">
            {/* Toolbar */}
            <div className="p-4 border-b border-white/10 flex items-center justify-between bg-neutral-800/30">
              <div className="flex items-center gap-3">
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileUpload} 
                  multiple 
                  accept="image/*,.zip,.pdf" 
                  className="hidden" 
                />
                <input 
                  type="file" 
                  ref={folderInputRef} 
                  onChange={handleFileUpload} 
                  // @ts-ignore
                  webkitdirectory="true"
                  className="hidden" 
                />
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isProcessing}
                  className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2 border border-white/10 disabled:opacity-50"
                >
                  <Upload className="w-4 h-4" />
                  Add Files
                </button>
                <button 
                  onClick={() => folderInputRef.current?.click()}
                  disabled={isProcessing}
                  className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2 border border-white/10 disabled:opacity-50"
                >
                  <FolderOpen className="w-4 h-4" />
                  Add Folder
                </button>
                {items.length > 0 && (
                  <button 
                    onClick={removeAll}
                    disabled={isProcessing}
                    className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg font-medium transition-colors disabled:opacity-50"
                  >
                    Clear All
                  </button>
                )}
              </div>
              
              <div className="flex items-center gap-3">
                {items.some(i => i.status === 'success') && (
                  <button 
                    onClick={downloadAll}
                    disabled={isProcessing}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium transition-colors flex items-center gap-2 shadow-lg shadow-emerald-900/20 disabled:opacity-50"
                  >
                    <Download className="w-4 h-4" />
                    Download All
                  </button>
                )}
                {items.some(i => i.status === 'success') && (
                  <button 
                    onClick={extractHotspotsBatch}
                    disabled={isProcessing}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-medium transition-colors flex items-center gap-2 shadow-lg shadow-purple-900/20 disabled:opacity-50"
                  >
                    <Target className="w-4 h-4" />
                    Extract Hotspots
                  </button>
                )}
                
                <button 
                  onClick={startBatch}
                  disabled={isProcessing || items.filter(i => i.status === 'pending' || i.status === 'error').length === 0}
                  className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-colors flex items-center gap-2 shadow-lg shadow-indigo-900/20 disabled:opacity-50"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    'Start Batch'
                  )}
                </button>
              </div>
            </div>

            {/* Progress Bar */}
            {isProcessing && (
              <div className="h-1 bg-neutral-800 w-full">
                <div 
                  className="h-full bg-indigo-500 transition-all duration-300 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}

            {/* Item List */}
            <div className="flex-1 overflow-y-auto p-6">
              {items.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-neutral-500">
                  <Upload className="w-12 h-12 mb-4 opacity-50" />
                  <p className="text-lg font-medium text-neutral-400">No images added</p>
                  <p className="text-sm mt-2">Upload images or a ZIP file to begin</p>
                </div>
              ) : (
                <div className="space-y-8">
                  {(() => {
                    const groups = items.reduce((acc, item) => {
                      if (!acc[item.groupName]) acc[item.groupName] = [];
                      acc[item.groupName].push(item);
                      return acc;
                    }, {} as Record<string, BatchItem[]>);
                    
                    return Object.entries(groups).map(([groupName, groupItems]) => (
                      <div key={groupName}>
                        <h3 className="text-lg font-medium text-white mb-4">{groupName}</h3>
                        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                          {(groupItems as BatchItem[]).map(item => (
                            <div key={item.id} className="bg-neutral-800 rounded-xl border border-white/5 overflow-hidden flex flex-col cursor-pointer group" onClick={() => { setSelectedItem(item); setRefinePrompt(''); }}>
                              <div className="aspect-square relative bg-neutral-900/50">
                                <img 
                                  src={item.enhancedDataUri || item.originalDataUri || null} 
                                  alt={item.filename}
                                  className="w-full h-full object-contain p-2 group-hover:scale-105 transition-transform duration-200"
                                />
                                {item.status === 'processing' && (
                                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center backdrop-blur-sm">
                                    <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
                                  </div>
                                )}
                              {item.status === 'success' && (
                                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); approveItem(item.id); }}
                                    className="bg-emerald-500 text-white p-1 rounded-full shadow-lg hover:bg-emerald-600 transition-colors"
                                    title="Approve"
                                  >
                                    <CheckCircle2 className="w-4 h-4" />
                                  </button>
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); refineItem(item.id); }}
                                    className="bg-indigo-500 text-white p-1 rounded-full shadow-lg hover:bg-indigo-600 transition-colors"
                                    title="Refine"
                                  >
                                    <RefreshCw className="w-4 h-4" />
                                  </button>
                                </div>
                              )}
                              {item.status === 'approved' && (
                                <div className="absolute top-2 right-2 bg-emerald-600 text-white p-1 rounded-full shadow-lg">
                                  <CheckCircle2 className="w-4 h-4" />
                                </div>
                              )}
                              {item.status === 'error' && (
                                <div className="absolute top-2 right-2 bg-red-500 text-white p-1 rounded-full shadow-lg" title={item.error}>
                                  <AlertCircle className="w-4 h-4" />
                                </div>
                              )}
                              </div>
                              <div className="p-3 border-t border-white/5 bg-neutral-800/80">
                                <p className="text-xs text-white truncate font-medium" title={item.filename}>{item.filename}</p>
                                <p className="text-[10px] text-neutral-400 mt-1 capitalize">
                                  {item.status === 'error' ? <span className="text-red-400 truncate block">{item.error}</span> : item.status.replace('_', ' ')}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              )}
            </div>
          </div>
        </div>
        
        {/* Review Modal */}
        {selectedItem && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4" onClick={() => setSelectedItem(null)}>
            <div className="max-w-4xl w-full max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold text-white">{selectedItem.filename}</h3>
                <button onClick={() => setSelectedItem(null)} className="text-neutral-400 hover:text-white">
                  <X className="w-8 h-8" />
                </button>
              </div>
              <img 
                src={selectedItem.enhancedDataUri || selectedItem.originalDataUri || null} 
                alt={selectedItem.filename}
                className="w-full h-full object-contain rounded-lg"
              />
              <div className="mt-4 flex gap-2">
                <input 
                  type="text" 
                  value={refinePrompt} 
                  onChange={(e) => setRefinePrompt(e.target.value)}
                  placeholder="Enter refinement instructions..."
                  className="flex-1 bg-neutral-800 border border-white/10 rounded-lg px-3 py-2 text-white"
                />
                <button 
                  onClick={() => {
                    refineItem(selectedItem.id, refinePrompt);
                    setSelectedItem(null);
                    setRefinePrompt('');
                  }}
                  className="bg-indigo-600 text-white px-4 py-2 rounded-lg"
                >
                  Refine
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
