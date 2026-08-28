import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Mail, Lock, User, Eye, EyeOff, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/auth")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/transaction" });
  },
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (s) navigate({ to: "/transaction", replace: true });
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  const onSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) {
        if (error.message.toLowerCase().includes("invalid login credentials")) {
          toast.error("Email atau password salah. Jika belum terdaftar, silakan buat akun di tab 'Daftar'.");
        } else if (error.message.toLowerCase().includes("email not confirmed")) {
          toast.error("Email belum dikonfirmasi. Harap matikan 'Confirm Email' di dashboard Supabase.");
        } else {
          toast.error(error.message);
        }
        return;
      }
      if (data?.session) {
        toast.success("Login berhasil! Membuka kasir...");
        window.location.href = "/transaction";
      }
    } catch (err: any) {
      toast.error(err?.message || "Gagal melakukan login");
    } finally {
      setLoading(false);
    }
  };

  const onSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: window.location.origin, data: { name: name.trim() } },
      });
      if (error) {
        if (error.message.toLowerCase().includes("disabled") || (error as any).code === "email_provider_disabled") {
          toast.error("Email Provider dinonaktifkan di Supabase. Aktifkan kembali switch 'Enable Email provider' di Authentication > Providers > Email.");
        } else if (error.message.toLowerCase().includes("rate limit")) {
          toast.error("Limit email Supabase tercapai. Harap nonaktifkan hanya 'Confirm email' di Dashboard Supabase.");
        } else {
          toast.error(error.message);
        }
        return;
      }
      if (data?.session) {
        toast.success("Pendaftaran berhasil! Membuka kasir...");
        window.location.href = "/transaction";
      } else if (data?.user) {
        // Coba langsung login jika email confirmation sudah dimatikan
        const { data: signInData } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signInData?.session) {
          toast.success("Pendaftaran & Login berhasil! Membuka kasir...");
          window.location.href = "/transaction";
        } else {
          toast.info("Akun berhasil dibuat. Silakan login pada tab Masuk.");
        }
      }
    } catch (err: any) {
      toast.error(err?.message || "Gagal melakukan pendaftaran");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full lg:grid lg:grid-cols-12 overflow-hidden bg-background">
      {/* Left Column - Booth Mr Kriuk Ami Branding Visual */}
      <div className="hidden lg:block lg:col-span-6 xl:col-span-7 relative h-screen bg-neutral-950 overflow-hidden">
        <img
          src="/ami-aneen-booth.jpg"
          alt="Booth Mr Kriuk Ami"
          className="absolute inset-0 w-full h-full object-cover opacity-90 object-center transition-transform duration-10000 hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-neutral-950 via-neutral-950/50 to-neutral-900/20" />
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-neutral-950/30" />

        <div className="absolute bottom-12 left-12 right-12 z-20 text-white animate-in fade-in slide-in-from-bottom-6 duration-700">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-white text-xs font-semibold mb-4 shadow-sm">
            <img src="/logo.png" alt="Logo" className="h-5 w-5 object-contain" />
            <span>Booth Resmi Mr Kriuk Ami</span>
          </div>
          <h2 className="text-3xl xl:text-4xl font-extrabold tracking-tight leading-tight text-white mb-2.5">
            Renyah & Gurih di Setiap Gigitan
          </h2>
          <p className="text-base text-neutral-300 max-w-md font-medium leading-relaxed">
            Sistem kasir cerdas dan efisien untuk operasional harian outlet Mr Kriuk Ami.
          </p>
        </div>
      </div>

      {/* Right Column - Auth Card Form */}
      <div className="col-span-12 lg:col-span-6 xl:col-span-5 min-h-screen lg:h-screen lg:overflow-y-auto flex flex-col justify-between p-6 sm:p-10 bg-muted/30 dark:bg-background relative overflow-hidden">
        <div className="my-auto w-full max-w-[400px] mx-auto z-10 py-6">
          {/* Auth Card */}
          <Card className="bg-card border-border/80 shadow-md rounded-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-300">
            <CardHeader className="flex flex-col items-center text-center pb-3 pt-7">
              <div className="h-16 w-16 rounded-2xl bg-primary/5 border border-border flex items-center justify-center p-2 mb-3 shadow-xs">
                <img
                  src="/logo.png"
                  alt="Logo Mr Kriuk Ami"
                  className="h-full w-full object-contain"
                />
              </div>
              <CardTitle className="text-2xl font-bold tracking-tight text-foreground">
                Mr Kriuk Ami
              </CardTitle>
              <p className="text-xs font-medium text-muted-foreground mt-1">
                Sistem Point of Sale & Kasir Outlet
              </p>
            </CardHeader>
            <CardContent className="px-6 pb-6 pt-2">
              <Tabs defaultValue="signin" className="w-full">
                <TabsList className="grid grid-cols-2 mb-5">
                  <TabsTrigger value="signin">
                    Masuk
                  </TabsTrigger>
                  <TabsTrigger value="signup">
                    Daftar
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="signin" className="outline-none mt-0">
                  <form onSubmit={onSignIn} className="space-y-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-foreground">Email</Label>
                      <div className="relative">
                        <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          type="email"
                          required
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className="pl-10"
                          placeholder="nama@email.com"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-foreground">Password</Label>
                      <div className="relative">
                        <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          type={showPassword ? "text" : "password"}
                          required
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="pl-10 pr-10"
                          placeholder="••••••••"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1"
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>

                    <Button
                      className="w-full h-10.5 font-semibold mt-6 shadow-xs hover:shadow-md transition-all flex items-center justify-center gap-2"
                      type="submit"
                      disabled={loading}
                    >
                      {loading ? (
                        <>
                          <svg className="animate-spin h-4 w-4 text-current" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          <span>Memproses…</span>
                        </>
                      ) : (
                        <>
                          <span>Masuk ke Kasir</span>
                          <ArrowRight className="h-4 w-4" />
                        </>
                      )}
                    </Button>
                  </form>
                </TabsContent>

                <TabsContent value="signup" className="outline-none mt-0">
                  <form onSubmit={onSignUp} className="space-y-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-foreground">Nama Lengkap</Label>
                      <div className="relative">
                        <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          required
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          className="pl-10"
                          placeholder="Nama Anda"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-foreground">Email</Label>
                      <div className="relative">
                        <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          type="email"
                          required
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className="pl-10"
                          placeholder="nama@email.com"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-foreground">Password</Label>
                      <div className="relative">
                        <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          type={showPassword ? "text" : "password"}
                          minLength={6}
                          required
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="pl-10 pr-10"
                          placeholder="Minimal 6 karakter"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1"
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>

                    <Button
                      className="w-full h-10.5 font-semibold mt-6 shadow-xs hover:shadow-md transition-all flex items-center justify-center gap-2"
                      type="submit"
                      disabled={loading}
                    >
                      {loading ? (
                        <>
                          <svg className="animate-spin h-4 w-4 text-current" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          <span>Memproses…</span>
                        </>
                      ) : (
                        <>
                          <span>Daftar Akun Baru</span>
                          <ArrowRight className="h-4 w-4" />
                        </>
                      )}
                    </Button>

                    <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-3 mt-4">
                      <p className="text-xs text-amber-900 dark:text-amber-300 text-center leading-relaxed font-medium">
                        💡 Akun pertama yang mendaftar otomatis menjadi <strong>Admin</strong> sistem.
                      </p>
                    </div>
                  </form>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>

        {/* Footer */}
        <div className="text-center mt-auto pt-4 text-xs text-muted-foreground font-medium z-10">
          © {new Date().getFullYear()} Mr Kriuk Ami. All rights reserved.
        </div>
      </div>
    </div>
  );
}
