import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import Header from "@/components/Header";
import { Button } from "@/components/ui/button";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="circolo-shell">
      <Header />
      <main className="arcade-not-found flex min-h-screen items-center justify-center bg-background px-6">
      <div className="text-center">
        <h1 className="mb-4 text-6xl font-bold text-primary">404</h1>
        <p className="mb-6 text-xl">Qui non ci sono carte da giocare.</p>
        <Button asChild><Link to="/">Torna alla home</Link></Button>
      </div>
      </main>
    </div>
  );
};

export default NotFound;
