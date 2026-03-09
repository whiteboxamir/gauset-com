export function trackMvpEvent(eventName: string, properties: Record<string, unknown> = {}) {
    if (typeof window === "undefined") return;

    const detail = {
        event: eventName,
        properties,
    };

    window.dispatchEvent(new CustomEvent("gauset:mvp-analytics", { detail }));

    const analyticsWindow = window as typeof window & {
        dataLayer?: Array<Record<string, unknown>>;
        gtag?: (...args: unknown[]) => void;
        plausible?: (name: string, payload?: Record<string, unknown>) => void;
        posthog?: { capture?: (name: string, payload?: Record<string, unknown>) => void };
    };

    analyticsWindow.dataLayer?.push({
        event: eventName,
        ...properties,
    });

    analyticsWindow.gtag?.("event", eventName, properties);
    analyticsWindow.plausible?.(eventName, { props: properties });
    analyticsWindow.posthog?.capture?.(eventName, properties);
}
