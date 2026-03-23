import { cloneElement, type ReactElement, type SVGProps, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import authClient from "@/lib/auth/auth-client";

interface SocialLoginButtonProps {
  provider: string;
  icon: ReactElement<SVGProps<SVGSVGElement>>;
  disabled?: boolean;
  callbackURL: string;
}

export function SignInSocialButton(props: SocialLoginButtonProps) {
  const [isPending, setIsPending] = useState(false);
  const providerLabel =
    props.provider === "github"
      ? "GitHub"
      : props.provider.charAt(0).toUpperCase() + props.provider.slice(1);

  const handleClick = async () => {
    if (isPending || props.disabled) return;

    setIsPending(true);

    try {
      await authClient.signIn.social({
        provider: props.provider,
        callbackURL: props.callbackURL,
        disableRedirect: true,
        fetchOptions: {
          onSuccess: ({ data }) => {
            if (!data?.url) {
              setIsPending(false);
              toast.error(`Unable to start ${providerLabel} sign-in.`);
              return;
            }

            window.location.assign(data.url);
          },
          onError: ({ error }) => {
            setIsPending(false);
            toast.error(error.message || `An error occurred during ${providerLabel} sign-in.`);
          },
        },
      });
    } catch (error) {
      setIsPending(false);
      toast.error(
        error instanceof Error
          ? error.message
          : `An error occurred during ${providerLabel} sign-in.`,
      );
    }
  };

  return (
    <Button
      variant="outline"
      className="w-full justify-start"
      type="button"
      disabled={isPending || props.disabled}
      onClick={handleClick}
    >
      {cloneElement(props.icon, { "data-icon": "inline-start" } as never)}
      Continue with {providerLabel}
    </Button>
  );
}
