import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 text-slate-400">
        <div className="animate-pulse text-sm">Connecting to the switchboard…</div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return children ? children : <Outlet />;
}
