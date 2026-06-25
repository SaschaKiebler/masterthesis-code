"use client";

/**
 * IdeLayout — resizable three-panel shell for the project builder.
 * Left: Object Tree | Center: Visual Canvas | Right: Detail Panel
 * All panels are resizable via drag handles. Left/right panels are collapsible.
 */

import { Group, Panel, Separator } from "react-resizable-panels";

interface IdeLayoutProps {
    left: React.ReactNode;
    center: React.ReactNode;
    right: React.ReactNode;
    statusBar?: React.ReactNode;
}

export function IdeLayout({ left, center, right, statusBar }: IdeLayoutProps) {
    return (
        <div className="flex flex-col h-screen bg-background overflow-hidden">
            <Group orientation="horizontal" className="flex-1 min-h-0">
                {/* Left panel — Object Tree */}
                <Panel
                    defaultSize="18%"
                    minSize="12%"
                    maxSize="30%"
                    collapsible
                    collapsedSize="0%"
                    className="bg-card border-r border-border"
                >
                    {left}
                </Panel>

                <Separator className="w-px bg-border hover:bg-primary/40 active:bg-primary transition-colors" />

                {/* Center panel — Visual Canvas */}
                <Panel defaultSize="56%" minSize="30%" className="bg-background">
                    {center}
                </Panel>

                <Separator className="w-px bg-border hover:bg-primary/40 active:bg-primary transition-colors" />

                {/* Right panel — Detail Panel */}
                <Panel
                    defaultSize="26%"
                    minSize="16%"
                    maxSize="40%"
                    collapsible
                    collapsedSize="0%"
                    className="bg-card border-l border-border"
                >
                    {right}
                </Panel>
            </Group>

            {/* Status Bar */}
            {statusBar && (
                <div className="h-7 border-t border-border bg-card px-4 flex items-center text-xs text-muted-foreground shrink-0">
                    {statusBar}
                </div>
            )}
        </div>
    );
}
