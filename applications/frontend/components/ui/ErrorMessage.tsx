/**
 * Error Message Component
 * Display errors with retry functionality
 */

import { AlertCircle } from "lucide-react";
import { Button } from "./Button";
import { Card } from "./Card";

interface ErrorMessageProps {
    title?: string;
    message: string;
    onRetry?: () => void;
}

export function ErrorMessage({
    title = "Error",
    message,
    onRetry,
}: ErrorMessageProps) {
    return (
        <Card variant="bordered" className="border-danger/50 bg-danger/5">
            <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-danger flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                    <h3 className="font-semibold text-danger mb-1">{title}</h3>
                    <p className="text-sm text-muted-foreground">{message}</p>
                    {onRetry && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={onRetry}
                            className="mt-3"
                        >
                            Try Again
                        </Button>
                    )}
                </div>
            </div>
        </Card>
    );
}
