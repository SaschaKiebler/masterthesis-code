"use client";

/**
 * Graph hooks — ADR-011 Phase C
 */

import { useState, useEffect, useCallback } from "react";
import { getSiteObjects, getSiteGraph, getObjectLinks, createLink, deleteLink, getLinkTypes, createLinkType, getObjectTypes } from "@/lib/api/graph";
import type {
    GraphObject,
    GraphLink,
    ObjectLinksResponse,
    CreateLinkRequest,
    ApiLinkType,
    CreateLinkTypeRequest,
    SiteGraphResponse,
    ObjectType,
} from "@/lib/api/types";

// ─── useSiteObjects ───────────────────────────────────────────────────────────

interface UseSiteObjectsResult {
    objects: GraphObject[];
    loading: boolean;
    error: string | null;
    refresh: () => void;
}

export function useSiteObjects(siteId: string | null): UseSiteObjectsResult {
    const [objects, setObjects] = useState<GraphObject[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetch = useCallback(async () => {
        if (!siteId) return;
        setLoading(true);
        setError(null);
        try {
            const res = await getSiteObjects(siteId);
            setObjects(res.objects);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load site objects");
        } finally {
            setLoading(false);
        }
    }, [siteId]);

    useEffect(() => { fetch(); }, [fetch]);

    return { objects, loading, error, refresh: fetch };
}

// ─── useObjectLinks ───────────────────────────────────────────────────────────

interface UseObjectLinksResult {
    outbound: GraphLink[];
    inbound: GraphLink[];
    loading: boolean;
    error: string | null;
    addLink: (data: CreateLinkRequest) => Promise<void>;
    removeLink: (linkId: string) => Promise<void>;
    refresh: () => void;
}

export function useObjectLinks(objectId: string | null): UseObjectLinksResult {
    const [outbound, setOutbound] = useState<GraphLink[]>([]);
    const [inbound, setInbound] = useState<GraphLink[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetch = useCallback(async () => {
        if (!objectId) return;
        setLoading(true);
        setError(null);
        try {
            const res = await getObjectLinks(objectId);
            setOutbound(res.outbound);
            setInbound(res.inbound);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load links");
        } finally {
            setLoading(false);
        }
    }, [objectId]);

    useEffect(() => { fetch(); }, [fetch]);

    const addLink = useCallback(async (data: CreateLinkRequest) => {
        await createLink(data);
        await fetch();
    }, [fetch]);

    const removeLink = useCallback(async (linkId: string) => {
        await deleteLink(linkId);
        await fetch();
    }, [fetch]);

    return { outbound, inbound, loading, error, addLink, removeLink, refresh: fetch };
}

// ─── useSiteGraph ─────────────────────────────────────────────────────────────

interface UseSiteGraphResult {
    objects: GraphObject[];
    links: GraphLink[];
    loading: boolean;
    error: string | null;
    addLink: (data: CreateLinkRequest) => Promise<void>;
    removeLink: (linkId: string) => Promise<void>;
    refresh: () => void;
}

export function useSiteGraph(siteId: string | null): UseSiteGraphResult {
    const [objects, setObjects] = useState<GraphObject[]>([]);
    const [links, setLinks] = useState<GraphLink[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetch = useCallback(async () => {
        if (!siteId) return;
        setLoading(true);
        setError(null);
        try {
            const res = await getSiteGraph(siteId);
            setObjects(res.objects);
            setLinks(res.links);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load site graph");
        } finally {
            setLoading(false);
        }
    }, [siteId]);

    useEffect(() => { fetch(); }, [fetch]);

    const addLink = useCallback(async (data: CreateLinkRequest) => {
        await createLink(data);
        await fetch();
    }, [fetch]);

    const removeLink = useCallback(async (linkId: string) => {
        await deleteLink(linkId);
        await fetch();
    }, [fetch]);

    return { objects, links, loading, error, addLink, removeLink, refresh: fetch };
}

// ─── useLinkTypes ─────────────────────────────────────────────────────────────

interface UseLinkTypesResult {
    linkTypes: ApiLinkType[];
    loading: boolean;
    error: string | null;
    addLinkType: (data: CreateLinkTypeRequest) => Promise<ApiLinkType>;
    refresh: () => void;
}

export function useLinkTypes(): UseLinkTypesResult {
    const [linkTypes, setLinkTypes] = useState<ApiLinkType[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetch = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await getLinkTypes();
            setLinkTypes(res.linkTypes);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load link types");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetch(); }, [fetch]);

    const addLinkType = useCallback(async (data: CreateLinkTypeRequest): Promise<ApiLinkType> => {
        const res = await createLinkType(data);
        setLinkTypes((prev) => [...prev, res.linkType].sort((a, b) => a.name.localeCompare(b.name)));
        return res.linkType;
    }, []);

    return { linkTypes, loading, error, addLinkType, refresh: fetch };
}

// ─── useObjectTypes ───────────────────────────────────────────────────────────

interface UseObjectTypesResult {
    objectTypes: ObjectType[];
    loading: boolean;
    error: string | null;
    refresh: () => void;
}

export function useObjectTypes(): UseObjectTypesResult {
    const [objectTypes, setObjectTypes] = useState<ObjectType[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetch = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await getObjectTypes();
            setObjectTypes(res.objectTypes);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load object types");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetch(); }, [fetch]);

    return { objectTypes, loading, error, refresh: fetch };
}
