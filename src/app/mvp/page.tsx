"use client";

import React, { useState } from "react";
import LeftPanel from "@/components/Editor/LeftPanel";
import ViewerPanel from "@/components/Editor/ViewerPanel";
import RightPanel from "@/components/Editor/RightPanel";

export default function MVPPage() {
    const [activeScene, setActiveScene] = useState<string | null>(null);
    const [sceneGraph, setSceneGraph] = useState<any>({ environment: null, assets: [] });
    const [assetsList, setAssetsList] = useState<any[]>([]);

    return (
        <div className="flex h-screen w-screen overflow-hidden bg-neutral-900 text-white font-sans">
            <div className="w-80 h-full border-r border-neutral-800 bg-neutral-950 flex flex-col z-10 shadow-2xl">
                <LeftPanel
                    setActiveScene={setActiveScene}
                    setSceneGraph={setSceneGraph}
                    setAssetsList={setAssetsList}
                />
            </div>

            <div className="flex-1 h-full relative z-0">
                <ViewerPanel
                    sceneGraph={sceneGraph}
                    setSceneGraph={setSceneGraph}
                />
            </div>

            <div className="w-80 h-full border-l border-neutral-800 bg-neutral-950 flex flex-col z-10 shadow-2xl">
                <RightPanel
                    sceneGraph={sceneGraph}
                    setSceneGraph={setSceneGraph}
                    assetsList={assetsList}
                    activeScene={activeScene}
                />
            </div>
        </div>
    );
}
