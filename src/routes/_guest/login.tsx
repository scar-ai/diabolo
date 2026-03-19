import { RiGithubFill } from "@remixicon/react";
import { createFileRoute } from "@tanstack/react-router";

import { SignInSocialButton } from "@/components/sign-in-social-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_guest/login")({
  component: LoginForm,
});

function LoginForm() {
  const { redirectUrl } = Route.useRouteContext();

  return (
    <div className="relative flex min-h-svh items-center justify-center overflow-hidden bg-background px-6 py-10">
      <div className="relative flex w-full max-w-sm flex-col gap-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex flex-col gap-1">
            <h1 className="text-4xl font-bold tracking-tight text-foreground">Welcome back</h1>
            <p className="text-lg text-muted-foreground">Sign in to your Diabolo workspace</p>
          </div>
        </div>

        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-lg">Sign in</CardTitle>
            <CardDescription className="text-sm">
              Use your GitHub account to continue securely.
            </CardDescription>
          </CardHeader>

          <CardContent className="flex flex-col gap-4">
            <SignInSocialButton
              provider="github"
              callbackURL={redirectUrl}
              icon={<RiGithubFill />}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
