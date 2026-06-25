"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Check, Copy, Mail } from "lucide-react";

interface InvitationLinkModalProps {
  token: string;
  email: string;
  onClose: () => void;
}

export function InvitationLinkModal({ token, email, onClose }: InvitationLinkModalProps) {
  const [copied, setCopied] = useState(false);
  const inviteLink = `${window.location.origin}/invite/accept?token=${token}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Invitation Created"
    >
      <div
        className="fixed inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative w-full sm:max-w-md bg-card rounded-t-xl sm:rounded-xl p-6 shadow-xl z-10">
        <div className="flex flex-col items-center text-center">
          <div className="h-12 w-12 rounded-full bg-success/10 flex items-center justify-center mb-4">
            <Mail className="h-6 w-6 text-success" aria-hidden="true" />
          </div>

          <h2 className="text-xl font-semibold text-foreground mb-1">
            Invitation Created
          </h2>
          <p className="text-sm text-muted-foreground mb-4">
            An invitation has been created for <span className="font-medium text-foreground">{email}</span>
          </p>

          <div className="w-full mb-4">
            <label className="block text-sm font-medium text-foreground mb-1 text-left">
              Invitation Link
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={inviteLink}
                className="flex-1 px-3 py-2 rounded-lg border border-border bg-muted text-foreground text-sm font-mono truncate focus:outline-none"
              />
              <button
                onClick={handleCopy}
                className="px-3 py-2 rounded-lg border border-border bg-background hover:bg-muted text-foreground transition-colors shrink-0"
                aria-label="Copy invitation link"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-success" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          <Button variant="primary" onClick={onClose} className="w-full">
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
