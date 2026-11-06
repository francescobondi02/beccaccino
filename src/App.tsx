import { lazy, Suspense } from "react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Outlet } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { useAppUpdate } from "./hooks/useAppUpdate";
import LobbyPage from "./pages/LobbyPage";
import NotFound from "./pages/NotFound";
import RotateDevicePrompt from "./components/game/RotateDevicePrompt";
import "./styles/arcade.css";
import "./styles/mobile-app.css";

const GameRoom = lazy(() => import("./pages/GameRoom"));
const GameTable = lazy(() => import("./pages/GameTable"));
const Profile = lazy(() => import("./pages/Profile"));
const Leaderboard = lazy(() => import("./pages/Leaderboard"));
const Practice = lazy(() => import("./pages/Practice"));
const Annotation = lazy(() => import("./pages/Annotation"));
const PreviewStudio = import.meta.env.DEV
  ? lazy(() => import("./preview/PreviewStudio"))
  : null;
const MobilePreview = import.meta.env.DEV
  ? lazy(() => import("./preview/MobilePreview"))
  : null;

const queryClient = new QueryClient();

const App = () => {
  useAppUpdate();

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="data-ui"
        defaultTheme="arcade"
        forcedTheme="arcade"
        themes={["arcade"]}
        storageKey="becca-ui"
        enableSystem={false}
        enableColorScheme={false}
      >
        <Sonner visibleToasts={1} duration={2500} />
        <BrowserRouter>
          <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>}>
            <Routes>
              {import.meta.env.DEV && (
                <Route path="/preview/profile" element={<Profile preview />} />
              )}
              {MobilePreview && (
                <Route path="/preview/mobile/*" element={<MobilePreview />} />
              )}
              {PreviewStudio && (
                <Route path="/preview/*" element={<PreviewStudio />} />
              )}
              <Route element={<div className="arcade-app"><RotateDevicePrompt /><Outlet /></div>}>
                <Route path="/" element={<LobbyPage />} />
                <Route path="/room/:roomCode" element={<GameRoom />} />
                <Route path="/game/:gameRoomCode" element={<GameTable />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/leaderboard" element={<Leaderboard />} />
                <Route path="/practice" element={<Practice />} />
                <Route path="/annotate" element={<Annotation />} />
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
          </Suspense>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

export default App;
