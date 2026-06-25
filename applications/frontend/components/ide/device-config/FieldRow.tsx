interface FieldRowProps {
    label: string;
    required?: boolean;
    children: React.ReactNode;
}

export function FieldRow({
    label,
    required,
    children,
}: FieldRowProps) {
    return (
        <div className="flex items-center gap-2 py-1">
            <span className="text-xs text-muted-foreground w-16 shrink-0">
                {label}
                {required && <span className="text-danger ml-0.5">*</span>}
            </span>
            {children}
        </div>
    );
}
