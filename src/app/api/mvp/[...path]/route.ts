import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOP_BY_HOP_HEADERS = new Set([
    "accept-encoding",
    "connection",
    "content-encoding",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "host",
    "content-length",
]);

function resolveBackendBaseUrl() {
    const explicit =
        process.env.GAUSET_BACKEND_URL ??
        process.env.NEXT_PUBLIC_GAUSET_API_BASE_URL ??
        (process.env.NODE_ENV !== "production" ? "http://127.0.0.1:8000" : "");
    return explicit.trim().replace(/\/$/, "");
}

function buildUnavailableResponse(pathname: string) {
    const isStorageRequest = pathname.startsWith("storage/");
    if (isStorageRequest) {
        return new Response("Local Gauset backend is unavailable.", { status: 503 });
    }

    return Response.json(
        {
            code: "BACKEND_UNAVAILABLE",
            message:
                "The local Gauset backend is not connected. Start the FastAPI server locally or configure GAUSET_BACKEND_URL for this deployment.",
            checklist: [
                "Run the Python backend locally on port 8000, or set GAUSET_BACKEND_URL in the hosting environment.",
                "Verify /api/mvp/health returns a healthy response.",
                "Confirm the backend cloned ML-Sharp and TripoSR and can write to uploads/assets/scenes.",
            ],
        },
        { status: 503 },
    );
}

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
    const { path } = await context.params;
    const pathname = path.join("/");
    const backendBaseUrl = resolveBackendBaseUrl();
    if (!backendBaseUrl) {
        return buildUnavailableResponse(pathname);
    }

    const upstreamUrl = new URL(`${backendBaseUrl}/${pathname}`);
    request.nextUrl.searchParams.forEach((value, key) => {
        upstreamUrl.searchParams.set(key, value);
    });

    const headers = new Headers();
    request.headers.forEach((value, key) => {
        if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
            headers.set(key, value);
        }
    });
    headers.set("accept-encoding", "identity");

    let body: BodyInit | undefined;
    if (request.method !== "GET" && request.method !== "HEAD") {
        body = await request.arrayBuffer();
    }

    try {
        const upstream = await fetch(upstreamUrl, {
            method: request.method,
            headers,
            body,
            cache: "no-store",
            signal: request.signal,
        });

        const responseHeaders = new Headers();
        upstream.headers.forEach((value, key) => {
            if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
                responseHeaders.set(key, value);
            }
        });

        return new Response(request.method === "HEAD" ? null : upstream.body, {
            status: upstream.status,
            statusText: upstream.statusText,
            headers: responseHeaders,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown upstream error";
        const isStorageRequest = pathname.startsWith("storage/");
        if (isStorageRequest) {
            return new Response(message, { status: 502 });
        }
        return Response.json(
            {
                code: "BACKEND_PROXY_ERROR",
                message:
                    "The Gauset frontend reached its proxy route, but the local backend could not be contacted from the server.",
                detail: message,
            },
            { status: 502 },
        );
    }
}

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
    return proxy(request, context);
}

export async function POST(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
    return proxy(request, context);
}

export async function PUT(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
    return proxy(request, context);
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
    return proxy(request, context);
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
    return proxy(request, context);
}

export async function HEAD(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
    return proxy(request, context);
}

export async function OPTIONS(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
    return proxy(request, context);
}
