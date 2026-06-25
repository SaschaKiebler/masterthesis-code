/**
 * Core API Types
 * These types match the protobuf contracts defined in apis/proto/core/v1/
 */

// Common types
export interface UUID {
    value: string;
}

export interface PageRequest {
    page: number;
    pageSize: number;
}

export interface PageInfo {
    totalItems: number;
    totalPages: number;
    currentPage: number;
    pageSize: number;
}

export interface TimeRange {
    from: number; // Unix timestamp (seconds)
    to: number;   // Unix timestamp (seconds)
}

export interface JsonValue {
    json: string;
}

// Site types
export interface SiteSummary {
    id: string;
    name: string;
    address: string;
    assetCount: number;
    latitude?: number;
    longitude?: number;
}

export interface Site {
    id: string;
    tenantId: string;
    name: string;
    address: string;
    latitude?: number;
    longitude?: number;
    metadata?: JsonValue;
}

export interface ListSitesResponse {
    sites: SiteSummary[];
    page: PageInfo;
}

export interface GetSiteResponse {
    site: Site;
    assets: AssetSummary[];
}

// Asset types
export interface AssetSummary {
    id: string;
    deviceId: string;
    name: string;
    type: string;
    modelHuman: string;
    signalMap?: JsonValue | string;
    spaceId?: string;
}

export interface Asset {
    id: string;
    deviceId: string;
    siteId: string;
    spaceId?: string;
    name: string;
    type: string;
    modelHuman: string;
    specs?: JsonValue;
    signalMap?: JsonValue;
}

export interface GetAssetResponse {
    asset: Asset;
}

// Measurement types
export interface Measurement {
    time: number; // Unix timestamp (seconds)
    deviceId: string;
    metricId: number;
    metricName: string;
    value: number;
}

export interface GetMeasurementsResponse {
    measurements: Measurement[];
}

export interface GetLatestMeasurementsResponse {
    measurements: Measurement[];
}

// Ontology Registry types (ADR-007)
export interface ObjectType {
    id: string;
    name: string;
    displayName: string;
    category: string;
    description?: string;
    icon?: string;
    svgIconUrl?: string;     // GCS URL of AI-generated SVG icon
    propertySchema?: string; // JSON Schema string
    sortOrder: number;
}

export interface ObjectTypesResponse {
    objectTypes: ObjectType[];
}

export interface DeviceTemplate {
    id: string;
    tenantId: string | null;
    name: string;
    manufacturer?: string;
    modelNumber?: string;
    description?: string;
    protocol?: string;
    defaultSignalMap?: string; // JSON string
    defaultSpecs?: string; // JSON string
    secretsSchema?: string; // JSON Schema string
    sortOrder: number;
    objectType?: {
        id: string;
        name: string;
        displayName: string;
        category: string;
        icon?: string;
    };
}

export interface DeviceTemplatesResponse {
    deviceTemplates: DeviceTemplate[];
}

// Ontology Registry CRUD types (ADR-007 Phase 4)
export interface CreateObjectTypeRequest {
    name: string;
    displayName: string;
    category: string;
    description?: string;
    icon?: string;
    propertySchema?: string;
    sortOrder?: number;
}

export interface UpdateObjectTypeRequest {
    displayName?: string;
    category?: string;
    description?: string;
    icon?: string;
    propertySchema?: string;
    sortOrder?: number;
}

export interface ObjectTypeResponse {
    objectType: ObjectType;
}

export interface CreateDeviceTemplateRequest {
    name: string;
    manufacturer?: string;
    modelNumber?: string;
    description?: string;
    objectTypeId?: string;
    protocol?: string;
    defaultSignalMap?: string;
    defaultSpecs?: string;
    secretsSchema?: string;
    sortOrder?: number;
    tenantId?: string;
}

