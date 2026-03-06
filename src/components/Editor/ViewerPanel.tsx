"use client";

import React from "react";
import { Maximize2, Move3d } from "lucide-react";
import ThreeOverlay from "./ThreeOverlay";

export default function ViewerPanel({ sceneGraph, setSceneGraph }: { sceneGraph: any; setSceneGraph: any }) {
    const handleDrop = (event: React.DragEvent) => {
        event.preventDefault();
        try {
            const assetData = event.dataTransfer.getData("asset");
            if (!assetData) return;

            const asset = JSON.parse(assetData);
            setSceneGraph((prev: any) => ({
                ...prev,
                assets: [
                    ...(prev.assets ?? []),
                    {
                        ...asset,
                        instanceId: `inst_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                        position: [0, 0, 0],
                        rotation: [0, 0, 0],
                        scale: [1, 1, 1],
                    },
                ],
            }));
        } catch {
            // Ignore invalid drag payloads.
        }
    };

    const handleDragOver = (event: React.DragEvent) => {
        event.preventDefault();
    };

    const hasEnvironment = Boolean(sceneGraph?.environment);

    return (
        <div className="w-full h-full relative bg-[#050505] flex flex-col">
            <div className="absolute top-0 left-0 right-0 p-6 shrink-0 flex justify-between items-start pointer-events-none z-30">
                <div className="bg-neutral-900/60 backdrop-blur-md rounded-xl px-4 py-2 border border-neutral-800/50 shadow-2xl flex items-center gap-3">
                    <div
                        className={`w-2 h-2 rounded-full ${
                            hasEnvironment ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" : "bg-neutral-600"
                        }`}
                    />
                    <span className="text-sm font-medium text-neutral-200">
                        {hasEnvironment ? "Environment Loaded" : "Awaiting Environment"}
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

            <div
                className="flex-1 border border-neutral-800/50 m-6 rounded-2xl overflow-hidden relative shadow-2xl bg-neutral-900"
                onDrop={handleDrop}
                onDragOver={handleDragOver}
            >
                <ThreeOverlay sceneGraph={sceneGraph} setSceneGraph={setSceneGraph} />

                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none opacity-20 z-30">
                    <div className="w-8 h-[1px] bg-white absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"></div>
                    <div className="h-8 w-[1px] bg-white absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"></div>
                </div>
            </div>
        </div>
    );
}
