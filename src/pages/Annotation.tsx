import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  ClipboardCheck,
  KeyRound,
  Loader2,
  LogIn,
  RefreshCw,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { AnnotationDifficulty } from "@/annotations/constants";
import type {
  AnnotationResponseRequest,
  AnnotationResponseResult,
  AnnotationPlayCardScenario,
  AnnotationScenario as AnnotationScenarioModel,
  AnnotationSelectedAction,
  AnnotationStatusResponse,
  NextAnnotationResponse,
} from "@/annotations/model";
import AnnotationScenario from "@/components/AnnotationScenario";
import AuthDialog from "@/components/AuthDialog";
import Header from "@/components/Header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { ApiError, apiGet, apiPost } from "@/lib/api";

type PageStatus =
  | "loading"
  | "auth"
  | "access"
  | "scenario"
  | "empty"
  | "error";
type RetryTarget = "auth" | "initial" | "next";
type LegacyPlayCardScenario = Omit<
  AnnotationPlayCardScenario,
  "decisionType"
>;

function normalizeScenario(
  scenario: AnnotationScenarioModel | LegacyPlayCardScenario | null,
): AnnotationScenarioModel | null {
  if (!scenario || "decisionType" in scenario) return scenario;
  return { ...scenario, decisionType: "play_card" };
}

