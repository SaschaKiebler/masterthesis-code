/**
 * Device Template Modal
 * Create/Edit device template form
 * Sections: Identity, Classification, Default Signal Map, Default Specs, Secrets Schema
 */

"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { Modal, ModalHeader, ModalContent, ModalFooter } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { SignalMapStep } from "@/components/assets/SignalMapStep";
import { parseSignalMap, parseAiSignalMap, signalEntriesToJson, parseSecretsFields } from "@/lib/utils/signal-map";
import { createDeviceTemplate, updateDeviceTemplate, generateTemplate } from "@/lib/api/registry";
import type { DeviceTemplate, ObjectType, CreateDeviceTemplateRequest, UpdateDeviceTemplateRequest, GenerateTemplateResponse } from "@/lib/api/types";
import type { SignalEntry } from "@/lib/utils/signal-map";
import { Info, Sparkles, ExternalLink, AlertTriangle } from "lucide-react";

interface DeviceTemplateModalProps {
    open: boolean;
    onClose: () => void;
    onSuccess: () => void;
    objectTypes: ObjectType[];
    template?: DeviceTemplate;
    initialProtocol?: string;
    initialSignalEntries?: SignalEntry[];
    initialManufacturer?: string;
}

interface FormErrors {
    name?: string;
    general?: string;
    defaultSpecs?: string;
    secretsSchema?: string;
}

const PROTOCOL_SUGGESTIONS = ["LORA", "WMBUS", "MODBUS", "SHELLY", "MQTT", "ZIGBEE", "ZWAVE", "MBUS"];

