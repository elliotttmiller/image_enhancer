import React, { useState, useRef, useEffect, useCallback } from "react";
import { motion } from "motion/react";
import { Upload, Sparkles, Download, RefreshCw, AlertCircle, Image as ImageIcon, Key, Plus, FolderOpen, Trash2, ArrowLeft, Grid, Settings2, Wand2, Cpu, MessageSquare, Eye, EyeOff, List, Copy, Check, ChevronDown, FileText, X } from "lucide-react";
import { enhanceSchematic, refineSchematic, extractHotspots, refineHotspots, type SchematicStyle } from "./lib/gemini";
import { convertPdfToImage } from "./lib/pdf-utils";
import { Project, AspectRatioOption, ImageSize, GeneratedImage, ASPECT_RATIO_LABELS, Hotspot } from "./types";
import { BatchProcessor } from "./components/BatchProcessor";
import { SchematicLegendProcessor } from "./components/SchematicLegendProcessor";
import { auditAndUpdateJson } from "./lib/schematic-legend-processor";
import { WorkflowPipeline } from "./components/WorkflowPipeline";
import { ImageRegenerator } from "./components/ImageRegenerator";

export default function App() {
  const AVAILABLE_STYLES: SchematicStyle[] = [
    "modern",
    "blueprint",
    "patent",
    "artistic",
    "minimalist",
    "isometric",
    "vintage",
    "realistic",
    "production",
    "hybrid-realism",
  ];

  const formatStyleLabel = (style: SchematicStyle) =>
    style
      .split("-")
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join(" ");
  // Global State
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [hasApiKey, setHasApiKey] = useState(false);
  
  // Editor State (derived from current project or local state for new uploads)
  const [isProcessing, setIsProcessing] = useState(false);
  const [isBatchProcessorOpen] = useState(false);
  const [isSchematicLegendProcessorOpen, setIsSchematicLegendProcessorOpen] = useState(false);
  const [isWorkflowPipelineOpen, setIsWorkflowPipelineOpen] = useState(false);
  const [isImageRegeneratorOpen, setIsImageRegeneratorOpen] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refinePrompt, setRefinePrompt] = useState("");
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null); // For gallery selection
  const fileInputRef = useRef<HTMLInputElement>(null);
  const refineFileInputRef = useRef<HTMLInputElement>(null);
  const extractFileInputRef = useRef<HTMLInputElement>(null);
  const referenceFileInputRef = useRef<HTMLInputElement>(null);

  const [showHotspots, setShowHotspots] = useState(true);
  const [draggingHotspotId, setDraggingHotspotId] = useState<string | null>(null);
  const draggingHotspotIdRef = useRef<string | null>(null);
  const [copied, setCopied] = useState(false);
  const dragStartPos = useRef<{x: number, y: number} | null>(null);
  const dragStartBox = useRef<[number, number, number, number] | null>(null);

  // Derived state for current project
  const currentProject = projects.find(p => p.id === currentProjectId);
  const currentProjectRef = useRef(currentProject);

  useEffect(() => {
    currentProjectRef.current = currentProject;
  }, [currentProject]);

  useEffect(() => {
    if (!draggingHotspotId) return;

    const handlePointerMove = (e: PointerEvent) => {
      console.log("handlePointerMove", draggingHotspotIdRef.current, dragStartPos.current, dragStartBox.current);
      if (!draggingHotspotIdRef.current || !dragStartPos.current || !dragStartBox.current) return;
      
      const project = currentProjectRef.current;
      if (!project) return;
      
      const container = document.getElementById('image-container');
      if (!container) return;
      
      const rect = container.getBoundingClientRect();
      
      const deltaX = e.clientX - dragStartPos.current.x;
      const deltaY = e.clientY - dragStartPos.current.y;
      
      const deltaXScaled = (deltaX / rect.width) * 100;
      const deltaYScaled = (deltaY / rect.height) * 100;
      
      const [ymin, xmin, ymax, xmax] = dragStartBox.current;
      
      let newYmin = ymin + deltaYScaled;
      let newXmin = xmin + deltaXScaled;
      let newYmax = ymax + deltaYScaled;
      let newXmax = xmax + deltaXScaled;
      
      const height = ymax - ymin;
      const width = xmax - xmin;
      
      if (newXmin < 0) { newXmin = 0; newXmax = width; }
      if (newYmin < 0) { newYmin = 0; newYmax = height; }
      if (newXmax > 100) { newXmax = 100; newXmin = 100 - width; }
      if (newYmax > 100) { newYmax = 100; newYmin = 100 - height; }
      
      const updatedHotspots = project.hotspots?.map(h => {
        if (h.id === draggingHotspotIdRef.current) {
          const x_pct = newXmin + (width / 2);
          const y_pct = newYmin + (height / 2);

          return { 
            ...h, 
            box_2d: [newYmin * 10, newXmin * 10, newYmax * 10, newXmax * 10] as [number, number, number, number],
            x_pct,
            y_pct,
            bbox: { 
              x: Number(newXmin.toFixed(2)), 
              y: Number(newYmin.toFixed(2)), 
              w: Number(width.toFixed(2)), 
              h: Number(height.toFixed(2)) 
            }
          };
        }
        return h;
      });
      
      updateProject(project.id, { hotspots: updatedHotspots });
    };

    const handlePointerUp = () => {
      setDraggingHotspotId(null);
      draggingHotspotIdRef.current = null;
      dragStartPos.current = null;
      dragStartBox.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [draggingHotspotId]);

  // Reset selected image when project changes
  useEffect(() => {
    if (currentProject?.generatedImages?.length) {
      setSelectedImageId(prev => {
        const exists = currentProject.generatedImages?.find(img => img.id === prev);
        return exists ? prev : currentProject.generatedImages![0].id;
      });
    } else {
      setSelectedImageId(null);
    }
  }, [currentProjectId, currentProject?.generatedImages]);

  useEffect(() => {
    // We are now decoupled from AI Studio's API Key injected credential 
    // and rely on our full-stack Express Backend for Vertex AI.
    setHasApiKey(true);
  }, []);

  const checkApiKey = async () => {
    // Deprecated for Vertex AI
    setHasApiKey(true);
  };

  const handleSelectKey = async () => {
    // Deprecated for Vertex AI
  };

  const createProject = (originalImage: string | null, name: string = "Untitled Project", workflowType: "generate" | "refine" | "extract" | "batch" = "generate", id?: string) => {
    const newProject: Project = {
      id: id || Date.now().toString(),
      name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      workflowType,
      originalImage: originalImage || "",
      enhancedImage: (workflowType === "refine" || workflowType === "extract") ? originalImage : null,
      styles: ["modern"],
      keepLabels: true,
      aspectRatio: (workflowType === "refine" || workflowType === "extract") ? "auto" : "1:1",
      aspectRatios: (workflowType === "refine" || workflowType === "extract") ? ["auto"] : ["1:1"],
      isMultiRatio: false,
      generatedImages: [],
      imageSize: "1K",
      model: "gemini-3.1-flash-image-preview",
      customPrompt: "",
    };
    setProjects(prev => [newProject, ...prev]);
    setCurrentProjectId(newProject.id);
  };

  const updateProject = useCallback((id: string, updates: Partial<Project>) => {
    setProjects(prev => prev.map(p => p.id === id ? { ...p, ...updates, updatedAt: Date.now() } : p));
  }, [setProjects]);

  const deleteProject = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("Are you sure you want to delete this project?")) {
      setProjects(prev => prev.filter(p => p.id !== id));
      if (currentProjectId === id) {
        setCurrentProjectId(null);
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file, "generate");
    }
  };

  const handleExistingJsonUpload = (projectId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    
    const jsonFile = e.target.files[0];
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const jsonData = JSON.parse(reader.result as string);
        updateProject(projectId, { existingJsonFile: jsonFile, existingJsonData: jsonData });
      } catch (err) {
        console.error("Failed to parse JSON file", err);
        alert("Invalid JSON file.");
      }
    };
    reader.readAsText(jsonFile);
  };

  const handleRefineFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file, "refine");
    }
  };

  const handleExtractFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file, "extract");
    }
  };

  const handleReferenceFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0 && currentProject) {
      const newRefs: { url: string; mimeType: string }[] = [];
      let loadedCount = 0;

      files.forEach((file: File) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const result = e.target?.result as string;
          newRefs.push({ url: result, mimeType: file.type });
          loadedCount++;
          
          if (loadedCount === files.length) {
            const existingRefs = currentProject.referenceImages || [];
            updateProject(currentProject.id, { 
              referenceImages: [...existingRefs, ...newRefs]
            });
          }
        };
        reader.readAsDataURL(file);
      });
    }
  };

  const processFile = async (file: File, workflowType: "generate" | "refine" | "extract" = "generate") => {
    setError(null);
    setIsProcessing(true);
    
    try {
      if (file.type === "application/pdf") {
        const pagesData = await convertPdfToImage(file);
        // Process each page as a separate project
        for (let i = 0; i < pagesData.length; i++) {
            createProject(pagesData[i].dataUri, `${file.name.replace(/\.[^/.]+$/, "")}_page_${i + 1}`, workflowType, `${Date.now()}_${i}`);
        }
      } else if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = (e) => {
          const result = e.target?.result as string;
          createProject(result, file.name.replace(/\.[^/.]+$/, ""), workflowType);
        };
        reader.readAsDataURL(file);
      } else {
        setError("Please upload a valid image or PDF file.");
      }
    } catch (err) {
      console.error("Error processing file:", err);
      setError(err instanceof Error ? err.message : "Failed to process file. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleEnhance = async () => {
    if (!currentProject) return;

    setIsProcessing(true);
    setError(null);
    // Clear enhanced image to show loading state
    updateProject(currentProject.id, { enhancedImage: null, generatedImages: [] });

    try {
      const [mimeTypePrefix, base64Data] = currentProject.originalImage.split(';base64,');
      const mimeType = mimeTypePrefix.split(':')[1];

      const ratiosToProcess = currentProject.isMultiRatio && currentProject.aspectRatios && currentProject.aspectRatios.length > 0
        ? currentProject.aspectRatios
        : [currentProject.aspectRatio];

      const newGeneratedImages: GeneratedImage[] = [];

      // Process sequentially to avoid rate limits and better error handling per item
      for (const ratio of ratiosToProcess) {
        try {
          const result = await enhanceSchematic(
            base64Data, 
            mimeType, 
            currentProject.styles, 
            currentProject.keepLabels,
            ratio,
            currentProject.imageSize,
            currentProject.model,
            currentProject.customPrompt,
            true, // preserveGeometry
            true, // enhanceDetails
            "high", // outputQuality
            currentProject.referenceImages
          );
          
          newGeneratedImages.push({
            id: Date.now().toString() + Math.random().toString(36).substring(2, 11),
            aspectRatio: result.aspectRatio,
            imageUrl: result.imageUrl,
            createdAt: Date.now()
          });
        } catch (e) {
          console.error(`Failed to generate for ratio ${ratio}`, e);
          // Continue with other ratios if one fails
        }
      }

      if (newGeneratedImages.length === 0) {
        throw new Error("Failed to generate any images.");
      }

      updateProject(currentProject.id, { 
        enhancedImage: newGeneratedImages[0].imageUrl,
        generatedImages: newGeneratedImages,
        hotspots: undefined
      });
      setSelectedImageId(newGeneratedImages[0].id);

    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to enhance image. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRefine = async () => {
    if (!currentProject || !refinePrompt.trim()) return;

    setIsProcessing(true);
    setError(null);
    
    try {
      // Check if we have multiple generated images
      if (currentProject.generatedImages && currentProject.generatedImages.length > 0) {
        const updatedImages: GeneratedImage[] = [];
        let successCount = 0;
        
        // Process all images sequentially
        for (const img of currentProject.generatedImages) {
           try {
             console.log(`Refining image ${img.id} (${img.aspectRatio})...`);
             const [mimeTypePrefix, base64Data] = img.imageUrl.split(';base64,');
             const mimeType = mimeTypePrefix.split(':')[1];
             
             const result = await refineSchematic(
               base64Data,
               mimeType,
               refinePrompt,
               img.aspectRatio,
               currentProject.imageSize,
               currentProject.model,
               currentProject.referenceImages
             );
             
             updatedImages.push({
               ...img,
               aspectRatio: result.aspectRatio,
               imageUrl: result.imageUrl,
               createdAt: Date.now()
             });
             successCount++;
           } catch (e) {
             console.error(`Failed to refine image ${img.id}`, e);
             // Keep original if failed, but maybe mark it or notify user?
             updatedImages.push(img); 
           }
        }
        
        if (successCount === 0) {
          throw new Error("Failed to refine any images. Please try again.");
        }

        // Update project
        const newSelectedImage = selectedImageId 
          ? updatedImages.find(img => img.id === selectedImageId) 
          : updatedImages[0];
          
        updateProject(currentProject.id, {
          generatedImages: updatedImages,
          enhancedImage: newSelectedImage?.imageUrl || updatedImages[0].imageUrl,
          hotspots: undefined
        });

      } else if (currentProject.enhancedImage) {
        // Single image case
        const [mimeTypePrefix, base64Data] = currentProject.enhancedImage.split(';base64,');
        const mimeType = mimeTypePrefix.split(':')[1];

        const result = await refineSchematic(
          base64Data,
          mimeType,
          refinePrompt,
          currentProject.aspectRatio,
          currentProject.imageSize,
          currentProject.model,
          currentProject.referenceImages
        );
        updateProject(currentProject.id, { enhancedImage: result.imageUrl, hotspots: undefined });
      }

      setRefinePrompt(""); // Clear prompt on success
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refine image. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownload = () => {
    if (currentProject?.enhancedImage) {
      const link = document.createElement("a");
      link.href = currentProject.enhancedImage;
      link.download = `${currentProject.name}-enhanced.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const handleExtractHotspots = useCallback(async () => {
    if (isProcessing) return;
    console.log("[DEBUG] handleExtractHotspots: Starting extraction pipeline");
    const targetImage = currentProject?.generatedImages?.find(img => img.id === selectedImageId)?.imageUrl || currentProject?.enhancedImage;
    
    if (!targetImage) {
      console.error("[DEBUG] handleExtractHotspots: No target image found");
      return;
    }
    if (!currentProject) {
      console.error("[DEBUG] handleExtractHotspots: No current project found");
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      console.log("[DEBUG] handleExtractHotspots: Processing image data");
      const [mimeTypePrefix, base64Data] = targetImage.split(';base64,');
      const mimeType = mimeTypePrefix.split(':')[1];

      // Get natural dimensions for precise coordinate remapping
      const img = new Image();
      img.src = targetImage;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });
      const naturalWidth = img.naturalWidth;
      const naturalHeight = img.naturalHeight;
      console.log(`[DEBUG] handleExtractHotspots: Image loaded. Dimensions: ${naturalWidth}x${naturalHeight}`);

      console.log("[DEBUG] handleExtractHotspots: Calling extractHotspots");
      const rawHotspots = await extractHotspots(base64Data, mimeType);
      console.log(`[DEBUG] handleExtractHotspots: extractHotspots returned ${rawHotspots.length} hotspots`, rawHotspots);
      
      console.log("[DEBUG] handleExtractHotspots: Calling refineHotspots");
      const refinedHotspots = await refineHotspots(base64Data, mimeType, rawHotspots);
      console.log(`[DEBUG] handleExtractHotspots: refineHotspots returned ${refinedHotspots.length} hotspots`, refinedHotspots);
      
      let finalHotspots = refinedHotspots;
      let updatedJsonData = currentProject.existingJsonData;
      let hotspotToPartMapping: Record<string, string> = {};

      if (currentProject.existingJsonData) {
        console.log("[DEBUG] handleExtractHotspots: Auditing and updating JSON");
        const result = await auditAndUpdateJson(base64Data, mimeType, refinedHotspots, currentProject.existingJsonData);
        updatedJsonData = result.updatedJsonData;
        
        console.log("[DEBUG] handleExtractHotspots: updatedJsonData parts:", updatedJsonData.parts);
        
        // Reverse mapping: partId -> hotspotId to hotspotId -> partId
        for (const [partId, hotspotId] of Object.entries(result.mapping)) {
          if (typeof hotspotId === 'string') {
            hotspotToPartMapping[hotspotId] = partId;
          }
        }
        console.log("[DEBUG] handleExtractHotspots: JSON audited and updated", hotspotToPartMapping);
      }
      
      // Map refinedHotspots to the new WordPress-optimized schema
      const hotspots: Hotspot[] = finalHotspots.map(raw => {
        // raw.box_2d is [ymin, xmin, ymax, xmax] normalized 0-1000
        const ymin_pct = (raw.box_2d[0] / 1000) * 100;
        const xmin_pct = (raw.box_2d[1] / 1000) * 100;
        const ymax_pct = (raw.box_2d[2] / 1000) * 100;
        const xmax_pct = (raw.box_2d[3] / 1000) * 100;

        const width_pct = xmax_pct - xmin_pct;
        const height_pct = ymax_pct - ymin_pct;
        
        // Coordinate Formula: center_x_pct = xmin_pct + (width_pct / 2)
        const x_pct = xmin_pct + (width_pct / 2);
        const y_pct = ymin_pct + (height_pct / 2);

        let woo_sku = undefined;
        let local_target_id = undefined;
        let displayLabel = raw.label;

        if (updatedJsonData && updatedJsonData.parts) {
          const partId = hotspotToPartMapping[raw.id];
          if (partId) {
            const matchedPart = updatedJsonData.parts.find((p: any) => p.id === partId);
            if (matchedPart) {
              woo_sku = matchedPart.sku;
              local_target_id = matchedPart.id;
              displayLabel = matchedPart.name || raw.label;
            }
          } else {
             // Fallback to string matching if AI didn't map it
             const cleanLabel = raw.label.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
             const matchedPart = updatedJsonData.parts.find((p: any) => 
               p.id.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() === cleanLabel ||
               p.sku.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() === cleanLabel
             );
             if (matchedPart) {
               woo_sku = matchedPart.sku;
               local_target_id = matchedPart.id;
               displayLabel = matchedPart.name || raw.label;
             }
          }
        }

        return {
          id: raw.id,
          label: displayLabel,
          x_pct,
          y_pct,
          shape: 'rectangle',
          confidence: raw.confidence,
          woo_sku,
          local_target_id,
          bbox: { 
            x: Number(xmin_pct.toFixed(2)), 
            y: Number(ymin_pct.toFixed(2)), 
            w: Number(width_pct.toFixed(2)), 
            h: Number(height_pct.toFixed(2)) 
          },
          box_2d: raw.box_2d,
          part_box_2d: raw.part_box_2d,
        };
      });

      updateProject(currentProject.id, { 
        hotspots,
        existingJsonData: updatedJsonData,
        image_natural_width: naturalWidth,
        image_natural_height: naturalHeight,
        schema_version: "1.0",
        image_filename: currentProject.name.toLowerCase().replace(/\s+/g, '_') + '.png'
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to extract hotspots. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  }, [currentProject, selectedImageId, updateProject, isProcessing]);

  if (!hasApiKey) {
    return (
      <div className="min-h-screen bg-neutral-900 text-neutral-100 font-sans flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full bg-neutral-800 rounded-2xl p-8 border border-white/10 text-center shadow-2xl"
        >
          <div className="w-16 h-16 bg-indigo-600/20 rounded-2xl flex items-center justify-center mx-auto mb-6 text-indigo-500">
            <Key className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-bold mb-3">API Key Required</h2>
          <p className="text-neutral-400 mb-8">
            To use the advanced schematic enhancement model, you need to select a paid Google Cloud project with the Gemini API enabled.
          </p>
          <button
            onClick={handleSelectKey}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
          >
            Select API Key
          </button>
          <p className="mt-6 text-xs text-neutral-500">
            <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noreferrer" className="underline hover:text-neutral-300">
              Learn more about billing
            </a>
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-900 text-neutral-100 font-sans selection:bg-indigo-500/30">
      {/* Header */}
      <header className="border-b border-white/10 bg-neutral-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => setCurrentProjectId(null)}>
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <span className="font-semibold text-lg tracking-tight">SchematicAI</span>
          </div>
          <div className="flex items-center gap-4">
            {currentProjectId && (
              <button 
                onClick={() => setCurrentProjectId(null)}
                className="text-sm text-neutral-400 hover:text-white transition-colors flex items-center gap-2"
              >
                <Grid className="w-4 h-4" />
                <span className="hidden sm:inline">Dashboard</span>
              </button>
            )}
            <span className="text-xs font-mono text-neutral-500 uppercase tracking-wider hidden sm:block border-l border-white/10 pl-4 ml-2">
              Production Grade Inference
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 sm:py-12">
        {!currentProjectId ? (
          /* Dashboard View */
          <div className="space-y-8">
            <div className="flex items-center justify-between">
              <h1 className="text-3xl font-bold">Projects</h1>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = '.json';
                    input.onchange = (e) => {
                      const file = (e.target as HTMLInputElement).files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = (e) => {
                          try {
                            const importedProjects = JSON.parse(e.target?.result as string);
                            if (Array.isArray(importedProjects)) {
                              setProjects(prev => [...importedProjects, ...prev]);
                            }
                          } catch (err) {
                            alert("Failed to import projects. Invalid JSON file.");
                          }
                        };
                        reader.readAsText(file);
                      }
                    };
                    input.click();
                  }}
                  className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2 border border-white/5"
                >
                  <Upload className="w-4 h-4" />
                  Import
                </button>
                <div className="relative">
                  <button
                    onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-colors flex items-center gap-2 shadow-lg shadow-indigo-900/20"
                  >
                    <Plus className="w-4 h-4" />
                    New Process
                    <ChevronDown className="w-4 h-4" />
                  </button>
                  {isDropdownOpen && (
                    <div className="absolute right-0 mt-2 w-48 bg-neutral-800 border border-white/10 rounded-lg shadow-xl z-50 overflow-hidden">
                      <button
                        onClick={() => { setIsDropdownOpen(false); fileInputRef.current?.click(); }}
                        className="w-full text-left px-4 py-2 hover:bg-neutral-700 text-white flex items-center gap-2"
                      >
                        <Plus className="w-4 h-4" />
                        New Project
                      </button>
                      <button
                        onClick={() => { setIsDropdownOpen(false); refineFileInputRef.current?.click(); }}
                        className="w-full text-left px-4 py-2 hover:bg-neutral-700 text-white flex items-center gap-2"
                      >
                        <Upload className="w-4 h-4" />
                        New Revision
                      </button>
                      <button
                        onClick={() => { setIsDropdownOpen(false); createProject(null, "New Batch Process", "batch"); }}
                        className="w-full text-left px-4 py-2 hover:bg-neutral-700 text-white flex items-center gap-2"
                      >
                        <List className="w-4 h-4" />
                        Batch Process
                      </button>
                      <button
                        onClick={() => { setIsDropdownOpen(false); extractFileInputRef.current?.click(); }}
                        className="w-full text-left px-4 py-2 hover:bg-neutral-700 text-white flex items-center gap-2"
                      >
                        <Sparkles className="w-4 h-4" />
                        Extract Hotspots
                      </button>
                      <button
                        onClick={() => { setIsDropdownOpen(false); setIsImageRegeneratorOpen(true); }}
                        className="w-full text-left px-4 py-2 hover:bg-neutral-700 text-white flex items-center gap-2"
                      >
                        <ImageIcon className="w-4 h-4 text-emerald-400" />
                        Image Regenerator
                      </button>
                      <button
                        onClick={() => { setIsDropdownOpen(false); setIsSchematicLegendProcessorOpen(true); }}
                        className="w-full text-left px-4 py-2 hover:bg-neutral-700 text-white flex items-center gap-2"
                      >
                        <FileText className="w-4 h-4" />
                        Schematic & Legend Correlation
                      </button>
                      <button
                        onClick={() => { setIsDropdownOpen(false); setIsWorkflowPipelineOpen(true); }}
                        className="w-full text-left px-4 py-2 hover:bg-neutral-700 text-white flex items-center gap-2 border-t border-white/5"
                      >
                        <Cpu className="w-4 h-4 text-indigo-400" />
                        All-in-One Pipeline
                      </button>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => {
                    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(projects));
                    const downloadAnchorNode = document.createElement('a');
                    downloadAnchorNode.setAttribute("href", dataStr);
                    downloadAnchorNode.setAttribute("download", "schematic_projects.json");
                    document.body.appendChild(downloadAnchorNode);
                    downloadAnchorNode.click();
                    downloadAnchorNode.remove();
                  }}
                  className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2 border border-white/5"
                  disabled={projects.length === 0}
                >
                  <Download className="w-4 h-4" />
                  Export
                </button>
              </div>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                accept="image/*,application/pdf"
                className="hidden"
              />
              <input
                type="file"
                ref={refineFileInputRef}
                onChange={handleRefineFileSelect}
                accept="image/*,application/pdf"
                className="hidden"
              />
              <input
                type="file"
                ref={extractFileInputRef}
                onChange={handleExtractFileSelect}
                accept="image/*,application/pdf"
                className="hidden"
              />
            </div>

            {projects.length === 0 ? (
              <div className="text-center py-20 border-2 border-dashed border-white/5 rounded-3xl bg-white/5">
                <div className="w-16 h-16 bg-neutral-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <FolderOpen className="w-8 h-8 text-neutral-600" />
                </div>
                <h3 className="text-xl font-semibold mb-2">No projects yet</h3>
                <p className="text-neutral-500 mb-6">Upload a schematic (Image or PDF) to get started</p>
                <div className="flex flex-col items-center justify-center gap-4">
                  <div className="flex items-center justify-center gap-4">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="px-6 py-3 bg-neutral-800 hover:bg-neutral-700 text-white rounded-xl font-medium transition-colors inline-flex items-center gap-2"
                    >
                      <Upload className="w-4 h-4" />
                      Upload Schematic
                    </button>
                    <button
                      onClick={() => refineFileInputRef.current?.click()}
                      className="px-6 py-3 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 rounded-xl font-medium transition-colors inline-flex items-center gap-2 border border-emerald-500/30"
                    >
                      <Upload className="w-4 h-4" />
                      Upload Existing Diagram
                    </button>
                  </div>
                  <button
                    onClick={() => extractFileInputRef.current?.click()}
                    className="px-6 py-3 bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 rounded-xl font-medium transition-colors inline-flex items-center gap-2 border border-amber-500/30"
                  >
                    <Sparkles className="w-4 h-4" />
                    Extract Hotspots from Existing Diagram
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {projects.map((project) => (
                  <motion.div
                    key={project.id}
                    layoutId={`project-${project.id}`}
                    onClick={() => setCurrentProjectId(project.id)}
                    className="group bg-neutral-800/50 border border-white/5 rounded-2xl overflow-hidden hover:border-indigo-500/50 hover:shadow-xl hover:shadow-indigo-900/10 transition-all cursor-pointer relative"
                  >
                    <div className="aspect-video bg-neutral-900/50 relative overflow-hidden">
                      <img 
                        src={project.enhancedImage || project.originalImage || null} 
                        alt={project.name}
                        className="w-full h-full object-cover opacity-80 group-hover:opacity-100 group-hover:scale-105 transition-all duration-500"
                      />
                      <div className="absolute inset-0 bg-linear-to-t from-neutral-900/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="font-medium text-white group-hover:text-indigo-400 transition-colors truncate pr-4">
                            {project.name}
                          </h3>
                          <p className="text-xs text-neutral-500 mt-1">
                            {new Date(project.createdAt).toLocaleDateString()} • {project.styles?.map(formatStyleLabel).join(", ") || "Modern"}
                          </p>
                        </div>
                        <button
                          onClick={(e) => deleteProject(project.id, e)}
                          className="p-2 text-neutral-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* Editor View */
          currentProject && (
            <div className="max-w-6xl mx-auto">
              <div className="mb-6 flex items-center gap-4">
                <button 
                  onClick={() => setCurrentProjectId(null)}
                  className="p-2 hover:bg-white/5 rounded-lg transition-colors text-neutral-400 hover:text-white"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div>
                  <input
                    type="text"
                    value={currentProject.name}
                    onChange={(e) => updateProject(currentProject.id, { name: e.target.value })}
                    className="bg-transparent text-2xl font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500/50 rounded px-1 -ml-1 w-full max-w-md"
                  />
                  <p className="text-sm text-neutral-500">
                    Created {new Date(currentProject.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>

              <div className={`grid grid-cols-1 ${currentProject.workflowType === "extract" ? "lg:grid-cols-3" : "lg:grid-cols-2"} gap-8`}>
                {/* Left Panel: Controls & Original */}
                {currentProject.workflowType !== "extract" && (
                  <div className="space-y-6">
                  {/* Original Image Card */}
                  <div className="bg-neutral-800/30 rounded-2xl border border-white/5 overflow-hidden">
                    <div className="p-4 border-b border-white/5 flex items-center justify-between bg-neutral-800/50">
                      <h3 className="text-sm font-medium text-neutral-400 uppercase tracking-wider">
                        {currentProject.workflowType === "refine" ? "Uploaded Diagram" : "Original Input"}
                      </h3>
                    </div>
                    <div className="aspect-square p-6 flex items-center justify-center bg-neutral-900/30">
                      <img 
                        src={currentProject.originalImage || null} 
                        alt="Original" 
                        className="max-w-full max-h-full object-contain shadow-lg"
                      />
                    </div>
                  </div>

                  {/* Reference Image Card */}
                  {currentProject.workflowType !== "refine" && (
                    <div className="bg-neutral-800/30 rounded-2xl border border-white/5 overflow-hidden">
                      <div className="p-4 border-b border-white/5 flex items-center justify-between bg-neutral-800/50">
                        <h3 className="text-sm font-medium text-neutral-400 uppercase tracking-wider">
                          Real Product Reference (Optional)
                        </h3>
                        {currentProject.referenceImages && currentProject.referenceImages.length > 0 && (
                          <div className="flex gap-2">
                            <button
                              onClick={() => referenceFileInputRef.current?.click()}
                              className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                            >
                              <Plus className="w-3 h-3" /> Add More
                            </button>
                            <button
                              onClick={() => updateProject(currentProject.id, { referenceImages: [] })}
                              className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1"
                            >
                              <Trash2 className="w-3 h-3" /> Clear All
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="p-6 flex flex-col items-center justify-center bg-neutral-900/30 min-h-40">
                        {currentProject.referenceImages && currentProject.referenceImages.length > 0 ? (
                          <div className="flex flex-wrap gap-4 justify-center w-full">
                            {currentProject.referenceImages.map((ref, idx) => (
                              <div key={idx} className="relative group">
                                <img 
                                  src={ref.url || null} 
                                  alt={`Reference ${idx + 1}`} 
                                  className="w-24 h-24 object-cover shadow-lg rounded border border-white/10"
                                />
                                <button
                                  onClick={() => {
                                    const newRefs = [...currentProject.referenceImages!];
                                    newRefs.splice(idx, 1);
                                    updateProject(currentProject.id, { referenceImages: newRefs });
                                  }}
                                  className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-center">
                            <p className="text-sm text-neutral-500 mb-4">
                              Upload photos of the real product to improve colors, materials, and realism.
                            </p>
                            <button
                              onClick={() => referenceFileInputRef.current?.click()}
                              className="px-4 py-2 bg-neutral-700 hover:bg-neutral-600 text-white rounded-lg font-medium transition-colors inline-flex items-center gap-2 text-sm"
                            >
                              <Upload className="w-4 h-4" />
                              Upload Reference Photos
                            </button>
                          </div>
                        )}
                        <input
                          type="file"
                          ref={referenceFileInputRef}
                          onChange={handleReferenceFileSelect}
                          accept="image/*"
                          multiple
                          className="hidden"
                        />
                      </div>
                    </div>
                  )}

                  {/* Controls Card */}
                    <div className="bg-neutral-800/30 rounded-2xl border border-white/5 p-6 space-y-6">
                      
                      {/* Model Selection */}
                      <div>
                        <h4 className="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                          <Cpu className="w-3 h-3" /> AI Model
                        </h4>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                            onClick={() => updateProject(currentProject.id, { model: "gemini-3.1-flash-image-preview" })}
                            className={`px-3 py-2 rounded-lg text-sm font-medium transition-all border ${
                              currentProject.model === "gemini-3.1-flash-image-preview"
                              ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300'
                              : 'bg-neutral-700/50 border-transparent text-neutral-400 hover:bg-neutral-700'
                            }`}
                            >
                            Gemini 3.1 Flash Preview
                            </button>
                          <button
                            onClick={() => updateProject(currentProject.id, { model: "gemini-2.5-flash-image" })}
                            className={`px-3 py-2 rounded-lg text-sm font-medium transition-all border ${
                              currentProject.model === "gemini-2.5-flash-image"
                                ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300'
                                : 'bg-neutral-700/50 border-transparent text-neutral-400 hover:bg-neutral-700'
                            }`}
                          >
                            Gemini 2.5 Flash Image
                          </button>
                        </div>
                        <p className="text-xs text-neutral-500 mt-2">
                          Use Gemini 3.1 Flash Preview for best quality. Gemini 2.5 Flash Image is available as a fallback.
                        </p>
                      </div>

                      {currentProject.workflowType !== "refine" && (
                        <>
                          {/* Style Selection */}
                          <div>
                            <h4 className="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                              <Sparkles className="w-3 h-3" /> Generation Style (Select Multiple)
                            </h4>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                              {AVAILABLE_STYLES.map((style) => {
                                const isSelected = currentProject.styles?.includes(style);
                                return (
                                  <button
                                    key={style}
                                    onClick={() => {
                                      const currentStyles = currentProject.styles || [];
                                      let newStyles;
                                      if (isSelected) {
                                        newStyles = currentStyles.filter(s => s !== style);
                                      } else {
                                        newStyles = [...currentStyles, style];
                                      }
                                      // Ensure at least one style is selected
                                      if (newStyles.length === 0) newStyles = ["modern"];
                                      updateProject(currentProject.id, { styles: newStyles });
                                    }}
                                    className={`px-2 py-2 rounded-lg text-xs font-medium transition-all truncate ${
                                      isSelected 
                                        ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/20' 
                                        : 'bg-neutral-700/50 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200'
                                    }`}
                                  >
                                      {formatStyleLabel(style)}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          {/* Custom Prompt */}
                          <div>
                            <h4 className="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                              <MessageSquare className="w-3 h-3" /> Additional Instructions
                            </h4>
                            <textarea
                              value={currentProject.customPrompt || ""}
                              onChange={(e) => updateProject(currentProject.id, { customPrompt: e.target.value })}
                              placeholder="e.g., 'Make the lines thicker', 'Focus on the gear mechanism'..."
                              className="w-full bg-neutral-700/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 h-20 resize-none"
                            />
                          </div>
                        </>
                      )}

                      {/* Size & Ratio Configuration */}
                      <div>
                        <h4 className="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                          <Settings2 className="w-3 h-3" /> Configuration
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <label className="text-xs text-neutral-500">Aspect Ratio</label>
                              <label className="flex items-center gap-1 text-xs text-indigo-400 cursor-pointer">
                                <input 
                                  type="checkbox"
                                  checked={!!currentProject.isMultiRatio}
                                  onChange={(e) => {
                                    const isMulti = e.target.checked;
                                    updateProject(currentProject.id, { isMultiRatio: isMulti });
                                    if (isMulti && (!currentProject.aspectRatios || currentProject.aspectRatios.length === 0)) {
                                      updateProject(currentProject.id, { aspectRatios: [currentProject.aspectRatio] });
                                    }
                                  }}
                                  className="w-3 h-3 rounded border-neutral-600 bg-neutral-700 text-indigo-600 focus:ring-indigo-500"
                                />
                                Generate Multiple
                              </label>
                            </div>
                            
                            {currentProject.isMultiRatio ? (
                              <div className="grid grid-cols-2 gap-2">
                                {([
                                  "auto", "1:1", "3:4", "4:3", "9:16", "16:9",
                                  ...(currentProject.model === "gemini-2.5-flash-image" ? ["1:4", "4:1", "1:8", "8:1"] : [])
                                ] as AspectRatioOption[]).map((ratio) => {
                                  const isSelected = currentProject.aspectRatios?.includes(ratio);
                                  return (
                                    <button
                                      key={ratio}
                                      onClick={() => {
                                        const currentRatios = currentProject.aspectRatios || [];
                                        let newRatios;
                                        if (isSelected) {
                                          newRatios = currentRatios.filter(r => r !== ratio);
                                        } else {
                                          newRatios = [...currentRatios, ratio];
                                        }
                                        if (newRatios.length === 0) newRatios = ["1:1"];
                                        updateProject(currentProject.id, { aspectRatios: newRatios });
                                      }}
                                      className={`px-2 py-2 rounded-lg text-xs font-medium transition-all truncate ${
                                        isSelected 
                                          ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/20' 
                                          : 'bg-neutral-700/50 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200'
                                      }`}
                                    >
                                      {ASPECT_RATIO_LABELS[ratio]}
                                    </button>
                                  );
                                })}
                              </div>
                            ) : (
                              <select 
                                value={currentProject.aspectRatio}
                                onChange={(e) => {
                                  const newRatio = e.target.value as AspectRatioOption;
                                  updateProject(currentProject.id, { aspectRatio: newRatio, aspectRatios: [newRatio] });
                                }}
                                className="w-full bg-neutral-700/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                              >
                                <option value="auto">{ASPECT_RATIO_LABELS["auto"]}</option>
                                <option value="1:1">{ASPECT_RATIO_LABELS["1:1"]}</option>
                                <option value="3:4">{ASPECT_RATIO_LABELS["3:4"]}</option>
                                <option value="4:3">{ASPECT_RATIO_LABELS["4:3"]}</option>
                                <option value="9:16">{ASPECT_RATIO_LABELS["9:16"]}</option>
                                <option value="16:9">{ASPECT_RATIO_LABELS["16:9"]}</option>
                                {currentProject.model === "gemini-2.5-flash-image" && (
                                  <>
                                    <option value="1:4">{ASPECT_RATIO_LABELS["1:4"]}</option>
                                    <option value="4:1">{ASPECT_RATIO_LABELS["4:1"]}</option>
                                    <option value="1:8">{ASPECT_RATIO_LABELS["1:8"]}</option>
                                    <option value="8:1">{ASPECT_RATIO_LABELS["8:1"]}</option>
                                  </>
                                )}
                              </select>
                            )}
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs text-neutral-500">Resolution</label>
                            <select 
                              value={currentProject.imageSize}
                              onChange={(e) => updateProject(currentProject.id, { imageSize: e.target.value as ImageSize })}
                              className="w-full bg-neutral-700/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                            >
                              {currentProject.model === "gemini-2.5-flash-image" && (
                                <option value="512px">Fast (512px)</option>
                              )}
                              <option value="1K">Standard (1K)</option>
                              <option value="2K">High Res (2K)</option>
                              <option value="4K">Ultra Res (4K)</option>
                            </select>
                          </div>
                        </div>
                      </div>

                      {currentProject.workflowType !== "refine" && (
                        <>
                          <div className="pt-4 border-t border-white/5">
                            <label className="text-sm text-neutral-300 font-medium cursor-pointer flex items-center gap-2">
                              <input 
                                type="checkbox" 
                                checked={currentProject.keepLabels}
                                onChange={(e) => updateProject(currentProject.id, { keepLabels: e.target.checked })}
                                className="w-4 h-4 rounded border-neutral-600 bg-neutral-700 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-neutral-900"
                              />
                              Keep Labels & Annotations
                            </label>
                          </div>

                          <button
                            onClick={handleEnhance}
                            disabled={isProcessing}
                            className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-indigo-900/20 mt-4"
                          >
                            <RefreshCw className={`w-4 h-4 ${isProcessing ? 'animate-spin' : ''}`} />
                            {currentProject.enhancedImage ? 'Regenerate Enhancement' : 'Generate Enhancement'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {currentProject.workflowType === "extract" && (
                  <div className="space-y-6">
                    {/* JSON Upload Card */}
                    <div className="bg-neutral-800/30 rounded-2xl border border-white/5 p-6 space-y-4">
                      <h4 className="text-xs font-medium text-neutral-400 uppercase tracking-wider flex items-center gap-2">
                        <FileText className="w-3 h-3" /> Existing JSON Data
                      </h4>
                      {currentProject.existingJsonFile ? (
                        <div className="flex items-center justify-between p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-lg">
                          <div className="flex items-center gap-2">
                            <FileText className="w-4 h-4 text-indigo-400" />
                            <span className="text-sm text-indigo-300">{currentProject.existingJsonFile.name}</span>
                          </div>
                          <button 
                            onClick={() => updateProject(currentProject.id, { existingJsonFile: undefined, existingJsonData: undefined })}
                            className="text-indigo-400 hover:text-indigo-300"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-white/10 rounded-lg cursor-pointer hover:border-indigo-500/50 hover:bg-white/5 transition-colors">
                          <Upload className="w-8 h-8 text-neutral-500 mb-2" />
                          <span className="text-sm text-neutral-400">Upload schematic_data.json</span>
                          <input 
                            type="file" 
                            accept=".json,application/json" 
                            className="hidden" 
                            onChange={(e) => handleExistingJsonUpload(currentProject.id, e)} 
                          />
                        </label>
                      )}
                      <button
                        onClick={handleExtractHotspots}
                        disabled={isProcessing}
                        className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-indigo-900/20"
                      >
                        <Sparkles className="w-4 h-4" />
                        Extract Hotspots
                      </button>
                    </div>

                    {/* WordPress Integration Card */}
                    <div className="bg-neutral-800/30 rounded-2xl border border-white/5 p-6 space-y-6">
                      <div>
                        <h4 className="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                          <Settings2 className="w-3 h-3" /> WordPress Integration
                        </h4>
                        <div className="space-y-4">
                          <div>
                            <label className="text-xs text-neutral-500 block mb-1">WP Media ID</label>
                            <input 
                              type="number"
                              value={currentProject.wp_media_id || ""}
                              onChange={(e) => updateProject(currentProject.id, { wp_media_id: parseInt(e.target.value) || undefined })}
                              placeholder="e.g. 1234"
                              className="w-full bg-neutral-700/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className="text-xs text-neutral-500 block mb-1">Natural Width</label>
                              <div className="bg-neutral-900/50 border border-white/5 rounded-lg px-3 py-2 text-sm text-neutral-400">
                                {currentProject.image_natural_width || "—"} px
                              </div>
                            </div>
                            <div>
                              <label className="text-xs text-neutral-500 block mb-1">Natural Height</label>
                              <div className="bg-neutral-900/50 border border-white/5 rounded-lg px-3 py-2 text-sm text-neutral-400">
                                {currentProject.image_natural_height || "—"} px
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Hotspots List Card */}
                    <div className="bg-neutral-800/30 rounded-2xl border border-white/5 overflow-hidden flex flex-col max-h-150">
                      <div className="p-4 border-b border-white/5 flex items-center justify-between bg-neutral-800/50">
                        <h3 className="text-sm font-medium text-neutral-400 uppercase tracking-wider flex items-center gap-2">
                          <List className="w-3 h-3" /> Hotspots ({currentProject.hotspots?.length || 0})
                        </h3>
                      </div>
                      <div className="flex-1 overflow-y-auto p-2 space-y-1">
                        {currentProject.hotspots?.map((hotspot, idx) => (
                          <div 
                            key={hotspot.id}
                            className="group bg-neutral-900/30 hover:bg-neutral-700/50 border border-white/5 rounded-lg p-3 transition-all"
                          >
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs font-bold text-indigo-400">#{idx + 1}</span>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] bg-indigo-500/20 text-indigo-300 px-1.5 py-0.5 rounded border border-indigo-500/30">
                                  {Math.round(hotspot.confidence * 100)}%
                                </span>
                                <button 
                                  onClick={() => {
                                    const newHotspots = currentProject.hotspots?.filter(h => h.id !== hotspot.id);
                                    updateProject(currentProject.id, { hotspots: newHotspots });
                                  }}
                                  className="text-neutral-500 hover:text-red-400 transition-colors"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                            <input 
                              type="text"
                              value={hotspot.label}
                              onChange={(e) => {
                                const newHotspots = currentProject.hotspots?.map(h => h.id === hotspot.id ? { ...h, label: e.target.value } : h);
                                updateProject(currentProject.id, { hotspots: newHotspots });
                              }}
                              className="w-full bg-transparent border-none p-0 text-sm text-white focus:ring-0 mb-2 font-medium"
                            />
                            <div className="grid grid-cols-2 gap-2 text-[10px] text-neutral-500 font-mono">
                              <div>X: {hotspot.x_pct}%</div>
                              <div>Y: {hotspot.y_pct}%</div>
                              <div className="col-span-2 text-neutral-600">
                                SKU: {hotspot.woo_sku || "—"} | ID: {hotspot.woo_product_id || "—"}
                              </div>
                            </div>
                          </div>
                        ))}
                        {(!currentProject.hotspots || currentProject.hotspots.length === 0) && (
                          <div className="p-8 text-center text-neutral-600 italic text-sm">
                            No hotspots extracted yet.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Right Panel: Enhanced Output */}
                <div className={`space-y-4 ${currentProject.workflowType === "extract" ? "lg:col-span-2" : ""}`}>
                  <div className="bg-neutral-800/30 rounded-2xl border border-white/5 overflow-hidden h-full min-h-75 sm:min-h-125 flex flex-col">
                    <div className="p-4 border-b border-white/5 flex items-center justify-between bg-neutral-800/50">
                      <h3 className="text-sm font-medium text-indigo-400 uppercase tracking-wider">
                        {currentProject.workflowType === "extract" ? "Diagram" : currentProject.workflowType === "refine" ? "Refined Output" : "Enhanced Output"}
                      </h3>
                      <div className="flex gap-2">
                        {currentProject.workflowType === "refine" && currentProject.enhancedImage !== currentProject.originalImage && (
                          <button 
                            onClick={() => updateProject(currentProject.id, { enhancedImage: currentProject.originalImage })}
                            className="text-xs text-neutral-400 hover:text-white transition-colors flex items-center gap-1 bg-neutral-700/50 px-3 py-1.5 rounded-full"
                          >
                            <RefreshCw className="w-3 h-3" /> Reset
                          </button>
                        )}
                        {currentProject.generatedImages && currentProject.generatedImages.length > 1 && (
                           <button 
                            onClick={() => {
                              let delay = 0;
                              currentProject.generatedImages?.forEach((img, index) => {
                                setTimeout(() => {
                                  const link = document.createElement("a");
                                  link.href = img.imageUrl;
                                  link.download = `${currentProject.name}-${img.aspectRatio.replace(':', '-')}-${index}.png`;
                                  document.body.appendChild(link);
                                  link.click();
                                  document.body.removeChild(link);
                                }, delay);
                                delay += 500;
                              });

                              if (currentProject.hotspots && currentProject.hotspots.length > 0) {
                                setTimeout(() => {
                                  const coordinates = (currentProject.hotspots || []).reduce((acc, hotspot) => {
                                    acc[hotspot.label] = {
                                      id: hotspot.label,
                                      x_pct: hotspot.x_pct,
                                      y_pct: hotspot.y_pct,
                                      shape: hotspot.shape,
                                      pageNumber: 1,
                                      rotation: 0
                                    };
                                    return acc;
                                  }, {} as Record<string, any>);

                                  let exportData;
                                  if (currentProject.existingJsonData) {
                                    exportData = {
                                      ...currentProject.existingJsonData,
                                      coordinates: (currentProject.hotspots || []).reduce((acc, hotspot) => {
                                        acc[hotspot.local_target_id || hotspot.label] = {
                                          id: hotspot.local_target_id || hotspot.label,
                                          x_pct: hotspot.x_pct,
                                          y_pct: hotspot.y_pct,
                                          shape: hotspot.shape,
                                          pageNumber: 1,
                                          rotation: 0
                                        };
                                        return acc;
                                      }, {} as Record<string, any>)
                                    };
                                  } else {
                                    exportData = {
                                      id: currentProject.id,
                                      title: currentProject.name,
                                      diagramPages: [1],
                                      legendPages: [],
                                      parts: (currentProject.hotspots || []).map(h => ({
                                        id: h.local_target_id || h.label,
                                        name: h.label,
                                        quantity: 1,
                                        sku: ""
                                      })),
                                      coordinates: (currentProject.hotspots || []).reduce((acc, hotspot) => {
                                        acc[hotspot.local_target_id || hotspot.label] = {
                                          id: hotspot.local_target_id || hotspot.label,
                                          x_pct: hotspot.x_pct,
                                          y_pct: hotspot.y_pct,
                                          shape: hotspot.shape,
                                          pageNumber: 1,
                                          rotation: 0
                                        };
                                        return acc;
                                      }, {} as Record<string, any>),
                                      schema_version: "1.0",
                                      image_natural_width: currentProject.image_natural_width || 1792,
                                      image_natural_height: currentProject.image_natural_height || 2400
                                    };
                                  }
                                  const hotspotsJson = JSON.stringify(exportData, null, 2);
                                  const blob = new Blob([hotspotsJson], { type: "application/json" });
                                  const url = URL.createObjectURL(blob);
                                  const jsonLink = document.createElement("a");
                                  jsonLink.href = url;
                                  jsonLink.download = "schematic_data.json";
                                  document.body.appendChild(jsonLink);
                                  jsonLink.click();
                                  document.body.removeChild(jsonLink);
                                  URL.revokeObjectURL(url);
                                }, delay);
                              }
                            }}
                            className="text-xs text-neutral-400 hover:text-white transition-colors flex items-center gap-1 bg-neutral-700/50 px-3 py-1.5 rounded-full"
                          >
                            <Download className="w-3 h-3" /> Download All
                          </button>
                        )}
                        {currentProject.hotspots && currentProject.hotspots.length > 0 && (
                          <button
                            onClick={() => {
                              const coordinates = (currentProject.hotspots || []).reduce((acc, hotspot) => {
                                acc[hotspot.local_target_id || hotspot.label] = {
                                  id: hotspot.local_target_id || hotspot.label,
                                  x_pct: hotspot.x_pct,
                                  y_pct: hotspot.y_pct,
                                  shape: hotspot.shape,
                                  pageNumber: 1,
                                  rotation: 0
                                };
                                return acc;
                              }, {} as Record<string, any>);

                              const exportData = currentProject.existingJsonData ? {
                                ...currentProject.existingJsonData,
                                coordinates
                              } : {
                                id: currentProject.id,
                                title: currentProject.name,
                                diagramPages: [1],
                                legendPages: [],
                                parts: (currentProject.hotspots || []).map(h => ({
                                  id: h.local_target_id || h.label,
                                  name: h.label,
                                  quantity: 1,
                                  sku: ""
                                })),
                                coordinates,
                                schema_version: "1.0",
                                image_natural_width: currentProject.image_natural_width || 1792,
                                image_natural_height: currentProject.image_natural_height || 2400
                              };
                              navigator.clipboard.writeText(JSON.stringify(exportData, null, 2));
                              setCopied(true);
                              setTimeout(() => setCopied(false), 2000);
                            }}
                            className="text-xs text-neutral-400 hover:text-white transition-colors flex items-center gap-1 bg-neutral-700/50 px-3 py-1.5 rounded-full"
                          >
                            {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />} 
                            {copied ? 'Copied!' : 'Copy JSON'}
                          </button>
                        )}
                        {(currentProject.enhancedImage || selectedImageId) && (
                          <>
                            {currentProject.hotspots && currentProject.hotspots.length > 0 && (
                              <button
                                onClick={() => setShowHotspots(!showHotspots)}
                                className="text-xs text-neutral-400 hover:text-white transition-colors flex items-center gap-1 bg-neutral-700/50 px-3 py-1.5 rounded-full"
                              >
                                {showHotspots ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                                {showHotspots ? 'Hide' : 'Show'} Hotspots
                              </button>
                            )}
                            <button 
                              onClick={handleExtractHotspots}
                              disabled={isProcessing}
                              className="text-xs text-amber-400 hover:text-amber-300 transition-colors flex items-center gap-1 bg-amber-500/10 px-3 py-1.5 rounded-full disabled:opacity-50"
                            >
                              {isProcessing ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} Extract Hotspots
                            </button>
                            <button 
                              onClick={() => {
                                const imgToDownload = currentProject.generatedImages?.find(img => img.id === selectedImageId)?.imageUrl || currentProject.enhancedImage;
                                if (imgToDownload) {
                                  const link = document.createElement("a");
                                  link.href = imgToDownload;
                                  link.download = `${currentProject.name}-enhanced.png`;
                                  document.body.appendChild(link);
                                  link.click();
                                  document.body.removeChild(link);

                                  if (currentProject.hotspots && currentProject.hotspots.length > 0) {
                                    setTimeout(() => {
                                      const coordinates = (currentProject.hotspots || []).reduce((acc, hotspot) => {
                                        acc[hotspot.local_target_id || hotspot.label] = {
                                          id: hotspot.local_target_id || hotspot.label,
                                          x_pct: hotspot.x_pct,
                                          y_pct: hotspot.y_pct,
                                          shape: hotspot.shape,
                                          pageNumber: 1,
                                          rotation: 0
                                        };
                                        return acc;
                                      }, {} as Record<string, any>);

                                      const exportData = currentProject.existingJsonData ? {
                                        ...currentProject.existingJsonData,
                                        coordinates
                                      } : {
                                        id: currentProject.id,
                                        title: currentProject.name,
                                        diagramPages: [1],
                                        legendPages: [],
                                        parts: (currentProject.hotspots || []).map(h => ({
                                          id: h.local_target_id || h.label,
                                          name: h.label,
                                          quantity: 1,
                                          sku: ""
                                        })),
                                        coordinates,
                                        schema_version: "1.0",
                                        image_natural_width: currentProject.image_natural_width || 1792,
                                        image_natural_height: currentProject.image_natural_height || 2400
                                      };
                                      const hotspotsJson = JSON.stringify(exportData, null, 2);
                                      const blob = new Blob([hotspotsJson], { type: "application/json" });
                                      const url = URL.createObjectURL(blob);
                                      const jsonLink = document.createElement("a");
                                      jsonLink.href = url;
                                      jsonLink.download = `schematic_data.json`;
                                      document.body.appendChild(jsonLink);
                                      jsonLink.click();
                                      document.body.removeChild(jsonLink);
                                      URL.revokeObjectURL(url);
                                    }, 300);
                                  }
                                }
                              }}
                              className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1 bg-indigo-500/10 px-3 py-1.5 rounded-full"
                            >
                              <Download className="w-3 h-3" /> Download
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex-1 p-6 flex flex-col items-center justify-center bg-neutral-900/30 relative">
                      {currentProject.enhancedImage ? (
                        <>
                          <div id="image-container" className="relative inline-block max-w-full max-h-100 mb-4 touch-none" style={{ lineHeight: 0 }}>
                            <img 
                              src={currentProject.generatedImages?.find(img => img.id === selectedImageId)?.imageUrl || currentProject.enhancedImage || null} 
                              alt="Enhanced" 
                              className={`max-w-full max-h-100 w-auto h-auto shadow-2xl transition-opacity ${isProcessing ? 'opacity-50' : 'opacity-100'}`}
                              style={{ objectFit: 'contain' }}
                              draggable={false}
                            />
                            {isProcessing && (
                              <div className="absolute inset-0 flex items-center justify-center bg-neutral-900/20 rounded-lg">
                                <div className="flex flex-col items-center gap-3 bg-neutral-900/80 px-4 py-3 rounded-xl border border-white/10 backdrop-blur-sm">
                                  <RefreshCw className="w-6 h-6 text-indigo-400 animate-spin" />
                                  <span className="text-xs font-medium text-neutral-300">Processing...</span>
                                </div>
                              </div>
                            )}
                            {!isProcessing && showHotspots && currentProject.hotspots?.map(hotspot => (
                              <div key={hotspot.id} className="group">
                                <div
                                  onPointerDown={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setDraggingHotspotId(hotspot.id);
                                    draggingHotspotIdRef.current = hotspot.id;
                                    dragStartPos.current = { x: e.clientX, y: e.clientY };
                                    dragStartBox.current = [hotspot.bbox.y, hotspot.bbox.x, hotspot.bbox.y + hotspot.bbox.h, hotspot.bbox.x + hotspot.bbox.w] as [number, number, number, number];
                                  }}
                                  className={`absolute border-2 border-amber-500 bg-amber-500/20 flex items-center justify-center transition-colors hover:bg-amber-500/40 ${draggingHotspotId === hotspot.id ? 'bg-amber-500/60 ring-2 ring-amber-400 z-50 cursor-grabbing' : 'cursor-grab'}`}
                                  style={{
                                    top: `${hotspot.bbox.y}%`,
                                    left: `${hotspot.bbox.x}%`,
                                    height: `${hotspot.bbox.h}%`,
                                    width: `${hotspot.bbox.w}%`,
                                    borderRadius: hotspot.shape === 'circle' ? '50%' : '0.25rem',
                                  }}
                                >
                                  <span className={`absolute -top-8 left-1/2 -translate-x-1/2 bg-neutral-900 border border-amber-500/50 text-amber-400 text-xs px-2 py-1 rounded whitespace-nowrap z-10 pointer-events-none shadow-xl ${draggingHotspotId === hotspot.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                                    {hotspot.label}
                                  </span>
                                </div>
                                {hotspot.part_box_2d && (
                                  <div 
                                    className="absolute border-2 border-dashed border-indigo-400/50 bg-indigo-400/5 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-40"
                                    style={{
                                      top: `${(hotspot.part_box_2d[0] / 1000) * 100}%`,
                                      left: `${(hotspot.part_box_2d[1] / 1000) * 100}%`,
                                      height: `${((hotspot.part_box_2d[2] - hotspot.part_box_2d[0]) / 1000) * 100}%`,
                                      width: `${((hotspot.part_box_2d[3] - hotspot.part_box_2d[1]) / 1000) * 100}%`,
                                    }}
                                  />
                                )}
                              </div>
                            ))}
                          </div>
                          
                          {/* Gallery Strip */}
                          {currentProject.generatedImages && currentProject.generatedImages.length > 1 && (
                            <div className="w-full overflow-x-auto pb-2">
                              <div className="flex gap-2 justify-center min-w-min px-4">
                                {currentProject.generatedImages.map((img) => (
                                  <button
                                    key={img.id}
                                    onClick={() => setSelectedImageId(img.id)}
                                    className={`relative shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 transition-all ${
                                      selectedImageId === img.id 
                                        ? 'border-indigo-500 ring-2 ring-indigo-500/20' 
                                        : 'border-white/10 hover:border-white/30 opacity-60 hover:opacity-100'
                                    }`}
                                  >
                                    <img 
                                      src={img.imageUrl || null} 
                                      alt={img.aspectRatio}
                                      className="w-full h-full object-cover"
                                    />
                                    <span className="absolute bottom-0 left-0 right-0 bg-black/70 text-[8px] text-white text-center py-0.5">
                                      {img.aspectRatio}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="text-center p-8 max-w-sm">
                          {isProcessing ? (
                            <div className="flex flex-col items-center gap-4">
                              <div className="w-12 h-12 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
                              <p className="text-neutral-400 animate-pulse">Processing schematic...</p>
                              <p className="text-xs text-neutral-600">This may take up to 30 seconds per image.</p>
                            </div>
                          ) : error ? (
                            <div className="flex flex-col items-center gap-4 text-red-400 bg-red-500/10 p-6 rounded-xl border border-red-500/20">
                              <AlertCircle className="w-8 h-8" />
                              <p>{error}</p>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center gap-6 opacity-50">
                              <div className="w-20 h-20 bg-neutral-800 rounded-2xl flex items-center justify-center border border-white/5">
                                <Sparkles className="w-10 h-10 text-neutral-600" />
                              </div>
                              <p className="text-neutral-500">
                                Click "Generate Enhancement" to process this schematic.
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Refinement Tool */}
                    {currentProject.enhancedImage && !isProcessing && (
                      <div className="p-4 border-t border-white/5 bg-neutral-800/50">
                        <div className="flex items-center gap-2 mb-2">
                          <Wand2 className="w-4 h-4 text-indigo-400" />
                          <h4 className="text-xs font-medium text-neutral-300 uppercase tracking-wider">AI Refiner</h4>
                        </div>
                        <div className="flex gap-2">
                          <input 
                            type="text" 
                            value={refinePrompt}
                            onChange={(e) => setRefinePrompt(e.target.value)}
                            placeholder="Describe changes (e.g., 'Make lines thicker', 'Remove the bolt on top')..."
                            className="flex-1 bg-neutral-900/50 border border-white/10 rounded-lg px-4 py-2 text-sm text-white placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                            onKeyDown={(e) => e.key === 'Enter' && handleRefine()}
                          />
                          <button 
                            onClick={handleRefine}
                            disabled={!refinePrompt.trim()}
                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-neutral-700 disabled:text-neutral-500 text-white rounded-lg text-sm font-medium transition-colors"
                          >
                            Refine
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )
        )}
        {currentProject?.workflowType === "batch" && (
          <BatchProcessor 
            project={currentProject} 
            onUpdateProject={updateProject}
            onClose={() => setCurrentProjectId(null)} 
          />
        )}
      </main>

      {isSchematicLegendProcessorOpen && (
        <SchematicLegendProcessor onClose={() => setIsSchematicLegendProcessorOpen(false)} />
      )}

      {isImageRegeneratorOpen && (
        <ImageRegenerator onClose={() => setIsImageRegeneratorOpen(false)} />
      )}

      {isWorkflowPipelineOpen && (
        <WorkflowPipeline onClose={() => setIsWorkflowPipelineOpen(false)} />
      )}
    </div>
  );
}
