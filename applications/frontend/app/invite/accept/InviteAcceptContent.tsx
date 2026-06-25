/**
 * InviteAcceptContent — Client component for invitation acceptance flow.
 *
 * Guidelines compliance:
 * - Skeleton loading screens (not spinners)
 * - aria-live region for dynamic state announcements
 * - Retry mechanism on error state
 * - Primary action buttons use size="lg" (48px+ touch targets)
 * - Accessible link (native <a> styled as button, no nested interactive elements)
 * - aria-busy on processing states
 * - 16px minimum text for mobile readability
 */

"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useUser } from "@auth0/nextjs-auth0/client";
import { useAuth } from "@/lib/auth/AuthContext";
import { apiFetch } from "@/lib/api/client";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  Mail,
  CheckCircle,
  XCircle,
  Clock,
  LogIn,
  Building2,
  Shield,
  RotateCcw,
  ArrowRight,
} from "lucide-react";

interface InvitationDetails {
  email: string;
  tenantRole: string;
  globalRole: string;
  expired: boolean;
  accepted: boolean;
  expiresAt: string;
  tenantId?: string;
  tenantName?: string;
}

type PageState = "loading" | "details" | "accepting" | "accepted" | "error";

export default function InviteAcceptContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token");

  const { user: auth0User, isLoading: auth0Loading } = useUser();
  const { refresh } = useAuth();

  const [invitation, setInvitation] = useState<InvitationDetails | null>(null);
  const [pageState, setPageState] = useState<PageState>("loading");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [canRetry, setCanRetry] = useState(false);

  const fetchInvitation = useCallback(async () => {
    if (!token) {
      setPageState("error");
      setErrorMessage("No invitation token provided.");
      setCanRetry(false);
      return;
    }

    setPageState("loading");
    try {
      const data = await apiFetch<{ invitation: InvitationDetails }>(
        `/invitations/by-token/${token}`
      );
      setInvitation(data.invitation);

      if (data.invitation.accepted) {
        setPageState("accepted");
      } else if (data.invitation.expired) {
        setPageState("error");
        setErrorMessage(
          "This invitation has expired. Please ask your administrator to send a new one."
        );
        setCanRetry(false);
      } else {
        setPageState("details");
      }
    } catch (err: unknown) {
      const apiErr = err as { status?: number; message?: string };
      setPageState("error");
      setCanRetry(true);
      setErrorMessage(
        apiErr?.status === 404
          ? "Invitation not found. It may have been revoked."
          : "Failed to load invitation details."
      );
    }
  }, [token]);

  // Fetch invitation details on mount
  useEffect(() => {
    fetchInvitation();
  }, [fetchInvitation]);

  const handleAccept = async () => {
    if (!token) return;
    setPageState("accepting");
    try {
      await apiFetch(`/invitations/by-token/${token}/accept`, {
        method: "POST",
      });
      setPageState("accepted");
      // Refresh auth context so sidebar/permissions update
      refresh();
      // Redirect to dashboard after short delay
      setTimeout(() => router.push("/"), 2000);
    } catch (err: unknown) {
      const apiErr = err as { message?: string };
      setPageState("error");
      setCanRetry(true);
      setErrorMessage(apiErr?.message || "Failed to accept invitation.");
    }
  };

  const loginUrl = `/auth/login?returnTo=${encodeURIComponent(`/invite/accept?token=${token}`)}`;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        {/* Live region for screen reader state announcements */}
        <div role="status" aria-live="polite" className="sr-only">
          {pageState === "loading" && "Loading invitation details."}
          {pageState === "accepting" && "Accepting invitation, please wait."}
          {pageState === "accepted" && "Invitation accepted. Redirecting to dashboard."}
          {pageState === "error" && errorMessage}
        </div>

        {/* Loading State — Skeleton screen (guidelines: skeletons, not spinners) */}
        {pageState === "loading" && (
          <Card variant="bordered" padding="lg">
            <CardContent className="space-y-6">
              <div className="flex flex-col items-center gap-3">
                <Skeleton variant="circle" className="h-14 w-14" />
                <Skeleton variant="text" className="h-7 w-48" />
                <Skeleton variant="text" className="h-4 w-64" />
              </div>
              <div className="rounded-lg bg-muted/50 p-4 space-y-3">
                <Skeleton variant="text" className="h-5 w-full" />
                <Skeleton variant="text" className="h-5 w-3/4" />
                <Skeleton variant="text" className="h-5 w-1/2" />
              </div>
              <Skeleton variant="custom" className="h-12 w-full rounded-lg" />
            </CardContent>
          </Card>
        )}

        {/* Invitation Details */}
        {pageState === "details" && invitation && (
          <Card variant="bordered" padding="lg">
            <CardContent className="space-y-6">
              <div className="text-center space-y-2">
                <div className="mx-auto w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                  <Mail className="h-7 w-7 text-primary" aria-hidden="true" />
                </div>
                <h1 className="text-2xl font-bold text-foreground">
                  You&apos;re Invited
                </h1>
                <p className="text-base text-muted-foreground">
                  You&apos;ve been invited to join Kiebler Heizungsoptimierung
                </p>
              </div>

              {/* Invitation Info */}
              <div
                className="bg-muted/50 rounded-lg p-4 space-y-3"
                aria-label="Invitation details"
                role="group"
              >
                <div className="flex items-center gap-3">
                  <Mail className="h-5 w-5 text-muted-foreground shrink-0" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-sm text-muted-foreground">Invited as</p>
                    <p className="text-base font-medium text-foreground truncate">
                      {invitation.email}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Shield className="h-5 w-5 text-muted-foreground shrink-0" aria-hidden="true" />
                  <div>
                    <p className="text-sm text-muted-foreground">Role</p>
                    <Badge variant="primary" size="sm">
                      {invitation.globalRole.replace("_", " ")}
                    </Badge>
                  </div>
                </div>

                {invitation.tenantName && (
                  <div className="flex items-center gap-3">
                    <Building2 className="h-5 w-5 text-muted-foreground shrink-0" aria-hidden="true" />
                    <div>
                      <p className="text-sm text-muted-foreground">Tenant</p>
                      <p className="text-base font-medium text-foreground">
                        {invitation.tenantName}
                        <span className="text-sm text-muted-foreground ml-1.5">
                          ({invitation.tenantRole})
                        </span>
                      </p>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <Clock className="h-5 w-5 text-muted-foreground shrink-0" aria-hidden="true" />
                  <div>
                    <p className="text-sm text-muted-foreground">Expires</p>
                    <p className="text-base text-foreground">
                      {new Date(invitation.expiresAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              </div>

              {/* Action — touch target minimum 48px (guidelines: 44px min, 56px primary) */}
              {auth0Loading ? (
                <div className="space-y-2">
                  <Skeleton variant="custom" className="h-12 w-full rounded-lg" />
                  <p className="text-sm text-center text-muted-foreground">
                    Checking authentication...
                  </p>
                </div>
              ) : auth0User ? (
                <Button
                  variant="primary"
                  fullWidth
                  size="lg"
                  onClick={handleAccept}
                  aria-label="Accept this invitation"
                >
                  <CheckCircle className="h-5 w-5 mr-2" aria-hidden="true" />
                  Accept Invitation
                </Button>
              ) : (
                <div className="space-y-3">
                  <p className="text-base text-center text-muted-foreground">
                    Sign in to accept this invitation
                  </p>
                  {/* Native <a> — no nested interactive elements (a11y) */}
                  <a
                    href={loginUrl}
                    className="inline-flex items-center justify-center font-medium rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary bg-primary text-primary-foreground hover:opacity-90 px-6 py-3 text-lg w-full"
                    aria-label="Sign in to accept invitation"
                  >
                    <LogIn className="h-5 w-5 mr-2" aria-hidden="true" />
                    Sign In to Accept
                  </a>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Accepting State — skeleton feedback (guidelines: indicate progress) */}
        {pageState === "accepting" && (
          <Card variant="bordered" padding="lg">
            <CardContent className="text-center space-y-4" aria-busy="true">
              <div className="flex flex-col items-center gap-3">
                <Skeleton variant="circle" className="h-14 w-14" />
                <p className="text-base font-medium text-foreground">
                  Accepting invitation...
                </p>
                <Skeleton variant="text" className="h-4 w-48" />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Accepted State */}
        {pageState === "accepted" && (
          <Card variant="bordered" padding="lg">
            <CardContent className="text-center space-y-4">
              <div className="mx-auto w-14 h-14 rounded-full bg-success/10 flex items-center justify-center">
                <CheckCircle className="h-7 w-7 text-success" aria-hidden="true" />
              </div>
              <div className="space-y-2">
                <h1 className="text-2xl font-bold text-foreground">
                  Welcome!
                </h1>
                <p className="text-base text-muted-foreground">
                  Invitation accepted. Redirecting to your dashboard...
                </p>
              </div>
              <Button
                variant="primary"
                size="lg"
                fullWidth
                onClick={() => router.push("/")}
                aria-label="Go to dashboard"
              >
                <ArrowRight className="h-5 w-5 mr-2" aria-hidden="true" />
                Go to Dashboard
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Error State — retry mechanism (guidelines: provide retry mechanisms) */}
        {pageState === "error" && (
          <Card variant="bordered" padding="lg">
            <CardContent className="text-center space-y-4">
              <div className="mx-auto w-14 h-14 rounded-full bg-danger/10 flex items-center justify-center">
                <XCircle className="h-7 w-7 text-danger" aria-hidden="true" />
              </div>
              <div className="space-y-2">
                <h1 className="text-2xl font-bold text-foreground">
                  Invalid Invitation
                </h1>
                <p className="text-base text-muted-foreground">{errorMessage}</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
                {canRetry && (
                  <Button
                    variant="primary"
                    size="lg"
                    onClick={fetchInvitation}
                    aria-label="Retry loading invitation"
                  >
                    <RotateCcw className="h-5 w-5 mr-2" aria-hidden="true" />
                    Retry
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="lg"
                  onClick={() => router.push("/")}
                  aria-label="Go to dashboard"
                >
                  Go to Dashboard
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
