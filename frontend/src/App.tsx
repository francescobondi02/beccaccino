import { lazy, Suspense } from "react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useAppUpdate } from "./hooks/useAppUpdate";
import LobbyPage from "./pages/LobbyPage";
import NotFound from "./pages/NotFound";
import "./styles/arcade.css";

const GameRoom = lazy(() => import("./pages/GameRoom"));
const GameTable = lazy(() => import("./pages/GameTable"));
const Profile = lazy(() => import("./pages/Profile"));
const Leaderboard = lazy(() => import("./pages/Leaderboard"));
const Practice = lazy(() => import("./pages/Practice"));

const queryClient = new QueryClient();

const App = () => {
  useAppUpdate();

  return (
    <QueryClientProvider client={queryClient}>
      <Sonner visibleToasts={1} duration={2500} />
      <BrowserRouter>
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>}>
          <Routes>
            <Route path="/" element={<LobbyPage />} />
            <Route path="/room/:roomCode" element={<GameRoom />} />
            <Route path="/game/:gameRoomCode" element={<GameTable />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/leaderboard" element={<Leaderboard />} />
            <Route path="/practice" element={<Practice />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  );
};

export default App;
