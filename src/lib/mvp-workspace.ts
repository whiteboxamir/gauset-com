"use client";

export type Vector3Tuple = [number, number, number];
export type QuaternionTuple = [number, number, number, number];
export type SpatialPinType = "general" | "egress" | "lighting" | "hazard";
export type ReviewIssueSeverity = "low" | "medium" | "high" | "critical";
export type ReviewIssueStatus = "open" | "in_review" | "blocked" | "resolved";

export interface CameraView {
    id: string;
    label: string;
    position: Vector3Tuple;
    target: Vector3Tuple;
    fov: number;
    lens_mm: number;
    note: string;
}

export interface CameraPose {
    position: Vector3Tuple;
    target: Vector3Tuple;
    fov: number;
    lens_mm: number;
}

export interface SpatialPin {
    id: string;
    label: string;
    type: SpatialPinType;
    position: Vector3Tuple;
    created_at: string;
}

export interface CameraPathFrame {
    time: number;
    position: Vector3Tuple;
    target: Vector3Tuple;
    rotation: QuaternionTuple;
    fov: number;
}

export interface ViewerState {
    fov: number;
    lens_mm: number;
}

export interface ReviewMetadata {
    project_name: string;
    scene_title: string;
    location_name: string;
    owner: string;
    notes: string;
    address: string;
    shoot_day: string;
    permit_status: string;
    access_notes: string;
    parking_notes: string;
    power_notes: string;
    safety_notes: string;
}

export interface ReviewApprovalHistoryEntry {
    state?: string;
    updated_at?: string | null;
    updated_by?: string | null;
    note?: string;
}

export interface ReviewApproval {
    state?: string;
    updated_at?: string | null;
    updated_by?: string | null;
    note?: string;
    history?: ReviewApprovalHistoryEntry[];
}

export interface ReviewIssue {
    id: string;
    title: string;
    body: string;
    type: SpatialPinType;
    severity: ReviewIssueSeverity;
    status: ReviewIssueStatus;
    assignee: string;
    author: string;
    anchor_position: Vector3Tuple | null;
    anchor_view_id: string | null;
    version_id: string | null;
    created_at: string;
    updated_at: string;
}

export interface SceneReviewRecord {
    scene_id: string;
    metadata: ReviewMetadata;
    approval: ReviewApproval;
    issues: ReviewIssue[];
}

export interface WorkspaceSceneGraph {
    environment: any;
    assets: any[];
    camera_views: CameraView[];
    pins: SpatialPin[];
    director_path: CameraPathFrame[];
    director_brief: string;
    viewer: ViewerState;
}

export const DEFAULT_FOV = 45;
export const DEFAULT_LENS_MM = 35;

export function createId(prefix: string) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function nowIso() {
    return new Date().toISOString();
}

export function parseVector3Tuple(input: unknown, fallback: Vector3Tuple): Vector3Tuple {
    if (!Array.isArray(input) || input.length !== 3) return fallback;
    const parsed = input.map((value) => Number(value));
    if (parsed.some((value) => Number.isNaN(value))) return fallback;
    return [parsed[0], parsed[1], parsed[2]];
}

export function parseQuaternionTuple(input: unknown, fallback: QuaternionTuple): QuaternionTuple {
    if (!Array.isArray(input) || input.length !== 4) return fallback;
    const parsed = input.map((value) => Number(value));
    if (parsed.some((value) => Number.isNaN(value))) return fallback;
    return [parsed[0], parsed[1], parsed[2], parsed[3]];
}

export function lensMmToFov(lensMm: number, sensorWidth = 36) {
    const safeLens = Math.max(8, Number.isFinite(lensMm) ? lensMm : DEFAULT_LENS_MM);
    return (2 * Math.atan(sensorWidth / (2 * safeLens)) * 180) / Math.PI;
}

export function fovToLensMm(fov: number, sensorWidth = 36) {
    const radians = ((Number.isFinite(fov) ? fov : DEFAULT_FOV) * Math.PI) / 180;
    return sensorWidth / (2 * Math.tan(radians / 2));
}

export function formatPinTypeLabel(value: SpatialPinType) {
    if (value === "egress") return "Egress";
    if (value === "lighting") return "Lighting";
    if (value === "hazard") return "Hazard";
    return "General";
}

export function defaultViewerState(): ViewerState {
    return {
        fov: DEFAULT_FOV,
        lens_mm: DEFAULT_LENS_MM,
    };
}

export function defaultReviewMetadata(): ReviewMetadata {
    return {
        project_name: "",
        scene_title: "",
        location_name: "",
        owner: "",
        notes: "",
        address: "",
        shoot_day: "",
        permit_status: "",
        access_notes: "",
        parking_notes: "",
        power_notes: "",
        safety_notes: "",
    };
}

export function createDefaultReviewRecord(sceneId?: string | null): SceneReviewRecord {
    return {
        scene_id: sceneId ?? "",
        metadata: defaultReviewMetadata(),
        approval: {
            state: "draft",
            updated_at: null,
            updated_by: null,
            note: "",
            history: [],
        },
        issues: [],
    };
}

function normalizeCameraView(raw: unknown, index: number): CameraView | null {
    if (!raw || typeof raw !== "object") return null;
    const input = raw as Partial<CameraView>;
    const position = parseVector3Tuple(input.position, [5, 4, 6]);
    const target = parseVector3Tuple(input.target, [0, 0, 0]);
    const fov = Number.isFinite(input.fov) ? Number(input.fov) : DEFAULT_FOV;
    const lensMm =
        Number.isFinite(input.lens_mm) && Number(input.lens_mm) > 0 ? Number(input.lens_mm) : fovToLensMm(fov);

    return {
        id: typeof input.id === "string" && input.id ? input.id : createId("view"),
        label: typeof input.label === "string" && input.label ? input.label : `View ${index + 1}`,
        position,
        target,
        fov,
        lens_mm: Math.round(lensMm * 10) / 10,
        note: typeof input.note === "string" ? input.note : "",
    };
}