export interface UpdateDeviceTemplateRequest {
    name?: string;
    manufacturer?: string;
    modelNumber?: string;
    description?: string;
    objectTypeId?: string;
    protocol?: string;
    defaultSignalMap?: string;
    defaultSpecs?: string;
    secretsSchema?: string;
    sortOrder?: number;
}

export interface DeviceTemplateResponse {
    deviceTemplate: DeviceTemplate;
}

export interface DeleteResponse {
    message: string;
}

// AI Template Generation (n8n workflow)
export interface GenerateTemplateResponse {
    sensorName: string;
    confidence: number;
    sources: string[];
    status: "simulated" | "needs_review" | "failed";
    payload: GeneratedTemplatePayload | null;
}

export interface GeneratedTemplatePayload {
    name: string;
    manufacturer?: string;
    modelNumber?: string;
    description?: string;
    protocol?: string;
    defaultSignalMap?: string;
    defaultSpecs?: string;
    secretsSchema?: string;
    sortOrder?: number;
    objectTypeHint?: string;
}

// Space types
export interface SpaceDTO {
    id: string;
    siteId: string;
    parentSpaceId: string | null;
    type: string;
    name: string;
    attributes: string;
    children: SpaceDTO[];
}

export interface SpacesResponse {
    spaces: SpaceDTO[];
}

export interface CreateSpaceRequest {
    type: string;
    name: string;
    parentSpaceId?: string;
    attributes?: string;
}

export interface UpdateSpaceRequest {
    type?: string;
    name?: string;
    parentSpaceId?: string;
    attributes?: string;
}

// Site-level measurement types (Consultant Analysis View)
export interface SiteMeasurementsResponse {
    measurements: Measurement[];
    bucketMinutes: number;
    count: number;
}

export interface MeasurementStatistic {
    deviceId: string;
    metricId: number;
    metricName: string;
    min: number;
    max: number;
    avg: number;
    stddev: number;
    sampleCount: number;
}

export interface SiteStatisticsResponse {
    statistics: MeasurementStatistic[];
}

// Fleet types (God Mode)
export interface FleetSiteHealth {
    id: string;
    name: string;
    address: string;
    tenantId: string;
    tenantName: string;
    latitude: number | null;
    longitude: number | null;
    assetCount: number;
    health: {
        status: 'healthy' | 'warning' | 'critical' | 'offline';
        onlineAssets: number;
        offlineAssets: number;
        staleSensors: number;
        lastDataReceived: number | null; // Unix timestamp (seconds)
    };
}

export interface FleetSummary {
    totalSites: number;
    totalAssets: number;
    totalTenants: number;
    healthyCount: number;
    warningCount: number;
    criticalCount: number;
    offlineCount: number;
}

export interface FleetStatusResponse {
    sites: FleetSiteHealth[];
    summary: FleetSummary;
}

// Link type registry (ADR-011 Phase C)
export interface ApiLinkType {
    id: string;
    name: string;
    displayName: string;
    description?: string;
    inverseName?: string;
}

export interface LinkTypesResponse {
    linkTypes: ApiLinkType[];
}

export interface CreateLinkTypeRequest {
    name: string;
    displayName: string;
    description?: string;
    inverseName?: string;
}

export interface CreateLinkTypeResponse {
    linkType: ApiLinkType;
}

// Graph types (ADR-011 Phase C)
export interface GraphObject {
    id: string;
    displayName: string;
    objectTypeName: string;
    objectTypeDisplayName: string;
    objectTypeCategory: string;
    objectTypeIcon?: string;
    objectTypeSvgIconUrl?: string;      // GCS URL of AI-generated SVG icon for synoptic view
    objectTypePropertySchema?: string;  // JSON string of PropertySchema from object type
    properties?: string;                // JSON string of instance properties (includes "custom" namespace)
}

// ADR-014: Custom Object Properties ("Technische Daten")
export type PropertyFieldType = "text" | "number" | "boolean" | "date" | "select";

