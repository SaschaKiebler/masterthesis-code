"use client";

import { Modal, ModalHeader, ModalContent } from "@/components/ui/Modal";
import { FolderOpen, Building2, Calendar } from "lucide-react";
import type { ProjectDTO } from "@/lib/api/types";

interface ProjectPickerModalProps {
    open: boolean;
    onClose: () => void;
    title: string;
    projects: ProjectDTO[];
    onSelect: (projectId: string) => void;
}

export function ProjectPickerModal({
    open,
    onClose,
    title,
    projects,
    onSelect,
}: ProjectPickerModalProps) {
    return (
        <Modal open={open} onClose={onClose}>
            <ModalHeader onClose={onClose}>{title}</ModalHeader>
            <ModalContent>
                {projects.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">
                        No projects yet. Create a project first.
                    </p>
                ) : (
                    <div className="space-y-2">
                        <p className="text-sm text-muted-foreground mb-3">
                            Which project?
                        </p>
                        {projects.map((project) => (
                            <button
                                key={project.id}
                                onClick={() => {
                                    onSelect(project.id);
                                    onClose();
                                }}
                                className="flex items-center gap-3 w-full p-3 rounded-lg border border-border hover:border-primary/40 hover:bg-muted/50 transition-colors text-left"
                            >
                                <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                                    <FolderOpen className="h-4 w-4 text-primary" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-foreground truncate">
                                        {project.name}
                                    </p>
                                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                                        <span className="flex items-center gap-1">
                                            <Building2 className="h-3 w-3" />
                                            {project.siteCount} site{project.siteCount !== 1 ? "s" : ""}
                                        </span>
                                        <span className="flex items-center gap-1">
                                            <Calendar className="h-3 w-3" />
                                            {new Date(project.updatedAt).toLocaleDateString()}
                                        </span>
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </ModalContent>
        </Modal>
    );
}
