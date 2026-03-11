"use client";

import { AlertTriangle, RefreshCcw } from "lucide-react";

export default function MVPError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    return (
        <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.12),transparent_24%),linear-gradient(180deg,#05070a_0%,#040507_100%)] px-6 py-10 text-white">
            <div className="mx-auto flex min-h-[80vh] max-w-3xl items-center justify-center">
                <div className="w-full rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(10,14,21,0.96),rgba(7,10,14,0.92))] p-8 shadow-[0_28px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl">
                    <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.26em] text-cyan-200/70">
                        <AlertTriangle className="h-4 w-4" />
                        MVP Workspace
                    </div>
                    <h1 className="mt-6 text-3xl font-medium tracking-[-0.04em] text-white">Failed to load workspace</h1>
                    <p className="mt-4 max-w-2xl text-sm leading-7 text-neutral-300">
                        The workspace hit a render error before the editor could finish mounting. The rest of the app is still intact, and you can retry the route without reloading the entire site.
                    </p>
                    <div className="mt-6 rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-neutral-400">
                        {error.message || "Unknown MVP render failure."}
                    </div>
                    <div className="mt-8 flex flex-wrap gap-3">
                        <button
                            type="button"
                            onClick={reset}
                            className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-medium text-black transition-colors hover:bg-neutral-200"
                        >
                            <RefreshCcw className="h-4 w-4" />
                            Retry workspace
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
