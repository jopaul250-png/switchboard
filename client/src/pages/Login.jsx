import { useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { Button, Input, ErrorText, useToast } from "../components/ui.jsx";
import BrandLogo from "../components/BrandLogo.jsx";

export default function Login() {
  const { user, loading, login, register } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (!loading && user) return <Navigate to="/" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await (mode === "login" ? login(email, password) : register(email, password));
      navigate("/", { replace: true });
      toast.success(mode === "login" ? "Welcome back" : "Account created — welcome to Switchboard");
    } catch (err) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-br from-slate-950 via-slate-950 to-indigo-950/60 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-xl shadow-indigo-950/60">
            <BrandLogo className="h-10 w-10 text-white" glow />
          </div>
          <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-white">Switchboard</h1>
          <p className="mt-1 text-sm text-slate-400">
            Every client. One console. Zero tab-juggling.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl">
          <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-slate-950 p-1">
            {["login", "register"].map((m) => (
              <button
                key={m}
                onClick={() => {
                  setMode(m);
                  setError(null);
                }}
                className={`rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-wider transition-colors ${
                  mode === m
                    ? "bg-slate-800 text-indigo-300 shadow-inner"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {m === "login" ? "Log in" : "Create account"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-4">
            <Input
              type="email"
              placeholder="you@yourva.co"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
            <Input
              type="password"
              placeholder={mode === "register" ? "Minimum 8 characters" : "Password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={mode === "register" ? 8 : undefined}
              autoComplete={mode === "register" ? "new-password" : "current-password"}
            />
            <ErrorText>{error}</ErrorText>
            <Button type="submit" className="w-full" disabled={busy} size="lg">
              {busy ? "Connecting…" : mode === "login" ? "Log in" : "Create account"}
            </Button>
          </form>
        </div>

        <p className="mt-4 text-center text-[11px] text-slate-600">
          Credentials are encrypted at rest with AES-256-GCM.
        </p>
      </div>
    </div>
  );
}