const Annotation = () => {
  const navigate = useNavigate();
  const {
    user,
    loading: authLoading,
    error: authError,
    retry: retryAuth,
    clearUser,
  } = useAuth();
  const [status, setStatus] = useState<PageStatus>("loading");
  const [scenario, setScenario] =
    useState<AnnotationScenarioModel | null>(null);
  const [contributionCount, setContributionCount] = useState(0);
  const [accessCode, setAccessCode] = useState("");
  const [accessError, setAccessError] = useState<string | null>(null);
  const [responseError, setResponseError] = useState<string | null>(null);
  const [responseIsStale, setResponseIsStale] = useState(false);
  const [retryTarget, setRetryTarget] = useState<RetryTarget>("initial");
  const [isGrantingAccess, setIsGrantingAccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [scenarioStartedAt, setScenarioStartedAt] = useState(Date.now());

  const handleUnauthorized = useCallback(
    async (error: unknown): Promise<boolean> => {
      if (
        error instanceof ApiError &&
        (error.status === 401 || error.status === 403)
      ) {
        if (error.status === 401) {
          await clearUser();
          setAuthDialogOpen(true);
          setStatus("auth");
        } else {
          setStatus("access");
        }
        return true;
      }
      return false;
    },
    [clearUser],
  );

  const loadNext = useCallback(async () => {
    setStatus("loading");
    setResponseError(null);
    setResponseIsStale(false);
    try {
      const data = await apiGet<NextAnnotationResponse>("/annotations/next");
      const nextScenario = normalizeScenario(data.scenario);
      setContributionCount(data.contributionCount);
      setScenario(nextScenario);
      setScenarioStartedAt(Date.now());
      setStatus(nextScenario ? "scenario" : "empty");
    } catch (error) {
      if (await handleUnauthorized(error)) return;
      setRetryTarget("next");
      setStatus("error");
    }
  }, [handleUnauthorized]);

  const loadInitial = useCallback(async () => {
    if (!user) {
      setStatus("auth");
      return;
    }
    setStatus("loading");
    try {
      const data = await apiGet<AnnotationStatusResponse>(
        "/annotations/status",
      );
      setContributionCount(data.contributionCount);
      if (!data.accessGranted) {
        setStatus("access");
        return;
      }
      await loadNext();
    } catch (error) {
      if (await handleUnauthorized(error)) return;
      setRetryTarget("initial");
      setStatus("error");
    }
  }, [handleUnauthorized, loadNext, user]);

  useEffect(() => {
    if (authLoading) {
      setStatus("loading");
      return;
    }
    if (authError) {
      setRetryTarget("auth");
      setStatus("error");
      return;
    }
    if (!user) {
      setStatus("auth");
      setAuthDialogOpen(true);
      return;
    }
    setAuthDialogOpen(false);
    void loadInitial();
  }, [authError, authLoading, loadInitial, user]);

  const grantAccess = async () => {
    if (!accessCode.trim()) {
      setAccessError("Inserisci il codice di accesso.");
      return;
    }
    setIsGrantingAccess(true);
    setAccessError(null);
    try {
      const result = await apiPost<AnnotationStatusResponse>(
        "/annotations/access",
        { code: accessCode },
      );
      setContributionCount(result.contributionCount);
      setAccessCode("");
      await loadNext();
    } catch (error) {
      if (await handleUnauthorized(error)) return;
      if (error instanceof ApiError && error.status === 400) {
        setAccessError("Codice non valido.");
      } else if (error instanceof ApiError && error.status === 429) {
        setAccessError("Troppi tentativi. Riprova tra poco.");
      } else if (error instanceof ApiError && error.status === 503) {
        setAccessError("Accesso esperti non disponibile. Riprova più tardi.");
      } else {
        setAccessError("Impossibile verificare il codice. Riprova.");
      }
    } finally {
      setIsGrantingAccess(false);
    }
  };

  const submitResponse = async (
    selectedAction: AnnotationSelectedAction | null,
    skipped: boolean,
    comment: string | null,
    perceivedDifficulty: AnnotationDifficulty,
    responseTimeMs: number,
  ) => {
    if (!scenario) return;
    const payload: AnnotationResponseRequest = {
      scenarioId: scenario.id,
      scenarioHash: scenario.stateHash,
      selectedAction,
      skipped,
      comment,
      perceivedDifficulty,
      responseTimeMs,
    };

    setIsSubmitting(true);
    setResponseError(null);
    setResponseIsStale(false);
    try {
      const result = await apiPost<AnnotationResponseResult>(
        "/annotations/responses",
        payload,
      );
      setContributionCount(result.contributionCount);
      toast.success("Risposta salvata.");
      setScenario(null);
      await loadNext();
    } catch (error) {
      if (await handleUnauthorized(error)) return;
      if (error instanceof ApiError && error.status === 409) {
        setResponseIsStale(true);
        setResponseError(
          "Questo scenario non è più disponibile. Caricane un altro.",
        );
      } else {
        setResponseError("Impossibile registrare la risposta. Riprova.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto min-w-0 px-4 pb-12 pt-24">
        <div className="mx-auto max-w-6xl space-y-6">
          <div className="flex flex-col gap-5 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="-ml-3 mb-3"
                onClick={() => navigate("/")}
              >
                <ArrowLeft className="h-4 w-4" />
                Torna alla home
              </Button>
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <ClipboardCheck className="h-5 w-5" />
                </div>
                <h1 className="text-2xl font-bold sm:text-3xl">
                  Raccolta dati esperti
                </h1>
              </div>
            </div>
            {user && (
              <p className="text-sm text-muted-foreground">
                <span className="font-semibold tabular-nums text-foreground">
                  {contributionCount}
                </span>{" "}
                {contributionCount === 1
                  ? "risposta inviata"
                  : "risposte inviate"}
              </p>
            )}
          </div>

          {status === "loading" && (
            <div
              className="flex min-h-80 items-center justify-center"
              role="status"
              aria-label="Caricamento scenario"
            >
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
            </div>
          )}

          {status === "auth" && (
            <Card className="mx-auto max-w-lg border-border/70">
              <CardHeader>
                <CardTitle>Accedi per contribuire</CardTitle>
                <CardDescription>
                  Le tue risposte resteranno associate al tuo account.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  type="button"
                  variant="gradient"
                  className="w-full"
                  onClick={() => setAuthDialogOpen(true)}
                >
                  <LogIn className="h-4 w-4" />
                  Accedi o registrati
                </Button>
              </CardContent>
            </Card>
          )}

          {status === "access" && (
            <Card className="mx-auto max-w-lg border-border/70">
              <CardHeader>
                <CardTitle>Codice esperto</CardTitle>
                <CardDescription>
                  Inserisci il codice ricevuto per abilitare il tuo account.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="annotation-access-code">Codice</Label>
                  <Input
                    id="annotation-access-code"
                    type="password"
                    value={accessCode}
                    disabled={isGrantingAccess}
                    aria-invalid={Boolean(accessError)}
                    aria-describedby={
                      accessError ? "annotation-access-error" : undefined
                    }
                    onChange={(event) => {
                      setAccessCode(event.target.value);
                      setAccessError(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void grantAccess();
                    }}
                  />
                </div>
                {accessError && (
                  <p
                    id="annotation-access-error"
                    className="text-sm text-destructive"
                    role="alert"
                  >
                    {accessError}
                  </p>
                )}
                <Button
                  type="button"
                  variant="gradient"
                  className="w-full"
                  disabled={isGrantingAccess}
                  onClick={() => void grantAccess()}
                >
                  {isGrantingAccess ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <KeyRound className="h-4 w-4" />
                  )}
                  Continua
                </Button>
              </CardContent>
            </Card>
          )}

          {status === "scenario" && scenario && (
            <AnnotationScenario
              scenario={scenario}
              startedAt={scenarioStartedAt}
              isSubmitting={isSubmitting}
              errorMessage={responseError}
              onLoadAnotherScenario={
                responseIsStale ? () => void loadNext() : undefined
              }
              onConfirm={(action, difficulty, responseTimeMs) =>
                void submitResponse(
                  action,
                  false,
                  null,
                  difficulty,
                  responseTimeMs,
                )
              }
              onSkip={(comment, difficulty, responseTimeMs) =>
                void submitResponse(
                  null,
                  true,
                  comment,
                  difficulty,
                  responseTimeMs,
                )
              }
            />
          )}

          {status === "empty" && (
            <div className="mx-auto max-w-xl py-12 text-center">
              <h2 className="text-xl font-bold">Nuovi scenari in preparazione</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Hai valutato tutti gli scenari disponibili per ora.
              </p>
              <Button
                type="button"
                variant="outline"
                className="mt-5"
                onClick={() => void loadNext()}
              >
                <RefreshCw className="h-4 w-4" />
                Controlla di nuovo
              </Button>
            </div>
          )}

          {status === "error" && (
            <div className="mx-auto max-w-xl py-12 text-center" role="alert">
              <p className="text-lg font-semibold">
                Impossibile caricare i dati esperti
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                Controlla la connessione e riprova.
              </p>
              <Button
                type="button"
                variant="outline"
                className="mt-5"
                onClick={() => {
                  if (retryTarget === "auth") {
                    void retryAuth();
                  } else if (retryTarget === "initial") {
                    void loadInitial();
                  } else {
                    void loadNext();
                  }
                }}
              >
                <RefreshCw className="h-4 w-4" />
                Riprova
              </Button>
            </div>
          )}
        </div>
      </main>
      <AuthDialog open={authDialogOpen} onOpenChange={setAuthDialogOpen} />
    </div>
  );
};

export default Annotation;
