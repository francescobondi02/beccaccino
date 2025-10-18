import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Header from "@/components/Header";
import { Trophy, Users, Star, Clock, Edit2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const Profile = () => {
  const navigate = useNavigate();
  const [username, setUsername] = useState("Mario Rossi");
  const [isEditing, setIsEditing] = useState(false);
  const [newUsername, setNewUsername] = useState(username);

  // Mock data
  const recentGames = [
    { id: 1, date: "2024-01-15", result: "Vittoria", opponent: "Luigi", score: "120-85" },
    { id: 2, date: "2024-01-14", result: "Sconfitta", opponent: "Anna", score: "90-110" },
    { id: 3, date: "2024-01-13", result: "Vittoria", opponent: "Carlo", score: "105-95" },
    { id: 4, date: "2024-01-12", result: "Vittoria", opponent: "Sara", score: "115-88" },
  ];

  const stats = {
    totalGames: 47,
    wins: 32,
    winRate: 68,
    favoriteCard: "Asso di Coppe",
    totalPoints: 4850,
  };

  const handleSaveUsername = () => {
    if (!newUsername.trim()) {
      toast.error("Il nome non può essere vuoto");
      return;
    }
    setUsername(newUsername);
    setIsEditing(false);
    toast.success("Nome aggiornato con successo!");
  };

  const handleDeleteAccount = () => {
    toast.success("Account eliminato");
    navigate("/");
  };

  const handleLogout = () => {
    toast.success("Logout effettuato");
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-background">
      <Header username={username} onLogout={handleLogout} />
      
      <div className="container mx-auto px-4 pt-24 pb-12">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Profile Header */}
          <Card className="bg-gradient-card border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="text-2xl">Il mio profilo</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {isEditing ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="username">Nome utente</Label>
                    <Input
                      id="username"
                      value={newUsername}
                      onChange={(e) => setNewUsername(e.target.value)}
                      className="bg-secondary border-border"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={handleSaveUsername} variant="gradient">
                      Salva
                    </Button>
                    <Button
                      onClick={() => {
                        setIsEditing(false);
                        setNewUsername(username);
                      }}
                      variant="outline"
                    >
                      Annulla
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Nome utente</p>
                    <p className="text-xl font-semibold">{username}</p>
                  </div>
                  <Button
                    onClick={() => setIsEditing(true)}
                    variant="outline"
                    size="sm"
                  >
                    <Edit2 className="h-4 w-4 mr-2" />
                    Modifica
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="bg-gradient-card border-border/50">
              <CardContent className="pt-6 text-center">
                <Users className="h-8 w-8 mx-auto mb-2 text-primary" />
                <p className="text-2xl font-bold">{stats.totalGames}</p>
                <p className="text-sm text-muted-foreground">Partite</p>
              </CardContent>
            </Card>
            <Card className="bg-gradient-card border-border/50">
              <CardContent className="pt-6 text-center">
                <Trophy className="h-8 w-8 mx-auto mb-2 text-accent" />
                <p className="text-2xl font-bold">{stats.wins}</p>
                <p className="text-sm text-muted-foreground">Vittorie</p>
              </CardContent>
            </Card>
            <Card className="bg-gradient-card border-border/50">
              <CardContent className="pt-6 text-center">
                <Star className="h-8 w-8 mx-auto mb-2 text-primary" />
                <p className="text-2xl font-bold">{stats.winRate}%</p>
                <p className="text-sm text-muted-foreground">Win Rate</p>
              </CardContent>
            </Card>
            <Card className="bg-gradient-card border-border/50">
              <CardContent className="pt-6 text-center">
                <Clock className="h-8 w-8 mx-auto mb-2 text-accent" />
                <p className="text-2xl font-bold">{stats.totalPoints}</p>
                <p className="text-sm text-muted-foreground">Punti</p>
              </CardContent>
            </Card>
          </div>

          {/* Recent Games */}
          <Card className="bg-gradient-card border-border/50">
            <CardHeader>
              <CardTitle>Partite recenti</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {recentGames.map((game) => (
                  <div
                    key={game.id}
                    className="flex items-center justify-between p-3 bg-secondary rounded-lg"
                  >
                    <div className="flex-1">
                      <p className="font-medium">vs {game.opponent}</p>
                      <p className="text-sm text-muted-foreground">{game.date}</p>
                    </div>
                    <div className="text-right">
                      <p
                        className={`font-semibold ${
                          game.result === "Vittoria"
                            ? "text-accent"
                            : "text-muted-foreground"
                        }`}
                      >
                        {game.result}
                      </p>
                      <p className="text-sm text-muted-foreground">{game.score}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Danger Zone */}
          <Card className="bg-gradient-card border-destructive/50">
            <CardHeader>
              <CardTitle className="text-destructive">Zona pericolosa</CardTitle>
            </CardHeader>
            <CardContent>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" className="w-full">
                    <Trash2 className="h-4 w-4 mr-2" />
                    Elimina account
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="bg-card">
                  <AlertDialogHeader>
                    <AlertDialogTitle>Sei sicuro?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Questa azione non può essere annullata. Tutti i tuoi dati
                      verranno eliminati permanentemente.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Annulla</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDeleteAccount}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Elimina
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Profile;
