"use client";

/**
 * Project hooks — ADR-012
 * SWR-based hooks for project CRUD and project-scoped graph data.
 */

import { useState, useEffect, useCallback } from "react";
import {
    listProjects,
    getProject,
    getProjectGraph,
    createProject,
    updateProject,
    deleteProject,
    addSiteToProject,
    removeSiteFromProject,
} from "@/lib/api/projects";
import { createLink, deleteLink, createObject, deleteObject, updateObject } from "@/lib/api/graph";
import type {
    ProjectDTO,
    ProjectDetailDTO,
    GraphObject,
    GraphLink,
    CreateProjectRequest,
    CreateLinkRequest,
    CreateObjectRequest,
} from "@/lib/api/types";

// ─── useProjects ──────────────────────────────────────────────────────────────

interface UseProjectsResult {
    projects: ProjectDTO[];
    loading: boolean;
    error: string | null;
    refresh: () => void;
    create: (data: CreateProjectRequest) => Promise<ProjectDTO>;
    remove: (projectId: string) => Promise<void>;
}

export function useProjects(): UseProjectsResult {
    const [projects, setProjects] = useState<ProjectDTO[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetch = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await listProjects();
            setProjects(res.projects);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load projects");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetch(); }, [fetch]);

    const create = useCallback(async (data: CreateProjectRequest): Promise<ProjectDTO> => {
        const res = await createProject(data);
        await fetch();
        return res.project;
    }, [fetch]);

    const remove = useCallback(async (projectId: string) => {
        await deleteProject(projectId);
        await fetch();
    }, [fetch]);

    return { projects, loading, error, refresh: fetch, create, remove };
}

// ─── useProject ───────────────────────────────────────────────────────────────

interface UseProjectResult {
    project: ProjectDetailDTO | null;
    loading: boolean;
    error: string | null;
    refresh: () => void;
    update: (data: { name?: string; description?: string; status?: string }) => Promise<void>;
    addSite: (siteId: string) => Promise<void>;
    removeSite: (siteId: string) => Promise<void>;
}

export function useProject(projectId: string | null): UseProjectResult {
    const [project, setProject] = useState<ProjectDetailDTO | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetch = useCallback(async () => {
        if (!projectId) return;
        setLoading(true);
        setError(null);
        try {
            const res = await getProject(projectId);
            setProject(res.project);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load project");
        } finally {
            setLoading(false);
        }
    }, [projectId]);

    useEffect(() => { fetch(); }, [fetch]);

    const update = useCallback(async (data: { name?: string; description?: string; status?: string }) => {
        if (!projectId) return;
        await updateProject(projectId, data);
        await fetch();
    }, [projectId, fetch]);

    const addSite = useCallback(async (siteId: string) => {
        if (!projectId) return;
        await addSiteToProject(projectId, siteId);
        await fetch();
    }, [projectId, fetch]);

    const removeSite = useCallback(async (siteId: string) => {
        if (!projectId) return;
        await removeSiteFromProject(projectId, siteId);
        await fetch();
    }, [projectId, fetch]);

    return { project, loading, error, refresh: fetch, update, addSite, removeSite };
}

// ─── useProjectGraph ──────────────────────────────────────────────────────────

interface UseProjectGraphResult {
    objects: GraphObject[];
    links: GraphLink[];
    loading: boolean;
    error: string | null;
    addLink: (data: CreateLinkRequest) => Promise<void>;
    removeLink: (linkId: string) => Promise<void>;
    addObject: (data: CreateObjectRequest) => Promise<GraphObject>;
    batchCreateObjects: (items: CreateObjectRequest[]) => Promise<GraphObject[]>;
    batchCreateLinks: (items: CreateLinkRequest[]) => Promise<void>;
    removeObject: (objectId: string) => Promise<void>;
    updateObjectName: (objectId: string, displayName: string) => Promise<void>;
    refresh: () => void;
}

export function useProjectGraph(projectId: string | null): UseProjectGraphResult {
    const [objects, setObjects] = useState<GraphObject[]>([]);
    const [links, setLinks] = useState<GraphLink[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetch = useCallback(async () => {
        if (!projectId) return;
        setLoading(true);
        setError(null);
        try {
            const res = await getProjectGraph(projectId);
            setObjects(res.objects);
            setLinks(res.links);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load project graph");
        } finally {
            setLoading(false);
        }
    }, [projectId]);

    useEffect(() => { fetch(); }, [fetch]);

    const addLink = useCallback(async (data: CreateLinkRequest) => {
        await createLink(data);
        await fetch();
    }, [fetch]);

    const removeLink = useCallback(async (linkId: string) => {
        await deleteLink(linkId);
        await fetch();
    }, [fetch]);

    const addObject = useCallback(async (data: CreateObjectRequest): Promise<GraphObject> => {
        const res = await createObject(data);
        // The POST returns the fully-formed object (same shape as the graph refetch),
        // so append it locally instead of refetching the whole project graph.
        setObjects((prev) => (prev.some((o) => o.id === res.object.id) ? prev : [...prev, res.object]));
        return res.object;
    }, []);

    const batchCreateObjects = useCallback(async (items: CreateObjectRequest[]): Promise<GraphObject[]> => {
        const results: GraphObject[] = [];
        for (const item of items) {
            const res = await createObject(item);
            results.push(res.object);
        }
        return results;
    }, []);

    const batchCreateLinks = useCallback(async (items: CreateLinkRequest[]): Promise<void> => {
        for (const item of items) {
            await createLink(item);
        }
    }, []);

    const removeObject = useCallback(async (objectId: string) => {
        await deleteObject(objectId);
        await fetch();
    }, [fetch]);

    const updateObjectName = useCallback(async (objectId: string, displayName: string) => {
        await updateObject(objectId, displayName);
        await fetch();
    }, [fetch]);

    return { objects, links, loading, error, addLink, removeLink, addObject, batchCreateObjects, batchCreateLinks, removeObject, updateObjectName, refresh: fetch };
}
