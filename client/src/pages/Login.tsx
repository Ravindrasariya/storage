import { useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Snowflake, Eye, EyeOff, Loader2 } from "lucide-react";
import ReCAPTCHA from "react-google-recaptcha";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

const loginSchema = z.object({
  mobileNumber: z.string().regex(/^\d{10}$/, "Mobile number must be 10 digits"),
  password: z.string().min(1, "Password is required"),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(4, "Password must be at least 4 characters"),
  confirmPassword: z.string().min(4, "Password must be at least 4 characters"),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

type LoginFormData = z.infer<typeof loginSchema>;
type ChangePasswordFormData = z.infer<typeof changePasswordSchema>;

interface LoginProps {
  onLoginSuccess: (user: any, coldStorage: any, token: string) => void;
}

const RECAPTCHA_SITE_KEY = import.meta.env.VITE_RECAPTCHA_SITE_KEY || "";

export default function Login({ onLoginSuccess }: LoginProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [changePasswordLoading, setChangePasswordLoading] = useState(false);
  const [loggedInUser, setLoggedInUser] = useState<any>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const recaptchaRef = useRef<ReCAPTCHA>(null);

  const loginForm = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      mobileNumber: "",
      password: "",
    },
  });

  const changePasswordForm = useForm<ChangePasswordFormData>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  const onLogin = async (data: LoginFormData) => {
    if (RECAPTCHA_SITE_KEY && !captchaToken) {
      toast({
        title: t("captchaRequired") || "Verification required",
        description: t("pleaseCompleteCaptcha") || "Please complete the CAPTCHA verification",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, captchaToken }),
      });

      const result = await response.json();

      if (!response.ok) {
        recaptchaRef.current?.reset();
        setCaptchaToken(null);
        throw new Error(result.error || "Login failed");
      }

      toast({
        title: t("loginSuccess") || "Login successful",
        description: `${t("welcome") || "Welcome"}, ${result.user.name}!`,
      });

      onLoginSuccess(result.user, result.coldStorage, result.token);
    } catch (error: any) {
      toast({
        title: t("loginFailed") || "Login failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const onChangePassword = async (data: ChangePasswordFormData) => {
    if (!loggedInUser || !authToken) return;
    
    setChangePasswordLoading(true);
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "x-auth-token": authToken,
        },
        body: JSON.stringify({
          userId: loggedInUser.id,
          currentPassword: data.currentPassword,
          newPassword: data.newPassword,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to change password");
      }

      toast({
        title: t("passwordChanged") || "Password changed",
        description: t("passwordChangedSuccess") || "Your password has been updated successfully.",
      });

      setShowChangePassword(false);
      changePasswordForm.reset();
    } catch (error: any) {
      toast({
        title: t("error") || "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setChangePasswordLoading(false);
    }
  };

  const handleLoginForChangePassword = async (data: LoginFormData) => {
    if (RECAPTCHA_SITE_KEY && !captchaToken) {
      toast({
        title: t("captchaRequired") || "Verification required",
        description: t("pleaseCompleteCaptcha") || "Please complete the CAPTCHA verification",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, captchaToken }),
      });

      const result = await response.json();

      if (!response.ok) {
        recaptchaRef.current?.reset();
        setCaptchaToken(null);
        throw new Error(result.error || "Login failed");
      }

      setLoggedInUser(result.user);
      setAuthToken(result.token);
      setShowChangePassword(true);
    } catch (error: any) {
      toast({
        title: t("loginFailed") || "Login failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-slate-100 p-4">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="text-center space-y-4">
          <div className="flex justify-center">
            <div className="flex items-center gap-2 text-chart-1">
              <Snowflake className="h-10 w-10" />
            </div>
          </div>
          <div>
            <CardTitle className="text-2xl font-bold text-chart-1">
              Cold Store Manager
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              by <span className="text-green-600 font-medium">Krashu</span>
              <span className="text-orange-500 font-medium">Ved</span>
            </p>
          </div>
          <CardDescription className="text-lg font-medium">
            {t("welcome") || "Welcome"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-center text-muted-foreground mb-4">
            Please Enter Your Login Details
          </p>
          <form onSubmit={loginForm.handleSubmit(onLogin)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="mobileNumber">{t("mobileNumber") || "Mobile Number"}</Label>
              <Input
                id="mobileNumber"
                type="tel"
                placeholder="Enter 10-digit mobile number"
                maxLength={10}
                {...loginForm.register("mobileNumber")}
                data-testid="input-mobile-number"
              />
              {loginForm.formState.errors.mobileNumber && (
                <p className="text-sm text-destructive">
                  {loginForm.formState.errors.mobileNumber.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">{t("password") || "Password"}</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter password"
                  {...loginForm.register("password")}
                  data-testid="input-password"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full px-3"
                  onClick={() => setShowPassword(!showPassword)}
                  data-testid="button-toggle-password"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              {loginForm.formState.errors.password && (
                <p className="text-sm text-destructive">
                  {loginForm.formState.errors.password.message}
                </p>
              )}
            </div>

            {RECAPTCHA_SITE_KEY && (
              <div className="flex justify-center">
                <ReCAPTCHA
                  ref={recaptchaRef}
                  sitekey={RECAPTCHA_SITE_KEY}
                  onChange={(token) => setCaptchaToken(token)}
                  onExpired={() => setCaptchaToken(null)}
                  data-testid="recaptcha"
                />
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={isLoading || (RECAPTCHA_SITE_KEY && !captchaToken)}
              data-testid="button-login"
            >
              {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t("login") || "Login"}
            </Button>
          </form>

          <div className="mt-4 text-center">
            <Button
              variant="ghost"
              className="text-chart-1"
              onClick={() => {
                const mobileNumber = loginForm.getValues("mobileNumber");
                const password = loginForm.getValues("password");
                if (mobileNumber && password) {
                  handleLoginForChangePassword({ mobileNumber, password });
                } else {
                  toast({
                    title: t("enterCredentials") || "Enter credentials",
                    description: t("enterCredentialsFirst") || "Please enter your mobile number and current password first",
                    variant: "destructive",
                  });
                }
              }}
              data-testid="button-change-password"
            >
              {t("changePassword") || "Change Password"}
            </Button>
          </div>

          <div className="mt-6 pt-4 border-t text-center text-sm text-muted-foreground">
            Need Help? Please reach out to{" "}
            <span className="text-green-600 font-medium">Krashu</span>
            <span className="text-orange-500 font-medium">Ved</span>{" "}
            <a href="tel:8882589392" className="font-medium text-chart-1 hover:underline">
              8882589392
            </a>
          </div>
        </CardContent>
      </Card>

      <Dialog open={showChangePassword} onOpenChange={setShowChangePassword}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("changePassword") || "Change Password"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={changePasswordForm.handleSubmit(onChangePassword)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="currentPassword">{t("currentPassword") || "Current Password"}</Label>
              <Input
                id="currentPassword"
                type="password"
                placeholder="Enter current password"
                {...changePasswordForm.register("currentPassword")}
                data-testid="input-current-password"
              />
              {changePasswordForm.formState.errors.currentPassword && (
                <p className="text-sm text-destructive">
                  {changePasswordForm.formState.errors.currentPassword.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="newPassword">{t("newPassword") || "New Password"}</Label>
              <Input
                id="newPassword"
                type="password"
                placeholder="Enter new password"
                {...changePasswordForm.register("newPassword")}
                data-testid="input-new-password"
              />
              {changePasswordForm.formState.errors.newPassword && (
                <p className="text-sm text-destructive">
                  {changePasswordForm.formState.errors.newPassword.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">{t("confirmPassword") || "Confirm Password"}</Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="Confirm new password"
                {...changePasswordForm.register("confirmPassword")}
                data-testid="input-confirm-password"
              />
              {changePasswordForm.formState.errors.confirmPassword && (
                <p className="text-sm text-destructive">
                  {changePasswordForm.formState.errors.confirmPassword.message}
                </p>
              )}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowChangePassword(false)}
              >
                {t("cancel") || "Cancel"}
              </Button>
              <Button
                type="submit"
                disabled={changePasswordLoading}
                data-testid="button-save-password"
              >
                {changePasswordLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {t("save") || "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
