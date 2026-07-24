"use client";

/**
 * Meldungen page — persisted notifications from the notification service
 * plus the tenant's notification rules (policy, separate from threshold
 * rules which live in commissioning).
 */

import { useState } from "react";
import useSWR from "swr";
import { Bell, Check, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
    acknowledgeNotification,
    createRule,
    deleteRule,
    listNotifications,
    listRules,
    updateRule,
    type Meldung,
    type NotificationRule,
    type NotificationSeverity,
} from "@/lib/api/notifications";
import { AnomalyRuleShortcut } from "@/components/notifications/AnomalyRuleShortcut";

const SEVERITY_STYLE: Record<NotificationSeverity, string> = {
    CRITICAL: "text-red-600 bg-red-50 border-red-200",
    ERROR: "text-red-500 bg-red-50 border-red-100",
    WARNING: "text-amber-600 bg-amber-50 border-amber-200",
    INFO: "text-blue-600 bg-blue-50 border-blue-200",
};

const SEVERITIES: NotificationSeverity[] = ["INFO", "WARNING", "ERROR", "CRITICAL"];
const EVENT_TYPES = ["threshold.breached", "anomaly.detected"];

function relativeTime(iso: string): string {
    const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return new Date(iso).toLocaleString();
}

function SeverityBadge({ severity }: { severity: NotificationSeverity }) {
    return (
        <span
            className={cn(
                "inline-block rounded border px-2 py-0.5 text-xs font-semibold",
                SEVERITY_STYLE[severity] ?? SEVERITY_STYLE.INFO
            )}
        >
            {severity}
        </span>
    );
}

