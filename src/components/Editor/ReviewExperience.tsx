"use client";

import React, { useEffect, useMemo, useState } from "react";
import { MessageSquareText, Share2 } from "lucide-react";
import ViewerPanel from "@/components/Editor/ViewerPanel";
import { extractApiError, MVP_API_BASE_URL } from "@/lib/mvp-api";
import { decodeReviewPackage, ReviewPackage } from "@/lib/mvp-review";
import { SceneReviewRecord } from "@/lib/mvp-workspace";
import { useSearchParams } from "next/navigation";

interface ReviewComment {
    comment_id: string;
    author: string;
    body: string;
    created_at: string;
}

const formatTimestamp = (value?: string | null) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString([], {
        hour: "numeric",
        minute: "2-digit",
        month: "short",
        day: "numeric",
    });
};

export default function ReviewExperience() {
    const searchParams = useSearchParams();
    const [reviewPackage, setReviewPackage] = useState<ReviewPackage | null>(null);
    const [comments, setComments] = useState<ReviewComment[]>([]);
    const [statusMessage, setStatusMessage] = useState("Loading review scene...");
    const [reviewData, setReviewData] = useState<SceneReviewRecord | null>(null);

    const sceneId = searchParams.get("scene");
    const versionId = searchParams.get("version");
    const payload = searchParams.get("payload");

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            if (payload) {
                try {
                    const decoded = decodeReviewPackage(payload);
                    if (!cancelled) {
                        setReviewPackage(decoded);
                        setReviewData(decoded.review ?? null);
                        setStatusMessage("Review scene loaded from inline package.");
                    }
                } catch {
                    if (!cancelled) {
                        setStatusMessage("Unable to decode the inline review package.");
                    }
                }
            }

            if (!sceneId || !versionId) {
                return;
            }

            try {
                const versionResponse = await fetch(`${MVP_API_BASE_URL}/scene/${sceneId}/versions/${versionId}`, {
                    cache: "no-store",
                });
                if (!versionResponse.ok) {
                    throw new Error(await extractApiError(versionResponse, `Version load failed (${versionResponse.status})`));
                }
                const versionPayload = await versionResponse.json();
                if (!cancelled) {
                    setReviewPackage((prev) => ({
                        sceneId,
                        versionId,
                        sceneGraph: versionPayload.scene_graph ?? prev?.sceneGraph ?? { environment: null, assets: [] },
                        assetsList: prev?.assetsList ?? [],
                        review: prev?.review,
                        exportedAt: versionPayload.saved_at ?? prev?.exportedAt ?? new Date().toISOString(),
                        summary: {
                            assetCount: Array.isArray(versionPayload.scene_graph?.assets) ? versionPayload.scene_graph.assets.length : 0,
                            hasEnvironment: Boolean(versionPayload.scene_graph?.environment),
                        },
                    }));
                    setStatusMessage("Review scene loaded from saved version.");
                }

                const reviewResponse = await fetch(`${MVP_API_BASE_URL}/scene/${sceneId}/review`, { cache: "no-store" });
                if (reviewResponse.ok) {
                    const reviewPayload = (await reviewResponse.json()) as SceneReviewRecord;
                    if (!cancelled) {
                        setReviewData(reviewPayload);
                    }
                }

                const commentsResponse = await fetch(
                    `${MVP_API_BASE_URL}/scene/${sceneId}/versions/${versionId}/comments`,
                    { cache: "no-store" },
                );
                if (commentsResponse.ok) {
                    const commentsPayload = await commentsResponse.json();
                    if (!cancelled) {
                        setComments(Array.isArray(commentsPayload.comments) ? commentsPayload.comments : []);
                    }
                }
            } catch (error) {
                if (!cancelled) {
                    setStatusMessage(error instanceof Error ? error.message : "Unable to load saved review scene.");
                }
            }
        };

        void load();
        return () => {
            cancelled = true;
        };
    }, [payload, sceneId, versionId]);

    const sceneGraph = useMemo(
        () => reviewPackage?.sceneGraph ?? { environment: null, assets: [] },
        [reviewPackage],
    );

    return (
        <div className="min-h-screen bg-neutral-950 text-white flex flex-col">
            <div className="border-b border-neutral-800 bg-black/30 backdrop-blur px-6 py-4 flex items-center justify-between gap-4">
                <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Gauset Review</p>
                    <h1 className="text-xl font-semibold mt-1">Read-only Scene Review</h1>
                    <p className="text-xs text-neutral-400 mt-2">{statusMessage}</p>
                </div>
                <div className="text-right text-xs text-neutral-400">
                    <p>{reviewPackage?.sceneId ?? "inline review package"}</p>
                    <p>{reviewPackage?.exportedAt ? `Saved ${formatTimestamp(reviewPackage.exportedAt)}` : ""}</p>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] flex-1">
                <div className="min-h-[70vh] border-b xl:border-b-0 xl:border-r border-neutral-900">
                    <ViewerPanel sceneGraph={sceneGraph} setSceneGraph={() => undefined} readOnly />
                </div>
                <aside className="p-6 space-y-5 bg-neutral-950">
                    <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-4">
                        <div className="flex items-center gap-2 text-[10px] font-bold text-neutral-500 uppercase tracking-[0.18em] mb-3">
                            <Share2 className="h-3 w-3" />
                            Summary
                        </div>
                        <div className="space-y-2 text-sm text-neutral-300">
                            <p>{reviewPackage?.summary.assetCount ?? 0} assets in scene</p>
                            <p>{reviewPackage?.summary.hasEnvironment ? "Environment included" : "No environment in this package"}</p>
                            {versionId && <p>Version {versionId}</p>}
                            {reviewData?.approval?.state && (
                                <p>Approval: {reviewData.approval.state.replaceAll("_", " ")}</p>
                            )}
                            {reviewData?.approval?.updated_by && (
                                <p>
                                    Review owner: {reviewData.approval.updated_by}
                                    {reviewData.approval.updated_at ? ` · ${formatTimestamp(reviewData.approval.updated_at)}` : ""}
                                </p>
                            )}
                            {reviewData?.approval?.note && <p className="text-neutral-400">{reviewData.approval.note}</p>}
                        </div>
                    </div>

                    {reviewData?.metadata && (
                        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-4">
                            <div className="flex items-center gap-2 text-[10px] font-bold text-neutral-500 uppercase tracking-[0.18em] mb-3">
                                <MessageSquareText className="h-3 w-3" />
                                Review Metadata
                            </div>
                            <div className="space-y-2 text-sm text-neutral-300">
                                {reviewData.metadata.project_name && <p>Project: {reviewData.metadata.project_name}</p>}
                                {reviewData.metadata.scene_title && <p>Scene: {reviewData.metadata.scene_title}</p>}
                                {reviewData.metadata.location_name && <p>Location: {reviewData.metadata.location_name}</p>}
                                {reviewData.metadata.owner && <p>Owner: {reviewData.metadata.owner}</p>}
                                {reviewData.metadata.notes && (
                                    <p className="text-neutral-400 whitespace-pre-wrap">{reviewData.metadata.notes}</p>
                                )}
                            </div>
                        </div>
                    )}

                    <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-4">
                        <div className="flex items-center gap-2 text-[10px] font-bold text-neutral-500 uppercase tracking-[0.18em] mb-3">
                            <MessageSquareText className="h-3 w-3" />
                            Version Comments
                        </div>
                        {comments.length > 0 ? (
                            <div className="space-y-3">
                                {comments.map((comment) => (
                                    <div key={comment.comment_id} className="rounded-xl border border-neutral-800 bg-neutral-950/70 px-3 py-3">
                                        <div className="flex items-center justify-between gap-3">
                                            <p className="text-sm text-white">{comment.author}</p>
                                            <p className="text-[11px] text-neutral-500">{formatTimestamp(comment.created_at)}</p>
                                        </div>
                                        <p className="mt-2 text-sm text-neutral-300 whitespace-pre-wrap">{comment.body}</p>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-sm text-neutral-500">No pinned comments were found for this version.</p>
                        )}
                    </div>
                </aside>
            </div>
        </div>
    );
}
