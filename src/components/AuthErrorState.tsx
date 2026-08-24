import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface AuthErrorStateProps {
  onRetry: () => void | Promise<void>;
}

const AuthErrorState = ({ onRetry }: AuthErrorStateProps) => (
  <div className="min-h-screen bg-background flex items-center justify-center p-4">
    <Card className="w-full max-w-md border-destructive/50" role="alert">
      <CardContent className="p-8 text-center">
        <AlertCircle className="h-10 w-10 mx-auto mb-3 text-destructive" />
        <p className="font-medium">Impossibile verificare la sessione</p>
        <p className="text-sm text-muted-foreground mt-2">
          Controlla la connessione e riprova.
        </p>
        <Button
          type="button"
          variant="outline"
          className="mt-4"
          onClick={() => void onRetry()}
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Riprova
        </Button>
      </CardContent>
    </Card>
  </div>
);

export default AuthErrorState;
