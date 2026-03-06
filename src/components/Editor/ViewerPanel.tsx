"use client";

import React from "react";
import { Maximize2, Move3d } from "lucide-react";
import ThreeOverlay from "./ThreeOverlay";

export default function ViewerPanel({ sceneGraph, setSceneGraph }: { sceneGraph: any, setSceneGraph: any }) {
    // Real implementation architectural note:
    // 1. A PlayCanvas WebGL context (Supersplat) for Gaussian Splat environment
    // 2. A react-three-fiber WebGL context overlay for adding GLB assets

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        try {
            const assetData = e.dataTransfer.getData("asset");
            if (assetData) {
                const asset = JSON.parse(assetData);
                // Drop in center for mock (real app uses raycaster intersection)
                setSceneGraph((prev: any) => ({
                    ...prev,
                    assets: [...prev.assets, { ...asset, instanceId: `inst_${Date.now()}`, position: [0, 0, 0] }]
                }));
            }
        } catch (e) { }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
    };

    return (
        <div className="w-full h-full relative bg-[#050505] flex flex-col">
            {/* Viewer Header HUD */}
            <div className="absolute top-0 left-0 right-0 p-6 shrink-0 flex justify-between items-start pointer-events-none z-10">
                <div className="bg-neutral-900/60 backdrop-blur-md rounded-xl px-4 py-2 border border-neutral-800/50 shadow-2xl flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${sceneGraph.environment ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]' : 'bg-neutral-600'}`} />
                    <span className="text-sm font-medium text-neutral-200">
                        {sceneGraph.environment ? 'System Ready' : 'Awaiting Data'}
                    </span>
                </div>
                <div className="flex gap-2 pointer-events-auto">
                    <button className="bg-neutral-900/60 backdrop-blur-md rounded-xl p-3 border border-neutral-800/50 hover:bg-neutral-800 hover:border-neutral-700 text-neutral-400 hover:text-white transition-all shadow-xl">
                        <Move3d className="h-4 w-4" />
                    </button>
                    <button className="bg-neutral-900/60 backdrop-blur-md rounded-xl p-3 border border-neutral-800/50 hover:bg-neutral-800 hover:border-neutral-700 text-neutral-400 hover:text-white transition-all shadow-xl">
                        <Maximize2 className="h-4 w-4" />
                    </button>
                </div>
            </div>

            {/* Render Area */}
            <div
                className="flex-1 border border-neutral-800/50 m-6 rounded-2xl overflow-hidden relative shadow-2xl bg-neutral-900 flex items-center justify-center"
                onDrop={handleDrop}
                onDragOver={handleDragOver}
            >

                <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '32px 32px' }}></div>

                {sceneGraph.environment ? (
                    <div className="absolute inset-0 bg-gradient-to-br from-indigo-900/10 to-emerald-900/10 flex flex-col items-center justify-center text-emerald-500/80 animate-in fade-in duration-500">
                        <div className="w-64 h-64 border border-dashed border-emerald-500/30 rounded-full animate-[spin_20s_linear_infinite] relative flex items-center justify-center shadow-[inset_0_0_50px_rgba(16,185,129,0.1)]">
                            <div className="w-48 h-48 border border-dashed border-emerald-500/20 rounded-full animate-[spin_15s_linear_infinite_reverse]" />
                        </div>
                        <p className="absolute text-sm font-medium tracking-widest uppercase shadow-black drop-shadow-md">PlayCanvas Splat Render</p>
                    </div>
                ) : (
                    <p className="text-neutral-500 text-sm font-medium animate-pulse tracking-wide">3D Canvas Offline</p>
                )}

                {/* Three.js Overlay for Meshes */}
                {sceneGraph.assets.length > 0 && (
                    <ThreeOverlay sceneGraph={sceneGraph} setSceneGraph={setSceneGraph} />
                )}

                {/* Viewfinder Crosshair */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none opacity-20">
                    <div className="w-8 h-[1px] bg-white absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"></div>
                    <div className="h-8 w-[1px] bg-white absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"></div>
                </div>
            </div>

        </div>
    );
}
