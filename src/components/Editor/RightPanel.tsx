"use client";

import React from "react";
import { Layers, Box, Save, Plus } from "lucide-react";

export default function RightPanel({ sceneGraph, setSceneGraph, assetsList, activeScene }: any) {

    const handleDragStart = (e: React.DragEvent, asset: any) => {
        e.dataTransfer.setData("asset", JSON.stringify(asset));
    };

    const addAssetToScene = (asset: any) => {
        setSceneGraph((prev: any) => ({
            ...prev,
            assets: [...prev.assets, { ...asset, instanceId: Date.now(), position: [0, 0, 0] }]
        }));
    };

    return (
        <div className="flex flex-col h-full bg-neutral-950">
            {/* Header */}
            <div className="p-4 border-b border-neutral-800 flex items-center justify-between shrink-0 bg-neutral-900/30">
                <h3 className="font-semibold text-white tracking-tight text-sm">Scene Inspector</h3>
                <button className="p-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white transition-colors shadow-lg shadow-blue-900/20" title="Save Scene as JSON">
                    <Save className="h-4 w-4" />
                </button>
            </div>

            {/* Scene Graph */}
            <div className="flex-1 overflow-y-auto p-4 border-b border-neutral-800">
                <div className="flex items-center gap-2 mb-4 text-xs font-bold text-neutral-500 uppercase tracking-wider">
                    <Layers className="h-3 w-3" />
                    Scene Graph
                </div>

                {sceneGraph.environment ? (
                    <div className="space-y-2 text-sm animate-in fade-in">
                        <div className="bg-neutral-900/80 rounded-lg px-3 py-2.5 text-emerald-400 border py-1.5 border-emerald-900/30 flex justify-between items-center shadow-inner">
                            <span className="font-medium">Environment Splat</span>
                            <span className="text-[10px] bg-emerald-950/50 px-1.5 py-0.5 rounded text-emerald-500 font-mono tracking-wider">BG</span>
                        </div>
                        {sceneGraph.assets.map((a: any, i: number) => (
                            <div key={i} className="bg-neutral-900/50 rounded-lg px-3 py-2.5 text-blue-400 border border-blue-900/30 ml-4 flex justify-between items-center group cursor-pointer hover:border-blue-700/50 hover:bg-neutral-900 transition-colors">
                                <span className="font-medium flex items-center gap-2">
                                    <Box className="h-3 w-3 opacity-50" /> {a.name}
                                </span>
                                <span className="text-xs text-neutral-600 group-hover:text-blue-500 font-mono">[{a.position.join(", ")}]</span>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="h-20 flex items-center justify-center">
                        <p className="text-xs text-neutral-600 italic">Scene is empty</p>
                    </div>
                )}
            </div>

            {/* Local Asset Library */}
            <div className="flex-1 overflow-y-auto p-4 bg-neutral-900/20">
                <div className="flex items-center gap-2 mb-4 text-xs font-bold text-neutral-500 uppercase tracking-wider">
                    <Box className="h-3 w-3" />
                    Local Assets
                </div>

                {assetsList.length > 0 ? (
                    <div className="grid grid-cols-2 gap-3 pb-8">
                        {assetsList.map((asset: any, idx: number) => (
                            <div
                                key={idx}
                                draggable
                                onDragStart={(e) => handleDragStart(e, asset)}
                                onClick={() => addAssetToScene(asset)}
                                className="bg-neutral-900 border border-neutral-800 rounded-xl p-3 hover:border-blue-500/50 cursor-grab active:cursor-grabbing transition-all group aspect-square flex flex-col justify-between hover:shadow-xl hover:shadow-black/50 animate-in zoom-in-95 duration-200"
                            >
                                <div className="w-full flex-1 bg-gradient-to-tr from-neutral-800 to-neutral-700 rounded-lg mb-2 overflow-hidden relative shadow-inner">
                                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-neutral-900/40 transition-opacity backdrop-blur-[2px]">
                                        <div className="bg-blue-600 text-white rounded-full p-1 shadow-lg pointer-events-none">
                                            <Plus className="h-4 w-4" />
                                        </div>
                                    </div>
                                </div>
                                <p className="text-xs text-center text-neutral-400 font-medium truncate group-hover:text-blue-200">{asset.name}</p>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-center h-40 flex items-center justify-center border-2 border-dashed border-neutral-800/50 rounded-xl bg-neutral-900/30">
                        <p className="text-xs text-neutral-600 px-4">Assets generated from TripoSR will appear here.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