export interface PropertyFieldDefinition {
    key: string;
    label: string;
    type: PropertyFieldType;
    unit?: string;
    required?: boolean;
    description?: string;
    options?: string[];  // for "select" type
    min?: number;        // for "number" type
    max?: number;        // for "number" type
}

export interface PropertySchema {
    fields: PropertyFieldDefinition[];
}

export interface GraphLink {
    id: string;
    sourceId: string;
    sourceName: string;
    sourceTypeName: string;
    targetId: string;
    targetName: string;
    targetTypeName: string;
    linkTypeName: string;
    linkTypeDisplayName: string;
    createdAt?: number;
}

export interface SiteObjectsResponse {
    objects: GraphObject[];
}

export interface ObjectLinksResponse {
    outbound: GraphLink[];
    inbound: GraphLink[];
}

export interface CreateLinkRequest {
    sourceId: string;
    targetId: string;
    linkTypeName: string;
}

export interface CreateLinkResponse {
    link: GraphLink;
}

export interface SiteGraphResponse {
    objects: GraphObject[];
    links: GraphLink[];
}

// Project types (ADR-012)
export interface ProjectDTO {
    id: string;
    tenantId: string;
    name: string;
    description: string | null;
    status: string;
    siteCount: number;
    createdAt: string;
    updatedAt: string;
}

export interface ProjectSiteDTO {
    siteId: string;
    siteName: string;
    addedAt: string;
}

export interface ProjectDetailDTO {
    id: string;
    tenantId: string;
    name: string;
    description: string | null;
    status: string;
    sites: ProjectSiteDTO[];
    createdAt: string;
    updatedAt: string;
}

export interface ProjectsResponse {
    projects: ProjectDTO[];
}

export interface ProjectDetailResponse {
    project: ProjectDetailDTO;
}

export interface ProjectGraphResponse {
    objects: GraphObject[];
    links: GraphLink[];
}

export interface CreateProjectRequest {
    name: string;
    description?: string;
    tenantId: string;
}

export interface CreateObjectRequest {
    objectTypeName: string;
    displayName: string;
    tenantId: string;
    projectId?: string;
    device?: {
        deviceId?: string;
        modelHuman?: string;
        signalMap?: Record<string, SignalMapEntry>;
        specs?: Record<string, unknown>;
    };
}

export interface CreateObjectResponse {
    object: GraphObject;
}

// Device config (assets extension for device-category objects)
export interface DeviceConfig {
    objectId: string;
    deviceId: string;
    modelHuman: string | null;
    signalMap: string | null;
    specs: string | null;
    type: string;
    name: string;
}

export interface DeviceConfigResponse {
    device: DeviceConfig;
}

export interface UpdateDeviceConfigRequest {
    deviceId?: string;
    modelHuman?: string;
    signalMap?: Record<string, SignalMapEntry> | string;
    specs?: Record<string, unknown> | string;
}

export interface SignalMapEntry {
    name: string;
    unit?: string;
    source?: string;
    field?: string;
    min?: number;
    max?: number;
}

// ─── MQTT Device Discovery ────────────────────────────────────────────────────

export interface StartDiscoveryRequest {
    deviceId: string;
    tenantId?: string;
}

export interface CapturedMessage {
    topic: string;
    rawPayload: string;
    parsedPayload: Record<string, unknown> | null;
    timestamp: number; // epoch ms
}

export interface DiscoverySession {
    sessionId: string;
    deviceId: string;
    tenantId: string;
    status: "LISTENING" | "STOPPED" | "TIMED_OUT";
    messageCount: number;
    uniqueTopicCount: number;
    startedAt: number; // epoch ms
    stoppedAt: number | null;
    messages: CapturedMessage[];
}

export interface SuggestedSignal {
    metricId: string;
    source: string;
    field: string;
    name: string;
    unit: string;
    type: string;
}

