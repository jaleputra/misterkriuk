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
      {/* Left Column - Booth Ayam Kriuk Ami Aneen Branding Visual */}
      <div className="hidden lg:block lg:col-span-6 xl:col-span-7 relative h-screen bg-neutral-900 overflow-hidden">
        <img
          src="/ami-aneen-booth.jpg"
          alt="Booth Ayam Kriuk Ami Aneen"
          className="absolute inset-0 w-full h-full object-cover opacity-95 object-center transition-transform duration-[10000ms] hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-neutral-950 via-neutral-950/40 to-neutral-900/10 mix-blend-multiply" />
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-neutral-950/10" />

        <div className="absolute bottom-12 left-12 right-12 z-20 text-white animate-in fade-in slide-in-from-bottom-6 duration-1000">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/25 backdrop-blur-md border border-primary/45 text-secondary text-xs font-semibold mb-4">
            <img src="/logo.png" alt="Logo" className="h-5 w-5 object-contain" />
            Booth Resmi Ayam Kriuk Ami Aneen
          </div>
          <h2 className="text-4xl font-extrabold tracking-tight leading-tight text-white mb-2">
            Renyah & Gurih di Setiap Gigitan
          </h2>
          <p className="text-lg text-neutral-300 max-w-md font-medium leading-relaxed">
            Kelola operasional outlet kasir Anda dengan sistem terintegrasi, cepat, dan efisien.
          </p>
        </div>
      </div>

      {/* Right Column - Auth Card Form */}
      <div className="col-span-12 lg:col-span-6 xl:col-span-5 min-h-screen lg:h-screen lg:overflow-y-auto flex flex-col justify-between p-6 sm:p-10 bg-gradient-to-br from-amber-50/40 via-neutral-50 to-orange-100/30 dark:from-neutral-950 dark:via-neutral-900 dark:to-neutral-950 relative overflow-hidden">
        {/* Dynamic Background Blobs */}
        <div className="absolute top-[-10%] right-[-10%] w-[60%] h-[60%] rounded-full bg-secondary/15 blur-[100px] pointer-events-none" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[60%] h-[60%] rounded-full bg-primary/10 blur-[100px] pointer-events-none" />

        <div className="my-auto w-full max-w-[420px] mx-auto z-10 py-8">
          {/* Auth Card */}
          <Card className="bg-white/80 dark:bg-neutral-900/80 backdrop-blur-xl border border-white/40 dark:border-neutral-800/40 shadow-[0_20px_50px_rgba(0,0,0,0.04)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.2)] rounded-3xl overflow-hidden animate-in fade-in zoom-in-95 duration-500">
            <CardHeader className="flex flex-col items-center text-center pb-4 pt-8">
              <img
                src="/logo.png"
                alt="Logo Ayam Kriuk Ami Aneen"
                className="h-20 w-20 object-contain mb-3 hover:scale-105 transition-transform duration-300"
              />
              <CardTitle className="text-2xl font-extrabold tracking-tight bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent">
                Ayam Kriuk Ami Aneen
              </CardTitle>
              <p className="text-xs font-semibold text-muted-foreground/70 mt-1 uppercase tracking-wider">
                Sistem Kasir Ayam Kriuk
              </p>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="signin" className="w-full">
                <TabsList className="grid grid-cols-2 h-11 p-1 bg-neutral-100/80 dark:bg-neutral-950/80 rounded-2xl mb-6 border border-neutral-200/20">
                  <TabsTrigger
                    value="signin"
                    className="h-9 rounded-xl text-sm font-semibold transition-all duration-300 cursor-pointer data-[state=active]:bg-white dark:data-[state=active]:bg-neutral-800 data-[state=active]:text-primary data-[state=active]:shadow-sm"
                  >
                    Masuk
                  </TabsTrigger>
                  <TabsTrigger
                    value="signup"
                    className="h-9 rounded-xl text-sm font-semibold transition-all duration-300 cursor-pointer data-[state=active]:bg-white dark:data-[state=active]:bg-neutral-800 data-[state=active]:text-primary data-[state=active]:shadow-sm"
                  >
                    Daftar
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="signin" className="outline-none">
                  <form onSubmit={onSignIn} className="space-y-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-neutral-600 dark:text-neutral-400">Email</Label>
                      <div className="relative">
                        <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground/70" />
                        <Input
                          type="email"
                          required
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className="pl-10 h-11 bg-white/50 dark:bg-neutral-950/50 border-neutral-200/80 dark:border-neutral-800/80 rounded-xl focus-visible:ring-primary focus-visible:border-primary transition-all duration-200"
                          placeholder="nama@email.com"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-neutral-600 dark:text-neutral-400">Password</Label>
                      <div className="relative">
                        <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground/70" />
                        <Input
                          type={showPassword ? "text" : "password"}
                          required
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="pl-10 pr-10 h-11 bg-white/50 dark:bg-neutral-950/50 border-neutral-200/80 dark:border-neutral-800/80 rounded-xl focus-visible:ring-primary focus-visible:border-primary transition-all duration-200"
                          placeholder="••••••••"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/80 hover:text-foreground transition-colors p-1"
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>

                    <Button
                      className="w-full h-11 bg-gradient-to-r from-primary to-accent hover:opacity-95 text-primary-foreground font-semibold rounded-xl transition-all duration-300 hover:shadow-lg hover:shadow-primary/20 active:scale-[0.98] mt-6 flex items-center justify-center gap-2 cursor-pointer"
                      type="submit"
                      disabled={loading}
                    >
                      {loading ? (
                        <>
                          <svg className="animate-spin h-5 w-5 text-current" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          <span>Memproses…</span>
                        </>
                      ) : (
                        <>
                          <span>Masuk ke Kasir</span>
                          <ArrowRight className="h-5 w-5" />
                        </>
                      )}
                    </Button>
                  </form>
                </TabsContent>

                <TabsContent value="signup" className="outline-none">
                  <form onSubmit={onSignUp} className="space-y-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-neutral-600 dark:text-neutral-400">Nama Lengkap</Label>
                      <div className="relative">
                        <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground/70" />
                        <Input
                          required
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          className="pl-10 h-11 bg-white/50 dark:bg-neutral-950/50 border-neutral-200/80 dark:border-neutral-800/80 rounded-xl focus-visible:ring-primary focus-visible:border-primary transition-all duration-200"
                          placeholder="Nama Anda"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-neutral-600 dark:text-neutral-400">Email</Label>
                      <div className="relative">
                        <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground/70" />
                        <Input
                          type="email"
                          required
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className="pl-10 h-11 bg-white/50 dark:bg-neutral-950/50 border-neutral-200/80 dark:border-neutral-800/80 rounded-xl focus-visible:ring-primary focus-visible:border-primary transition-all duration-200"
                          placeholder="nama@email.com"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-neutral-600 dark:text-neutral-400">Password</Label>
                      <div className="relative">
                        <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground/70" />
                        <Input
                          type={showPassword ? "text" : "password"}
                          minLength={6}
                          required
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="pl-10 pr-10 h-11 bg-white/50 dark:bg-neutral-950/50 border-neutral-200/80 dark:border-neutral-800/80 rounded-xl focus-visible:ring-primary focus-visible:border-primary transition-all duration-200"
                          placeholder="Minimal 6 karakter"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/80 hover:text-foreground transition-colors p-1"
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>

                    <Button
                      className="w-full h-11 bg-gradient-to-r from-primary to-accent hover:opacity-95 text-primary-foreground font-semibold rounded-xl transition-all duration-300 hover:shadow-lg hover:shadow-primary/20 active:scale-[0.98] mt-6 flex items-center justify-center gap-2 cursor-pointer"
                      type="submit"
                      disabled={loading}
                    >
                      {loading ? (
                        <>
                          <svg className="animate-spin h-5 w-5 text-current" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          <span>Memproses…</span>
                        </>
                      ) : (
                        <>
                          <span>Daftar Akun Baru</span>
                          <ArrowRight className="h-5 w-5" />
                        </>
                      )}
                    </Button>

                    <div className="rounded-2xl bg-amber-50/40 dark:bg-amber-950/10 border border-amber-200/30 dark:border-amber-900/20 p-3 mt-4">
                      <p className="text-xs text-amber-800 dark:text-amber-400 text-center leading-relaxed">
                        💡 Akun pertama otomatis menjadi <strong>Admin</strong> sistem.
                      </p>
                    </div>
                  </form>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>

        {/* Footer */}
        <div className="text-center mt-auto pt-6 text-xs text-muted-foreground/60 z-10">
          © {new Date().getFullYear()} Ayam Kriuk Ami Aneen. All rights reserved.
        </div>
      </div>
    </div>
  );
}


