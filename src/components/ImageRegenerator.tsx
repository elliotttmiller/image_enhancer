import React, { useState, useRef, ChangeEvent } from 'react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { Upload, X, Loader2, Sparkles, Download, FolderOpen, RefreshCw, AlertCircle } from 'lucide-react';
import { regenerateImage, refineImage } from '../lib/gemini';
import { AspectRatioOption, ImageSize, ModelVersion, ASPECT_RATIO_LABELS } from '../types';

interface RegenerationItem {
  id: string;
  filename: string;
  originalDataUri: string;
  generatedDataUri?: string;
  status: 'pending' | 'processing' | 'success' | 'error';
  error?: string;
}

interface ImageRegeneratorProps {
  onClose: () => void;
}

export function ImageRegenerator({ onClose }: ImageRegeneratorProps) {
  const [items, setItems] = useState<RegenerationItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<RegenerationItem | null>(null);
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  
  const [aspectRatio, setAspectRatio] = useState<AspectRatioOption>('auto');
  const [imageSize, setImageSize] = useState<ImageSize>('4K');
  const [model, setModel] = useState<ModelVersion>('gemini-3.1-flash-image-preview');
  const [mode, setMode] = useState<'creative' | 'clone'>('creative');
  const [customPrompt, setCustomPrompt] = useState("");
  
  const [refinePrompt, setRefinePrompt] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newItems: RegenerationItem[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      if (file.name.endsWith('.zip')) {
        const zip = new JSZip();
        const loadedZip = await zip.loadAsync(file);
        for (const [filename, zipEntry] of Object.entries(loadedZip.files)) {
          if (!zipEntry.dir && filename.match(/\.(jpg|jpeg|png|webp)$/i)) {
            const base64 = await zipEntry.async('base64');
            const ext = filename.split('.').pop()?.toLowerCase();
            const mimeType = ext === 'jpg' ? 'jpeg' : ext;
            newItems.push({
              id: Math.random().toString(36).substring(2, 11),
              filename,
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
          originalDataUri: dataUri,
          status: 'pending',
        });
      }
    }

    setItems((prev: RegenerationItem[]) => [...prev, ...newItems]);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (folderInputRef.current) folderInputRef.current.value = '';
  };

  const startBatch = async () => {
    if (items.length === 0) return;
    setIsProcessing(true);
    setProgress(0);

    const pendingItems = items.filter((item: RegenerationItem) => item.status === 'pending' || item.status === 'error');
    
    // Creative mode is heavier, Clone mode is faster (lower temperature). Scale concurrency accordingly.
    const CONCURRENCY_LIMIT = mode === 'clone' ? 5 : 2;
    
    let processedCount = 0;
    
    const processItem = async (item: RegenerationItem) => {
      setItems((prev: RegenerationItem[]) => prev.map((p: RegenerationItem) => p.id === item.id ? { ...p, status: 'processing', error: undefined } : p));

      try {
        const [mimeTypePrefix, base64Data] = item.originalDataUri.split(';base64,');
        const mimeType = mimeTypePrefix.split(':')[1];
        
        const result = await regenerateImage(
          base64Data,
          mimeType,
          customPrompt,
          aspectRatio,
          imageSize,
          model,
          mode
        );

        setItems(prev => prev.map(p => p.id === item.id ? { 
          ...p, 
          status: 'success', 
          generatedDataUri: result.imageUrl,
        } : p));
      } catch (error: any) {
        console.error(`Error processing ${item.filename}:`, error);
        setItems(prev => prev.map(p => p.id === item.id ? { 
          ...p, 
          status: 'error', 
          error: error.message || 'Unknown error' 
        } : p));
      } finally {
        processedCount++;
        setProgress((processedCount / pendingItems.length) * 100);
      }
    };

    const queue = [...pendingItems];
    const workers = Array(Math.min(CONCURRENCY_LIMIT, queue.length))
      .fill(null)
      .map(async (_, index) => {
        // Stagger the initial startup to prevent instantaneous rate-limit burst
        await new Promise(r => setTimeout(r, index * 600));

        while (queue.length > 0) {
          const item = queue.shift();
          if (item) {
            await processItem(item);
            // Crucial spacing between items to maintain smooth API quota allocation for 100+ requests
            await new Promise(r => setTimeout(r, 1200)); 
          }
        }
      });
    
    await Promise.all(workers);
    setIsProcessing(false);
  };

  const refineItem = async (id: string, prompt?: string) => {
    const item = items.find((p: RegenerationItem) => p.id === id);
    if (!item?.generatedDataUri) return;

    setItems(prev => prev.map(p => p.id === id ? { ...p, status: 'processing', error: undefined } : p));

    try {
      const [mimeTypePrefix, base64Data] = item.generatedDataUri.split(';base64,');
      const mimeType = mimeTypePrefix.split(':')[1];
      
      const result = await refineImage(
        base64Data,
        mimeType,
        prompt || customPrompt,
        aspectRatio,
        imageSize,
        model,
        mode
      );

      setItems(prev => prev.map(p => p.id === id ? { 
        ...p, 
        status: 'success', 
        generatedDataUri: result.imageUrl 
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

  const downloadAll = async () => {
    const zip = new JSZip();
    const successfulItems = items.filter((item: RegenerationItem) => item.status === 'success' && item.generatedDataUri);
    
    if (successfulItems.length === 0) return;

    successfulItems.forEach((item: RegenerationItem) => {
      const base64Data = item.generatedDataUri!.split(',')[1];
      zip.file(item.filename, base64Data, { base64: true });
    });

    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, 'regenerated_images.zip');
  };

  const removeAll = () => {
    if (confirm('Are you sure you want to clear all items?')) {
      setItems([]);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col p-4 sm:p-8 overflow-y-auto">
      <div className="max-w-7xl mx-auto w-full bg-neutral-900 border border-white/10 rounded-2xl flex flex-col shadow-2xl relative min-h-125 h-full max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/5 bg-neutral-800/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-500/20 rounded-xl flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Bulk Image Regenerator</h2>
              <p className="text-sm text-neutral-400">Process single images or ZIP files into photorealistic renders</p>
            </div>
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
                <label className="text-sm text-neutral-400 block mb-2">Generation Mode</label>
                <div className="grid grid-cols-2 gap-2">
                  <button 
                    onClick={() => setMode('creative')}
                    className={`px-3 py-2 text-sm rounded-lg border ${mode === 'creative' ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-neutral-800 border-white/10 text-neutral-400'} transition-colors`}
                  >
                    Creative
                  </button>
                  <button 
                    onClick={() => setMode('clone')}
                    className={`px-3 py-2 text-sm rounded-lg border ${mode === 'clone' ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-neutral-800 border-white/10 text-neutral-400'} transition-colors`}
                  >
                    1:1 Clone
                  </button>
                </div>
              </div>

              <div>
                <label className="text-sm text-neutral-400 block mb-2">Model</label>
                <select 
                  value={model}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) => setModel(e.target.value as ModelVersion)}
                  className="w-full bg-neutral-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  disabled={isProcessing}
                >
                  <option value="gemini-3.1-flash-image-preview">Gemini 3.1 Flash Image</option>
                  <option value="gemini-3-pro-image-preview">Gemini 3 Pro Image</option>
                  <option value="gemini-2.5-flash-image">Gemini 2.5 Flash Image</option>
                </select>
              </div>

              <div>
                <label className="text-sm text-neutral-400 block mb-2">Aspect Ratio</label>
                <select 
                  value={aspectRatio}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) => setAspectRatio(e.target.value as AspectRatioOption)}
                  className="w-full bg-neutral-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  disabled={isProcessing}
                >
                   <option value="auto">Auto-detect</option>
                   {Object.entries({
                        ...ASPECT_RATIO_LABELS,
                        "1:4": "1:4 (Narrow)",
                        "4:1": "4:1 (Banner)",
                        "1:8": "1:8 (Ultra-Narrow)",
                        "8:1": "8:1 (Ultra-Wide)",
                      }).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                </select>
              </div>

              <div>
                <label className="text-sm text-neutral-400 block mb-2">Image Size</label>
                <select 
                  value={imageSize}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) => setImageSize(e.target.value as ImageSize)}
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
                 <label className="text-sm text-neutral-400 block mb-2">Additional Instructions (Optional)</label>
                 <textarea 
                   value={customPrompt}
                   onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setCustomPrompt(e.target.value)}
                   placeholder="e.g., Make it look like brushed aluminum, set in a dramatic studio light..."
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
                  accept="image/*,.zip" 
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
                  Add Files / ZIP
                </button>
                <button 
                  onClick={() => folderInputRef.current?.click()}
                  disabled={isProcessing}
                  className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2 border border-white/10 disabled:opacity-50"
                  title="Select Folder"
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
                {items.some((i: RegenerationItem) => i.status === 'success') && (
                  <button 
                    onClick={downloadAll}
                    disabled={isProcessing}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium transition-colors flex items-center gap-2 shadow-lg shadow-emerald-900/20 disabled:opacity-50"
                  >
                    <Download className="w-4 h-4" />
                    Download All ZIP
                  </button>
                )}
                
                <button 
                  onClick={startBatch}
                  disabled={isProcessing || items.filter((i: RegenerationItem) => i.status === 'pending' || i.status === 'error').length === 0}
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
                  <p className="text-sm mt-2">Upload multiple images or a ZIP file to begin generating.</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {items.map((item: RegenerationItem) => (
                    <div key={item.id} className="bg-neutral-800 rounded-xl border border-white/5 overflow-hidden flex flex-col cursor-pointer group hover:border-indigo-500/50" onClick={() => { setSelectedItem(item); setRefinePrompt(''); }}>
                      <div className="aspect-square relative bg-neutral-900/50 border-b border-white/5">
                        <img 
                          src={item.generatedDataUri || item.originalDataUri} 
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
                              onClick={(e: React.MouseEvent) => { e.stopPropagation(); refineItem(item.id); }}
                              className="bg-indigo-500 text-white p-1.5 rounded-full shadow-lg hover:bg-indigo-600 transition-colors"
                              title="Refine Image"
                            >
                              <RefreshCw className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                        {item.status === 'error' && (
                          <div className="absolute top-2 right-2 bg-red-500 text-white p-1 rounded-full shadow-lg" title={item.error}>
                            <AlertCircle className="w-4 h-4" />
                          </div>
                        )}
                      </div>
                      <div className="p-3 bg-neutral-800/80 max-w-full">
                        <p className="text-xs text-white truncate font-medium max-w-full" title={item.filename}>{item.filename}</p>
                        <p className="text-[10px] text-neutral-400 mt-1 capitalize max-w-full">
                          {item.status === 'error' ? <span className="text-red-400 truncate block w-full">{item.error}</span> : item.status}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        
        {/* Review Modal */}
        {selectedItem && (
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/90 p-4" onClick={() => setSelectedItem(null)}>
            <div className="max-w-4xl w-full max-h-[90vh] flex flex-col" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold text-white">{selectedItem.filename}</h3>
                <button onClick={() => setSelectedItem(null)} className="text-neutral-400 hover:text-white">
                  <X className="w-8 h-8" />
                </button>
              </div>
              <div className={`relative aspect-auto max-h-[70vh] bg-neutral-900 border border-white/10 rounded-lg overflow-hidden shrink-0 grid ${selectedItem.generatedDataUri ? 'grid-cols-2 gap-px bg-white/10' : 'grid-cols-1'} items-center justify-center`}>
                <div className="relative w-full h-full flex flex-col bg-black min-h-75">
                  {selectedItem.generatedDataUri && (
                    <div className="absolute top-2 left-2 z-10 bg-black/60 backdrop-blur-md px-2 py-1 rounded-md text-xs font-medium text-white border border-white/10">Original</div>
                  )}
                  <img 
                    src={selectedItem.originalDataUri} 
                    alt={`Original ${selectedItem.filename}`}
                    className="w-full h-full object-contain p-2"
                  />
                </div>
                {selectedItem.generatedDataUri && (
                  <div className="relative w-full h-full flex flex-col bg-black min-h-75">
                    <div className="absolute top-2 left-2 z-10 bg-indigo-500/80 backdrop-blur-md px-2 py-1 rounded-md text-xs font-medium text-white border border-indigo-500/50">Regenerated</div>
                    <img 
                      src={selectedItem.generatedDataUri} 
                      alt={`Regenerated ${selectedItem.filename}`}
                      className="w-full h-full object-contain p-2"
                    />
                  </div>
                )}
              </div>
              {selectedItem.status === 'success' && (
                <div className="mt-4 flex gap-2 shrink-0">
                  <input 
                    type="text" 
                    value={refinePrompt} 
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setRefinePrompt(e.target.value)}
                    placeholder="Enter refinement instructions to fix this generated image..."
                    className="flex-1 bg-neutral-800 border border-white/10 rounded-lg px-3 py-2 text-white"
                  />
                  <button 
                    onClick={() => {
                      refineItem(selectedItem.id, refinePrompt);
                      setSelectedItem(null);
                      setRefinePrompt('');
                    }}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2 rounded-lg font-medium"
                  >
                    Refine
                  </button>
                </div>
              )}

            </div>
          </div>
        )}
      </div>
    </div>
  );
}
