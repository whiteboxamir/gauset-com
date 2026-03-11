import MVPRouteClient from "./MVPRouteClient";

export default function MVPPage() {
    return <MVPRouteClient clarityMode={process.env.NEXT_PUBLIC_MVP_CLARITY_DEFAULT === "1"} routeVariant="workspace" />;
}