export function DeviceTemplateModal({
    open,
    onClose,
    onSuccess,
    objectTypes,
    template,
    initialProtocol,
    initialSignalEntries,
    initialManufacturer,
}: DeviceTemplateModalProps) {
    const isEditing = !!template;

    // AI Auto-fill state
    const [aiSensorName, setAiSensorName] = useState("");
    const [aiLoading, setAiLoading] = useState(false);
    const [aiError, setAiError] = useState<string | null>(null);
    const [aiResult, setAiResult] = useState<GenerateTemplateResponse | null>(null);

    // Identity
    const [name, setName] = useState(template?.name ?? "");
    const [manufacturer, setManufacturer] = useState(template?.manufacturer ?? initialManufacturer ?? "");
    const [modelNumber, setModelNumber] = useState(template?.modelNumber ?? "");
    const [description, setDescription] = useState(template?.description ?? "");

    // Classification
    const [objectTypeId, setObjectTypeId] = useState(template?.objectType?.id ?? "");
    const [protocol, setProtocol] = useState(template?.protocol ?? initialProtocol ?? "");

    // Signal Map
    const [signalEntries, setSignalEntries] = useState<SignalEntry[]>(
        () => initialSignalEntries ?? parseSignalMap(template?.defaultSignalMap)
    );

    // Default Specs
    const [defaultSpecs, setDefaultSpecs] = useState(
        () => formatJson(template?.defaultSpecs)
    );

    // Secrets Schema
    const [secretsSchema, setSecretsSchema] = useState(
        () => formatJson(template?.secretsSchema)
    );

    // Sort order
    const [sortOrder, setSortOrder] = useState(String(template?.sortOrder ?? 0));

    // State
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errors, setErrors] = useState<FormErrors>({});

    const applyAiPayload = useCallback((res: GenerateTemplateResponse) => {
        const p = res.payload;
        if (!p) return;
        if (p.name) setName(p.name);
        if (p.manufacturer) setManufacturer(p.manufacturer);
        if (p.modelNumber) setModelNumber(p.modelNumber);
        if (p.description) setDescription(p.description);
        if (p.protocol) setProtocol(p.protocol);
        if (p.defaultSignalMap) {
            console.log("[AI] raw defaultSignalMap:", p.defaultSignalMap);
            const entries = parseAiSignalMap(p.defaultSignalMap);
            console.log("[AI] parsed entries:", entries);
            if (entries.length > 0) setSignalEntries(entries);
        }
        if (p.defaultSpecs) setDefaultSpecs(formatJson(p.defaultSpecs));
        // secretsSchema intentionally NOT auto-filled — connection secrets
        // (MQTT broker, device ID, credentials) are configured elsewhere in the platform
        if (p.sortOrder !== undefined) setSortOrder(String(p.sortOrder));
        // Try to match objectTypeHint to an objectType
        if (p.objectTypeHint) {
            const hint = p.objectTypeHint.toLowerCase();
            const match = objectTypes.find(
                (ot) =>
                    ot.name.toLowerCase() === hint ||
                    ot.displayName.toLowerCase() === hint ||
                    ot.name.toLowerCase().includes(hint) ||
                    ot.displayName.toLowerCase().includes(hint)
            );
            if (match) setObjectTypeId(match.id);
        }
    }, [objectTypes]);

    async function handleAiGenerate() {
        if (!aiSensorName.trim()) return;
        setAiLoading(true);
        setAiError(null);
        setAiResult(null);
        try {
            const res = await generateTemplate(aiSensorName.trim());
            setAiResult(res);
            applyAiPayload(res);
        } catch (err: any) {
            setAiError(err?.message || "Failed to generate template. Please try again.");
        } finally {
            setAiLoading(false);
        }
    }

    // Secrets schema preview
    const secretsPreview = useMemo(
        () => parseSecretsFields(secretsSchema),
        [secretsSchema]
    );

    function validate(): boolean {
        const newErrors: FormErrors = {};

        if (!name.trim()) {
            newErrors.name = "Template name is required";
        } else if (name.trim().length < 2) {
            newErrors.name = "Name must be at least 2 characters";
        }

        if (defaultSpecs.trim() && defaultSpecs.trim() !== "{}") {
            try { JSON.parse(defaultSpecs); } catch {
                newErrors.defaultSpecs = "Invalid JSON";
            }
        }

        if (secretsSchema.trim() && secretsSchema.trim() !== "{}") {
            try { JSON.parse(secretsSchema); } catch {
                newErrors.secretsSchema = "Invalid JSON Schema";
            }
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!validate()) return;

        setIsSubmitting(true);
        setErrors({});

        try {
            const signalMapJson = signalEntriesToJson(signalEntries);
            console.log("[SUBMIT] signalEntries count:", signalEntries.length, "entries:", signalEntries);
            console.log("[SUBMIT] signalMapJson:", signalMapJson);

            if (isEditing && template) {
                const body: UpdateDeviceTemplateRequest = {};
                if (name.trim() !== template.name) body.name = name.trim();
                if (manufacturer.trim() !== (template.manufacturer ?? "")) body.manufacturer = manufacturer.trim() || undefined;
                if (modelNumber.trim() !== (template.modelNumber ?? "")) body.modelNumber = modelNumber.trim() || undefined;
                if (description.trim() !== (template.description ?? "")) body.description = description.trim() || undefined;
                if (objectTypeId !== (template.objectType?.id ?? "")) body.objectTypeId = objectTypeId || undefined;
                if (protocol.trim() !== (template.protocol ?? "")) body.protocol = protocol.trim() || undefined;
                body.defaultSignalMap = signalMapJson !== "{}" ? signalMapJson : undefined;
                body.defaultSpecs = defaultSpecs.trim() && defaultSpecs.trim() !== "{}" ? defaultSpecs.trim() : undefined;
                body.secretsSchema = secretsSchema.trim() && secretsSchema.trim() !== "{}" ? secretsSchema.trim() : undefined;
                if (parseInt(sortOrder) !== template.sortOrder) body.sortOrder = parseInt(sortOrder) || 0;

                await updateDeviceTemplate(template.id, body);
            } else {
                const body: CreateDeviceTemplateRequest = {
                    name: name.trim(),
                };
                if (manufacturer.trim()) body.manufacturer = manufacturer.trim();
                if (modelNumber.trim()) body.modelNumber = modelNumber.trim();
                if (description.trim()) body.description = description.trim();
                if (objectTypeId) body.objectTypeId = objectTypeId;
                if (protocol.trim()) body.protocol = protocol.trim().toUpperCase();
                if (signalMapJson !== "{}") body.defaultSignalMap = signalMapJson;
                if (defaultSpecs.trim() && defaultSpecs.trim() !== "{}") body.defaultSpecs = defaultSpecs.trim();
                if (secretsSchema.trim() && secretsSchema.trim() !== "{}") body.secretsSchema = secretsSchema.trim();
                body.sortOrder = parseInt(sortOrder) || 0;

                await createDeviceTemplate(body);
            }

            onSuccess();
        } catch (error: any) {
            setErrors({ general: error?.message || "Failed to save template." });
        } finally {
            setIsSubmitting(false);
        }
    }

    return (
        <Modal open={open} onClose={onClose} className="md:max-w-2xl">
            <ModalHeader onClose={onClose}>
                {isEditing ? "Edit Device Template" : "Create Device Template"}
            </ModalHeader>

            <form onSubmit={handleSubmit}>
                <ModalContent>
                    <div className="space-y-6">
                        {errors.general && (
                            <div className="p-3 rounded-lg bg-danger/10 border border-danger/20 text-sm text-danger" role="alert">
                                {errors.general}
                            </div>
                        )}

                        {/* AI Auto-fill (create mode only) */}
                        {!isEditing && (
                            <AiAutoFillSection
                                sensorName={aiSensorName}
                                onSensorNameChange={setAiSensorName}
                                onGenerate={handleAiGenerate}
                                loading={aiLoading}
                                error={aiError}
                                result={aiResult}
                            />
                        )}

                        {/* Section 1: Identity */}
                        <Section title="Identity">
                            <Input
                                label="Template Name"
                                placeholder='e.g. "Dragino LHT65" or "Engelmann SensoStar U"'
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                error={errors.name}
                                required
                                disabled={isSubmitting}
                            />
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <Input
                                    label="Manufacturer"
                                    placeholder="e.g. Dragino, Viessmann"
                                    value={manufacturer}
                                    onChange={(e) => setManufacturer(e.target.value)}
                                    disabled={isSubmitting}
                                />
                                <Input
                                    label="Model Number"
                                    placeholder="e.g. LHT65-N"
                                    value={modelNumber}
                                    onChange={(e) => setModelNumber(e.target.value)}
                                    disabled={isSubmitting}
                                />
                            </div>
                            <div>
                                <label htmlFor="dt-description" className="block text-sm font-medium text-foreground mb-1">
                                    Description
                                </label>
                                <textarea
                                    id="dt-description"
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    placeholder="Brief description of this device model..."
                                    rows={2}
                                    disabled={isSubmitting}
                                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-base focus:outline-none focus:ring-2 focus:ring-primary resize-y"
                                />
                            </div>
                        </Section>

                        {/* Section 2: Classification */}
                        <Section title="Classification">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <Select
                                    label="Object Type"
                                    value={objectTypeId}
                                    onChange={(e) => setObjectTypeId(e.target.value)}
                                    disabled={isSubmitting}
                                >
                                    <option value="">None</option>
                                    {objectTypes.map((ot) => (
                                        <option key={ot.id} value={ot.id}>
                                            {ot.displayName} ({ot.category})
                                        </option>
                                    ))}
                                </Select>
                                <div>
                                    <label htmlFor="dt-protocol" className="block text-sm font-medium text-foreground mb-1">
                                        Protocol
                                    </label>
                                    <input
                                        id="dt-protocol"
                                        type="text"
                                        list="protocol-suggestions"
                                        value={protocol}
                                        onChange={(e) => setProtocol(e.target.value)}
                                        placeholder="e.g. LORA, WMBUS"
                                        disabled={isSubmitting}
                                        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-base focus:outline-none focus:ring-2 focus:ring-primary"
                                    />
                                    <datalist id="protocol-suggestions">
                                        {PROTOCOL_SUGGESTIONS.map((p) => (
                                            <option key={p} value={p} />
                                        ))}
                                    </datalist>
                                </div>
                            </div>
                            <Input
                                label="Sort Order"
                                type="number"
                                value={sortOrder}
                                onChange={(e) => setSortOrder(e.target.value)}
                                disabled={isSubmitting}
                                helperText="Lower numbers appear first"
                            />
                        </Section>

                        {/* Section 3: Default Signal Map */}
                        <Section title="Default Signal Map" hint="Pre-configured metric mappings auto-filled when this template is selected during asset registration.">
                            <SignalMapStep entries={signalEntries} onChange={setSignalEntries} />
                        </Section>

                        {/* Section 4: Default Specs (JSON) */}
                        <Section title="Default Specs" hint="Factory specifications as JSON. Auto-filled during registration.">
                            <JsonEditor
                                id="dt-specs"
                                value={defaultSpecs}
                                onChange={setDefaultSpecs}
                                placeholder='e.g. {"battery_type": "AA", "measurement_range": "-20..70°C"}'
                                error={errors.defaultSpecs}
                                disabled={isSubmitting}
                            />
                        </Section>

                        {/* Section 5: Secrets Schema (JSON Schema) */}
                        <Section title="Secrets Schema" hint="JSON Schema defining what secrets this device model requires. Drives dynamic form fields during registration.">
                            <JsonEditor
                                id="dt-secrets"
                                value={secretsSchema}
                                onChange={setSecretsSchema}
                                placeholder='e.g. {"required":["aes_key"],"properties":{"aes_key":{"type":"string","title":"AES-128 Key","pattern":"^[0-9a-fA-F]{32}$"}}}'
                                error={errors.secretsSchema}
                                disabled={isSubmitting}
                                rows={4}
                            />
                            {secretsPreview.length > 0 && (
                                <div className="p-3 rounded-lg bg-muted/50 border border-border text-sm">
                                    <p className="text-xs font-medium text-muted-foreground mb-2">Preview — fields rendered during registration:</p>
                                    <ul className="space-y-1">
                                        {secretsPreview.map((f) => (
                                            <li key={f.key} className="flex items-center gap-2 text-foreground">
                                                <span className="font-medium">{f.title}</span>
                                                {f.required && <span className="text-danger text-xs">required</span>}
                                                {f.description && <span className="text-muted-foreground text-xs">— {f.description}</span>}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </Section>
                    </div>
                </ModalContent>

                <ModalFooter>
                    <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
                        Cancel
                    </Button>
                    <Button type="submit" variant="primary" loading={isSubmitting}>
                        {isSubmitting
                            ? (isEditing ? "Saving..." : "Creating...")
                            : (isEditing ? "Save Changes" : "Create Template")}
                    </Button>
                </ModalFooter>
            </form>
        </Modal>
    );
}

// --- Helper Components ---

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
    return (
        <div className="space-y-3">
            <div>
                <h3 className="text-sm font-semibold text-foreground">{title}</h3>
                {hint && (
                    <p className="text-xs text-muted-foreground mt-0.5 flex items-start gap-1">
                        <Info className="h-3 w-3 mt-0.5 shrink-0" aria-hidden="true" />
                        {hint}
                    </p>
                )}
            </div>
            {children}
        </div>
    );
}

function JsonEditor({
    id,
    value,
    onChange,
    placeholder,
    error,
    disabled,
    rows = 3,
}: {
    id: string;
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    error?: string;
    disabled?: boolean;
    rows?: number;
}) {
    return (
        <div>
            <textarea
                id={id}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                rows={rows}
                disabled={disabled}
                className={`w-full px-3 py-2 rounded-lg border bg-background text-foreground font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-y ${
                    error ? "border-danger" : "border-border"
                }`}
            />
            {error && <p className="text-xs text-danger mt-1">{error}</p>}
        </div>
    );
}

function AiAutoFillSection({
    sensorName,
    onSensorNameChange,
    onGenerate,
    loading,
    error,
    result,
}: {
    sensorName: string;
    onSensorNameChange: (v: string) => void;
    onGenerate: () => void;
    loading: boolean;
    error: string | null;
    result: GenerateTemplateResponse | null;
}) {
    function handleKeyDown(e: React.KeyboardEvent) {
        if (e.key === "Enter") {
            e.preventDefault();
            onGenerate();
        }
    }

    return (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
            <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
                <h3 className="text-sm font-semibold text-foreground">AI Auto-fill</h3>
                <span className="text-xs text-muted-foreground">Enter sensor name to auto-generate fields</span>
            </div>

            <div className="flex gap-2">
                <input
                    type="text"
                    value={sensorName}
                    onChange={(e) => onSensorNameChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder='e.g. "Shelly Pro 3EM" or "Dragino LHT65"'
                    disabled={loading}
                    aria-label="Sensor name for AI generation"
                    className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-foreground text-base focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                />
                <Button
                    type="button"
                    variant="primary"
                    size="md"
                    onClick={onGenerate}
                    loading={loading}
                    disabled={!sensorName.trim() || loading}
                >
                    {loading ? "Generating..." : "Generate"}
                </Button>
            </div>

            {loading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <svg className="animate-spin h-4 w-4 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Searching documentation and generating template fields... This may take 15–30 seconds.
                </div>
            )}

            {error && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-danger/10 border border-danger/20 text-sm text-danger" role="alert">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
                    {error}
                </div>
            )}

            {result && result.payload && (
                <div className="space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={result.confidence >= 0.8 ? "success" : result.confidence >= 0.5 ? "warning" : "danger"} size="sm">
                            {Math.round(result.confidence * 100)}% confidence
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                            Fields populated from AI — review and edit before saving
                        </span>
                    </div>
                    {result.sources.length > 0 && (
                        <details className="text-xs">
                            <summary className="text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
                                {result.sources.length} source{result.sources.length !== 1 ? "s" : ""} used
                            </summary>
                            <ul className="mt-1 space-y-0.5 pl-4">
                                {result.sources.map((url, i) => (
                                    <li key={i}>
                                        <a
                                            href={url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-primary hover:underline inline-flex items-center gap-1"
                                        >
                                            {new URL(url).hostname}
                                            <ExternalLink className="h-3 w-3" aria-hidden="true" />
                                        </a>
                                    </li>
                                ))}
                            </ul>
                        </details>
                    )}
                </div>
            )}
        </div>
    );
}

function formatJson(json?: string): string {
    if (!json || json === "{}") return "";
    try {
        return JSON.stringify(JSON.parse(json), null, 2);
    } catch {
        return json;
    }
}