export interface PayloadAnalysis {
    fieldsBySource: Record<string, string[]>;
    fieldTypes: Record<string, string>;
    suggestedSignalMap: SuggestedSignal[];
    detectedProtocol: string;
    messageCount: number;
    sourcesCount: number;
}

// ─── ADR-013: Metric Points, Physical Quantities, Events, Derived Properties ──

export interface MetricPointRef {
    // Stable UUID reference — replaces the fragile assetId+metric string pair
    metricPointId?: string;
    // Backward compat: old-style reference (still supported during migration)
    assetId?: string;
    metric?: string;
}

// ─── Dashboard types (ADR-012 Phase 3) ───────────────────────────────────────
export interface WidgetPosition {
    row: number;
    col: number;
    rowSpan: number;
    colSpan: number;
}

export interface WidgetConfig {
    // Shared
    title?: string;

    // time_series, stat_card, status, gauge — legacy (signal_map era)
    assetId?: string;
    metric?: string;

    // ADR-013: stable metric point reference (replaces assetId+metric)
    metricPointId?: string;
    metricId?: number;  // numeric metric ID for client-side filtering (gauge, stat_card)

    // KPI formula as data source (evaluated server-side)
    kpiFormulaId?: string;

    // time_series specific (can have multiple)
    series?: Array<{
        // ADR-013 preferred
        metricPointId?: string;
        metricId?: number;
        // Legacy fallback
        assetId?: string;
        metric?: string;
        color?: string;
        label?: string;
        // KPI formula as data source
        kpiFormulaId?: string;
    }>;
    yAxis?: { min?: number; max?: number; unit?: string };
    timePreset?: string;       // "1h"|"3h"|"6h"|"12h"|"24h"|"3d"|"7d"|"30d" — undefined = page-level
    bucketMinutes?: number;    // 0 (raw/all) | 1|5|15|60|360|1440 — undefined = auto-calculate from range

    // status specific
    states?: Record<string, { label: string; color: string }>;

    // heating_curve specific
    siteId?: string;

    // ADR-013: derived_property widget
    propertyName?: string;
    displayFormat?: "percent" | "number" | "text";
    thresholds?: Array<{ value: number; color: string; label: string }>;

    // ADR-013: event_timeline widget
    scope?: "project" | "object";
    severityFilter?: string[];
    eventTypeFilter?: string[];
    maxItems?: number;

    // ADR-013: comparison widget
    quantityName?: string;
    objectIds?: string[];

    // Frontend-only value transform (e.g. pulse count → liters)
    valueTransform?: {
        multiply?: number;  // value * multiply
        offset?: number;    // + offset  (applied after multiply)
        decimals?: number;  // round to N decimals (default 1)
        unit?: string;      // override display unit after transform
    };

    // Migration status (set when automatic migration couldn't resolve)
    migrationStatus?: "ok" | "needs_review";
}

export interface DashboardWidget {
    id: string;
    type: "time_series" | "gauge" | "status" | "heating_curve" | "stat_card"
        | "derived_property" | "event_timeline" | "comparison" | "event_log";
    title: string;
    position: WidgetPosition;
    config: WidgetConfig;
}

export interface DashboardLayout {
    columns: number;
    widgets: DashboardWidget[];
}

export interface Dashboard {
    id: string;
    projectId: string;
    name: string;
    sortOrder: number;
    scopeType?: string;
    scopeId?: string;
    layout: string; // JSON string from backend, parsed to DashboardLayout in frontend
    createdAt: string;
    updatedAt: string;
}

export interface CreateDashboardRequest {
    name: string;
    sortOrder?: number;
    scopeType?: string;
    scopeId?: string;
    layout?: string | DashboardLayout;
}

export interface UpdateDashboardRequest {
    name?: string;
    sortOrder?: number;
    scopeType?: string;
    scopeId?: string;
    layout?: string | DashboardLayout;
}

export interface ListDashboardsResponse {
    dashboards: Dashboard[];
}

export interface GetDashboardResponse {
    dashboard: Dashboard;
}
