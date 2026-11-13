import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { apiPost } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

interface AuthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface AuthResponse {
  id: number;
  username: string;
}

const AuthDialog = ({ open, onOpenChange }: AuthDialogProps) => {
  const { setUser } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!username.trim()) {
      toast.error("Inserisci un nome utente");
      return;
    }

    if (!password.trim()) {
      toast.error("Inserisci una password");
      return;
    }

    if (password.length < 6) {
      toast.error("La password deve essere di almeno 6 caratteri");
      return;
    }

    setIsLoading(true);

    try {
      const endpoint = isLogin ? "/users/login" : "/users/register";
      const data = await apiPost<AuthResponse>(endpoint, { username, password });

      toast.success(
        isLogin ? "Accesso effettuato!" : "Registrazione completata!"
      );
      setUser(data);
      onOpenChange(false);

      // Reset form
      setUsername("");
      setPassword("");
    } catch (error) {
      console.error("Auth error:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Errore durante l'autenticazione"
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-card" data-testid="auth-dialog">
        <DialogHeader>
          <DialogTitle className="text-center text-2xl">
            {isLogin ? "Accedi" : "Registrati"}
          </DialogTitle>
          <DialogDescription className="text-center">
            {isLogin
              ? "Bentornato! Accedi per continuare a giocare"
              : "Crea un account per iniziare a giocare"}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label htmlFor="username">Nome utente</Label>
            <Input
              id="username"
              data-testid="username-input"
              placeholder="Il tuo nome utente"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="bg-secondary border-border"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              data-testid="password-input"
              type="password"
              placeholder="La tua password"
              autoComplete={isLogin ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-secondary border-border"
            />
          </div>

          <Button
            type="submit"
            variant="gradient"
            className="w-full"
            size="lg"
            disabled={isLoading}
            data-testid="auth-submit-button"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {isLogin ? "Accesso in corso..." : "Registrazione in corso..."}
              </>
            ) : isLogin ? (
              "Accedi"
            ) : (
              "Registrati"
            )}
          </Button>

          <div className="text-center text-sm">
            <button
              type="button"
              onClick={() => setIsLogin(!isLogin)}
              className="text-primary hover:underline"
              data-testid="toggle-auth-mode"
            >
              {isLogin
                ? "Non hai un account? Registrati"
                : "Hai già un account? Accedi"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default AuthDialog;
