import React, { useState, useRef, useEffect } from 'react';
import { PipelineFile } from '../types';
import { ExtractedHotspot } from '../lib/schematic-legend-processor';
import { X, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

interface SchematicViewerProps {
  file: PipelineFile;
  pageIndex: number;
  onClose: () => void;
  onUpdateFile?: (fileId: string, updates: Partial<PipelineFile>) => void;
}

export const SchematicViewer: React.FC<SchematicViewerProps> = ({ file, pageIndex, onClose, onUpdateFile }) => {
  const page = file.pages?.[pageIndex];
  const [selectedHotspot, setSelectedHotspot] = useState<ExtractedHotspot | null>(null);
  
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const originalHotspots = file.correlatedData?.find(c => c.schematicPageIndex === page?.index)?.hotspots || [];
  const [localHotspots, setLocalHotspots] = useState<ExtractedHotspot[]>(originalHotspots);

  useEffect(() => {
    setLocalHotspots(originalHotspots);
  }, [originalHotspots]);

  const [draggingHotspot, setDraggingHotspot] = useState<string | null>(null);
  const hotspotDragStart = useRef<{ x: number, y: number } | null>(null);
  const hotspotStartData = useRef<ExtractedHotspot | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const zoomSensitivity = 0.001;
      const delta = -e.deltaY * zoomSensitivity;
      const newScale = Math.min(Math.max(0.1, scale * (1 + delta)), 10);
      
      // Calculate mouse position relative to container
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Adjust position to zoom towards mouse
      const scaleRatio = newScale / scale;
      const newX = mouseX - (mouseX - position.x) * scaleRatio;
      const newY = mouseY - (mouseY - position.y) * scaleRatio;

      setScale(newScale);
      setPosition({ x: newX, y: newY });
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [scale, position]);

  if (!page) return null;

  const handlePanStart = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    setIsPanning(true);
    panStart.current = { x: e.clientX - position.x, y: e.clientY - position.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePanMove = (e: React.PointerEvent) => {
    if (!isPanning) return;
    setPosition({
      x: e.clientX - panStart.current.x,
      y: e.clientY - panStart.current.y
    });
  };

  const handlePanEnd = (e: React.PointerEvent) => {
    setIsPanning(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const handleHotspotPointerDown = (e: React.PointerEvent, hotspot: ExtractedHotspot) => {
    e.stopPropagation();
    setSelectedHotspot(hotspot);
    setDraggingHotspot(hotspot.id);
    hotspotDragStart.current = { x: e.clientX, y: e.clientY };
    hotspotStartData.current = JSON.parse(JSON.stringify(hotspot));
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleHotspotPointerMove = (e: React.PointerEvent, hotspotId: string) => {
    if (draggingHotspot !== hotspotId || !hotspotDragStart.current || !hotspotStartData.current) return;
    
    const svgElement = e.currentTarget.closest('svg');
    if (!svgElement) return;
    const rect = svgElement.getBoundingClientRect();
    
    const dx = e.clientX - hotspotDragStart.current.x;
    const dy = e.clientY - hotspotDragStart.current.y;
    
    const dxScaled = (dx / rect.width) * 1000;
    const dyScaled = (dy / rect.height) * 1000;
    
    const startData = hotspotStartData.current;
    const newBox: [number, number, number, number] = [
      startData.box_2d[0] + dyScaled,
      startData.box_2d[1] + dxScaled,
      startData.box_2d[2] + dyScaled,
      startData.box_2d[3] + dxScaled
    ];
    
    let newPolygon = startData.polygon_2d;
    if (newPolygon) {
      newPolygon = newPolygon.map(([y, x]) => [y + dyScaled, x + dxScaled]);
    }
    
    setLocalHotspots(prev => prev.map(h => 
      h.id === hotspotId ? { ...h, box_2d: newBox, polygon_2d: newPolygon } : h
    ));
  };

  const handleHotspotPointerUp = (e: React.PointerEvent, hotspotId: string) => {
    e.stopPropagation();
    setDraggingHotspot(null);
    hotspotDragStart.current = null;
    hotspotStartData.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);

    if (onUpdateFile) {
      const newCorrelatedData = [...(file.correlatedData || [])];
      const pageDataIndex = newCorrelatedData.findIndex(c => c.schematicPageIndex === page.index);
      if (pageDataIndex >= 0) {
        newCorrelatedData[pageDataIndex] = {
          ...newCorrelatedData[pageDataIndex],
          hotspots: localHotspots
        };
        onUpdateFile(file.id, { correlatedData: newCorrelatedData });
      }
    }
  };

  const resetView = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4">
      <div className="bg-neutral-900 rounded-2xl w-full max-w-6xl h-[90vh] flex overflow-hidden border border-white/10">
        {/* Image Viewer */}
        <div className="flex-1 relative overflow-hidden flex flex-col">
          {/* Toolbar */}
          <div className="absolute top-4 left-4 z-10 flex items-center gap-2 bg-neutral-800/80 backdrop-blur-sm p-2 rounded-lg border border-white/10">
            <button onClick={() => setScale(s => Math.min(s * 1.2, 10))} className="p-1.5 text-neutral-400 hover:text-white hover:bg-white/10 rounded">
              <ZoomIn className="w-5 h-5" />
            </button>
            <button onClick={() => setScale(s => Math.max(s / 1.2, 0.1))} className="p-1.5 text-neutral-400 hover:text-white hover:bg-white/10 rounded">
              <ZoomOut className="w-5 h-5" />
            </button>
            <button onClick={resetView} className="p-1.5 text-neutral-400 hover:text-white hover:bg-white/10 rounded">
              <Maximize2 className="w-5 h-5" />
            </button>
            <div className="w-px h-6 bg-white/10 mx-1" />
            <span className="text-xs text-neutral-400 font-medium px-2">
              {Math.round(scale * 100)}%
            </span>
          </div>

          <div 
            ref={containerRef}
            className={`flex-1 relative overflow-hidden ${isPanning ? 'cursor-grabbing' : 'cursor-grab'}`}
            onPointerDown={handlePanStart}
            onPointerMove={handlePanMove}
            onPointerUp={handlePanEnd}
            onPointerLeave={handlePanEnd}
          >
            <div 
              className="absolute origin-top-left"
              style={{ 
                transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <div className="relative inline-block" style={{ lineHeight: 0 }}>
                <img 
                  src={page.enhancedImage || page.originalImage} 
                  alt={`Page ${page.index + 1}`}
                  className="max-w-full max-h-[80vh] w-auto h-auto block pointer-events-none"
                  style={{ objectFit: 'contain' }}
                />
                
                <svg 
                  className="absolute inset-0 w-full h-full pointer-events-none" 
                  viewBox="0 0 1000 1000" 
                  preserveAspectRatio="none"
                >
                  {localHotspots.map((h, hIdx) => {
                    const isSelected = selectedHotspot?.id === h.id;
                    const isDraggingThis = draggingHotspot === h.id;
                    const strokeColor = isSelected ? '#818cf8' : 'rgba(52, 211, 153, 0.5)';
                    const fillColor = isSelected ? 'rgba(129, 140, 248, 0.2)' : 'rgba(52, 211, 153, 0.1)';
                    const cursorClass = isDraggingThis ? 'cursor-grabbing' : 'cursor-grab';
                    
                    if (h.polygon_2d && h.polygon_2d.length > 0) {
                      const points = h.polygon_2d.map(([y, x]) => `${x},${y}`).join(' ');
                      const [ymin, xmin, ymax, xmax] = h.box_2d;
                      const width = xmax - xmin;
                      const height = ymax - ymin;
                      return (
                        <g key={h.id || hIdx}>
                          <polygon
                            points={points}
                            fill={fillColor}
                            stroke={strokeColor}
                            strokeWidth="2"
                            className={`pointer-events-auto transition-colors hover:fill-emerald-400/20 ${cursorClass}`}
                            onPointerDown={(e) => handleHotspotPointerDown(e, h)}
                            onPointerMove={(e) => handleHotspotPointerMove(e, h.id)}
                            onPointerUp={(e) => handleHotspotPointerUp(e, h.id)}
                          />
                          <text
                            x={xmin + width / 2}
                            y={ymin + height / 2}
                            fill="white"
                            fontSize="12"
                            textAnchor="middle"
                            className="pointer-events-none font-bold"
                          >
                            {h.label}
                          </text>
                          {h.description && (
                            <text
                              x={xmin + width / 2}
                              y={ymin + height / 2 + 15}
                              fill="white"
                              fontSize="10"
                              textAnchor="middle"
                              className="pointer-events-none"
                            >
                              {h.description}
                            </text>
                          )}
                        </g>
                      );
                    } else {
                      const [ymin, xmin, ymax, xmax] = h.box_2d;
                      const width = xmax - xmin;
                      const height = ymax - ymin;
                      
                      if (h.shape === 'circle') {
                        const cx = xmin + width / 2;
                        const cy = ymin + height / 2;
                        const rx = width / 2;
                        const ry = height / 2;
                        return (
                          <g key={h.id || hIdx}>
                            <ellipse
                              cx={cx}
                              cy={cy}
                              rx={rx}
                              ry={ry}
                              fill={fillColor}
                              stroke={strokeColor}
                              strokeWidth="2"
                              className={`pointer-events-auto transition-colors hover:fill-emerald-400/20 ${cursorClass}`}
                              onPointerDown={(e) => handleHotspotPointerDown(e, h)}
                              onPointerMove={(e) => handleHotspotPointerMove(e, h.id)}
                              onPointerUp={(e) => handleHotspotPointerUp(e, h.id)}
                            />
                            <text
                              x={cx}
                              y={cy}
                              fill="white"
                              fontSize="12"
                              textAnchor="middle"
                              className="pointer-events-none font-bold"
                            >
                              {h.label}
                            </text>
                            {h.description && (
                              <text
                                x={cx}
                                y={cy + 15}
                                fill="white"
                                fontSize="10"
                                textAnchor="middle"
                                className="pointer-events-none"
                              >
                                {h.description}
                              </text>
                            )}
                          </g>
                        );
                      }
                      
                      return (
                        <g key={h.id || hIdx}>
                          <rect
                            x={xmin}
                            y={ymin}
                            width={width}
                            height={height}
                            fill={fillColor}
                            stroke={strokeColor}
                            strokeWidth="2"
                            className={`pointer-events-auto transition-colors hover:fill-emerald-400/20 ${cursorClass}`}
                            onPointerDown={(e) => handleHotspotPointerDown(e, h)}
                            onPointerMove={(e) => handleHotspotPointerMove(e, h.id)}
                            onPointerUp={(e) => handleHotspotPointerUp(e, h.id)}
                          />
                          <text
                            x={xmin + width / 2}
                            y={ymin + height / 2}
                            fill="white"
                            fontSize="12"
                            textAnchor="middle"
                            className="pointer-events-none font-bold"
                          >
                            {h.label}
                          </text>
                          {h.description && (
                            <text
                              x={xmin + width / 2}
                              y={ymin + height / 2 + 15}
                              fill="white"
                              fontSize="10"
                              textAnchor="middle"
                              className="pointer-events-none"
                            >
                              {h.description}
                            </text>
                          )}
                        </g>
                      );
                    }
                  })}
                </svg>
              </div>
            </div>
          </div>
        </div>

        {/* Sidepanel */}
        <div className="w-80 bg-neutral-800 border-l border-white/10 p-6 flex flex-col z-10">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-lg font-bold text-white">Hotspots</h2>
            <button onClick={onClose} className="text-neutral-400 hover:text-white"><X /></button>
          </div>
          <div className="flex-1 overflow-y-auto space-y-2">
            {localHotspots.map((h, hIdx) => (
              <div 
                key={h.id || hIdx}
                onClick={() => setSelectedHotspot(h)}
                className={`p-3 rounded-lg border cursor-pointer transition-colors ${selectedHotspot?.id === h.id ? 'bg-indigo-500/20 border-indigo-500/50' : 'bg-neutral-900 border-white/5 hover:border-white/10'}`}
              >
                <div className="font-medium text-white">{h.label}</div>
                <div className="text-xs text-neutral-400">Box: {h.box_2d.map(n => Math.round(n)).join(', ')}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
