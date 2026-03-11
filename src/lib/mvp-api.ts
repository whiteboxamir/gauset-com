export const MVP_API_BASE_URL = "/api/mvp";
const LOCAL_DEV_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

type ErrorPayload = {
    detail?: string;
    message?: string;
    checklist?: string[];
};

export async function extractApiError(response: Response, fallback: string) {
    try {
        const payload = (await response.json()) as ErrorPayload;
        const primary = payload.detail || payload.message || fallback;
        const checklist =
            Array.isArray(payload.checklist) && payload.checklist.length > 0
                ? `\n\nNext steps:\n- ${payload.checklist.join("\n- ")}`
                : "";
        return `${primary}${checklist}`;
    } catch {
        return fallback;
    }
}

function normalizeProxyPath(pathname: string) {
    if (pathname.startsWith(`${MVP_API_BASE_URL}/`) || pathname === MVP_API_BASE_URL) {
        return pathname;
    }
    if (pathname.startsWith("/storage/")) {
        return `${MVP_API_BASE_URL}${pathname}`;
    }
    return pathname;
}

export function toProxyUrl(urlOrPath?: string | null) {
    if (!urlOrPath) return "";
    if (urlOrPath.startsWith("http://") || urlOrPath.startsWith("https://")) {
        try {
            const parsed = new URL(urlOrPath);
            if (LOCAL_DEV_HOSTNAMES.has(parsed.hostname)) {
                const normalizedPath = normalizeProxyPath(parsed.pathname);
                return `${normalizedPath}${parsed.search}${parsed.hash}`;
            }
        } catch {
            return urlOrPath;
        }
        return urlOrPath;
    }
    if (urlOrPath.startsWith(MVP_API_BASE_URL)) return urlOrPath;
    if (urlOrPath.startsWith("/storage/")) return `${MVP_API_BASE_URL}${urlOrPath}`;
    if (urlOrPath.startsWith("/")) return `${MVP_API_BASE_URL}${urlOrPath}`;
    return `${MVP_API_BASE_URL}/${urlOrPath}`;
}
