import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [twoFactorTicket, setTwoFactorTicket] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const { login, verifyTwoFactorLogin, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const waiting = authLoading || isLoading;
  const requiresTwoFactor = Boolean(twoFactorTicket);

  useEffect(() => {
    if (!waiting) {
      setProgress(0);
      return;
    }

    setProgress((value) => (value > 0 ? value : 18));
    const timer = window.setInterval(() => {
      setProgress((value) => {
        if (value >= 92) return value;
        return Math.min(92, value + Math.max(2, Math.ceil((92 - value) / 5)));
      });
    }, 280);

    return () => window.clearInterval(timer);
  }, [waiting]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      if (requiresTwoFactor) {
        await verifyTwoFactorLogin(twoFactorTicket, twoFactorCode);
        navigate("/");
        return;
      }

      const result = await login(username, password);
      if (result.requiresTwoFactor) {
        setTwoFactorTicket(result.ticket);
        setTwoFactorCode("");
        setPassword("");
        return;
      }
      navigate("/");
    } catch (err: any) {
      setError(err.message || "登录失败");
    } finally {
      setIsLoading(false);
    }
  };

  const resetTwoFactorStep = () => {
    setTwoFactorTicket("");
    setTwoFactorCode("");
    setError("");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md px-4">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">财务对账及认账管理平台</h1>
          <p className="text-sm text-gray-500 mt-2">Financial Reconciliation System</p>
        </div>
        <Card className="shadow-md">
          <CardHeader>
            <CardTitle className="text-lg">系统登录</CardTitle>
            <CardDescription>{requiresTwoFactor ? "请输入验证器 App 中的动态验证码" : "请输入用户名和密码"}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              {waiting && (
                <div className="space-y-2 rounded-md border border-blue-100 bg-blue-50 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-3 text-xs text-blue-700">
                    <span>{isLoading ? (requiresTwoFactor ? "正在验证动态码" : "正在验证账号") : "正在检查登录状态"}</span>
                    <span>{Math.round(progress)}%</span>
                  </div>
                  <Progress value={progress} className="h-1.5 bg-blue-100" />
                </div>
              )}
              {requiresTwoFactor ? (
                <div className="space-y-2">
                  <Label htmlFor="two-factor-code">动态验证码</Label>
                  <Input
                    id="two-factor-code"
                    value={twoFactorCode}
                    onChange={(e) => setTwoFactorCode(e.target.value)}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="6 位验证码"
                    required
                  />
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="username">用户名</Label>
                    <Input
                      id="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      autoComplete="username"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">密码</Label>
                    <Input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                      required
                    />
                  </div>
                </>
              )}
              <Button type="submit" className="w-full" disabled={waiting}>
                {isLoading ? "登录中..." : requiresTwoFactor ? "验证并登录" : "登录"}
              </Button>
              {requiresTwoFactor && (
                <Button type="button" variant="ghost" className="w-full" onClick={resetTwoFactorStep} disabled={waiting}>
                  返回账号密码登录
                </Button>
              )}
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