function normalizePin(raw: unknown, index: number): SpatialPin | null {
    if (!raw || typeof raw !== "object") return null;
    const input = raw as Partial<SpatialPin>;
    const type: SpatialPinType =
        input.type === "egress" || input.type === "lighting" || input.type === "hazard" ? input.type : "general";

    return {
        id: typeof input.id === "string" && input.id ? input.id : createId("pin"),
        label: typeof input.label === "string" && input.label ? input.label : `Pin ${index + 1}`,
        type,
        position: parseVector3Tuple(input.position, [0, 0, 0]),
        created_at: typeof input.created_at === "string" && input.created_at ? input.created_at : nowIso(),
    };
}

function normalizePathFrame(raw: unknown): CameraPathFrame | null {
    if (!raw || typeof raw !== "object") return null;
    const input = raw as Partial<CameraPathFrame>;
    return {
        time: Number.isFinite(input.time) ? Number(input.time) : 0,
        position: parseVector3Tuple(input.position, [0, 0, 0]),
        target: parseVector3Tuple(input.target, [0, 0, 0]),
        rotation: parseQuaternionTuple(input.rotation, [0, 0, 0, 1]),
        fov: Number.isFinite(input.fov) ? Number(input.fov) : DEFAULT_FOV,
    };
}

export function normalizeWorkspaceSceneGraph(sceneGraph: unknown): WorkspaceSceneGraph {
    const raw = sceneGraph && typeof sceneGraph === "object" ? (sceneGraph as Record<string, unknown>) : {};
    const viewerInput = raw.viewer && typeof raw.viewer === "object" ? (raw.viewer as Partial<ViewerState>) : {};
    const fov = Number.isFinite(viewerInput.fov) ? Number(viewerInput.fov) : DEFAULT_FOV;
    const lensMm =
        Number.isFinite(viewerInput.lens_mm) && Number(viewerInput.lens_mm) > 0
            ? Number(viewerInput.lens_mm)
            : fovToLensMm(fov);

    return {
        environment: raw.environment ?? null,
        assets: Array.isArray(raw.assets) ? raw.assets : [],
        camera_views: Array.isArray(raw.camera_views)
            ? raw.camera_views.map(normalizeCameraView).filter(Boolean) as CameraView[]
            : [],
        pins: Array.isArray(raw.pins) ? raw.pins.map(normalizePin).filter(Boolean) as SpatialPin[] : [],
        director_path: Array.isArray(raw.director_path)
            ? raw.director_path.map(normalizePathFrame).filter(Boolean) as CameraPathFrame[]
            : [],
        director_brief: typeof raw.director_brief === "string" ? raw.director_brief : "",
        viewer: {
            fov,
            lens_mm: Math.round(lensMm * 10) / 10,
        },
    };
}

function normalizeReviewIssue(raw: unknown): ReviewIssue | null {
    if (!raw || typeof raw !== "object") return null;
    const input = raw as Partial<ReviewIssue>;
    const type: SpatialPinType =
        input.type === "egress" || input.type === "lighting" || input.type === "hazard" ? input.type : "general";
    const severity: ReviewIssueSeverity =
        input.severity === "low" || input.severity === "high" || input.severity === "critical" ? input.severity : "medium";
    const status: ReviewIssueStatus =
        input.status === "in_review" || input.status === "blocked" || input.status === "resolved" ? input.status : "open";

    return {
        id: typeof input.id === "string" && input.id ? input.id : createId("issue"),
        title: typeof input.title === "string" ? input.title : "",
        body: typeof input.body === "string" ? input.body : "",
        type,
        severity,
        status,
        assignee: typeof input.assignee === "string" ? input.assignee : "",
        author: typeof input.author === "string" && input.author ? input.author : "Reviewer",
        anchor_position: Array.isArray(input.anchor_position)
            ? parseVector3Tuple(input.anchor_position, [0, 0, 0])
            : null,
        anchor_view_id: typeof input.anchor_view_id === "string" && input.anchor_view_id ? input.anchor_view_id : null,
        version_id: typeof input.version_id === "string" && input.version_id ? input.version_id : null,
        created_at: typeof input.created_at === "string" && input.created_at ? input.created_at : nowIso(),
        updated_at: typeof input.updated_at === "string" && input.updated_at ? input.updated_at : nowIso(),
    };
}

export function normalizeReviewRecord(raw: unknown, sceneId?: string | null): SceneReviewRecord {
    const baseline = createDefaultReviewRecord(sceneId);
    if (!raw || typeof raw !== "object") {
        return baseline;
    }

    const input = raw as Partial<SceneReviewRecord>;
    const metadataInput = input.metadata && typeof input.metadata === "object" ? input.metadata : {};
    const approvalInput = input.approval && typeof input.approval === "object" ? input.approval : {};

    return {
        scene_id: typeof input.scene_id === "string" ? input.scene_id : baseline.scene_id,
        metadata: {
            ...baseline.metadata,
            ...metadataInput,
        },
        approval: {
            ...baseline.approval,
            ...approvalInput,
            history: Array.isArray(approvalInput.history) ? approvalInput.history : [],
        },
        issues: Array.isArray(input.issues) ? input.issues.map(normalizeReviewIssue).filter(Boolean) as ReviewIssue[] : [],
    };
}
