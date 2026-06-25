import { Badge } from "@/components/ui/Badge";

export function getGreeting(): string {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
}

export function formatDate(): string {
    return new Date().toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
    });
}

export function getStatusBadge(status: string) {
    switch (status) {
        case "active":
            return <Badge variant="success" size="sm">Active</Badge>;
        case "draft":
            return <Badge variant="secondary" size="sm">Draft</Badge>;
        case "completed":
            return <Badge variant="default" size="sm">Completed</Badge>;
        case "archived":
            return <Badge variant="default" size="sm">Archived</Badge>;
        default:
            return <Badge variant="secondary" size="sm">{status}</Badge>;
    }
}