function MeldungenTable() {
    const [showAcknowledged, setShowAcknowledged] = useState(false);
    const { data, error, isLoading, mutate } = useSWR<Meldung[]>(
        `/notifications?acknowledged=${showAcknowledged}`,
        () => listNotifications(showAcknowledged ? {} : { acknowledged: false }),
        { revalidateOnFocus: false, refreshInterval: 30000 }
    );

    const acknowledge = async (id: string) => {
        await acknowledgeNotification(id);
        mutate();
    };

    return (
        <section className="rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h2 className="flex items-center gap-2 font-semibold">
                    <Bell className="h-4 w-4" aria-hidden="true" />
                    Meldungen
                </h2>
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <input
                        type="checkbox"
                        checked={showAcknowledged}
                        onChange={(e) => setShowAcknowledged(e.target.checked)}
                    />
                    Quittierte anzeigen
                </label>
            </div>
            {isLoading && <p className="p-4 text-sm text-muted-foreground">Lade Meldungen…</p>}
            {error && (
                <p className="p-4 text-sm text-red-500">
                    Meldungen konnten nicht geladen werden.
                </p>
            )}
            {data && data.length === 0 && (
                <p className="p-4 text-sm text-muted-foreground">Keine Meldungen.</p>
            )}
            {data && data.length > 0 && (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-border text-left text-muted-foreground">
                                <th className="px-4 py-2 font-medium">Severity</th>
                                <th className="px-4 py-2 font-medium">Meldung</th>
                                <th className="px-4 py-2 font-medium">Gerät</th>
                                <th className="px-4 py-2 font-medium">Zeit</th>
                                <th className="px-4 py-2 font-medium" />
                            </tr>
                        </thead>
                        <tbody>
                            {data.map((meldung) => (
                                <tr key={meldung.id} className="border-b border-border/50">
                                    <td className="px-4 py-2">
                                        <SeverityBadge severity={meldung.severity} />
                                    </td>
                                    <td className="px-4 py-2">
                                        <p>{meldung.summary}</p>
                                        <p className="text-xs text-muted-foreground">{meldung.type}</p>
                                    </td>
                                    <td className="px-4 py-2 font-mono text-xs">
                                        {meldung.deviceId} / {meldung.metricId}
                                    </td>
                                    <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">
                                        {relativeTime(meldung.detectedAt)}
                                    </td>
                                    <td className="px-4 py-2 text-right">
                                        {meldung.acknowledgedAt ? (
                                            <span className="text-xs text-muted-foreground">
                                                quittiert
                                            </span>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={() => acknowledge(meldung.id)}
                                                className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-muted"
                                            >
                                                <Check className="h-3 w-3" aria-hidden="true" />
                                                Quittieren
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}

function RuleForm({ onCreated }: { onCreated: () => void }) {
    const [name, setName] = useState("");
    const [minSeverity, setMinSeverity] = useState<NotificationSeverity>("INFO");
    const [eventTypes, setEventTypes] = useState<string[]>(EVENT_TYPES);
    const [cooldown, setCooldown] = useState(15);
    const [webhookUrl, setWebhookUrl] = useState("");
    const [saving, setSaving] = useState(false);

    const toggleEventType = (type: string) => {
        setEventTypes((current) =>
            current.includes(type) ? current.filter((t) => t !== type) : [...current, type]
        );
    };

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim() || eventTypes.length === 0) return;
        setSaving(true);
        try {
            await createRule({
                name: name.trim(),
                eventTypes,
                minSeverity,
                cooldownMinutes: cooldown,
                webhookUrl: webhookUrl.trim() || undefined,
            });
            setName("");
            setWebhookUrl("");
            onCreated();
        } finally {
            setSaving(false);
        }
    };

    return (
        <form onSubmit={submit} className="grid gap-3 border-t border-border p-4 sm:grid-cols-2">
            <label className="text-sm">
                Name
                <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    className="mt-1 w-full rounded border border-border bg-background px-2 py-1"
                    placeholder="z. B. Kritische Störungen"
                />
            </label>
            <label className="text-sm">
                Min. Severity
                <select
                    value={minSeverity}
                    onChange={(e) => setMinSeverity(e.target.value as NotificationSeverity)}
                    className="mt-1 w-full rounded border border-border bg-background px-2 py-1"
                >
                    {SEVERITIES.map((s) => (
                        <option key={s}>{s}</option>
                    ))}
                </select>
            </label>
            <fieldset className="text-sm">
                <legend>Event-Typen</legend>
                <div className="mt-1 flex gap-4">
                    {EVENT_TYPES.map((type) => (
                        <label key={type} className="flex items-center gap-1">
                            <input
                                type="checkbox"
                                checked={eventTypes.includes(type)}
                                onChange={() => toggleEventType(type)}
                            />
                            {type}
                        </label>
                    ))}
                </div>
            </fieldset>
            <label className="text-sm">
                Cooldown (Minuten)
                <input
                    type="number"
                    min={0}
                    max={1440}
                    value={cooldown}
                    onChange={(e) => setCooldown(Number(e.target.value))}
                    className="mt-1 w-full rounded border border-border bg-background px-2 py-1"
                />
            </label>
            <label className="text-sm sm:col-span-2">
                Webhook-URL (optional)
                <input
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    className="mt-1 w-full rounded border border-border bg-background px-2 py-1"
                    placeholder="https://…"
                />
            </label>
            <div className="sm:col-span-2">
                <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
                >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Regel anlegen
                </button>
            </div>
        </form>
    );
}

function RulesSection() {
    const { data, error, isLoading, mutate } = useSWR<NotificationRule[]>(
        "/notification-rules",
        listRules,
        { revalidateOnFocus: false }
    );

    const toggleRule = async (rule: NotificationRule) => {
        await updateRule(rule.id, { enabled: !rule.enabled });
        mutate();
    };

    const removeRule = async (rule: NotificationRule) => {
        await deleteRule(rule.id);
        mutate();
    };

    return (
        <section className="rounded-lg border border-border bg-card">
            <div className="border-b border-border px-4 py-3">
                <h2 className="font-semibold">Benachrichtigungsregeln</h2>
                <p className="text-xs text-muted-foreground">
                    Ohne eigene Regeln gilt die Standard-Policy des Systems.
                </p>
            </div>
            {isLoading && <p className="p-4 text-sm text-muted-foreground">Lade Regeln…</p>}
            {error && (
                <p className="p-4 text-sm text-red-500">Regeln konnten nicht geladen werden.</p>
            )}
            {data && data.length > 0 && (
                <ul className="divide-y divide-border/50">
                    {data.map((rule) => (
                        <li key={rule.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                            <label className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    checked={rule.enabled}
                                    onChange={() => toggleRule(rule)}
                                    title={rule.enabled ? "Deaktivieren" : "Aktivieren"}
                                />
                            </label>
                            <div className="min-w-0 flex-1">
                                <p className={cn("truncate", !rule.enabled && "text-muted-foreground line-through")}>
                                    {rule.name}
                                </p>
                                <p className="truncate text-xs text-muted-foreground">
                                    {rule.eventTypes.join(", ")} · ab {rule.minSeverity} · Cooldown{" "}
                                    {rule.cooldownMinutes} min
                                    {rule.webhookUrl ? " · Webhook" : ""}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => removeRule(rule)}
                                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-red-500"
                                aria-label={`Regel ${rule.name} löschen`}
                            >
                                <Trash2 className="h-4 w-4" aria-hidden="true" />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            {data && data.length === 0 && (
                <p className="px-4 pt-4 text-sm text-muted-foreground">
                    Noch keine Regeln, es gilt die Standard-Policy.
                </p>
            )}
            <RuleForm onCreated={() => mutate()} />
        </section>
    );
}

export default function NotificationsPage() {
    return (
        <div className="space-y-6 p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold">Meldungen</h1>
                    <p className="text-sm text-muted-foreground">
                        Stör- und Alarmmeldungen der Plattform sowie die Benachrichtigungsregeln
                        des Mandanten.
                    </p>
                </div>
                <AnomalyRuleShortcut />
            </div>
            <MeldungenTable />
            <RulesSection />
        </div>
    );
}
